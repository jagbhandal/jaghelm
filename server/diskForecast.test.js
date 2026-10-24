/**
 * The disk forecast (#670, diskForecast.js): when a line is believed and when
 * it is not, which mounts are asked about, and the cache that keeps every
 * reader on one pair of queries.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CACHE_TTL_MS,
  FAILURE_TTL_MS,
  MAX_DAYS,
  STEP_SECONDS,
  createDiskForecastCache,
  forecastQueries,
  forecastSeries,
  forecastsOf,
} from './diskForecast.js';

const GB = 1024 ** 3;
const DAY = 86_400;
const END = 1_800_000_000;
const SIZE = 100 * GB;

/** Hourly points for `days`, ending at `end`: `usedAt(dayIndex)` bytes. */
function hourly(days, usedAt, end = END) {
  const out = [];
  for (let t = end - days * DAY; t <= end; t += STEP_SECONDS)
    out.push([t, usedAt((t - (end - days * DAY)) / DAY)]);
  return out;
}

test('steady growth: days left is what remains over the growth per day', () => {
  // 50 GB used, +2 GB a day: 25 days left.
  const points = hourly(7, (d) => 36 * GB + 2 * GB * d);
  const f = forecastSeries(points, SIZE, END);
  assert.equal(f.status, 'ok');
  assert.ok(Math.abs(f.daysLeft - 25) < 0.2, String(f.daysLeft));
  assert.ok(f.r2 > 0.99);
  assert.ok(Math.abs(f.growthBytesPerDay - 2 * GB) < 0.01 * GB);
});

test('flat or shrinking is stable, with no date', () => {
  for (const slope of [0, -1 * GB]) {
    const f = forecastSeries(
      hourly(7, (d) => 60 * GB + slope * d),
      SIZE,
      END
    );
    assert.equal(f.status, 'stable');
    assert.equal(f.daysLeft, null);
  }
});

test('growth that would take over a year is stable, not a far date', () => {
  const f = forecastSeries(
    hourly(7, (d) => 10 * GB + 0.1 * GB * d),
    SIZE,
    END
  );
  assert.equal(f.status, 'stable');
  assert.ok(f.growthBytesPerDay > 0);
  assert.ok((90 * GB) / f.growthBytesPerDay > MAX_DAYS);
});

test('a sawtooth of fill and cleanup is noisy, never a date', () => {
  // Under the cleanup line (2% of the size) every 6 h, over a slow climb.
  const points = hourly(7, (d) => 40 * GB + 0.2 * GB * d + ((d * 4) % 1) * 1.9 * GB);
  const f = forecastSeries(points, SIZE, END);
  assert.equal(f.status, 'noisy');
  assert.equal(f.daysLeft, null);
  assert.ok(f.r2 < 0.6);
});

test('sawtooth teeth over the cleanup line leave too little to fit', () => {
  const points = hourly(7, (d) => 40 * GB + ((d * 4) % 1) * 5 * GB);
  assert.equal(forecastSeries(points, SIZE, END).status, 'insufficient');
});

test('a big cleanup restarts the fit after it', () => {
  // 90 GB climbing 3 GB a day for 3 days, a 60 GB prune, then 30 GB climbing 1 GB a day for 4 days.
  const points = hourly(7, (d) => (d < 3 ? 80 * GB + 3 * GB * d : 30 * GB + 1 * GB * (d - 3)));
  const f = forecastSeries(points, SIZE, END);
  assert.equal(f.status, 'ok');
  assert.ok(Math.abs(f.daysLeft - 66) < 2, String(f.daysLeft));
});

test('too few hours after a cleanup is insufficient', () => {
  const points = hourly(7, (d) => (d < 6.5 ? 80 * GB + 1 * GB * d : 20 * GB));
  assert.equal(forecastSeries(points, SIZE, END).status, 'insufficient');
  assert.equal(
    forecastSeries(
      hourly(1, (d) => 50 * GB + 3 * GB * d),
      SIZE,
      END
    ).status,
    'insufficient'
  );
});

test('a node that stopped answering is nodata, never a forecast', () => {
  const points = hourly(7, (d) => 40 * GB + 3 * GB * d, END - 3 * STEP_SECONDS);
  const f = forecastSeries(points, SIZE, END);
  assert.equal(f.status, 'nodata');
  assert.equal(f.daysLeft, null);
  assert.equal(forecastSeries([], SIZE, END).status, 'nodata');
});

test('a full disk has 0 days left', () => {
  const points = hourly(7, (d) => 94 * GB + 1 * GB * d);
  const f = forecastSeries(points, 100 * GB, END);
  assert.equal(f.status, 'ok');
  assert.equal(f.daysLeft, 0);
});

test('the queries read avail, so blocks reserved for root are not space to fill', () => {
  const { used } = forecastQueries('node=~"a"');
  assert.match(used, /node_filesystem_avail_bytes/);
  assert.doesNotMatch(used, /node_filesystem_free_bytes/);
});

test('the queries leave out pseudo filesystems and Docker copies of mounts', () => {
  const { used, size } = forecastQueries('node=~"a|b"');
  for (const q of [used, size]) {
    assert.match(q, /fstype!~"tmpfs\|overlay\|squashfs/);
    assert.match(q, /mountpoint!~"\.\*\/var\/lib\/\(docker\|containers\|kubelet\)/);
    assert.match(q, /node=~"a\|b"/);
  }
  assert.match(
    used,
    /^max by \(node, mountpoint\) \(node_filesystem_size_bytes\{.*\} - node_filesystem_avail_bytes\{/
  );
});

const metric = (node, mountpoint) => ({ node, mountpoint });
const series = (m, values) => ({ metric: m, values });
const matrixOf = (pts) => pts.map(([t, v]) => [t, String(v)]);

test('a node is summed up by its fullest mount, else the one its meter shows', () => {
  const growing = matrixOf(hourly(7, (d) => 40 * GB + 2 * GB * d));
  const flat = matrixOf(hourly(7, (d) => 50 * GB));
  const sizeOf = (m, size) => series(m, [[END, String(size)]]);
  const lineOf = (m) => (m?.node === 'vm' ? ['vm-103'] : m?.node === 'nas' ? ['nas'] : []);
  const out = forecastsOf({
    usedMatrix: [
      series(metric('vm', '/'), flat),
      series(metric('vm', '/data'), growing),
      series(metric('nas', '/vol1'), flat),
      series(metric('nas', '/vol2'), flat),
    ],
    sizeMatrix: [
      sizeOf(metric('vm', '/'), SIZE),
      sizeOf(metric('vm', '/data'), SIZE),
      sizeOf(metric('nas', '/vol1'), 10 * SIZE),
      sizeOf(metric('nas', '/vol2'), 20 * SIZE),
    ],
    lineOf,
    end: END,
  });
  assert.equal(out['vm-103'].mount, '/data');
  assert.equal(out['vm-103'].primary, false);
  assert.equal(out['vm-103'].status, 'ok');
  // No `/` on the NAS: its largest filesystem, as the disk meter picks it.
  assert.equal(out.nas.mount, '/vol2');
  assert.equal(out.nas.primary, true);
  assert.equal(out.nas.status, 'stable');
});

// ── The cache ──────────────────────────────────────────────────────────

const CONFIG = { nodes: { vm: { prometheus_node: 'vm-103' }, hidden: { visible: false } } };

function harness() {
  const calls = [];
  let t = END * 1000;
  let fail = false;
  const queryRange = async (query, range) => {
    calls.push({ query, range });
    if (fail) throw Object.assign(new Error('boom'), { failure: 'refused' });
    const m = metric('vm-103', '/');
    return query.includes(' - ')
      ? [series(m, matrixOf(hourly(7, (d) => 40 * GB + 2 * GB * d)))]
      : [series(m, [[END, String(SIZE)]])];
  };
  const logs = [];
  const logger = {
    warn: (...a) => logs.push(['warn', ...a]),
    info: (...a) => logs.push(['info', ...a]),
  };
  const cache = createDiskForecastCache({ queryRange, now: () => t, logger });
  return { cache, calls, logs, advance: (ms) => (t += ms), fail: (v) => (fail = v) };
}

test('readers within the TTL share one pair of queries, and the answer names the node key', async () => {
  const h = harness();
  const [a, b] = await Promise.all([h.cache.answer(CONFIG), h.cache.answer(CONFIG)]);
  await h.cache.answer(CONFIG);
  assert.equal(h.calls.length, 2);
  assert.equal(a.body, b.body);
  assert.equal(a.body.ok, true);
  assert.equal(a.body.nodes.vm.status, 'ok');
  assert.ok(!h.calls[0].query.includes('hidden'));
  h.advance(CACHE_TTL_MS + 1);
  await h.cache.answer(CONFIG);
  assert.equal(h.calls.length, 4);
});

test('a failed read says so once, is kept briefly, and recovers', async () => {
  const h = harness();
  h.fail(true);
  const first = await h.cache.answer(CONFIG);
  assert.equal(first.body.ok, false);
  assert.match(first.body.error, /Prometheus/);
  assert.deepEqual(first.body.nodes, {});
  await h.cache.answer(CONFIG);
  assert.equal(h.calls.length, 2, 'kept: not asked again at once');
  h.advance(FAILURE_TTL_MS + 1);
  await h.cache.answer(CONFIG);
  assert.equal(h.logs.filter(([l]) => l === 'warn').length, 1);
  h.fail(false);
  h.advance(FAILURE_TTL_MS + 1);
  const ok = await h.cache.answer(CONFIG);
  assert.equal(ok.body.ok, true);
  assert.equal(h.logs.filter(([l]) => l === 'info').length, 1);
});

test('with no visible node nothing is asked', async () => {
  const h = harness();
  const out = await h.cache.answer({ nodes: { x: { visible: false } } });
  assert.deepEqual(out.body.nodes, {});
  assert.equal(h.calls.length, 0);
});

test('a failed read keeps serving the last good answer', async () => {
  const h = harness();
  const good = await h.cache.answer(CONFIG);
  h.fail(true);
  h.advance(CACHE_TTL_MS + 1);
  const after = await h.cache.answer(CONFIG);
  assert.equal(after.body.ok, true);
  assert.equal(after.body.nodes.vm.status, 'ok');
  assert.equal(after.body, good.body);
  assert.equal(h.logs.filter(([l]) => l === 'warn').length, 1);
});

test('a mount with no current readings is never the primary one', () => {
  const lineOf = () => ['n'];
  const sizeOf = (mount, size) => series(metric('n', mount), [[END, String(size)]]);
  const out = forecastsOf({
    usedMatrix: [
      series(metric('n', '/'), matrixOf(hourly(7, () => 10 * GB, END - 10 * STEP_SECONDS))),
      series(metric('n', '/data'), matrixOf(hourly(7, () => 10 * GB))),
    ],
    sizeMatrix: [sizeOf('/', SIZE), sizeOf('/data', 2 * SIZE)],
    lineOf,
    end: END,
  });
  assert.equal(out.n.mount, '/data');
  assert.equal(out.n.primary, true);
});

test('a node with no series is nodata when it is not reachable, and absent when it is', () => {
  const out = forecastsOf({
    usedMatrix: [],
    sizeMatrix: [],
    lineOf: () => [],
    end: END,
    keys: ['ms-s1', 'diskless'],
    unreachable: (k) => k === 'ms-s1',
  });
  assert.deepEqual(Object.keys(out), ['ms-s1']);
  assert.equal(out['ms-s1'].status, 'nodata');
});
