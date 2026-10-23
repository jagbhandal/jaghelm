/**
 * What a refused sign-in says (#257). POST /api/auth/login answers 429 with
 * Retry-After in seconds when an address, or the account, has to wait; the web
 * sign-in page (src/components/LoginPage.jsx) and the Android app
 * (mobile/src/login.js) both turn that header into the message, never a
 * generic error.
 *
 * Under a minute the wait is in seconds, else in minutes rounded up. A missing
 * or unreadable header (a proxy's 429, an older server) says "later".
 */
export function tooManyAttempts(retryAfter) {
  const text = typeof retryAfter === 'string' ? retryAfter.trim() : '';
  if (!/^\d{1,9}$/.test(text)) return 'Too many attempts. Try again later.';
  const seconds = Math.max(1, Number(text));
  if (seconds < 60) return `Too many attempts. Try again in ${seconds} s.`;
  return `Too many attempts. Try again in ${Math.ceil(seconds / 60)} min.`;
}
