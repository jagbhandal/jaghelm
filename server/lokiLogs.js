/**
 * Recent errors from Loki (#672): what GET /api/logs serves for a node's or a
 * container's detail, read-only and bounded.
 *
 * One LogQL query_range per entity, never LogQL from the client: the selector
 * is built here from the server's own names (a node of services.yaml, a
 * container the server has seen on it, as promHistory.js resolves them) and
 * each value is escaped into a double-quoted LogQL string (`logqlString`), so
 * a name with a quote, a backslash or a newline can't end the string or add a
 * matcher. The lines asked for are the error-ish ones of the last 6 hours
 * (a case-insensitive error, warn, fatal, panic or critical), newest first,
 * at most 20; Loki gets a 4 s timeout.
 *
 * The labels are the homelab's Alloy ones: `host` (the node's `loki_host` in
 * services.yaml, else its key: not the Prometheus label, which differs) and
 * `container_name`. A node reads every container on
 * it; a container reads its own on that node.
 *
 * Each line is made safe before it goes out (`cleanLine`): terminal escapes
 * and control characters go, then credentials (`redactSecrets`, plus
 * Authorization/Bearer values and token/password/secret/api-key pairs, which
 * JagHelm itself once logged), then it is cut at 300 characters. A JSON line
 * with a `msg` shows as `level module: msg` only, so its other fields never
 * go out. Private keys, webhook URLs, JWTs and well-known token shapes go too.
 * Each line also carries a `level` (`levelOf`, #844): `fatal`, `error`, `warn` or
 * `other`, read once here from the line itself so the detail only draws it.
 * An answer is cached 30 s per entity (reads of one being asked share the query), a
 * failed one 10 s.
 *
 * The answer is always `{ state, lines, reason? }`: `ok` with lines, `none`
 * (streams exist, no error-ish line in 6 h: the real all-clear), `silent`
 * (no line at all in 6 h for the host or container, `reason` naming it: a host
 * that is off, or a `loki_host` that doesn't match), or `unavailable` with a
 * fixed sentence (failureWords.js) when
 * LOKI_URL is unset or refused or Loki doesn't answer. The detail says so in
 * place; it never raises an error for it. Loki's own text and the fetch's
 * go to the log only.
 */
import { readEnv } from './env.js';
import { failureDetail, failureSentence } from './failureWords.js';
import { safeFetch } from './httpClient.js';
import { containersOn } from './promHistory.js';
import { getConfig } from './config.js';
import { redactSecrets, urlCredential } from './util/redact.js';
import { createLogger } from './util/logger.js';

const log = createLogger('logs');

export const LOG_LIMIT = 20;
export const LOG_WINDOW_SEC = 6 * 3600;
export const LOG_LINE_MAX = 300;
export const LOG_TIMEOUT_MS = 4_000;
export const LOG_TTL_MS = 30_000;
export const LOG_FAILURE_TTL_MS = 10_000;
const RAW_MAX = 4_000;
const MAX_ENTITY = 200;
const MAX_ENTRIES = 100;

/** The lines asked for: these words, any case, as words. RE2 syntax, escaped for LogQL below. */
const ERRORISH = String.raw`(?i)\b(error|err|warn|warning|fatal|panic|critical|crit)\b`;

/** A value as a double-quoted LogQL string: backslash, quote and control characters escaped. */
export function logqlString(value) {
  // eslint-disable-next-line no-control-regex -- escaping control characters is the point
  const body = String(value).replace(/[\\"\u0000-\u001f\u007f]/g, (c) => {
    if (c === '\\') return '\\\\';
    if (c === '"') return '\\"';
    if (c === '\n') return '\\n';
    if (c === '\r') return '\\r';
    if (c === '\t') return '\\t';
    return `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`;
  });
  return `"${body}"`;
}

/** Any line at all of the target, no filter: whether it sent logs in the window. */
export function streamQuery({ label, container }) {
  const matchers = [`host=${logqlString(label)}`];
  if (container) matchers.push(`container_name=${logqlString(container)}`);
  return `{${matchers.join(',')}}`;
}

/** The query for a resolved target: `{ label, container }` (container null for a whole node). */
export function logQuery({ label, container }) {
  const matchers = [`host=${logqlString(label)}`];
  if (container) matchers.push(`container_name=${logqlString(container)}`);
  return `{${matchers.join(',')}} |~ ${logqlString(ERRORISH)}`;
}

/** A label value Loki can hold as a host: a name, no quotes, spaces or control characters. */
const HOST_LABEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/**
 * The `host` label Loki knows a node by: its `loki_host` in services.yaml when
 * that is a plain name (anything else is ignored, not queried), else the
 * node's key. Not the Prometheus label: the two differ on the homelab
 * (`vm103` there, `vm-103` in Loki).
 */
export function lokiHostOf(nodeKey, cfg) {
  const own = cfg?.loki_host;
  return typeof own === 'string' && HOST_LABEL.test(own) ? own : nodeKey;
}

/**
 * The node and container a request names, from the server's own records, or
 * `{ ok: false, status, error }`: 400 for a malformed entity, 404 for a node
 * or container it doesn't have. The names returned are the server's own.
 */
export function resolveTarget(entity, config = getConfig(), known = containersOn) {
  // eslint-disable-next-line no-control-regex -- refusing control characters is the point
  if (typeof entity !== 'string' || !entity || entity.length > MAX_ENTITY || /[\u0000-\u001f\u007f]/.test(entity)) {
    return { ok: false, status: 400, error: 'Malformed entity' };
  }
  const nodes =
    config?.nodes && typeof config.nodes === 'object' && !Array.isArray(config.nodes) ? config.nodes : {};
  const cut = entity.lastIndexOf('/');
  const nodeKey = cut === -1 ? entity : entity.slice(0, cut);
  if (cut === 0 || cut === entity.length - 1) {
    return { ok: false, status: 400, error: 'Malformed entity: a container is <node>/<container>' };
  }
  if (!Object.hasOwn(nodes, nodeKey) || nodes[nodeKey]?.visible === false) {
    return { ok: false, status: 404, error: 'No node by that name in services.yaml' };
  }
  const label = lokiHostOf(nodeKey, nodes[nodeKey]);
  if (cut === -1) return { ok: true, node: nodeKey, label, container: null };
  const asked = entity.slice(cut + 1);
  const container = [...known(nodeKey)].find((n) => n === asked);
  if (container === undefined) {
    return { ok: false, status: 404, error: 'No container by that name on that node' };
  }
  return { ok: true, node: nodeKey, label, container };
}

// eslint-disable-next-line no-control-regex -- stripping terminal escapes is the point
const ANSI = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[@-Z\\-_])/g;
// eslint-disable-next-line no-control-regex -- and control characters, and format characters that reorder or hide text
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;
const PEM = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[^]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----|$)/g;
const WEBHOOK =
  /(https?:\/\/(?:hooks\.slack\.com\/(?:services|workflows|triggers)|(?:[a-z]+\.)?discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks)\/)[^\s"'<>]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}(?:\.[A-Za-z0-9_-]*)?/g;
const TOKENS =
  /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|glpat-[A-Za-z0-9_-]{12,}|sk-ant-[A-Za-z0-9_-]{12,}|sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|xox[abeprs]-[A-Za-z0-9-]{8,})/g;
const BEARER = /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{6,}/gi;
const AUTH_HEADER =
  /\b(Authorization|Proxy-Authorization|Cookie|Set-Cookie|X-Api-Key|Api-Key|X-Auth-Token|X-Access-Token|X-Csrf-Token|X-Amz-Security-Token)(["']?\s*[:=]\s*["']?)[^"']*/gi;
const VALUE = String.raw`("(?:[^"\\]|\\.)*"|'[^']*'|[^\s"',&;}]+)`;
// token/password/secret/api-key in a name (any case), and pass/pwd alone.
const SECRET_PAIR = new RegExp(
  String.raw`\b((?:[a-z0-9_-]*(?:token|password|passwd|secret|api[_-]?key|apikey|pwd)[a-z0-9_-]*|pass))(["']?\s*[:=]\s*)${VALUE}`,
  'gi'
);
// env style: DB_PASS=, SMTP_PASSWORD=, AWS_SECRET=, GH_TOKEN=, STRIPE_KEY= (capitals, so `key=` alone stays).
const ENV_PAIR = new RegExp(
  String.raw`\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_(?:KEY|PASS|PASSWORD|PWD|SECRET|TOKEN))(\s*[=:]\s*)${VALUE}`,
  'g'
);

/** A JSON log line (pino, slog, …) as `level module: message`, else the line as it is. */
function plainOf(raw, badge = false) {
  if (!raw.startsWith('{') || raw.length >= RAW_MAX) return raw;
  try {
    const o = JSON.parse(raw);
    const msg = o?.msg ?? o?.message;
    if (typeof msg !== 'string' || !msg) return raw;
    const level = !badge && typeof o.level === 'string' ? o.level : '';
    const mod = typeof o.module === 'string' && o.module ? `${o.module}: ` : '';
    return `${level ? `${level} ` : ''}${mod}${msg}`;
  } catch {
    return raw;
  }
}

/**
 * A line made safe to show: see the header. `badge`: the detail draws the line's level
 * as a marker, so a JSON line's own level word is left off (`monitors: msg`, not `warn monitors: msg`).
 * Never longer than LOG_LINE_MAX (plus an ellipsis).
 */
export function cleanLine(raw, { badge = false } = {}) {
  let s = plainOf(String(raw ?? '').slice(0, RAW_MAX), badge);
  s = s.replace(ANSI, '').replace(/[\t\r\n]+/g, ' ').replace(CONTROL, '');
  s = s
    .replace(PEM, '[redacted private key]')
    .replace(WEBHOOK, '$1[redacted]')
    .replace(JWT, '[redacted]')
    .replace(TOKENS, '[redacted]');
  s = redactSecrets(s);
  s = s
    .replace(AUTH_HEADER, '$1$2[redacted]')
    .replace(BEARER, '$1 [redacted]')
    .replace(ENV_PAIR, '$1$2[redacted]')
    .replace(SECRET_PAIR, '$1$2[redacted]');
  s = s.trim();
  return s.length > LOG_LINE_MAX ? `${s.slice(0, LOG_LINE_MAX)}…` : s;
}

// ---- Severity of a line (#844) ----------------------------------------------

const FATAL_WORDS = new Set(['fatal', 'panic', 'critical', 'crit', 'emerg', 'emergency', 'alert', 'severe']);
const ERROR_WORDS = new Set(['error', 'err', 'erro', 'eror']);
const WARN_WORDS = new Set(['warn', 'warning', 'wrn']);
const OTHER_WORDS = new Set(['info', 'inf', 'notice', 'debug', 'dbg', 'trace', 'trc', 'verbose']);
// A bare word at the start of a line is prose unless it is one of these: `alert` and `emerg`
// are real syslog levels but too ordinary as a first word.
const BARE_WORDS = [...FATAL_WORDS, ...ERROR_WORDS, ...WARN_WORDS, ...OTHER_WORDS]
  .filter((w) => !['alert', 'emerg', 'emergency', 'severe', 'verbose'].includes(w))
  .join('|');
// `level=E`, and glog's `E1031`.
const LETTERS = { e: 'error', w: 'warn', f: 'fatal', c: 'fatal', i: 'other', d: 'other', t: 'other' };

/** A level word (`ERR`, `warning`, `crit`) as fatal/error/warn/other, or null for a word that isn't one. */
function wordLevel(word, letters = false) {
  const w = String(word).toLowerCase();
  if (FATAL_WORDS.has(w)) return 'fatal';
  if (ERROR_WORDS.has(w)) return 'error';
  if (WARN_WORDS.has(w)) return 'warn';
  if (OTHER_WORDS.has(w)) return 'other';
  if (letters && LETTERS[w]) return LETTERS[w];
  return null;
}

/** A pino-style number: 60 fatal, 50 error, 40 warn, below that nothing to colour. */
function numberLevel(n) {
  if (n >= 60) return 'fatal';
  if (n >= 50) return 'error';
  if (n >= 40) return 'warn';
  return 'other';
}

const LEVEL_KEYS = ['level', 'lvl', 'severity', 'loglevel', 'log_level', 'levelname'];
const KEY = '(?:level|lvl|severity|log_?level|levelname)';
// A word level stated as a key: `level=error`, `severity=warning`, `"level":"error"`. The key
// starts the line or follows a space, comma or brace, so `zoom_level=x` is no key.
const KEYED = new RegExp(`(?:^|[\\s,{;])(?:${KEY}=|"${KEY}"\\s*:\\s*)"?([A-Za-z]+)`, 'i');
// A number level only from a logfmt line: `level=50` among the first four key=value tokens of a
// line that starts with one and has at least three. Prose like `battery level: 45` or
// `zoom level=60 failed` states no level.
const LOGFMT_NUMBER = new RegExp(
  `^(?:[\\w.-]+=(?:"(?:[^"\\\\]|\\\\.)*"|\\S*)\\s+){0,3}${KEY}=(\\d+)(?=\\s|$)`,
  'i'
);
const PAIR = /(?:^|\s)[\w.-]+=/g;
// A timestamp before the level: numbers, and a month name only when a day follows it
// (`Oct 31 08:30:45.456`, `Mon Oct 31 ...`), so `Monitor error:` and `Decoding error` are not one.
const WEEKDAY = '(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\\s+';
const MONTH = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?\\s+(?=\\d)';
const STAMP = new RegExp(`^(?:[\\d\\s:./,+\\-]|(?<=\\d)[TZ]|(?:${WEEKDAY})?${MONTH})*`);
// At most one `program:`, `program[pid]:` or `health(warnable=x):` prefix after it.
const PROGRAM = /^[\w./-]+(?:\[\d+\]|\([^)\s]{0,80}\))?:\s+/;
const BARE = new RegExp(`^(${BARE_WORDS})(?![\\w=])`, 'i');
const BRACKET = new RegExp(`[\\[(<|](${BARE_WORDS})[\\])>|:]`, 'i');
const GLOG = /^([EWFI])\d{4}\s/;
// Square-bracket groups after the head: vaultwarden `[ts][module][WARN]`, radicale
// `[ts +0000] [1/Thread-9 (x)] [WARNING]`, gitea `.../x.go:55:fn() [W] msg`. Bounded: 8 groups of
// at most 120 characters, the first that states a level wins.
const GROUPS = /^(?:\s*\[[^\]]{0,120}\]){1,8}/;
const GROUP = /\[([^\]]{0,120})\]/g;
const CALLER = /^\S{1,120}\s+/;
// immich/Nest: `[Nest] 7  - 10/31/2026, 12:00:01 AM   ERROR [Microservices:x] msg`.
const NEST = new RegExp(`^\\[Nest\\]\\s+\\d+\\s+-\\s+\\S+\\s+\\S+\\s+[AP]M\\s+(${BARE_WORDS}|log|verbose)\\b`, 'i');

/** A level from the inside of one `[...]`: a level word, or a lone E/W/F/C as gitea writes it. */
function groupLevel(inner) {
  const t = inner.trim();
  if (new RegExp(`^(?:${BARE_WORDS})$`, 'i').test(t)) return wordLevel(t);
  return /^[EWFC]$/.test(t) ? wordLevel(t, true) : null;
}

function bracketGroupLevel(text, from) {
  const run = GROUPS.exec(text.slice(from));
  if (!run) return null;
  for (const m of run[0].matchAll(GROUP)) {
    const level = groupLevel(m[1]);
    if (level) return { at: from + run.index + m.index, level };
  }
  return null;
}

/** A control-free copy for reading the head of a line: terminal colour codes would hide the level word. */
function plainHead(raw) {
  return String(raw).replace(ANSI, '').replace(/[\t\r\n]+/g, ' ').trim().slice(0, 400);
}

/** The level a parsed JSON object states: `level`, `severity`, `levelname`, ECS's `log.level`; a word, or pino's number. */
function jsonLevel(o) {
  for (const v of [...LEVEL_KEYS.map((k) => o[k]), o.log?.level]) {
    if (typeof v === 'number') return numberLevel(v);
    if (typeof v === 'string' && v) {
      return /^\d+$/.test(v) ? numberLevel(Number(v)) : (wordLevel(v, true) ?? 'other');
    }
  }
  return 'other';
}

/**
 * How severe a log line says it is: `fatal` (fatal, panic, critical, crit),
 * `error`, `warn`, or `other` (info, debug, or no level the line states). It
 * reads only what the line states, and the first statement wins:
 *  - a JSON line's own level field (`level`, `severity`, `levelname`, `log.level`;
 *    a word, or pino's 60/50/40: a number counts only here and in logfmt);
 *  - a word via a key: `level=error`, `"level":"error"`, `severity=warning`; a number
 *    only as `level=50` in a logfmt-shaped line (key=value tokens from the start);
 *  - square-bracket groups after the timestamp and at most one caller token:
 *    `[ERROR]`, `[2026-10-31][mod][WARN]`, gitea's `[W]`; and a bracketed word in
 *    the first 40 characters: `(WRN)`;
 *  - a glog prefix `E1031 12:00:00`; immich's `[Nest] 7 - date AM   ERROR`;
 *  - a word at the line's head, after a timestamp and an optional `program:`:
 *    `ERROR: ...`, `Oct 31 08:30 WRN ...`, `WARN [x]`, `health(warnable=x): error:`.
 * A level word elsewhere in the message ("no error", "errors=0", "retry after
 * error", "battery level: 45") is not a level: such a line is `other`, never
 * guessed. Run on the raw line, before cleanLine rewrites a JSON line. A JSON
 * line of RAW_MAX characters or more is not parsed (cleanLine shows it raw too),
 * so it is read as text, by word only.
 */
export function levelOf(raw) {
  const whole = String(raw ?? '').slice(0, RAW_MAX);
  const text = plainHead(whole);
  if (!text) return 'other';
  const trimmed = whole.trim();
  if (trimmed.startsWith('{') && whole.length < RAW_MAX) {
    try {
      const o = JSON.parse(trimmed);
      if (o && typeof o === 'object' && !Array.isArray(o)) return jsonLevel(o);
    } catch {
      // not JSON after all: read it as text
    }
  }
  // Candidates by position; the earliest statement wins.
  const found = [];
  const keyed = KEYED.exec(text);
  const keyedLevel = keyed ? wordLevel(keyed[1], true) : null;
  if (keyedLevel) found.push({ at: keyed.index, level: keyedLevel });
  const number = LOGFMT_NUMBER.exec(text);
  if (number && (text.match(PAIR) ?? []).length >= 3) {
    found.push({ at: number.index, level: numberLevel(Number(number[1])) });
  }
  const bracket = BRACKET.exec(text.slice(0, 40));
  if (bracket) found.push({ at: bracket.index, level: wordLevel(bracket[1]) });
  const glog = GLOG.exec(text);
  if (glog) found.push({ at: 0, level: wordLevel(glog[1], true) });
  const nest = NEST.exec(text);
  if (nest) found.push({ at: 0, level: wordLevel(nest[1]) ?? 'other' });
  const stamp = STAMP.exec(text)[0].length;
  const caller = CALLER.exec(text.slice(stamp));
  for (const from of [0, stamp, caller ? stamp + caller[0].length : -1]) {
    const g = from >= 0 ? bracketGroupLevel(text, from) : null;
    if (g) {
      found.push(g);
      break;
    }
  }
  const bare = BARE.exec(text.slice(stamp));
  if (bare) found.push({ at: stamp, level: wordLevel(bare[1]) });
  else {
    const program = PROGRAM.exec(text.slice(stamp));
    const after = program ? BARE.exec(text.slice(stamp + program[0].length)) : null;
    if (after) found.push({ at: stamp + program[0].length, level: wordLevel(after[1]) });
  }
  if (!found.length) return 'other';
  found.sort((a, b) => a.at - b.at);
  return found[0].level;
}

/** A Loki streams result as the newest LOG_LIMIT lines `{ at (ms), text, level }`. */
export function linesOf(result) {
  const found = [];
  for (const stream of Array.isArray(result) ? result : []) {
    for (const pair of Array.isArray(stream?.values) ? stream.values : []) {
      const [ns, text] = Array.isArray(pair) ? pair : [];
      const at = Math.floor(Number(ns) / 1e6);
      if (!Number.isFinite(at) || typeof text !== 'string') continue;
      found.push({ at, text });
    }
  }
  found.sort((a, b) => b.at - a.at);
  return found
    .slice(0, LOG_LIMIT)
    .map(({ at, text }) => {
      const level = levelOf(text);
      return { at, text: cleanLine(text, { badge: level !== 'other' }), level };
    })
    .filter((l) => l.text);
}

class LokiError extends Error {}

/** Loki's URL, or why there is none (`unset`, or `off` for one that carries a credential). */
function lokiUrl(env) {
  const { value } = readEnv('LOKI_URL', env);
  if (!value) return { failure: 'unset' };
  if (urlCredential(value)) return { failure: 'off' };
  return { url: String(value).replace(/\/+$/, '') };
}

/**
 * The cache of answers. `fetcher` is safeFetch's signature, `now` the clock
 * in ms, `env` the process's environment, `resolve` resolveTarget's.
 */
export function createLogPeek({
  fetcher = safeFetch,
  now = Date.now,
  env,
  resolve = resolveTarget,
  logger = log,
} = {}) {
  const asking = new Map();
  const kept = new Map(); // key -> { body, until }; oldest written goes first
  let failing = null;

  async function read(target) {
    const where = lokiUrl(env);
    if (where.failure) {
      return { state: 'unavailable', lines: [], reason: failureSentence('loki', { cause: where.failure }) };
    }
    const end = now();
    const ask = async (query, limit) => {
      const params = new URLSearchParams({
        query,
        start: String((end - LOG_WINDOW_SEC * 1000) * 1e6),
        end: String(end * 1e6),
        limit: String(limit),
        direction: 'backward',
      });
      const r = await fetcher(`${where.url}/loki/api/v1/query_range?${params}`, {
        trusted: true,
        timeoutMs: LOG_TIMEOUT_MS,
      });
      if (!r.ok) throw Object.assign(new LokiError(`Loki answered HTTP ${r.status}`), { status: r.status });
      const body = await r.json();
      if (body?.status !== 'success' || !Array.isArray(body?.data?.result)) {
        throw Object.assign(new LokiError('Loki returned no result'), { failure: 'unreadable' });
      }
      return body.data.result;
    };
    try {
      const lines = linesOf(await ask(logQuery(target), LOG_LIMIT));
      if (lines.length) {
        if (failing) logger.info('Loki answers again');
        failing = null;
        return { state: 'ok', lines };
      }
      // No error line: a quiet target, or one Loki has no stream for (a host label that
      // doesn't match). One unfiltered line tells them apart; only the first is the all-clear.
      const any = await ask(streamQuery(target), 1);
      if (failing) logger.info('Loki answers again');
      failing = null;
      const seen = any.some((st) => Array.isArray(st?.values) && st.values.length > 0);
      if (seen) return { state: 'none', lines: [] };
      const subject = target.container ? `${target.container} on ${target.label}` : target.label;
      return { state: 'silent', lines: [], reason: subject };
    } catch (err) {
      const detail = failureDetail(err);
      if (failing !== detail) logger.warn({ detail }, 'Loki read failed');
      failing = detail;
      return { state: 'unavailable', lines: [], reason: failureSentence('loki', err) };
    }
  }

  /** `{ status, body }` for a parsed `entity` string. */
  async function answer(entity) {
    const target = resolve(entity);
    if (!target.ok) return { status: target.status, body: { error: target.error } };
    const key = `logs|${target.node}|${target.container ?? ''}`;
    const hit = kept.get(key);
    if (hit && hit.until > now()) return { status: 200, body: hit.body };
    if (!asking.has(key)) {
      const p = read(target)
        .then((body) => {
          const ttl = body.state === 'unavailable' ? LOG_FAILURE_TTL_MS : LOG_TTL_MS;
          kept.delete(key);
          if (kept.size >= MAX_ENTRIES) kept.delete(kept.keys().next().value);
          kept.set(key, { body, until: now() + ttl });
          return body;
        })
        .finally(() => asking.delete(key));
      asking.set(key, p);
    }
    return { status: 200, body: await asking.get(key) };
  }

  /** Forget every kept answer (tests). */
  const clear = () => kept.clear();

  return { answer, clear };
}

export const logPeek = createLogPeek();
