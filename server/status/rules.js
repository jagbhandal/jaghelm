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
import { atOrOver, lineNumber, percentOf, readingLines, shownReading } from './readings.js';

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

/**
 * Why a node, or what it runs, has no data while Prometheus answered: it has
 * a target for the node it has not scraped yet (#470).
 */
export const NOT_SCRAPED = 'No data: not scraped by Prometheus yet';

/** A line as a percentage: whole, or with the decimals it has, to a hundredth. */
function pct(fraction) {
  return `${percentOf(fraction)} %`;
}

// A reading is shown by the one rule every meter uses (readings.js
// shownReading, #450), with the lines it is judged by: rounded down, so it
// never reads as over a line it is under (94.6 % under a 95 % line reads 94 %),
// and small moves (61.2 to 61.4) leave the reason, and the model, unchanged.
const readingPct = (fraction, lines) => `${shownReading(fraction * 100, lines)} %`;

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

/**
 * A Proxmox storage pool's usage as a 0..1 fraction, or null when there is
 * none: no percent, or a pool that reports no size (`totalGB` not above 0).
 * Proxmox lists storage it can't read (inactive, unmounted) with no size, and
 * the preset gives it 0 %, which is no reading, not an empty pool (#468).
 */
function poolFraction(p) {
  if (p.totalGB !== undefined && p.totalGB !== null && !(parseFloat(p.totalGB) > 0)) return null;
  return fractionOf(p.percent);
}

function celsiusOf(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

// Usage readings and lines are fractions of 1: one of them is 100 of the
// percent they are shown in (readings.js atOrOver's `unit`).
const FRACTION = 100;

/**
 * A reading's level against a warn line and an optional crit line, with
 * hysteresis: a level reached holds until the reading falls `hysteresis` below
 * its line. Push has no comparison of its own: its differ diffs these levels,
 * and a pre-#292 snapshot is read through this too (push/snapshot.js
 * heldLevels).
 *
 * Each comparison is made on the grid of whole hundredths of the display unit
 * (readings.js atOrOver, #450), the one a meter uses, so a reading exactly on
 * a line is on it however the two were computed. `unit` is what one of the
 * value's units is in that unit: FRACTION (the default) for usage, 1 for °C.
 */
export function levelOf(value, prevLevel, { warn, crit }, hysteresis, unit = FRACTION) {
  const over = (line) => atOrOver(value, line, unit);
  const held = prevLevel === 'warn' || prevLevel === 'crit';
  if (crit != null && over(crit)) return 'crit';
  if (crit != null && prevLevel === 'crit' && over(crit - hysteresis)) return 'crit';
  if (warn != null && over(warn)) return 'warn';
  if (warn != null && held && over(warn - hysteresis)) return 'warn';
  return 'ok';
}

/**
 * How long a reading with no value keeps its level (#469): from its first
 * cycle with none, then it is forgotten, silently.
 */
export const HOLD_LIMIT_MS = 24 * 60 * 60 * 1000;

/**
 * When the hold of a reading with no value began, or null once it has lasted
 * HOLD_LIMIT_MS: the reading is then forgotten, level and all, and sends
 * nothing (nothing was read). `since` is the start an earlier cycle recorded
 * (the model's memory, seeded at boot from push's snapshot); with none (the
 * hold starts this cycle, or a snapshot written before #469 holds the level
 * with no start) it is `now`, so an old snapshot's hold runs its full 24 h from
 * the first cycle that reads it.
 *
 * Only the status model asks it (judgeNode), so it is the one place a hold is
 * timed: push's snapshot copies the starts the model serves on each node
 * (`heldSince`) and drops a reading when the model has (push/snapshot.js
 * buildHosts). `now` is required: a hold can't be timed without a clock.
 *
 * @param {unknown} since  the hold's recorded start, in ms since the epoch
 * @param {number} now     the cycle's clock
 * @returns {number | null}
 */
export function holdSince(since, now) {
  if (!Number.isFinite(now)) throw new TypeError('holdSince: now must be a time in ms');
  const start = Number.isFinite(since) ? since : now;
  return now - start >= HOLD_LIMIT_MS ? null : start;
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

/** A node's memo: its levels and CPU's run, and when each hold began when it has any (#469). */
function memoOf(levels, streak, held) {
  return Object.keys(held).length > 0 ? { levels, streak, held } : { levels, streak };
}

/**
 * "Disk 94 % (warning above 90 %)", or, held by hysteresis, "… (warning until
 * below 85 %)". `lines` are the reading's (readings.js readingLines), which
 * say how it is shown.
 */
function levelReason(label, value, level, enter, clear, { reading, line, unit }, lines) {
  const word = LEVEL_WORD[level];
  if (atOrOver(value, enter, unit))
    return `${label} ${reading(value, lines)} (${word} above ${line(enter)})`;
  return `${label} ${reading(value, lines)} (${word} until below ${line(clear)})`;
}

const PERCENT = { reading: readingPct, line: pct, unit: FRACTION };
const CELSIUS = {
  reading: (v, lines) => `${shownReading(v, lines)} °C`,
  line: (v) => `${lineNumber(v)} °C`,
  unit: 1,
};

/**
 * A node (spec §6.1): reachability, then CPU, memory, disk, temperature and the
 * Proxmox storage pools on it.
 *
 * - No data: Prometheus failed to read whether it is up (`failedReads` names
 *   `reachable`, or, for a node with no `up` series, a metric read failed), or
 *   the node is missing from a failed cycle → unknown, never crit. With
 *   `reachable` unread because of discovery's verdict on its missing `up`
 *   (`unreadReason`, status/upMissing.js: not scraped yet, still not scraped,
 *   no target, stored nothing), the reason is that verdict's (#470, #476,
 *   #477); with no verdict, while Prometheus answered, it is "not scraped
 *   yet".
 * - Unreachable: `up` is 0, or it has no `up` series and no metric, while
 *   Prometheus answered → crit (push pages it as host_unreachable).
 * - Each reading that was read: its level (levelOf). A reading whose query
 *   failed is `unknown`; one with no data (a VM has no temperature sensor) is
 *   left out.
 * - A reading with no value this cycle that the model holds a level for (a
 *   sensor or exporter that didn't answer, #462) keeps that level and CPU's
 *   run, as a failed read does, so a quiet cycle neither ends an episode nor
 *   starts another. Held at warn or crit, the node stays at that level, with a
 *   reason that says there is no reading and no number or metric; its
 *   condition is `unknown`, as there is no value for a meter. Held at ok, it
 *   is left out. It holds until the reading is read again, the node goes from
 *   services.yaml, or the hold has lasted 24 h (#469).
 * - That hold is timed (#469): `memo.held` keeps when it began (holdSince),
 *   and the verdict serves it as `heldSince`, which push's snapshot copies and
 *   the model is seeded from at boot. After HOLD_LIMIT_MS the reading is
 *   forgotten, level and CPU run: it leaves the verdict and `heldSince`, and is
 *   new when it is read again. Only a reading with no value is timed. One whose
 *   read failed (its Prometheus query, or its node's Proxmox pools) is frozen:
 *   it keeps its level, its run and any start as they are, however long, so
 *   it ends with its clear once it reads normal again. So does every reading
 *   of an unreachable node, or of one with no data.
 * - A storage pool has no value this cycle, and is held and timed the same
 *   way, when it is listed with no size (an inactive pool's 0 % is no
 *   reading). One that isn't listed while its node's pools were not read
 *   (`poolsRead` false: a Proxmox fetch failed, or its storage read did, #468)
 *   is a failed read: held the same way on the screen, and frozen. A pool's
 *   episode ends when the node's pools were read and it isn't listed.
 * - CPU warns only after `cpu.cycles` cycles in a row at or above its line.
 *
 * `conditions` gives each reading's state, so a meter is coloured by the
 * server's rule rather than its own. The reason names every reading that is
 * not ok, worst first.
 *
 * @param {object|null} node  the /api/services node, or null when it is missing this cycle
 * @param {{ prometheusOk: boolean, unreadReason?: string|null, pools?: Array<{ name: string, percent: unknown, totalGB?: unknown }>, poolsRead?: boolean, memo?: any, now?: number, thresholds: import('./thresholds.js').Thresholds }} ctx
 *   unreadReason: the reason of discovery's verdict on the node's `up`, when
 *   it left the node unread (model.js, from UP_MISSING);
 *   pools: the storage pools the node's Proxmox reads listed this cycle;
 *   poolsRead: whether those reads are the whole list (model.js proxmoxPools);
 *   now: the cycle's clock, which times a hold (required once one is held)
 */
export function judgeNode(
  node,
  { prometheusOk, unreadReason = null, pools = [], poolsRead = true, memo = null, now, thresholds }
) {
  const prevLevels = memo?.levels ?? {};
  const prevStreak = memo?.streak ?? {};
  const prevHeld = memo?.held ?? {};
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
  if (failed.includes('reachable') && unreadReason) return { ...noData, reason: unreadReason };
  if (failed.includes('reachable') && prometheusOk) return { ...noData, reason: NOT_SCRAPED };
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
      memo: memoOf(prevLevels, {}, prevHeld),
    };
  }

  const h = thresholds.hysteresis;
  const levels = {};
  const streak = {};
  const held = {};
  const conditions = {};
  /** @type {Array<{ key: string, state: string, reason: string, metric?: object, order: number }>} */
  const found = [];
  let order = 0;

  // A reading with no level read this cycle keeps the level the model held
  // for it and CPU's run. One with no value (`timed`) keeps them for at most
  // HOLD_LIMIT_MS from its first such cycle (#469); one whose read failed is
  // frozen, its start (if a quiet spell began one) kept as it is. Returns the
  // level kept, or undefined: none was held, or its 24 h are up and it is
  // forgotten, run and all.
  const keep = (key, timed) => {
    const before = prevLevels[key];
    let since = prevHeld[key];
    if (before && timed) {
      since = holdSince(since, now);
      if (since === null) return undefined;
    }
    if (prevStreak[key]) streak[key] = prevStreak[key];
    if (!before) return undefined;
    levels[key] = before;
    if (Number.isFinite(since)) held[key] = since;
    return before;
  };

  // A reading with no value this cycle (or a pool whose read failed): what the
  // model held for it is kept (#462). `lines` are its warn and crit lines,
  // `band` its hysteresis and `line` how a line is written; `timed` as keep's.
  const hold = (key, label, { lines, band, line }, at, timed = true) => {
    const before = keep(key, timed);
    if (!before) return;
    // At most the level its lines allow: a reading with no crit line holds warn.
    const level = before === 'crit' && lines.crit == null ? 'warn' : before;
    if (level !== 'warn' && level !== 'crit') return;
    conditions[key] = 'unknown';
    found.push({
      key,
      state: level,
      reason: `${label}: no reading (${LEVEL_WORD[level]} held until below ${line(lines[level] - band)})`,
      order: at,
    });
  };
  const usage = (lines) => ({ lines, band: h.fraction, line: pct });
  const celsius = { lines: thresholds.temp, band: h.celsius, line: CELSIUS.line };

  for (const r of NODE_METRICS) {
    order += 1;
    if (failed.includes(r.read)) {
      conditions[r.key] = 'unknown';
      keep(r.key, false);
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
      if (v === null) {
        hold('temp', r.label, celsius, order);
        continue;
      }
      const level = levelOf(v, prevLevels.temp, thresholds.temp, h.celsius, CELSIUS.unit);
      levels.temp = level;
      conditions.temp = level;
      if (level !== 'ok') {
        const enter = thresholds.temp[level];
        const lines = readingLines(thresholds, 'temp');
        found.push({
          key: 'temp',
          state: level,
          reason: levelReason('Temperature', v, level, enter, enter - h.celsius, CELSIUS, lines),
          metric: { name: 'temp', value: shownReading(v, lines), unit: '°C' },
          order,
        });
      }
      continue;
    }
    const v = fractionOf(m[r.field]);
    if (v === null) {
      hold(r.key, r.label, usage(thresholds[r.key]), order);
      continue;
    }
    let level;
    if (r.key === 'cpu') {
      // Warn only after `cycles` cycles in a row at or above the line; then it
      // holds by hysteresis like the others.
      const high = atOrOver(v, thresholds.cpu.warn, FRACTION);
      const run = high ? (prevStreak.cpu?.n ?? 0) + 1 : 0;
      if (high) streak.cpu = { n: run };
      const held =
        prevLevels.cpu === 'warn' && atOrOver(v, thresholds.cpu.warn - h.fraction, FRACTION);
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
    const lines = readingLines(thresholds, r.key);
    let reason = levelReason(r.label, v, level, enter, enter - h.fraction, PERCENT, lines);
    if (r.key === 'cpu' && atOrOver(v, enter, FRACTION))
      reason = `CPU ${readingPct(v, lines)} (warning above ${pct(enter)} for ${thresholds.cpu.cycles} cycles)`;
    found.push({
      key: r.key,
      state: level,
      reason,
      metric: { name: r.key, value: shownReading(v * 100, lines), unit: '%' },
      order,
    });
  }

  // Proxmox storage pools on this node feed the disk rule (spec §8). One the
  // model held a level for that isn't listed while the node's pools were not
  // read (#468) is a failed read, held and frozen; one with no size has no
  // value, held and timed (#469).
  const poolList = [...pools].filter((p) => p && typeof p.name === 'string');
  if (!poolsRead) {
    const listed = new Set(poolList.map((p) => p.name));
    for (const key of Object.keys(prevLevels)) {
      const name = key.slice('pool:'.length);
      if (key.startsWith('pool:') && !listed.has(name))
        poolList.push({ name, percent: null, unread: true });
    }
  }
  poolList.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const p of poolList) {
    const key = `pool:${p.name}`;
    const v = poolFraction(p);
    if (v === null) {
      hold(key, `Storage pool ${p.name}`, usage(thresholds.disk), 1.5, !p.unread);
      continue;
    }
    const level = levelOf(v, prevLevels[key], thresholds.disk, h.fraction);
    levels[key] = level;
    conditions[key] = level;
    if (level === 'ok') continue;
    const enter = thresholds.disk[level];
    const lines = readingLines(thresholds, key);
    found.push({
      key,
      state: level,
      reason: levelReason(
        `Storage pool ${p.name}`,
        v,
        level,
        enter,
        enter - h.fraction,
        PERCENT,
        lines
      ),
      metric: { name: key, value: shownReading(v * 100, lines), unit: '%' },
      order: 1.5, // beside the disk
    });
  }

  const memoOut = memoOf(levels, streak, held);
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
 * missing (a grey presence card: it stopped within the last 24 hours) → warn;
 * its container list unread (Prometheus failed) → unknown.
 *
 * A missing container that was the last container of a Kuma monitor
 * (`backedBy`: the monitor's name and Kuma's status for it) follows the
 * monitor (#438), and is never crit, since the service is an entity of its
 * own: up → warn, saying the service is up; pending → unknown; in maintenance
 * → maintenance (those two since the model first saw them: they are the
 * monitor's state, not the container's). Down → warn: the monitor's own card
 * is the crit. The services refresh draws no grey card for a container whose
 * down monitor's red card is its own (refresh.js assembleServices), so a
 * down one here is a container the monitor has moved off (a new container
 * has it, or another stopped one).
 *
 * @param {{ card: any, backedBy?: { monitor: string, status: string }|null, containersRead: boolean }} input
 */
export function judgeContainer({ card, backedBy = null, containersRead }) {
  if (!containersRead)
    return { state: 'unknown', word: 'No signal', reason: 'No data: Prometheus unreachable' };
  if (card?.source === 'presence') {
    const sinceHint = Number.isFinite(card.lastSeenAt) ? card.lastSeenAt : undefined;
    const monitor = typeof backedBy?.monitor === 'string' ? backedBy.monitor : null;
    switch (monitor && backedBy.status) {
      case 'up':
      case 'down':
        return {
          state: 'warn',
          word: 'Missing',
          reason: `Missing: the container is gone; Kuma monitor ${monitor} is ${backedBy.status}`,
          sinceHint,
        };
      case 'pending':
        return { state: 'unknown', word: 'No signal', reason: `Kuma: ${monitor} pending` };
      case 'maintenance':
        return {
          state: 'maintenance',
          word: 'Maintenance',
          reason: `Kuma: ${monitor} in maintenance`,
        };
      default:
        return { state: 'warn', word: 'Missing', reason: 'Missing: no longer running', sinceHint };
    }
  }
  return { state: 'ok', word: 'Running', reason: 'Running' };
}

// ── UPS ──────────────────────────────────────────────────────────────────

/**
 * The UPS, from the /api/ups payload (spec §6.1): on battery or low battery →
 * crit; on mains → ok. nut_status 1 is online, 2 on battery, 3 low battery
 * (push reads it through this rule: push/snapshot.js normalizeUpsStatus); 0 is
 * NUT's own "unknown". Its charge, when read, is its `metric`, on mains as
 * on battery (the strip's sub-line, summary.js tileOf, #541).
 *
 * - The UPS query failed (`ok: false`) → unknown, naming Prometheus.
 * - No nut_status reading while the UPS is set up: the NUT exporter has gone
 *   quiet → unknown, naming it (`nutFailed`).
 *
 * `runtimeMinutes` (#549): on battery or low battery, the runtime NUT says is
 * left, in whole minutes, rounded as the Android app has always rounded it
 * ("8 min left"), from the same read. Null otherwise: on mains, with no
 * runtime reading, and with no signal, so nothing draws a runtime this
 * cycle's read didn't give. It counts down, so on battery it moves the
 * status, and its ETag, about once a minute. Every verdict has the key, so a
 * client tells "no reading now" from a server older than #549, whose UPS
 * entity has no such key.
 *
 * From the same read too (#586), so the detail needs no /api/ups:
 * `runtimeOnMainsMinutes`, on mains, the runtime NUT gives at this load, in
 * whole minutes rounded the same way ("41 min at this load"); `load`, the
 * load in %, on mains as on battery, shown by the one rule a meter uses
 * (rounded down, #450); and `model`, NUT's name for the UPS's model, while
 * the UPS query answered. Each is null without one, never 0 for none, and
 * every verdict has the keys. With no signal neither reading is drawn, as
 * the charge isn't. Load and the runtime on mains drift with the load on a
 * steady board, so the ETag leaves them out (model.js withoutDrift).
 *
 * @param {any} ups  the /api/ups payload
 */
export function judgeUps(ups) {
  const verdict = upsVerdict(ups);
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const signal = verdict.state === 'ok' || verdict.state === 'crit';
  const runtime = finite(ups?.runtime) ? Math.round(ups.runtime / 60) : null;
  const answered = ups != null && ups.ok !== false;
  return {
    ...verdict,
    runtimeMinutes: verdict.state === 'crit' ? runtime : null,
    runtimeOnMainsMinutes: verdict.state === 'ok' ? runtime : null,
    load: signal && finite(ups.load) ? shownReading(ups.load) : null,
    model: answered && typeof ups.model === 'string' && ups.model.trim() ? ups.model : null,
  };
}

/** judgeUps' state, word, reason and charge. @param {any} ups */
function upsVerdict(ups) {
  if (!ups || ups.ok === false)
    return { state: 'unknown', word: 'No signal', reason: 'No data: Prometheus unreachable' };
  // Shown by the one rule a meter uses (#450): rounded down.
  const charge =
    typeof ups.charge === 'number' && Number.isFinite(ups.charge) ? shownReading(ups.charge) : null;
  const metric = charge === null ? undefined : { name: 'charge', value: charge, unit: '%' };
  const chargeText = charge === null ? '' : ` (${charge} % charge)`;
  switch (ups.status) {
    case 1:
      return { state: 'ok', word: 'On mains', reason: 'On mains', metric };
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

// ── CI run (the Pipeline panel, #532) ────────────────────────────────────

// A run's result, worst first: the word a commit's runs read as is the first
// here that one of them has. A run still going outranks one that passed, so a
// commit reads as passed only once all its workflows have; a cancelled one
// gave no answer, so it can't read as passed either; a skipped one didn't
// apply, so the others' answer stands. Only a failure is a problem; a run
// with no answer yet, or none to give, is the no-signal ring, never green or
// red (spec §6).
const CI_RESULTS = Object.freeze([
  ['failure', 'crit', 'Failed'],
  ['in_progress', 'unknown', 'Running'],
  ['waiting', 'unknown', 'Waiting'],
  ['queued', 'unknown', 'Queued'],
  ['cancelled', 'unknown', 'Cancelled'],
  ['success', 'ok', 'Passed'],
  ['skipped', 'unknown', 'Skipped'],
]);

/** A Gitea Actions run's result: its conclusion once completed, else how far it got. */
function ciResult(run) {
  const status = run?.status;
  if (status === 'completed') return run.conclusion;
  // Gitea answers "pending" and "requested" for a run not yet picked up, as for "queued".
  if (status === 'pending' || status === 'requested') return 'queued';
  return status;
}

/**
 * A commit's CI result, for the Pipeline panel (#532), from its Gitea Actions
 * runs: the newest run of each workflow that ran on it (gitea.js picks them).
 * `{ state, word }`: failed → crit "Failed"; running, waiting or queued →
 * unknown ("Running", "Waiting", "Queued"); passed → ok "Passed"; cancelled
 * or skipped → unknown, saying which; anything else → unknown "No result".
 * No run → null: a commit CI never ran on has no lamp, not a failure. Pipeline
 * is information, not monitoring: no entity, no issue, no push.
 *
 * @param {any[]} runs
 * @returns {{ state: string, word: string } | null}
 */
export function judgeCiRuns(runs) {
  if (!Array.isArray(runs) || runs.length === 0) return null;
  const results = new Set(runs.map(ciResult));
  for (const [result, state, word] of CI_RESULTS) {
    if (results.has(result)) return { state, word };
  }
  return { state: 'unknown', word: 'No result' };
}
