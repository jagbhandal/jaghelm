/**
 * A failed monitoring source is one push (#292, spec §6): "Prometheus down"
 * once, not a host_unreachable per host, a service_down per container card or
 * an ups_on_battery, and "Prometheus recovered" once when it is back. The
 * entities it feeds are unknown in the status model, and an unknown entity
 * holds its last known state in the push snapshot, so it sends nothing.
 *
 * The homelab-shaped board (fixtures/liveShape.js: 4 nodes, 26 monitors, 50
 * odd containers, a UPS and two cron jobs) runs through the real
 * assembleServices, the status model and the real push cycle
 * (testing/pushPipeline.js), one cycle at a time.
 *
 * Each run starts with no push snapshot, so its first cycle diffs every
 * entity from no previous state (#448): the board's one open problem, the
 * failed nas:b2-sync job, pages there once. `play` checks that and leaves it
 * out of what each test compares.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assembleServices } from '../refresh.js';
import { pushPipeline } from '../testing/pushPipeline.js';
import { NOW, liveCaches, liveCycle } from './fixtures/liveShape.js';

const UPS = {
  status: 1,
  charge: 100,
  runtime: 3600,
  load: 20,
  ok: true,
  configured: true,
  model: 'Back-UPS',
};

/** The caches after one refresh that assembled `r`, with the sources' flags and errors. */
function caches(r, { prometheusOk = true, kumaOk = true, ups = UPS, sourceErrors = {} } = {}) {
  const live = liveCaches(r);
  const services = {
    ...live.getCached('services'),
    sources: { prometheus: { ok: prometheusOk }, kuma: { ok: kumaOk } },
  };
  const internal = { ...live.getCachedInternal('services'), sourceErrors };
  return {
    getCached: (key) => ({ services, ups })[key] ?? null,
    getCachedInternal: (key) => (key === 'services' ? internal : null),
    getAllCronStatuses: live.getAllCronStatuses,
  };
}

// The refresh's node batch threw: no node in the payload, nothing placed, and
// the UPS query failed with it.
function prometheusDown() {
  const r = assembleServices({
    nodeResults: [],
    monitors: [],
    config: { nodes: {}, services: {} },
    lastSeenNodeOf: () => null,
    containerRegistry: null,
    now: () => NOW,
    presenceKnown: false,
  });
  return caches(r, {
    prometheusOk: false,
    ups: {
      status: null,
      charge: null,
      runtime: null,
      load: null,
      ok: false,
      configured: null,
      model: null,
    },
    sourceErrors: { prometheus: 'Prometheus query failed: fetch failed' },
  });
}

// What the first cycle of a run on the board sends: its open problem, once (#448).
const FIRST = 'cron_failed nas:b2-sync';

/**
 * Runs `cycles` (caches, one a cycle) through push; returns what each cycle
 * sent, and the events, but for the first cycle's FIRST.
 */
async function play(cycles) {
  const p = pushPipeline({ env: { KUMA_URL: 'http://kuma' } });
  try {
    const perCycle = [];
    for (const c of cycles) {
      const before = p.sent.length;
      await p.cycle(c);
      perCycle.push(p.sent.slice(before));
    }
    assert.ok(perCycle[0].includes(FIRST), `the first cycle pages ${FIRST}`);
    perCycle[0] = perCycle[0].filter((s) => s !== FIRST);
    return { perCycle, events: p.events.filter((e) => `${e.type} ${e.id}` !== FIRST) };
  } finally {
    p.close();
  }
}

test('Prometheus down: exactly one push event, after its second failed cycle; its recovery exactly one', async () => {
  const healthy = caches(liveCycle());
  const { perCycle, events } = await play([
    healthy,
    prometheusDown(),
    prometheusDown(),
    prometheusDown(),
    healthy,
    healthy,
  ]);
  assert.deepEqual(perCycle, [
    [],
    [],
    ['source_down prometheus'],
    [],
    ['source_recovered prometheus'],
    [],
  ]);
  const [down, back] = events;
  assert.deepEqual(
    [down.title, down.body, down.severity],
    ['Monitoring source down', 'Prometheus · Prometheus query failed: fetch failed', 'warning']
  );
  assert.deepEqual(
    [back.title, back.body, back.severity],
    ['Monitoring source recovered', 'Prometheus is answering again', 'info']
  );
});

test('Prometheus failing for one cycle (a blip) sends nothing at all', async () => {
  const healthy = caches(liveCycle());
  const { perCycle } = await play([healthy, prometheusDown(), healthy, healthy]);
  assert.deepEqual(perCycle.flat(), []);
});

test('Prometheus down: what it feeds sends nothing, even what changed while it was down', async () => {
  const healthy = caches(liveCycle());
  // While it is down the UPS went on battery and a node went unreachable;
  // nothing can be known about them until it answers.
  const back = liveCycle();
  back.nodes.pi1 = { ...back.nodes.pi1, reachable: false };
  const { perCycle } = await play([
    healthy,
    prometheusDown(),
    prometheusDown(),
    caches(back, { ups: { ...UPS, status: 2 } }),
  ]);
  assert.deepEqual(perCycle, [
    [],
    [],
    ['source_down prometheus'],
    // Once it answers, what changed is sent, against the last known state.
    ['host_unreachable pi1', 'source_recovered prometheus', 'ups_on_battery ups'],
  ]);
});

test('Kuma down: exactly one push event, none for the services it feeds; its recovery exactly one', async () => {
  const healthy = caches(liveCycle({ status: { 'NAS UI': 'down' } }));
  const kumaDown = caches(
    liveCycle({
      status: Object.fromEntries(['Gitea', 'Immich', 'NAS UI'].map((n) => [n, 'down'])),
    }),
    {
      kumaOk: false,
      sourceErrors: { kuma: 'Kuma unreachable: fetch failed' },
    }
  );
  const { perCycle, events } = await play([healthy, kumaDown, kumaDown, kumaDown, healthy]);
  assert.deepEqual(perCycle, [
    ['service_down vm103:NAS UI'], // down on the first cycle, which has no snapshot (#448)
    [],
    ['source_down kuma'],
    [],
    ['source_recovered kuma'],
  ]);
  assert.equal(
    events.find((e) => e.type === 'source_down').body,
    'Kuma · Kuma unreachable: fetch failed'
  );
});

test('NUT quiet: exactly one push event, none for the UPS; its recovery exactly one', async () => {
  const healthy = caches(liveCycle());
  const quiet = caches(liveCycle(), { ups: { ...UPS, status: null, charge: null } });
  const { perCycle, events } = await play([healthy, quiet, quiet, quiet, healthy]);
  assert.deepEqual(perCycle, [[], [], ['source_down nut'], [], ['source_recovered nut']]);
  assert.equal(events[0].body, 'NUT · No reading from the NUT exporter');
});

test('two sources down at once: one push each', async () => {
  const healthy = caches(liveCycle());
  const both = caches(liveCycle(), { kumaOk: false, ups: { ...UPS, status: null, charge: null } });
  const { perCycle } = await play([healthy, both, both, healthy]);
  assert.deepEqual(perCycle, [
    [],
    [],
    ['source_down kuma', 'source_down nut'],
    ['source_recovered kuma', 'source_recovered nut'],
  ]);
});

test('a restart during an outage keeps it: no second source_down, and one recovery', async () => {
  const healthy = caches(liveCycle());
  const p = pushPipeline({ env: { KUMA_URL: 'http://kuma' } });
  try {
    for (const c of [healthy, prometheusDown(), prometheusDown()]) await p.cycle(c);
    assert.deepEqual(p.sent, [FIRST, 'source_down prometheus']);
    p.restart();
    await p.cycle(prometheusDown());
    await p.cycle(prometheusDown());
    assert.deepEqual(
      p.sent,
      [FIRST, 'source_down prometheus'],
      'still down after the restart: nothing new'
    );
    await p.cycle(healthy);
    assert.deepEqual(p.sent, [FIRST, 'source_down prometheus', 'source_recovered prometheus']);
  } finally {
    p.close();
  }
});
