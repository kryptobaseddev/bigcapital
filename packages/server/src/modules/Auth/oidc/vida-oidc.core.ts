import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Pure, framework-free primitives for the "Sign in with Vida" OIDC relying
 * party. Ported almost verbatim from Vida's own first-party RP
 * (apps/api-server/src/lib/hub-oidc.ts): standard authorization-code + PKCE
 * (S256) flow against Vida's IdP (the better-auth oauthProvider on
 * vidapeps.com), with the anti-CSRF state + PKCE verifier sealed into a
 * short-lived httpOnly transaction cookie.
 *
 * Everything here is deterministic (given the crypto RNG) and has zero NestJS
 * / Objection dependencies so it can be unit-tested in isolation. The
 * Nest-aware orchestration (config, HTTP exchange, provisioning, session mint)
 * lives in VidaOidc.service.ts.
 */

/** Host-scoped transaction cookie holding {state, PKCE verifier}. */
export const VIDA_OIDC_TX_COOKIE = 'vida_oidc_tx';

/** Transaction cookie lifetime — the user has this long to complete /authorize. */
export const VIDA_OIDC_TX_TTL_SEC = 10 * 60;

/**
 * Claims we consume from Vida's /userinfo. `sub` is numeric on Vida's side but
 * we deliberately DO NOT key on it — BigCapital users are joined on `email`
 * (see VidaOidc.service.ts). `role` drives the fail-closed admin gate.
 */
export interface VidaOidcClaims {
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
  given_name?: unknown;
  family_name?: unknown;
  role?: unknown;
}

/** Contents of the tx cookie. `s` = state (128-bit hex), `v` = PKCE verifier. */
export interface VidaOidcTx {
  s: string;
  v: string;
}

export interface StateAndPkce {
  state: string;
  verifier: string;
  challenge: string;
}

/** Fresh anti-CSRF state + PKCE verifier/challenge (RFC 7636, S256). */
export function generateStateAndPkce(): StateAndPkce {
  const state = randomBytes(16).toString('hex');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { state, verifier, challenge };
}

export function encodeTx(tx: VidaOidcTx): string {
  return Buffer.from(JSON.stringify(tx), 'utf8').toString('base64url');
}

export function decodeTx(raw: string | undefined | null): VidaOidcTx | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    ) as Partial<VidaOidcTx>;
    if (typeof parsed.s !== 'string' || !/^[0-9a-f]{32}$/.test(parsed.s)) {
      return null;
    }
    if (typeof parsed.v !== 'string' || parsed.v.length < 43) return null;
    return { s: parsed.s, v: parsed.v };
  } catch {
    return null;
  }
}

/** Constant-time string compare used for the state (login-CSRF) check. */
export function safeEqualStr(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

export interface AuthorizeUrlParams {
  authorizeUrl: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  challenge: string;
}

/** Build the /authorize bounce URL with response_type=code + PKCE S256. */
export function buildAuthorizeUrl(params: AuthorizeUrlParams): string {
  const url = new URL(params.authorizeUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('scope', params.scope);
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

/**
 * Admin gate. Fail-closed: only the exact `admin` role (case-insensitive)
 * passes. A missing/unknown/empty role is treated as non-admin and denied.
 */
export function isAdminClaim(role: unknown): boolean {
  return typeof role === 'string' && role.trim().toLowerCase() === 'admin';
}

export interface MappedUserIdentity {
  email: string;
  firstName: string;
  lastName: string;
}

/**
 * Map Vida userinfo claims onto BigCapital's SystemUser identity fields.
 * Returns null when there is no usable email (we join on email, so it is
 * mandatory). Name derivation: given/family_name first, else split `name`,
 * else fall back to the email local-part for firstName.
 */
export function mapClaimsToUser(
  claims: VidaOidcClaims,
): MappedUserIdentity | null {
  const email =
    typeof claims.email === 'string' ? claims.email.trim() : '';
  if (!email || !email.includes('@')) return null;

  const given =
    typeof claims.given_name === 'string' ? claims.given_name.trim() : '';
  const family =
    typeof claims.family_name === 'string' ? claims.family_name.trim() : '';
  const fullName = typeof claims.name === 'string' ? claims.name.trim() : '';

  let firstName = given;
  let lastName = family;

  if (!firstName && fullName) {
    const parts = fullName.split(/\s+/);
    firstName = parts[0] ?? '';
    if (!lastName) lastName = parts.slice(1).join(' ');
  }
  if (!firstName) firstName = email.split('@')[0];
  if (!lastName) lastName = '';

  return { email, firstName, lastName };
}

/**
 * Minimal Cookie-header parser. The server does not mount cookie-parser, and
 * we only ever need to read our own base64url tx cookie, so this avoids adding
 * a global middleware dependency (keeps the change confined to this module).
 */
export function parseCookieHeader(
  header: string | undefined | null,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    const val = part.slice(idx + 1).trim();
    try {
      out[key] = decodeURIComponent(val);
    } catch {
      out[key] = val;
    }
  }
  return out;
}
