import nodemailer from 'nodemailer';

// Single HTML-escaping implementation shared by every mail producer. Messages
// reach notify() built from user-controlled fields (ride dropoff address,
// cancelReason taken straight from req.body.reason, passenger name), and those
// were interpolated into the email body verbatim — so a booking address of
// `<img src=x onerror=...>` executed in the operator's mailbox.
export const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * Transactional email (verification, password reset).
 *
 * SMTP is optional in development: with no credentials the message is printed
 * and the flow still returns success, so the app is testable without a mailbox.
 *
 * That fallback is the problem in production. It returned undefined, callers
 * treated it as delivered, and the UI told users "check your inbox" — so a
 * misconfigured server produced a perfectly green, completely broken password
 * reset with no error anywhere. `sendMail` now throws MailNotConfigured instead,
 * and the two flows that depend on it surface a real message.
 */

let transporter = null;
let transporterError = null;

// Resolved lazily rather than at import time. dotenv ordering is implicit when
// this runs at module load: config/db.js and config/passport.js each call
// dotenv.config(), and the only reason it worked was that ESM happened to
// evaluate them first. Resolving on first use removes that dependency.
const resolveTransporter = () => {
  if (transporter || transporterError) return transporter;
  const { SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_PORT, SMTP_SECURE, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER) {
    transporterError = 'SMTP_HOST and SMTP_USER are not set';
    return null;
  }
  if (!SMTP_PASS) {
    transporterError = 'SMTP_PASS is not set';
    return null;
  }
  try {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT || 587),
      secure: SMTP_SECURE === 'true',
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    _from = SMTP_FROM || SMTP_USER;
  } catch (err) {
    transporterError = err.message;
    transporter = null;
  }
  return transporter;
};

let _from = '';

export class MailNotConfigured extends Error {
  constructor(reason) {
    super(`Email delivery is not configured (${reason})`);
    this.name = 'MailNotConfigured';
    this.statusCode = 503;
    this.code = 'MAIL_NOT_CONFIGURED';
  }
}

const devMode = () => process.env.NODE_ENV !== 'production';

/**
 * Sends a message.
 *
 * In production with no working SMTP this throws MailNotConfigured, so a caller
 * can tell the user something is broken instead of claiming success. In
 * development it logs and returns, which keeps local testing possible.
 */
export const sendMail = async ({ to, subject, html, text }) => {
  const tx = resolveTransporter();

  if (!tx) {
    if (devMode()) {
      console.log(`\n[DEV MAIL] to=${to} subject="${subject}"\n${text || html}\n`);
      return { delivered: false, dev: true };
    }
    throw new MailNotConfigured(transporterError || 'unknown');
  }

  // Plain-text alternative alongside the HTML. Without it, plain-text mail
  // clients and several spam filters render the raw markup.
  await tx.sendMail({
    from: _from,
    to,
    subject,
    html,
    ...(text ? { text } : {}),
  });
  return { delivered: true };
};

/** True when a working transport exists. Safe to call before any send. */
export const isMailConfigured = () => {
  resolveTransporter();
  return Boolean(transporter);
};