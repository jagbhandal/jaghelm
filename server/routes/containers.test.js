/**
 * POST /api/containers/forget (#688) on the real app: a missing container is
 * forgotten (and stays so across a restart), a running one, an unknown one and a
 * bad body are refused, and nothing but the registry is touched.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-forget-'));
process.env.JAGHELM_DATA_DIR = dataDir;
delete process.env.DASH_PASS; // auth disabled
process.env.PROMETHEUS_URL = 'http://127.0.0.1:1';
process.env.KUMA_URL = 'http://127.0.0.1:1';
process.env.JAGHELM_ALLOW_OPEN_SECRETS = 'true'; // the fail-closed test is containers.auth.test.js

const { app } = await import('../index.js');
const { stopBackgroundRefresh } = await import('../refresh.js');
const { setCache } = await import('../cache.js');
const { containerRegistry } = await import('../containerRegistry.js');
const { createContainerRegistry } = await import('../containerRegistry.js');

const realFetch = globalThis.fetch;
// Forgetting runs a background cycle, which reads Prometheus and Kuma (refused
// here); nothing else is ever asked.
const asked = [];
globalThis.fetch = async (url) => {
  asked.push(String(url));
  throw new Error('refused');
};

after(() => {
  globalThis.fetch = realFetch;
  stopBackgroundRefresh();
  rmSync(dataDir, { recursive: true, force: true });
});

const missingCard = (container, extra = {}) => ({ uid: `vm103:${container}`, container, source: 'presence', ...extra });
const runningCard = (container) => ({ uid: `vm103:${container}`, container, source: 'container' });

// Wikijs ran for 10 min and was last seen 5 min ago: an established, absent container.
const seedGone = (name) => {
  const now = Date.now();
  containerRegistry.recordSeen(name, 'vm103', now - 10 * 60_000);
  containerRegistry.recordSeen(name, 'vm103', now - 5 * 60_000);
  containerRegistry.save();
};

beforeEach(() => {
  for (const name of Object.keys(containerRegistry.snapshot())) containerRegistry.forget(name);
  asked.length = 0;
  seedGone('wikijs');
  setCache('services', { nodes: { vm103: { services: [missingCard('wikijs', { mapped: 'Quartz Notes' }), runningCard('immich')] } } });
});

const forget = (body) => request(app).post('/api/containers/forget').send(body);

test('a missing container is forgotten: 200, gone from the registry and its file, only the registry changes', async () => {
  const res = await forget({ node: 'vm103', container: 'wikijs' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.forgotten, { node: 'vm103', container: 'wikijs' });
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(containerRegistry.getMissing().length, 0);
  const onDisk = JSON.parse(readFileSync(join(dataDir, 'container-registry.json'), 'utf8'));
  assert.equal(Object.hasOwn(onDisk, 'wikijs'), false, 'written at once, so a restart does not bring it back');
  assert.equal(createContainerRegistry({ path: join(dataDir, 'container-registry.json') }).getMissing().length, 0);
  assert.ok(asked.every((u) => u.startsWith('http://127.0.0.1:1')), `only the cycle's own sources: ${asked}`);
});

test('forgetting twice: the second is a 404', async () => {
  assert.equal((await forget({ node: 'vm103', container: 'wikijs' })).status, 200);
  assert.equal((await forget({ node: 'vm103', container: 'wikijs' })).status, 404);
});

test('a running container is a 409 and stays in the registry', async () => {
  containerRegistry.recordSeen('immich', 'vm103', Date.now());
  const res = await forget({ node: 'vm103', container: 'immich' });
  assert.equal(res.status, 409);
  assert.ok(containerRegistry.snapshot().immich);
});

test('a container missing on one node but running on another is a 409', async () => {
  setCache('services', { nodes: { vm103: { services: [missingCard('wikijs')] }, pi1: { services: [runningCard('wikijs')] } } });
  assert.equal((await forget({ node: 'vm103', container: 'wikijs' })).status, 409);
  assert.ok(containerRegistry.snapshot().wikijs);
});

test('an unknown container and the wrong node are a 404; a card that is not a missing one\'s is a 409', async () => {
  assert.equal((await forget({ node: 'vm103', container: 'nope' })).status, 404);
  assert.equal((await forget({ node: 'pi1', container: 'wikijs' })).status, 404);
    assert.equal((await forget({ node: 'vm103', container: 'immich' })).status, 409);
  // In the registry but with no card on the board.
  setCache('services', { nodes: { vm103: { services: [] } } });
  assert.equal((await forget({ node: 'vm103', container: 'wikijs' })).status, 404);
  assert.ok(containerRegistry.snapshot().wikijs);
});

test('a board not built yet is a 503', async () => {
  setCache('services', null, null, { ttlMs: 1 });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal((await forget({ node: 'vm103', container: 'wikijs' })).status, 503);
});

test('only POST: GET is not a route', async () => {
  assert.equal((await request(app).get('/api/containers/forget')).status, 404);
  assert.ok(existsSync(join(dataDir, 'container-registry.json')));
});
