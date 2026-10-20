/**
 * A status model that throws never stops push (#292 review). The loop's
 * status-and-push step (refresh.js runStatusAndPush) catches it: the error is
 * logged once per distinct error, /api/status keeps serving the last status,
 * push skips that cycle without diffing or advancing its snapshot (token
 * pruning still runs), and the next good cycle pushes against the last good
 * snapshot, so a change made during the failure is still sent.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-model-failure-'));
process.env.JAGHELM_DATA_DIR = dataDir;
process.env.LOG_LEVEL = 'info';
const creds = join(dataDir, 'sa.json');
writeFileSync(creds, JSON.stringify({ project_id: 'test' }));

const fcm = await import('./push/fcm.js');
const { getCached, setCache } = await import('./cache.js');
const { getPushStore } = await import('./push/store.js');
const { runStatusAndPush, stopBackgroundRefresh } = await import('./refresh.js');
const { UPS_ONLINE, monitored, node } = await import('./testing/statusFixtures.js');

after(() => {
  stopBackgroundRefresh();
  rmSync(dataDir, { recursive: true, force: true });
});

// Push is up, with one phone registered; what FCM was asked to send.
const sent = [];
fcm.initPush({
  credsPath: creds,
  env: {},
  messagingFactory: () => ({ send: async (msg) => sent.push(`${msg.data.type} ${msg.data.id}`) }),
  logger: { info() {}, warn() {} },
});
getPushStore().registerToken('phone', { platform: 'android', appVersion: '1.2.0' });

// The structured logger's JSON lines written while `fn` runs.
async function captureLogs(fn) {
  const lines = [];
  const orig = { out: process.stdout.write, err: process.stderr.write };
  const tap = (write) =>
    function (chunk, ...rest) {
      try {
        const obj = JSON.parse(String(chunk));
        if (obj && obj.module) {
          lines.push(obj);
          return true;
        }
      } catch {
        // not one of ours
      }
      return write.call(this, chunk, ...rest);
    };
  process.stdout.write = tap(orig.out);
  process.stderr.write = tap(orig.err);
  try {
    await fn();
  } finally {
    process.stdout.write = orig.out;
    process.stderr.write = orig.err;
  }
  return lines;
}

/** What the refreshes cache in one cycle: app's Kuma status, and n1's CPU reading. */
function refreshed({ app = 'up', cpu = '10' } = {}) {
  setCache(
    'services',
    {
      nodes: { n1: node({ cpu }, { services: [monitored('n1:app', app)] }) },
      overallHealth: app === 'down' ? 'down' : 'up',
      sources: { prometheus: { ok: true }, kuma: { ok: true } },
    },
    { upWithoutCard: [], monitorOf: { 'n1:app': '1' } }
  );
  setCache('ups', { ...UPS_ONLINE });
}

// A reading the model can't read at all: converting it to a number throws.
const POISON = {
  toString() {
    throw new Error('a reading that is no number');
  },
};

const modelErrors = (lines) =>
  lines.filter((l) => l.level === 'error' && /status model/.test(l.msg));

test('the model throwing on cycle N: logged once, no crash, /api/status keeps the last status, push skips; the next good cycle pushes', async () => {
  refreshed();
  await runStatusAndPush([]); // the baseline
  const good = getCached('status');
  assert.ok(good, 'built');
  const snapshotFile = join(dataDir, 'push-snapshot.json');
  const baseline = readFileSync(snapshotFile, 'utf8');

  // The model throws for three cycles, and meanwhile app goes down.
  const failing = await captureLogs(async () => {
    for (let i = 0; i < 3; i += 1) {
      refreshed({ app: 'down', cpu: POISON });
      await assert.doesNotReject(runStatusAndPush([]));
    }
  });
  const errors = modelErrors(failing);
  assert.equal(errors.length, 1, 'one line for the same error, not one per cycle');
  assert.match(JSON.stringify(errors[0]), /a reading that is no number/);
  assert.equal(getCached('status'), good, '/api/status keeps the last good status');
  assert.deepEqual(sent, [], 'push skipped the cycles it had no status for');
  assert.equal(readFileSync(snapshotFile, 'utf8'), baseline, 'and did not advance its snapshot');

  // The model builds again: the change made during the failure is sent.
  const back = await captureLogs(async () => {
    refreshed({ app: 'down' });
    await runStatusAndPush([]);
  });
  assert.deepEqual(sent, ['service_down n1:app']);
  assert.notEqual(getCached('status'), good);
  assert.ok(
    back.some((l) => l.level === 'info' && /status model/.test(l.msg)),
    'its recovery is logged'
  );
});

test('a different error is logged again', async () => {
  const lines = await captureLogs(async () => {
    refreshed({ cpu: POISON });
    await runStatusAndPush([]);
    refreshed({
      cpu: {
        toString() {
          throw new Error('another bad reading');
        },
      },
    });
    await runStatusAndPush([]);
    await runStatusAndPush([]);
  });
  assert.equal(modelErrors(lines).length, 2);
});
