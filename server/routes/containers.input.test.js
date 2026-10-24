/**
 * POST /api/containers/forget (#688), the route alone on a bare app with a stub
 * registry: strict input, size and content type, and the rate limit.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

import { createContainersRoutes } from './containers.js';
import { createRateLimiter } from '../util/rateLimiter.js';

function build(limiter, refreshNow = async () => true) {
  const forgotten = [];
  const registry = {
    getMissing: () => [{ container: 'wikijs' }],
    forget: (name) => forgotten.push(name),
  };
  const board = { nodes: { vm103: { services: [{ uid: 'vm103:wikijs', container: 'wikijs', source: 'presence' }] } } };
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/f', createContainersRoutes({ registry, services: () => board, limiter, refreshNow }));
  return { app, forgotten };
}
const post = (app, body) =>
  request(app).post('/f/forget').type('json').send(JSON.stringify(body));

test('bad input is a 400: wrong keys, extra keys, non-strings, empty, long, control characters, arrays', async () => {
  const { app, forgotten } = build(() => true);
  for (const body of [
    {},
    { node: 'vm103' },
    { container: 'wikijs' },
    { node: 'vm103', container: 'wikijs', all: true },
    { node: 'vm103', container: 'wikijs', __proto__: 'x', constructor: 1 },
    { node: 1, container: 'wikijs' },
    { node: 'vm103', container: ['wikijs'] },
    { node: '', container: 'wikijs' },
    { node: 'vm103', container: 'w'.repeat(201) },
    { node: 'vm103', container: 'wiki\njs' },
    ['vm103', 'wikijs'],
    'wikijs',
    null,
  ]) {
    const res = await post(app, body);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  assert.deepEqual(forgotten, []);
});

test('a body that is not JSON is a 415, and an oversized one a 413', async () => {
  const { app, forgotten } = build(() => true);
  const text = await request(app).post('/f/forget').type('text/plain').send('node=vm103&container=wikijs');
  assert.equal(text.status, 415);
  const big = await post(app, { node: 'vm103', container: 'wikijs', pad: 'x'.repeat(2000) });
  assert.equal(big.status, 413);
  assert.deepEqual(forgotten, []);
});

test('past its limit a try is a 429, and forgets nothing', async () => {
  const { app, forgotten } = build(createRateLimiter({ max: 2, windowMs: 60_000 }));
  assert.equal((await post(app, { node: 'vm103', container: 'nope' })).status, 404);
  assert.equal((await post(app, { node: 'vm103', container: 'nope' })).status, 404);
  assert.equal((await post(app, { node: 'vm103', container: 'wikijs' })).status, 429);
  assert.deepEqual(forgotten, []);
});

test('a valid body forgets the container once', async () => {
  const { app, forgotten } = build(() => true);
  const res = await post(app, { node: 'vm103', container: 'wikijs' });
  assert.equal(res.status, 200);
  assert.deepEqual(forgotten, ['wikijs']);
});

test('after forgetting it runs a cycle, and says whether it could', async () => {
  let cycles = 0;
  const ran = build(() => true, async () => (cycles += 1) > 0);
  assert.deepEqual((await post(ran.app, { node: 'vm103', container: 'wikijs' })).body, {
    forgotten: { node: 'vm103', container: 'wikijs' },
    refreshed: true,
  });
  assert.equal(cycles, 1);
  const late = build(() => true, async () => false);
  assert.equal((await post(late.app, { node: 'vm103', container: 'wikijs' })).body.refreshed, false);
  // A refused try runs no cycle.
  assert.equal((await post(ran.app, { node: 'vm103', container: 'nope' })).status, 404);
  assert.equal(cycles, 1);
});
