// @ts-check
/**
 * Strip credentials from a string before it's logged or returned to a client.
 *
 * Query-auth integration presets build URLs like `https://host/api?apikey=SECRET`,
 * and fetch/undici error messages frequently embed the full request URL — so an
 * upstream failure can otherwise leak the API key into BOTH the server log and
 * the JSON error returned to the browser. Apply this to any error/message that
 * may contain a user-supplied URL. The logger runs every string it writes
 * through it (util/logger.js, #409).
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
  // Each pattern below needs an @ (userinfo) or a ? or & (a query): text with
  // none is returned as it is, which is most of what the logger writes.
  if (!/[@?&]/.test(s)) return s;
  // URL userinfo, any scheme: scheme://user:PASSWORD@host keeps the user as a
  // hint and drops the password, and scheme://TOKEN@host, a user with no
  // password, drops the user, which is often the token itself. Services authed
  // via https://user:token@host otherwise leak the token into logs/client errors
  // (the password sits before the path, so the query-strip below never reaches
  // it). The userinfo runs to the last @ before the path, query or fragment, as
  // the URL parser reads it, so a password holding an @ goes whole.
  s = s.replace(/:\/\/([^/?#\s'"]*)@/g, (_, info) => {
    const colon = info.indexOf(':');
    return colon === -1 ? '://[redacted]@' : `://${info.slice(0, colon)}:[redacted]@`;
  });
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
