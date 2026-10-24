/**
 * The Web Push routes (#653) sit behind authMiddleware: with auth ENABLED
 * (DASH_PASS set) every /api/push/web/* route answers 401 to a request with no
 * session, and a bogus session, before reading its body. Auth is frozen at
 * module load, so this is a file of its own (see push.auth.test.js).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-webpush-auth-'));
process.env.JAGHELM_DATA_DIR = dataDir;
process.env.DASH_PASS = 'test-pass-1234'; // auth ENABLED (set before import)
delete process.env.VAPID_PUBLIC_KEY;
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
  ['get', '/api/push/web/key'],
  ['get', '/api/push/web/subscriptions'],
  ['post', '/api/push/web/subscriptions'],
  ['delete', '/api/push/web/subscriptions/0123456789ab'],
  ['post', '/api/push/web/test'],
];

test('every /api/push/web/* route → 401 without a session, and with a made-up one', async () => {
  for (const [method, path] of ROUTES) {
    const none = await request(app)[method](path).send({});
    assert.equal(none.status, 401, `${method.toUpperCase()} ${path} without a token`);
    const bogus = await request(app)[method](path).set('x-auth-token', 'not-a-session').send({});
    assert.equal(bogus.status, 401, `${method.toUpperCase()} ${path} with a bogus token`);
    assert.ok(!JSON.stringify(none.body).includes('publicKey'));
  }
});
