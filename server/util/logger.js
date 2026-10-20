/**
 * Minimal structured (JSON) logger — one JSON object per line, greppable in
 * journald/Loki. In-house rather than pino on purpose: modest log volume here,
 * and this keeps three transitive deps out of the runtime supply chain.
 *
 * Output: info/debug → stdout, warn/error → stderr. Level filtered by LOG_LEVEL
 * (debug|info|warn|error|silent; default 'info'). Both call styles are accepted:
 * a leading fields object is structured; otherwise args are joined console-style.
 *
 * Redaction (#409): every string in the line goes through redactSecrets on its
 * way out, whatever the call site hands over: the message, each field at any
 * depth, object keys, an Error's message (an `err` field, or an Error in the
 * args) and any property it carries (`url`, `input`), and a URL object, which
 * JSON writes as its address. Node's fetch refuses a URL with `user:pass@`, and
 * its error names the full URL. A URL keeps its scheme, user and host; the
 * password and the query string go. The caller's objects are never changed: it
 * runs as the JSON.stringify replacer, which builds a new object only for one
 * with a key to redact, and a string with no @, ? or & is not searched.
 */
import { redactSecrets } from './redact.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };
const threshold = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;

/** JSON.stringify replacer: see "Redaction" above. */
function redacting(_key, value) {
  if (typeof value === 'string') return redactSecrets(value);
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (keys.some((k) => redactSecrets(k) !== k)) {
      return Object.fromEntries(keys.map((k) => [redactSecrets(k), value[k]]));
    }
  }
  return value;
}

function emit(level, module, args) {
  if (LEVELS[level] < threshold) return;

  let fields = {};
  let msg;
  const first = args[0];
  if (first && typeof first === 'object' && !(first instanceof Error) && !Array.isArray(first)) {
    fields = { ...first };
    msg = args.slice(1).map(String).join(' ');
  } else {
    msg = args.map((a) => (a instanceof Error ? a.message : a)).join(' ');
  }
  // Flatten an Error passed as a field so it serializes (Error → {} otherwise).
  if (fields.err instanceof Error) fields.err = fields.err.message;

  // Canonical keys are authoritative: a caller field named `msg`/`level`/etc.
  // must not shadow them, so add only non-reserved fields on top.
  const entry = { time: new Date().toISOString(), level, module, msg };
  for (const k in fields) if (!(k in entry)) entry[k] = fields[k];
  const line = JSON.stringify(entry, redacting);
  if (level === 'warn' || level === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

/** Create a logger bound to a module name (shown as the `module` field). */
export function createLogger(module = 'app') {
  return {
    debug: (...a) => emit('debug', module, a),
    info: (...a) => emit('info', module, a),
    warn: (...a) => emit('warn', module, a),
    error: (...a) => emit('error', module, a),
    /** Derive a sub-module logger, e.g. createLogger('auth').child('routes'). */
    child: (sub) => createLogger(`${module}:${sub}`),
  };
}

export const logger = createLogger('app');
