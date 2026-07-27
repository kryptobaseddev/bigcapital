import { Request, Response } from 'express';
import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiExcludeController } from '@nestjs/swagger';
import { PublicRoute } from '../guards/jwt.guard';
import { VidaOidcService } from './VidaOidc.service';
import { VIDA_OIDC_TX_COOKIE, parseCookieHeader } from './vida-oidc.core';

/**
 * "Sign in with Vida" OIDC relying-party endpoints.
 *
 * `@PublicRoute()` bypasses the three global guards (JwtAuthGuard via
 * MixedAuthGuard, EnsureUserVerifiedGuard, TenancyGlobalGuard) — all three
 * honour IS_PUBLIC_ROUTE — so these routes run unauthenticated with no
 * organization-id header. Both handlers use `@Res()` (library-specific mode)
 * to issue 302 redirects and set/clear the tx cookie directly.
 */
@Controller('/auth/oidc')
@PublicRoute()
@ApiExcludeController()
@Throttle({ auth: {} })
export class VidaOidcController {
  constructor(private readonly vidaOidc: VidaOidcService) {}

  /**
   * GET /api/auth/oidc/vida/start
   * Generate state + PKCE, seal into the httpOnly tx cookie, 302 to Vida's
   * /authorize. Redirects to the login page with an error when disabled.
   */
  @Get('/vida/start')
  start(@Res() res: Response): void {
    const start = this.vidaOidc.buildStart();
    if (!start) {
      res.redirect(302, this.vidaOidc.failureRedirect('not_enabled'));
      return;
    }
    res.cookie(VIDA_OIDC_TX_COOKIE, start.txCookieValue, {
      ...this.vidaOidc.cookieOptions(),
      maxAge: start.txCookieMaxAgeMs,
    });
    res.redirect(302, start.authorizeUrl);
  }

  /**
   * GET /api/auth/oidc/vida/callback?code&state
   * Validate state vs the tx cookie, exchange the code, verify via /userinfo,
   * enforce the admin gate, provision + mint the session, and 302 to the
   * webapp callback (session in the URL fragment). Any failure 302s to the
   * login page with sso_error. The tx cookie is always cleared.
   */
  @Get('/vida/callback')
  async callback(
    @Req() req: Request,
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ): Promise<void> {
    const cookies = parseCookieHeader(req.headers.cookie);
    const txCookieValue = cookies[VIDA_OIDC_TX_COOKIE];

    // Clear the single-use tx cookie regardless of outcome.
    res.clearCookie(VIDA_OIDC_TX_COOKIE, this.vidaOidc.cookieOptions());

    // Provider-side error (user denied, etc.).
    if (error) {
      res.redirect(302, this.vidaOidc.failureRedirect('provider_error'));
      return;
    }

    const result = await this.vidaOidc.completeCallback({
      code,
      state,
      txCookieValue,
    });

    if (!result.ok || !result.session) {
      res.redirect(
        302,
        this.vidaOidc.failureRedirect(result.error ?? 'sso_failed'),
      );
      return;
    }
    res.redirect(302, this.vidaOidc.successRedirect(result.session));
  }
}
