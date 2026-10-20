/**
 * #461: a start with no push snapshot (a first run, or a missing or corrupt
 * file) has no baseline to wait for. Its first cycle is diffed from the empty
 * snapshot whatever the sources say (#448), and the snapshot it writes holds
 * each source's state with the rest, so a source failing from the first cycle
 * sends its `source_down` after the usual 2 cycles and one recovery when it
 * answers (#439). What the failed source feeds is unknown in the model and
 * sends nothing (#292); once it answers it is new, so what is in trouble pages
 * once. Everything else pages as on any cycle: a Kuma service going down, a
 * job failing.
 *
 * Through the real model and the real push cycle over a snapshot file
 * (testing/pushPipeline.js), cycle by cycle.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cachesOf, pushPipeline } from '../testing/pushPipeline.js';
import { NOW, UPS_ONLINE, cronNode, cronRun, monitored, node } from '../testing/statusFixtures.js';

const OK = { prometheus: { ok: true }, kuma: { ok: true } };
const UPS_ON_BATTERY = Object.freeze({ ...UPS_ONLINE, status: 2, charge: 80 });
// The UPS query failed (refresh.js: Prometheus threw on it).
const UPS_FAILED = Object.freeze({
  status: null,
  charge: null,
  runtime: null,
  load: null,
  ok: false,
  configured: null,
  model: null,
});

const restic = (status) => [
  cronNode('n1', {
    restic: cronRun(status, 60_000, status === 'failure' ? { error: 'exit 3' } : {}),
  }),
];

/** One cycle's caches. `nodes`: node key -> [metrics, extra]; n1 at its defaults when not given. */
function board({ nodes = {}, cards = [], ups = UPS_ONLINE, cron = [], sources = OK } = {}) {
  const all = { n1: [{}, {}], ...nodes };
  const built = Object.fromEntries(
    Object.entries(all).map(([key, [metrics = {}, extra = {}]]) => [
      key,
      node(metrics, {
        display_name: key.toUpperCase(),
        services: key === 'n1' ? cards : [],
        ...extra,
      }),
    ])
  );
  return cachesOf({ services: { sources, nodes: built }, ups, cron });
}

// The refresh's node batch threw (refresh.js): no node in the payload, and the
// UPS query failed with it. Cron is pushed to JagHelm, so it is still there.
const prometheusDown = ({ cron = [] } = {}) =>
  cachesOf({
    services: { sources: { prometheus: { ok: false }, kuma: { ok: true } }, nodes: {} },
    ups: UPS_FAILED,
    cron,
  });

// Back from the outage: n1 healthy, n2's disk over its crit line, n3
// unreachable, the UPS on battery.
const trouble = (opts = {}) =>
  board({
    nodes: { n2: [{ diskPercent: '97' }], n3: [{}, { reachable: false }] },
    ups: UPS_ON_BATTERY,
    ...opts,
  });
const TROUBLE_PAGES = [
  'host_threshold n2:disk',
  'host_unreachable n3',
  'source_recovered prometheus',
  'ups_on_battery ups',
];

/** Runs `cycles` through `p`; returns what each cycle sent ("type id"). */
async function play(p, cycles) {
  const perCycle = [];
  for (const c of cycles) {
    const before = p.sent.length;
    await p.cycle(c);
    perCycle.push(p.sent.slice(before));
  }
  return perCycle;
}

test('#461: no snapshot and the UPS read failing every cycle: a Kuma service going down pages, and so does a failed job', async () => {
  const p = pushPipeline({ start: NOW });
  try {
    const up = board({
      cards: [monitored('n1:app', 'up')],
      ups: UPS_FAILED,
      cron: restic('success'),
    });
    const down = board({
      cards: [monitored('n1:app', 'down')],
      ups: UPS_FAILED,
      cron: restic('success'),
    });
    const failed = board({
      cards: [monitored('n1:app', 'down')],
      ups: UPS_FAILED,
      cron: restic('failure'),
    });
    const sent = await play(p, [up, up, down, failed, failed, up, up, up, up, up]);
    assert.notEqual(p.snapshot.prev(), null, 'the first cycle wrote a snapshot');
    assert.deepEqual(sent, [
      [],
      // The model reads a failed UPS query as Prometheus failing.
      ['source_down prometheus'],
      ['service_down n1:app'],
      ['cron_failed n1:restic'],
      [],
      ['cron_recovered n1:restic', 'service_recovered n1:app'],
      [],
      [],
      [],
      [],
    ]);
    assert.equal(
      p.events.find((e) => e.type === 'source_down').body,
      'Prometheus · The UPS query failed'
    );
  } finally {
    p.close();
  }
});

test('#461: no snapshot and Prometheus down from the first cycle: one source_down after 2 cycles, one recovery; what is in trouble pages once it is back, nothing re-pages', async () => {
  const p = pushPipeline({ start: NOW });
  try {
    const sent = await play(p, [
      prometheusDown({ cron: restic('success') }),
      prometheusDown({ cron: restic('success') }),
      prometheusDown({ cron: restic('failure') }), // a job failing during the outage
      prometheusDown({ cron: restic('failure') }),
      trouble({ cron: restic('failure') }),
      trouble({ cron: restic('failure') }),
      trouble({ cron: restic('failure') }),
    ]);
    assert.deepEqual(sent, [
      [],
      ['source_down prometheus'],
      ['cron_failed n1:restic'],
      [],
      TROUBLE_PAGES, // no host_recovered for n1
      [],
      [],
    ]);
    const down = p.events.find((e) => e.type === 'source_down');
    assert.deepEqual(
      [down.title, down.severity, down.prev, down.next],
      ['Monitoring source down', 'warning', 'failing', 'down']
    );
  } finally {
    p.close();
  }
});

test('#461: the first snapshot holds the failed source, so its two cycles count from the first', async () => {
  const p = pushPipeline({ start: NOW });
  try {
    await p.cycle(prometheusDown());
    const first = p.snapshot.prev();
    assert.deepEqual(first.sources, { prometheus: 'failing' });
    assert.deepEqual(first.hosts, {}, 'nothing Prometheus feeds');
    assert.deepEqual(first.ups, { state: 'unknown' });
  } finally {
    p.close();
  }
});

test('#461: no snapshot, Prometheus down from boot, and a restart mid-outage on the snapshot that start wrote: no second source_down, one recovery, each open problem once', async () => {
  const p = pushPipeline({ start: NOW });
  try {
    assert.deepEqual(await play(p, [prometheusDown(), prometheusDown()]), [
      [],
      ['source_down prometheus'],
    ]);
    p.restart();
    assert.notEqual(p.snapshot.prev(), null, 'a valid snapshot');
    assert.deepEqual(await play(p, [prometheusDown(), prometheusDown(), trouble(), trouble()]), [
      [],
      [],
      TROUBLE_PAGES,
      [],
    ]);
    p.restart();
    assert.deepEqual(await play(p, [trouble()]), [[]], 'nothing again after another restart');
  } finally {
    p.close();
  }
});

test('#461: no snapshot, one failed cycle, then a restart: the failure counts across it, one source_down', async () => {
  const p = pushPipeline({ start: NOW });
  try {
    assert.deepEqual(await play(p, [prometheusDown()]), [[]]);
    p.restart();
    assert.deepEqual(await play(p, [prometheusDown(), prometheusDown(), trouble()]), [
      ['source_down prometheus'],
      [],
      TROUBLE_PAGES,
    ]);
  } finally {
    p.close();
  }
});
