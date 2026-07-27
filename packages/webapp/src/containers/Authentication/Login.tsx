// @ts-nocheck
import { Formik } from 'formik';
import { Link, useLocation } from 'react-router-dom';

import { AppToaster as Toaster, FormattedMessage as T } from '@/components';
import { AuthInsider } from '@/containers/Authentication/AuthInsider';
import { useAuthLogin } from '@/hooks/query';

import { LoginForm } from './LoginForm';
import { LoginSchema, transformLoginErrorsToToasts } from './utils';
import {
  AuthFooterLinks,
  AuthFooterLink,
  AuthInsiderCard,
} from './_components';
import { useAuthMetaBoot } from './AuthMetaBoot';
import { SsoLogin, SsoErrorCallout } from './SsoLogin';

const initialValues = {
  crediential: '',
  password: '',
  keepLoggedIn: false,
};

/**
 * Login page.
 */
export function Login() {
  const { mutateAsync: loginMutate } = useAuthLogin();
  const location = useLocation();

  // SSO failures bounce back to /auth/login?sso_error=<code> (query string, set
  // by the OIDC callback / server). Surface it as a danger callout on the form.
  const ssoError = new URLSearchParams(location.search).get('sso_error');

  const handleSubmit = (values, { setSubmitting }) => {
    loginMutate({
      email: values.crediential,
      password: values.password,
    }).catch((response) => {
      const { data: error } = response;
      const toastMessages = transformLoginErrorsToToasts(error);

      toastMessages.forEach((toastMessage) => {
        Toaster.show(toastMessage);
      });
      setSubmitting(false);
    });
  };

  return (
    <AuthInsider>
      <AuthInsiderCard>
        <SsoErrorCallout code={ssoError} />

        <Formik
          initialValues={initialValues}
          validationSchema={LoginSchema}
          onSubmit={handleSubmit}
          component={LoginForm}
        />

        <SsoLogin />
      </AuthInsiderCard>

      <LoginFooterLinks />
    </AuthInsider>
  );
}

function LoginFooterLinks() {
  const { signupDisabled } = useAuthMetaBoot();

  return (
    <AuthFooterLinks>
      {!signupDisabled && (
        <AuthFooterLink>
          <T id={'dont_have_an_account'} />{' '}
          <Link to={'/auth/register'}>
            <T id={'sign_up'} />
          </Link>
        </AuthFooterLink>
      )}
      <AuthFooterLink>
        <Link to={'/auth/send_reset_password'}>
          <T id={'forgot_my_password'} />
        </Link>
      </AuthFooterLink>
    </AuthFooterLinks>
  );
}
