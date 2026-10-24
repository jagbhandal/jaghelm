/**
 * GET/PUT /api/thresholds (#320): the lines Settings → Notifications edits,
 * saved to thresholds.json with the config files' write discipline (a version
 * in If-Match, 428 without one, 409 over a stale one, an atomic write), each
 * table checked first (400 with why and the metric), and judged by from the
 * next cycle: the status model's thresholds, so push's too.
 * Auth-disabled harness; notifications.auth.test.js covers the 401.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-thresholds-route-'));
process.env.JAGHELM_DATA_DIR = dataDir;
delete process.env.DASH_PASS;
process.env.PROMETHEUS_URL = 'http://127.0.0.1:1';
process.env.KUMA_URL = 'http://127.0.0.1:1';

const { app } = await import('../index.js');
const { stopBackgroundRefresh, updateStatus, getThresholds } = await import('../refresh.js');

const FILE = join(dataDir, 'thresholds.json');
const DISPLAY = join(dataDir, 'display-config.json');

after(() => {
  stopBackgroundRefresh();
  rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(FILE, { force: true });
  rmSync(DISPLAY, { force: true });
});

const pct = (warn, crit) => (crit === undefined ? { warn, unit: '%' } : { warn, crit, unit: '%' });
const byMetric = (body) => Object.fromEntries(body.thresholds.map((r) => [r.metric, r]));

async function read() {
  const r = await request(app).get('/api/thresholds');
  assert.equal(r.status, 200);
  return r;
}

const put = (body, etag) => {
  const req = request(app).put('/api/thresholds');
  if (etag) req.set('If-Match', etag);
  return req.send(body);
};

test('GET: the defaults in force, in percent and °C, with a version', async () => {
  const r = await read();
  assert.match(r.headers.etag, /^"[^"]+"$/);
  assert.equal(r.headers['cache-control'], 'no-store');
  const rows = byMetric(r.body);
  assert.deepEqual(Object.keys(rows), ['cpu', 'mem', 'disk', 'temp']);
  assert.deepEqual(rows.disk, {
    metric: 'disk',
    unit: '%',
    warn: 90,
    crit: 95,
    defaults: { warn: 90, crit: 95 },
    min: 10,
    max: 100,
    band: 5,
    custom: false,
  });
  assert.deepEqual([rows.temp.unit, rows.temp.warn, rows.temp.crit], ['°C', 75, 85]);
  assert.equal(rows.cpu.crit, null);
  assert.deepEqual([rows.cpu.band, rows.temp.band], [5, 5]);
});

test('GET: the hysteresis in force is each row’s band, a hand-edited one too', async () => {
  writeFileSync(DISPLAY, JSON.stringify({ pushThresholds: { hysteresis: 0.03 } }));
  const rows = byMetric((await read()).body);
  assert.deepEqual([rows.cpu.band, rows.mem.band, rows.disk.band, rows.temp.band], [3, 3, 3, 5]);
});

test("GET: with no saved lines, display-config's hand-edited pushThresholds are what is in force", async () => {
  writeFileSync(DISPLAY, JSON.stringify({ pushThresholds: { mem: 0.875 } }));
  const rows = byMetric((await read()).body);
  assert.deepEqual([rows.mem.warn, rows.mem.custom], [87.5, true]);
});

test('PUT: saves over the version read, answers the new lines and version, and the next status judges by them', async () => {
  const first = await read();
  assert.equal(updateStatus()?.thresholds.disk.warn, 0.9);

  const r = await put(
    { disk: pct(88, 94), temp: { warn: 70, crit: 80, unit: '°C' } },
    first.headers.etag
  );
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.notEqual(r.headers.etag, first.headers.etag);
  const rows = byMetric(r.body);
  assert.deepEqual([rows.disk.warn, rows.disk.crit, rows.disk.custom], [88, 94, true]);
  assert.deepEqual([rows.temp.warn, rows.temp.crit], [70, 80]);
  // Only what differs from the defaults is kept, each with its unit.
  assert.deepEqual(JSON.parse(readFileSync(FILE, 'utf8')), {
    disk: { warn: 88, crit: 94, unit: '%' },
    temp: { warn: 70, crit: 80, unit: '°C' },
  });
  // The read after it has the same version.
  assert.equal((await read()).headers.etag, r.headers.etag);

  // The next cycle: the status model judges by the saved lines (push sends what it judges).
  const status = updateStatus();
  assert.deepEqual(status.thresholds.disk, { warn: 0.88, crit: 0.94 });
  assert.deepEqual(status.thresholds.temp, { warn: 70, crit: 80 });
  assert.deepEqual(getThresholds().disk, { warn: 0.88, crit: 0.94 });

  // Reset to default: null (or left out) for the row.
  const reset = await put({ disk: null }, r.headers.etag);
  assert.equal(reset.status, 200);
  assert.equal(byMetric(reset.body).disk.custom, false);
  assert.deepEqual(JSON.parse(readFileSync(FILE, 'utf8')), {});
  assert.deepEqual(updateStatus().thresholds.disk, { warn: 0.9, crit: 0.95 });
});

test('PUT: the first save replaces the hand-edited pushThresholds lines, keeping its hysteresis', async () => {
  writeFileSync(DISPLAY, JSON.stringify({ pushThresholds: { cpu: 0.7, hysteresis: 0.03 } }));
  const first = await read();
  assert.equal(byMetric(first.body).cpu.warn, 70);
  const r = await put({ mem: pct(80) }, first.headers.etag);
  assert.equal(r.status, 200);
  const t = getThresholds();
  assert.deepEqual([t.cpu.warn, t.mem.warn, t.hysteresis.fraction], [0.9, 0.8, 0.03]);
});

test('PUT: 400 for a table it would not judge by, with why and the metric; nothing written', async () => {
  const { etag } = (await read()).headers;
  const cases = [
    [
      { disk: pct(95, 95) },
      'disk',
      /warning line \(95 %\) must be under its critical line \(95 %\)/,
    ],
    [{ disk: pct(96, 95) }, 'disk', /must be under its critical line/],
    [{ cpu: pct(150) }, 'cpu', /from 10 to 100 %/],
    [{ temp: { warn: 70, crit: 200, unit: '°C' } }, 'temp', /from 30 to 120 °C/],
    [{ temp: { warn: 160, crit: 185, unit: '°F' } }, 'temp', /temp's unit is °C/],
    [{ mem: { warn: 0.9, unit: 'fraction' } }, 'mem', /mem's unit is %/],
    [{ gpu: pct(90) }, 'gpu', /There is no threshold for "gpu"/],
  ];
  for (const [body, metric, error] of cases) {
    const r = await put(body, etag);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(r.body.error, error);
    assert.equal(r.body.metric, metric);
  }
  const notObject = await put([], etag);
  assert.equal(notObject.status, 400);
  assert.equal(existsSync(FILE), false);
});

test('PUT: 428 without a version, 409 over a stale one (with the version now); nothing written', async () => {
  const none = await put({ cpu: pct(80) });
  assert.equal(none.status, 428);
  assert.match(none.body.error, /no thresholds version/);
  assert.equal(existsSync(FILE), false);

  const { etag } = (await read()).headers;
  // Another device saves first.
  const other = await put({ cpu: pct(80) }, etag);
  assert.equal(other.status, 200);
  const stale = await put({ mem: pct(70) }, etag);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.stale, true);
  assert.equal(stale.headers.etag, other.headers.etag);
  assert.deepEqual(JSON.parse(readFileSync(FILE, 'utf8')), { cpu: { warn: 80, unit: '%' } });
  // A hand edit moves the version too.
  writeFileSync(FILE, JSON.stringify({ cpu: { warn: 75, unit: '%' } }));
  assert.equal((await put({ mem: pct(70) }, other.headers.etag)).status, 409);
});

test("a thresholds.json that doesn't parse, or holds a line a save would refuse: 503 with why, the model ignores it, and a save over its version rewrites it", async () => {
  writeFileSync(FILE, '{"disk": {"warn": 88,');
  const broken = await request(app).get('/api/thresholds');
  assert.equal(broken.status, 503);
  assert.equal(broken.body.code, 'config_unparseable');
  assert.match(broken.body.error, /thresholds.json doesn't parse .*the next save rewrites it/);
  assert.ok(!broken.body.error.includes('"warn"'), 'never quotes the file');
  assert.deepEqual(getThresholds().disk, { warn: 0.9, crit: 0.95 });

  writeFileSync(FILE, JSON.stringify({ disk: { warn: 99, crit: 90, unit: '%' } }));
  const refused = await request(app).get('/api/thresholds');
  assert.equal(refused.status, 503);
  assert.match(refused.body.error, /holds a line JagHelm won't use \(disk's warning line/);
  assert.deepEqual(getThresholds().disk, { warn: 0.9, crit: 0.95 });

  const r = await put({ disk: pct(85, 92) }, refused.headers.etag);
  assert.equal(r.status, 200);
  assert.deepEqual(getThresholds().disk, { warn: 0.85, crit: 0.92 });
});

test("a thresholds.json that can't be read: 503 config_unreadable, and nothing saved over it", async (t) => {
  if (process.getuid?.() === 0) return t.skip('root reads any file');
  writeFileSync(FILE, '{}');
  chmodSync(FILE, 0o000);
  try {
    const r = await request(app).get('/api/thresholds');
    assert.equal(r.status, 503);
    assert.equal(r.body.code, 'config_unreadable');
    assert.match(r.body.error, /permission denied/);
    const save = await put({ cpu: pct(80) }, '"anything"');
    assert.equal(save.status, 503);
  } finally {
    chmodSync(FILE, 0o600);
  }
});
