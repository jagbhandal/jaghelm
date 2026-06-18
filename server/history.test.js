import test from 'node:test';
import assert from 'node:assert/strict';

import { recordSample, recordSamples, getHistory, _reset } from './history.js';

test('recordSample appends finite values and caps at the ~1h window (120)', () => {
  _reset();
  for (let i = 0; i < 150; i++) recordSample('a:cpu', i);
  const h = getHistory();
  assert.equal(h['a:cpu'].length, 120);
  assert.equal(h['a:cpu'][0], 30); // first 30 evicted (150 - 120)
  assert.equal(h['a:cpu'].at(-1), 149);
});

test('recordSample leaves a gap (skips) for null / "" / NaN — never a fake 0', () => {
  _reset();
  recordSample('a:cpu', 10);
  recordSample('a:cpu', null);
  recordSample('a:cpu', undefined);
  recordSample('a:cpu', '');
  recordSample('a:cpu', NaN);
  recordSample('a:cpu', 'x');
  recordSample('a:cpu', 20);
  assert.deepEqual(getHistory()['a:cpu'], [10, 20]);
});

test('recordSample coerces numeric strings and rounds to 1 decimal', () => {
  _reset();
  recordSample('a:cpu', '33.339');
  recordSample('a:cpu', 12.34);
  assert.deepEqual(getHistory()['a:cpu'], [33.3, 12.3]);
});

test('recordSamples records a whole cycle; null fields create no series', () => {
  _reset();
  recordSamples({ 'a:cpu': '12', 'a:mem': 50, 'a:disk': null });
  const h = getHistory();
  assert.deepEqual(h['a:cpu'], [12]);
  assert.deepEqual(h['a:mem'], [50]);
  assert.equal('a:disk' in h, false);
});

test('getHistory returns a fully independent snapshot (object AND arrays copied)', () => {
  _reset();
  recordSample('a:cpu', 1);
  const snap = getHistory();
  assert.deepEqual(snap, { 'a:cpu': [1] });
  // Mutating either the snapshot object or its arrays must not corrupt the store.
  snap['b:mem'] = [9];
  snap['a:cpu'].push(999);
  const fresh = getHistory();
  assert.equal('b:mem' in fresh, false);
  assert.deepEqual(fresh['a:cpu'], [1]); // the pushed 999 didn't leak into the buffer
});
