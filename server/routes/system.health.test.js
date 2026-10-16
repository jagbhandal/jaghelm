// server/routes/system.health.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import express from 'express';

process.env.JAGHELM_REVISION = '1a830fe5d2c4aaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const { systemRoutes: systemRouter } = await import('./system.js');
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

test('GET /api/health reports package version and 7-char build revision', async () => {
  const app = express();
  app.use('/api', systemRouter);
  const res = await request(app).get('/api/health');
  assert.equal(res.body.revision, '1a830fe');
  assert.equal(res.body.version, pkg.version);
});
