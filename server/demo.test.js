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

test('demo: GET /api/services returns the demo board (no backend), down by default (#248)', async () => {
  const r = await request(app).get('/api/services');
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body.nodes), ['edge', 'apps', 'storage']);
  assert.ok(r.body.nodes.apps.services.length > 0, 'populated with services');
  assert.equal(r.body.overallHealth, 'down', 'its down service is not hidden behind a green status');
});

test('demo: the UPS and Pipeline sources say they are set up, so their panels show (#248)', async () => {
  const ups = await request(app).get('/api/ups');
  assert.equal(ups.status, 200);
  assert.equal(ups.body.configured, true);
  assert.equal(ups.body.status, 1);
  const gitea = await request(app).get('/api/gitea/activity');
  assert.equal(gitea.status, 200);
  assert.ok(Array.isArray(gitea.body) && gitea.body.length > 0, 'a commit list, not { configured: false }');
  assert.ok(gitea.body[0].commits.length > 0);
});

test('demo: every panel source the board reads has its fixture (#248)', async () => {
  const cron = await request(app).get('/api/cron/status');
  assert.ok(cron.body.length > 0 && cron.body[0].jobs.length > 0, 'scheduled jobs');
  const history = await request(app).get('/api/history');
  assert.ok(Array.isArray(history.body['apps:cpu']), 'sparklines');
  const config = await request(app).get('/api/display-config');
  assert.ok(config.body.links.devops.length > 0, 'Quick Launch links');
  const todos = await request(app).get('/api/todos');
  assert.ok(Array.isArray(todos.body) && todos.body.length > 0, 'a checklist');
  const auth = await request(app).get('/api/auth/check');
  assert.equal(auth.body.demo, true, 'the client is told it is the demo');
});

test('demo: DEMO_SCENARIO=healthy serves an all-up board; anything else the incident', async () => {
  const { demoResponse, demoScenario } = await import('./demo.js');
  assert.equal(demoResponse({ path: '/api/services', scenario: 'healthy' }).body.overallHealth, 'up');
  assert.equal(demoScenario({ DEMO_SCENARIO: 'healthy' }), 'healthy');
  assert.equal(demoScenario({ DEMO_SCENARIO: 'incident' }), 'incident');
  assert.equal(demoScenario({}), 'incident');
  assert.equal(demoScenario({ DEMO_SCENARIO: 'chaos' }), 'incident');
});

test('demo: an icon is a redirect to its repository URL, never fetched; anything else is refused', async () => {
  const icon = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/grafana.svg';
  const r = await request(app).get('/api/icons/cached').query({ url: icon });
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, icon);
  // Only the URLs the live cache would fetch: no open redirect.
  for (const url of ['https://evil.example/x.svg', 'javascript:alert(1)', '']) {
    const bad = await request(app).get('/api/icons/cached').query({ url });
    assert.equal(bad.status, 404, url);
    assert.equal(bad.headers.location, undefined, url);
  }
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
  assert.ok(r.body.nodes && r.body.nodes.edge, 'fixture served despite trailing slash');
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
