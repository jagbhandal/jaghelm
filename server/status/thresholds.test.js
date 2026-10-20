/**
 * One threshold config (#290): the status model and push read the same
 * numbers, so the two can never disagree about which side of a line a reading
 * is on, hysteresis included.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { diffSnapshots } from '../push/differ.js';
import { inputs, node, cycles } from '../testing/statusFixtures.js';
import { DEFAULT_THRESHOLDS, pushThresholdsOf, resolveThresholds } from './thresholds.js';

test('the defaults are spec §6.1 table', () => {
  assert.deepEqual(DEFAULT_THRESHOLDS, {
    cpu: { warn: 0.9, cycles: 2 },
    mem: { warn: 0.9 },
    disk: { warn: 0.9, crit: 0.95 },
    temp: { warn: 75, crit: 85 },
    hysteresis: { fraction: 0.05, celsius: 5 },
    pending: { cycles: 2 },
  });
  assert.ok(Object.isFrozen(DEFAULT_THRESHOLDS) && Object.isFrozen(DEFAULT_THRESHOLDS.disk));
});

test("push's defaults are a view of them, as they were", () => {
  assert.deepEqual(pushThresholdsOf(DEFAULT_THRESHOLDS), {
    cpu: 0.9,
    mem: 0.9,
    disk: 0.9,
    hysteresis: 0.05,
  });
});

test('resolveThresholds: display-config pushThresholds set both, field by field', () => {
  const rows = [
    [undefined, DEFAULT_THRESHOLDS],
    [null, DEFAULT_THRESHOLDS],
    ['junk', DEFAULT_THRESHOLDS],
    [{ cpu: 0.8 }, { ...DEFAULT_THRESHOLDS, cpu: { warn: 0.8, cycles: 2 } }],
    [
      { mem: 0.85, hysteresis: 0.02 },
      { ...DEFAULT_THRESHOLDS, mem: { warn: 0.85 }, hysteresis: { fraction: 0.02, celsius: 5 } },
    ],
    [{ disk: 0.8 }, { ...DEFAULT_THRESHOLDS, disk: { warn: 0.8, crit: 0.95 } }],
    // A warn line above the crit line moves the crit line up to it.
    [{ disk: 0.97 }, { ...DEFAULT_THRESHOLDS, disk: { warn: 0.97, crit: 0.97 } }],
    [{ cpu: '0.5', mem: null }, DEFAULT_THRESHOLDS],
  ];
  for (const [override, want] of rows) {
    const got = resolveThresholds(override);
    assert.deepEqual(got, JSON.parse(JSON.stringify(want)), JSON.stringify(override));
    const push = pushThresholdsOf(got);
    assert.deepEqual(push, {
      cpu: got.cpu.warn,
      mem: got.mem.warn,
      disk: got.disk.warn,
      hysteresis: got.hysteresis.fraction,
    });
  }
});

/**
 * Feeds one host's readings, one per cycle, through push's real differ and
 * through the model. Returns push's events of the last cycle and the model's
 * state for the metric after it.
 */
function bothSides(metric, readings, thresholds) {
  const field = { disk: 'diskPercent', mem: 'memPercent', cpu: 'cpu' }[metric];
  const push = pushThresholdsOf(thresholds);
  const host = (pct) => ({ reachable: true, cpu: 0, mem: 0, disk: 0, [metric]: pct / 100 });
  const snap = (pct) => ({
    services: {},
    hosts: { h: host(pct) },
    ups: { state: 'unknown' },
    cron: {},
  });
  let events = [];
  readings.forEach((pct, i) => {
    if (i > 0) events = diffSnapshots(snap(readings[i - 1]), snap(pct), push).map((e) => e.type);
  });
  const statuses = cycles(
    readings.map((pct) =>
      inputs({
        nodes: { h: node({ cpu: '0', memPercent: '0', diskPercent: '0', [field]: String(pct) }) },
      })
    ),
    { thresholds }
  );
  const model = statuses.at(-1).entities.find((e) => e.id === 'nodes/h').conditions[metric];
  return { events, model };
}

// Readings on, above, below and in the hysteresis band of the lines.
const READINGS = [0, 50, 84, 84.9, 85, 85.1, 86, 87, 89, 89.9, 90, 90.1, 92, 95, 96, 100];

for (const [name, override] of [
  ['the defaults', undefined],
  ['a hand-edited display-config', { disk: 0.86, mem: 0.875, hysteresis: 0.03 }],
]) {
  for (const metric of ['disk', 'mem']) {
    test(`push and the model draw the ${metric} line in one place, with ${name}`, () => {
      const t = resolveThresholds(override);
      for (const pct of READINGS) {
        // Rising from 0: push alerts exactly when the model leaves ok.
        const up = bothSides(metric, [0, pct], t);
        assert.equal(up.events.includes('host_threshold'), up.model !== 'ok', `0 -> ${pct}`);
        // Falling from 100: push clears exactly when the model is back to ok.
        const down = bothSides(metric, [100, pct], t);
        assert.equal(
          down.events.includes('host_threshold_cleared'),
          down.model === 'ok',
          `100 -> ${pct}`
        );
      }
    });
  }
}

test('push and the model draw the CPU line in one place; the model waits its 2 cycles', () => {
  for (const pct of READINGS) {
    const once1 = bothSides('cpu', [0, pct], DEFAULT_THRESHOLDS);
    const twice = bothSides('cpu', [0, pct, pct], DEFAULT_THRESHOLDS);
    const pushed = once1.events.includes('host_threshold');
    assert.equal(twice.model !== 'ok', pushed, `0 -> ${pct} -> ${pct}`);
    assert.equal(bothSides('cpu', [pct], DEFAULT_THRESHOLDS).model, 'ok', `one cycle at ${pct}`);
  }
});
