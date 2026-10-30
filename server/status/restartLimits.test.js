/**
 * Per-container restart-loop limits (#798): `restartLimits` in
 * display-config.json, "node:container" to an integer limit. Sanitised where
 * it is read; the alert's own behaviour is tested in
 * push/containerConditions.test.js.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MAX_RESTART_LIMIT, createRestartLimitsReader, resolveRestartLimits } from './restartLimits.js';
import { clearAtFor, containerConditionIssues } from './containerConditions.js';

const MIN = 60_000;
const START = 1_782_345_600_000;
const read = (events) => ({ state: 'ok', events, blindNodes: [], oomCounter: true });
const restarts = (n, { name = 'vaultwarden', node = 'pi-2' } = {}) =>
  Array.from({ length: n }, (_, i) => ({ time: START - MIN - i * 10 * MIN, kind: 'restart', node, name }));
const limits = { 'pi-2:vaultwarden': 4 };

test('restartLimits: no value is no overrides', () => {
  for (const raw of [undefined, null, {}]) {
    assert.deepEqual(resolveRestartLimits(raw), { limits: {}, dropped: [] }, String(raw));
  }
});

test('restartLimits: valid entries are kept, bad ones dropped and never throw', () => {
  const bad = {
    'pi-2:vw': 2, // below the default
    'pi-2:web': 3.5,
    'pi-2:str': '4',
    'pi-2:nan': NaN,
    'pi-2:big': MAX_RESTART_LIMIT + 1,
    nocolon: 5,
    ':x': 5,
    'pi-2:': 5,
    ' pi-2:x': 5,
    '__proto__': 5,
  };
  const { limits: got, dropped } = resolveRestartLimits({ 'pi-2:vaultwarden': 4, 'a:b': 3, ...bad });
  assert.deepEqual(got, { 'pi-2:vaultwarden': 4, 'a:b': 3 });
  assert.equal(dropped.length, Object.keys(bad).length);
  for (const raw of [[1, 2], 'x', 7, true, [['a:b', 4]]]) {
    assert.deepEqual(resolveRestartLimits(raw).limits, {}, JSON.stringify(raw));
  }
  // Unknown extra keys with a valid shape are just other containers; nothing else is read.
  assert.doesNotThrow(() => resolveRestartLimits(JSON.parse('{"__proto__": 9, "a:b": 4}')));
});

test('restartLimits: the reader logs what it drops once, until it changes', () => {
  const lines = [];
  const reader = createRestartLimitsReader({ logger: { warn: (f, m) => lines.push({ f, m }) } });
  assert.deepEqual(reader({ restartLimits: { 'a:b': 4, 'c:d': 1 } }), { 'a:b': 4 });
  reader({ restartLimits: { 'a:b': 4, 'c:d': 1 } });
  assert.equal(lines.length, 1);
  assert.deepEqual(reader(undefined), {});
  assert.deepEqual(reader({ restartLimits: { 'c:d': 1 } }), {});
  assert.equal(lines.length, 2, 'the same mistake again after it was fixed is logged again');
});

test('the effective limit: default unchanged, override applied', () => {
  // No override: 4 restarts is a loop at the default 3.
  const [d] = containerConditionIssues(read(restarts(4)), { now: START });
  assert.match(d.reason, /\(limit 3\)$/);
  // The override applies only to its own node and container.
  assert.equal(containerConditionIssues(read(restarts(4)), { now: START, limits }).length, 0);
  assert.equal(containerConditionIssues(read(restarts(4, { node: 'pi-1' })), { now: START, limits }).length, 1);
  assert.equal(containerConditionIssues(read(restarts(4, { name: 'other' })), { now: START, limits }).length, 1);
});

test('the override: at its limit stays quiet, above it fires and says its limit', () => {
  assert.deepEqual(containerConditionIssues(read(restarts(4)), { now: START, limits }), []);
  const [i, ...rest] = containerConditionIssues(read(restarts(5)), { now: START, limits });
  assert.equal(rest.length, 0);
  assert.equal(i.reason, 'Restart loop: 5 restarts in the last hour (limit 4)');
});

test('a bad config value reaches the alert as no override', () => {
  const { limits: got } = resolveRestartLimits({ 'pi-2:vaultwarden': 'four' });
  assert.equal(containerConditionIssues(read(restarts(4)), { now: START, limits: got }).length, 1);
});

test('hysteresis: the default clears at 2; a raised limit clears 2 below it, never under 2', () => {
  assert.equal(clearAtFor(3), 2);
  assert.equal(clearAtFor(4), 2);
  assert.equal(clearAtFor(6), 4);
  const held = new Set(['containers/pi-2:vaultwarden:restart_loop']);
  const lim6 = { 'pi-2:vaultwarden': 6 };
  assert.equal(containerConditionIssues(read(restarts(4)), { now: START, limits: lim6, held }).length, 1);
  assert.equal(containerConditionIssues(read(restarts(3)), { now: START, limits: lim6, held }).length, 0);
  assert.equal(containerConditionIssues(read(restarts(2)), { now: START, held }).length, 1, 'default: held at 2');
  assert.equal(containerConditionIssues(read(restarts(1)), { now: START, held }).length, 0);
});
