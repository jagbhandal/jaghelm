/**
 * DEMO_MODE — the read-only public demo must be airtight: writes refused, no
 * secrets reachable, reads served from canned fixtures (no backend/outbound).
 * Runs in its own process (node:test spawns per file) so DEMO_MODE doesn't leak.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const dir = mkdtempSync(join(tmpdir(), 'jh-demo-'));
process.env.JAGHELM_DATA_DIR = dir;
process.env.DEMO_MODE = 'true';
delete process.env.DASH_PASS;

const { app } = await import('./index.js');
const { stopBackgroundRefresh } = await import('./refresh.js');

after(() => {
  stopBackgroundRefresh();
  rmSync(dir, { recursive: true, force: true });
});

test('demo: GET /api/services returns the canned fixture (no backend)', async () => {
  const r = await request(app).get('/api/services');
  assert.equal(r.status, 200);
  assert.ok(r.body.nodes && r.body.nodes['demo-1'], 'fixture nodes present');
});

test('demo: GET /api/display-config returns the demo config (no auth needed)', async () => {
  const r = await request(app).get('/api/display-config');
  assert.equal(r.status, 200);
  assert.equal(r.body.subtitle, 'Live Demo');
});

test('demo: every write is refused 403', async () => {
  for (const m of ['post', 'put', 'delete']) {
    const r = await request(app)[m]('/api/services/config').send({ nodes: {} });
    assert.equal(r.status, 403, `${m} is blocked`);
  }
});

test('demo: secrets are unreachable — read is empty, write is 403', async () => {
  const g = await request(app).get('/api/secrets/keys');
  assert.equal(g.status, 200);
  assert.deepEqual(g.body, {}, 'no secret data (real route never runs)');
  const w = await request(app).put('/api/secrets/foo').send({ value: 'x' });
  assert.equal(w.status, 403);
});

test('demo: a trailing-slash path still hits the canned fixture (not the empty default)', async () => {
  // Express does not strip a trailing slash, so "/api/services/" reconstructs to
  // "/api/services/" and would miss the FIXTURES map without normalization.
  const r = await request(app).get('/api/services/');
  assert.equal(r.status, 200);
  assert.ok(r.body.nodes && r.body.nodes['demo-1'], 'fixture served despite trailing slash');
});

test('demo: an unknown /api read returns empty (no real route → no outbound)', async () => {
  const r = await request(app).get('/api/integrations/proxmox');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, {});
});

test('demo: HEAD and OPTIONS are owned by the guard, not a real route', async () => {
  // app.use('/api', guard) captures every method, so HEAD/OPTIONS can't fall
  // through to a real route (which could do outbound or touch state).
  const h = await request(app).head('/api/services');
  assert.equal(h.status, 200);
  const o = await request(app).options('/api/secrets/keys');
  assert.equal(o.status, 200); // answered by the guard; real secrets route never runs
});
