/**
 * #267 through the loop's real wiring and the real app: with push off (no FCM
 * creds), each status cycle's changes are recorded in the history, kept in
 * DATA_DIR's push snapshot file, served by GET /api/events behind the token,
 * and there after a restart. The status model starts from the file's levels
 * whether or not push is set up, since the file is live state either way: a
 * restart inside a hysteresis band records no false "normal". With push on,
 * the record says how many phones got it.
 *
 * Its own file: auth and the data dir are read when the modules load.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-267-loop-'));
process.env.JAGHELM_DATA_DIR = dataDir;
process.env.DASH_PASS = 'test-pass-1234';
delete process.env.FCM_SERVICE_ACCOUNT;
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
process.env.PROMETHEUS_URL = 'http://127.0.0.1:1';
process.env.KUMA_URL = 'http://127.0.0.1:1';
const snapshotFile = join(dataDir, 'push-snapshot.json');
// What the last run left: n1's memory over its line (a page went out then).
writeFileSync(
  snapshotFile,
  JSON.stringify({
    services: {},
    monitorOf: {},
    hosts: { n1: { reachable: true, levels: { cpu: 'ok', disk: 'ok', mem: 'warn', temp: 'ok' } } },
    ups: { state: 'online' },
    cron: {},
    sources: {},
  })
);
const creds = join(dataDir, 'sa.json');
writeFileSync(creds, JSON.stringify({ project_id: 'test' }));

const { app } = await import('./index.js');
const fcm = await import('./push/fcm.js');
const { saveConfig } = await import('./config.js');
const { setCache } = await import('./cache.js');
const { getPushStore } = await import('./push/store.js');
const { createPushSnapshot } = await import('./push/dispatch.js');
const { pushSender, runStatusAndPush, stopBackgroundRefresh } = await import('./refresh.js');
const { createSession } = await import('./auth/sessions.js');
const { NOW, UPS_ONLINE, node } = await import('./testing/statusFixtures.js');

saveConfig({ nodes: { n1: { display_name: 'n1' } }, services: {} });
const token = createSession('admin');

after(() => {
  stopBackgroundRefresh();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DASH_PASS;
});

/** One loop cycle on n1's readings: what the refreshes cache, then the status-and-push step. */
async function cycle(metrics, at) {
  setCache('services', {
    nodes: { n1: node(metrics, { display_name: 'n1' }) },
    overallHealth: 'up',
    sources: { prometheus: { ok: true }, kuma: { ok: true } },
  });
  setCache('ups', { ...UPS_ONLINE });
  await runStatusAndPush([], at);
  await pushSender.idle();
}

const events = (query = '') => request(app).get(`/api/events${query}`).set('x-auth-token', token);
const brief = (res) => res.body.events.map((e) => `${e.type} ${e.key} ${e.severity} ${e.push.state}`);

test('#267: push off: the loop records each change, GET /api/events serves it behind the token, and a restart keeps it', async () => {
  assert.equal(fcm.isPushEnabled(), false, 'no FCM creds');

  // 87 % is inside the band of the warning already sent: nothing, not a false "normal".
  await cycle({ memPercent: '87' }, NOW);
  assert.deepEqual((await events()).body, { events: [], next: null });

  // The disk goes over its crit line.
  await cycle({ memPercent: '87', diskPercent: '96' }, NOW + 30_000);
  const res = await events();
  assert.equal(res.status, 200);
  assert.deepEqual(brief(res), ['host_threshold n1:disk critical off']);
  assert.equal(res.body.events[0].entity, 'nodes/n1');
  assert.match(res.body.events[0].body, /^n1 · /);
  assert.deepEqual(brief(await events('?severity=info')), []);
  assert.deepEqual(brief(await events('?entity=nodes/n1')), ['host_threshold n1:disk critical off']);

  const anonymous = await request(app).get('/api/events');
  assert.equal(anonymous.status, 401, 'behind the token like every /api read');

  // A restart reads the same history from DATA_DIR.
  const restarted = createPushSnapshot({ path: snapshotFile });
  assert.deepEqual(restarted.events(), res.body);
});

test('#267: push on: the record says it was sent, and to how many phones', async () => {
  fcm.initPush({
    credsPath: creds,
    env: {},
    messagingFactory: () => ({ send: async () => 'id' }),
    logger: { info() {}, warn() {} },
  });
  getPushStore().registerToken('phone', { platform: 'android', appVersion: '1.3.0' });

  await cycle({ memPercent: '40', diskPercent: '50' }, NOW + 60_000);
  assert.deepEqual(brief(await events()), [
    'host_threshold_cleared n1:mem info sent',
    'host_threshold_cleared n1:disk info sent',
    'host_threshold n1:disk critical off',
  ]);
  assert.deepEqual((await events('?limit=1')).body.events[0].push, { state: 'sent', phones: 1, suppressed: 0 });
});
