/**
 * Container events in the loop's status step (refresh.js refreshContainerEvents,
 * #764): the read is put where the model reads it, so a restart loop reaches
 * /api/status and push; it runs at most once a minute; and a read that throws
 * never stops the status step.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-events-step-'));
process.env.JAGHELM_DATA_DIR = dataDir;
const { saveConfig } = await import('./config.js');
const { getCached, setCache } = await import('./cache.js');
const { initDiscovery } = await import('./discovery.js');
const { containerEventsFeed, getStatusModelHealth, runStatusAndPush, settleContainerEvents, stopBackgroundRefresh } =
  await import('./refresh.js');
const { card, node } = await import('./testing/statusFixtures.js');

saveConfig({ nodes: { n1: { display_name: 'n1' } }, services: {} });
initDiscovery('http://prometheus.invalid:9090');

after(() => {
  stopBackgroundRefresh();
  rmSync(dataDir, { recursive: true, force: true });
});

const realRead = containerEventsFeed.read;
const T0 = Date.now() + 10 * 60_000; // far from any other test's clock
const MIN = 60_000;

function board() {
  setCache('services', {
    nodes: { n1: node({}, { display_name: 'n1', services: [card('n1:web')] }) },
    overallHealth: 'up',
    sources: { prometheus: { ok: true }, kuma: { ok: true } },
  });
}
const loop = (now) => ({
  state: 'ok',
  events: Array.from({ length: 4 }, (_, i) => ({ time: now - (i + 1) * 5 * MIN, kind: 'restart', node: 'n1', name: 'web' })),
  blindNodes: [],
  oomCounter: true,
});

test('the cycle puts the event read where the model reads it, and the restart loop is an issue', async () => {
  board();
  let reads = 0;
  containerEventsFeed.read = async (now) => {
    reads += 1;
    return loop(now);
  };
  try {
    await runStatusAndPush([], T0);
    await settleContainerEvents();
    await runStatusAndPush([], T0 + 30_000); // the read lands for this cycle's status
    assert.equal(reads, 1, 'at most one read a minute');
    assert.equal(getCached('containerEvents').state, 'ok');
    const issue = getCached('status').issues.find((i) => i.condition === 'restart_loop');
    assert.equal(issue?.id, 'containers/n1:web:restart_loop');
    await runStatusAndPush([], T0 + 61_000);
    await settleContainerEvents();
    assert.equal(reads, 2, 'and one a minute on');
  } finally {
    containerEventsFeed.read = realRead;
  }
});

test('a read that throws leaves the last result, and the status step still builds', async () => {
  board();
  const last = getCached('containerEvents');
  containerEventsFeed.read = async () => {
    throw new Error('boom');
  };
  try {
    await runStatusAndPush([], T0 + 5 * MIN);
    await settleContainerEvents();
    await runStatusAndPush([], T0 + 5 * MIN + 30_000);
  } finally {
    containerEventsFeed.read = realRead;
  }
  assert.deepEqual(getCached('containerEvents'), last);
  assert.deepEqual(getStatusModelHealth(), { state: 'ok' });
});
