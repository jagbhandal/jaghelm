/**
 * #361, closed by #292: push's hysteresis holds, because push takes each
 * reading's level from the status model, which holds it (status/rules.js
 * levelOf), instead of comparing each reading with the previous one.
 *
 * Before, "was high" was read from the previous cycle's raw reading, so once a
 * reading sat between the clear level and the line, the episode was forgotten:
 * a drift down through the band never sent "back to normal", and a reading
 * that dipped into the band and rose again alerted twice.
 *
 * These run the real model and the real push cycle over a snapshot file
 * (testing/pushPipeline.js, as refresh.js wires them), cycle by cycle.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { cachesOf, pushPipeline } from '../testing/pushPipeline.js';
import { node, UPS_ONLINE } from '../testing/statusFixtures.js';
import { resolveThresholds } from '../status/thresholds.js';

const FIELD = { cpu: 'cpu', mem: 'memPercent', disk: 'diskPercent' };
const OK = { prometheus: { ok: true }, kuma: { ok: true } };

/** One cycle's caches: host h with `metric` at `fraction` (null: no reading), everything else calm. */
function reading(metric, fraction) {
  return cachesOf({
    services: {
      sources: OK,
      nodes: {
        h: node({
          cpu: '10',
          memPercent: '40',
          diskPercent: '50',
          [FIELD[metric]]: fraction === null ? null : String(fraction * 100),
        }),
      },
    },
    ups: UPS_ONLINE,
  });
}

/** Runs `fractions` (one a cycle) through push; returns what each cycle sent. */
async function play(metric, fractions, pipeline = pushPipeline()) {
  const perCycle = [];
  try {
    for (const f of fractions) {
      const before = pipeline.sent.length;
      await pipeline.cycle(reading(metric, f));
      perCycle.push(pipeline.sent.slice(before).map((s) => s.split(' ')[0]));
    }
    return perCycle;
  } finally {
    pipeline.close();
  }
}

// #361's table: thresholds 0.9 with a 0.05 band (the defaults), the previous
// reading carried each cycle. [reading, what is sent arriving at it].
const TABLE = [
  [0.5, []], // the baseline
  [0.95, ['host_threshold']],
  [0.87, []], // still high, inside the band
  [0.8, ['host_threshold_cleared']], // was: nothing
  [0.93, ['host_threshold']], // a new episode
  [0.87, []],
  [0.93, []], // never cleared: was a third host_threshold
];

for (const metric of ['mem', 'disk']) {
  test(`#361: the table, on ${metric}: exactly the "Expected" column`, async () => {
    const sent = await play(
      metric,
      TABLE.map(([f]) => f)
    );
    assert.deepEqual(
      sent,
      TABLE.map(([, want]) => want)
    );
  });
}

test('#361: the table, on CPU, each reading held 2 cycles (the model warns only after 2 cycles over the line)', async () => {
  const sent = await play(
    'cpu',
    TABLE.flatMap(([f]) => [f, f])
  );
  // Arriving at a reading sends on its first cycle, or, for CPU's first warning
  // of an episode, on its second.
  const merged = TABLE.map((_, i) => [...sent[2 * i], ...sent[2 * i + 1]]);
  assert.deepEqual(
    merged,
    TABLE.map(([, want]) => want)
  );
  assert.deepEqual(sent[2], [], '0.95 for one cycle is not yet a warning');
});

test('#361: a metric flapping around the line sends one host_threshold and one host_threshold_cleared', async () => {
  const flapping = [0.5, 0.91, 0.89, 0.91, 0.89, 0.91, 0.84];
  const sent = (await play('mem', flapping)).flat();
  assert.deepEqual(sent, ['host_threshold', 'host_threshold_cleared']);
  // CPU never holds its line for 2 cycles in a row here, so it never warns.
  assert.deepEqual((await play('cpu', flapping)).flat(), []);
});

test('#361: an episode survives a restart: inside the band after it, nothing; below the clear level, cleared', async () => {
  const first = pushPipeline();
  await first.cycle(reading('mem', 0.5));
  await first.cycle(reading('mem', 0.95));
  assert.deepEqual(first.sent, ['host_threshold h:mem']);
  assert.deepEqual(JSON.parse(readFileSync(first.path, 'utf8')).hosts.h.levels.mem, 'warn');

  // Restart (the model's memory is gone; the file holds the level) inside the band.
  first.restart();
  await first.cycle(reading('mem', 0.87));
  assert.deepEqual(first.sent, ['host_threshold h:mem'], 'no "back to normal" at 87 %');
  await first.cycle(reading('mem', 0.91));
  assert.deepEqual(first.sent, ['host_threshold h:mem'], 'and no second alert at 91 %');

  // Restart again, then below the clear level: the episode ends.
  first.restart();
  await first.cycle(reading('mem', 0.8));
  assert.deepEqual(first.sent, ['host_threshold h:mem', 'host_threshold_cleared h:mem']);
  first.close();
});

test('#361: a restart keeps a CPU warning held inside the band, and a crit disk at crit', async () => {
  const p = pushPipeline();
  try {
    for (const f of [0.5, 0.95, 0.95]) await p.cycle(reading('cpu', f));
    assert.deepEqual(p.sent, ['host_threshold h:cpu']);
    p.restart();
    await p.cycle(reading('cpu', 0.86));
    assert.deepEqual(p.sent, ['host_threshold h:cpu'], 'CPU 86 % after a restart: still warning');

    for (const f of [0.5, 0.97]) await p.cycle(reading('disk', f));
    p.restart();
    await p.cycle(reading('disk', 0.91)); // under 95, inside crit's band
    assert.deepEqual(p.events.at(-1).severity, 'critical');
    assert.equal(
      p.sent.filter((s) => s === 'host_threshold h:disk').length,
      1,
      'no second disk alert'
    );
  } finally {
    p.close();
  }
});

test('a line lowered while JagHelm is stopped: the restart judges the reading against the new line', async () => {
  const lower = resolveThresholds({ mem: 0.8 });
  // Below the old line throughout: nothing sent, nothing held.
  const a = pushPipeline();
  for (const f of [0.85, 0.7, 0.6]) await a.cycle(reading('mem', f));
  a.restart();
  await a.cycle(reading('mem', 0.82), { thresholds: lower });
  assert.deepEqual(a.sent, ['host_threshold h:mem'], '82 % is over the new 80 % line');
  a.close();

  // Over both lines already: the alert was sent, nothing new.
  const b = pushPipeline();
  for (const f of [0.5, 0.95]) await b.cycle(reading('mem', f));
  b.restart();
  await b.cycle(reading('mem', 0.95), { thresholds: lower });
  assert.deepEqual(b.sent, ['host_threshold h:mem']);
  b.close();
});

// ── #462: a reading with no value for a cycle ────────────────────────────
// A sensor that answers only some cycles (common for temperature and SMART
// exporters) sends a cycle with no value. The model holds the level it had,
// so the episode is still one: one alert, and its "back to normal" when it is.

/** One cycle's caches: host h with the hottest sensor at `celsius` (null: no reading). */
function temperature(celsius) {
  return cachesOf({
    services: {
      sources: OK,
      nodes: { h: node({ temp: celsius === null ? null : String(celsius) }) },
    },
    ups: UPS_ONLINE,
  });
}

/** Runs `caches` (one a cycle) through `pipeline`; returns what each cycle sent. */
async function playCaches(list, pipeline) {
  const perCycle = [];
  for (const caches of list) {
    const before = pipeline.sent.length;
    await pipeline.cycle(caches);
    perCycle.push(pipeline.sent.slice(before));
  }
  return perCycle;
}

test('#462: 78 → no reading → 73 → 76 °C sends one host_threshold and no clear', async () => {
  const p = pushPipeline();
  try {
    const sent = await playCaches([45, 78, null, 73, 76, 69].map(temperature), p);
    assert.deepEqual(sent, [
      [], // the baseline
      ['host_threshold h:temp'],
      [], // no reading: held at warn
      [], // inside the band: still warn (was: host_threshold_cleared)
      [], // over the line again: the same episode (was: a second host_threshold)
      ['host_threshold_cleared h:temp'], // below 70 °C: it ends
    ]);
    assert.equal(p.events[0].severity, 'warning');
  } finally {
    p.close();
  }
});

for (const metric of ['mem', 'disk']) {
  test(`#462: on ${metric}, 95 % → no reading → 87 % → 93 % is one episode`, async () => {
    const sent = await play(metric, [0.5, 0.95, null, 0.87, 0.93, 0.8]);
    assert.deepEqual(sent, [[], ['host_threshold'], [], [], [], ['host_threshold_cleared']]);
  });
}

test("#462: CPU's 2 cycles survive a cycle with no reading: 95 %, none, 95 % pages on the third", async () => {
  assert.deepEqual(await play('cpu', [0.5, 0.95, null, 0.95]), [[], [], [], ['host_threshold']]);
});

test('#462: a reading that never comes back holds its episode until its node goes: nothing is sent, and the node back is new', async () => {
  const p = pushPipeline();
  try {
    await playCaches([temperature(45), temperature(78)], p);
    assert.deepEqual(p.sent, ['host_threshold h:temp']);
    // 40 cycles with no reading, with a restart among them: nothing.
    await playCaches(Array(20).fill(temperature(null)), p);
    p.restart();
    await playCaches(Array(20).fill(temperature(null)), p);
    assert.deepEqual(p.sent, ['host_threshold h:temp'], 'no clear, no second alert');
    assert.equal(p.status.entities.find((e) => e.id === 'nodes/h').state, 'warn');
    assert.equal(JSON.parse(readFileSync(p.path, 'utf8')).hosts.h.levels.temp, 'warn');

    // The node leaves services.yaml: its episode ends with it, silently.
    const empty = cachesOf({ services: { sources: OK, nodes: {} }, ups: UPS_ONLINE });
    await p.cycle(empty);
    assert.deepEqual(p.sent, ['host_threshold h:temp'], 'no clear for a node that went');
    assert.equal(Object.hasOwn(JSON.parse(readFileSync(p.path, 'utf8')).hosts, 'h'), false);

    // Back, it is new (#448): 73 °C is ok, so nothing; over its line, one alert.
    const back = await playCaches([temperature(73), temperature(76)], p);
    assert.deepEqual(back, [[], ['host_threshold h:temp']]);
  } finally {
    p.close();
  }
});
