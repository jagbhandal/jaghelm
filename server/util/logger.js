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
 *
 * A log call never throws: a circular reference is written as "[Circular]", a
 * BigInt as a string, and a line that still can't be written (a throwing getter
 * or toJSON) becomes one with its module and message and a `logError` saying why.
 */
import { redactSecrets } from './redact.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };
const threshold = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;

/**
 * A JSON.stringify replacer for one line: see "Redaction" above. It also writes
 * a BigInt as a string and a circular reference as "[Circular]", which
 * JSON.stringify would throw on. Two keys that redact to the same text keep
 * the last value.
 */
function redacting() {
  // The objects being written, outermost first: what JSON.stringify holds
  // (`this` in the replacer: the caller's object, or its key-redacted copy), and
  // the caller's object it came from, which a cycle points back to.
  const holders = [];
  const originals = [];
  return function (_key, value) {
    while (holders.length > 0 && holders[holders.length - 1] !== this) {
      holders.pop();
      originals.pop();
    }
    if (typeof value === 'string') return redactSecrets(value);
    if (typeof value === 'bigint') return String(value);
    if (value === null || typeof value !== 'object') return value;
    if (value instanceof String) return redactSecrets(value.valueOf());
    if (originals.includes(value)) return '[Circular]';
    let out = value;
    if (!Array.isArray(value)) {
      const keys = Object.keys(value);
      if (keys.some((k) => redactSecrets(k) !== k)) {
        out = Object.fromEntries(keys.map((k) => [redactSecrets(k), value[k]]));
      }
    }
    holders.push(out);
    originals.push(value);
    return out;
  };
}

/**
 * The line for a call whose message or fields could not be written (a getter or
 * toJSON that throws, say): its time, level, module and message, and why. A log
 * call never throws, so a catch or the uncaughtException handler that logs can't
 * fail on its own line.
 */
function unwritableLine(time, level, module, msg, err) {
  let why = 'unknown error';
  try {
    why = redactSecrets(String(err instanceof Error ? err.message : err));
  } catch {
    // an error whose text can't be read: keep the default
  }
  return JSON.stringify({
    time,
    level,
    module,
    msg: typeof msg === 'string' ? redactSecrets(msg) : undefined,
    logError: `the line could not be written in full: ${why}`,
  });
}

function emit(level, module, args) {
  if (LEVELS[level] < threshold) return;

  const time = new Date().toISOString();
  let msg;
  let line;
  try {
    let fields = {};
    const first = args[0];
    if (first && typeof first === 'object' && !(first instanceof Error) && !Array.isArray(first)) {
      msg = args.slice(1).map(String).join(' ');
      fields = { ...first };
    } else {
      msg = args.map((a) => (a instanceof Error ? a.message : a)).join(' ');
    }
    // Flatten an Error passed as a field so it serializes (Error → {} otherwise).
    if (fields.err instanceof Error) fields.err = fields.err.message;

    // Canonical keys are authoritative: a caller field named `msg`/`level`/etc.
    // must not shadow them, so add only non-reserved fields on top.
    const entry = { time, level, module, msg };
    for (const k in fields) if (!(k in entry)) entry[k] = fields[k];
    line = JSON.stringify(entry, redacting());
  } catch (err) {
    line = unwritableLine(time, level, module, msg, err);
  }
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
