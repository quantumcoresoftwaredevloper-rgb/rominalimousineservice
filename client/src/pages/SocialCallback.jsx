import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { tokenStore } from '../services/api.js';
import { Spinner } from '../components/ui/Spinner.jsx';
import { Button } from '../components/ui/Button.jsx';
import AuthLayout from '../components/auth/AuthLayout.jsx';

// Landing page for the OAuth callback.
//
// The server redirects here with a single-use `code`, not with tokens. We POST
// that code to /api/auth/social/exchange and receive the tokens in a response
// body. Tokens in a URL land in browser history, proxy access logs and Referer
// headers on any outbound link; over POST they touch none of those.
//
// We also strip the query string before anything else, so the code never
// survives in history even if the exchange fails.
const getQuery = (key) => {
  const match = window.location.search.match(new RegExp(`[?&]${key}=([^&]*)`));
  return match ? decodeURIComponent(match[1]) : '';
};

const ERRORS = {
  invalid_state: 'That sign-in link did not match this browser. Please try again.',
  login_failed: "We couldn't sign you in with that account. You may have cancelled or denied access.",
  EXCHANGE_FAILED: 'That sign-in link has expired or was already used. Please try again.',
  ACCOUNT_SUSPENDED: 'This account has been suspended. Please contact support.',
};

export default function SocialCallback() {
  const [status, setStatus] = useState('loading');
  const [reason, setReason] = useState('');

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const error = getQuery('error');
      const code = getQuery('code');

      // Remove the code from the address bar immediately. window.history.replaceState
      // does not reload, so a failed exchange still leaves no code behind for the
      // back button to replay.
      window.history.replaceState({}, '', window.location.pathname);

      if (error) {
        setReason(ERRORS[error] || ERRORS.login_failed);
        setStatus('error');
        return;
      }
      if (!code) {
        setReason(ERRORS.EXCHANGE_FAILED);
        setStatus('error');
        return;
      }

      try {
        const { data } = await api.post('/auth/social/exchange', { code });
        if (cancelled) return;
        // The server tells us the role rather than decoding the JWT here —
        // an unverified token should never decide which session to open.
        const role = data?.user?.role || 'passenger';
        tokenStore.setActiveRole(role);
        tokenStore.setTokens(data.tokens.accessToken, data.tokens.refreshToken);
        window.location.replace('/');
      } catch (err) {
        if (cancelled) return;
        const code2 = err?.response?.data?.code;
        setReason(ERRORS[code2] || ERRORS.EXCHANGE_FAILED);
        setStatus('error');
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const copy =
    status === 'loading'
      ? { title: 'Finishing sign-in…', sub: 'Connecting you to Romina Limousine Service.' }
      : { title: 'Sign-in failed', sub: reason };

  return (
    <AuthLayout title={copy.title} subtitle={copy.sub}>
      <div className="py-2 text-center">
        {status === 'loading' && (
          <div className="flex justify-center">
            <Spinner />
          </div>
        )}
        {status === 'error' && (
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-100 text-2xl text-red-700">
            !
          </div>
        )}
        {status === 'error' && (
          <Link to="/login" className="block">
            <Button size="lg" variant="outline" className="w-full">
              Back to sign in
            </Button>
          </Link>
        )}
      </div>
    </AuthLayout>
  );
}