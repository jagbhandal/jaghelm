/**
 * The cost maths and its Prometheus read (#744, energyCost.js): local days
 * across US DST, month edges, rate history, gaps, the 30-day edge, and the
 * cache's query count.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  addDays,
  buildCost,
  costWindow,
  createEnergyCostCache,
  dayStartMs,
  daysInMonthOf,
  localDay,
  rateFor,
  samplesOf,
  wattsQuery,
} from './energyCost.js';
import { FAILURE_TTL_MS } from './promHistory.js';
import { systemTimezone } from './push/alertRules.js';

const NY = 'America/New_York';
const H = 3_600_000;
const ts = (iso) => Date.parse(iso);

/** Hourly samples with `watts(endMs)` for every hour that ends in (fromMs, toMs]. */
function hourly(fromMs, toMs, watts) {
  const out = [];
  for (let t = fromMs + H; t <= toMs; t += H) out.push({ t, watts: watts(t) });
  return out;
}

/** buildCost over the real 30 d window at `nowMs`, with `watts(endMs)` for each hour. */
function world(nowMs, { watts = () => 100, energy, zone = NY } = {}) {
  const { start, end } = costWindow(nowMs);
  const rangeFromMs = start * 1000 - H;
  const samples = hourly(rangeFromMs, end * 1000, watts);
  return buildCost({ samples, rangeFromMs, throughMs: end * 1000, nowMs, zone, energy });
}

const dayOf = (r, d) => r.days.find((x) => x.day === d);
const RATE = { currency: '$', rates: [{ from: '2026-01-01', perKwh: 0.1 }] };

// ── Calendar ─────────────────────────────────────────────────────────────

test('a US spring-forward day is 23 hours and a fall-back day 25', () => {
  const len = (d) => (dayStartMs(addDays(d, 1), NY) - dayStartMs(d, NY)) / H;
  assert.equal(len('2026-03-08'), 23);
  assert.equal(len('2026-11-01'), 25);
  assert.equal(len('2026-03-09'), 24);
  assert.equal(len('2026-07-01'), 24);
});

test('local day follows the zone, not UTC', () => {
  const t = ts('2026-10-29T02:30:00Z'); // 22:30 on the 28th in New York
  assert.equal(localDay(NY, t), '2026-10-28');
  assert.equal(localDay('UTC', t), '2026-10-29');
  assert.equal(localDay('Asia/Kolkata', t), '2026-10-29');
});

test('days in a month, including leap February and December', () => {
  assert.equal(daysInMonthOf('2026-10-05'), 31);
  assert.equal(daysInMonthOf('2026-11-05'), 30);
  assert.equal(daysInMonthOf('2026-02-05'), 28);
  assert.equal(daysInMonthOf('2028-02-05'), 29);
  assert.equal(daysInMonthOf('2026-12-31'), 31);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

// ── DST days ─────────────────────────────────────────────────────────────

test('spring-forward day: a steady 100 W is 2.3 kWh over 23 hours, not 2.4', () => {
  const r = world(ts('2026-03-12T16:00:00Z'));
  const d = dayOf(r, '2026-03-08');
  assert.equal(d.kWh, 2.3);
  assert.equal(d.hours, 23);
  assert.equal(d.coverage, 1);
  assert.equal(dayOf(r, '2026-03-07').kWh, 2.4);
  assert.equal(dayOf(r, '2026-03-09').kWh, 2.4);
});

test('fall-back day: a steady 100 W is 2.5 kWh over 25 hours, not 2.4', () => {
  const r = world(ts('2026-11-05T16:00:00Z'));
  const d = dayOf(r, '2026-11-01');
  assert.equal(d.kWh, 2.5);
  assert.equal(d.hours, 25);
  assert.equal(d.coverage, 1);
  assert.equal(dayOf(r, '2026-10-31').kWh, 2.4);
});

test('an hour is added to the local day it lies in (the hour before spring-forward midnight+2)', () => {
  // 100 W only during the hour 01:00-02:00 EST on the 8th, which is the last hour before the jump.
  const only = ts('2026-03-08T07:00:00Z'); // 02:00 EST = hour end
  const r = world(ts('2026-03-10T16:00:00Z'), { watts: (t) => (t === only ? 1000 : null) });
  assert.equal(dayOf(r, '2026-03-08').kWh, 1);
  assert.equal(dayOf(r, '2026-03-07').kWh, null);
  assert.equal(dayOf(r, '2026-03-09').kWh, null);
});

// ── Gaps ─────────────────────────────────────────────────────────────────

test('gaps are gaps, never zeros: missing hours add nothing and lower coverage', () => {
  const r = world(ts('2026-10-20T16:00:00Z'), {
    // Oct 10 local: no reading from 06:00 to 18:00 local (12 hours).
    watts: (t) => {
      const lo = dayStartMs('2026-10-10', NY) + 6 * H;
      return t > lo && t <= lo + 12 * H ? null : 100;
    },
  });
  const d = dayOf(r, '2026-10-10');
  assert.equal(d.kWh, 1.2);
  assert.equal(d.coverage, 0.5);
  assert.equal(dayOf(r, '2026-10-11').kWh, 2.4);
  assert.equal(r.month.gapHours, 12);
});

test('a day with no readings has null kWh and null cost, and is not in the month to date', () => {
  const r = world(ts('2026-10-20T16:00:00Z'), {
    energy: RATE,
    watts: (t) => (localDay(NY, t - 1) === '2026-10-10' ? null : 100),
  });
  const d = dayOf(r, '2026-10-10');
  assert.equal(d.kWh, null);
  assert.equal(d.cost, null);
  assert.equal(d.coverage, 0);
  // 18 whole days read (Oct 1-9, 11-19) + today so far: Oct 10 adds nothing.
  assert.equal(r.month.kWh, round3(18 * 2.4 + 12 * 0.1));
});

const round3 = (n) => Math.round(n * 1000) / 1000;

test('no reading at all in the month leaves month kWh and cost null, not 0', () => {
  const r = world(ts('2026-10-20T16:00:00Z'), {
    energy: RATE,
    watts: (t) => (t < ts('2026-09-25T00:00:00Z') ? 100 : null),
  });
  assert.equal(r.month.kWh, null);
  assert.equal(r.month.cost, null);
  assert.equal(r.month.projected, null);
});

// ── Month, rates, projection ─────────────────────────────────────────────

test('month to date sums only this month, today partial and flagged', () => {
  // Oct 15 12:00 local (16:00Z, EDT). Steady 100 W, $0.10.
  const r = world(ts('2026-10-15T16:00:00Z'), { energy: RATE });
  const today = dayOf(r, '2026-10-15');
  assert.equal(today.partial, true);
  assert.equal(today.hours, 12);
  assert.equal(today.kWh, 1.2);
  assert.equal(today.coverage, 1);
  assert.equal(r.month.partialToday, true);
  // 14 whole days (33.6 kWh) + 1.2 so far.
  assert.equal(r.month.kWh, 34.8);
  assert.equal(r.month.cost, 3.48);
  assert.equal(r.month.since, null);
  assert.equal(r.month.daysLeft, 16);
  assert.equal(dayOf(r, '2026-09-30').partial, false);
});

test('projected month = month to date + days left x trailing mean x current rate', () => {
  const r = world(ts('2026-10-15T16:00:00Z'), { energy: RATE });
  assert.equal(r.month.projected.basisDays, 7);
  assert.equal(r.month.projected.meanDailyKWh, 2.4);
  // 3.48 + 16 x 2.4 x 0.10 = 7.32
  assert.equal(r.month.projected.cost, 7.32);
  assert.equal(r.month.projected.kWh, 73.2);
});

test('the trailing mean is 7 complete days and ignores today and older days', () => {
  // Days Oct 8-14 draw 200 W, everything else 100 W; now Oct 15 12:00.
  const lo = dayStartMs('2026-10-08', NY);
  const hi = dayStartMs('2026-10-15', NY);
  const r = world(ts('2026-10-15T16:00:00Z'), {
    energy: RATE,
    watts: (t) => (t > lo && t <= hi ? 200 : 100),
  });
  assert.equal(r.month.projected.meanDailyKWh, 4.8);
  // MTD: Oct 1-7 at 2.4 + Oct 8-14 at 4.8 + 1.2 today = 16.8 + 33.6 + 1.2 = 51.6 kWh = 5.16
  assert.equal(r.month.cost, 5.16);
  assert.equal(r.month.projected.cost, round2(5.16 + 16 * 4.8 * 0.1));
});

const round2 = (n) => Math.round(n * 100) / 100;

test('the trailing mean skips thinly covered days and averages those that qualify', () => {
  const lo = dayStartMs('2026-10-14', NY);
  const r = world(ts('2026-10-15T16:00:00Z'), {
    energy: RATE,
    // Oct 14: only 6 of 24 hours read, at 1000 W (a poor basis); others 100 W.
    watts: (t) => (t > lo && t <= lo + 24 * H ? (t <= lo + 6 * H ? 1000 : null) : 100),
  });
  assert.equal(r.month.projected.basisDays, 6);
  assert.equal(r.month.projected.meanDailyKWh, 2.4);
});

test('no complete day with readings: no projection rather than a guess', () => {
  // The first reading is 10:00 local today.
  const t0 = ts('2026-10-15T14:00:00Z');
  const r = world(ts('2026-10-15T16:00:00Z'), { energy: RATE, watts: (t) => (t > t0 ? 100 : null) });
  assert.equal(r.month.projected, null);
  assert.equal(r.month.kWh, 0.2);
});

test('a rate change mid-month prices each day at the rate in force that day', () => {
  const energy = {
    currency: '$',
    rates: [
      { from: '2026-01-01', perKwh: 0.1 },
      { from: '2026-10-10', perKwh: 0.2 },
    ],
  };
  const r = world(ts('2026-10-15T16:00:00Z'), { energy });
  assert.equal(dayOf(r, '2026-10-09').ratePerKwh, 0.1);
  assert.equal(dayOf(r, '2026-10-09').cost, 0.24);
  assert.equal(dayOf(r, '2026-10-10').ratePerKwh, 0.2);
  assert.equal(dayOf(r, '2026-10-10').cost, 0.48);
  assert.equal(r.currentRatePerKwh, 0.2);
  // Oct 1-9: 9 x 2.4 x 0.1 = 2.16; Oct 10-14: 5 x 2.4 x 0.2 = 2.4; today 1.2 x 0.2 = 0.24
  assert.equal(r.month.cost, 4.8);
  // The future is priced at the CURRENT rate: 4.8 + 16 x 2.4 x 0.2 = 12.48
  assert.equal(r.month.projected.cost, 12.48);
});

test('a rate that starts in the future is not the current rate and does not touch the past', () => {
  const energy = {
    currency: '$',
    rates: [
      { from: '2026-01-01', perKwh: 0.1 },
      { from: '2026-10-20', perKwh: 0.5 },
    ],
  };
  const r = world(ts('2026-10-15T16:00:00Z'), { energy });
  assert.equal(r.currentRatePerKwh, 0.1);
  assert.equal(r.month.cost, 3.48);
});

test('days before the first rate use the first rate', () => {
  const r = world(ts('2026-10-15T16:00:00Z'), {
    energy: { currency: '€', rates: [{ from: '2026-10-10', perKwh: 0.3 }] },
  });
  assert.equal(dayOf(r, '2026-10-02').ratePerKwh, 0.3);
  assert.equal(dayOf(r, '2026-10-02').cost, 0.72);
  assert.equal(r.currency, '€');
});

test('no rates: kWh only, no money anywhere', () => {
  for (const energy of [undefined, {}, { rates: [] }, { currency: '$', rates: [{ from: 'x', perKwh: -1 }] }]) {
    const r = world(ts('2026-10-15T16:00:00Z'), { energy });
    assert.equal(r.state, 'ok');
    assert.equal(r.currency, null);
    assert.equal(r.currentRatePerKwh, null);
    assert.equal(r.month.cost, null);
    assert.equal(r.month.kWh, 34.8);
    assert.equal(r.month.projected.cost, null);
    assert.equal(r.month.projected.kWh, 73.2);
    for (const d of r.days) {
      assert.equal(d.cost, null);
      assert.equal(d.ratePerKwh, null);
    }
    assert.equal(dayOf(r, '2026-10-14').kWh, 2.4);
  }
});

test('the 1st of a month: month to date is only the hours since midnight, projection uses last month', () => {
  const r = world(ts('2026-11-01T05:00:00Z') + 0, { energy: RATE }); // 01:00 EDT... Nov 1 is fall-back day
  assert.equal(r.month.month, '2026-11');
  assert.equal(dayOf(r, '2026-11-01').partial, true);
  assert.equal(r.month.daysLeft, 29);
  assert.ok(r.month.projected.basisDays >= 1);
});

test('the 31st of a long month: the 1st is past the 30-day range, so it says since the 2nd', () => {
  const r = world(ts('2026-10-31T16:00:00Z'), { energy: RATE }); // Oct 31 12:00 EDT
  assert.equal(r.month.since, '2026-10-02');
  assert.equal(r.days.find((d) => d.day === '2026-10-01'), undefined);
  assert.equal(r.days[0].day, '2026-10-02');
  assert.equal(r.month.daysLeft, 0);
  // Oct 2-30 whole (29 days) + 12 hours today.
  assert.equal(r.month.kWh, round3(29 * 2.4 + 1.2));
  // No days left: the projection is the month to date.
  assert.equal(r.month.projected.cost, r.month.cost);
});

test('the 30th of a 30-day month needs no since; the 31st of a 31-day month does', () => {
  // Nov 30 12:00 EST: the range starts Oct 31, so Nov 1 is whole.
  assert.equal(world(ts('2026-11-30T17:00:00Z')).month.since, null);
  assert.equal(world(ts('2026-12-31T17:00:00Z')).month.since, '2026-12-02');
  assert.equal(world(ts('2026-12-30T17:00:00Z')).month.since, null);
});

test('month boundary: the last day of one month is not in the next month to date', () => {
  const r = world(ts('2026-11-03T17:00:00Z'), { energy: RATE });
  assert.equal(r.month.month, '2026-11');
  // Nov 1 is 25 h at 100 W, Nov 2 24 h, Nov 3 so far 12 h (7 EST... 12:00 EST = 17:00Z).
  assert.equal(r.month.kWh, round3(2.5 + 2.4 + 1.2));
  assert.equal(dayOf(r, '2026-10-31').kWh, 2.4);
});

test('a zone off the hour splits an hour that straddles local midnight by its minutes', () => {
  // Kolkata UTC+5:30: local midnight is 18:30Z. Constant 1000 W: a day is 24 kWh, every day.
  const r = world(ts('2026-10-20T10:00:00Z'), { zone: 'Asia/Kolkata', watts: () => 1000 });
  assert.equal(dayOf(r, '2026-10-15').kWh, 24);
  assert.equal(dayOf(r, '2026-10-15').hours, 24);
  assert.equal(dayOf(r, '2026-10-15').coverage, 1);
  // One hour with 2000 W ending 19:00Z straddles midnight: half in each day.
  const spike = ts('2026-10-14T19:00:00Z');
  const s = world(ts('2026-10-20T10:00:00Z'), {
    zone: 'Asia/Kolkata',
    watts: (t) => (t === spike ? 2000 : 1000),
  });
  assert.equal(dayOf(s, '2026-10-14').kWh, 24.5);
  assert.equal(dayOf(s, '2026-10-15').kWh, 24.5);
});

test('stats are hourly min, max and mean for the last 24 h and the range', () => {
  const r = world(ts('2026-10-15T16:00:00Z'), {
    watts: (t) => (t === ts('2026-10-15T15:00:00Z') ? 150 : t === ts('2026-10-01T15:00:00Z') ? 50 : 100),
  });
  assert.equal(r.stats.last24h.maxWatts, 150);
  assert.equal(r.stats.last24h.minWatts, 100);
  assert.equal(r.stats.range.minWatts, 50);
  assert.equal(r.stats.range.maxWatts, 150);
  assert.equal(r.stats.last24h.avgWatts, 102.1);
});

// ── Rate lookup ──────────────────────────────────────────────────────────

test('rateFor: on the day, before the first, after the last, one row, none, unsorted', () => {
  const rates = [
    { from: '2026-01-01', perKwh: 0.1 },
    { from: '2026-06-01', perKwh: 0.2 },
    { from: '2026-09-15', perKwh: 0.3 },
  ];
  assert.equal(rateFor(rates, '2026-06-01'), 0.2); // on the from day
  assert.equal(rateFor(rates, '2026-05-31'), 0.1); // the day before a change
  assert.equal(rateFor(rates, '2025-12-31'), 0.1); // before the first
  assert.equal(rateFor(rates, '2030-01-01'), 0.3); // after the last
  assert.equal(rateFor([rates[2]], '2020-01-01'), 0.3);
  assert.equal(rateFor([], '2026-01-01'), null);
  assert.equal(rateFor([rates[2], rates[0], rates[1]], '2026-07-01'), 0.2);
  assert.equal(rateFor([rates[2], rates[0], rates[1]], '2020-01-01'), 0.1);
});

// ── Parsing the matrix ───────────────────────────────────────────────────

test('samplesOf puts points on the whole-hour grid and turns missing, NaN and negative into gaps', () => {
  const start = 3600 * 100;
  const end = start + 4 * 3600;
  const matrix = [
    {
      metric: { ups: 'apcups' },
      values: [
        [start, '89.1'],
        [start + 3600, 'NaN'],
        [start + 3 * 3600, '-5'],
        [start + 4 * 3600, '90'],
      ],
    },
  ];
  assert.deepEqual(
    samplesOf(matrix, start, end).map((s) => s.watts),
    [89.1, null, null, null, 90]
  );
  assert.equal(samplesOf(matrix, start, end)[0].t, start * 1000);
});

test('samplesOf: nothing, or only gaps, is no UPS; several UPSes take the first by name with a reading', () => {
  assert.equal(samplesOf([], 0, 7200), null);
  assert.equal(samplesOf([{ metric: { ups: 'a' }, values: [[0, 'NaN']] }], 0, 7200), null);
  const got = samplesOf(
    [
      { metric: { ups: 'b' }, values: [[0, '200']] },
      { metric: { ups: 'a' }, values: [[0, 'NaN']] },
      { metric: { ups: 'c' }, values: [[0, '300']] },
    ],
    0,
    0
  );
  assert.equal(got[0].watts, 200);
});

test('the query narrows both metrics to JAGHELM_UPS_NAME, and escapes it', () => {
  assert.equal(
    wattsQuery('apcups'),
    'avg_over_time(nut_load{ups="apcups"}[1h]) * on(ups) avg_over_time(nut_real_power_nominal_watts{ups="apcups"}[1h])'
  );
  assert.equal(
    wattsQuery(null),
    'avg_over_time(nut_load[1h]) * on(ups) avg_over_time(nut_real_power_nominal_watts[1h])'
  );
  assert.match(wattsQuery('a"b'), /ups="a\\"b"/);
});

// ── The cache ────────────────────────────────────────────────────────────

const NOW = ts('2026-10-15T16:20:00Z');

/** A cache over a counting fake Prometheus; `answer` builds the matrix for a span. */
function rig({ answer, config, name = null } = {}) {
  let clock = NOW;
  const calls = [];
  const cfg = { value: config ?? { energy: RATE, alerts: { timezone: NY } } };
  const queryRange =
    answer ??
    (async (q, span) => {
      const values = [];
      for (let t = span.start; t <= span.end; t += 3600) values.push([t, '100']);
      return [{ metric: { ups: 'apcups' }, values }];
    });
  const cache = createEnergyCostCache({
    queryRange: async (q, span) => {
      calls.push({ q, span });
      return queryRange(q, span);
    },
    now: () => clock,
    config: () => cfg.value,
    upsName: () => name,
    logger: { info() {}, warn() {} },
  });
  return { cache, calls, cfg, advance: (ms) => (clock += ms) };
}

test('many reads within the hour cost one query, and concurrent reads share it', async () => {
  const { cache, calls } = rig();
  const all = await Promise.all(Array.from({ length: 20 }, () => cache.read()));
  assert.equal(calls.length, 1);
  assert.ok(all.every((r) => r.state === 'ok'));
  for (let i = 0; i < 30; i++) await cache.read();
  assert.equal(calls.length, 1);
});

test('the query is one range query: 30 days, hourly step, ending on a whole hour', async () => {
  const { cache, calls } = rig();
  await cache.read();
  const { start, end, step } = calls[0].span;
  assert.equal(step, 3600);
  assert.equal(end % 3600, 0);
  assert.equal(end - start, 30 * 86400);
  assert.ok(end * 1000 <= NOW && NOW - end * 1000 < H);
  assert.equal((end - start) / step + 1, 721);
});

test('the next hour asks again, once', async () => {
  const { cache, calls, advance } = rig();
  await cache.read();
  advance(30 * 60_000); // 16:50, same hour
  await cache.read();
  assert.equal(calls.length, 1);
  advance(11 * 60_000); // 17:01
  await Promise.all([cache.read(), cache.read(), cache.read()]);
  assert.equal(calls.length, 2);
});

test('a saved rate or zone applies at once, without another query', async () => {
  const { cache, calls, cfg } = rig();
  const a = await cache.read();
  assert.equal(a.currentRatePerKwh, 0.1);
  cfg.value = { energy: { currency: '£', rates: [{ from: '2026-01-01', perKwh: 0.3 }] }, alerts: { timezone: 'UTC' } };
  const b = await cache.read();
  assert.equal(b.currentRatePerKwh, 0.3);
  assert.equal(b.currency, '£');
  assert.equal(b.zone, 'UTC');
  assert.equal(calls.length, 1);
});

test('the zone is alerts.timezone, else the server zone', async () => {
  const { cache, cfg } = rig();
  assert.equal((await cache.read()).zone, NY);
  cfg.value = { energy: RATE }; // no `alerts` saved: the server's own zone
  assert.equal((await cache.read()).zone, systemTimezone());
  cfg.value = null; // no display config at all
  assert.equal((await cache.read()).state, 'ok');
});

test('no UPS data (an empty answer, or only gaps) is the no-ups state, and is kept for the hour', async () => {
  const empty = rig({ answer: async () => [] });
  assert.deepEqual(await empty.cache.read(), { state: 'no-ups' });
  await empty.cache.read();
  assert.equal(empty.calls.length, 1);
  const quiet = rig({ answer: async () => [{ metric: { ups: 'x' }, values: [[0, 'NaN']] }] });
  assert.deepEqual(await quiet.cache.read(), { state: 'no-ups' });
});

test('a Prometheus failure is the fixed sentence, not its text, and is retried after the failure TTL', async () => {
  let fail = true;
  const { cache, calls, advance } = rig({
    answer: async (q, span) => {
      if (fail) throw Object.assign(new Error('connect ECONNREFUSED 10.1.2.3:9090'), { code: 'ECONNREFUSED' });
      return [{ metric: { ups: 'a' }, values: [[span.end, '100']] }];
    },
  });
  const r = await cache.read();
  assert.equal(r.state, 'failed');
  assert.equal(r.error, 'Prometheus refused the connection');
  assert.doesNotMatch(JSON.stringify(r), /10\.1\.2\.3|ECONNREFUSED/);
  await cache.read();
  assert.equal(calls.length, 1); // kept briefly
  fail = false;
  advance(FAILURE_TTL_MS + 1);
  assert.equal((await cache.read()).state, 'ok');
  assert.equal(calls.length, 2);
});

test('JAGHELM_UPS_NAME is in the query and in the cache key', async () => {
  const { cache, calls } = rig({ name: 'apcups' });
  await cache.read();
  assert.match(calls[0].q, /nut_load\{ups="apcups"\}/);
});

test('the result carries finished numbers only: no PromQL, no raw matrix', async () => {
  const { cache } = rig();
  const r = await cache.read();
  const text = JSON.stringify(r);
  assert.doesNotMatch(text, /nut_|avg_over_time|metric|values/);
  assert.deepEqual(Object.keys(r).sort(), ['currency', 'currentRatePerKwh', 'days', 'month', 'state', 'stats', 'throughMs', 'zone']);
});
