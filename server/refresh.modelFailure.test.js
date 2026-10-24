/**
 * A status model that throws never stops push (#292 review), and doesn't
 * silence it unnoticed (#440). The loop's status-and-push step (refresh.js
 * runStatusAndPush) catches it: the error is logged once per distinct error
 * and its recovery once, /api/status keeps serving the last status, push
 * diffs nothing the model judges and keeps that part of its snapshot (token
 * pruning still runs), and the next good cycle pushes against the last good
 * snapshot, so a change made during the failure is still sent. The failure
 * itself pages after 2 cycles in a row ("JagHelm status check failing"), once,
 * and its recovery once, and /api/health says `statusModel: degraded` meanwhile.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-model-failure-'));
process.env.JAGHELM_DATA_DIR = dataDir;
process.env.LOG_LEVEL = 'info';

const { webPhone } = await import('./testing/webPhone.js');
const { getCached, setCache } = await import('./cache.js');
const { getPushStore } = await import('./push/store.js');
const { getStatusModelHealth, runStatusAndPush: statusAndPushCycle, pushSender, stopBackgroundRefresh } = await import('./refresh.js');
/** One status-and-push cycle, as the loop runs it, and the pushes it queued sent (#579). */
const runStatusAndPush = async (...args) => {
  await statusAndPushCycle(...args);
  await pushSender.idle();
};
const { systemRoutes } = await import('./routes/system.js');
const { UPS_ONLINE, monitored, node } = await import('./testing/statusFixtures.js');

const app = express();
app.use('/api', systemRoutes);
const health = async () => (await request(app).get('/api/health')).body;

after(() => {
  stopBackgroundRefresh();
  rmSync(dataDir, { recursive: true, force: true });
});

// Push is up, with one phone registered; what the sender was asked to send.
const sent = [];
webPhone({
  store: getPushStore(),
  answer: (event) => {
    sent.push(`${event.type} ${event.id}`);
    return { ok: true, prune: false };
  },
});

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
const modelInfos = (lines) =>
  lines.filter((l) => l.level === 'info' && /status model/.test(l.msg));
const snapshotFile = join(dataDir, 'push-snapshot.json');
/** The snapshot the file holds, without the alert history beside it (#267). */
const fileSnapshot = () => ({ ...JSON.parse(readFileSync(snapshotFile, 'utf8')), history: undefined });
/** A snapshot without the status check's own entry: what the model judged. */
const judged = (snap) => ({ ...snap, sources: { ...snap.sources, status: undefined } });

const T0 = Date.UTC(2026, 9, 20, 12, 0, 0);
const CYCLE = 30_000;

test('the model throwing for 3 cycles: logged once, no crash, /api/status keeps the last status, one push after 2 cycles; it builds again: one recovery, and what changed is sent', async () => {
  assert.equal(getStatusModelHealth().state, 'starting', 'before its first cycle');
  refreshed();
  await runStatusAndPush([], T0); // the baseline
  const good = getCached('status');
  assert.ok(good, 'built');
  assert.deepEqual((await health()).statusModel, { state: 'ok' });
  const baseline = fileSnapshot();

  // The model throws for three cycles, and meanwhile app goes down.
  const perCycle = [];
  const failing = await captureLogs(async () => {
    for (let i = 1; i <= 3; i += 1) {
      refreshed({ app: 'down', cpu: POISON });
      const before = sent.length;
      await assert.doesNotReject(runStatusAndPush([], T0 + i * CYCLE));
      perCycle.push(sent.slice(before));
    }
  });
  const errors = modelErrors(failing);
  assert.equal(errors.length, 1, 'one line for the same error, not one per cycle');
  assert.match(JSON.stringify(errors[0]), /a reading that is no number/);
  assert.equal(getCached('status'), good, '/api/status keeps the last good status');
  assert.deepEqual(perCycle, [[], ['source_down status'], []], 'one push, on the second failed cycle');
  assert.deepEqual(judged(fileSnapshot()), judged(baseline), 'nothing the model judges moved in the snapshot');
  assert.equal(fileSnapshot().sources.status, 'down', 'the count is in the file, for a restart');

  // /api/health: degraded, with the error's class and since when; never its message.
  const res = await request(app).get('/api/health');
  assert.equal(res.status, 200, 'still alive: a restart cannot mend the input');
  assert.equal(res.body.status, 'ok', 'and the deploy gate is not tripped');
  assert.deepEqual(res.body.statusModel, {
    state: 'degraded',
    error: 'Error',
    since: new Date(T0 + CYCLE).toISOString(),
    failedCycles: 3,
  });
  assert.doesNotMatch(res.text, /no number/, 'no input data or error message');

  // The model builds again: one recovery push, and the change made meanwhile.
  const back = await captureLogs(async () => {
    refreshed({ app: 'down' });
    const before = sent.length;
    await runStatusAndPush([], T0 + 4 * CYCLE);
    perCycle.push(sent.slice(before));
    await runStatusAndPush([], T0 + 5 * CYCLE);
    perCycle.push(sent.slice(before + perCycle[3].length));
  });
  assert.deepEqual(perCycle.slice(3), [['service_down n1:app', 'source_recovered status'], []]);
  assert.notEqual(getCached('status'), good);
  assert.equal(modelInfos(back).length, 1, 'its recovery is logged, once');
  assert.equal(modelInfos(back)[0].failedCycles, 3);
  assert.deepEqual(modelErrors(back), []);
  assert.deepEqual((await health()).statusModel, { state: 'ok' });
  assert.equal(fileSnapshot().sources.status, undefined, 'gone once its recovery is sent');
});

test('a one-cycle failure sends nothing, and /api/health is ok again after it', async () => {
  refreshed();
  await runStatusAndPush([], T0 + 9 * CYCLE); // app back up: its recovery
  const before = sent.length;
  refreshed({ cpu: POISON });
  await runStatusAndPush([], T0 + 10 * CYCLE);
  assert.equal((await health()).statusModel.state, 'degraded');
  assert.equal((await health()).statusModel.failedCycles, 1);
  refreshed();
  await runStatusAndPush([], T0 + 11 * CYCLE);
  await runStatusAndPush([], T0 + 12 * CYCLE);
  assert.deepEqual(sent.slice(before), []);
  assert.deepEqual((await health()).statusModel, { state: 'ok' });
});

test("the error's class is reported, and nothing that isn't a plain name", async () => {
  const thrower = (err) => ({
    toString() {
      throw err;
    },
  });
  refreshed({ cpu: thrower(new TypeError('secret-ish input 42')) });
  await runStatusAndPush([], T0 + 20 * CYCLE);
  assert.equal(getStatusModelHealth().error, 'TypeError');
  const odd = new Error('x');
  odd.name = 'disk at /srv/data 99%';
  refreshed({ cpu: thrower(odd) });
  await runStatusAndPush([], T0 + 21 * CYCLE);
  assert.equal(getStatusModelHealth().error, 'Error');
  assert.equal(getStatusModelHealth().since, new Date(T0 + 20 * CYCLE).toISOString(), 'since the run began');
  refreshed();
  await runStatusAndPush([], T0 + 22 * CYCLE);
  assert.equal(getStatusModelHealth().state, 'ok');
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

test('a restart while the model throws: the count is kept in the push snapshot, so no second push, and one recovery', async () => {
  refreshed();
  await runStatusAndPush([], T0 + 30 * CYCLE);
  const before = sent.length;
  refreshed({ cpu: POISON });
  await runStatusAndPush([], T0 + 31 * CYCLE);
  await runStatusAndPush([], T0 + 32 * CYCLE);
  assert.deepEqual(sent.slice(before), ['source_down status']);

  // JagHelm stops (the shutdown flush) and starts again: a new refresh module
  // reads the snapshot file, with a status model and a health of its own.
  stopBackgroundRefresh();
  const restarted = await import('./refresh.js?restarted');
  assert.equal(restarted.getStatusModelHealth().state, 'starting');
  await restarted.runStatusAndPush([], T0 + 40 * CYCLE);
  await restarted.runStatusAndPush([], T0 + 41 * CYCLE);
  assert.deepEqual(sent.slice(before), ['source_down status'], 'still failing after the restart: nothing new');
  assert.deepEqual(restarted.getStatusModelHealth(), {
    state: 'degraded',
    error: 'Error',
    since: new Date(T0 + 40 * CYCLE).toISOString(),
    failedCycles: 2,
  }, "/api/health counts from the restart's first cycle");
  refreshed();
  await restarted.runStatusAndPush([], T0 + 42 * CYCLE);
  assert.deepEqual(sent.slice(before), ['source_down status', 'source_recovered status']);
  restarted.stopBackgroundRefresh();
});
