/**
 * The phase-lock hint (#630): X-Next-Refresh-Ms on /api/status and
 * /api/services: ms until the background loop's next cycle has built what
 * they serve. Pure arithmetic first, then the real app and loop: after a
 * cycle, during one, after the Settings slider changes the interval, and with
 * no loop running.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-hint-'));
process.env.JAGHELM_DATA_DIR = dataDir;
process.env.DASH_PASS = 'test-pass-1234';
process.env.PROMETHEUS_URL = 'http://127.0.0.1:1';
process.env.KUMA_URL = 'http://127.0.0.1:1';

const { app } = await import('./index.js');
const refresh = await import('./refresh.js');
const { createSession } = await import('./auth/sessions.js');
const { setCache } = await import('./cache.js');

const token = createSession('admin');
const CONFIG = join(dataDir, 'display-config.json');

after(() => {
  refresh.stopBackgroundRefresh();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DASH_PASS;
});

const idle = { now: 100_000, intervalMs: 30_000, nextAt: 0, startedAt: 0, lastMs: 0, running: false };

test('hint: the next cycle start, plus the last cycle length and the settle margin, from now', () => {
  const ms = refresh.refreshHintMs({ ...idle, nextAt: 112_000, lastMs: 300 });
  assert.equal(ms, 12_000 + 300 + refresh.REFRESH_SETTLE_MS);
});

test('hint: held to 1 s .. 2 x the interval', () => {
  assert.equal(refresh.refreshHintMs({ ...idle, nextAt: 99_000 }), refresh.REFRESH_HINT_MIN_MS);
  assert.equal(refresh.refreshHintMs({ ...idle, nextAt: 900_000 }), 60_000);
});

test('hint: a running cycle counts from its own start, and one overrunning asks again in 1 s', () => {
  const run = { ...idle, running: true, lastMs: 400 };
  assert.equal(refresh.refreshHintMs({ ...run, startedAt: 100_500 }), 1_150);
  assert.equal(refresh.refreshHintMs({ ...run, startedAt: 90_000 }), refresh.REFRESH_HINT_MIN_MS);
  // Not the interval away, as an idle loop's next cycle would be.
  assert.ok(refresh.refreshHintMs({ ...run, startedAt: 99_000, nextAt: 129_000 }) < 5_000);
});

async function hintOf(path = '/api/status') {
  if (path === '/api/status') setCache('status', { overall: { state: 'ok' }, issues: [] }, null, { ttlMs: 60_000 });
  const r = await request(app).get(path).set('x-auth-token', token);
  return r.headers['x-next-refresh-ms'];
}

test('no loop running: no header', async () => {
  refresh.stopBackgroundRefresh();
  assert.equal(await hintOf('/api/status'), undefined);
  assert.equal(await hintOf('/api/services'), undefined);
  assert.equal(refresh.nextRefreshHintMs(), null);
});

test('after a cycle: both reads carry a whole number of ms within the clamp', async () => {
  writeFileSync(CONFIG, JSON.stringify({ refreshInterval: 30 }));
  refresh.invalidateDisplayConfigCache();
  refresh.startBackgroundRefresh();
  await new Promise((r) => setTimeout(r, 1500)); // the first cycle finishes (Prometheus is unreachable)
  for (const path of ['/api/status', '/api/services']) {
    const ms = Number(await hintOf(path));
    assert.ok(Number.isInteger(ms), `${path} sent an integer`);
    assert.ok(ms > 20_000 && ms <= 31_000, `${path}: ${ms} is about one 30 s interval away`);
  }
});

test('a 304 carries the hint too', async () => {
  setCache('status', { overall: { state: 'ok' }, issues: [] }, null, { ttlMs: 60_000 });
  const first = await request(app).get('/api/status').set('x-auth-token', token);
  const again = await request(app).get('/api/status').set('x-auth-token', token).set('If-None-Match', first.headers.etag);
  assert.equal(again.status, 304);
  assert.ok(Number(again.headers['x-next-refresh-ms']) > 0);
});

test('the Settings slider governs the cadence the hint reports', async () => {
  const get = await request(app).get('/api/display-config').set('x-auth-token', token);
  const save = (refreshInterval, version) =>
    request(app).post('/api/display-config').set('x-auth-token', token).set('If-Match', version).send({ refreshInterval });
  const s60 = await save(60, get.headers.etag);
  assert.equal(s60.status, 200);
  let ms = Number(await hintOf());
  assert.ok(ms > 50_000 && ms <= 61_000, `60 s slider: hint ${ms}`);
  const s15 = await save(15, s60.headers.etag);
  assert.equal(s15.status, 200);
  ms = Number(await hintOf());
  assert.ok(ms > 10_000 && ms <= 16_000, `15 s slider: hint ${ms}`);
});

