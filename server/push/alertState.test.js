/** #669: Snooze and Ack state. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createAlertState, SNOOZE_MAX_MS } from './alertState.js';

function make(initial) {
  const clock = { now: 1_000_000 };
  const saved = [];
  const state = createAlertState({
    initial,
    save: (s) => saved.push(structuredClone(s)),
    now: () => clock.now,
  });
  return { state, clock, saved };
}

test('only an open incident can be acked; its recovery sends and ends the ack', () => {
  const { state } = make();
  assert.deepEqual(state.ack(['a']), { applied: [], ignored: ['a'] });
  state.observe('a', false);
  assert.deepEqual(state.ack(['a']).applied, ['a']);
  assert.equal(state.suppression('a', false), 'ack');
  assert.equal(state.suppression('a', true), null, 'the recovery is not held');
  state.observe('a', true);
  assert.equal(state.suppression('a', false), null);
  assert.deepEqual(state.ack(['a']).ignored, ['a']);
});

test('a snooze holds pages and recoveries until it ends, at most 24 hours', () => {
  const { state, clock } = make();
  state.snooze(['a'], 3_600_000);
  assert.equal(state.suppression('a', false), 'snooze');
  assert.equal(state.suppression('a', true), 'snooze');
  clock.now += 3_600_001;
  assert.equal(state.suppression('a', false), null);
  const { until } = state.snooze(['b'], 99 * SNOOZE_MAX_MS);
  assert.equal(until - clock.now, SNOOZE_MAX_MS);
  assert.equal(state.snooze(['c'], Number.NaN).until - clock.now, 3_600_000);
});

test('the state is written when it changed, read back defensively, and cleared by key', () => {
  const { state, saved } = make();
  state.flush();
  assert.equal(saved.length, 0, 'no change, no write');
  state.observe('a', false);
  state.ack(['a']);
  state.snooze(['b']);
  state.flush();
  state.flush();
  assert.equal(saved.length, 1);
  const again = make(saved[0]).state;
  assert.equal(again.suppression('a', false), 'ack');
  assert.equal(again.suppression('b', false), 'snooze');
  assert.equal(again.clear('a'), true);
  assert.equal(again.clear('a'), false);
  assert.deepEqual(again.view().acked, []);
  for (const junk of [null, 5, 'x', [], { open: 5, acks: [1], snoozes: { a: 'x' } }]) {
    assert.equal(make(junk).state.suppression('a', false), null);
  }
});

test('expired snoozes and old incidents are pruned when written', () => {
  const { state, clock, saved } = make();
  state.snooze(['a'], 60_000);
  state.observe('o', false);
  clock.now += 31 * 24 * 3600_000;
  state.observe('p', false);
  state.flush();
  assert.deepEqual(saved[0].snoozes, {});
  assert.deepEqual(Object.keys(saved[0].open), ['p']);
});
