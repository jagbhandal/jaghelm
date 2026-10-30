// @ts-check
/**
 * What the lab's power costs (Monitoring A3, #744, spec §6): hourly average
 * watts of the UPS from Prometheus turned into finished numbers, per local
 * day, with the rate in force, month to date and a projected month. The
 * monitoring endpoint (card C1) calls `energyCost.read()`; no route is here.
 *
 * Two halves:
 *
 *   buildCost()    pure and deterministic: hourly samples + the `energy`
 *                  config + a zone + "now" in, one result out. No I/O.
 *   createEnergyCostCache()  asks Prometheus (one query_range) and caches it
 *                  the way promHistory.js does.
 *
 * The watts are `nut_load * nut_real_power_nominal_watts`, the UPS's load
 * fraction times its nominal watts: what is plugged into the UPS, not a
 * metered reading. They are read as the product of two hourly averages
 * (nominal watts is constant, so this equals the average of the product and
 * is far cheaper than a subquery). `JAGHELM_UPS_NAME` narrows both to the UPS
 * `ups` label as refreshUPS does; unset, the first UPS by name with a reading
 * now is used, as pickUps does.
 *
 * How the numbers are made (each rule is tested):
 *
 *   Hours      Prometheus answers one point per whole hour T: the average
 *              watts over [T-1h, T). One hour at W watts is W/1000 kWh.
 *   Days       A day is a LOCAL calendar date in the configured zone
 *              (`alerts.timezone`, else the server's: resolveAlerts). Its
 *              start and end are the real instants of local midnight, found
 *              by search, so a US spring-forward day is 23 hours and a
 *              fall-back day 25: an hour is added to the day it lies in,
 *              never to "the 24 hours since the last bucket". An hour that
 *              straddles local midnight (zones at :30 or :45) is split by the
 *              minutes either side.
 *   Gaps       An hour with no reading adds nothing and is counted as
 *              missing; it is never a zero reading. A day carries its
 *              `coverage` (hours with a reading over hours it has had); a
 *              day with none has kWh and cost null, not 0.
 *   Rates      `rateFor(rates, day)`: the rate whose `from` is the latest on
 *              or before the day; a day before the first `from` uses the
 *              first rate; no rates, no money anywhere (kWh only).
 *   Month      Month to date sums the days since the 1st of today's month
 *              (today, partial, included and flagged). When that 1st is
 *              before the first hour Prometheus could still give (30 d),
 *              `since` names the first whole day we have, and the month to
 *              date starts there: never a guess.
 *   Projection month to date + days left (whole days after today plus the
 *              rest of today) x the mean daily kWh of up to 7 complete days
 *              before today (days with at least TRAILING_MIN_COVERAGE of their
 *              hours; the mean is kWh per covered hour x 24 over the days
 *              that qualify) x the CURRENT rate (the one in force today).
 *              Null when no day qualifies. A future rate row is not used.
 *
 * The result is `{ state: 'ok' | 'no-ups' | 'failed', ... }`; 'failed' carries
 * the fixed failure sentence (failureWords.js), never Prometheus's text.
 */
import { promQueryRange, promString } from './discovery.js';
import { sanitizeEnergy } from './energy.js';
import { envValue } from './env.js';
import { failureDetail, failureSentence } from './failureWords.js';
import { FAILURE_TTL_MS } from './promHistory.js';
import { resolveAlerts } from './push/alertRules.js';
import { readDisplayConfig } from './refresh.js';
import { createLogger } from './util/logger.js';

const log = createLogger('energy');

const HOUR_MS = 3_600_000;
const HOUR_S = 3_600;
/** Prometheus keeps 30 days (spec §5); the read asks for exactly that. */
export const COST_RANGE_DAYS = 30;
/** A complete day needs this share of its hours read to count in the trailing mean. */
export const TRAILING_MIN_COVERAGE = 0.75;
/** Days in the trailing mean. */
export const TRAILING_DAYS = 7;

// ── Calendar in a zone ──────────────────────────────────────────────────

/** @type {Map<string, Intl.DateTimeFormat>} */
const dayFormats = new Map();

/**
 * The local calendar date (YYYY-MM-DD) in `zone` at `ms`.
 * @param {string} zone
 * @param {number} ms
 */
export function localDay(zone, ms) {
  let fmt = dayFormats.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    dayFormats.set(zone, fmt);
  }
  const p = fmt.formatToParts(new Date(ms));
  const get = (/** @type {string} */ type) => p.find((x) => x.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * The calendar date `n` days after `day` (negative: before). Pure calendar
 * arithmetic, no zone.
 * @param {string} day
 * @param {number} n
 */
export function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** @param {string} day  YYYY-MM-DD */
export function daysInMonthOf(day) {
  const [y, m] = day.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return Number(addDays(next, -1).slice(8, 10));
}

/** @type {Map<string, number>} */
const dayStarts = new Map();

/**
 * The instant (ms) the local day `day` begins in `zone`: the first minute
 * whose local date is `day` or later. A search, not an offset sum, so a day
 * that begins at a DST change still gets its true start.
 * @param {string} day
 * @param {string} zone
 */
export function dayStartMs(day, zone) {
  const key = `${zone}|${day}`;
  const known = dayStarts.get(key);
  if (known !== undefined) return known;
  const [y, m, d] = day.split('-').map(Number);
  const base = Date.UTC(y, m - 1, d);
  // Offsets run from UTC-12 to UTC+14: local midnight lies in this window.
  let lo = Math.floor((base - 15 * HOUR_MS) / 60_000); // minutes; before the day
  let hi = Math.floor((base + 13 * HOUR_MS) / 60_000); // minutes; on or after it
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (localDay(zone, mid * 60_000) >= day) hi = mid;
    else lo = mid;
  }
  const ms = hi * 60_000;
  if (dayStarts.size > 4000) dayStarts.clear();
  dayStarts.set(key, ms);
  return ms;
}

// ── Rates ───────────────────────────────────────────────────────────────

/**
 * The rate for `day`: the row with the latest `from` on or before it; a day
 * before the first row uses the first; null with no rows. Works on rows in
 * any order.
 * @param {ReadonlyArray<{ from: string, perKwh: number }>} rates
 * @param {string} day  YYYY-MM-DD
 * @returns {number | null}
 */
export function rateFor(rates, day) {
  if (!Array.isArray(rates) || rates.length === 0) return null;
  let first = rates[0];
  /** @type {{ from: string, perKwh: number } | null} */
  let best = null;
  for (const r of rates) {
    if (r.from < first.from) first = r;
    if (r.from <= day && (best === null || r.from > best.from)) best = r;
  }
  return (best ?? first).perKwh;
}

// ── The pure maths ──────────────────────────────────────────────────────

const round = (/** @type {number} */ n, /** @type {number} */ dp) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

/**
 * @typedef {{ t: number, watts: number | null }} HourSample
 *   `t` the END of the hour (ms): the average watts over [t - 1 h, t); null: no reading
 *
 * @typedef {object} CostDay
 * @property {string} day         local date, YYYY-MM-DD
 * @property {number | null} kWh  null with no reading at all that day
 * @property {number} hours       hours the day has had (23 or 25 on a DST day; today so far)
 * @property {number} coverage    0 to 1: hours with a reading over `hours`
 * @property {boolean} partial    today: still going
 * @property {number | null} ratePerKwh  the rate in force; null without rates
 * @property {number | null} cost null without rates or without readings
 */

/**
 * Min, max and mean of the watts of `samples` that have a reading; null with none.
 * @param {HourSample[]} samples
 */
function wattStats(samples) {
  const w = samples.map((s) => s.watts).filter((v) => v !== null);
  if (w.length === 0) return null;
  const nums = /** @type {number[]} */ (w);
  return {
    minWatts: round(Math.min(...nums), 1),
    maxWatts: round(Math.max(...nums), 1),
    avgWatts: round(nums.reduce((a, b) => a + b, 0) / nums.length, 1),
  };
}

/**
 * The finished cost bundle from hourly samples. Pure.
 *
 * @param {object} input
 * @param {HourSample[]} input.samples  ascending, one per whole hour, gaps as `watts: null`
 * @param {number} input.rangeFromMs    start (ms) of the earliest hour Prometheus was asked for
 * @param {number} input.throughMs      end (ms) of the last hour asked for (a whole hour at or before now)
 * @param {number} input.nowMs
 * @param {string} input.zone           IANA zone
 * @param {unknown} input.energy        the display config's `energy` (sanitised again here)
 */
export function buildCost({ samples, rangeFromMs, throughMs, nowMs, zone, energy }) {
  const conf = sanitizeEnergy(energy);
  const rates = conf?.rates ?? [];
  const money = rates.length > 0;
  const currency = conf?.currency ?? null;

  // Hours read, per local day: kWh summed and fraction of hours covered.
  /** @type {Map<string, { kWh: number, covered: number }>} */
  const acc = new Map();
  for (const s of samples) {
    if (s.watts === null || !Number.isFinite(s.watts)) continue;
    const end = s.t;
    let a = end - HOUR_MS;
    while (a < end) {
      const day = localDay(zone, a);
      const dayEnd = dayStartMs(addDays(day, 1), zone);
      const segEnd = Math.min(end, dayEnd);
      const share = (segEnd - a) / HOUR_MS;
      const cur = acc.get(day) ?? { kWh: 0, covered: 0 };
      cur.kWh += (s.watts / 1000) * share;
      cur.covered += share;
      acc.set(day, cur);
      a = segEnd;
    }
  }

  const today = localDay(zone, nowMs);
  const firstDay = localDay(zone, rangeFromMs);
  /** @type {CostDay[]} */
  const days = [];
  /** @type {Map<string, number>} */
  const rawKwh = new Map(); // unrounded, for the sums
  /** @type {Map<string, number>} */
  const rawCovered = new Map(); // unrounded hours with a reading
  for (let day = firstDay; day <= today; day = addDays(day, 1)) {
    const start = dayStartMs(day, zone);
    if (start < rangeFromMs) continue; // the first day, cut by the range: not whole, not shown
    const end = dayStartMs(addDays(day, 1), zone);
    const partial = day === today;
    // A past day has had all its hours up to its real local midnight, even
    // when the last whole hour Prometheus gave (`throughMs`) falls short of
    // it (zones at :30/:45, just after local midnight): the unread tail is a
    // gap in its coverage, not a shorter day. Only today is cut at `throughMs`.
    const hours = (Math.min(end, partial ? throughMs : end) - start) / HOUR_MS;
    const got = acc.get(day);
    const kWhRaw = got ? got.kWh : null;
    const ratePerKwh = money ? rateFor(rates, day) : null;
    if (kWhRaw !== null) rawKwh.set(day, kWhRaw);
    if (got) rawCovered.set(day, got.covered);
    days.push({
      day,
      kWh: kWhRaw === null ? null : round(kWhRaw, 3),
      hours: round(Math.max(hours, 0), 2),
      coverage: got && hours > 0 ? round(Math.min(got.covered / hours, 1), 3) : 0,
      partial,
      ratePerKwh,
      cost: kWhRaw === null || ratePerKwh === null ? null : round(kWhRaw * ratePerKwh, 4),
    });
  }

  // Month to date.
  const monthPrefix = today.slice(0, 7);
  const monthStart = `${monthPrefix}-01`;
  const monthDays = days.filter((d) => d.day >= monthStart);
  const monthStartMs = dayStartMs(monthStart, zone);
  const since = monthStartMs < rangeFromMs ? (monthDays[0]?.day ?? null) : null;
  let mtdKwh = 0;
  let mtdCost = 0;
  let gapHours = 0;
  let anyRead = false;
  for (const d of monthDays) {
    const k = rawKwh.get(d.day);
    gapHours += d.hours - d.hours * d.coverage;
    if (k === undefined) continue;
    anyRead = true;
    mtdKwh += k;
    if (d.ratePerKwh !== null) mtdCost += k * d.ratePerKwh;
  }

  // Projection.
  const dim = daysInMonthOf(today);
  // Whole days after today plus what is left of today, in real local-day
  // length (23 or 25 h on a DST day). The month to date counts today up to
  // `throughMs`, so the remainder starts there (not before today's start).
  const todayStart = dayStartMs(today, zone);
  const todayEnd = dayStartMs(addDays(today, 1), zone);
  const todayLeft = (todayEnd - Math.max(throughMs, todayStart)) / (todayEnd - todayStart);
  const daysLeft = dim - Number(today.slice(8, 10)) + Math.min(Math.max(todayLeft, 0), 1);
  const currentRate = money ? rateFor(rates, today) : null;
  const trailing = days
    .filter((d) => !d.partial)
    .slice(-TRAILING_DAYS)
    .filter((d) => d.coverage >= TRAILING_MIN_COVERAGE && d.kWh !== null);
  /** @type {{ kWh: number, cost: number | null, basisDays: number, meanDailyKWh: number } | null} */
  let projected = null;
  if (trailing.length > 0) {
    // kWh per covered hour x 24, so a day with a few missing hours is not
    // read as a day that drew less.
    const kWhSum = trailing.reduce((a, d) => a + /** @type {number} */ (rawKwh.get(d.day)), 0);
    const hoursSum = trailing.reduce((a, d) => a + (rawCovered.get(d.day) ?? 0), 0);
    const mean = (kWhSum / hoursSum) * 24;
    projected = {
      kWh: round(mtdKwh + daysLeft * mean, 2),
      cost: currentRate === null ? null : round(mtdCost + daysLeft * mean * currentRate, 2),
      basisDays: trailing.length,
      meanDailyKWh: round(mean, 3),
    };
  }

  const last24 = samples.filter((s) => s.t > throughMs - 24 * HOUR_MS);
  return {
    state: /** @type {'ok'} */ ('ok'),
    zone,
    currency: money ? currency : null,
    currentRatePerKwh: currentRate,
    throughMs,
    days,
    month: {
      month: monthPrefix,
      since,
      daysInMonth: dim,
      daysLeft: round(daysLeft, 3),
      kWh: anyRead ? round(mtdKwh, 3) : null,
      cost: anyRead && money ? round(mtdCost, 2) : null,
      gapHours: round(gapHours, 1),
      partialToday: days.some((d) => d.partial),
      projected,
    },
    // Hourly averages, so a spike inside an hour is not in these.
    stats: { last24h: wattStats(last24), range: wattStats(samples) },
  };
}

// ── Prometheus ──────────────────────────────────────────────────────────

/**
 * The average-watts query for the UPS `name` (null: any), each point the
 * average over `window` (an hour for the cost; the Power draw chart (C3, #753)
 * gives its range's own window).
 * @param {string | null} name
 * @param {string} [window]
 */
export function wattsQuery(name, window = '1h') {
  const sel = (/** @type {string} */ metric) => `${metric}${name ? `{ups=${promString(name)}}` : ''}`;
  return (
    `avg by (ups) (avg_over_time(${sel('nut_load')}[${window}])) * on(ups) ` +
    `avg by (ups) (avg_over_time(${sel('nut_real_power_nominal_watts')}[${window}]))`
  );
}

/**
 * The highest watts reading in each `window`, for the Power draw chart's max
 * band (#753): the UPS's readings (load times nominal watts, as wattsQuery)
 * taken every `inner`, then the highest of them across the window, as
 * promHistory.js' maxQueryOf does for the node series.
 * @param {string | null} name
 * @param {string} window
 * @param {string} [inner]
 */
export function maxWattsQuery(name, window, inner = '5m') {
  const sel = (/** @type {string} */ metric) =>
    `max by (ups) (${metric}${name ? `{ups=${promString(name)}}` : ''})`;
  return (
    `max_over_time((${sel('nut_load')} * on(ups) ${sel('nut_real_power_nominal_watts')})` +
    `[${window}:${inner}])`
  );
}

/**
 * The matrix as one UPS's samples on the grid from `start` to `end` (seconds),
 * one per `step` (an hour for the cost; the Power draw chart's step, #753). With several UPSes (no name set) the first by `ups`
 * label with a reading now (else any reading in the range) is used, as
 * pickUps does. Anything not a finite
 * non-negative number is a gap. Returns null for no series, or only gaps.
 * @param {Array<{ metric?: Record<string, string>, values?: Array<[number, string]> }>} matrix
 * @param {number} start
 * @param {number} end
 * @param {number} [step]
 * @returns {HourSample[] | null}
 */
export function samplesOf(matrix, start, end, step = HOUR_S) {
  const withReading = (matrix ?? [])
    .filter((s) => Array.isArray(s.values))
    .map((s) => ({ ups: s.metric?.ups ?? '', series: s }))
    .sort((a, b) => (a.ups < b.ups ? -1 : a.ups > b.ups ? 1 : 0));
  // As refreshUPS: the first by name with a reading NOW (the last grid
  // point), else the first with any reading in the range.
  const readingNow = (/** @type {{ series: { values?: Array<[number, string]> } }} */ c) =>
    (c.series.values ?? []).some(([t, v]) => Math.round(Number(t)) === end && reading(v) !== null);
  const chosen =
    withReading.find(readingNow) ??
    withReading.find((c) => (c.series.values ?? []).some(([, v]) => reading(v) !== null));
  if (!chosen) return null;
  /** @type {Map<number, number | null>} */
  const byT = new Map();
  for (const [ts, v] of chosen.series.values ?? []) byT.set(Math.round(Number(ts)), reading(v));
  /** @type {HourSample[]} */
  const out = [];
  for (let t = start; t <= end; t += step) out.push({ t: t * 1000, watts: byT.get(t) ?? null });
  return out;
}

/** @param {unknown} raw */
function reading(raw) {
  const n = typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * The asked span at `now` (ms): 30 d of whole hours ending on one.
 * @param {number} now
 */
export function costWindow(now) {
  const end = Math.floor(now / 1000 / HOUR_S) * HOUR_S;
  return { start: end - COST_RANGE_DAYS * 86_400, end, step: HOUR_S };
}

/**
 * The cost reader. One Prometheus query_range per whole hour is the most it
 * asks (the answer is kept until the next hour begins; concurrent readers
 * share the one in flight; a failure is kept for FAILURE_TTL_MS). The config
 * (rates, zone) is read on every call and applied to the kept answer, so a
 * saved rate takes effect at once without another query.
 *
 * @param {object} [deps]
 * @param {(q: string, span: { start: number, end: number, step: number }) => Promise<any[]>} [deps.queryRange]
 * @param {() => number} [deps.now]
 * @param {() => { energy?: unknown, alerts?: unknown } | null | undefined} [deps.config]
 * @param {() => string | null} [deps.upsName]
 * @param {{ info: Function, warn: Function }} [deps.logger]
 */
export function createEnergyCostCache({
  queryRange = promQueryRange,
  now = Date.now,
  config = () => readDisplayConfig(),
  upsName = () => envValue('JAGHELM_UPS_NAME').trim() || null,
  logger = log,
} = {}) {
  /** @type {{ key: string, end: number, failedAt: number | null, value: { samples: HourSample[] | null } | { error: string } } | null} */
  let entry = null;
  /** @type {{ key: string, end: number, promise: Promise<any> } | null} */
  let asking = null;
  let failing = '';

  /** @param {string} key @param {number} end @param {number} start */
  function ask(key, end, start) {
    const name = upsName();
    const promise = queryRange(wattsQuery(name), { start, end, step: HOUR_S })
      .then(
        (matrix) => {
          if (failing) {
            logger.info({ source: 'prometheus' }, 'energy cost query answers again');
            failing = '';
          }
          entry = { key, end, failedAt: null, value: { samples: samplesOf(matrix, start, end) } };
        },
        (err) => {
          const error = failureSentence('prometheus', err);
          if (error !== failing) {
            failing = error;
            logger.warn(
              { source: 'prometheus', err: failureDetail(err) },
              'energy cost query failed; the cost says so until Prometheus answers'
            );
          }
          entry = { key, end, failedAt: now(), value: { error } };
        }
      )
      .finally(() => {
        if (asking?.promise === promise) asking = null;
      });
    asking = { key, end, promise };
    return promise;
  }

  return {
    /** The finished cost bundle (buildCost), `{ state: 'no-ups' }` or `{ state: 'failed', error }`. */
    async read() {
      const at = now();
      const { start, end } = costWindow(at);
      const key = upsName() ?? '*';
      const fresh =
        entry !== null &&
        entry.key === key &&
        entry.end === end &&
        (entry.failedAt === null || at - entry.failedAt < FAILURE_TTL_MS);
      if (!fresh) {
        if (asking && asking.key === key && asking.end === end) await asking.promise;
        else await ask(key, end, start);
      }
      const got = /** @type {NonNullable<typeof entry>} */ (entry).value;
      if ('error' in got) return { state: /** @type {'failed'} */ ('failed'), error: got.error };
      if (got.samples === null) return { state: /** @type {'no-ups'} */ ('no-ups') };
      const cfg = config() ?? {};
      return buildCost({
        samples: got.samples,
        rangeFromMs: start * 1000 - HOUR_MS,
        throughMs: end * 1000,
        nowMs: at,
        zone: resolveAlerts(cfg.alerts).timezone,
        energy: cfg.energy,
      });
    },
    /** Test seam: forget the kept answer. */
    clear() {
      entry = null;
      asking = null;
      failing = '';
    },
  };
}

/** The server's one cost reader, for the monitoring endpoint (C1). */
export const energyCost = createEnergyCostCache();
