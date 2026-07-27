import { createHash } from 'node:crypto';
import {
  buildAuthorizeUrl,
  decodeTx,
  encodeTx,
  generateStateAndPkce,
  isAdminClaim,
  mapClaimsToUser,
  parseCookieHeader,
  safeEqualStr,
  VidaOidcTx,
} from './vida-oidc.core';

describe('vida-oidc.core', () => {
  describe('generateStateAndPkce', () => {
    it('produces a 128-bit hex state and an S256 challenge of the verifier', () => {
      const { state, verifier, challenge } = generateStateAndPkce();
      expect(state).toMatch(/^[0-9a-f]{32}$/);
      // verifier is base64url of 32 random bytes (>= 43 chars, no padding)
      expect(verifier.length).toBeGreaterThanOrEqual(43);
      expect(verifier).not.toContain('=');
      const expected = createHash('sha256')
        .update(verifier)
        .digest('base64url');
      expect(challenge).toBe(expected);
    });

    it('is unique per call', () => {
      const a = generateStateAndPkce();
      const b = generateStateAndPkce();
      expect(a.state).not.toBe(b.state);
      expect(a.verifier).not.toBe(b.verifier);
    });
  });

  describe('encodeTx / decodeTx', () => {
    it('round-trips a valid tx', () => {
      const { state, verifier } = generateStateAndPkce();
      const tx: VidaOidcTx = { s: state, v: verifier };
      const decoded = decodeTx(encodeTx(tx));
      expect(decoded).toEqual(tx);
    });

    it('rejects empty / undefined / garbage', () => {
      expect(decodeTx(undefined)).toBeNull();
      expect(decodeTx(null)).toBeNull();
      expect(decodeTx('')).toBeNull();
      expect(decodeTx('not-base64url-json')).toBeNull();
    });

    it('rejects a malformed state', () => {
      const bad = encodeTx({ s: 'xyz', v: 'a'.repeat(43) });
      expect(decodeTx(bad)).toBeNull();
    });

    it('rejects a too-short verifier', () => {
      const bad = encodeTx({ s: '0'.repeat(32), v: 'short' });
      expect(decodeTx(bad)).toBeNull();
    });
  });

  describe('safeEqualStr', () => {
    it('true only for equal strings', () => {
      expect(safeEqualStr('abc', 'abc')).toBe(true);
      expect(safeEqualStr('abc', 'abd')).toBe(false);
      expect(safeEqualStr('abc', 'abcd')).toBe(false);
    });

    it('false for non-strings', () => {
      expect(safeEqualStr(undefined, 'abc')).toBe(false);
      expect(safeEqualStr('abc', null)).toBe(false);
      expect(safeEqualStr(123 as unknown, '123')).toBe(false);
    });
  });

  describe('buildAuthorizeUrl', () => {
    it('sets all required PKCE authorization-code params', () => {
      const url = new URL(
        buildAuthorizeUrl({
          authorizeUrl: 'https://vidapeps.com/api/auth/oauth2/authorize',
          clientId: 'books-client',
          redirectUri: 'https://books.vidapeps.com/api/auth/oidc/vida/callback',
          scope: 'openid profile email',
          state: 'abc',
          challenge: 'chal',
        }),
      );
      expect(url.origin + url.pathname).toBe(
        'https://vidapeps.com/api/auth/oauth2/authorize',
      );
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('client_id')).toBe('books-client');
      expect(url.searchParams.get('redirect_uri')).toBe(
        'https://books.vidapeps.com/api/auth/oidc/vida/callback',
      );
      expect(url.searchParams.get('scope')).toBe('openid profile email');
      expect(url.searchParams.get('state')).toBe('abc');
      expect(url.searchParams.get('code_challenge')).toBe('chal');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    });
  });

  describe('isAdminClaim (fail-closed admin gate)', () => {
    it('accepts only the admin role', () => {
      expect(isAdminClaim('admin')).toBe(true);
      expect(isAdminClaim('ADMIN')).toBe(true);
      expect(isAdminClaim(' Admin ')).toBe(true);
    });

    it('denies everything else, including missing role', () => {
      expect(isAdminClaim('user')).toBe(false);
      expect(isAdminClaim('customer')).toBe(false);
      expect(isAdminClaim('')).toBe(false);
      expect(isAdminClaim(undefined)).toBe(false);
      expect(isAdminClaim(null)).toBe(false);
      expect(isAdminClaim(1)).toBe(false);
      expect(isAdminClaim(true)).toBe(false);
    });
  });

  describe('mapClaimsToUser', () => {
    it('prefers given_name / family_name', () => {
      expect(
        mapClaimsToUser({
          email: 'ada@vidapeps.com',
          given_name: 'Ada',
          family_name: 'Lovelace',
        }),
      ).toEqual({
        email: 'ada@vidapeps.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
      });
    });

    it('splits the full name when given/family absent', () => {
      expect(
        mapClaimsToUser({ email: 'grace@vidapeps.com', name: 'Grace Hopper' }),
      ).toEqual({
        email: 'grace@vidapeps.com',
        firstName: 'Grace',
        lastName: 'Hopper',
      });
    });

    it('falls back to email local-part for firstName', () => {
      expect(mapClaimsToUser({ email: 'owner@vidapeps.com' })).toEqual({
        email: 'owner@vidapeps.com',
        firstName: 'owner',
        lastName: '',
      });
    });

    it('returns null without a usable email', () => {
      expect(mapClaimsToUser({})).toBeNull();
      expect(mapClaimsToUser({ email: 'not-an-email' })).toBeNull();
      expect(mapClaimsToUser({ email: 123 })).toBeNull();
    });
  });

  describe('parseCookieHeader', () => {
    it('parses a multi-cookie header', () => {
      const parsed = parseCookieHeader('a=1; vida_oidc_tx=abc.def; b=2');
      expect(parsed['vida_oidc_tx']).toBe('abc.def');
      expect(parsed['a']).toBe('1');
      expect(parsed['b']).toBe('2');
    });

    it('handles empty / undefined', () => {
      expect(parseCookieHeader(undefined)).toEqual({});
      expect(parseCookieHeader('')).toEqual({});
    });
  });
});
