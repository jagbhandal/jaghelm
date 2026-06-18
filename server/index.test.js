/**
 * Route-level HTTP tests — the contract (status codes, JSON shape, auth +
 * validation boundaries) that the unit suites don't cover. Imports the app
 * (which no longer self-binds a port) and drives it with supertest against an
 * isolated temp data dir, with auth disabled (no DASH_PASS).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-routes-'));
process.env.JAGHELM_DATA_DIR = dataDir;
delete process.env.DASH_PASS; // auth disabled

const { app } = await import('./index.js');
const { stopBackgroundRefresh } = await import('./refresh.js');

after(() => {
  // A valid display-config POST restarts the refresh loop; stop it so the
  // suite tears down cleanly (and doesn't lean solely on --test-force-exit).
  stopBackgroundRefresh();
  rmSync(dataDir, { recursive: true, force: true });
});

test('GET /api/health → 200 with status + version', async () => {
  const r = await request(app).get('/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'ok');
  assert.ok(r.body.version, 'version present');
});

test('GET /api/secrets/keys → 403 when no password is set (fail-closed)', async () => {
  const r = await request(app).get('/api/secrets/keys');
  assert.equal(r.status, 403);
  assert.match(r.headers['content-type'], /json/);
});

test('unknown /api/* route → JSON 404, not an HTML page', async () => {
  const r = await request(app).get('/api/does-not-exist');
  assert.equal(r.status, 404);
  assert.match(r.headers['content-type'], /json/);
  assert.ok(r.body.error);
});

test('POST /api/services/config → 400 on a non-object body', async () => {
  const r = await request(app)
    .post('/api/services/config')
    .set('Content-Type', 'application/json')
    .send('"just a string"');
  assert.equal(r.status, 400);
});

test('POST /api/services/config → 400 on a wrong-typed structural field', async () => {
  const r = await request(app)
    .post('/api/services/config')
    .send({ services: [1, 2, 3] });
  assert.equal(r.status, 400);
});

test('POST /api/services/config → 200 on a valid config', async () => {
  const r = await request(app)
    .post('/api/services/config')
    .send({ nodes: { vm103: { name: 'VM 103' } }, services: {} });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});

test('POST /api/services/config → 400 on a reserved key (prototype-pollution guard)', async () => {
  const r = await request(app)
    .post('/api/services/config')
    .send({ services: {}, constructor: { polluted: true } });
  assert.equal(r.status, 400);
});

test('POST /api/display-config → 400 on out-of-range refreshInterval', async () => {
  const r = await request(app).post('/api/display-config').send({ refreshInterval: 0 });
  assert.equal(r.status, 400);
});

test('POST /api/display-config → 200 on a valid config (data-dir isolated)', async () => {
  const r = await request(app)
    .post('/api/display-config')
    .send({ theme: 'github-dark', refreshInterval: 30 });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});
