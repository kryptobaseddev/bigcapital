// @ts-nocheck
import React from 'react';
import axios from 'axios';
import { createApiFetcher } from '@bigcapital/sdk-ts';
import {
  useAuthActions,
  useAuthOrganizationId,
  useSetGlobalErrors,
  useAuthToken,
} from './state';
import { getCookie, normalizeApiPath } from '../utils';

export default function useApiRequest() {
  const setGlobalErrors = useSetGlobalErrors();
  const { setLogout } = useAuthActions();
  const currentLocale = getCookie('locale');

  // Authentication token.
  const token = useAuthToken();

  // Authentication organization id.
  const organizationId = useAuthOrganizationId();

  const http = React.useMemo(() => {
    // Axios instance.
    const instance = axios.create();

    // Request interceptors.
    instance.interceptors.request.use(
      (request) => {
        const locale = currentLocale;

        if (token) {
          request.headers['Authorization'] = `Bearer ${token}`;
        }
        if (organizationId) {
          request.headers['organization-id'] = organizationId;
        }
        if (locale) {
          request.headers['Accept-Language'] = locale;
        }
        return request;
      },
      (error) => {
        return Promise.reject(error);
      },
    );
    // Response interceptors.
    instance.interceptors.response.use(
      (response) => response,
      (error) => {
        // Network / CORS / aborted requests have no `response`; bail rather than
        // throwing a TypeError that masks the underlying error.
        if (!error?.response) {
          return Promise.reject(error);
        }
        const { status, data } = error.response;

        if (status >= 500) {
          setGlobalErrors({ something_wrong: true });
        }
        if (status === 401) {
          setGlobalErrors({ session_expired: true });
          setLogout();
        }
        if (status === 403) {
          setGlobalErrors({ access_denied: { message: data.message } });
        }
        if (status === 429) {
          setGlobalErrors({ too_many_requests: true });
        }
        if (status === 400) {
          const lockedError = data.errors.find(
            (error) => error.type === 'TRANSACTIONS_DATE_LOCKED',
          );
          if (lockedError) {
            setGlobalErrors({ transactionsLocked: { ...lockedError.payload } });
          }
          if (
            data.errors.find(
              (e) => e.type === 'ORGANIZATION.SUBSCRIPTION.INACTIVE',
            )
          ) {
            setGlobalErrors({ subscriptionInactive: true });
          }
          if (data.errors.find((e) => e.type === 'USER_INACTIVE')) {
            setGlobalErrors({ userInactive: true });
            setLogout();
          }
        }
        return Promise.reject(error);
      },
    );
    return instance;
  }, [token, organizationId, setGlobalErrors, setLogout]);

  return React.useMemo(
    () => ({
      http,

      get(resource, params) {
        return http.get(`/api/${normalizeApiPath(resource)}`, params);
      },

      post(resource, params, config) {
        return http.post(`/api/${normalizeApiPath(resource)}`, params, config);
      },

      update(resource, slug, params) {
        return http.put(`/api/${normalizeApiPath(resource)}/${slug}`, params);
      },

      put(resource, params) {
        return http.put(`/api/${normalizeApiPath(resource)}`, params);
      },

      patch(resource, params, config) {
        return http.patch(`/api/${normalizeApiPath(resource)}`, params, config);
      },

      delete(resource, params) {
        return http.delete(`/api/${normalizeApiPath(resource)}`, params);
      },
    }),
    [http],
  );
}

/**
 * Returns an ApiFetcher configured with baseUrl and auth headers for use with sdk-ts fetch functions.
 * Use this in query hooks that call fetchAccounts, fetchCreditNotes, etc.
 *
 * @param options - Optional configuration
 * @param options.enableCamelCaseTransform - If true, automatically transforms response data from snake_case to camelCase
 */
export function useApiFetcher(options?: {
  enableCamelCaseTransform?: boolean;
}) {
  const token = useAuthToken();
  const organizationId = useAuthOrganizationId();
  const currentLocale = getCookie('locale');

  return React.useMemo(() => {
    const headers: Record<string, string> = {
      accept: 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    if (organizationId) {
      headers['organization-id'] = organizationId;
    }
    if (currentLocale) {
      headers['Accept-Language'] = currentLocale;
    }
    return createApiFetcher({
      baseUrl: '',
      init: { headers },
      disableCamelCaseTransform: !options?.enableCamelCaseTransform,
    });
  }, [token, organizationId, currentLocale, options?.enableCamelCaseTransform]);
}

/**
 * Returns an unauthenticated ApiFetcher for auth flows (signin, signup, reset password, etc.).
 */
export function useAuthApiFetcher() {
  return React.useMemo(() => createApiFetcher({ baseUrl: '' }), []);
}

export function useAuthApiRequest() {
  const http = React.useMemo(() => {
    // Axios instance.
    return axios.create();
  }, []);

  return React.useMemo(
    () => ({
      http,
      get(resource, params) {
        return http.get(`/api/${normalizeApiPath(resource)}`, params);
      },
      post(resource, params, config) {
        return http.post(`/api/${normalizeApiPath(resource)}`, params, config);
      },
      update(resource, slug, params) {
        return http.put(`/api/${normalizeApiPath(resource)}/${slug}`, params);
      },
      put(resource, params) {
        return http.put(`/api/${normalizeApiPath(resource)}`, params);
      },
      patch(resource, params, config) {
        return http.patch(`/api/${normalizeApiPath(resource)}`, params, config);
      },
      delete(resource, params) {
        return http.delete(`/api/${normalizeApiPath(resource)}`, params);
      },
    }),
    [http],
  );
}
