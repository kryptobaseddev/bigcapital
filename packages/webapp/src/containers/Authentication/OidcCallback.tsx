// @ts-nocheck
import React, { useEffect } from 'react';
import { useHistory } from 'react-router-dom';
import { Spinner } from '@blueprintjs/core';
import styled from 'styled-components';

import { setAuthLoginCookies } from '@/hooks/query';

/**
 * OIDC SSO callback landing page (`/auth/oidc/callback`).
 *
 * On a successful "Sign in with Vida" round-trip the server 302s the browser
 * here with the session in the URL FRAGMENT (never the query string, so the
 * access token is not sent to the server, logged, or leaked via Referer):
 *
 *   /auth/oidc/callback#access_token=<jwt>&user_id=<id>&organization_id=<org>&tenant_id=<tid>
 *
 * On failure it 302s here-or-to-login with `sso_error=<code>`.
 *
 * This page reuses the exact same session-persistence path as password login —
 * `setAuthLoginCookies(...)` writes the `token` / `authenticated_user_id` /
 * `organization_id` / `tenant_id` cookies that the authentication reducer reads
 * on boot. We then hard-navigate to `/` so the app re-boots cleanly with those
 * cookies present (the reducer's initialState is seeded from them), which is the
 * most robust equivalent of `useAuthLogin.onSuccess` for a redirect landing.
 */
export function OidcCallback() {
  const history = useHistory();

  useEffect(() => {
    // Read strictly from the URL FRAGMENT — never the query string.
    const rawHash = window.location.hash || '';
    const fragment = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash;
    const params = new URLSearchParams(fragment);

    const ssoError = params.get('sso_error');
    const accessToken = params.get('access_token');
    const userId = params.get('user_id');
    const organizationId = params.get('organization_id');
    const tenantId = params.get('tenant_id');

    // Failure (explicit error) or malformed success (no token) -> back to login
    // with the error code so the login page can surface it. Reuse SPA nav here;
    // no session was established.
    if (ssoError || !accessToken) {
      const code = ssoError || 'missing_token';
      history.replace(`/auth/login?sso_error=${encodeURIComponent(code)}`);
      return;
    }

    // Success: persist the session via the same cookies the reducer boots from.
    // Field names match `AuthSigninResponse` as consumed by setAuthLoginCookies.
    setAuthLoginCookies({
      access_token: accessToken,
      user_id: userId,
      organization_id: organizationId,
      tenant_id: tenantId,
    });

    // Hard replace so the app re-initializes authenticated from the cookies and
    // the token fragment is dropped from history (not retained/back-navigable).
    window.location.replace('/');
  }, [history]);

  return (
    <CallbackRoot>
      <Spinner size={30} />
    </CallbackRoot>
  );
}

const CallbackRoot = styled.div`
  display: flex;
  justify-content: center;
  margin-top: 5rem;
`;
