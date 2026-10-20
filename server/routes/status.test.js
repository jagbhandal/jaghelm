/**
 * GET /api/status (#292): the status model the background loop builds once a
 * cycle (refresh.js updateStatus), behind the same auth as every /api/* read,
 * with the cache's ETag machinery: 304 on a matching If-None-Match, one ETag
 * per value, and one ETag across cycles while the board holds still.
 *
 * Auth is frozen at module load, so DASH_PASS and the data dir are set before
 * importing the app (as cron.test.js does).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-status-'));
process.env.JAGHELM_DATA_DIR = dataDir;
process.env.DASH_PASS = 'test-pass-1234';
process.env.PROMETHEUS_URL = 'http://127.0.0.1:1';
process.env.KUMA_URL = 'http://127.0.0.1:1';

const { app } = await import('../index.js');
const { stopBackgroundRefresh, updateStatus } = await import('../refresh.js');
const { createSession } = await import('../auth/sessions.js');
const { getCached, setCache } = await import('../cache.js');
const { NOW, UPS_ONLINE, monitored, node } = await import('../testing/statusFixtures.js');

const token = createSession('admin');

after(() => {
  stopBackgroundRefresh();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DASH_PASS;
});

const getStatus = (etag) => {
  const r = request(app).get('/api/status').set('x-auth-token', token);
  return etag ? r.set('If-None-Match', etag) : r;
};

/**
 * What one cycle's refreshes leave in the cache (fresh objects every time, as
 * a refresh builds them), then the loop's status step. `app` is the app's
 * Kuma status.
 */
function cycle({ app: appStatus = 'up', disk = '50.0' } = {}, now = NOW) {
  setCache(
    'services',
    {
      nodes: {
        vm103: node(
          { diskPercent: disk },
          { display_name: 'VM 103', services: [monitored('vm103:app', appStatus)] }
        ),
      },
      overallHealth: appStatus === 'down' ? 'down' : 'up',
      sources: { prometheus: { ok: true }, kuma: { ok: true } },
    },
    { upWithoutCard: [], monitorOf: { 'vm103:app': '1' } }
  );
  setCache('ups', { ...UPS_ONLINE });
  return updateStatus([], now);
}

test('/api/status: 401 without a token, like every /api/* read', async () => {
  const r = await request(app).get('/api/status');
  assert.equal(r.status, 401);
  assert.match(r.headers['content-type'], /json/);
});

test('/api/status: 503 before the loop has built a status', async () => {
  assert.equal(getCached('status'), null);
  const r = await getStatus();
  assert.equal(r.status, 503);
  assert.deepEqual(r.body, { error: 'Status not yet available' });
});

let firstEtag;

test("/api/status: 200 with the model's shape, and an ETag", async () => {
  const built = cycle();
  const r = await getStatus();
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /json/);
  assert.deepEqual(r.body, JSON.parse(JSON.stringify(built)), 'the status the loop built');
  assert.deepEqual(Object.keys(r.body), ['overall', 'issues', 'subsystems', 'entities', 'sources']);
  assert.deepEqual(r.body.overall, { state: 'ok', sentence: '1 service up · 1 node healthy' });
  assert.deepEqual(
    r.body.entities.map((e) => [e.id, e.kind, e.state, e.word, e.reason]),
    [
      ['services/vm103:app', 'service', 'ok', 'Up', 'Kuma: up'],
      ['nodes/vm103', 'node', 'ok', 'Healthy', 'Healthy'],
      ['power/ups', 'ups', 'ok', 'On mains', 'On mains'],
    ]
  );
  assert.deepEqual(Object.keys(r.body.sources).sort(), ['kuma', 'nut', 'prometheus']);
  assert.match(r.headers.etag, /^"[0-9a-f]{32}"$/);
  firstEtag = r.headers.etag;
});

test('/api/status: 304 with the ETag, and no body', async () => {
  const r = await getStatus(firstEtag);
  assert.equal(r.status, 304);
  assert.equal(r.text, '');
  assert.equal(r.headers.etag, firstEtag);
  // A weak or listed tag matches too (RFC 9110), as for the other endpoints.
  assert.equal((await getStatus(`"other", W/${firstEtag}`)).status, 304);
});

test('/api/status: a steady board keeps one ETag across cycles', async () => {
  // Two more cycles with the same board: new payload objects, a later clock.
  cycle({}, NOW + 30_000);
  const second = await getStatus();
  cycle({}, NOW + 60_000);
  const third = await getStatus(firstEtag);
  assert.equal(second.status, 200);
  assert.equal(second.headers.etag, firstEtag, 'the same status, the same ETag');
  assert.equal(third.status, 304, 'a client holding the first ETag still gets a 304');
  // The disk moving inside "ok" changes nothing the model says.
  cycle({ disk: '61.3' }, NOW + 90_000);
  assert.equal((await getStatus(firstEtag)).status, 304);
});

test('/api/status: a change on the board is a new ETag and a 200', async () => {
  cycle({ app: 'down' }, NOW + 120_000);
  const r = await getStatus(firstEtag);
  assert.equal(r.status, 200);
  assert.notEqual(r.headers.etag, firstEtag);
  assert.equal(r.body.overall.sentence, '1 service down');
  assert.deepEqual(
    r.body.issues.map((e) => [e.id, e.state, e.reason]),
    [['services/vm103:app', 'crit', 'Kuma: down']]
  );
  assert.equal((await getStatus(r.headers.etag)).status, 304);
});
