// @ts-check
/**
 * A source's failure in words (#605): the one mapping from why a read of an
 * upstream failed to the sentence a client is sent. `/api/status` (each
 * source's `error` and its issue's `reason`), the push a source going down
 * sends and the alert history's record of it (both take the model's reason),
 * and `/api/history`'s failed series (promHistory.js, #601) all say it with
 * these sentences, never the upstream's or the fetch's own text: no errno
 * code, stack, URL, host name or credential reaches a client. The raw detail
 * is for the server log (failureDetail), once per failure state
 * (util/sourceHealthLog.js).
 *
 * readFailure() reads a failure's cause, by what the error carries: an HTTP
 * status, a mark the reader set (`failure`: the upstream refused the query,
 * its answer was unreadable or empty, no URL is set up), an errno or undici
 * code or a TimeoutError anywhere along its `cause` chain, else the codes its
 * text names (a failure kept only as text). Pure: no I/O, so the clients'
 * tests can load it with the model.
 */

/**
 * Each cause a failure is read as.
 *
 *   refused     the connection was refused (ECONNREFUSED)
 *   timeout     no answer in time (TimeoutError, ETIMEDOUT, undici's timeouts)
 *   dns         the host name didn't resolve (ENOTFOUND, EAI_AGAIN)
 *   tls         the TLS handshake or the certificate failed
 *   auth        HTTP 401: the credentials, or none, were refused
 *   http        any other non-2xx answer, with its `status`
 *   rejected    a 2xx answer that is an error (Prometheus's `status: "error"`)
 *   unreadable  a body that isn't JSON, or not the shape asked for
 *   empty       an answer with nothing in it (a Kuma status page with no monitors)
 *   redirect    a redirect JagHelm doesn't follow (to another origin with a
 *               credential or a body, too many: util/safeFetchCore.js)
 *   blocked     an address the SSRF guard refuses (util/ssrf.js), or no URL
 *   off         the source's URL is refused for carrying a credential (#419)
 *   unset       no URL is set up
 *   unanswered  anything else (a reset connection, a host unreachable)
 */
export const CAUSES = Object.freeze([
  'refused',
  'timeout',
  'dns',
  'tls',
  'auth',
  'http',
  'rejected',
  'unreadable',
  'empty',
  'redirect',
  'blocked',
  'off',
  'unset',
  'unanswered',
]);
const CAUSE_SET = new Set(CAUSES);

/** @typedef {{ cause: string, status?: number }} Failure */

// Each source by its key: its name in a sentence, what it calls one read
// (Prometheus's are queries), and its own words for an empty answer.
/** @type {Record<string, { name: string, request: string, empty?: string }>} */
const SOURCES = {
  prometheus: { name: 'Prometheus', request: 'query' },
  kuma: { name: 'Kuma', request: 'request', empty: "Kuma's status page lists no monitors" },
  gitea: { name: 'Gitea', request: 'request' },
  nut: { name: 'NUT', request: 'request' },
};

/** What a failed source with no failure to read says: it gave nothing this cycle. */
export const NO_ANSWER = 'No answer this cycle';

const REFUSED_CODES = new Set(['ECONNREFUSED']);
const TIMEOUT_CODES = new Set([
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);
const DNS_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'EAI_NONAME',
  'EAI_FAIL',
  'EAI_NODATA',
  'EAI_ADDRFAMILY',
]);
const TLS_CODE =
  /^(?:ERR_TLS_|ERR_SSL_|ERR_OSSL_|CERT_|UNABLE_TO_(?:GET|VERIFY|DECRYPT)_|DEPTH_ZERO_SELF_SIGNED_CERT$|SELF_SIGNED_CERT_IN_CHAIN$|HOSTNAME_MISMATCH$|EPROTO$)/;

// The same, in a failure's text, for one kept only as text (a test's, or a
// message that lost its error). Read in this order: an HTTP status first.
const HTTP_TEXT = /\bHTTP (\d{3})\b/;
/** @type {Array<[RegExp, string]>} */
const TEXT = [
  // JagHelm's own refusals first (safeFetchCore.js, ssrf.js): their messages
  // name origins and hosts, for the log only.
  [/\bredirect/i, 'redirect'],
  [/\bBlocked (?:host|private|URL scheme)\b|\bInvalid URL\b/, 'blocked'],
  [/\bECONNREFUSED\b|connection refused/i, 'refused'],
  [
    /\b(?:ETIMEDOUT|ESOCKETTIMEDOUT|UND_ERR_(?:CONNECT|HEADERS|BODY)_TIMEOUT)\b|\btimed? ?out\b/i,
    'timeout',
  ],
  [/\b(?:ENOTFOUND|EAI_AGAIN|EAI_NONAME|EAI_FAIL|EAI_NODATA)\b|getaddrinfo/i, 'dns'],
  [
    /\b(?:ERR_TLS_\w+|ERR_SSL_\w+|CERT_\w+|UNABLE_TO_\w+|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|EPROTO)\b|certificate|\b(?:TLS|SSL)\b/i,
    'tls',
  ],
  [
    /not valid JSON|\bnot JSON\b|Unexpected token|Unexpected end of JSON|response too large/i,
    'unreadable',
  ],
];

/**
 * @param {unknown} v
 * @returns {v is Record<string, any>}
 */
const isObject = (v) => v !== null && typeof v === 'object';

/**
 * Whether `v` is a failure readFailure gave (a cause it knows), not an Error.
 * @param {unknown} v
 * @returns {v is Failure}
 */
function isFailure(v) {
  return (
    isObject(v) && !(v instanceof Error) && typeof v.cause === 'string' && CAUSE_SET.has(v.cause)
  );
}

/**
 * An HTTP status as a failure: 401 refuses the credentials; any other is `http`.
 * @param {number} status
 * @returns {Failure}
 */
function httpFailure(status) {
  return status === 401 ? { cause: 'auth' } : { cause: 'http', status };
}

/** @param {unknown} s */
const isStatus = (s) => typeof s === 'number' && Number.isInteger(s) && s >= 400 && s <= 599;

/**
 * An error and what it was caused by, outermost first: its `cause` chain, and
 * the errors an AggregateError holds (a connection tried at each address).
 * At most 8, so a cause that loops ends.
 * @param {unknown} err
 * @returns {unknown[]}
 */
function chainOf(err) {
  /** @type {unknown[]} */
  const out = [];
  /** @type {unknown[]} */
  const queue = [err];
  while (queue.length > 0 && out.length < 8) {
    const e = queue.shift();
    if (e == null || out.includes(e)) continue;
    out.push(e);
    if (isObject(e)) {
      if (Array.isArray(e.errors)) queue.push(...e.errors);
      if ('cause' in e) queue.push(e.cause);
    }
  }
  return out;
}

/**
 * The cause an errno or undici code, or an error's name, gives; null for none.
 * @param {unknown} e
 */
function causeOfCode(e) {
  if (!isObject(e)) return null;
  const code = typeof e.code === 'string' ? e.code : '';
  if (REFUSED_CODES.has(code)) return 'refused';
  if (TIMEOUT_CODES.has(code) || e.name === 'TimeoutError') return 'timeout';
  if (DNS_CODES.has(code)) return 'dns';
  if (TLS_CODE.test(code)) return 'tls';
  if (e.name === 'SyntaxError') return 'unreadable';
  return null;
}

/**
 * A failure's cause (CAUSES), with the HTTP `status` for `http`: from an
 * error (see the header), a failure this gave (returned as it is), or a
 * failure's text. Anything it can't read is `unanswered`.
 *
 * @param {unknown} err
 * @returns {Failure}
 */
export function readFailure(err) {
  if (isFailure(err)) {
    const { cause, status } = err;
    if (cause !== 'http') return { cause };
    return isStatus(status) ? { cause, status } : { cause: 'unanswered' };
  }
  const chain = chainOf(err);
  for (const e of chain) if (isObject(e) && isStatus(e.status)) return httpFailure(e.status);
  for (const e of chain) {
    if (
      isObject(e) &&
      typeof e.failure === 'string' &&
      CAUSE_SET.has(e.failure) &&
      e.failure !== 'http'
    ) {
      return { cause: e.failure };
    }
  }
  for (const e of chain) {
    const cause = causeOfCode(e);
    if (cause) return { cause };
  }
  const text = chain.map((e) => (isObject(e) ? String(e.message ?? '') : String(e))).join(' ');
  const http = HTTP_TEXT.exec(text);
  if (http && isStatus(Number(http[1]))) return httpFailure(Number(http[1]));
  for (const [pattern, cause] of TEXT) if (pattern.test(text)) return { cause };
  return { cause: 'unanswered' };
}

/**
 * The sentence a client is sent for `source` failing with `failure` (an
 * error, a failure readFailure gave, or a failure's text): it names the
 * source and the cause, and keeps an HTTP status. `source` is a source's key
 * (prometheus, kuma, gitea, nut), or a name to use as it is. `request` names
 * the read for a refused one, in place of the source's own word
 * ("Prometheus refused the targets read (HTTP 403)").
 *
 * @param {string} source
 * @param {unknown} failure
 * @param {{ request?: string }} [opts]
 */
export function failureSentence(source, failure, { request } = {}) {
  const known = Object.hasOwn(SOURCES, source) ? SOURCES[source] : null;
  const name = known?.name ?? String(source);
  const read = request ?? known?.request ?? 'request';
  const { cause, status } = readFailure(failure);
  switch (cause) {
    case 'refused':
      return `${name} refused the connection`;
    case 'timeout':
      return `${name} didn't answer in time`;
    case 'dns':
      return `${name}'s address didn't resolve`;
    case 'tls':
      return `${name}'s TLS connection failed`;
    case 'auth':
      return `${name} refused the credentials`;
    case 'http':
      return /** @type {number} */ (status) < 500
        ? `${name} refused the ${read} (HTTP ${status})`
        : `${name} answered with an error (HTTP ${status})`;
    case 'rejected':
      return `${name} refused the ${read}`;
    case 'unreadable':
      return `${name}'s answer couldn't be read`;
    case 'empty':
      return known?.empty ?? `${name}'s answer was empty`;
    case 'redirect':
      return `${name}'s redirect wasn't followed (see the log)`;
    case 'blocked':
      return `${name}'s address is blocked (see the log)`;
    case 'off':
      return `${name} is off: its URL is refused`;
    case 'unset':
      return `No ${name} is set up`;
    default:
      return `${name} didn't answer`;
  }
}

/**
 * A failure's raw detail, for the server log only: each message along its
 * cause chain, and a code its message doesn't name ("fetch failed: connect
 * ECONNREFUSED 10.0.0.9:9090"). The logger takes credentials out of it.
 *
 * @param {unknown} err
 */
export function failureDetail(err) {
  if (isFailure(err)) {
    const { cause, status } = err;
    return status ? `${cause} (HTTP ${status})` : cause;
  }
  /** @type {string[]} */
  const parts = [];
  for (const e of chainOf(err)) {
    const message = isObject(e) ? String(e.message ?? '') : String(e);
    const code = isObject(e) && typeof e.code === 'string' ? e.code : '';
    let part = message;
    if (code && !message.includes(code)) part = message ? `${message} (${code})` : code;
    if (part && !parts.some((p) => p.includes(part))) parts.push(part);
  }
  return parts.join(': ') || 'failed';
}
