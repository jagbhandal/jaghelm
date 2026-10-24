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
// The config read (configMask.js) uses it too, to tell an endpoint that carries
// a credential, and urlCredential below. Global: copy it without the g flag
// before calling .test().
export const SECRET_PARAMS =
  /([?&](?:(?:api[_-]?)?key|token|password|passwd|pass|secret|auth|access[_-]?token|x-plex-token|sig)=)[^&\s'"]+/gi;

const SECRET_PARAM = new RegExp(SECRET_PARAMS.source, 'i');

// A URL that parses with no userinfo though its text holds some (#419):
// `scheme://word:digits` (user:password, read as host:port), then a raw /, ?
// or #, and an @ anywhere after it (`http://jag:1234/x@host`).
const HOST_PORT_THEN_AT = /^[a-z][a-z0-9+.-]*:\/\/[^\s/?#@:]+:\d*[/?#][^]*@/i;

/**
 * The credential a URL carries, or null: `{ userinfo: true }` for a user name
 * or password before the host (`https://user:pass@host`, `https://TOKEN@host`),
 * else `{ param }` for the first query parameter SECRET_PARAMS names
 * (`?apikey=…` gives `apikey`). Never the value.
 *
 * Userinfo is read from the text as well as the parser: a URL the parser
 * refuses with an @ after its `://` (a raw # in the password, a second URL
 * glued on), one it reads as `host:port` with an @ after (HOST_PORT_THEN_AT),
 * and one with no `://` holding an @ (the scheme left out: `user:pass@host`).
 * The one test of "this URL carries a credential": the source URLs
 * (sourceUrls.js), every integration URL (integrations/lib/config.js), the
 * integration form's save and test (#422), ARCANE_URL and the config read
 * (configMask.js) all ask it. An @ a URL really holds there is written `%40`.
 * @param {unknown} url
 * @returns {{ userinfo: true } | { param: string } | null}
 */
export function urlCredential(url) {
  if (typeof url !== 'string') return null;
  const text = url.trim();
  const sep = text.indexOf('://');
  let userinfo;
  if (sep === -1) userinfo = text.includes('@');
  else if (!URL.canParse(text)) userinfo = text.indexOf('@', sep) !== -1;
  else {
    const parsed = new URL(text);
    userinfo = parsed.username !== '' || parsed.password !== '' || HOST_PORT_THEN_AT.test(text);
  }
  if (userinfo) return { userinfo: true };
  const match = SECRET_PARAM.exec(text);
  return match ? { param: match[1].slice(1, -1) } : null;
}

// A URL on a browser push service (push/pushEndpoint.js lists them): all after
// the host. fcm.googleapis.com is also FCM's own API host, whose paths
// (/v1/projects/…) hold no secret, so only Chrome's subscription paths go there.
const PUSH_ENDPOINT =
  /(https?:\/\/(?:fcm\.googleapis\.com\/(?:fcm\/send|wp)|(?:[a-z0-9-]+\.)*(?:push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com))\/)[^\s'"]+/gi;

/**
 * Redact secrets from a string.
 * @param {*} input
 */
export function redactSecrets(input) {
  if (input == null) return input;
  let s = String(input);
  // A Web Push endpoint is a capability, and its secret sits in the PATH (Chrome's
  // /fcm/send/<token>, Mozilla's /wpush/v2/<token>, Apple's /<token>): the query
  // rules below never reach it, so the path of a URL on a push service goes (#653).
  if (s.includes('://')) s = s.replace(PUSH_ENDPOINT, '$1[redacted]');
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
  // A password with a raw #, / or ? stops that pattern short of its @. It makes
  // the URL one the parser refuses, or, after digits only, one it reads as
  // host:port (jag:1234#x@host, #419). Each token (text up to whitespace or a
  // quote) holding such a URL loses everything between :// and that @. Any
  // other URL that parses is left to the rule above, so an @ further along its
  // path stays.
  if (s.includes('://') && s.includes('@')) s = s.replace(/[^\s'"]+/g, redactUnparsedUserinfo);
  s = s.replace(SECRET_PARAMS, '$1[redacted]');
  // Belt-and-suspenders: drop the entire query string off any http(s) URL so a
  // secret in an unexpected param name can't slip through.
  s = s.replace(/(https?:\/\/[^\s'"]+?)\?[^\s'"]*/gi, '$1?[redacted]');
  return s;
}

// The same in log text, narrower so a path keeps its text (#419):
// `://word:digits`, then a raw # or ? and anything up to an @, or a raw / and
// a first path segment, not empty, that runs to an @ with no ? or # before it.
// The match runs to the last such @. Kept: `/@babel/core`, `/?e=a@b`, and
// `/users/@me` further along a path. Missed: `jag:1234/x/y@host`.
const HOST_PORT_USERINFO = /^:\/\/[^\s'"/?#@:]+:\d*(?:[#?][^\s'"]*@|\/[^\s'"/?#]+@)/;

/**
 * One token of redactSecrets: a token holding `scheme://` and then `@`, whose
 * URL doesn't parse, loses everything between the `://` and its last `@`. One
 * whose URL parses as `host:port` with the password's rest and an `@` after
 * it (HOST_PORT_USERINFO) loses everything up to that `@`. Not caught: a
 * password holding whitespace or a quote (the token ends there), one with a
 * second `/`, and a second URL in the same token. The URLs a log line is
 * likeliest to carry (the source URLs, every integration URL, ARCANE_URL) are
 * refused by urlCredential, which reads all of those, so are never used.
 * @param {string} tok
 */
function redactUnparsedUserinfo(tok) {
  const sep = tok.indexOf('://');
  const at = tok.lastIndexOf('@');
  if (sep === -1 || at < sep) return tok;
  // The scheme: the run of scheme characters before ://, from its first letter.
  let start = sep;
  while (start > 0 && /[a-z0-9+.-]/i.test(tok[start - 1])) start--;
  while (start < sep && !/[a-z]/i.test(tok[start])) start++;
  if (start === sep) return tok;
  if (URL.canParse(tok.slice(start))) {
    const hostPort = HOST_PORT_USERINFO.exec(tok.slice(sep));
    return hostPort ? `${tok.slice(0, sep)}://[redacted]@${tok.slice(sep + hostPort[0].length)}` : tok;
  }
  return `${tok.slice(0, sep)}://[redacted]${tok.slice(at)}`;
}

/**
 * Convenience: redact an Error's message.
 * @param {*} err
 */
export function redactError(err) {
  if (!err) return err;
  return redactSecrets(err.message || String(err));
}
