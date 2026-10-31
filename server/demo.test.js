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
const { stopBackgroundRefresh, thresholdsOf } = await import('./refresh.js');
const { demoDisplayConfig } = await import('./demoFixtures.js');

after(() => {
  stopBackgroundRefresh();
  rmSync(dir, { recursive: true, force: true });
});

// The live server's answer for an /api path it has no route for (index.js).
const NOT_FOUND = { error: 'Endpoint not found' };

test('demo: GET /api/services returns the demo board (no backend), down by default (#248)', async () => {
  const r = await request(app).get('/api/services');
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body.nodes), ['edge', 'apps', 'storage']);
  assert.ok(r.body.nodes.apps.services.length > 0, 'populated with services');
  assert.equal(r.body.overallHealth, 'down', 'its down service is not hidden behind a green status');
});

test('demo: GET /api/status is the status model of the demo board, in both scenarios (#437)', async () => {
  const shapeOf = (status) => {
    assert.deepEqual(Object.keys(status).sort(), [
      'entities',
      'issues',
      'overall',
      'sources',
      'subsystems',
      'thresholds',
      'units',
    ]);
    // The lines it judged by: the demo display config's (#451).
    assert.deepEqual(status.thresholds, JSON.parse(JSON.stringify(thresholdsOf(demoDisplayConfig()))));
    assert.deepEqual(Object.keys(status.overall).sort(), ['sentence', 'state']);
    assert.deepEqual(
      status.subsystems.map((s) => s.id),
      ['services', 'nodes', 'power', 'jobs', 'backups', 'integrations']
    );
    for (const e of status.entities) {
      for (const k of ['id', 'kind', 'subsystem', 'name', 'state', 'word', 'reason', 'since']) {
        assert.ok(Object.hasOwn(e, k), `${e.id}: ${k}`);
      }
      assert.ok(!Object.hasOwn(e, 'memo'), `${e.id}: the model's memory is never served`);
    }
    // Every board entity is judged: 12 services, 3 nodes, the UPS, 3 jobs, the
    // nightly backup, which the demo's display config marks as one (#291), and
    // the 7 integrations (#518).
    assert.equal(status.entities.length, 27);
    assert.deepEqual(
      status.entities.filter((e) => e.subsystem === 'backups').map((e) => [e.id, e.kind]),
      [['backups/storage:nightly-backup', 'backup']]
    );
    assert.deepEqual(Object.keys(status.sources).sort(), ['gitea', 'kuma', 'nut', 'prometheus']);
    for (const s of Object.values(status.sources)) assert.equal(s.state, 'ok');
  };

  const incident = await request(app).get('/api/status');
  assert.equal(incident.status, 200);
  shapeOf(incident.body);
  // A failed backup, as docs/DEMO.md calls it (#291).
  assert.deepEqual(incident.body.overall, { state: 'crit', sentence: '1 service down · 1 backup failed' });
  assert.deepEqual(
    incident.body.issues.map((i) => [i.id, i.state, i.reason]),
    [
      ['services/apps:jellyfin', 'crit', 'Kuma: down'],
      ['backups/storage:nightly-backup', 'crit', 'Last backup failed: repository is locked by another process'],
    ]
  );

  process.env.DEMO_SCENARIO = 'healthy';
  try {
    const healthy = await request(app).get('/api/status');
    assert.equal(healthy.status, 200);
    shapeOf(healthy.body);
    assert.deepEqual(healthy.body.overall, { state: 'ok', sentence: 'All 12 services up · 3 nodes healthy' });
    assert.deepEqual(healthy.body.issues, []);
  } finally {
    delete process.env.DEMO_SCENARIO;
  }
});

test('demo: the Pipeline source says it is set up, so its panel shows (#248)', async () => {
  const gitea = await request(app).get('/api/gitea/activity');
  assert.equal(gitea.status, 200);
  assert.ok(Array.isArray(gitea.body) && gitea.body.length > 0, 'a commit list, not { configured: false }');
  assert.ok(gitea.body[0].commits.length > 0);
});

test("demo: the status's UPS carries the load, model and runtime on mains, for the detail (#586)", async () => {
  const { body } = await request(app).get('/api/status');
  const e = body.entities.find((x) => x.id === 'power/ups');
  assert.deepEqual([e.word, e.load, e.model, e.runtimeOnMainsMinutes], ['On mains', 18, 'Example UPS 1500VA', 41]);
});

test('demo: every panel source the board reads has its fixture (#248)', async () => {
  const cron = await request(app).get('/api/cron/status');
  assert.ok(cron.body.length > 0 && cron.body[0].jobs.length > 0, 'scheduled jobs');
  const history = await request(app).get('/api/history?series=node.cpu&range=1h');
  assert.ok(history.body.series[0].lines.some((l) => l.entity === 'apps'), 'the node cards’ hour of CPU');
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
  const icon = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/netdata.svg';
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

test('demo: secrets are unreachable — read is not found, write is 403', async () => {
  const g = await request(app).get('/api/secrets/keys');
  assert.equal(g.status, 404);
  assert.deepEqual(g.body, NOT_FOUND, 'no secret data (real route never runs)');
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

test('demo: an unknown /api read is a 404, as the live server answers it (no real route → no outbound) (#437)', async () => {
  for (const path of ['/api/integrations/proxmox', '/api/no-such-read', '/api/arcane/agents']) {
    const r = await request(app).get(path);
    assert.equal(r.status, 404, path);
    assert.deepEqual(r.body, NOT_FOUND, path);
  }
});

test('demo: the reads the web client sends that have no demo data answer as the live server would without it (#437)', async () => {
  // No outbound, so no weather: an answer with no temperature draws none.
  const weather = await request(app).get('/api/weather').query({ lat: 51.5, lon: -0.1 });
  assert.equal(weather.status, 200);
  assert.deepEqual(weather.body, {});
  // No icon index is loaded in demo mode: the picker's search finds nothing.
  const icons = await request(app).get('/api/icons').query({ q: 'graf', limit: 60 });
  assert.equal(icons.status, 200);
  assert.deepEqual(icons.body, { count: 0, results: [] });
  // The demo saves no app tab, so no tab id is one the server has.
  const embed = await request(app).get('/api/embed-check/tab-1').query({ origin: 'https://demo.example.com' });
  assert.equal(embed.status, 404);
  assert.deepEqual(embed.body, { error: 'No saved app tab has that id' });
});

test('demo: HEAD and OPTIONS are owned by the guard, not a real route', async () => {
  // app.use('/api', guard) captures every method, so HEAD/OPTIONS can't fall
  // through to a real route (which could do outbound or touch state).
  const h = await request(app).head('/api/services');
  assert.equal(h.status, 200);
  const o = await request(app).options('/api/secrets/keys');
  // Answered by the guard (the real secrets route never runs): not a demo read.
  assert.equal(o.status, 404);
  assert.deepEqual(o.body, NOT_FOUND);
});
