/**
 * Minimal cookie read/write for the OAuth handshake.
 *
 * Deliberately not a dependency. Exactly two cookies are involved in this app
 * and they need precise attributes (httpOnly, SameSite, Secure), so parsing the
 * Cookie header directly is less code than pulling in a parser.
 */

/** Parses req.headers.cookie into req.cookies. Never throws on malformed input. */
export const readCookies = (req, _res, next) => {
  req.cookies = {};
  const header = req.headers.cookie;
  if (header) {
    for (const part of header.split(';')) {
      const eq = part.indexOf('=');
      if (eq < 1) continue;
      const name = part.slice(0, eq).trim();
      if (!name) continue;
      try {
        req.cookies[name] = decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        // A malformed percent-escape should not take down the request.
      }
    }
  }
  next();
};

/**
 * Sets a cookie with the attributes this app needs.
 * `secure` is on in production so it never travels over plain HTTP; the OAuth
 * callback is HTTPS on the live domain.
 */
export const setCookie = (res, name, value, { maxAgeMs, secure }) => {
  const bits = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    // Lax, not Strict: the provider returns the user via a top-level GET
    // navigation from another origin, and Strict would withhold the cookie on
    // exactly that request — breaking every sign-in.
    'SameSite=Lax',
  ];
  if (secure) bits.push('Secure');
  if (typeof maxAgeMs === 'number') bits.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  res.append('Set-Cookie', bits.join('; '));
};

/** Clears a cookie by sending it back with Max-Age=0. */
export const clearCookie = (res, name, { secure }) => {
  const bits = [`${name}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) bits.push('Secure');
  res.append('Set-Cookie', bits.join('; '));
};