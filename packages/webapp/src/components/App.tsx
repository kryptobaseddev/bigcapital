// @ts-nocheck
import { lazy, Suspense } from 'react';
import { Router, Switch, Route } from 'react-router';
import { createBrowserHistory } from 'history';
import {
  QueryClientProvider,
  QueryClient,
  QueryCache,
  MutationCache,
} from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { maybeHandleUnauthorized } from '@/services/session';

import '@/style/App.scss';

import AppIntlLoader from './AppIntlLoader';
import { EnsureAuthenticated } from '@/components/Guards/EnsureAuthenticated';
import { GlobalErrors } from '@/containers/GlobalErrors/GlobalErrors';
import { SplashScreen, DashboardThemeProvider } from '../components';
import { EnsureUserEmailNotVerified } from './Guards/EnsureUserEmailNotVerified';
import { queryConfig } from '../hooks/query/base';

const DashboardPrivatePages = lazy(
  () => import('@/components/Dashboard/PrivatePages'),
);
const AuthenticationPage = lazy(() =>
  import('@/containers/Authentication/AuthenticationPage').then((m) => ({
    default: m.AuthenticationPage,
  })),
);
const EmailConfirmation = lazy(() =>
  import('@/containers/Authentication/EmailConfirmation').then((m) => ({
    default: m.EmailConfirmation,
  })),
);
const RegisterVerify = lazy(() =>
  import('@/containers/Authentication/RegisterVerify').then((m) => ({
    default: m.RegisterVerify,
  })),
);
const OneClickDemoPage = lazy(() =>
  import('@/containers/OneClickDemo/OneClickDemoPage').then((m) => ({
    default: m.OneClickDemoPage,
  })),
);
const PaymentPortalPage = lazy(() =>
  import('@/containers/PaymentPortal/PaymentPortalPage').then((m) => ({
    default: m.PaymentPortalPage,
  })),
);

/**
 * App inner.
 */
function AppInsider({ history }) {
  return (
    <div className="App">
      <DashboardThemeProvider>
        <Suspense fallback={'Loading...'}>
          <Router history={history}>
            <Switch>
              <Route path={'/one_click_demo'} children={<OneClickDemoPage />} />
              <Route path={'/auth/register/verify'}>
                <EnsureAuthenticated>
                  <EnsureUserEmailNotVerified>
                    <RegisterVerify />
                  </EnsureUserEmailNotVerified>
                </EnsureAuthenticated>
              </Route>

              <Route
                path={'/auth/email_confirmation'}
                children={<EmailConfirmation />}
              />
              <Route path={'/auth'} children={<AuthenticationPage />} />
              <Route
                path={'/payment/:linkId'}
                children={<PaymentPortalPage />}
              />
              <Route path={'/'} children={<DashboardPrivatePages />} />
            </Switch>
          </Router>
        </Suspense>

        <GlobalErrors />
      </DashboardThemeProvider>
    </div>
  );
}

/**
 * Query client (module-level so it survives App re-renders). A global 401
 * handler on both the query and mutation caches catches an expired/invalid
 * session from EVERY data layer — including the sdk-ts fetch layer
 * (fetchSubscriptions, fetchOrganizationCurrent, …) that has no interceptor of
 * its own — and drops the user to the login page instead of looping on 401s in
 * a broken dashboard.
 */
const queryClient = new QueryClient({
  ...queryConfig,
  queryCache: new QueryCache({ onError: maybeHandleUnauthorized }),
  mutationCache: new MutationCache({ onError: maybeHandleUnauthorized }),
});

/**
 * Core application.
 */
export default function App() {
  // Browser history.
  const history = createBrowserHistory();

  return (
    <QueryClientProvider client={queryClient}>
      <SplashScreen />

      <AppIntlLoader>
        <AppInsider history={history} />
      </AppIntlLoader>

      <ReactQueryDevtools initialIsOpen />
    </QueryClientProvider>
  );
}
