import crypto from 'crypto';
import passport from '../config/passport.js';
import { asyncHandler } from '../middleware/error.js';
import { setCookie, clearCookie } from '../middleware/oauthCookies.js';
import { createHandshakeCode, consumeHandshakeCode } from '../services/socialHandshake.js';
import { publicProfile } from '../services/userService.js';
import User from '../models/User.js';
import * as authService from '../services/authService.js';

const OAUTH_STATE_COOKIE = 'rt_oauth_state';
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

const meta = (req) => ({
  userAgent: req.headers['user-agent'] || '',
  ip: req.ip || '',
});

export const register = asyncHandler(async (req, res) => {
  const result = await authService.register(req.body, meta(req));
  res.status(201).json(result);
});

// Email-OR-phone + password, verified by passport's LocalStrategy.
export const login = (req, res, next) => {
  passport.authenticate('local', { session: false }, async (err, user, info) => {
    if (err) return next(err);
    if (!user) return res.status(401).json({ message: info?.message || 'Invalid email/phone or password' });

    try {
      const rememberMe = Boolean(req.body.rememberMe);
      const tokens = await authService.issueTokens(user, { rememberMe, ...meta(req) });
      return res.json({ user: authService.publicUser(user), tokens });
    } catch (e) {
      return next(e);
    }
  })(req, res, next);
};

export const refresh = asyncHandler(async (req, res) => {
  const tokens = await authService.refresh(req.body.refreshToken);
  res.json({ tokens });
});

// Revokes the presented refresh token (this device only).
export const logout = asyncHandler(async (req, res) => {
  const result = await authService.logout(req.user._id, req.body.refreshToken);
  res.json(result);
});

export const me = asyncHandler(async (req, res) => {
  res.json({ user: authService.publicUser(req.user) });
});

export const verifyEmail = asyncHandler(async (req, res) => {
  const result = await authService.verifyEmail(req.body.token);
  res.json(result);
});

export const resendVerification = asyncHandler(async (req, res) => {
  const result = await authService.resendVerification(req.body.email);
  res.json(result);
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const result = await authService.forgotPassword(req.body.email);
  res.json(result);
});

export const resetPassword = asyncHandler(async (req, res) => {
  const result = await authService.resetPassword(req.body);
  res.json(result);
});

export const sendOtp = asyncHandler(async (req, res) => {
  const result = await authService.sendOtp(req.body.phone);
  res.json(result);
});

export const verifyOtp = asyncHandler(async (req, res) => {
  const result = await authService.verifyOtp({ ...req.body, ...meta(req) });
  res.json(result);
});

/* ---------- Social OAuth (Passport redirect flow) ---------- */

const clientUrl = () => process.env.CLIENT_ORIGIN || 'http://localhost:5173';

const secureCookies = () => process.env.NODE_ENV === 'production';

// The strategy is only registered when BOTH id and secret are present
// (passport.js). Checking only the id sent a request into a strategy that was
// never registered, which passport turns into a 500 instead of a clean 503.
const providerEnv = {
  google: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  facebook: ['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET'],
};

const providerConfigured = (provider) => {
  const keys = providerEnv[provider];
  return Boolean(keys && keys.every((k) => process.env[k]));
};

const failTo = (res, reason) => res.redirect(`${clientUrl()}/auth/social?error=${reason}`);

// Step 1: kick off the OAuth dance at the provider.
//
// A CSRF `state` is issued in an httpOnly cookie and echoed back by the
// provider. This used to be `state: false`, which made /api/auth/google a bare
// redirect: an attacker could complete the flow from their own Google account
// and leave the victim's browser signed in as them (login CSRF). The app has no
// server-side session to hold state, so a cookie is the right carrier — and
// SameSite=Lax still sends it on the provider's top-level GET back to us.
export const socialRedirect = (provider) => (req, res, next) => {
  if (!providerConfigured(provider)) {
    return res.status(503).json({ message: 'Social login is not configured.' });
  }
  const state = crypto.randomBytes(24).toString('base64url');
  setCookie(res, OAUTH_STATE_COOKIE, state, {
    maxAgeMs: OAUTH_STATE_TTL_MS,
    secure: secureCookies(),
  });
  passport.authenticate(provider, { session: false, state, scope: ['profile', 'email'] })(req, res, next);
};

// Step 2: provider bounces back here → verify state → mint a one-time code.
//
// The SPA never sees a token in the URL. It receives a single-use code that
// lasts 60 seconds and exchanges over POST; see socialHandshake.js.
export const socialCallback = (provider) => (req, res, next) => {
  const expected = req.cookies?.[OAUTH_STATE_COOKIE];
  const received = typeof req.query?.state === 'string' ? req.query.state : '';

  // Consume the cookie either way — a valid state must not be reusable.
  clearCookie(res, OAUTH_STATE_COOKIE, { secure: secureCookies() });

  if (!expected || !received || expected !== received) {
    return failTo(res, 'invalid_state');
  }

  passport.authenticate(provider, { session: false, failureRedirect: false }, async (err, user) => {
    if (err || !user) return failTo(res, 'login_failed');
    try {
      const code = createHandshakeCode(user._id);
      return res.redirect(`${clientUrl()}/auth/social?code=${encodeURIComponent(code)}`);
    } catch {
      // Never put an internal message in the URL. The old code appended
      // `&error=${e.message}` to a URL that already had `?error=`, producing a
      // duplicate parameter and leaking a DB error string into browser history
      // and proxy logs.
      return failTo(res, 'login_failed');
    }
  })(req, res, next);
};

// Step 3: the SPA redeems the one-time code for real tokens, over POST so they
// never appear in a URL, history entry, Referer header or access log.
export const socialExchange = asyncHandler(async (req, res) => {
  const userId = consumeHandshakeCode(req.body?.code);
  if (!userId) {
    return res.status(400).json({
      message: 'Sign-in link has expired or was already used. Please try again.',
      code: 'EXCHANGE_FAILED',
    });
  }
  const user = await User.findById(userId);
  if (!user) return res.status(400).json({ message: 'Account not found.', code: 'EXCHANGE_FAILED' });
  if (user.isSuspended) {
    return res.status(403).json({ message: 'This account has been suspended.', code: 'ACCOUNT_SUSPENDED' });
  }
  const tokens = await authService.issueTokens(user, { rememberMe: true, ...meta(req) });
  res.json({ user: publicProfile(user), tokens });
});