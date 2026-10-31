/**
 * Node CPU's hold (#764, spec §8): a 30 minute hold,
 * so a backup night's burst does not page. The default is 30 minutes of
 * consecutive cycles at or above the line (thresholds.js `cpu.holdMs`), counted
 * in time and not in cycles, so a changed refresh interval keeps it. Run through
 * the model and through the real push cycle with the real defaults.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_THRESHOLDS, resolveThresholds } from './thresholds.js';
import { createStatusTracker } from './index.js';
import { inputs, node } from '../testing/statusFixtures.js';
import { cachesOf, pushPipeline } from '../testing/pushPipeline.js';
import { UPS_ONLINE } from '../testing/statusFixtures.js';

const MIN = 60_000;
const START = 1_782_345_600_000;
const hot = (cpu) => inputs({ nodes: { n1: node({ cpu }) } });

/** The node's state at each `[minute, cpu]`, one tracker, default thresholds. */
function run(steps, thresholds = DEFAULT_THRESHOLDS) {
  const tracker = createStatusTracker();
  return steps.map(([minute, cpu]) => {
    const status = tracker.update({ inputs: hot(cpu), thresholds, now: START + minute * MIN });
    return status.entities.find((e) => e.id === 'nodes/n1');
  });
}

test('the default hold is 30 minutes, and two cycles is only the floor under it', () => {
  assert.equal(DEFAULT_THRESHOLDS.cpu.holdMs, 30 * MIN);
  assert.equal(DEFAULT_THRESHOLDS.cpu.cycles, 2);
  assert.equal(resolveThresholds({ cpu: 0.8 }).cpu.holdMs, 30 * MIN, 'the pushThresholds line keeps the hold');
  assert.equal(resolveThresholds(null, { cpu: { warn: 85 } }).cpu.holdMs, 30 * MIN, 'so does a saved line');
});

test('95 % for 29 minutes is quiet, and warns at 30', () => {
  const steps = Array.from({ length: 61 }, (_, i) => [i / 2, '95.0']);
  const states = run(steps).map((e) => e.state);
  assert.equal(states[58], 'ok', '29 min');
  assert.equal(states[59], 'ok', '29.5 min');
  assert.equal(states[60], 'warn', '30 min');
  assert.deepEqual(states.slice(0, 60), Array(60).fill('ok'));
});

test('the warning says the hold, and holds by hysteresis once raised', () => {
  const [, , last] = run([[0, '95.0'], [15, '95.0'], [30, '95.0']]);
  assert.equal(last.state, 'warn');
  assert.equal(last.reason, 'CPU 95 % (warning above 90 % for 30 min)');
  const after = run([[0, '95.0'], [30, '95.0'], [31, '87.0'], [32, '84.0']]);
  assert.deepEqual(after.map((e) => e.state), ['ok', 'warn', 'warn', 'ok'], 'held in the 5 point band, clear below it');
});

test('a dip under the line starts the hold again: a backup night with pauses does not page', () => {
  const states = run([
    [0, '95.0'],
    [20, '95.0'],
    [21, '40.0'],
    [22, '95.0'],
    [51, '95.0'],
  ]).map((e) => e.state);
  assert.deepEqual(states, ['ok', 'ok', 'ok', 'ok', 'ok'], '29 minutes since the dip');
  assert.equal(run([[0, '95.0'], [20, '40.0'], [21, '95.0'], [51, '95.0']])[3].state, 'warn', '30 minutes since it');
});

test('the hold is time, not cycles: a 5 minute refresh interval still waits 30 minutes', () => {
  const states = run([0, 5, 10, 15, 20, 25, 30].map((m) => [m, '95.0'])).map((e) => e.state);
  assert.deepEqual(states, ['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'warn']);
  // And a refresh interval of an hour warns on the second cycle (the floor), not the first.
  assert.deepEqual(run([[0, '95.0'], [60, '95.0']]).map((e) => e.state), ['ok', 'warn']);
});

test('a hold of 0 is the old 2 cycles (a config built without one)', () => {
  const none = { ...DEFAULT_THRESHOLDS, cpu: { warn: 0.9, cycles: 2 } };
  assert.deepEqual(run([[0, '95.0'], [0.5, '95.0']], none).map((e) => e.state), ['ok', 'warn']);
  assert.equal(run([[0, '95.0'], [0.5, '95.0']], none)[1].reason, 'CPU 95 % (warning above 90 % for 2 cycles)');
});

test('push pages the CPU on the 30th minute, once, through the real cycle', async () => {
  const p = pushPipeline({ start: START, thresholds: DEFAULT_THRESHOLDS });
  const caches = (cpu) =>
    cachesOf({
      services: { sources: { prometheus: { ok: true }, kuma: { ok: true } }, nodes: { h: node({ cpu }) } },
      ups: UPS_ONLINE,
    });
  try {
    for (let i = 0; i < 60; i += 1) await p.cycle(caches('95.0')); // 30 min of 30 s cycles: the 60th cycle is at 29.5 min
    assert.deepEqual(p.sent, [], 'nothing in the first 29.5 minutes');
    await p.cycle(caches('95.0'));
    assert.deepEqual(p.sent, ['host_threshold h:cpu']);
    for (let i = 0; i < 10; i += 1) await p.cycle(caches('95.0'));
    assert.equal(p.sent.length, 1);
  } finally {
    p.close();
  }
});
