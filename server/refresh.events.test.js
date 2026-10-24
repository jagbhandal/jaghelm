/**
 * #267 through the loop's real wiring and the real app: with push off (no VAPID
 * keys), each status cycle's changes are recorded in the history, kept in
 * DATA_DIR's push snapshot file, served by GET /api/events behind the token,
 * and there after a restart. The status model starts from the history's
 * baseline, the levels the last cycle had, push on or off: a restart inside a
 * hysteresis band records no false "normal". Push's baseline holds while push
 * is off, so back on it pages against what the phones last saw, and the
 * record of the change, made while push was off, says how many phones got it.
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
// Alerts are sent as they happen here, not held for a burst window (#669).
writeFileSync(join(dataDir, 'display-config.json'), JSON.stringify({ alerts: { groupWindowSeconds: 0 } }));
process.env.DASH_PASS = 'test-pass-1234';
delete process.env.VAPID_PUBLIC_KEY;
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
process.env.PROMETHEUS_URL = 'http://127.0.0.1:1';
process.env.KUMA_URL = 'http://127.0.0.1:1';
const snapshotFile = join(dataDir, 'push-snapshot.json');
// What the last run left, push off: n1's memory went over its line (recorded),
// and the phones last saw it fine (push's baseline).
const board = (mem) => ({
  services: {},
  monitorOf: {},
  hosts: { n1: { reachable: true, levels: { cpu: 'ok', disk: 'ok', mem, temp: 'ok' } } },
  ups: { state: 'online' },
  cron: {},
  sources: {},
});
const memHigh = {
  id: '1',
  at: new Date().toISOString(),
  type: 'host_threshold',
  severity: 'warning',
  entity: 'nodes/n1',
  title: 'Host memory high',
  body: 'n1 · Memory 92 % (warning above 90 %)',
  reason: 'Memory 92 % (warning above 90 %)',
  node: 'n1',
  key: 'n1:mem',
  push: { state: 'off', phones: 0, suppressed: 0 },
};
writeFileSync(
  snapshotFile,
  JSON.stringify({ ...board('ok'), history: { lastId: 1, events: [memHigh], snapshot: board('warn') } })
);

const { app } = await import('./index.js');
const { webPhone } = await import('./testing/webPhone.js');
const { saveConfig } = await import('./config.js');
const { setCache } = await import('./cache.js');
const { getPushChannels, getPushStore } = await import('./push/store.js');
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
  assert.equal(getPushChannels().isPushEnabled(), false, 'no VAPID keys');

  // 87 % is inside the band of the warning recorded: nothing, not a false "normal"
  // (the model starts from the history's baseline, not push's, nor from nothing).
  await cycle({ memPercent: '87' }, NOW);
  assert.deepEqual(brief(await events()), ['host_threshold n1:mem warning off']);

  // The disk goes over its crit line.
  await cycle({ memPercent: '87', diskPercent: '96' }, NOW + 30_000);
  const res = await events();
  assert.equal(res.status, 200);
  assert.deepEqual(brief(res), ['host_threshold n1:disk critical off', 'host_threshold n1:mem warning off']);
  assert.equal(res.body.events[0].entity, 'nodes/n1');
  assert.match(res.body.events[0].body, /^n1 · /);
  assert.deepEqual(brief(await events('?severity=info')), []);
  assert.deepEqual(brief(await events('?severity=critical&entity=nodes/n1')), ['host_threshold n1:disk critical off']);

  const anonymous = await request(app).get('/api/events');
  assert.equal(anonymous.status, 401, 'behind the token like every /api read');

  // A restart reads the same history from DATA_DIR.
  const restarted = createPushSnapshot({ path: snapshotFile });
  assert.deepEqual(restarted.events(), res.body);
});

test("#267: push back on: push pages against what the phones last saw; the record says it was sent, and to how many phones", async () => {
  webPhone({ store: getPushStore() });

  // The phones last saw everything fine: both problems page now, each on its
  // record from while push was off, and nothing new is recorded.
  await cycle({ memPercent: '87', diskPercent: '96' }, NOW + 60_000);
  assert.deepEqual(brief(await events()), [
    'host_threshold n1:disk critical sent',
    'host_threshold n1:mem warning sent',
  ]);
  assert.deepEqual((await events('?limit=1')).body.events[0].push, { state: 'sent', phones: 1, suppressed: 0 });

  // Both back to normal: recorded once, and sent.
  await cycle({ memPercent: '40', diskPercent: '50' }, NOW + 90_000);
  assert.deepEqual(brief(await events('?limit=2')), [
    'host_threshold_cleared n1:mem info sent',
    'host_threshold_cleared n1:disk info sent',
  ]);
});
