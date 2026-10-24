/** GET /api/logs (#672) is behind authMiddleware: no session, a 401, and Loki is never asked. */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-logs-auth-'));
process.env.JAGHELM_DATA_DIR = dataDir;
process.env.DASH_PASS = 'test-pass-1234'; // auth ENABLED (set before import) // pragma: allowlist secret
process.env.PROMETHEUS_URL = 'http://127.0.0.1:1';
process.env.KUMA_URL = 'http://127.0.0.1:1';
process.env.LOKI_URL = 'http://localhost:9995';

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

test('GET /api/logs without a session is a 401', async () => {
  const res = await request(app).get('/api/logs?entity=pve');
  assert.equal(res.status, 401);
  assert.equal(fetched, 0);
});
