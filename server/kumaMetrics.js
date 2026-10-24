/**
 * Uptime Kuma Prometheus `/metrics` parser.
 *
 * Kuma >= 2.1.0 exposes per-monitor series on its authenticated `/metrics`
 * endpoint. We read three of them, keyed on the `monitor_id` label:
 *   - monitor_status            1=up, 0=down, 2=pending, 3=maintenance
 *   - monitor_response_time     latest response time in MS (NOT the windowed
 *                               `monitor_response_time_seconds` sibling)
 *   - monitor_uptime_ratio      uptime over a sliding window; we take window="1d"
 *
 * This yields the SAME monitor-map shape the status-page fetch produces, so every
 * downstream consumer (assignMonitors, assembleServices, selectUnclaimedMonitors)
 * is untouched. Paused monitors are simply absent from `/metrics` (Kuma stops their
 * metrics), so `active`/`lastBeatAt` aren't needed to tell paused from down — we
 * still set `active:true, lastBeatAt:null` to satisfy the shared shape (the
 * staleness guard then treats every metrics monitor as fresh+active, i.e. inert).
 *
 * The parser is deliberately dependency-free and tolerant: real Kuma output
 * carries a dynamic FIRST label per monitor (its tag, e.g. `Infrastructure=""`)
 * whose name varies, plus label values that may contain spaces, parens, commas,
 * or Prometheus escapes (\\ \" \n). We scan labels generically and ignore any we
 * don't care about.
 */

import { targetHostOf } from './monitorNode.js';

/** Prometheus exposition values: numeric, or the literals NaN / +Inf / -Inf. */
function parseValue(tok) {
  if (tok === 'NaN') return NaN;
  if (tok === '+Inf' || tok === 'Inf') return Infinity;
  if (tok === '-Inf') return -Infinity;
  return parseFloat(tok);
}

const isSpace = (c) => c === ' ' || c === '\t';

/**
 * Parse ONE Prometheus exposition line into { name, labels, value } — or null
 * for blank/comment/malformed lines. `value` is a JS number (may be NaN/±Inf).
 * Label values are unescaped (\\ → \, \" → ", \n → newline) per the spec.
 */
export function parsePromLine(line) {
  if (typeof line !== 'string') return null;
  const s = line.trim();
  if (!s || s[0] === '#') return null;

  const nameMatch = /^[a-zA-Z_:][a-zA-Z0-9_:]*/.exec(s);
  if (!nameMatch) return null;
  const name = nameMatch[0];
  let i = name.length;
  const labels = {};

  if (s[i] === '{') {
    i++; // past '{'
    while (i < s.length) {
      while (i < s.length && isSpace(s[i])) i++;
      if (s[i] === '}') {
        i++;
        break;
      }

      const ln = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(s.slice(i));
      if (!ln) return null; // malformed label name
      const key = ln[0];
      i += key.length;

      while (i < s.length && isSpace(s[i])) i++;
      if (s[i] !== '=') return null;
      i++;
      while (i < s.length && isSpace(s[i])) i++;
      if (s[i] !== '"') return null;
      i++; // past opening quote

      let val = '';
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\') {
          const next = s[i + 1];
          if (next === 'n') val += '\n';
          else if (next === '"') val += '"';
          else if (next === '\\') val += '\\';
          else val += next; // unknown escape: keep the escaped char verbatim
          i += 2;
        } else {
          val += s[i];
          i++;
        }
      }
      if (s[i] !== '"') return null; // unterminated value
      i++; // past closing quote
      labels[key] = val;

      while (i < s.length && isSpace(s[i])) i++;
      if (s[i] === ',') {
        i++;
        continue;
      }
      if (s[i] === '}') {
        i++;
        break;
      }
      break; // anything else: stop scanning labels, be lenient
    }
  }

  const rest = s.slice(i).trim();
  if (!rest) return null;
  const valueTok = rest.split(/\s+/)[0]; // ignore an optional trailing timestamp
  return { name, labels, value: parseValue(valueTok) };
}

export function statusFromValue(v) {
  return v === 1 ? 'up' : v === 0 ? 'down' : 'unknown';
}

// Kuma's own status values, the status page's heartbeat `status` included.
const KUMA_STATUS = new Map([
  [0, 'down'],
  [1, 'up'],
  [2, 'pending'],
  [3, 'maintenance'],
]);

/**
 * A monitor's status as Kuma reports it: 'up', 'down', 'pending' (retrying a
 * failed check), 'maintenance' or 'unknown'. `status` (statusFromValue) folds
 * pending and maintenance into 'unknown', which /api/services keeps showing
 * (spec §6.3); only the status model reads this one (#258, #290).
 */
export function kumaStatusFromValue(v) {
  return KUMA_STATUS.get(v) ?? 'unknown';
}

/**
 * Parse a full `/metrics` body into the monitor map keyed by id:
 *   { [id]: { id:Number, name, status, kumaStatus, ping, uptime24, active:true, lastBeatAt:null, targetHost? } }
 * `targetHost` is the host name the monitor checks (monitor_hostname, else the
 * host of monitor_url), when it has one: a name, never credentials or a URL (#644).
 *
 * Series WITHOUT a `monitor_id` label are skipped — that includes every Kuma
 * system metric and (critically) Kuma < 2.1, whose monitor series lack
 * `monitor_id`. An empty result is the caller's signal to fall back to the
 * status-page API.
 */
export function parseKumaMetrics(text) {
  // Prototype-less map: defense-in-depth so a crafted id can never reach
  // Object.prototype even if the canonical-id guard below were weakened.
  const monitors = Object.create(null);
  if (!text || typeof text !== 'string') return monitors;

  const ensure = (id, name, labels) => {
    if (!monitors[id]) {
      monitors[id] = {
        id: Number(id),
        name: name || '',
        status: 'unknown',
        kumaStatus: 'unknown',
        ping: null,
        uptime24: null,
        active: true,
        lastBeatAt: null,
      };
    } else if (name && !monitors[id].name) {
      monitors[id].name = name;
    }
    // Where the monitor looks, as a host name only (#644): a node is chosen
    // by it. Never the URL itself, which may carry credentials or a token.
    if (labels && monitors[id].targetHost === undefined) {
      const host = targetHostOf(labels);
      if (host) monitors[id].targetHost = host;
    }
    return monitors[id];
  };

  for (const line of text.split('\n')) {
    if (line.length > 65536) continue; // skip pathologically long lines (DoS guard)
    const p = parsePromLine(line);
    if (!p) continue;
    // monitor_id must be a canonical non-negative integer (Kuma's DB id). This
    // rejects prototype-pollution keys ("__proto__" / "constructor" / "prototype")
    // and Number()-collision spoofs ("5e3", " 5000") BEFORE id is used as a map
    // key — a parser must never let its input corrupt interpreter state.
    const id = p.labels.monitor_id;
    if (!/^\d+$/.test(id ?? '')) continue;

    if (p.name === 'monitor_status') {
      const m = ensure(id, p.labels.monitor_name, p.labels);
      m.status = statusFromValue(p.value);
      m.kumaStatus = kumaStatusFromValue(p.value);
    } else if (p.name === 'monitor_response_time') {
      const m = ensure(id, p.labels.monitor_name, p.labels);
      m.ping = Number.isFinite(p.value) ? p.value : null;
    } else if (p.name === 'monitor_uptime_ratio') {
      if (p.labels.window !== '1d') continue; // only the 24h window maps to uptime24
      const m = ensure(id, p.labels.monitor_name, p.labels);
      m.uptime24 = Number.isFinite(p.value) ? p.value : null;
    }
  }

  return monitors;
}
