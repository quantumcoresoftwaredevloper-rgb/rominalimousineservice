import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import RefreshToken from '../models/RefreshToken.js';
import OtpCode from '../models/OtpCode.js';
import { generateToken, hashToken } from '../utils/tokens.js';
import { sendMail } from './mailService.js';
import { sendSms, isSmsConfigured } from './smsService.js';

const fail = (message, statusCode) => Object.assign(new Error(message), { statusCode });

const signAccess = (user) =>
  jwt.sign({ id: user._id, role: user.role, v: user.tokenVersion }, process.env.JWT_ACCESS_SECRET, {
    expiresIn: process.env.ACCESS_TOKEN_EXPIRY || '15m',
  });

const refreshTtlMs = (rememberMe) => {
  const raw = rememberMe ? process.env.REMEMBER_ME_EXPIRY : process.env.REFRESH_TOKEN_EXPIRY;
  // Support both "30d" and plain milliseconds.
  const match = /^(\d+)([smhd])$/.exec(raw || '');
  if (match) {
    const n = Number(match[1]);
    return n * { s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2]];
  }
  return 7 * 24 * 60 * 60 * 1000;
};

// Issues a short-lived access JWT + a server-side opaque refresh token.
// The refresh token is stored hashed, so it can be rotated and revoked per device.
export const issueTokens = async (user, { rememberMe = false, userAgent = '', ip = '' } = {}) => {
  const rawToken = generateToken();
  await RefreshToken.create({
    user: user._id,
    tokenHash: hashToken(rawToken),
    expiresAt: new Date(Date.now() + refreshTtlMs(rememberMe)),
    rememberMe,
    userAgent: (userAgent || '').slice(0, 200),
    ip,
  });
  return { accessToken: signAccess(user), refreshToken: rawToken };
};

export const publicUser = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  role: user.role,
  avatar: user.avatar,
  emailVerified: user.emailVerified,
  authProvider: user.authProvider,
  isApproved: user.isApproved,
  driverDetails: user.driverDetails,
});

/* ---------- refresh (rotates the token, killing the one presented) ---------- */
export const refresh = async (rawToken) => {
  if (!rawToken) throw fail('Missing refresh token', 400);

  // Atomically "claim" the token: the filter matches only a live token, and the
  // $set revokes it in the same op. Under concurrent replays of the same token,
  // exactly one request matches — the rest see revokedAt set and get 401.
  const claimed = await RefreshToken.findOneAndUpdate(
    { tokenHash: hashToken(rawToken), revokedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { revokedAt: new Date() } },
    { returnDocument: 'before' }
  );
  if (!claimed) throw fail('Session ended', 401);

  const user = await User.findById(claimed.user);
  if (!user) throw fail('Session ended', 401);
  if (user.isSuspended) throw fail('Account suspended', 403);

  const tokens = await issueTokens(user, {
    rememberMe: claimed.rememberMe,
    userAgent: claimed.userAgent,
    ip: claimed.ip,
  });
  return tokens;
};

/* ---------- logout: revoke the presented device token ---------- */
export const logout = async (userId, rawToken) => {
  if (rawToken) {
    await RefreshToken.updateOne({ user: userId, tokenHash: hashToken(rawToken) }, { revokedAt: new Date() });
  }
  return { success: true };
};

/* ---------- logout everywhere (e.g. password reset / security) ---------- */
export const logoutAll = async (userId) => {
  await RefreshToken.updateMany({ user: userId, revokedAt: null }, { revokedAt: new Date() });
  await User.findByIdAndUpdate(userId, { $inc: { tokenVersion: 1 } });
  return { success: true };
};

/* ---------- validation ---------- */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+]?[\d\s()-]{7,}$/;

// bcrypt silently ignores everything past 72 bytes, so a longer password is
// quietly weaker than it looks. Refuse rather than truncate. TextEncoder
// rather than Buffer: it is a global, so no import and no eslint globals edit.
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX_BYTES = 72;

/**
 * Single source of truth for password strength. Returns a message, or null.
 *
 * The floor was 6 characters with no other rule, which is weak enough that
 * admin123 passes. 10 characters minimum is the pragmatic bar here — complexity
 * rules push people toward predictable substitutions, whereas length does
 * genuinely more. The email check blocks "alex@gmail.com" style reuse, which
 * is guessable from public information about the account.
 */
export const passwordPolicyError = (password, { email, name } = {}) => {
  if (typeof password !== 'string' || !password) return 'Password is required';
  if (password.length < PASSWORD_MIN) {
    return `Password must be at least ${PASSWORD_MIN} characters`;
  }
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) {
    return 'Password is too long';
  }
  const lowered = password.toLowerCase();
  if (email && lowered.includes(String(email).toLowerCase().split('@')[0])) {
    return 'Password must not contain your email address';
  }
  if (name && lowered === String(name).toLowerCase()) {
    return 'Password must not be your name';
  }
  return null;
};

const validateRegistration = ({ name, email, phone, password }) => {
  if (!name || !name.trim()) return 'Full name is required';
  if (!email || !EMAIL_RE.test(email)) return 'A valid email address is required';
  const policyError = passwordPolicyError(password, { email, name });
  if (policyError) return policyError;
  if (phone && !PHONE_RE.test(phone)) return 'Please enter a valid phone number';
  return null;
};

// Only these two vehicle classes can ever be requested by a booking, and ride
// matching compares vehicleType exactly — so a driver registered as anything
// else is permanently invisible to dispatch.
const BOOKABLE_VEHICLES = ['SUV', 'Chevrolet'];
const DEFAULT_BOOKABLE = 'SUV';

/**
 * Whitelists what a self-registering driver is allowed to set.
 *
 * The admin path runs driverDetails through adminUserService.sanitizeDriverDetails;
 * the public registration path passed the caller's object straight into
 * User.create. One unauthenticated POST could therefore set:
 *
 *   stats: { rating: 5, ratingCount: 9999, totalRides: 9999 }  → a self-awarded
 *     5-star rating that every surface renders
 *   isAvailable: true  → an unapproved driver shown as "On duty"
 *   vehicleType: 'school-bus'  → passes the 11-value model enum, matches no ride
 *
 * Driver actions are gated by requireApprovedDriver, so there was no payout
 * impact — but the displayed data was entirely caller-controlled.
 */
const sanitizePublicDriverDetails = (input) => {
  const dd = input && typeof input === 'object' ? input : {};
  const requested = String(dd.vehicleType || '').trim();
  return {
    vehicleType: BOOKABLE_VEHICLES.includes(requested) ? requested : DEFAULT_BOOKABLE,
    plateNumber: String(dd.plateNumber || '').trim().slice(0, 32),
    licenseNo: String(dd.licenseNo || '').trim().slice(0, 64),
    vehicleName: String(dd.vehicleName || '').trim().slice(0, 64),
    // Never from the caller. Only the driver's own toggle, gated on approval,
    // may set this.
    isAvailable: false,
  };
};

export const BOOKABLE_VEHICLE_TYPES = BOOKABLE_VEHICLES;

/* ---------- email helpers ---------- */
const appUrl = () => process.env.CLIENT_ORIGIN || 'http://localhost:5173';

const devLink = (link) => (process.env.NODE_ENV === 'production' ? undefined : link);

const BRAND = 'Romina Limousine Service';

// User-supplied names go into HTML emails. Without this, a name of
// "<img onerror=...>" is markup in the recipient's mail client.
const escapeHtml = (value) =>
  String(value == null ? '' : value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  );

const shell = (heading, bodyHtml, ctaLabel, ctaUrl, footNote) => `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f8f9fa;padding:32px 16px">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb">
      <div style="background:#0b132b;padding:24px 28px">
        <p style="margin:0;color:#efc964;font-size:12px;letter-spacing:.14em;text-transform:uppercase">${BRAND}</p>
        <p style="margin:6px 0 0;color:#fff;font-size:19px;font-weight:700">${heading}</p>
      </div>
      <div style="padding:28px;color:#0b0d0f;font-size:15px;line-height:1.6">${bodyHtml}</div>
      <div style="padding:0 28px 28px">
        <a href="${ctaUrl}" style="display:inline-block;background:#c9a227;color:#0b132b;font-weight:700;text-decoration:none;padding:13px 26px;border-radius:999px">${ctaLabel}</a>
      </div>
      <div style="padding:18px 28px;background:#f8f9fa;border-top:1px solid #e5e7eb;color:#667085;font-size:12px;line-height:1.5">
        ${footNote}
        <p style="margin:10px 0 0">If the button does not work, copy this link into your browser:<br>
          <span style="color:#667085;word-break:break-all">${ctaUrl}</span></p>
      </div>
    </div>
    <p style="max-width:560px;margin:16px auto 0;color:#8f8f9a;font-size:11px;text-align:center">
      ${BRAND} · Maryland · Virginia · Washington DC · Baltimore · (240) 351-0826
    </p>
  </div>`;

const sendVerificationEmail = async (user, rawToken) => {
  const link = `${appUrl()}/verify-email?token=${rawToken}`;
  const isDriver = user.role === 'driver';
  const why = isDriver
    ? 'Confirm your address so dispatch can review your driver application. Drivers cannot go on duty until an admin approves them, and approval needs a verified email.'
    : 'Confirm your address to finish setting up your account. You can book and track rides either way.';

  await sendMail({
    to: user.email,
    subject: `Verify your email — ${BRAND}`,
    html: shell(
      'Confirm your email address',
      `<p>Hi ${escapeHtml(user.name)},</p><p>${why}</p>`,
      'Verify my email',
      link,
      'This link expires in 24 hours. If you did not create this account, you can safely ignore this email.',
    ),
    text: `Hi ${user.name},\n\n${why}\n\nVerify your email:\n${link}\n\nThis link expires in 24 hours. If you did not create this account, ignore this email.\n\n${BRAND} · (240) 351-0826`,
  });
  return devLink(link);
};

/* ---------- register ---------- */
export const register = async ({ name, email, phone, password, role, driverDetails }, meta = {}) => {
  const validationError = validateRegistration({ name, email, phone, password });
  if (validationError) throw fail(validationError, 400);

  const emailInUse = await User.findOne({ email: email.toLowerCase() });
  if (emailInUse) throw fail('This email is already registered. Try signing in.', 409);

  // RBAC: public registration may only create passenger|driver — admin roles are seed/CRM-only
  const ALLOWED_PUBLIC_ROLES = ['passenger', 'driver'];
  const safeRole = ALLOWED_PUBLIC_ROLES.includes(role) ? role : 'passenger';
  const safeDriverDetails =
    safeRole === 'driver' ? sanitizePublicDriverDetails(driverDetails) : undefined;
  // New drivers always start unapproved — an admin must approve before they can work.
  const user = await User.create({
    name: name.trim(),
    email: email.toLowerCase(),
    phone: phone || '',
    password,
    role: safeRole,
    emailVerified: false,
    authProvider: 'local',
    isApproved: safeRole === 'driver' ? false : true,
    driverDetails: safeDriverDetails,
  });

  const rawToken = generateToken();
  user.verificationToken = { token: hashToken(rawToken), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) };
  await user.save();

  // The account and its session are already committed at this point, so a mail
  // failure must not fail the request. It used to: sendMail rejecting produced a
  // 500, the client showed "Registration failed", the user retried and got
  // "This email is already registered" — locked out of an account that existed
  // with tokens already issued. Now the send is best-effort, reported honestly
  // in the response, and the user can re-send the verification later.
  let verificationLink;
  let verificationEmailSent = false;
  try {
    verificationLink = await sendVerificationEmail(user, rawToken);
    verificationEmailSent = true;
  } catch (err) {
    verificationEmailSent = false;
    console.error('[auth] verification email not sent:', err.message);
  }

  const tokens = await issueTokens(user, meta);

  return { user: publicUser(user), tokens, verificationLink, verificationEmailSent };
};

/* ---------- email verification ---------- */
export const verifyEmail = async (token) => {
  // Guard before hashing. crypto.createHash().update(undefined) throws a
  // TypeError that reached the client as a 500 carrying the raw Node message —
  // an unauthenticated information-disclosure and log-spam vector.
  if (typeof token !== 'string' || !token.trim()) {
    throw fail('Verification link is invalid or has expired.', 400);
  }
  const hash = hashToken(token);
  const user = await User.findOne({ 'verificationToken.token': hash });
  if (!user || !user.verificationToken || user.verificationToken.expiresAt < new Date()) {
    throw fail('Verification link is invalid or has expired.', 400);
  }
  user.emailVerified = true;
  user.verificationToken = null;
  await user.save();
  return { user: publicUser(user) };
};

export const resendVerification = async (email) => {
  const user = await User.findOne({ email: (email || '').toLowerCase() });
  // Answer identically for unknown, already-verified and real-unverified
  // addresses. The old 404 / 400 / 200 split let an unauthenticated caller
  // enumerate accounts and learn each one's verification state.
  if (!user || user.emailVerified) return { verificationLink: undefined };
  const rawToken = generateToken();
  user.verificationToken = { token: hashToken(rawToken), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) };
  await user.save();
  const link = await sendVerificationEmail(user, rawToken);
  return { verificationLink: link };
};

/* ---------- forgot / reset password ---------- */
export const forgotPassword = async (email) => {
  const user = await User.findOne({ email: (email || '').toLowerCase() });
  // Same shape as the request: never reveal whether the address exists.
  if (!user) return { resetLink: undefined, delivered: false };

  const rawToken = generateToken();
  user.resetToken = { token: hashToken(rawToken), expiresAt: new Date(Date.now() + 60 * 60 * 1000) };
  await user.save();

  const link = `${appUrl()}/reset-password?token=${rawToken}`;
  // Deliberately swallowed. Throwing here would make a mail failure return 503
  // for a real address and 200 for a fake one — a worse enumeration channel
  // than the 404 this replaced, and one that leaks whether the server's SMTP
  // is healthy. The answer is identical either way.
  //
  // The operator still learns about it, twice over: the log line here, and the
  // emailResetEnabled flag that /api/settings publishes so the client can warn
  // everyone at once without asking whether a given address exists.
  try {
    await sendMail({
    to: user.email,
    subject: `Reset your password — ${BRAND}`,
    html: shell(
      'Choose a new password',
      `<p>Hi ${escapeHtml(user.name)},</p>
       <p>We received a request to reset the password on your ${BRAND} account.</p>
       <p>Set a new password using the button below. Once you do, you will be signed out on every device.</p>`,
      'Reset my password',
      link,
      'This link expires in 1 hour and can only be used once. If you did not request a reset, ignore this email and your password will stay as it is.',
    ),
      text: `Hi ${user.name},\n\nWe received a request to reset the password on your ${BRAND} account.\n\nReset your password:\n${link}\n\nThis link expires in 1 hour and can only be used once. If you did not request a reset, ignore this email.\n\n${BRAND} · (240) 351-0826`,
    });
  } catch (err) {
    console.error('[auth] password reset email not sent:', err.message);
  }
  return { resetLink: devLink(link), delivered: true };
};

export const resetPassword = async ({ token, password, email }) => {
  if (typeof token !== 'string' || !token.trim()) {
    throw fail('Reset link is invalid or has expired.', 400);
  }
  const policyError = passwordPolicyError(password, { email });
  if (policyError) throw fail(policyError, 400);

  const hash = hashToken(token);
  const user = await User.findOne({ 'resetToken.token': hash }).select('+password');
  if (!user || !user.resetToken || user.resetToken.expiresAt < new Date()) {
    throw fail('Reset link is invalid or has expired.', 400);
  }
  user.password = password;
  // Single-use, and an outstanding link must never survive a password change.
  user.resetToken = null;
  await user.save();

  // Security: resetting the password signs out every device.
  await logoutAll(user._id);
  return { success: true };
};

/* ---------- phone OTP login ---------- */
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

export const sendOtp = async (phone) => {
  if (!phone || !PHONE_RE.test(phone)) throw fail('Enter a valid phone number.', 400);

  const code = String(Math.floor(100000 + Math.random() * 900000));
  await OtpCode.deleteMany({ phone });
  await OtpCode.create({
    phone,
    codeHash: hashToken(code),
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
    attempts: 0,
  });

  await sendSms({
    to: phone,
    body: `Your Romina Limousine Service verification code is ${code}. It expires in 10 minutes.`,
  });
  // In dev (no Twilio) return the code so the flow can be tested end-to-end.
  return { devCode: isSmsConfigured() ? undefined : code };
};

export const verifyOtp = async ({ phone, code, userAgent = '', ip = '' }) => {
  if (!phone || !code) throw fail('Phone number and code are required', 400);

  const otp = await OtpCode.findOne({ phone });
  if (!otp || otp.expiresAt < new Date()) {
    if (otp) await otp.deleteOne();
    throw fail('Code expired. Request a new one.', 400);
  }
  if (otp.attempts >= OTP_MAX_ATTEMPTS) {
    await otp.deleteOne();
    throw fail('Too many attempts. Request a new code.', 400);
  }
  if (otp.codeHash !== hashToken(String(code).trim())) {
    otp.attempts += 1;
    await otp.save();
    throw fail('Invalid code.', 400);
  }
  await otp.deleteOne();

  // Find-or-create a passenger account keyed by phone.
  const phoneDigits = phone.replace(/\D/g, '');
  let user = await User.findOne({ phone });
  if (!user) {
    user = await User.create({
      name: `User ${phoneDigits.slice(-4)}`,
      email: `${phoneDigits}@phone.local`,
      phone,
      password: generateToken(), // OTP users don't use a password
      emailVerified: true,
      authProvider: 'phone',
    });
  }

  const tokens = await issueTokens(user, { rememberMe: true, userAgent, ip });
  return { user: publicUser(user), tokens };
};