// @ts-nocheck
import { removeCookie } from '@/utils';

/**
 * Session-expiry / unauthorized handling — single source of truth.
 *
 * The webapp talks to the API through several layers (the default axios `http`
 * instance in ./axios, the per-hook axios instance in hooks/useRequest, and the
 * sdk-ts `createApiFetcher` built on openapi-typescript-fetch). Each surfaces a
 * 401 differently, and historically none of them (except one axios instance)
 * actually recovered from it — a stale/expired auth cookie left the app booting
 * into the private dashboard, every request 401'd, and the login screen never
 * showed. These helpers give every layer one consistent recovery path.
 */

/**
 * Extracts the HTTP status from an error regardless of the client that threw it:
 *   - axios       → error.response.status
 *   - sdk-ts / openapi-typescript-fetch ApiError → error.status
 */
export function getErrorStatus(error: unknown): number | undefined {
  const anyErr = error as any;
  return anyErr?.response?.status ?? anyErr?.status;
}

/**
 * The auth cookies are the source of truth the store re-reads on boot (see
 * authentication.reducer initialState). Removing them makes `isAuthenticated`
 * false after the redirect so the login page renders.
 */
export function clearAuthCookies(): void {
  removeCookie('token');
  removeCookie('organization_id');
  removeCookie('tenant_id');
  removeCookie('authenticated_user_id');
}

/**
 * Recover from an unauthorized session: clear the stale cookies and send the
 * user to the login page (where they can sign in again — including "Sign in
 * with Vida" — or switch accounts). No-op while already inside the /auth/*
 * flow, which owns its own login-error UX, so this never loops.
 */
export function handleUnauthorized(): void {
  if (typeof window === 'undefined') return;
  const path = window.location.pathname || '';
  if (path.startsWith('/auth')) return;
  clearAuthCookies();
  window.location.assign('/auth/login?session_expired=1');
}

/** React Query cache onError / axios interceptor helper: act only on 401s. */
export function maybeHandleUnauthorized(error: unknown): void {
  if (getErrorStatus(error) === 401) {
    handleUnauthorized();
  }
}
