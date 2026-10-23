/**
 * What a refused sign-in says (#257). POST /api/auth/login answers 429 with
 * Retry-After when an address, or the account, has to wait; the web sign-in
 * page (src/components/LoginPage.jsx) and the Android app (mobile/src/login.js)
 * both turn that header into the message, never a generic error.
 *
 * Retry-After is seconds (what JagHelm sends) or an HTTP date (what a proxy may
 * send, as IMF-fixdate: "Wed, 21 Oct 2026 07:28:00 GMT"), counted from `now`.
 * Under a minute the wait is in seconds, else in minutes rounded up. A missing
 * or unreadable header says "later".
 */
export function tooManyAttempts(retryAfter, now = Date.now()) {
  const seconds = waitSeconds(typeof retryAfter === 'string' ? retryAfter.trim() : '', now);
  if (seconds === null) return 'Too many attempts. Try again later.';
  if (seconds < 60) return `Too many attempts. Try again in ${seconds} s.`;
  return `Too many attempts. Try again in ${Math.ceil(seconds / 60)} min.`;
}

/** Whole seconds to wait, at least 1, or null. */
function waitSeconds(text, now) {
  if (/^\d{1,9}$/.test(text)) return Math.max(1, Number(text));
  const at = Date.parse(text);
  // An IMF-fixdate reads back as itself, so this takes that form and no other.
  if (!Number.isFinite(at) || new Date(at).toUTCString() !== text) return null;
  return Math.max(1, Math.ceil((at - now) / 1000));
}
