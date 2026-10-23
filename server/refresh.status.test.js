/**
 * The loop's status step (refresh.js updateStatus, #292): it builds the status
 * model from what the refreshes cached, keeps it for /api/status, and, the
 * first time, starts the model from the levels the push snapshot file holds
 * when push is set up (#361), so a restart inside a hysteresis band is still
 * over the line. The jobs come from one read of the cron store, which push
 * then takes from the model.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-status-step-'));
process.env.JAGHELM_DATA_DIR = dataDir;
// What push persisted before the restart: n1's memory over its line.
writeFileSync(
  join(dataDir, 'push-snapshot.json'),
  JSON.stringify({
    services: {},
    monitorOf: {},
    hosts: {
      n1: { reachable: true, levels: { cpu: 'ok', disk: 'ok', mem: 'warn' } },
      // A node taken out of services.yaml while JagHelm was stopped.
      gone: { reachable: true, levels: { disk: 'warn' } },
    },
    ups: { state: 'unknown' },
    cron: {},
    sources: {},
  })
);
writeFileSync(
  join(dataDir, 'cron-jobs.json'),
  JSON.stringify({
    n1: { restic: [{ status: 'failure', timestamp: new Date().toISOString(), error: 'exit 3' }] },
  })
);
const creds = join(dataDir, 'sa.json');
writeFileSync(creds, JSON.stringify({ project_id: 'test' }));

const fcm = await import('./push/fcm.js');
const { saveConfig } = await import('./config.js');
const { getCached, setCache } = await import('./cache.js');
const { pushSnapshot, stopBackgroundRefresh, updateStatus } = await import('./refresh.js');
const { node } = await import('./testing/statusFixtures.js');

saveConfig({ nodes: { n1: { display_name: 'n1' } }, services: {} });

after(() => {
  stopBackgroundRefresh();
  rmSync(dataDir, { recursive: true, force: true });
});

test('updateStatus: the first status starts from the levels push persisted, and is kept for /api/status', () => {
  // Push is set up: the seed reads what it persisted.
  fcm.initPush({
    credsPath: creds,
    env: {},
    messagingFactory: () => ({ send: async () => 'id' }),
    logger: { info() {}, warn() {} },
  });
  assert.equal(fcm.isPushEnabled(), true);

  // Prometheus failed this cycle (its CPU query), so the model keeps what it
  // fed last cycle as unknown: a node seeded from the file but no longer
  // configured must not be among it.
  setCache('services', {
    nodes: { n1: node({ memPercent: '87' }, { failedReads: ['cpu'] }) },
    overallHealth: 'up',
    sources: { prometheus: { ok: false }, kuma: { ok: true } },
  });
  const status = updateStatus([]);
  assert.equal(getCached('status'), status, 'kept for /api/status');
  const n1 = status.entities.find((e) => e.id === 'nodes/n1');
  assert.equal(n1.conditions.mem, 'warn', '87 % is inside the band of a warning push already sent');
  assert.match(n1.reason, /Memory 87 % \(warning until below 85 %\)/);
  assert.deepEqual(
    status.entities.filter((e) => e.kind === 'node').map((e) => e.id),
    ['nodes/n1'],
    'the seed leaves out a node the config no longer has'
  );
  assert.notEqual(pushSnapshot.prev(), null, 'read from the file');

  const job = status.entities.find((e) => e.id === 'jobs/n1:restic');
  assert.deepEqual(
    [job.state, job.reason],
    ['warn', 'Last run failed: exit 3'],
    'the cron store, read once a cycle'
  );
});

test('the status lives two refresh intervals, so /api/status has one between cycles however long they are', () => {
  const realNow = Date.now;
  const t0 = realNow();
  const config = join(dataDir, 'display-config.json');
  try {
    Date.now = () => t0;
    writeFileSync(config, JSON.stringify({ refreshInterval: 300 }));
    updateStatus([]);
    Date.now = () => t0 + 250_000; // past the cache's 120 s, before the next 300 s cycle
    assert.ok(getCached('status'), 'still served between cycles');
    Date.now = () => t0 + 601_000;
    assert.equal(getCached('status'), null, 'gone once two cycles were missed');

    // The default interval (30 s) keeps the cache's 120 s.
    writeFileSync(config, JSON.stringify({}));
    Date.now = () => t0;
    updateStatus([]);
    Date.now = () => t0 + 119_000;
    assert.ok(getCached('status'));
    Date.now = () => t0 + 121_000;
    assert.equal(getCached('status'), null);
  } finally {
    Date.now = realNow;
    rmSync(config, { force: true });
  }
});
