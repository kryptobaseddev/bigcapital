// @ts-nocheck
import axios from 'axios';
import { store } from '@/store/create-store';
import { maybeHandleUnauthorized } from '@/services/session';

const http = axios.create();

http.interceptors.request.use(
  (request) => {
    const state = store.getState();
    const { token, organization } = state.authentication;
    const locale = state.authentication?.locale || 'en';

    if (token) {
      request.headers.common['x-access-token'] = token;
    }
    if (organization) {
      request.headers.common['organization-id'] = organization;
    }
    // Use the user's actual locale for API responses. (Previously this line
    // unconditionally forced 'ar', overriding the locale set just above.)
    request.headers.common['Accept-Language'] = locale;

    return request;
  },
  (error) => {
    return Promise.reject(error);
  },
);

http.interceptors.response.use(
  (response) => response,
  (error) => {
    // Network / CORS / aborted requests have no `response` — never destructure
    // it blindly (the previous `const { status } = error.response` threw here,
    // masking the real error). On 401 clear the stale session and drop to login
    // (see @/services/session). The global React Query handler in App.tsx does
    // the same for the sdk-ts fetch layer, so every client recovers the same way.
    maybeHandleUnauthorized(error);
    return Promise.reject(error);
  },
);

export default http;
