/**
 * GET /api/history: ETag + 304 through cache.jsonWithEtag, so a poll that lands
 * before the refresh loop has recorded a new sample costs no body. Runs against
 * the real app, which turns Express's own ETags off. The data dir is set before
 * importing it.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-history-'));
process.env.JAGHELM_DATA_DIR = dataDir;
process.env.PROMETHEUS_URL = 'http://127.0.0.1:1';
process.env.KUMA_URL = 'http://127.0.0.1:1';

const { app } = await import('../index.js');
const { stopBackgroundRefresh } = await import('../refresh.js');
const { recordSample, _reset } = await import('../history.js');

after(() => {
  stopBackgroundRefresh();
  _reset();
  rmSync(dataDir, { recursive: true, force: true });
});

test('GET /history sends an ETag and answers a matching If-None-Match with 304', async () => {
  _reset();
  recordSample('n1:cpu', 12);
  const first = await request(app).get('/api/history');
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, { 'n1:cpu': [12] });
  assert.ok(first.headers.etag, 'ETag header');

  const again = await request(app).get('/api/history').set('If-None-Match', first.headers.etag);
  assert.equal(again.status, 304);
  assert.equal(again.text, '');
});

test('a new sample changes the ETag, so the next poll gets the new series', async () => {
  _reset();
  recordSample('n1:cpu', 12);
  const first = await request(app).get('/api/history');
  recordSample('n1:cpu', 40);
  const next = await request(app).get('/api/history').set('If-None-Match', first.headers.etag);
  assert.equal(next.status, 200);
  assert.deepEqual(next.body, { 'n1:cpu': [12, 40] });
  assert.notEqual(next.headers.etag, first.headers.etag);
});
