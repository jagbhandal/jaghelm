/**
 * Minimal structured (JSON) logger — one JSON object per line, greppable in
 * journald/Loki. In-house rather than pino on purpose: modest log volume here,
 * and this keeps three transitive deps out of the runtime supply chain.
 *
 * Output: info/debug → stdout, warn/error → stderr. Level filtered by LOG_LEVEL
 * (debug|info|warn|error|silent; default 'info'). Both call styles are accepted:
 * a leading fields object is structured; otherwise args are joined console-style.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };
const threshold = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;

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
  const line = JSON.stringify(entry);
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
