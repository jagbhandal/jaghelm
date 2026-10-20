/**
 * The severity rules of spec §6.1, one function per entity kind (#290). Each
 * takes the readings for one entity, plus what the model remembers of it from
 * the previous cycle where a rule needs it (hysteresis, "for 2 cycles"), and
 * returns its verdict:
 *
 *   { state, word, reason, metric?, conditions?, sinceHint?, memo? }
 *
 * `state` is one of STATES. `word` is the short status word an issue row shows
 * ("Down", "On battery"). `reason` is a short sentence with no times in it:
 * times go in the entity's `since`, which the clients show in the viewer's own
 * clock and language, so a reason doesn't change from one cycle to the next and
 * doesn't depend on the server's time zone. `sinceHint` is when the state
 * began, when the readings say (a job's run, a container last seen); the model
 * otherwise uses the cycle it first saw the state in. `memo` is what the rule
 * needs from this cycle next time.
 *
 * Pure: no clock (it is passed in), no I/O, no module state.
 */
import { graceSeconds, isOverdue } from '../cron-overdue.js';
import { redactSecrets } from '../util/redact.js';

/** The five states, named as src/ui/lib/status.js names them (a test keeps them in step). */
export const STATES = Object.freeze(['ok', 'warn', 'crit', 'unknown', 'maintenance']);

/**
 * The status words push reads beside an entity's state (push/snapshot.js,
 * #292): a service that is ok or warn only because Kuma is retrying a check
 * (Pending) holds its last known state, a crit node is unreachable or over a
 * line, and a job's warning is a failed run or an overdue one.
 */
export const WORDS = Object.freeze({
  pending: 'Pending',
  unreachable: 'Unreachable',
  failed: 'Failed',
  overdue: 'Overdue',
});

// Worst-of order (spec §6.1): crit > warn > unknown > maintenance > ok.
const RANK = { ok: 0, maintenance: 1, unknown: 2, warn: 3, crit: 4 };

/** The worst of `states` by the worst-of order; 'ok' for none. */
export function worstOf(states) {
  let worst = 'ok';
  for (const s of states) if (RANK[s] > RANK[worst]) worst = s;
  return worst;
}

/** How bad a state is: higher is worse. */
export function stateRank(state) {
  return RANK[state] ?? RANK.unknown;
}

// The longest error text a reason carries, in characters.
const ERROR_MAX = 120;

/** An upstream's error text fit for a reason: credentials out, then cut. */
export function errorText(raw) {
  const clean = redactSecrets(String(raw ?? '')).trim();
  return clean.length > ERROR_MAX ? `${clean.slice(0, ERROR_MAX)}…` : clean;
}

/** A line as a percentage: whole, or with one decimal when it has one. */
function pct(fraction) {
  return `${Number((fraction * 100).toFixed(1))} %`;
}

// A reading is shown whole and rounded down, so it never reads as over a
// whole-number line it is under (94.6 % under a 95 % line reads 94 %), and
// small moves (61.2 to 61.4) leave the reason, and the model, unchanged.
const wholePct = (fraction) => Math.floor(fraction * 100 + 1e-9);
const readingPct = (fraction) => `${wholePct(fraction)} %`;

/** A duration for a sentence, in the units cron's overdue line uses (fmtSpan). */
export function spanText(seconds) {
  const s = Math.max(0, seconds);
  if (s < 7200) return `${Math.round(s / 60)} min`;
  if (s < 172800) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} d`;
}

/**
 * A host metric (percentage string "0".."100" or bare number) as a 0..1
 * fraction, clamped. Non-finite / null / junk => 0.
 */
export function coerceFraction(raw) {
  const n = typeof raw === 'number' ? raw : parseFloat(raw);
  if (!Number.isFinite(n)) return 0;
  const frac = n / 100;
  if (frac < 0) return 0;
  if (frac > 1) return 1;
  return frac;
}

/** A usage reading (percent string or number) as a 0..1 fraction, or null when there is none. */
function fractionOf(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : parseFloat(raw);
  return Number.isFinite(n) ? coerceFraction(raw) : null;
}

function celsiusOf(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * A reading's level against a warn line and an optional crit line, with
 * hysteresis: a level reached holds until the reading falls `hysteresis` below
 * its line (push/differ.js clears at `limit - hysteresis` the same way).
 */
export function levelOf(value, prevLevel, { warn, crit }, hysteresis) {
  if (crit != null && value >= crit) return 'crit';
  if (crit != null && prevLevel === 'crit' && value >= crit - hysteresis) return 'crit';
  if (warn != null && value >= warn) return 'warn';
  if (warn != null && (prevLevel === 'warn' || prevLevel === 'crit') && value >= warn - hysteresis)
    return 'warn';
  return 'ok';
}

// ── Node ─────────────────────────────────────────────────────────────────

// What a node reading is called in a sentence, and its Prometheus read
// (discovery.js NODE_READS).
const NODE_METRICS = [
  { key: 'disk', label: 'Disk', noun: 'disk', read: 'disk', field: 'diskPercent' },
  { key: 'temp', label: 'Temperature', noun: 'temperature', read: 'temp', field: 'temp' },
  { key: 'mem', label: 'Memory', noun: 'memory', read: 'mem', field: 'memPercent' },
  { key: 'cpu', label: 'CPU', noun: 'CPU', read: 'cpu', field: 'cpu' },
];
const ALL_NODE_READS = ['reachable', 'cpu', 'mem', 'disk', 'uptime', 'temp', 'containers'];

const LEVEL_WORD = { warn: 'warning', crit: 'critical' };

/** "Disk 94 % (warning above 90 %)", or, held by hysteresis, "… (warning until below 85 %)". */
function levelReason(label, value, level, enter, clear, { reading, line }) {
  const word = LEVEL_WORD[level];
  if (value >= enter) return `${label} ${reading(value)} (${word} above ${line(enter)})`;
  return `${label} ${reading(value)} (${word} until below ${line(clear)})`;
}

const PERCENT = { reading: readingPct, line: pct };
const CELSIUS = {
  reading: (v) => `${Math.floor(v + 1e-9)} °C`,
  line: (v) => `${Number(v.toFixed(1))} °C`,
};

/**
 * A node (spec §6.1): reachability, then CPU, memory, disk, temperature and the
 * Proxmox storage pools on it.
 *
 * - No data: Prometheus failed to read whether it is up (`failedReads` names
 *   `reachable`, or, for a node with no `up` series, a metric read failed), or
 *   the node is missing from a failed cycle → unknown, never crit.
 * - Unreachable: `up` is 0, or it has no `up` series and no metric, while
 *   Prometheus answered → crit (push pages it as host_unreachable).
 * - Each reading that was read: its level (levelOf). A reading whose query
 *   failed is `unknown`; one with no data (a VM has no temperature sensor) is
 *   left out.
 * - CPU warns only after `cpu.cycles` cycles in a row at or above its line.
 *
 * `conditions` gives each reading's state, so a meter is coloured by the
 * server's rule rather than its own. The reason names every reading that is
 * not ok, worst first.
 *
 * @param {object|null} node  the /api/services node, or null when it is missing this cycle
 * @param {{ prometheusOk: boolean, pools?: Array<{ name: string, percent: unknown }>, memo?: any, thresholds: import('./thresholds.js').Thresholds }} ctx
 */
export function judgeNode(node, { prometheusOk, pools = [], memo = null, thresholds }) {
  const prevLevels = memo?.levels ?? {};
  const prevStreak = memo?.streak ?? {};
  const noData = {
    state: 'unknown',
    word: 'No signal',
    reason: 'No data: Prometheus unreachable',
    memo: memo ?? {},
  };
  if (!node) return noData;

  const failed = Array.isArray(node.failedReads)
    ? node.failedReads
    : prometheusOk
      ? []
      : ALL_NODE_READS;
  const m = node.metrics || {};
  const byPresence = typeof node.reachable !== 'boolean';
  if (
    failed.includes('reachable') ||
    (byPresence && ['cpu', 'mem', 'disk'].some((r) => failed.includes(r)))
  ) {
    return noData;
  }
  const hasUsage = ['cpu', 'memPercent', 'diskPercent'].some((f) => fractionOf(m[f]) !== null);
  const reachable = byPresence ? hasUsage : node.reachable;
  if (!reachable) {
    return {
      state: 'crit',
      word: WORDS.unreachable,
      reason:
        node.reachable === false
          ? "Unreachable: Prometheus can't scrape it"
          : 'Unreachable: no metrics from Prometheus',
      conditions: {},
      memo: { levels: prevLevels, streak: {} },
    };
  }

  const h = thresholds.hysteresis;
  const levels = {};
  const streak = {};
  const conditions = {};
  /** @type {Array<{ key: string, state: string, reason: string, metric?: object, order: number }>} */
  const found = [];
  let order = 0;

  for (const r of NODE_METRICS) {
    order += 1;
    if (failed.includes(r.read)) {
      conditions[r.key] = 'unknown';
      if (prevLevels[r.key]) levels[r.key] = prevLevels[r.key];
      if (prevStreak[r.key]) streak[r.key] = prevStreak[r.key];
      found.push({
        key: r.key,
        state: 'unknown',
        reason: `No ${r.noun} reading: the Prometheus query failed`,
        order,
      });
      continue;
    }
    if (r.key === 'temp') {
      const v = celsiusOf(m.temp);
      if (v === null) continue;
      const level = levelOf(v, prevLevels.temp, thresholds.temp, h.celsius);
      levels.temp = level;
      conditions.temp = level;
      if (level !== 'ok') {
        const enter = thresholds.temp[level];
        found.push({
          key: 'temp',
          state: level,
          reason: levelReason('Temperature', v, level, enter, enter - h.celsius, CELSIUS),
          metric: { name: 'temp', value: Math.floor(v + 1e-9), unit: '°C' },
          order,
        });
      }
      continue;
    }
    const v = fractionOf(m[r.field]);
    if (v === null) continue;
    let level;
    if (r.key === 'cpu') {
      // Warn only after `cycles` cycles in a row at or above the line; then it
      // holds by hysteresis like the others.
      const high = v >= thresholds.cpu.warn;
      const run = high ? (prevStreak.cpu?.n ?? 0) + 1 : 0;
      if (high) streak.cpu = { n: run };
      const held = prevLevels.cpu === 'warn' && v >= thresholds.cpu.warn - h.fraction;
      level = run >= thresholds.cpu.cycles || held ? 'warn' : 'ok';
    } else {
      level = levelOf(
        v,
        prevLevels[r.key],
        r.key === 'disk' ? thresholds.disk : thresholds.mem,
        h.fraction
      );
    }
    levels[r.key] = level;
    conditions[r.key] = level;
    if (level === 'ok') continue;
    const enter = r.key === 'disk' ? thresholds.disk[level] : thresholds[r.key].warn;
    let reason = levelReason(r.label, v, level, enter, enter - h.fraction, PERCENT);
    if (r.key === 'cpu' && v >= enter)
      reason = `CPU ${readingPct(v)} (warning above ${pct(enter)} for ${thresholds.cpu.cycles} cycles)`;
    found.push({
      key: r.key,
      state: level,
      reason,
      metric: { name: r.key, value: wholePct(v), unit: '%' },
      order,
    });
  }

  // Proxmox storage pools on this node feed the disk rule (spec §8).
  const poolList = [...pools]
    .filter((p) => p && typeof p.name === 'string')
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const p of poolList) {
    const key = `pool:${p.name}`;
    const v = fractionOf(p.percent);
    if (v === null) continue;
    const level = levelOf(v, prevLevels[key], thresholds.disk, h.fraction);
    levels[key] = level;
    conditions[key] = level;
    if (level === 'ok') continue;
    const enter = thresholds.disk[level];
    found.push({
      key,
      state: level,
      reason: levelReason(`Storage pool ${p.name}`, v, level, enter, enter - h.fraction, PERCENT),
      metric: { name: key, value: wholePct(v), unit: '%' },
      order: 1.5, // beside the disk
    });
  }

  const memoOut = { levels, streak };
  if (found.length === 0)
    return { state: 'ok', word: 'Healthy', reason: 'Healthy', conditions, memo: memoOut };
  found.sort(
    (a, b) =>
      stateRank(b.state) - stateRank(a.state) || a.order - b.order || (a.key < b.key ? -1 : 1)
  );
  const state = found[0].state;
  const word = state === 'crit' ? 'Critical' : state === 'warn' ? 'Warning' : 'No signal';
  const verdict = {
    state,
    word,
    reason: found.map((f) => f.reason).join(' · '),
    conditions,
    memo: memoOut,
  };
  const withMetric = found.find((f) => f.metric);
  if (withMetric && withMetric.state === state) verdict.metric = withMetric.metric;
  return verdict;
}

// ── Service (a Kuma monitor) ─────────────────────────────────────────────

/**
 * A service, whose state is its Kuma monitor's (spec §6.1): down → crit;
 * pending → warn once it has been pending for `pending.cycles` cycles in a
 * row (#258), and before that the entity stays as it was (a service first
 * seen pending reads as up); maintenance → maintenance; Kuma failed → unknown.
 *
 * @param {{ status: unknown, kumaStatus?: unknown, kumaOk: boolean, prev?: any, now: number, thresholds: import('./thresholds.js').Thresholds }} input
 *   status: the card's status ('up' | 'down' | 'unknown'); kumaStatus: the
 *   monitor's own status, which tells pending and maintenance apart; prev:
 *   the entity as the model left it last cycle, with its memo.
 */
export function judgeService({ status, kumaStatus, kumaOk, prev = null, now, thresholds }) {
  if (!kumaOk) return { state: 'unknown', word: 'No signal', reason: 'No data: Kuma unreachable' };
  if (kumaStatus === 'maintenance')
    return { state: 'maintenance', word: 'Maintenance', reason: 'Kuma: in maintenance' };
  if (kumaStatus === 'pending') {
    const before = prev?.memo?.pending;
    const pending = { n: (before?.n ?? 0) + 1, since: before?.since ?? now };
    if (pending.n >= thresholds.pending.cycles) {
      return {
        state: 'warn',
        word: WORDS.pending,
        reason: 'Kuma: pending (retrying its check)',
        sinceHint: pending.since,
        memo: { pending },
      };
    }
    // One pending cycle is Kuma retrying a check: nothing changes yet.
    if (prev && prev.kind === 'service' && prev.state !== 'unknown') {
      const held = {
        state: prev.state,
        word: prev.word,
        reason: prev.reason,
        hold: true,
        memo: { pending },
      };
      if (prev.metric) held.metric = prev.metric;
      return held;
    }
    return { state: 'ok', word: WORDS.pending, reason: 'Kuma: pending', memo: { pending } };
  }
  if (status === 'down') return { state: 'crit', word: 'Down', reason: 'Kuma: down' };
  if (status === 'up') return { state: 'ok', word: 'Up', reason: 'Kuma: up' };
  return { state: 'unknown', word: 'No signal', reason: 'Kuma: no status' };
}

// ── Container ────────────────────────────────────────────────────────────

/**
 * A container with no Kuma monitor of its own (spec §6.1): running → ok;
 * missing (a grey presence card: it stopped within the last 24 hours) → warn,
 * or crit when it backs a monitored service (`backedBy`, the Kuma monitor it
 * last ran as); its container list unread (Prometheus failed) → unknown.
 *
 * @param {{ card: any, backedBy?: string|null, containersRead: boolean }} input
 */
export function judgeContainer({ card, backedBy = null, containersRead }) {
  if (!containersRead)
    return { state: 'unknown', word: 'No signal', reason: 'No data: Prometheus unreachable' };
  if (card?.source === 'presence') {
    const sinceHint = Number.isFinite(card.lastSeenAt) ? card.lastSeenAt : undefined;
    if (backedBy) {
      return {
        state: 'crit',
        word: 'Missing',
        reason: `Missing: it backs the Kuma monitor ${backedBy}`,
        sinceHint,
      };
    }
    return { state: 'warn', word: 'Missing', reason: 'Missing: no longer running', sinceHint };
  }
  return { state: 'ok', word: 'Running', reason: 'Running' };
}

// ── UPS ──────────────────────────────────────────────────────────────────

/**
 * The UPS, from the /api/ups payload (spec §6.1): on battery or low battery →
 * crit; on mains → ok. nut_status 1 is online, 2 on battery, 3 low battery
 * (push reads it through this rule: push/snapshot.js normalizeUpsStatus); 0 is
 * NUT's own "unknown".
 *
 * - The UPS query failed (`ok: false`) → unknown, naming Prometheus.
 * - No nut_status reading while the UPS is set up: the NUT exporter has gone
 *   quiet → unknown, naming it (`nutFailed`).
 *
 * @param {any} ups  the /api/ups payload
 */
export function judgeUps(ups) {
  if (!ups || ups.ok === false)
    return { state: 'unknown', word: 'No signal', reason: 'No data: Prometheus unreachable' };
  const charge =
    typeof ups.charge === 'number' && Number.isFinite(ups.charge) ? Math.round(ups.charge) : null;
  const metric = charge === null ? undefined : { name: 'charge', value: charge, unit: '%' };
  const chargeText = charge === null ? '' : ` (${charge} % charge)`;
  switch (ups.status) {
    case 1:
      return { state: 'ok', word: 'On mains', reason: 'On mains' };
    case 2:
      return { state: 'crit', word: 'On battery', reason: `On battery${chargeText}`, metric };
    case 3:
      return { state: 'crit', word: 'Low battery', reason: `Low battery${chargeText}`, metric };
    case null:
    case undefined:
      return {
        state: 'unknown',
        word: 'No signal',
        reason: 'No data: NUT exporter not reporting',
        nutFailed: true,
      };
    default:
      return {
        state: 'unknown',
        word: 'No signal',
        reason: 'NUT reports the UPS status as unknown',
      };
  }
}

// ── Job and backup (cron reports) ────────────────────────────────────────

/**
 * A cron job, or a cron job marked as a backup (spec §6.1, §6.2), from its
 * latest run as the cron store keeps it.
 *
 * - Job: overdue (past its expected interval plus grace, cron-overdue.js) or
 *   its last run failed → warn; overdue wins, as push's snapshot has it.
 * - Backup: its last run failed → crit; overdue → warn.
 *
 * @param {{ run: any, now: number, backup?: boolean }} input
 */
export function judgeJob({ run, now, backup = false }) {
  if (!run) return { state: 'unknown', word: 'No signal', reason: 'No run reported' };
  const ranAt = Date.parse(run.timestamp);
  const ranHint = Number.isFinite(ranAt) ? ranAt : undefined;
  const overdue = isOverdue(run, now);
  const every = run.expected_every_seconds;
  const overdueText = `Overdue: no report on schedule (expected every ${spanText(every)})`;
  const overdueSince = overdue ? ranAt + (every + graceSeconds(every)) * 1000 : undefined;
  const failedText = (what) => {
    const error = run.error ? errorText(run.error) : '';
    return error ? `${what} failed: ${error}` : `${what} failed`;
  };
  if (backup) {
    if (run.status === 'failure') {
      const reason = failedText('Last backup');
      return {
        state: 'crit',
        word: WORDS.failed,
        reason: overdue ? `${reason} · overdue` : reason,
        sinceHint: ranHint,
      };
    }
    if (overdue)
      return { state: 'warn', word: WORDS.overdue, reason: overdueText, sinceHint: overdueSince };
    if (run.status === 'success')
      return { state: 'ok', word: 'OK', reason: 'Last backup succeeded', sinceHint: ranHint };
    return {
      state: 'unknown',
      word: 'No signal',
      reason: 'Last report has no status',
      sinceHint: ranHint,
    };
  }
  if (overdue)
    return { state: 'warn', word: WORDS.overdue, reason: overdueText, sinceHint: overdueSince };
  if (run.status === 'failure')
    return {
      state: 'warn',
      word: WORDS.failed,
      reason: failedText('Last run'),
      sinceHint: ranHint,
    };
  if (run.status === 'success')
    return { state: 'ok', word: 'OK', reason: 'Last run succeeded', sinceHint: ranHint };
  return {
    state: 'unknown',
    word: 'No signal',
    reason: 'Last report has no status',
    sinceHint: ranHint,
  };
}

// ── Integration ──────────────────────────────────────────────────────────

// The hint integrations/backoff.js appends to a parked integration's _error.
const PARKED_SUFFIX = /\s*\(login refused twice;[^)]*\)\s*$/;

/**
 * An integration, from its /api/integrations entry and `_status` (#239, the
 * contract in #290's comments): unreachable (`backing_off`) or its login
 * refused twice (`auth_failed`) → warn; ok → ok. `since` is the entry's own
 * `_status.since`. An entry without `_status` is read from `_error`.
 *
 * @param {any} entry
 */
export function judgeIntegration(entry) {
  const st = entry?._status;
  const sinceHint = Number.isFinite(st?.since) ? st.since : undefined;
  if (st?.state === 'auth_failed') {
    return {
      state: 'warn',
      word: 'Login refused',
      reason: 'Login refused: save it in Settings to retry',
      sinceHint,
    };
  }
  const failing = st ? st.state === 'backing_off' : !!entry?._error;
  if (failing) {
    const error = entry?._error ? errorText(String(entry._error).replace(PARKED_SUFFIX, '')) : '';
    return {
      state: 'warn',
      word: 'Failing',
      reason: error ? `Fetch failed: ${error}` : 'Fetch failed',
      sinceHint,
    };
  }
  return { state: 'ok', word: 'OK', reason: 'OK', sinceHint };
}

// ── Arcane agent ─────────────────────────────────────────────────────────

/**
 * An Arcane agent (spec §6.1, §6.2): offline → warn, in the Integrations
 * subsystem. `state` is arcane/derive.js envHealth's: 'up', 'down' or 'unknown',
 * from the environment list the Arcane poller last read (#291); unknown while
 * that list fails.
 *
 * @param {{ state: unknown }} agent
 */
export function judgeAgent({ state }) {
  if (state === 'up') return { state: 'ok', word: 'Online', reason: 'Online' };
  if (state === 'down') return { state: 'warn', word: 'Offline', reason: 'Arcane: agent offline' };
  return { state: 'unknown', word: 'No signal', reason: 'Arcane: no status for this agent' };
}
