import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dedupe } from './dedupe.js';

// dedupe collapses concurrent calls onto a single in-flight promise per slot.
// We can't observe the inFlight map directly (intentional — it's internal),
// but we can prove the property by counting how many times the underlying
// worker function actually runs.

test('dedupe runs the worker once for concurrent callers on the same slot', async () => {
  let runs = 0;
  let resolveBlock;
  const blocked = new Promise((r) => { resolveBlock = r; });
  const worker = async () => {
    runs++;
    await blocked;
    return 'value';
  };

  const slot = `services:${Math.random()}`;
  const p1 = dedupe(slot, worker);
  const p2 = dedupe(slot, worker);
  const p3 = dedupe(slot, worker);

  // All three concurrent callers should be looking at the same promise.
  assert.equal(p1, p2);
  assert.equal(p2, p3);
  assert.equal(runs, 1, 'worker should have been called exactly once');

  resolveBlock('value');
  const [v1, v2, v3] = await Promise.all([p1, p2, p3]);
  assert.equal(v1, 'value');
  assert.equal(v2, 'value');
  assert.equal(v3, 'value');
});

test('dedupe allows a fresh call after the previous one resolves', async () => {
  let runs = 0;
  const worker = async () => { runs++; return runs; };

  const slot = `ups:${Math.random()}`;
  const first = await dedupe(slot, worker);
  assert.equal(first, 1);

  // Yield to the microtask queue so the finally() clearing the slot has run.
  await new Promise((r) => setImmediate(r));

  const second = await dedupe(slot, worker);
  assert.equal(second, 2);
  assert.equal(runs, 2);
});

test('dedupe clears the slot after rejection so the next caller can retry', async () => {
  let runs = 0;
  const slot = `gitea:${Math.random()}`;

  await assert.rejects(
    dedupe(slot, async () => { runs++; throw new Error('first-fail'); }),
    /first-fail/
  );
  // Let the .finally() in dedupe execute.
  await new Promise((r) => setImmediate(r));

  const ok = await dedupe(slot, async () => { runs++; return 'recovered'; });
  assert.equal(ok, 'recovered');
  assert.equal(runs, 2);
});

test('dedupe isolates different slots', async () => {
  let runs = { a: 0, b: 0 };
  const workerA = async () => { runs.a++; return 'a'; };
  const workerB = async () => { runs.b++; return 'b'; };

  const a = dedupe('slot-a', workerA);
  const b = dedupe('slot-b', workerB);
  assert.notEqual(a, b);
  const [av, bv] = await Promise.all([a, b]);
  assert.equal(av, 'a');
  assert.equal(bv, 'b');
  assert.equal(runs.a, 1);
  assert.equal(runs.b, 1);
});
