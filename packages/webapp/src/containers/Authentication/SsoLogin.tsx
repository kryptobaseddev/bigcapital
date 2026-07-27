// @ts-nocheck
import React from 'react';
import styled from 'styled-components';
import { AnchorButton, Callout, Intent } from '@blueprintjs/core';
import { useAuthMetaBoot } from './AuthMetaBoot';

/**
 * Server endpoint that begins the "Sign in with Vida" OIDC redirect flow.
 * It is reached with a top-level browser navigation (never fetch/XHR): the
 * server responds with a 302 to the Vida identity provider and, on success,
 * 302s back to `/auth/oidc/callback` with the session in the URL fragment.
 */
const SSO_START_URL = '/api/auth/oidc/vida/start';

/**
 * "Sign in with Vida" SSO entry point rendered under the login form.
 *
 * Gating: rendered unless auth metadata explicitly reports `sso_enabled: false`.
 * The current server meta does not carry the flag, so the button renders by
 * default and the server owns the unconfigured case (its start endpoint 404s /
 * redirects). If the server later adds `sso_enabled: false` the button hides
 * with no webapp change.
 */
export function SsoLogin() {
  const { ssoEnabled } = useAuthMetaBoot() ?? {};

  if (ssoEnabled === false) {
    return null;
  }

  return (
    <SsoRoot>
      <OrDivider>
        <span>or</span>
      </OrDivider>

      {/*
        AnchorButton renders a real <a href>, so clicking performs a plain
        top-level navigation to the server's OIDC start endpoint — this is a
        redirect flow, not a fetch/XHR. In dev the Vite proxy forwards /api to
        the API server; in production the same Express service serves both.
      */}
      <AnchorButton href={SSO_START_URL} fill large outlined>
        Sign in with Vida
      </AnchorButton>
    </SsoRoot>
  );
}

/**
 * Danger callout surfaced on the login page when the OIDC server bounced the
 * user back with `?sso_error=<code>`. Renders nothing when there is no code.
 */
export function SsoErrorCallout({ code }: { code?: string | null }) {
  if (!code) {
    return null;
  }

  return (
    <SsoErrorRoot>
      <Callout intent={Intent.DANGER}>{ssoErrorMessage(code)}</Callout>
    </SsoErrorRoot>
  );
}

/**
 * Maps a known `sso_error` code to a human-friendly message, falling back to a
 * generic message that still surfaces the raw code for support.
 */
function ssoErrorMessage(code: string): string {
  switch (code) {
    case 'access_denied':
      return 'Sign in with Vida was cancelled or denied. You can try again or sign in with your email and password.';
    case 'account_not_found':
      return 'No Bigcapital account is linked to that Vida identity. Please sign in with your email and password.';
    case 'missing_token':
    case 'invalid_token':
      return 'Sign in with Vida did not complete. Please try again or sign in with your email and password.';
    case 'server_error':
      return 'Sign in with Vida failed due to a server error. Please try again in a moment.';
    default:
      return `Sign in with Vida failed (${code}). Please try again or sign in with your email and password.`;
  }
}

const SsoRoot = styled.div`
  margin-top: 18px;
`;

const SsoErrorRoot = styled.div`
  margin-bottom: 16px;
`;

const OrDivider = styled.div`
  --x-color-line: #e0e0e0;
  --x-color-text: #8a8a8a;

  .bp4-dark & {
    --x-color-line: rgba(255, 255, 255, 0.15);
    --x-color-text: rgba(255, 255, 255, 0.55);
  }

  display: flex;
  align-items: center;
  text-align: center;
  color: var(--x-color-text);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin: 4px 0 16px;

  &::before,
  &::after {
    content: '';
    flex: 1 1 auto;
    border-bottom: 1px solid var(--x-color-line);
  }

  span {
    padding: 0 12px;
  }
`;
