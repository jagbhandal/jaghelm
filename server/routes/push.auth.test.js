/**
 * Push routes sit behind authMiddleware. With auth ENABLED (DASH_PASS set), every
 * /api/push/* route rejects a request with NO x-auth-token header with 401 — that
 * alone proves the gate. JagHelm auth is token=session via x-auth-token; there is
 * no username/password login to perform here. Auth is frozen at module load
 * (DASH_PASS is read once in passwords.js), so this MUST be a separate file from
 * push.test.js — set DASH_PASS before importing the app.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-push-auth-'));
process.env.JAGHELM_DATA_DIR = dataDir;
process.env.DASH_PASS = 'test-pass-1234'; // auth ENABLED (set before import)
delete process.env.FCM_SERVICE_ACCOUNT;
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
process.env.PROMETHEUS_URL = 'http://127.0.0.1:1';
process.env.KUMA_URL = 'http://127.0.0.1:1';

const { app } = await import('../index.js');
const { stopBackgroundRefresh } = await import('../refresh.js');

after(() => {
  stopBackgroundRefresh();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DASH_PASS;
});

const ROUTES = [
  ['get', '/api/push/status'],
  ['get', '/api/push/prefs?token=t'],
  ['put', '/api/push/prefs'],
  ['post', '/api/push/register'],
  ['delete', '/api/push/register'],
];

test('every /api/push/* route → 401 without an x-auth-token header', async () => {
  for (const [method, path] of ROUTES) {
    const r = await request(app)[method](path).send({});
    assert.equal(r.status, 401, `${method.toUpperCase()} ${path} should 401 without a token`);
    assert.match(r.headers['content-type'], /json/);
  }
});
