/**
 * One threshold config (#290): the status model reads it, and push sends what
 * the model judges (#292), so the two can never disagree about which side of a
 * line a reading is on, hysteresis included.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cachesOf, pushPipeline } from '../testing/pushPipeline.js';
import { node, UPS_ONLINE } from '../testing/statusFixtures.js';
import { DEFAULT_THRESHOLDS, resolveThresholds } from './thresholds.js';

test('the defaults are spec §6.1 table', () => {
  assert.deepEqual(DEFAULT_THRESHOLDS, {
    cpu: { warn: 0.9, cycles: 2 },
    mem: { warn: 0.9 },
    disk: { warn: 0.9, crit: 0.95 },
    temp: { warn: 75, crit: 85 },
    driveTemp: { nvme: { warn: 70, crit: 80 }, sata: { warn: 55, crit: 60 } },
    hysteresis: { fraction: 0.05, celsius: 5 },
    pending: { cycles: 2 },
  });
  assert.ok(Object.isFrozen(DEFAULT_THRESHOLDS) && Object.isFrozen(DEFAULT_THRESHOLDS.disk));
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
  }
});

/**
 * Feeds one host's readings, one per cycle, through the model and the real
 * push cycle (testing/pushPipeline.js). Returns push's events of the last
 * cycle and the model's state for the metric after it.
 */
async function bothSides(metric, readings, thresholds) {
  const field = { disk: 'diskPercent', mem: 'memPercent', cpu: 'cpu' }[metric];
  const p = pushPipeline({ thresholds });
  try {
    let events = [];
    for (const pct of readings) {
      const before = p.sent.length;
      const status = await p.cycle(
        cachesOf({
          services: {
            sources: { prometheus: { ok: true }, kuma: { ok: true } },
            nodes: {
              h: node({ cpu: '0', memPercent: '0', diskPercent: '0', [field]: String(pct) }),
            },
          },
          ups: UPS_ONLINE,
        })
      );
      events = p.sent.slice(before).map((e) => e.split(' ')[0]);
      p.model = status.entities.find((e) => e.id === 'nodes/h').conditions[metric];
    }
    return { events, model: p.model };
  } finally {
    p.close();
  }
}

// Readings on, above, below and in the hysteresis band of the lines.
const READINGS = [0, 50, 84, 84.9, 85, 85.1, 86, 87, 89, 89.9, 90, 90.1, 92, 95, 96, 100];

for (const [name, override, saved] of [
  ['the defaults', undefined],
  ['a hand-edited display-config', { disk: 0.86, mem: 0.875, hysteresis: 0.03 }],
  // Saved in Settings → Notifications (#320): the next cycle judges by them.
  ['lines saved in Settings', { hysteresis: 0.03 }, { disk: { warn: 86, crit: 93 }, mem: { warn: 87.5 } }],
]) {
  for (const metric of ['disk', 'mem']) {
    test(`push and the model draw the ${metric} line in one place, with ${name}`, async () => {
      const t = resolveThresholds(override, saved);
      for (const pct of READINGS) {
        // Rising from 0: push alerts exactly when the model leaves ok.
        const up = await bothSides(metric, [0, pct], t);
        assert.equal(up.events.includes('host_threshold'), up.model !== 'ok', `0 -> ${pct}`);
        // Falling from 100: push clears exactly when the model is back to ok.
        const down = await bothSides(metric, [100, pct], t);
        assert.equal(
          down.events.includes('host_threshold_cleared'),
          down.model === 'ok',
          `100 -> ${pct}`
        );
      }
    });
  }
}

test('push and the model draw the CPU line in one place, both after its 2 cycles (#292)', async () => {
  for (const pct of READINGS) {
    const once1 = await bothSides('cpu', [0, pct], DEFAULT_THRESHOLDS);
    const twice = await bothSides('cpu', [0, pct, pct], DEFAULT_THRESHOLDS);
    assert.deepEqual(once1.events, [], `0 -> ${pct}: one cycle over the line is not a warning`);
    assert.equal(
      twice.events.includes('host_threshold'),
      twice.model !== 'ok',
      `0 -> ${pct} -> ${pct}`
    );
    assert.equal(
      (await bothSides('cpu', [pct], DEFAULT_THRESHOLDS)).model,
      'ok',
      `one cycle at ${pct}`
    );
  }
});
