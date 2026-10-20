/**
 * #448: an entity push has no previous state for is diffed from "no previous
 * state". It pages once if it appears at warn or crit, and sends nothing if it
 * appears ok: no stray "Host recovered" for a node just added, and no silence
 * for one that appears already in trouble. The UPS holds its last known state
 * through `unknown`, so an exporter blip mid-outage neither pages again nor
 * sends a false "back on mains", while a UPS with no known state that goes on
 * battery pages.
 *
 * Every kind the differ handles, through the real model and the real push
 * cycle over a snapshot file (testing/pushPipeline.js), cycle by cycle: nodes
 * (reachability and each reading), services, the UPS, jobs and backups. Then
 * the edges: a restart with a valid snapshot, a restart with a missing or
 * corrupt one (every entity is new), and a source down the first cycle an
 * entity is seen.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';

import { cachesOf, pushPipeline } from '../testing/pushPipeline.js';
import { NOW, UPS_ONLINE, cronNode, cronRun, monitored, node } from '../testing/statusFixtures.js';

const OK = { prometheus: { ok: true }, kuma: { ok: true } };
const UPS_ON_BATTERY = Object.freeze({ ...UPS_ONLINE, status: 2, charge: 80 });
const UPS_LOW_BATTERY = Object.freeze({ ...UPS_ONLINE, status: 3, charge: 9 });
// The NUT exporter is quiet: Prometheus answers, with no nut_status.
const UPS_QUIET = Object.freeze({ ...UPS_ONLINE, status: null, charge: null });
// The UPS query failed with Prometheus.
const UPS_FAILED = Object.freeze({
  status: null,
  charge: null,
  runtime: null,
  load: null,
  ok: false,
  configured: null,
  model: null,
});

/**
 * One cycle's caches. `nodes`: node key -> [metrics, extra] (node() fills the
 * rest); n1 at its defaults when not given. `cards` go on n1.
 */
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
  return cachesOf({
    services: { sources, nodes: built },
    ups,
    cron,
  });
}

// The refresh's node batch threw (refresh.js): no node in the payload, and the
// UPS query failed with it.
const prometheusDown = () =>
  cachesOf({
    services: { sources: { prometheus: { ok: false }, kuma: { ok: true } }, nodes: {} },
    ups: UPS_FAILED,
  });

const STATE_OF_SEVERITY = { critical: 'crit', warning: 'warn', info: 'ok' };

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

/** A pipeline that has run `cycles` (its snapshot file holds their state). */
async function after(cycles) {
  const p = pushPipeline({ start: NOW });
  for (const c of cycles) await p.cycle(c);
  p.sent.length = 0;
  p.events.length = 0;
  return p;
}

/**
 * Each host event against the model: its severity says the state the model
 * gives what it is about (the reading's condition for a threshold push, the
 * node's state for reachability).
 */
function hostSeverities(p) {
  const out = [];
  for (const e of p.events.filter((x) => x.type.startsWith('host_'))) {
    const entity = p.status.entities.find((x) => x.id === `nodes/${e.node}`);
    const reading = e.type.startsWith('host_threshold') ? e.id.slice(e.node.length + 1) : null;
    const model = reading ? entity?.conditions?.[reading] : entity?.state;
    out.push(`${e.type} ${e.id}: push ${STATE_OF_SEVERITY[e.severity]}, model ${model}`);
  }
  return out;
}

// ── Nodes ────────────────────────────────────────────────────────────────

test('#448: a node new to the snapshot at ok sends nothing (no stray "Host recovered")', async () => {
  const p = await after([board(), board()]);
  try {
    const sent = await play(p, [board({ nodes: { n2: [] } }), board({ nodes: { n2: [] } })]);
    assert.deepEqual(sent, [[], []]);
  } finally {
    p.close();
  }
});

test("#448: a node new to the snapshot over its line pages once per reading, at the model's severity", async () => {
  const p = await after([board(), board()]);
  try {
    const hot = board({ nodes: { n2: [{ diskPercent: '96', memPercent: '92', temp: '80' }] } });
    const sent = await play(p, [hot, hot, hot]);
    assert.deepEqual(sent, [
      ['host_threshold n2:disk', 'host_threshold n2:mem', 'host_threshold n2:temp'],
      [],
      [],
    ]);
    assert.deepEqual(hostSeverities(p), [
      'host_threshold n2:disk: push crit, model crit',
      'host_threshold n2:mem: push warn, model warn',
      'host_threshold n2:temp: push warn, model warn',
    ]);
    // The episode ends as any other does.
    const cool = board({ nodes: { n2: [{ diskPercent: '50', memPercent: '40', temp: '45' }] } });
    assert.deepEqual(await play(p, [cool]), [
      [
        'host_threshold_cleared n2:disk',
        'host_threshold_cleared n2:mem',
        'host_threshold_cleared n2:temp',
      ],
    ]);
  } finally {
    p.close();
  }
});

test('#448: a node new to the snapshot with CPU over its line pages once the model warns (its 2nd cycle)', async () => {
  const p = await after([board()]);
  try {
    const busy = board({ nodes: { n2: [{ cpu: '97' }] } });
    assert.deepEqual(await play(p, [busy, busy, busy]), [[], ['host_threshold n2:cpu'], []]);
  } finally {
    p.close();
  }
});

test('#448: a node new to the snapshot that is unreachable pages host_unreachable once, at critical', async () => {
  const p = await after([board()]);
  try {
    const gone = board({ nodes: { n2: [{}, { reachable: false }] } });
    assert.deepEqual(await play(p, [gone, gone, gone]), [['host_unreachable n2'], [], []]);
    assert.deepEqual(hostSeverities(p), ['host_unreachable n2: push crit, model crit']);
    // It was paged as down, so coming back is its recovery.
    assert.deepEqual(await play(p, [board({ nodes: { n2: [] } })]), [['host_recovered n2']]);
  } finally {
    p.close();
  }
});

test('#448: a node new to the snapshot with no signal (its up read failed) sends nothing; once read, it is diffed from nothing', async () => {
  const p = await after([board()]);
  try {
    const quiet = board({ nodes: { n2: [{}, { failedReads: ['reachable'] }] } });
    assert.deepEqual(await play(p, [quiet, quiet]), [[], []]);
    assert.equal(p.status.entities.find((e) => e.id === 'nodes/n2').state, 'unknown');
    const full = board({ nodes: { n2: [{ diskPercent: '97' }] } });
    assert.deepEqual(await play(p, [full, full]), [['host_threshold n2:disk'], []]);
  } finally {
    p.close();
  }
});

test('#448: a node new to the snapshot whose exporter is quiet (no up series, no metric) is crit in the model, so it pages once', async () => {
  const p = await after([board()]);
  try {
    const quiet = board({ nodes: { n2: [{}, { reachable: null, metrics: {} }] } });
    assert.deepEqual(await play(p, [quiet, quiet]), [['host_unreachable n2'], []]);
    const entity = p.status.entities.find((e) => e.id === 'nodes/n2');
    assert.deepEqual(
      [entity.state, entity.reason],
      ['crit', 'Unreachable: no metrics from Prometheus'],
      'the screen shows it crit too'
    );
  } finally {
    p.close();
  }
});

test('#448: a reading new to a known node pages if it appears over its line, and is quiet if it appears ok', async () => {
  // n1 has no temperature sensor at first; then one answers.
  const p = await after([board({ nodes: { n1: [{ temp: null }] } })]);
  try {
    assert.deepEqual(await play(p, [board({ nodes: { n1: [{ temp: '88' }] } })]), [
      ['host_threshold n1:temp'],
    ]);
    assert.deepEqual(hostSeverities(p), ['host_threshold n1:temp: push crit, model crit']);
    const q = await after([board({ nodes: { n1: [{ temp: null }] } })]);
    try {
      assert.deepEqual(await play(q, [board()]), [[]]);
    } finally {
      q.close();
    }
  } finally {
    p.close();
  }
});

test('#448: a node first seen unreachable that comes back over its line pages the reading too', async () => {
  const p = await after([board()]);
  try {
    const sent = await play(p, [
      board({ nodes: { n2: [{}, { reachable: false }] } }),
      board({ nodes: { n2: [{ diskPercent: '93' }] } }),
    ]);
    assert.deepEqual(sent, [
      ['host_unreachable n2'],
      ['host_recovered n2', 'host_threshold n2:disk'],
    ]);
  } finally {
    p.close();
  }
});

// ── Services, jobs and backups: they already behaved ─────────────────────

test('#448: a service, job or backup new to the snapshot pages if it appears in trouble, and is quiet if it appears ok', async () => {
  const p = await after([board()]);
  try {
    const jobs = {
      ok: cronRun('success', 60_000),
      broken: cronRun('failure', 60_000, { error: 'exit 3' }),
      late: cronRun('success', 7_200_000, { expected_every_seconds: 60 }),
      nightly: cronRun('failure', 60_000, { error: 'exit 1' }),
    };
    const newcomers = board({
      cards: [monitored('n1:up-app', 'up'), monitored('n1:down-app', 'down')],
      cron: [cronNode('n1', jobs)],
    });
    const sent = [];
    for (const c of [newcomers, newcomers]) {
      const before = p.sent.length;
      await p.cycle(c, { backupJobs: ['n1:nightly'] });
      sent.push(p.sent.slice(before));
    }
    assert.deepEqual(sent, [
      [
        'cron_failed n1:broken',
        'cron_failed n1:nightly',
        'cron_overdue n1:late',
        'service_down n1:down-app',
      ],
      [],
    ]);
    assert.ok(
      p.status.entities.some((e) => e.id === 'backups/n1:nightly'),
      'nightly is a backup'
    );
  } finally {
    p.close();
  }
});

// ── The UPS ──────────────────────────────────────────────────────────────

test('#448: UPS unknown -> on_battery with no held state pages once', async () => {
  // The baseline is taken while the NUT exporter is quiet: no state is known.
  const p = await after([board({ ups: UPS_QUIET })]);
  try {
    const sent = await play(p, [
      board({ ups: UPS_ON_BATTERY }),
      board({ ups: UPS_ON_BATTERY }),
      board({ ups: UPS_LOW_BATTERY }),
    ]);
    assert.deepEqual(sent, [['ups_on_battery ups'], [], []]);
    assert.equal(p.events[0].severity, 'critical');
  } finally {
    p.close();
  }
});

test('#448: UPS unknown -> online with no held state sends nothing (no false "back on mains")', async () => {
  const p = await after([board({ ups: UPS_QUIET })]);
  try {
    assert.deepEqual(await play(p, [board(), board()]), [[], []]);
  } finally {
    p.close();
  }
});

test('#448: UPS on_battery -> unknown -> on_battery does not page again; on mains after it sends its one recovery', async () => {
  const p = await after([board(), board({ ups: UPS_ON_BATTERY })]);
  try {
    const sent = await play(p, [
      board({ ups: UPS_QUIET }), // one quiet cycle: a blip
      board({ ups: UPS_ON_BATTERY }),
      board({ ups: UPS_QUIET }), // quiet for long enough to page as a source
      board({ ups: UPS_QUIET }),
      board({ ups: UPS_LOW_BATTERY }),
      board({ ups: UPS_FAILED }), // the UPS query failed
      board({ ups: UPS_ON_BATTERY }),
      board(),
    ]);
    assert.deepEqual(sent, [
      [],
      [],
      [],
      ['source_down nut'],
      ['source_recovered nut'],
      [],
      [],
      ['ups_restored ups'],
    ]);
  } finally {
    p.close();
  }
});

test('#448: UPS online -> unknown -> online sends nothing', async () => {
  const p = await after([board(), board()]);
  try {
    const sent = await play(p, [
      board({ ups: UPS_QUIET }),
      board(),
      board({ ups: UPS_FAILED }),
      board(),
    ]);
    assert.deepEqual(sent, [[], [], [], []]);
  } finally {
    p.close();
  }
});

test('#448: UPS online -> unknown -> on_battery pages once (the power cut that drops the exporter too)', async () => {
  const p = await after([board(), board()]);
  try {
    const sent = await play(p, [board({ ups: UPS_QUIET }), board({ ups: UPS_ON_BATTERY })]);
    assert.deepEqual(sent, [[], ['ups_on_battery ups']]);
  } finally {
    p.close();
  }
});

// ── Restarts ─────────────────────────────────────────────────────────────

// One of each open problem push pages for, and n2 healthy.
const TROUBLE = () =>
  board({
    nodes: {
      n1: [{ diskPercent: '92' }, {}],
      n2: [],
      n3: [{}, { reachable: false }],
    },
    cards: [monitored('n1:app', 'down'), monitored('n1:web', 'up')],
    ups: UPS_ON_BATTERY,
    cron: [
      cronNode('n1', {
        restic: cronRun('failure', 60_000, { error: 'exit 3' }),
        prune: cronRun('success', 7_200_000, { expected_every_seconds: 60 }),
        rotate: cronRun('success', 60_000),
      }),
    ],
  });
const TROUBLE_PAGES = [
  'cron_failed n1:restic',
  'cron_overdue n1:prune',
  'host_threshold n1:disk',
  'host_unreachable n3',
  'service_down n1:app',
  'ups_on_battery ups',
];

test('#448: a restart with a valid snapshot mid-episode sends nothing again and clears nothing falsely', async () => {
  const p = await after([board({ nodes: { n2: [], n3: [] } })]);
  try {
    assert.deepEqual((await play(p, [TROUBLE()])).flat(), TROUBLE_PAGES);
    p.restart();
    assert.deepEqual(await play(p, [TROUBLE(), TROUBLE()]), [[], []]);
    // Inside the disk's hysteresis band after another restart: still held.
    p.restart();
    const inBand = board({
      nodes: { n1: [{ diskPercent: '87' }, {}], n2: [], n3: [{}, { reachable: false }] },
      cards: [monitored('n1:app', 'down'), monitored('n1:web', 'up')],
      ups: UPS_ON_BATTERY,
    });
    assert.deepEqual((await play(p, [inBand])).flat(), []);
  } finally {
    p.close();
  }
});

for (const [what, damage] of [
  ['missing', (path) => rmSync(path)],
  ['corrupt', (path) => writeFileSync(path, '{"services": {"n1:app": "do')],
]) {
  test(`#448: a restart with a ${what} snapshot pages each open problem once, not per cycle, and nothing for what is ok`, async () => {
    const p = await after([board({ nodes: { n2: [], n3: [] } }), TROUBLE()]);
    try {
      damage(p.path);
      p.restart();
      assert.equal(p.snapshot.prev(), null, 'no previous state');
      const sent = await play(p, [TROUBLE(), TROUBLE(), TROUBLE()]);
      assert.deepEqual(sent, [TROUBLE_PAGES, [], []]);
      // And once more after a restart: the snapshot it wrote holds them.
      p.restart();
      assert.deepEqual(await play(p, [TROUBLE()]), [[]]);
    } finally {
      p.close();
    }
  });
}

test('#448: the first cycle with no snapshot at all is diffed from nothing too: a healthy board sends nothing', async () => {
  const p = pushPipeline({ start: NOW });
  try {
    const healthy = board({ nodes: { n2: [] }, cards: [monitored('n1:web', 'up')] });
    assert.deepEqual(await play(p, [healthy, healthy]), [[], []]);
  } finally {
    p.close();
  }
});

// ── A source down the first cycle an entity is seen ──────────────────────

test('#448: Prometheus down at first sight: nothing for what it feeds; once it answers, a crit node pages once', async () => {
  const p = await after([board()]);
  try {
    // n2 is added during the outage: the payload has no node at all.
    const sent = await play(p, [
      prometheusDown(),
      prometheusDown(),
      board({ nodes: { n2: [{}, { reachable: false }] } }),
      board({ nodes: { n2: [{}, { reachable: false }] } }),
    ]);
    assert.deepEqual(sent, [
      [],
      ['source_down prometheus'],
      ['host_unreachable n2', 'source_recovered prometheus'],
      [],
    ]);
  } finally {
    p.close();
  }
});

test('#448: no snapshot and Prometheus down at boot: nothing until it answers, then each open problem once', async () => {
  const p = pushPipeline({ start: NOW });
  try {
    const sent = await play(p, [
      prometheusDown(),
      prometheusDown(),
      board({ nodes: { n2: [{ diskPercent: '97' }] }, ups: UPS_ON_BATTERY }),
      board({ nodes: { n2: [{ diskPercent: '97' }] }, ups: UPS_ON_BATTERY }),
    ]);
    // The baseline waits for Prometheus (push/snapshot.js baselineReady), so
    // this outage sends no source_down: #436's known gap.
    assert.deepEqual(sent, [[], [], ['host_threshold n2:disk', 'ups_on_battery ups'], []]);
  } finally {
    p.close();
  }
});

test('#448: Kuma down at first sight: a new service sends nothing; once Kuma answers it down, it pages once', async () => {
  const p = await after([board({ cards: [monitored('n1:web', 'up')] })]);
  try {
    const kumaDown = { prometheus: { ok: true }, kuma: { ok: false } };
    const cards = [monitored('n1:web', 'up'), monitored('n1:app', 'down')];
    const sent = await play(p, [
      board({ cards, sources: kumaDown }),
      board({ cards, sources: kumaDown }),
      board({ cards }),
      board({ cards }),
    ]);
    assert.deepEqual(sent, [
      [],
      ['source_down kuma'],
      ['service_down n1:app', 'source_recovered kuma'],
      [],
    ]);
  } finally {
    p.close();
  }
});

test('#448: NUT quiet at first sight: nothing; once it reads on battery, the UPS pages once', async () => {
  const p = pushPipeline({ start: NOW });
  try {
    const sent = await play(p, [
      board({ ups: UPS_QUIET }),
      board({ ups: UPS_QUIET }),
      board({ ups: UPS_ON_BATTERY }),
      board({ ups: UPS_ON_BATTERY }),
    ]);
    assert.deepEqual(sent, [
      [],
      ['source_down nut'],
      ['source_recovered nut', 'ups_on_battery ups'],
      [],
    ]);
  } finally {
    p.close();
  }
});
