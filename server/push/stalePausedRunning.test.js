/**
 * A running container whose Kuma monitor was paused while down (#488): the
 * status-page fallback still lists it as down with a stale heartbeat. Kuma has
 * stopped checking it, so it says nothing about the container: no card goes
 * red and no service_down is sent. A monitor that is still checked and down
 * pages as before.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assembleServices } from '../refresh.js';
import { pushPipeline as statusPush } from '../testing/pushPipeline.js';
import { liveCaches, NOW } from './fixtures/liveShape.js';

const STALE = NOW - 11 * 60_000; // past JAGHELM_MONITOR_STALE_MS: Kuma stopped checking it (paused)
const FIRST = 'cron_failed nas:b2-sync'; // the board's failed cron job pages on the first cycle (#448)

/**
 * A home lab whose nodes are `nodeOrder`, in board order. `seen` seeds the
 * service registry: monitor id -> { nodeKey, container }.
 *
 * Each cycle takes `monitors` (Kuma's: id, name, status, and anything else a
 * monitor carries), `running` (node -> container names), `stopped` (the
 * container registry's missing containers: [name, lastSeenNode]) and
 * `services` (services.yaml). `order` reorders every list the way Kuma or
 * discovery might hand it over.
 */
function homelab(nodeOrder, seen = {}) {
  const registry = new Map(Object.entries(seen));
  return ({ monitors, running = {}, stopped = [], services = {}, order = (list) => list }) => {
    const r = assembleServices({
      nodeResults: nodeOrder.map((nodeKey) => [
        nodeKey,
        { display_name: nodeKey },
        {
          metrics: { cpu: '10', memPercent: '20', diskPercent: '30' },
          reachable: true,
          failedReads: [],
          containers: order(
            (running[nodeKey] || []).map((container) => ({
              container,
              status: 'running',
              docker: {},
            }))
          ),
        },
      ]),
      monitors: order(
        monitors.map((m) => ({ ping: 1, uptime24: 1, active: true, lastBeatAt: null, ...m }))
      ),
      config: { nodes: Object.fromEntries(nodeOrder.map((k) => [k, {}])), services },
      lastSeenNodeOf: (id) => registry.get(String(id))?.nodeKey ?? null,
      lastSeenContainerOf: (id) => registry.get(String(id))?.container ?? null,
      containerRegistry: {
        recordSeen() {},
        getMissing: () =>
          order(
            stopped.map(([container, lastSeenNode]) => ({
              container,
              lastSeenNode,
              lastSeenAt: NOW - 120_000,
              ageMs: 120_000,
            }))
          ),
      },
      now: () => NOW,
    });
    for (const s of r.seen)
      registry.set(String(s.monitorId), { nodeKey: s.nodeKey, container: s.container });
    return r;
  };
}

/**
 * The push side: the status model and the real push cycle over a snapshot file
 * (testing/pushPipeline.js). `restart` before a cycle stops and starts
 * JagHelm: the snapshot is flushed and read back from the file, and the model
 * starts again from the levels it holds.
 */
function pushPipeline() {
  const p = statusPush();
  return {
    sent: p.sent,
    events: p.events,
    path: p.path,
    push: (r) => p.cycle(liveCaches(r)),
    restart: () => p.restart(),
    close: () => p.close(),
  };
}


const grafana = (extra) => [{ id: 1, name: 'Grafana', status: 'down', ...extra }];
const RUNNING = { vm103: ['grafana'] };

async function play(cycles) {
  const cycle = homelab(['vm103']);
  const p = pushPipeline();
  const cards = [];
  try {
    for (const input of cycles) {
      const r = cycle({ running: RUNNING, ...input });
      cards.push(r.nodes.vm103.services.find((s) => s.container === 'grafana'));
      await p.push(r);
    }
    return { sent: p.sent.filter((s) => s !== FIRST), cards };
  } finally {
    p.close();
  }
}

test('#488: a running container whose monitor is paused while down is not crit and does not page', async () => {
  const { sent, cards } = await play([
    { monitors: grafana({ status: 'up' }) },
    { monitors: grafana({ lastBeatAt: STALE }) },
    { monitors: grafana({ active: false, lastBeatAt: STALE }) },
  ]);
  assert.deepEqual(sent, []);
  assert.equal(cards[1].status, 'up');
  assert.equal(cards[1].monitored, false);
  assert.equal(cards[2].status, 'up');
});

test('#488: a monitor paused while down at the first cycle (a restart) does not page', async () => {
  const { sent } = await play([{ monitors: grafana({ lastBeatAt: STALE }) }]);
  assert.deepEqual(sent, []);
});

test('#488: when the paused monitor resumes up, no recovery is sent for an outage never paged', async () => {
  const { sent } = await play([
    { monitors: grafana({ status: 'up' }) },
    { monitors: grafana({ lastBeatAt: STALE }) },
    { monitors: grafana({ status: 'up' }) },
  ]);
  assert.deepEqual(sent, []);
});

test('#488: a fresh down monitor on a running container still pages, once, and recovers', async () => {
  const { sent, cards } = await play([
    { monitors: grafana({ status: 'up' }) },
    { monitors: grafana({ lastBeatAt: NOW - 30_000 }) },
    { monitors: grafana({ status: 'up' }) },
  ]);
  assert.equal(cards[1].status, 'down');
  assert.equal(cards[1].monitored, true);
  assert.deepEqual(sent, ['service_down vm103:grafana', 'service_recovered vm103:grafana']);
});
