// server/routes/watchtower.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import { createWatchtowerRoutes } from './watchtower.js';

function makeApp(overrides = {}) {
  const calls = { dispatch: [], discord: [] };
  const deps = {
    store: {}, fcm: {},
    dispatch: async (events) => { calls.dispatch.push(events); },
    postDiscord: async (url, content) => { calls.discord.push({ url, content }); return { ok: true }; },
    dedup: { isDuplicate: () => false },
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
