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
// Point readiness checks at a guaranteed-refused port so /readyz is deterministic.
process.env.PROMETHEUS_URL = 'http://127.0.0.1:1';
process.env.KUMA_URL = 'http://127.0.0.1:1';

const { app } = await import('./index.js');
const { stopBackgroundRefresh } = await import('./refresh.js');

after(() => {
  // A valid display-config POST restarts the refresh loop; stop it so the
  // file's process can exit (a live loop would hold it open until
  // --test-timeout cancels the file and fails the run).
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

test('raw infra passthroughs → JSON 404 (removed, #264)', async () => {
  // Their fail-closed gate answered 403 in this no-auth mode, so a 404 is the
  // route being gone, not the gate.
  for (const path of ['/api/prometheus/query?q=up', '/api/docker/containers',
                      '/api/adguard/stats', '/api/npm/stats', '/api/uptime/monitors']) {
    const r = await request(app).get(path);
    assert.equal(r.status, 404, `${path} should be gone`);
    assert.match(r.headers['content-type'], /json/, `${path} should answer JSON`);
    assert.ok(r.body.error, `${path} should carry an error`);
  }
  // aggregated/benign routes on the same router stay (not 404, not 403)
  const ups = await request(app).get('/api/ups');
  assert.notEqual(ups.status, 404, '/api/ups should remain');
  assert.notEqual(ups.status, 403, '/api/ups should remain open');
});

test('unknown /api/* route → JSON 404, not an HTML page', async () => {
  const r = await request(app).get('/api/does-not-exist');
  assert.equal(r.status, 404);
  assert.match(r.headers['content-type'], /json/);
  assert.ok(r.body.error);
});

test('GET /api/integrations/:type → JSON 404 (removed, #254); the list stays', async (t) => {
  // A configured integration, so the 404 is the route being gone, not a miss.
  const saved = await request(app)
    .post('/api/integrations/save')
    .send({ type: 'custom', instance: 'rawcheck', url: 'http://example.test' });
  assert.equal(saved.status, 200);
  t.after(() => request(app).delete('/api/integrations/custom_rawcheck'));

  const one = await request(app).get('/api/integrations/custom_rawcheck');
  assert.equal(one.status, 404);
  assert.match(one.headers['content-type'], /json/);
  const all = await request(app).get('/api/integrations');
  assert.equal(all.status, 200);
});

/** The version a Settings read answers now, which a save must send (#423). */
const configVersion = async () => (await request(app).get('/api/services/config')).headers.etag;

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
    .set('If-Match', await configVersion())
    .send({ nodes: { vm103: { name: 'VM 103' } }, services: {} });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});

test('POST /api/services/config → 200 on a services.yaml generated before #265 (links object)', async () => {
  // First-boot files carried `links` as a map of groups; the schema used to
  // demand an array, so every Settings → Nodes/Services save of one got a 400.
  const r = await request(app)
    .post('/api/services/config')
    .set('If-Match', await configVersion())
    .send({
      nodes: { pi1: { display_name: 'Gateway Primary' } },
      services: {},
      integrations: {},
      custom_integrations: {},
      display: { title: 'JAGHELM' },
      links: { personal: [], management: [], devops: [] },
      tabs: [],
      grid_layout: null,
      grid_columns: 12,
    });
  assert.equal(r.status, 200, JSON.stringify(r.body));
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

test('POST /api/display-config → 200 on a valid config over the version read (data-dir isolated)', async () => {
  const read = await request(app).get('/api/display-config');
  assert.match(read.headers.etag, /^"[^"]+"$/);
  const r = await request(app)
    .post('/api/display-config')
    .set('If-Match', read.headers.etag)
    .send({ theme: 'github-dark', refreshInterval: 30 });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});

test('POST /api/display-config → 428 without the version read (#547)', async () => {
  const r = await request(app)
    .post('/api/display-config')
    .send({ theme: 'github-dark', refreshInterval: 30 });
  assert.equal(r.status, 428);
});

test('GET /metrics → 200 Prometheus exposition including http_requests_total', async () => {
  await request(app).get('/api/health'); // generate at least one counted request
  const r = await request(app).get('/metrics');
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /text\/plain/);
  assert.match(r.text, /http_requests_total/);
});

test('GET /api/readyz → 503 when Prometheus is unreachable, with a checks shape', async () => {
  const r = await request(app).get('/api/readyz');
  assert.equal(r.status, 503);
  assert.equal(r.body.ready, false);
  assert.equal(typeof r.body.checks.prometheus, 'boolean');
  assert.equal(typeof r.body.checks.kuma, 'boolean');
});

test('CSP ENFORCES by default with a strict script-src + locked object-src', async () => {
  const r = await request(app).get('/api/health');
  const csp = r.headers['content-security-policy'];
  assert.ok(csp, 'enforcing CSP header present by default');
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'self'/);
  // Enforcing (not report-only) unless CSP_REPORT_ONLY=true, and no
  // upgrade-insecure-requests (which would break http LAN backends).
  assert.ok(!r.headers['content-security-policy-report-only'], 'report-only header absent by default');
  assert.ok(!/upgrade-insecure-requests/.test(csp), 'no upgrade-insecure-requests');
});

test('CSP lets fonts and stylesheets come from this origin only (#244)', async () => {
  const r = await request(app).get('/api/health');
  const directive = (name) =>
    r.headers['content-security-policy']
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .find(([n]) => n === name)
      ?.slice(1);
  // Fonts are self-hosted: no Google Fonts, and no other origin either.
  assert.deepEqual(directive('font-src'), ["'self'", 'data:']);
  assert.deepEqual(directive('style-src'), ["'self'", "'unsafe-inline'"]);
});

test('POST /api/watchtower/event → 404 (webhook removed in 2.2.0)', async () => {
  const r = await request(app)
    .post('/api/watchtower/event')
    .send({ secret: 'x', node: 'vm-101', message: 'updated|radarr|v1|v2' });
  assert.equal(r.status, 404);
});
