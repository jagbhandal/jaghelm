/**
 * #579 through the loop itself: with Google out of reach a send can take
 * ~145 s (push/fcmHttp.js timeouts and retries), and past 90 s /api/health
 * answers 503. The cycle hands its pushes to the outbox and never waits on
 * one, so a send that never answers holds up neither the next cycle nor
 * /api/health.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-579-outbox-'));
process.env.JAGHELM_DATA_DIR = dataDir;
delete process.env.DASH_PASS; // auth disabled
// Refused ports: the refreshes fail fast instead of waiting on a network.
process.env.PROMETHEUS_URL = 'http://127.0.0.1:1';
process.env.KUMA_URL = 'http://127.0.0.1:1';
writeFileSync(join(dataDir, 'display-config.json'), JSON.stringify({ refreshInterval: 30 }));
// A services.yaml that doesn't parse: its second cycle pages "JagHelm config broken" (#505).
writeFileSync(join(dataDir, 'services.yaml'), 'nodes: [\n');
const creds = join(dataDir, 'sa.json');
writeFileSync(creds, JSON.stringify({ project_id: 'test' }));

const { app } = await import('./index.js');
const { loadConfig } = await import('./config.js');
const fcm = await import('./push/fcm.js');
const { getPushStore } = await import('./push/store.js');
const { getRefreshHealth, startBackgroundRefresh, stopBackgroundRefresh } = await import('./refresh.js');

after(() => {
  stopBackgroundRefresh();
  rmSync(dataDir, { recursive: true, force: true });
});

const silent = { debug() {}, info() {}, warn() {}, error() {} };
// Push is up, with one phone; Google never answers a send.
const sends = [];
fcm.initPush({
  credsPath: creds,
  env: {},
  messagingFactory: () => ({
    send: (msg) => {
      sends.push(`${msg.data.type} ${msg.data.id}`);
      return new Promise(() => {});
    },
  }),
  logger: silent,
});
getPushStore().registerToken('phone', { platform: 'android', appVersion: '1.2.0' });

const realTimeout = globalThis.setTimeout;
const pause = (ms) => new Promise((resolve) => realTimeout(resolve, ms));

test('#579: a send that never answers holds up neither the next cycle nor /api/health', async (t) => {
  loadConfig(); // as index.js boots
  // Record the loop's timer instead of letting it fire; the test runs each tick by hand.
  const timers = [];
  const realSetInterval = globalThis.setInterval;
  t.mock.method(globalThis, 'setInterval', (fn, ms) => {
    timers.push({ fn, ms });
    return realSetInterval(() => {}, 2 ** 31 - 1).unref();
  });
  startBackgroundRefresh();
  for (let i = 0; getRefreshHealth().state !== 'ok'; i += 1) {
    assert.ok(i < 500, 'the warm-up cycle finished');
    await pause(20);
  }

  // The loop's clock: three minutes of 30 s cycles, past what one send can take.
  let clock = Date.now();
  t.mock.method(Date, 'now', () => clock);
  for (let i = 1; i <= 6; i += 1) {
    clock += 30_000;
    const tick = timers.at(-1).fn();
    const ended = await Promise.race([tick.then(() => 'ended'), pause(5_000).then(() => 'still waiting')]);
    assert.equal(ended, 'ended', `cycle ${i + 1} ended`);
    const res = await request(app).get('/api/health');
    assert.deepEqual([res.status, res.body.refresh, res.body.refreshAgeMs], [200, 'ok', 0], `health after cycle ${i + 1}`);
  }
  assert.deepEqual(sends, ['source_down config'], 'the page went out, and is still waiting on Google');
  const file = JSON.parse(readFileSync(join(dataDir, 'push-snapshot.json'), 'utf8'));
  assert.equal(file.sources.config, 'down', 'the snapshot moved on');
  assert.deepEqual(
    file.outbox.map((e) => `${e.type} ${e.id}`),
    ['source_down config'],
    'the page stays queued until Google takes it'
  );
});
