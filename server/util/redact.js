// @ts-check
/**
 * Strip credentials from a string before it's logged or returned to a client.
 *
 * Query-auth integration presets build URLs like `https://host/api?apikey=SECRET`,
 * and fetch/undici error messages frequently embed the full request URL — so an
 * upstream failure can otherwise leak the API key into BOTH the server log and
 * the JSON error returned to the browser. Apply this to any error/message that
 * may contain a user-supplied URL.
 */

// Sensitive query-param values, redacted in place (keeps the param name as a hint).
const SECRET_PARAMS =
  /([?&](?:api[_-]?key|token|password|passwd|pass|secret|auth|access[_-]?token|sig)=)[^&\s'"]+/gi;

/**
 * Redact secrets from a string.
 * @param {*} input
 */
export function redactSecrets(input) {
  if (input == null) return input;
  let s = String(input);
  // URL userinfo: https://user:PASSWORD@host -> keep the user as a hint, drop the
  // password. Services authed via https://user:token@host otherwise leak the token
  // into logs/client errors (the password sits before the path, so the query-strip
  // below never reaches it).
  s = s.replace(/(https?:\/\/)([^/@\s'"]+):[^/@\s'"]+@/gi, '$1$2:[redacted]@');
  s = s.replace(SECRET_PARAMS, '$1[redacted]');
  // Belt-and-suspenders: drop the entire query string off any http(s) URL so a
  // secret in an unexpected param name can't slip through.
  s = s.replace(/(https?:\/\/[^\s'"]+?)\?[^\s'"]*/gi, '$1?[redacted]');
  return s;
}

/**
 * Convenience: redact an Error's message.
 * @param {*} err
 */
export function redactError(err) {
  if (!err) return err;
  return redactSecrets(err.message || String(err));
}
