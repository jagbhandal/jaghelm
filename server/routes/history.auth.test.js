/**
 * GET /api/history (#311) sits behind authMiddleware: with auth enabled
 * (DASH_PASS set), a request without an x-auth-token is a 401, and Prometheus
 * is never asked. Auth is frozen at module load (DASH_PASS is read once in
 * passwords.js), so this is a file of its own, apart from history.test.js.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-history-auth-'));
process.env.JAGHELM_DATA_DIR = dataDir;
process.env.DASH_PASS = 'test-pass-1234'; // auth ENABLED (set before import) // pragma: allowlist secret
process.env.PROMETHEUS_URL = 'http://127.0.0.1:1';
process.env.KUMA_URL = 'http://127.0.0.1:1';

const { app } = await import('../index.js');
const { stopBackgroundRefresh } = await import('../refresh.js');

const realFetch = globalThis.fetch;
let fetched = 0;
globalThis.fetch = async () => {
  fetched += 1;
  throw new Error('nothing is fetched for a refused request');
};

after(() => {
  globalThis.fetch = realFetch;
  stopBackgroundRefresh();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DASH_PASS;
});

test('GET /api/history without a session is a 401', async () => {
  for (const path of [
    '/api/history?series=node.cpu&range=1h',
    '/api/history?series=container.memory&entity=apps/db&range=7d',
    '/api/history',
  ]) {
    const res = await request(app).get(path);
    assert.equal(res.status, 401, path);
  }
  assert.equal(fetched, 0);
});
