/**
 * A monitor's outage is one `service_down` and one `service_recovered`,
 * whatever card it lands on (#395).
 *
 * A push key is a card's uid, and a Kuma monitor's key can move: a container
 * takes it, a stopped container holds it only while it is down, or another
 * monitor that remembers the same container drops out. The push snapshot keeps
 * which monitor fed each key, so a monitor's previous state goes with it.
 *
 * These drive the real pipeline from assembleServices on: the snapshot builder
 * reads what the services refresh caches, and the real push cycle diffs,
 * dispatches to a recording channel and persists the snapshot to a file. A service
 * registry stand-in remembers where each monitor last ran, as refresh.js does
 * with `seen`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { assembleServices } from '../refresh.js';
import { pushPipeline as statusPush } from '../testing/pushPipeline.js';
import { liveCaches, NOW } from './fixtures/liveShape.js';

const STALE = NOW - 11 * 60_000; // past JAGHELM_MONITOR_STALE_MS: Kuma stopped checking it (paused)

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

const nextcloud = (status) => [{ id: 1, name: 'Nextcloud', status }];
const tailscale = (status) => [{ id: 1, name: 'Tailscale', status }];
const tailscaleOn = (nodes) => Object.fromEntries(nodes.map((n) => [n, ['tailscale']]));
const TAILSCALE_YAML = { tailscale: { monitor: 'Tailscale' } };
const adguards = (primary, secondary = 'down') => [
  {
    id: 1,
    name: 'Adguard Primary',
    ...(typeof primary === 'string' ? { status: primary } : primary),
  },
  { id: 2, name: 'Adguard Secondary', status: secondary },
];
// Gitea, and Grafana unless it is left out (`null`: deleted, or paused).
const grafana = (status) => [
  { id: 1, name: 'Gitea', status: 'up' },
  ...(status === null ? [] : [{ id: 2, name: 'Grafana', status }]),
];
// The old matcher left both remembering pi2's adguard-sync.
const ADGUARD_SEEN = {
  1: { nodeKey: 'pi2', container: 'adguard-sync' },
  2: { nodeKey: 'pi2', container: 'adguard-sync' },
};

/**
 * The cases of #395. Each has the home lab, its cycles (the first is the
 * baseline), what main sent, and what is sent now: one service_down and one
 * service_recovered per outage, unless `now` says otherwise.
 */
const SCENARIOS = [
  {
    name: 'a: a down monitor that a new container takes, then recovers',
    nodes: ['vm103'],
    cycles: [
      {
        running: { vm103: ['gitea'] },
        monitors: [
          { id: 1, name: 'Gitea', status: 'up' },
          { id: 2, name: 'Grafana', status: 'up' },
        ],
      },
      {
        running: { vm103: ['gitea'] },
        monitors: [
          { id: 1, name: 'Gitea', status: 'up' },
          { id: 2, name: 'Grafana', status: 'down' },
        ],
      },
      // The grafana container appears while the monitor is still down, and takes it.
      {
        running: { vm103: ['gitea', 'grafana'] },
        monitors: [
          { id: 1, name: 'Gitea', status: 'up' },
          { id: 2, name: 'Grafana', status: 'down' },
        ],
      },
      {
        running: { vm103: ['gitea', 'grafana'] },
        monitors: [
          { id: 1, name: 'Gitea', status: 'up' },
          { id: 2, name: 'Grafana', status: 'up' },
        ],
      },
    ],
    main: [
      'service_down vm103:Grafana',
      'service_down vm103:grafana',
      'service_recovered vm103:grafana',
    ],
    sent: ['service_down vm103:Grafana', 'service_recovered vm103:grafana'],
  },
  {
    name: 'b: a different container takes the monitor in the cycle it recovers',
    nodes: ['vm103'],
    cycles: [
      { running: { vm103: ['nextcloud'] }, monitors: nextcloud('up') },
      // nextcloud stops and the monitor goes down: the outage is on its card.
      { stopped: [['nextcloud', 'vm103']], monitors: nextcloud('down') },
      // nextcloud-app comes up healthy and takes the monitor, now up.
      {
        running: { vm103: ['nextcloud-app'] },
        stopped: [['nextcloud', 'vm103']],
        monitors: nextcloud('up'),
      },
      {
        running: { vm103: ['nextcloud-app'] },
        stopped: [['nextcloud', 'vm103']],
        monitors: nextcloud('up'),
      },
    ],
    main: ['service_down vm103:nextcloud'],
    sent: ['service_down vm103:nextcloud', 'service_recovered vm103:nextcloud-app'],
  },
  {
    name: 'c: two monitors remember one container; the earlier one goes Pending and back',
    nodes: ['pi2'],
    seen: ADGUARD_SEEN,
    cycles: [
      { monitors: adguards('up', 'up') },
      { monitors: adguards('up') }, // Adguard Secondary goes down
      { monitors: adguards('unknown') }, // Adguard Primary goes Pending
      { monitors: adguards('up') },
      { monitors: adguards('up', 'up') },
    ],
    main: [
      'service_down pi2:Adguard Secondary',
      'service_down pi2:adguard-sync',
      'service_down pi2:Adguard Secondary',
      'service_recovered pi2:adguard-sync',
      'service_recovered pi2:Adguard Secondary',
    ],
    sent: ['service_down pi2:Adguard Secondary', 'service_recovered pi2:Adguard Secondary'],
  },
  {
    name: 'c: two monitors remember one container; the earlier one is paused and unpaused',
    nodes: ['pi2'],
    seen: ADGUARD_SEEN,
    cycles: [
      { monitors: adguards('up', 'up') },
      { monitors: adguards('up') },
      { monitors: adguards({ status: 'up', lastBeatAt: STALE }) }, // paused: its heartbeat goes stale
      { monitors: adguards('up') },
      { monitors: adguards('up', 'up') },
    ],
    main: [
      'service_down pi2:Adguard Secondary',
      'service_down pi2:adguard-sync',
      'service_down pi2:Adguard Secondary',
      'service_recovered pi2:adguard-sync',
      'service_recovered pi2:Adguard Secondary',
    ],
    sent: ['service_down pi2:Adguard Secondary', 'service_recovered pi2:Adguard Secondary'],
  },
  {
    name: 'c: two monitors remember one container; a container claims the earlier one',
    nodes: ['pi2'],
    seen: ADGUARD_SEEN,
    cycles: [
      { monitors: adguards('up', 'up') },
      { monitors: adguards('up') },
      { running: { pi2: ['adguard-primary'] }, monitors: adguards('up') },
      { running: { pi2: ['adguard-primary'] }, monitors: adguards('up', 'up') },
    ],
    main: [
      'service_down pi2:Adguard Secondary',
      'service_down pi2:adguard-sync',
      'service_recovered pi2:adguard-sync',
    ],
    sent: ['service_down pi2:Adguard Secondary', 'service_recovered pi2:adguard-sync'],
  },
  {
    // The container registry has one record per container name, with the last
    // node in the pass (pi2), and the service registry the node of the running
    // card that had the monitor (vm103). The stopped container that gets the
    // down monitor is the one it last ran as, so its red card is drawn on vm103,
    // where the up entry is too. Main drew it on pi2.
    name: 'the replica corner: both copies of an unpinned replica stop',
    nodes: ['vm103', 'pi2'],
    cycles: [
      {
        running: { vm103: ['vaultwarden'], pi2: ['vaultwarden'] },
        monitors: [{ id: 1, name: 'Vaultwarden', status: 'up' }],
      },
      {
        stopped: [['vaultwarden', 'pi2']],
        monitors: [{ id: 1, name: 'Vaultwarden', status: 'down' }],
      },
      {
        stopped: [['vaultwarden', 'pi2']],
        monitors: [{ id: 1, name: 'Vaultwarden', status: 'up' }],
      },
      {
        stopped: [['vaultwarden', 'pi2']],
        monitors: [{ id: 1, name: 'Vaultwarden', status: 'up' }],
      },
    ],
    main: ['service_down pi2:vaultwarden'],
    sent: ['service_down vm103:vaultwarden', 'service_recovered vm103:vaultwarden'],
  },
  {
    // Kuma's /metrics, the live source, leaves a deleted monitor out.
    name: 'a running card whose monitor is deleted while down',
    now: 'no false service_recovered',
    nodes: ['vm103'],
    cycles: [
      { running: { vm103: ['gitea', 'grafana'] }, monitors: grafana('up') },
      { running: { vm103: ['gitea', 'grafana'] }, monitors: grafana('down') },
      { running: { vm103: ['gitea', 'grafana'] }, monitors: grafana(null) },
      { running: { vm103: ['gitea', 'grafana'] }, monitors: grafana(null) },
    ],
    main: ['service_down vm103:grafana', 'service_recovered vm103:grafana'],
    sent: ['service_down vm103:grafana'],
  },
  {
    // /metrics leaves a paused monitor out too, until it is unpaused.
    name: 'a running card whose monitor is paused while down, then unpaused up',
    now: 'no false service_recovered',
    nodes: ['vm103'],
    cycles: [
      { running: { vm103: ['gitea', 'grafana'] }, monitors: grafana('up') },
      { running: { vm103: ['gitea', 'grafana'] }, monitors: grafana('down') },
      { running: { vm103: ['gitea', 'grafana'] }, monitors: grafana(null) },
      { running: { vm103: ['gitea', 'grafana'] }, monitors: grafana('up') },
    ],
    main: ['service_down vm103:grafana', 'service_recovered vm103:grafana'],
    sent: ['service_down vm103:grafana'],
  },
  // #407: a monitor services.yaml maps to a container that runs on several
  // nodes is one outage, so one push each way, whichever of its cards come
  // and go during it. tailscale runs on pi2 and vm103.
  {
    issue: '#407',
    name: "a monitor on two nodes goes down, pi2's container stops, the monitor recovers",
    nodes: ['vm103', 'pi2'],
    cycles: [
      {
        running: tailscaleOn(['vm103', 'pi2']),
        services: TAILSCALE_YAML,
        monitors: tailscale('up'),
      },
      {
        running: tailscaleOn(['vm103', 'pi2']),
        services: TAILSCALE_YAML,
        monitors: tailscale('down'),
      },
      { running: tailscaleOn(['vm103']), services: TAILSCALE_YAML, monitors: tailscale('down') },
      { running: tailscaleOn(['vm103']), services: TAILSCALE_YAML, monitors: tailscale('up') },
    ],
    // #407's table: pi2 never recovers.
    main: [
      'service_down pi2:tailscale',
      'service_down vm103:tailscale',
      'service_recovered vm103:tailscale',
    ],
    sent: ['service_down pi2:tailscale', 'service_recovered vm103:tailscale'],
  },
  {
    issue: '#407',
    name: "as above, but pi2's container returns before the recovery",
    nodes: ['vm103', 'pi2'],
    cycles: [
      {
        running: tailscaleOn(['vm103', 'pi2']),
        services: TAILSCALE_YAML,
        monitors: tailscale('up'),
      },
      {
        running: tailscaleOn(['vm103', 'pi2']),
        services: TAILSCALE_YAML,
        monitors: tailscale('down'),
      },
      { running: tailscaleOn(['vm103']), services: TAILSCALE_YAML, monitors: tailscale('down') },
      {
        running: tailscaleOn(['vm103', 'pi2']),
        services: TAILSCALE_YAML,
        monitors: tailscale('down'),
      },
      {
        running: tailscaleOn(['vm103', 'pi2']),
        services: TAILSCALE_YAML,
        monitors: tailscale('up'),
      },
    ],
    // #407's table: a repeat service_down for pi2.
    main: [
      'service_down pi2:tailscale',
      'service_down vm103:tailscale',
      'service_down pi2:tailscale',
      'service_recovered pi2:tailscale',
      'service_recovered vm103:tailscale',
    ],
    sent: ['service_down pi2:tailscale', 'service_recovered pi2:tailscale'],
  },
];

// The first cycle has no snapshot, so every entity is new (#448): the board's
// failed cron job (fixtures/liveShape.js) pages there once. These scenarios
// are about services: play checks it and leaves it out.
const FIRST = 'cron_failed nas:b2-sync';

/** Run a scenario's cycles through the push pipeline; returns what was sent (but FIRST) and the last snapshot file. */
async function play(scenario, { restartEachCycle = false, order } = {}) {
  const cycle = homelab(scenario.nodes, scenario.seen);
  const pipeline = pushPipeline();
  try {
    for (const input of scenario.cycles) {
      if (restartEachCycle) pipeline.restart();
      await pipeline.push(cycle({ ...input, order }));
    }
    assert.equal(pipeline.sent.filter((s) => s === FIRST).length, 1, `${FIRST} once`);
    return {
      sent: pipeline.sent.filter((s) => s !== FIRST),
      file: readFileSync(pipeline.path, 'utf8'),
    };
  } finally {
    pipeline.close();
  }
}

for (const scenario of SCENARIOS) {
  test(`push (${scenario.issue ?? '#395'}) ${scenario.name}: ${scenario.now ?? 'one service_down, one service_recovered'}`, async () => {
    const { sent } = await play(scenario);
    assert.notDeepEqual(scenario.main, scenario.sent, 'the case is one main gets wrong');
    assert.deepEqual(sent, scenario.sent);
  });
}

test('push (#395): the monitor a key was fed by survives a restart before every cycle', async () => {
  for (const scenario of SCENARIOS) {
    const { sent } = await play(scenario, { restartEachCycle: true });
    assert.deepEqual(sent, scenario.sent, scenario.name);
  }
});

// A small seeded PRNG (mulberry32), so a failing order can be replayed.
function shuffler(seed) {
  let s = seed >>> 0;
  const random = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return (list) => {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
}

// Kuma's monitors are shuffled as a list: an object keyed by Kuma's integer ids
// iterates in id order whatever order it was built in, and every consumer takes
// a list as well. Each node's containers and the stopped containers are
// shuffled too, as discovery and the container registry might return them.
test("push (#395): what is sent, and the snapshot written, do not depend on Kuma's or discovery's order", async () => {
  for (const scenario of SCENARIOS) {
    const want = await play(scenario);
    for (const reversed of [true, false]) {
      for (let seed = 1; seed <= 12; seed += 1) {
        const order =
          reversed && seed === 1
            ? (list) => [...list].reverse()
            : shuffler(seed * 7919 + (reversed ? 1 : 0));
        const got = await play(scenario, { order });
        assert.deepEqual(got.sent, want.sent, `${scenario.name}, seed ${seed}`);
        assert.equal(got.file, want.file, `${scenario.name}, seed ${seed}: the snapshot file`);
      }
    }
  }
});
