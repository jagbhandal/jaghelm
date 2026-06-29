// server/routes/watchtower.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import { createWatchtowerRoutes } from './watchtower.js';

const NO_TRANSITION = { newlyHeldBack: [], cleared: [], current: [] };

function makeApp(overrides = {}) {
  const calls = { dispatch: [], discord: [] };
  const deps = {
    store: {}, fcm: {},
    dispatch: async (events) => { calls.dispatch.push(events); },
    postDiscord: async (url, content) => { calls.discord.push({ url, content }); return { ok: true }; },
    dedup: { isDuplicate: () => false },
    heldBackStore: { diffAndSet: () => NO_TRANSITION, getNode: () => [] },
    getEnv: () => ({ JAGHELM_WATCHTOWER_SECRET: 's3cret', JAGHELM_WATCHTOWER_DISCORD_WEBHOOK: 'https://discord.com/api/webhooks/1/abc' }),
    logger: { warn() {}, info() {} },
    ...overrides,
  };
  const app = express();
  app.use(express.json());
  app.use('/api/watchtower', createWatchtowerRoutes(deps));
  return { app, calls };
}

const GOOD = { secret: 's3cret', node: 'vm-101', message: 'updated|radarr|v1|v2' };

test('401 when secret missing/wrong; no fan-out', async () => {
  const { app, calls } = makeApp();
  const r = await request(app).post('/api/watchtower/event').send({ ...GOOD, secret: 'nope' });
  assert.equal(r.status, 401);
  assert.equal(calls.dispatch.length, 0);
  assert.equal(calls.discord.length, 0);
});

test('valid update fans out once to push and once to discord', async () => {
  const { app, calls } = makeApp();
  const r = await request(app).post('/api/watchtower/event').send(GOOD);
  assert.equal(r.status, 200);
  assert.equal(r.body.updated, 1);
  assert.equal(calls.dispatch.length, 1);
  assert.equal(calls.dispatch[0][0].type, 'watchtower_update');
  assert.equal(calls.discord.length, 1);
  assert.match(calls.discord[0].content, /radarr/);
});

test('empty report is skipped (no fan-out)', async () => {
  const { app, calls } = makeApp();
  const r = await request(app).post('/api/watchtower/event').send({ secret: 's3cret', node: 'vm-101', message: 'scanned|3' });
  assert.equal(r.status, 200);
  assert.equal(r.body.skipped, 'empty');
  assert.equal(calls.dispatch.length, 0);
});

test('duplicate report is not re-sent', async () => {
  const { app, calls } = makeApp({ dedup: { isDuplicate: () => true } });
  const r = await request(app).post('/api/watchtower/event').send(GOOD);
  assert.equal(r.body.deduped, true);
  assert.equal(calls.dispatch.length, 0);
});

test('discord failure does not block push (and vice versa)', async () => {
  const { app, calls } = makeApp({ postDiscord: async () => { throw new Error('discord 500'); } });
  const r = await request(app).post('/api/watchtower/event').send(GOOD);
  assert.equal(r.status, 200);
  assert.equal(calls.dispatch.length, 1); // push still happened
});

test('push dispatch failure does not block discord', async () => {
  const { app, calls } = makeApp({ dispatch: async () => { throw new Error('fcm 500'); } });
  const r = await request(app).post('/api/watchtower/event').send(GOOD);
  assert.equal(r.status, 200);
  assert.equal(calls.discord.length, 1); // discord still happened
});

test('stale-only report (no updated/failed) still notifies on a new held-back', async () => {
  const held = [{ name: 'vaultwarden', current: '1a', latest: '2b' }];
  const { app, calls } = makeApp({
    heldBackStore: { diffAndSet: () => ({ newlyHeldBack: held, cleared: [], current: held }), getNode: () => held },
  });
  const r = await request(app).post('/api/watchtower/event')
    .send({ secret: 's3cret', node: 'vm-101', message: 'stale|vaultwarden|1a|2b' });
  assert.equal(r.status, 200);
  assert.equal(r.body.heldBack, 1);
  assert.equal(calls.dispatch.length, 1);
  assert.equal(calls.dispatch[0][0].type, 'watchtower_heldback');
  assert.match(calls.discord[0].content, /Held back \(1\): vaultwarden/);
});

test('a stale set with no transition skips the fan-out (no per-cycle spam)', async () => {
  const { app, calls } = makeApp({
    // stale present but unchanged => no transitions
    heldBackStore: { diffAndSet: () => ({ newlyHeldBack: [], cleared: [], current: [{ name: 'x', current: '1', latest: '2' }] }), getNode: () => [] },
  });
  const r = await request(app).post('/api/watchtower/event')
    .send({ secret: 's3cret', node: 'vm-101', message: 'stale|x|1|2' });
  assert.equal(r.status, 200);
  assert.equal(r.body.skipped, 'no-change');
  assert.equal(calls.dispatch.length, 0);
  assert.equal(calls.discord.length, 0);
});

test('a cleared (caught-up) transition fires a recovery push', async () => {
  const cleared = [{ name: 'vaultwarden', current: '1a', latest: '2b' }];
  const { app, calls } = makeApp({
    heldBackStore: { diffAndSet: () => ({ newlyHeldBack: [], cleared, current: [] }), getNode: () => [] },
  });
  const r = await request(app).post('/api/watchtower/event')
    .send({ secret: 's3cret', node: 'vm-101', message: 'scanned|3' });
  assert.equal(r.status, 200);
  assert.equal(r.body.cleared, 1);
  assert.equal(calls.dispatch[0][0].type, 'watchtower_cleared');
  assert.match(calls.discord[0].content, /Caught up: vaultwarden/);
});

test('mixed run fans an update event AND a held-back event together', async () => {
  const held = [{ name: 'vaultwarden', current: '1a', latest: '2b' }];
  const { app, calls } = makeApp({
    heldBackStore: { diffAndSet: () => ({ newlyHeldBack: held, cleared: [], current: held }), getNode: () => held },
  });
  const r = await request(app).post('/api/watchtower/event')
    .send({ secret: 's3cret', node: 'vm-101', message: 'updated|radarr|v1|v2\nstale|vaultwarden|1a|2b' });
  assert.equal(r.status, 200);
  const types = calls.dispatch[0].map((e) => e.type);
  assert.deepEqual(types, ['watchtower_update', 'watchtower_heldback']);
  assert.match(calls.discord[0].content, /Updated: radarr/);
  assert.match(calls.discord[0].content, /Held back \(1\)/);
});

test('a deduped event with a new held-back still notifies the held-back', async () => {
  const held = [{ name: 'vaultwarden', current: '1a', latest: '2b' }];
  const { app, calls } = makeApp({
    dedup: { isDuplicate: () => true }, // the updated/failed part is a retry
    heldBackStore: { diffAndSet: () => ({ newlyHeldBack: held, cleared: [], current: held }), getNode: () => held },
  });
  const r = await request(app).post('/api/watchtower/event')
    .send({ secret: 's3cret', node: 'vm-101', message: 'updated|radarr|v1|v2\nstale|vaultwarden|1a|2b' });
  assert.equal(r.status, 200);
  const types = calls.dispatch[0].map((e) => e.type);
  assert.deepEqual(types, ['watchtower_heldback']); // update suppressed, held-back kept
  assert.equal(r.body.updated, 0);
});

test('mounted app: unknown secret rejected (mount smoke)', async () => {
  const { app } = (() => {
    const a = express();
    a.use(express.json());
    a.use('/api/watchtower', createWatchtowerRoutes({
      store: {}, fcm: {},
      dispatch: async () => {}, postDiscord: async () => ({ ok: true }),
      dedup: { isDuplicate: () => false },
      getEnv: () => ({ JAGHELM_WATCHTOWER_SECRET: 'x' }),
    }));
    return { app: a };
  })();
  const r = await request(app).post('/api/watchtower/event').send({ secret: 'wrong', message: 'updated|a|1|2' });
  assert.equal(r.status, 401);
});
