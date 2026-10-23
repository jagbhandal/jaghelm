/**
 * #536: a services.yaml JagHelm can't read at boot is on the board, in a push
 * and in /api/health, as one that doesn't parse is (#505), and fixing its
 * permissions recovers without a restart.
 *
 * It used to give the calm empty board with a green header, and a fix to the
 * permissions doesn't change the file's mtime, so the watcher never reloaded
 * it. Now the config source is down with "services.yaml can't be read
 * (permission denied)", one source_down page after its 2 cycles, health
 * `config: { state: 'unreadable', code }` with `status` still `ok`, and the
 * 30 s retry reads it again: one source_recovered. A broken or unreadable
 * file deleted is broken no more: one source_recovered, and the board is what
 * a missing file gives (empty after a broken boot; the next save writes one).
 *
 * Its own file because the module's state is the point: it boots on the
 * unreadable file, as index.js does, through the loop's real wiring. Reads
 * fail through a stand-in for readFileSync, as a permission change does (the
 * file and its mtime stay), so it runs as root too.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';

const dataDir = fs.mkdtempSync(join(tmpdir(), 'jh-config-unreadable-'));
process.env.JAGHELM_DATA_DIR = dataDir;
const creds = join(dataDir, 'sa.json');
fs.writeFileSync(creds, JSON.stringify({ project_id: 'test' }));

const fcm = await import('./push/fcm.js');
const { getCached, setCache } = await import('./cache.js');
const { getPushStore } = await import('./push/store.js');
const { CONFIG_ABSENT, getConfig, loadConfig, readConfig, startConfigWatcher, stopConfigWatcher } =
  await import('./config.js');
const { noNodesCacheEntry, runStatusAndPush: statusAndPushCycle, pushSender, stopBackgroundRefresh } = await import('./refresh.js');
/** One status-and-push cycle, as the loop runs it, and the pushes it queued sent (#579). */
const runStatusAndPush = async (...args) => {
  await statusAndPushCycle(...args);
  await pushSender.idle();
};
const { systemRoutes } = await import('./routes/system.js');

const app = express();
app.use('/api', systemRoutes);

const CONFIG_PATH = join(dataDir, 'services.yaml');

// Reads of services.yaml fail with `blocked` while it names a code and the file is there.
const realRead = fs.readFileSync;
let blocked = null;
fs.readFileSync = function readFileSync(path, ...rest) {
  if (path === CONFIG_PATH && blocked && fs.existsSync(path)) {
    throw Object.assign(new Error(`${blocked}: blocked, open '${path}'`), { code: blocked });
  }
  return realRead(path, ...rest);
};
syncBuiltinESMExports();

after(() => {
  stopConfigWatcher();
  stopBackgroundRefresh();
  fs.readFileSync = realRead;
  syncBuiltinESMExports();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// Push is up, with one phone registered; what FCM was asked to send.
const sent = [];
fcm.initPush({
  credsPath: creds,
  env: {},
  messagingFactory: () => ({
    send: async (msg) => sent.push({ data: msg.data, notification: msg.notification }),
  }),
  logger: { info() {}, warn() {} },
});
getPushStore().registerToken('phone', { platform: 'android', appVersion: '1.2.0' });

const GOOD = 'nodes: {}\nservices: {}\nintegrations: {}\n';
const BROKEN = 'nodes: {}\nservices: {}\n  integrations: {}\n';
const UNREADABLE = "services.yaml can't be read (permission denied)";

/** The refreshes' cache with no nodes on the board (#449). */
function refreshedWithNoNodes() {
  const { payload, internal } = noNodesCacheEntry({ prometheusOk: true });
  setCache('services', payload, internal);
  setCache('ups', { status: null, charge: null, runtime: null, load: null, ok: true, configured: false, model: null });
  setCache('integrations', {});
}

const pushed = (from) => sent.slice(from).map((m) => `${m.data.type} ${m.data.id}`);
const T0 = Date.UTC(2026, 9, 22, 12, 0, 0);
const CYCLE = 30_000;
let cycles = 0;
/** The next status-and-push cycle, as the loop runs it. */
async function cycle() {
  refreshedWithNoNodes();
  cycles += 1;
  await runStatusAndPush([], T0 + cycles * CYCLE);
}
const health = async () => (await request(app).get('/api/health')).body;

test('unreadable at boot: the config source is down with the reason, health says unreadable, one page; permissions fixed: back within one retry, one recovery', async (t) => {
  fs.writeFileSync(CONFIG_PATH, GOOD);
  blocked = 'EACCES';
  // As index.js boots: the file is there, so no discovery; the board starts empty.
  assert.deepEqual(loadConfig(), {});

  await cycle();
  const status = getCached('status');
  assert.deepEqual(status.sources.config, {
    state: 'failed',
    error: UNREADABLE,
    since: T0 + CYCLE,
  });
  const issue = status.issues.find((i) => i.id === 'sources/config');
  assert.equal(issue.name, 'JagHelm config');
  assert.equal(issue.reason, UNREADABLE);
  assert.deepEqual(status.overall, { state: 'warn', sentence: UNREADABLE });

  const body = await health();
  assert.equal(body.status, 'ok', 'the deploy gate is not tripped');
  assert.deepEqual(body.config, { state: 'unreadable', code: 'EACCES' });

  await cycle();
  await cycle();
  assert.deepEqual(pushed(0), ['source_down config'], 'one page after its two cycles');
  assert.deepEqual(sent[0].notification, {
    title: 'JagHelm config broken',
    body: `JagHelm config · ${UNREADABLE}`,
  });

  // The watcher's first look (boot left it nothing to compare with) reads
  // it again, still unreadable.
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  startConfigWatcher();
  t.mock.timers.tick(5_000);
  t.mock.timers.tick(250);
  assert.equal((await health()).config.state, 'unreadable');
  // Fixed in a way the file's own stat doesn't show (its folder's
  // permissions, say): the watcher sees nothing, the retry reads it again.
  blocked = null;
  t.mock.timers.tick(30_000 - 5_250 - 1);
  assert.equal((await health()).config.state, 'unreadable', 'the watcher alone sees no change');
  t.mock.timers.tick(1);
  assert.deepEqual((await health()).config, { state: 'ok' });
  stopConfigWatcher();
  t.mock.timers.reset();

  await cycle();
  await cycle();
  assert.deepEqual(pushed(1), ['source_recovered config'], 'one recovery, then nothing');
  assert.deepEqual(sent[1].notification, {
    title: 'JagHelm config fixed',
    body: 'services.yaml is no longer broken',
  });
  const back = getCached('status');
  assert.equal(back.sources.config, undefined);
  assert.equal(back.overall.state, 'empty', 'the empty board is calm again (#449)');
});

for (const [what, breakIt, state] of [
  ["a file that doesn't parse", () => fs.writeFileSync(CONFIG_PATH, BROKEN), 'unparseable'],
  ["a file that can't be read", () => (blocked = 'EACCES'), 'unreadable'],
]) {
  test(`${what}, deleted: the broken state clears with one recovery, and the next save writes a new file`, async (t) => {
    const before = sent.length;
    breakIt();
    loadConfig();
    assert.equal((await health()).config.state, state);
    await cycle();
    await cycle();
    assert.deepEqual(pushed(before), ['source_down config']);

    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
    startConfigWatcher();
    fs.rmSync(CONFIG_PATH);
    t.mock.timers.tick(5_000);
    assert.deepEqual((await health()).config, { state: 'ok' });
    stopConfigWatcher();
    t.mock.timers.reset();

    await cycle();
    await cycle();
    assert.deepEqual(pushed(before), ['source_down config', 'source_recovered config']);
    assert.equal(sent.at(-1).notification.body, 'services.yaml is no longer broken', 'true of a deleted file too');
    assert.equal(getCached('status').overall.state, 'empty');
    // A missing file, as today: the version is absent and the next save writes one.
    assert.equal(readConfig().version, CONFIG_ABSENT);
    assert.deepEqual(getConfig().nodes, {});
    blocked = null;
    fs.writeFileSync(CONFIG_PATH, GOOD);
    loadConfig();
  });
}
