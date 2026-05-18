import { test } from 'node:test';
import assert from 'node:assert/strict';

import { asyncHandler } from './asyncHandler.js';

// Minimal Express-shaped req/res/next stubs. We don't need a real Express
// instance — asyncHandler only contracts with Promise + next(err).
function makeStubs() {
  const calls = { next: [], json: [], status: [] };
  const res = {
    status(code) { calls.status.push(code); return res; },
    json(body) { calls.json.push(body); return res; },
    send(body) { calls.json.push(body); return res; },
  };
  const next = (err) => calls.next.push(err);
  return { req: {}, res, next, calls };
}

test('asyncHandler forwards rejected promises to next', async () => {
  const { req, res, next, calls } = makeStubs();
  const boom = new Error('boom');
  const handler = asyncHandler(async () => { throw boom; });

  handler(req, res, next);
  // Let the microtask queue drain.
  await new Promise((r) => setImmediate(r));

  assert.equal(calls.next.length, 1);
  assert.equal(calls.next[0], boom);
});

test('asyncHandler does not invoke next on success', async () => {
  const { req, res, next, calls } = makeStubs();
  const handler = asyncHandler(async (_req, r) => { r.json({ ok: true }); });

  handler(req, res, next);
  await new Promise((r) => setImmediate(r));

  assert.equal(calls.next.length, 0);
  assert.deepEqual(calls.json[0], { ok: true });
});

test('asyncHandler tolerates sync handlers that throw', async () => {
  const { req, res, next, calls } = makeStubs();
  const boom = new Error('sync-boom');
  // A sync throw inside an async function still surfaces as a rejected promise,
  // but a non-async function throwing synchronously bypasses the wrapper —
  // wrapping it in Promise.resolve(fn(...)) catches that path too.
  const handler = asyncHandler(() => { throw boom; });

  handler(req, res, next);
  await new Promise((r) => setImmediate(r));

  assert.equal(calls.next.length, 1);
  assert.equal(calls.next[0], boom);
});

test('asyncHandler does not swallow a resolved value', async () => {
  // The handler's resolved value is irrelevant to Express (it expects the
  // handler to have called res.* itself), but the wrapper must not interfere
  // with promise resolution — i.e. it must not turn a fulfilled promise into
  // a next(err) call.
  const { req, res, next, calls } = makeStubs();
  const handler = asyncHandler(async () => 'returned-value');

  handler(req, res, next);
  await new Promise((r) => setImmediate(r));

  assert.equal(calls.next.length, 0);
});
