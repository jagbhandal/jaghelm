/**
 * The DASH_SECRET values that are no key (#576): every example the docs print
 * (docs/CONFIGURATION.md, docs/GET-STARTED.md, env.example) and the generic placeholders. A
 * key anyone can read in the repo is no key: the secrets store would encrypt
 * every credential under it, and the session stamp would be a fast hash to
 * test passwords against. The one list for both, secrets.js and
 * auth/passwords.js; exampleSecrets.test.js reads every DASH_SECRET the docs
 * print and fails when one isn't here.
 */

/** Lower case, as isExampleSecret compares. */
export const EXAMPLE_SECRETS = Object.freeze([
  'your-random-secret-here', // env.example
  'replace-with-output-of-openssl-rand-hex-32', // docs/CONFIGURATION.md, and the old README
  'paste-your-random-secret-here', // docs/GET-STARTED.md
  'replace_me',
  'changeme',
  'change-me',
  'secret',
  'password',
]);

const LIST = new Set(EXAMPLE_SECRETS);

/**
 * Whether `value` is one of the examples, in any case, with spaces around it
 * or inside one pair of quotes (`docker run --env-file` passes `"value"` on
 * as it is). Anything but a string is not.
 * @param {unknown} value
 */
export function isExampleSecret(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  const quoted = /^(["'])(.*)\1$/s.exec(trimmed);
  return LIST.has((quoted ? quoted[2] : trimmed).trim().toLowerCase());
}
