/**
 * GET /api/status and the heartbeat strips (#312): the strips move every Kuma
 * interval, so they ride /api/services (`beats`), which the rows read every
 * tick anyway, and the status model reads nothing of them. A steady board
 * whose beats change every cycle keeps one status ETag, a 304 for each poll,
 * while /api/services serves each cycle's beats.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-status-beats-'));
process.env.JAGHELM_DATA_DIR = dataDir;
process.env.DASH_PASS = 'test-pass-1234';
process.env.PROMETHEUS_URL = 'http://127.0.0.1:1';
process.env.KUMA_URL = 'http://127.0.0.1:1';

const { app } = await import('../index.js');
const { stopBackgroundRefresh, updateStatus } = await import('../refresh.js');
const { createSession } = await import('../auth/sessions.js');
const { setCache } = await import('../cache.js');
const { NOW, UPS_ONLINE, monitored, node } = await import('../testing/statusFixtures.js');
const { createBeatStore, decodeBeats } = await import('../kumaBeats.js');

const token = createSession('admin');

after(() => {
  stopBackgroundRefresh();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DASH_PASS;
});

const get = (path, etag) => {
  const r = request(app).get(path).set('x-auth-token', token);
  return etag ? r.set('If-None-Match', etag) : r;
};

const beatStore = createBeatStore();

/** One cycle at `now`: a steady board, its monitor sampled once more. */
function cycle(now) {
  const monitorOf = { 'vm103:app': '1' };
  beatStore.record({
    ok: true,
    monitors: { 1: { id: 1, name: 'app', status: 'up', kumaStatus: 'up', ping: 20 + (now % 7) } },
    now,
  });
  setCache(
    'services',
    {
      nodes: {
        vm103: node({}, { display_name: 'VM 103', services: [monitored('vm103:app', 'up')] }),
      },
      overallHealth: 'up',
      sources: { prometheus: { ok: true }, kuma: { ok: true } },
      beats: beatStore.encodedFor(monitorOf, { ok: true }),
    },
    { upWithoutCard: [], monitorOf }
  );
  setCache('ups', UPS_ONLINE);
  return updateStatus([], now);
}

test('a steady board whose beats move every cycle keeps its status ETag: a 304 each poll', async () => {
  cycle(NOW);
  const first = await get('/api/status');
  assert.equal(first.status, 200);
  const services0 = await get('/api/services');
  assert.equal(decodeBeats(services0.body.beats['vm103:app']).length, 1);

  for (let i = 1; i <= 5; i += 1) {
    cycle(NOW + i * 30_000);
    const again = await get('/api/status', first.headers.etag);
    assert.equal(again.status, 304, `cycle ${i}: the status is a 304`);
    const services = await get('/api/services', services0.headers.etag);
    assert.equal(services.status, 200, `cycle ${i}: /api/services has the new beat`);
    assert.equal(decodeBeats(services.body.beats['vm103:app']).length, i + 1);
  }
  const full = await get('/api/status');
  assert.equal(full.headers.etag, first.headers.etag);
  assert.equal(JSON.stringify(full.body).includes('beats'), false, 'no beats in /api/status');
});
