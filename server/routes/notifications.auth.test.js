/**
 * Settings → Notifications' routes (#320) sit behind authMiddleware: with auth
 * enabled, each answers 401 to a request with no x-auth-token, and changes
 * nothing. A file of its own: auth is fixed at module load (DASH_PASS, read
 * once), so it is set before the app is imported (push.auth.test.js).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-notifications-auth-'));
process.env.JAGHELM_DATA_DIR = dataDir;
process.env.DASH_PASS = 'test-pass-1234'; // pragma: allowlist secret
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
  ['get', '/api/thresholds'],
  ['put', '/api/thresholds', { cpu: { warn: 80, unit: '%' } }],
  ['get', '/api/push/devices'],
  ['delete', '/api/push/devices/0123456789ab'],
  ['post', '/api/push/test', {}],
];

test('each Settings → Notifications route → 401 without an x-auth-token, and nothing saved', async () => {
  for (const [method, path, body] of ROUTES) {
    const agent = request(app);
    const r = await agent[method](path)
      .set('If-Match', '"absent"')
      .send(body ?? {});
    assert.equal(r.status, 401, `${method.toUpperCase()} ${path} should 401 without a token`);
    assert.match(r.headers['content-type'], /json/);
  }
  assert.equal(existsSync(join(dataDir, 'thresholds.json')), false);
});
