/**
 * The DASH_SECRET values that are no key (#576): every example the docs print
 * (README, docs/GET-STARTED.md, env.example) and the generic placeholders. A
 * key anyone can read in the repo is no key: the secrets store would encrypt
 * every credential under it, and the session stamp would be a fast hash to
 * test passwords against. The one list for both, secrets.js and
 * auth/passwords.js; exampleSecrets.test.js reads every DASH_SECRET the docs
 * print and fails when one isn't here.
 */

/** Lower case, as isExampleSecret compares. */
export const EXAMPLE_SECRETS = Object.freeze([
  'your-random-secret-here', // env.example
  'replace-with-output-of-openssl-rand-hex-32', // README
  'paste-your-random-secret-here', // docs/GET-STARTED.md
  'replace_me',
  'changeme',
  'change-me',
  'secret',
  'password',
]);

const LIST = new Set(EXAMPLE_SECRETS);

/**
 * Whether `value` is one of the examples, in any case and with spaces around
 * it. Anything but a string is not.
 * @param {unknown} value
 */
export function isExampleSecret(value) {
  return typeof value === 'string' && LIST.has(value.trim().toLowerCase());
}
