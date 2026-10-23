/**
 * GET /api/status and the UPS's held readings (#586): the model serves the
 * UPS's load and runtime on mains as read at most 5 minutes ago, and reads
 * them afresh only when 5 minutes have passed, another field of the UPS's
 * entity changed, or one goes to or from null. So a steady board keeps one
 * ETag between reads, and the body is always what the ETag is of.
 *
 * Each cycle runs at its own clock (the loop's `now`), a fake one: each test
 * starts an hour after the last, so the first read of each is fresh.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-status-ups-'));
process.env.JAGHELM_DATA_DIR = dataDir;
process.env.DASH_PASS = 'test-pass-1234';
process.env.PROMETHEUS_URL = 'http://127.0.0.1:1';
process.env.KUMA_URL = 'http://127.0.0.1:1';

const { app } = await import('../index.js');
const { stopBackgroundRefresh, updateStatus } = await import('../refresh.js');
const { createSession } = await import('../auth/sessions.js');
const { setCache } = await import('../cache.js');
const { NOW, UPS_ONLINE, monitored, node } = await import('../testing/statusFixtures.js');
const { UPS_HOLD_MS } = await import('../status/model.js');

const token = createSession('admin');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

after(() => {
  stopBackgroundRefresh();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DASH_PASS;
});

const getStatus = (etag) => {
  const r = request(app).get('/api/status').set('x-auth-token', token);
  return etag ? r.set('If-None-Match', etag) : r;
};

/** One cycle at `now`: a steady board, the UPS reading `ups` over UPS_ONLINE. */
function cycle(now, ups = {}) {
  setCache(
    'services',
    {
      nodes: {
        vm103: node({}, { display_name: 'VM 103', services: [monitored('vm103:app', 'up')] }),
      },
      overallHealth: 'up',
      sources: { prometheus: { ok: true }, kuma: { ok: true } },
    },
    { upWithoutCard: [], monitorOf: { 'vm103:app': '1' } }
  );
  setCache('ups', { ...UPS_ONLINE, ...ups });
  return updateStatus([], now);
}

const upsOf = (body) => body.entities.find((e) => e.id === 'power/ups');
const readings = (body) => [upsOf(body).load, upsOf(body).runtimeOnMainsMinutes];

let hour = 0;
/** A clock for one test, an hour after the last test's. */
const clock = () => NOW + ++hour * HOUR;

test('the hold is 5 minutes', () => {
  assert.equal(UPS_HOLD_MS, 5 * MINUTE);
});

test('UPS hold: on mains, a load and runtime that drift within 5 minutes are a 304 and the same body', async () => {
  const t0 = clock();
  cycle(t0, { load: 20, runtime: 3600 });
  const first = await getStatus();
  assert.equal(first.status, 200);
  assert.deepEqual(readings(first.body), [20, 60]);
  assert.match(first.headers.etag, /^"[0-9a-f]{32}"$/, 'a strong ETag: of the body itself');

  for (const [at, load, runtime] of [
    [t0 + 30_000, 17.4, 3420],
    [t0 + 2 * MINUTE, 18.9, 3510],
    [t0 + 4.5 * MINUTE, 23, 3000],
  ]) {
    cycle(at, { load, runtime });
    const again = await getStatus(first.headers.etag);
    assert.equal(again.status, 304, `${(at - t0) / 1000} s`);
    const full = await getStatus();
    assert.equal(full.headers.etag, first.headers.etag);
    assert.deepEqual(full.body, first.body, 'the same body: the readings held');
  }
});

test('UPS hold: at 5 minutes a changed reading is a 200 with the new value', async () => {
  const t0 = clock();
  cycle(t0, { load: 20, runtime: 3600 });
  const first = await getStatus();
  cycle(t0 + 4 * MINUTE, { load: 25, runtime: 3300 });
  assert.equal((await getStatus(first.headers.etag)).status, 304);

  cycle(t0 + UPS_HOLD_MS, { load: 26.2, runtime: 3240 });
  const next = await getStatus(first.headers.etag);
  assert.equal(next.status, 200);
  assert.deepEqual(readings(next.body), [26, 54], "this cycle's read, not the one held");
  // That read is held for the next 5 minutes.
  cycle(t0 + UPS_HOLD_MS + MINUTE, { load: 31, runtime: 2900 });
  assert.equal((await getStatus(next.headers.etag)).status, 304);
});

test('UPS hold: at 5 minutes an unchanged reading is still a 304', async () => {
  const t0 = clock();
  cycle(t0, { load: 20, runtime: 3600 });
  const first = await getStatus();
  cycle(t0 + 2 * MINUTE, { load: 22, runtime: 3500 });
  cycle(t0 + UPS_HOLD_MS, { load: 20.6, runtime: 3590 });
  const due = await getStatus(first.headers.etag);
  assert.equal(due.status, 304, 'read afresh, and the same as held: 20 % and 60 min');
});

test('UPS hold: a reading going to null is a 200 at once, and from null back', async () => {
  const t0 = clock();
  cycle(t0, { load: 20, runtime: 3600 });
  const first = await getStatus();
  cycle(t0 + 30_000, { load: null, runtime: 3600 });
  const gone = await getStatus(first.headers.etag);
  assert.equal(gone.status, 200);
  assert.deepEqual(readings(gone.body), [null, 60]);

  cycle(t0 + MINUTE, { load: 21, runtime: 3600 });
  const back = await getStatus(gone.headers.etag);
  assert.equal(back.status, 200);
  assert.deepEqual(readings(back.body), [21, 60]);
});

test('UPS hold: another field of the UPS changing refreshes the held readings in the same 200', async () => {
  const t0 = clock();
  cycle(t0, { load: 20, runtime: 3600, charge: 100 });
  const first = await getStatus();
  cycle(t0 + 30_000, { load: 24, runtime: 3300, charge: 100 });
  assert.equal((await getStatus(first.headers.etag)).status, 304);

  // The charge moves a minute in: the readings are this cycle's too.
  cycle(t0 + MINUTE, { load: 27.5, runtime: 3060, charge: 98 });
  const moved = await getStatus(first.headers.etag);
  assert.equal(moved.status, 200);
  assert.equal(upsOf(moved.body).metric.value, 98);
  assert.deepEqual(readings(moved.body), [27, 51]);

  // On battery: the load is read afresh with the state.
  cycle(t0 + 90_000, { load: 41, runtime: 1260, charge: 98, status: 2 });
  const battery = await getStatus(moved.headers.etag);
  assert.equal(battery.status, 200);
  assert.deepEqual(
    [upsOf(battery.body).word, upsOf(battery.body).load, upsOf(battery.body).runtimeMinutes],
    ['On battery', 41, 21]
  );
});

test('UPS hold: on battery the runtime left stays live, a new status each minute (#549)', async () => {
  const t0 = clock();
  cycle(t0, { status: 2, runtime: 1260 });
  const first = await getStatus();
  cycle(t0 + MINUTE, { status: 2, runtime: 1200 });
  const next = await getStatus(first.headers.etag);
  assert.equal(next.status, 200);
  assert.equal(upsOf(next.body).runtimeMinutes, 20);
});
