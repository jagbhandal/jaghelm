/**
 * Push API route contract (auth-disabled harness). Drives the imported app with
 * supertest against an isolated temp data dir, mirroring server/index.test.js.
 * Push is disabled (no FCM creds) — deliveryEnabled/enabled are therefore false,
 * which is exactly the graceful-disable path Phase 4 must keep unit-testable.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-push-'));
process.env.JAGHELM_DATA_DIR = dataDir;
delete process.env.DASH_PASS; // auth disabled
delete process.env.FCM_SERVICE_ACCOUNT; // push disabled (no creds)
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
process.env.PROMETHEUS_URL = 'http://127.0.0.1:1';
process.env.KUMA_URL = 'http://127.0.0.1:1';

const { app } = await import('../index.js');
const { stopBackgroundRefresh } = await import('../refresh.js');

after(() => {
  stopBackgroundRefresh();
  rmSync(dataDir, { recursive: true, force: true });
});

// ── Task 31: GET /api/push/status ────────────────────────────────────────────

test('GET /api/push/status → 200 { enabled:false } when push is disabled', async () => {
  const r = await request(app).get('/api/push/status');
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /json/);
  assert.equal(r.body.enabled, false);
});

// ── Task 32: POST /api/push/register ─────────────────────────────────────────

test('POST /api/push/register → { stored:true, deliveryEnabled:false } and persists the token', async () => {
  const r = await request(app)
    .post('/api/push/register')
    .send({ token: 'tok-aaa', platform: 'android', appVersion: '1.0.0' });
  assert.equal(r.status, 200);
  assert.equal(r.body.stored, true);
  assert.equal(r.body.deliveryEnabled, false); // push disabled in this harness
  // A second register (upsert) still succeeds and stays stored — proves the
  // route persists without depending on any not-yet-built endpoint.
  const again = await request(app)
    .post('/api/push/register')
    .send({ token: 'tok-aaa', platform: 'android', appVersion: '1.1.0' });
  assert.equal(again.status, 200);
  assert.equal(again.body.stored, true);
});

test('POST /api/push/register → 400 when token is missing or blank', async () => {
  for (const body of [{}, { token: '' }, { token: '   ' }, { platform: 'android' }]) {
    const r = await request(app).post('/api/push/register').send(body);
    assert.equal(r.status, 400, `body ${JSON.stringify(body)} should 400`);
  }
});

// ── Task 33: DELETE /api/push/register ───────────────────────────────────────

test('DELETE /api/push/register → { removed:true } for a known token, false for unknown', async () => {
  await request(app).post('/api/push/register').send({ token: 'tok-del', platform: 'android' });
  const hit = await request(app).delete('/api/push/register').send({ token: 'tok-del' });
  assert.equal(hit.status, 200);
  assert.equal(hit.body.removed, true);
  const miss = await request(app).delete('/api/push/register').send({ token: 'tok-del' });
  assert.equal(miss.status, 200);
  assert.equal(miss.body.removed, false);
});

test('DELETE /api/push/register → 400 when token is missing', async () => {
  const r = await request(app).delete('/api/push/register').send({});
  assert.equal(r.status, 400);
});

// ── Task 34: GET /api/push/prefs ─────────────────────────────────────────────

test('GET /api/push/prefs → defaults for an unknown token', async () => {
  const r = await request(app).get('/api/push/prefs').query({ token: 'never-seen' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.prefs, {
    categories: { service: true, host: true, ups: true, cron: true },
    notifyRecoveries: true,
    enabled: true,
  });
});

test('GET /api/push/prefs → 400 when token query param is missing', async () => {
  const r = await request(app).get('/api/push/prefs');
  assert.equal(r.status, 400);
});

test('GET /api/push/prefs → DEFAULT_PREFS for a freshly-registered token (seeded on register)', async () => {
  await request(app)
    .post('/api/push/register')
    .send({ token: 'tok-aaa', platform: 'android', appVersion: '1.0.0' });
  const p = await request(app).get('/api/push/prefs').query({ token: 'tok-aaa' });
  assert.equal(p.status, 200);
  assert.equal(p.body.prefs.enabled, true);
});

// ── Task 35: PUT /api/push/prefs ─────────────────────────────────────────────

test('PUT /api/push/prefs → stores + echoes the normalized prefs', async () => {
  // Must register first so the token exists
  await request(app)
    .post('/api/push/register')
    .send({ token: 'tok-prefs', platform: 'android', appVersion: '1.0.0' });
  const prefs = {
    categories: { service: true, host: false, ups: true, cron: false },
    notifyRecoveries: false,
    enabled: true,
  };
  const r = await request(app).put('/api/push/prefs').send({ token: 'tok-prefs', prefs });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.prefs, prefs);
  // Round-trips through the store on a subsequent GET.
  const g = await request(app).get('/api/push/prefs').query({ token: 'tok-prefs' });
  assert.deepEqual(g.body.prefs, prefs);
});

test('PUT /api/push/prefs → 404 on unknown token', async () => {
  const r = await request(app)
    .put('/api/push/prefs')
    .send({
      token: 'tok-unknown-xyz',
      prefs: { categories: { service: true, host: true, ups: true, cron: true }, notifyRecoveries: true, enabled: true },
    });
  assert.equal(r.status, 404);
});

test('PUT /api/push/prefs → 400 on a missing token', async () => {
  const r = await request(app)
    .put('/api/push/prefs')
    .send({ prefs: { categories: { service: true, host: true, ups: true, cron: true }, notifyRecoveries: true, enabled: true } });
  assert.equal(r.status, 400);
});

test('PUT /api/push/prefs → 400 on malformed prefs', async () => {
  const bad = [
    undefined,
    null,
    'nope',
    {},                                                                                                                  // no categories
    { categories: {}, notifyRecoveries: true, enabled: true },                                                          // empty categories
    { categories: { service: 'yes', host: true, ups: true, cron: true }, notifyRecoveries: true, enabled: true },      // non-bool category
    { categories: { service: true, host: true, ups: true, cron: true }, notifyRecoveries: 1, enabled: true },          // non-bool flag
    { categories: { service: true, host: true, ups: true }, notifyRecoveries: true, enabled: true },                   // missing cron
  ];
  for (const prefs of bad) {
    const r = await request(app).put('/api/push/prefs').send({ token: 'tok-bad', prefs });
    assert.equal(r.status, 400, `prefs ${JSON.stringify(prefs)} should 400`);
  }
});

// ── C1: prototype-pollution route-level hardening ────────────────────────────

test('POST /api/push/register {token:"__proto__"} → 400 and Object.prototype unpolluted', async () => {
  const r = await request(app).post('/api/push/register').send({ token: '__proto__', platform: 'android' });
  assert.equal(r.status, 400);
  assert.equal(({}).platform, undefined, 'Object.prototype.platform must be undefined');
});

test('POST /api/push/register {token:"constructor"} → 400', async () => {
  const r = await request(app).post('/api/push/register').send({ token: 'constructor', platform: 'android' });
  assert.equal(r.status, 400);
});

test('DELETE /api/push/register {token:"__proto__"} → 400', async () => {
  const r = await request(app).delete('/api/push/register').send({ token: '__proto__' });
  assert.equal(r.status, 400);
});

// ── I1: extra top-level prefs key → 400 ─────────────────────────────────────

test('PUT /api/push/prefs → 400 when prefs has extra top-level key', async () => {
  await request(app).post('/api/push/register').send({ token: 'tok-extra-key', platform: 'android' });
  // Use a real own enumerable key (not __proto__ which is a syntax special case
  // and does NOT appear in Object.keys). The I1 allowlist must reject it.
  const r = await request(app).put('/api/push/prefs').send({
    token: 'tok-extra-key',
    prefs: {
      categories: { service: true, host: true, ups: true, cron: true },
      notifyRecoveries: true,
      enabled: true,
      injected: true, // extra own enumerable key — must 400
    },
  });
  assert.equal(r.status, 400);
});

// ── m2: DELETE with a non-string token → 400 ─────────────────────────────────

test('DELETE /api/push/register {token:42} → 400', async () => {
  const r = await request(app).delete('/api/push/register').send({ token: 42 });
  assert.equal(r.status, 400);
});
