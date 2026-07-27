import { registerAs } from '@nestjs/config';

/**
 * "Sign in with Vida" OIDC relying-party config.
 *
 * The RP is feature-gated: when VIDA_OIDC_CLIENT_ID / VIDA_OIDC_CLIENT_SECRET
 * (or a valid VIDA_BOOKS_TENANT_ID) are absent the routes redirect with an
 * error instead of activating (see VidaOidcService.resolveConfig).
 *
 * authorize / token / userinfo endpoints are derived from the issuer
 * (`${issuer}/oauth2/{authorize,token,userinfo}`) but each can be overridden
 * explicitly. Vida's /token id_token mint is disabled, so identity is always
 * verified via /userinfo — never a returned id_token.
 */
const trimTrailingSlash = (u: string): string => u.replace(/\/+$/, '');

export default registerAs('vidaOidc', () => {
  const issuer = trimTrailingSlash(
    process.env.VIDA_OIDC_ISSUER || 'https://vidapeps.com/api/auth',
  );

  const booksTenantIdRaw = process.env.VIDA_BOOKS_TENANT_ID;
  const booksTenantId = booksTenantIdRaw
    ? Number.parseInt(booksTenantIdRaw, 10)
    : Number.NaN;

  return {
    issuer,
    clientId: process.env.VIDA_OIDC_CLIENT_ID || '',
    clientSecret: process.env.VIDA_OIDC_CLIENT_SECRET || '',
    redirectUri:
      process.env.VIDA_OIDC_REDIRECT_URL ||
      'https://books.vidapeps.com/api/auth/oidc/vida/callback',
    authorizeUrl:
      process.env.VIDA_OIDC_AUTHORIZE_URL || `${issuer}/oauth2/authorize`,
    tokenUrl: process.env.VIDA_OIDC_TOKEN_URL || `${issuer}/oauth2/token`,
    userinfoUrl:
      process.env.VIDA_OIDC_USERINFO_URL || `${issuer}/oauth2/userinfo`,
    scope: process.env.VIDA_OIDC_SCOPE || 'openid profile email',
    booksTenantId: Number.isInteger(booksTenantId) ? booksTenantId : 0,
    // Base URL for the webapp callback/login redirects. Empty => same-origin
    // relative paths (books.vidapeps.com serves both API and webapp).
    webappBaseUrl: trimTrailingSlash(process.env.VIDA_OIDC_WEBAPP_URL || ''),
  };
});
