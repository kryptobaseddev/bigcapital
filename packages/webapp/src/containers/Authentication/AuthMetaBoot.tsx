// @ts-nocheck
import React, { createContext } from 'react';
import { useAuthMetadata } from '@/hooks/query';
import { Spinner } from '@blueprintjs/core';
import styled from 'styled-components';

const AuthMetaBootContext = createContext();

/**
 * Boots the authentication page metadata.
 */
function AuthMetaBootProvider({ ...props }) {
  const { isLoading: isAuthMetaLoading, data: authMeta } = useAuthMetadata();

  const state = {
    isAuthMetaLoading,
    signupDisabled: authMeta?.meta?.signup_disabled,
    // Optional SSO gate. Undefined today (server meta does not carry the flag),
    // which the "Sign in with Vida" button treats as "render". Only an explicit
    // `false` hides it — forward-compatible with a future server opt-out.
    ssoEnabled: authMeta?.meta?.sso_enabled,
  };

  if (isAuthMetaLoading) {
    return (
      <SpinnerRoot>
        <Spinner size={30} value={null} />
      </SpinnerRoot>
    );
  }
  return <AuthMetaBootContext.Provider value={state} {...props} />;
}

const useAuthMetaBoot = () => React.useContext(AuthMetaBootContext);

export { AuthMetaBootContext, AuthMetaBootProvider, useAuthMetaBoot };

const SpinnerRoot = styled.div`
  margin-top: 5rem;
`;
