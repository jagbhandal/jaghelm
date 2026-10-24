// @ts-check
/**
 * A failed push in words (#320): what Settings → Notifications says about a
 * device's last failed send and a test push that failed, from the sender's
 * code as webPush.js gives it (`error`). A plain sentence, as a source's
 * failure is said (#605): no code, URL or token reaches a client; the code
 * stays in the server log. Pure.
 */

/** @type {Record<string, string>} */
const WORDS = {
  // Web Push (push/webPush.js, #653): the browser's push service.
  'webpush/gone': "The browser's push service says this subscription has ended (the app was removed from the browser, or alerts were turned off there)",
  'webpush/endpoint-refused': "This browser's push service is not one JagHelm sends to",
  'webpush/rate-limited': "The browser's push service is holding back pushes for now; JagHelm tries again",
  'webpush/server-error': "The browser's push service failed on it; JagHelm tries again",
  'webpush/network-error': "JagHelm couldn't reach the browser's push service; it tries again",
  'webpush/network-timeout': "The browser's push service didn't answer in time; JagHelm tries again",
  'webpush/rejected': "The browser's push service refused JagHelm's VAPID key (check VAPID_SUBJECT and the key pair)",
  'webpush/bad-request': "The browser's push service refused the message as malformed",
  'webpush/too-large': "The browser's push service refused the message as too large",
  'webpush/redirect': "The browser's push service answered with a redirect, which JagHelm doesn't follow",
  'webpush/encrypt-failed': "The browser's subscription keys can't encrypt a message; turn alerts off and on again in this browser",
  'webpush/disabled': 'Web Push is switched off on the server (the VAPID keys in .env are missing or not a valid pair)',
  'webpush/removed': 'This browser was removed before the push was sent',
  // outbox.js: the send threw inside JagHelm.
  thrown: 'The send failed inside JagHelm; the server log says why',
};

/** What a code JagHelm has no words for says. */
export const UNKNOWN_FAILURE = 'The push service refused this push; the server log has its reason';

/**
 * The sentence for a failed send's code.
 * @param {unknown} code
 * @returns {string}
 */
export function sendFailureWords(code) {
  return typeof code === 'string' && Object.hasOwn(WORDS, code) ? WORDS[code] : UNKNOWN_FAILURE;
}
