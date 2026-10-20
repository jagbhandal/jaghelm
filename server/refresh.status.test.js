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
    hosts: { n1: { reachable: true, levels: { cpu: 'ok', disk: 'ok', mem: 'warn' } } },
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
const { getCached, setCache } = await import('./cache.js');
const { pushSnapshot, stopBackgroundRefresh, updateStatus } = await import('./refresh.js');
const { node } = await import('./testing/statusFixtures.js');

after(() => {
  stopBackgroundRefresh();
  rmSync(dataDir, { recursive: true, force: true });
});

test('updateStatus: the first status starts from the levels push persisted, and is kept for /api/status', () => {
  // Push is set up (creds read) but its messaging isn't up yet: the boot race
  // initPush notes. The seed must not wait for it.
  fcm.initPush({
    credsPath: creds,
    env: {},
    messagingFactory: () => new Promise(() => {}),
    logger: { info() {}, warn() {} },
  });
  assert.equal(fcm.isPushConfigured(), true);
  assert.equal(fcm.isPushEnabled(), false);

  setCache('services', {
    nodes: { n1: node({ memPercent: '87' }) },
    overallHealth: 'up',
    sources: { prometheus: { ok: true }, kuma: { ok: true } },
  });
  const status = updateStatus([]);
  assert.equal(getCached('status'), status, 'kept for /api/status');
  const n1 = status.entities.find((e) => e.id === 'nodes/n1');
  assert.equal(n1.conditions.mem, 'warn', '87 % is inside the band of a warning push already sent');
  assert.equal(n1.reason, 'Memory 87 % (warning until below 85 %)');
  assert.notEqual(pushSnapshot.prev(), null, 'read from the file');

  const job = status.entities.find((e) => e.id === 'jobs/n1:restic');
  assert.deepEqual(
    [job.state, job.reason],
    ['warn', 'Last run failed: exit 3'],
    'the cron store, read once a cycle'
  );
});
