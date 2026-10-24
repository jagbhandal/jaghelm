/**
 * #469 through the loop's own wiring (refresh.js runStatusAndPush): the status
 * model is seeded, at boot, with when each hold in the push snapshot file
 * began, and push copies the starts the model serves. So a reading held since
 * before the restart ends 24 h after its hold began, on the board and in the
 * file on the same cycle, and nothing is sent.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-held-expiry-'));
process.env.JAGHELM_DATA_DIR = dataDir;

const DAY = 24 * 60 * 60 * 1000;
const BEGAN = 1_782_345_600_000;
const snapshotFile = join(dataDir, 'push-snapshot.json');
// What push persisted before the restart: h's temperature held at warn since BEGAN.
writeFileSync(
  snapshotFile,
  JSON.stringify({
    services: {},
    monitorOf: {},
    hosts: {
      h: {
        reachable: true,
        levels: { cpu: 'ok', disk: 'ok', mem: 'ok', temp: 'warn' },
        heldSince: { temp: BEGAN },
      },
    },
    ups: { state: 'online' },
    cron: {},
    sources: { nut: 'ok', prometheus: 'ok' },
  })
);

const { webPhone } = await import('./testing/webPhone.js');
const { getCached, setCache } = await import('./cache.js');
const { getPushStore } = await import('./push/store.js');
const { runStatusAndPush: statusAndPushCycle, pushSender, stopBackgroundRefresh } = await import('./refresh.js');
/** One status-and-push cycle, as the loop runs it, and the pushes it queued sent (#579). */
const runStatusAndPush = async (...args) => {
  await statusAndPushCycle(...args);
  await pushSender.idle();
};
const { UPS_ONLINE, node } = await import('./testing/statusFixtures.js');

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

/** What the refreshes cache in one cycle: node h with its temperature at `celsius` (null: none). */
function refreshed(celsius) {
  setCache(
    'services',
    {
      nodes: { h: node({ temp: celsius === null ? null : String(celsius) }) },
      overallHealth: 'up',
      sources: { prometheus: { ok: true }, kuma: { ok: true } },
    },
    { upWithoutCard: [], monitorOf: {} }
  );
  setCache('ups', { ...UPS_ONLINE });
}

const h = () => getCached('status').entities.find((e) => e.id === 'nodes/h');
const filed = () => JSON.parse(readFileSync(snapshotFile, 'utf8')).hosts.h;

test('#469: the loop seeds the model with when each hold began, and push copies the model: both forget the reading at 24 h, sending nothing; back hot, one page', async () => {
  refreshed(null);
  await runStatusAndPush([], BEGAN + DAY - 30_000);
  assert.deepEqual([h().state, h().conditions.temp], ['warn', 'unknown'], 'held from the file');
  // The start the model serves is the file's, not this cycle's: the seed carried it.
  assert.deepEqual(h().heldSince, { temp: BEGAN });

  await runStatusAndPush([], BEGAN + DAY);
  assert.deepEqual([h().state, h().reason], ['ok', 'Healthy']);
  assert.equal(Object.hasOwn(filed().levels, 'temp'), false);
  assert.equal(filed().heldSince, undefined);
  assert.deepEqual(sent, [], 'no clear: nothing was read');

  refreshed(80);
  await runStatusAndPush([], BEGAN + DAY + 30_000);
  assert.deepEqual(sent, ['host_threshold h:temp']);
});
