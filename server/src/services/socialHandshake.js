import crypto from 'crypto';

/**
 * Hand-off between the OAuth provider redirect and the SPA.
 *
 * The callback used to put both tokens in the redirect URL:
 *
 *   /auth/social?accessToken=…&refreshToken=…
 *
 * Query strings get written to browser history, copied into reverse-proxy
 * access logs, attached to outbound Referer headers and picked up by analytics.
 * A leaked refresh token is a 30-day session, not something to put in a URL.
 *
 * Instead the callback mints a short-lived single-use code, puts only that in
 * the URL, and the SPA exchanges it for the real tokens over POST — where they
 * never touch a log line, history entry or Referer.
 *
 * Codes live in process memory. That is sufficient here because PM2 runs a
 * single instance (instances: 1, fork — required by Socket.io's per-process
 * rooms), and the whole window is 60 seconds. If that ever changes to multiple
 * workers this must move to Redis, or exchanges will intermittently fail with
 * "unknown or expired code".
 */

const CODE_TTL_MS = 60_000;
// Bounded so a flood of sign-in attempts cannot grow the map without limit.
const MAX_PENDING = 500;

/** code -> { userId, expiresAt } */
const pending = new Map();

const sweep = () => {
  const now = Date.now();
  for (const [code, entry] of pending) {
    if (entry.expiresAt <= now) pending.delete(code);
  }
};

/** Mint a single-use code bound to a user. Returns the code. */
export const createHandshakeCode = (userId) => {
  const code = crypto.randomBytes(32).toString('base64url');
  if (pending.size >= MAX_PENDING) {
    // Opportunistic cleanup first; if still full, drop the oldest entry rather
    // than refusing to issue a code.
    sweep();
    if (pending.size >= MAX_PENDING) {
      const oldest = pending.keys().next().value;
      if (oldest !== undefined) pending.delete(oldest);
    }
  }
  pending.set(code, { userId: String(userId), expiresAt: Date.now() + CODE_TTL_MS });
  return code;
};

/**
 * Redeem a code. Returns the userId on success, or null when the code is
 * unknown, already used, or expired. A code is destroyed whatever happens —
 * a failed lookup must not leave it redeemable.
 */
export const consumeHandshakeCode = (code) => {
  if (!code || typeof code !== 'string') return null;
  const entry = pending.get(code);
  if (!entry) return null;
  pending.delete(code);
  if (entry.expiresAt <= Date.now()) return null;
  return entry.userId;
};

/** Opaque, non-revealing reason codes for the SPA to show. */
export const HANDSHAKE_ERRORS = {
  EXCHANGE_FAILED: 'Sign-in could not be completed. Please try again.',
  EXCHANGE_EXPIRED: 'Sign-in took too long. Please try again.',
};

export const handshakeStats = () => ({ pending: pending.size, ttlMs: CODE_TTL_MS });