import { randomBytes } from 'node:crypto';
import * as moment from 'moment';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SystemUser } from '@/modules/System/models/SystemUser';
import { UserTenant } from '@/modules/System/models/UserTenant.model';
import { AuthSigninService } from '../commands/AuthSignin.service';
import { hashPassword } from '../Auth.utils';
import {
  buildAuthorizeUrl,
  decodeTx,
  encodeTx,
  generateStateAndPkce,
  isAdminClaim,
  mapClaimsToUser,
  safeEqualStr,
  VIDA_OIDC_TX_TTL_SEC,
  VidaOidcClaims,
  MappedUserIdentity,
} from './vida-oidc.core';

export interface VidaOidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authorizeUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  scope: string;
  booksTenantId: number;
  webappBaseUrl: string;
}

/** Shape mirrors AuthController's /signin response so the webapp reuses it. */
export interface VidaSessionResult {
  accessToken: string;
  organizationId: string;
  tenantId: number;
  userId: number;
}

export interface VidaOidcStart {
  authorizeUrl: string;
  txCookieValue: string;
  txCookieMaxAgeMs: number;
}

/**
 * Flat (non-discriminated) result. A discriminated union does not narrow under
 * this repo's `strictNullChecks: false` (the boolean `ok` literal widens), so
 * callers gate on `ok && session` rather than on the discriminant alone.
 */
export interface VidaCallbackResult {
  ok: boolean;
  error?: string;
  session?: VidaSessionResult;
}

interface TokenResponse {
  access_token?: unknown;
}

@Injectable()
export class VidaOidcService {
  private readonly logger = new Logger('VidaOidc');

  constructor(
    private readonly configService: ConfigService,
    private readonly authSignin: AuthSigninService,

    @Inject(SystemUser.name)
    private readonly systemUserModel: typeof SystemUser,

    @Inject(UserTenant.name)
    private readonly userTenantModel: typeof UserTenant,
  ) {}

  /**
   * Returns the RP config only when the integration is fully configured
   * (client credentials + a valid books tenant). Otherwise null, which the
   * routes surface as a redirect-with-error — the feature gate.
   */
  resolveConfig(): VidaOidcConfig | null {
    const cfg = this.configService.get<VidaOidcConfig>('vidaOidc');
    if (!cfg) return null;
    if (!cfg.clientId || !cfg.clientSecret) return null;
    if (!Number.isInteger(cfg.booksTenantId) || cfg.booksTenantId <= 0) {
      return null;
    }
    return cfg;
  }

  isEnabled(): boolean {
    return this.resolveConfig() !== null;
  }

  private isSecure(): boolean {
    return process.env.NODE_ENV === 'production';
  }

  /** Tx cookie is scoped to the OIDC routes only. */
  cookieOptions(): {
    httpOnly: true;
    secure: boolean;
    sameSite: 'lax';
    path: string;
    maxAge?: number;
  } {
    return {
      httpOnly: true,
      secure: this.isSecure(),
      sameSite: 'lax',
      path: '/api/auth/oidc',
    };
  }

  /** Build the /authorize bounce + the tx cookie payload. Null if disabled. */
  buildStart(): VidaOidcStart | null {
    const cfg = this.resolveConfig();
    if (!cfg) return null;
    const { state, verifier, challenge } = generateStateAndPkce();
    const authorizeUrl = buildAuthorizeUrl({
      authorizeUrl: cfg.authorizeUrl,
      clientId: cfg.clientId,
      redirectUri: cfg.redirectUri,
      scope: cfg.scope,
      state,
      challenge,
    });
    return {
      authorizeUrl,
      txCookieValue: encodeTx({ s: state, v: verifier }),
      txCookieMaxAgeMs: VIDA_OIDC_TX_TTL_SEC * 1000,
    };
  }

  private webappBase(): string {
    return this.configService.get<VidaOidcConfig>('vidaOidc')?.webappBaseUrl ?? '';
  }

  /** Success bounce to the webapp callback page (snake_case URL fragment). */
  successRedirect(session: VidaSessionResult): string {
    const fragment = new URLSearchParams({
      access_token: session.accessToken,
      user_id: String(session.userId),
      organization_id: session.organizationId,
      tenant_id: String(session.tenantId),
    }).toString();
    return `${this.webappBase()}/auth/oidc/callback#${fragment}`;
  }

  /** Failure bounce to the webapp login page with a machine-readable code. */
  failureRedirect(code: string): string {
    const safe = /^[a-z0-9_]+$/.test(code) ? code : 'sso_failed';
    return `${this.webappBase()}/auth/login?sso_error=${safe}`;
  }

  /**
   * Complete the callback: validate state against the tx cookie, exchange the
   * code server-to-server (client_secret_post + PKCE verifier), verify identity
   * via /userinfo, enforce the admin gate, provision the user, and mint the
   * BigCapital session. Never throws — returns a discriminated result so the
   * route renders one generic failure and logs the detail.
   */
  async completeCallback(params: {
    code: unknown;
    state: unknown;
    txCookieValue: string | undefined;
    fetchImpl?: typeof fetch;
  }): Promise<VidaCallbackResult> {
    const cfg = this.resolveConfig();
    if (!cfg) return { ok: false, error: 'not_enabled' };

    const fetchImpl = params.fetchImpl ?? fetch;

    const tx = decodeTx(params.txCookieValue);
    if (!tx) return { ok: false, error: 'invalid_tx' };
    if (!safeEqualStr(params.state, tx.s)) {
      return { ok: false, error: 'state_mismatch' };
    }
    if (
      typeof params.code !== 'string' ||
      params.code.length === 0 ||
      params.code.length > 512
    ) {
      return { ok: false, error: 'invalid_code' };
    }

    let claims: VidaOidcClaims;
    try {
      const tokenResp = await fetchImpl(cfg.tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: params.code,
          redirect_uri: cfg.redirectUri,
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          code_verifier: tx.v,
        }).toString(),
        signal: AbortSignal.timeout(10_000),
      });
      if (!tokenResp.ok) {
        this.logger.warn(`token exchange rejected: ${tokenResp.status}`);
        return { ok: false, error: 'token_exchange_failed' };
      }
      const token = (await tokenResp.json()) as TokenResponse;
      if (
        typeof token.access_token !== 'string' ||
        token.access_token.length === 0
      ) {
        return { ok: false, error: 'no_access_token' };
      }

      const userinfoResp = await fetchImpl(cfg.userinfoUrl, {
        headers: { authorization: `Bearer ${token.access_token}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!userinfoResp.ok) {
        this.logger.warn(`userinfo rejected: ${userinfoResp.status}`);
        return { ok: false, error: 'userinfo_failed' };
      }
      claims = (await userinfoResp.json()) as VidaOidcClaims;
    } catch (err) {
      this.logger.error(
        `callback network failure: ${(err as Error)?.message ?? String(err)}`,
      );
      return { ok: false, error: 'network_error' };
    }

    // Admin gate — fail closed. Vida emits `role`; absent/non-admin => deny.
    if (!isAdminClaim(claims.role)) {
      this.logger.warn(
        `admin gate denied: email=${String(claims.email)} role=${String(
          claims.role,
        )}`,
      );
      return { ok: false, error: 'not_admin' };
    }

    const identity = mapClaimsToUser(claims);
    if (!identity) return { ok: false, error: 'invalid_claims' };

    try {
      const session = await this.provisionAndMintSession(identity, cfg);
      return { ok: true, session };
    } catch (err) {
      this.logger.error(
        `provisioning failed for ${identity.email}: ${
          (err as Error)?.message ?? String(err)
        }`,
      );
      return { ok: false, error: 'provisioning_failed' };
    }
  }

  /**
   * Find-or-create the SystemUser, attach it to the single books tenant (BOTH
   * users.tenant_id AND a USER_TENANTS membership row — the #811 trap: without
   * a membership, resolveSigninTenant returns null and login 401s with
   * ORGANIZATION.INACTIVE), then mint the session by reusing the existing
   * AuthSigninService backbone (signToken + resolveSigninTenant).
   */
  private async provisionAndMintSession(
    identity: MappedUserIdentity,
    cfg: VidaOidcConfig,
  ): Promise<VidaSessionResult> {
    // Case-insensitive join on email (Vida is the SSoT for the email string;
    // this also tolerates casing drift against manually-created accounts).
    let user = await this.systemUserModel
      .query()
      .whereRaw('LOWER(??) = LOWER(?)', ['email', identity.email])
      .first();

    if (!user) {
      // SystemUser.password is non-null in practice; seed an unguessable
      // bcrypt hash so the SSO account can never be password-logged-in.
      const randomSecret = randomBytes(32).toString('hex');
      const hashed = await hashPassword(randomSecret);
      user = await this.systemUserModel.query().insertAndFetch({
        firstName: identity.firstName,
        lastName: identity.lastName,
        email: identity.email,
        password: hashed,
        active: true,
        verified: true,
        tenantId: cfg.booksTenantId,
        inviteAcceptedAt: moment().format('YYYY-MM-DD'),
      });
    } else {
      // Ensure the existing account is attached + usable for this books tenant.
      // Built as a single literal (via spreads) to avoid mutating the model's
      // readonly fields.
      const patch = {
        ...(user.tenantId !== cfg.booksTenantId
          ? { tenantId: cfg.booksTenantId }
          : {}),
        ...(!user.active ? { active: true } : {}),
        ...(!user.verified ? { verified: true } : {}),
      };
      if (Object.keys(patch).length > 0) {
        user = await this.systemUserModel
          .query()
          .patchAndFetchById(user.id, patch);
      }
    }

    if (!user) throw new Error('user provisioning returned no record');

    // Upsert the membership row (unique on user_id+tenant_id).
    const membership = await this.userTenantModel
      .query()
      .findOne({ userId: user.id, tenantId: cfg.booksTenantId });
    if (!membership) {
      try {
        await this.userTenantModel.query().insert({
          userId: user.id,
          tenantId: cfg.booksTenantId,
          role: 'owner',
        });
      } catch (err) {
        // Tolerate a concurrent insert racing the unique constraint.
        const stillMissing = !(await this.userTenantModel
          .query()
          .findOne({ userId: user.id, tenantId: cfg.booksTenantId }));
        if (stillMissing) throw err;
      }
    }

    // Mint the session on the exact backbone /signin uses.
    const tenant = await this.authSignin.resolveSigninTenant(user);
    if (!tenant) {
      throw new Error(
        `no active workspace for books tenant ${cfg.booksTenantId}`,
      );
    }

    return {
      accessToken: this.authSignin.signToken(user),
      organizationId: tenant.organizationId,
      tenantId: tenant.id,
      userId: user.id,
    };
  }
}
