/** POST /api/containers/forget (#688) with a dashboard password set: no session is a 401, and the container stays. */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-forget-session-'));
process.env.JAGHELM_DATA_DIR = dataDir;
process.env.DASH_PASS = 'test-pass-1234'; // auth ENABLED (set before import) // pragma: allowlist secret
process.env.PROMETHEUS_URL = 'http://127.0.0.1:1';
process.env.KUMA_URL = 'http://127.0.0.1:1';
delete process.env.JAGHELM_ALLOW_OPEN_SECRETS;

const { app } = await import('../index.js');
const { stopBackgroundRefresh } = await import('../refresh.js');
const { setCache } = await import('../cache.js');
const { containerRegistry } = await import('../containerRegistry.js');

after(() => {
  stopBackgroundRefresh();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DASH_PASS;
});

test('with a password set, no x-auth-token or a wrong one is a 401 (not the 403 of an open instance)', async () => {
  const now = Date.now();
  containerRegistry.recordSeen('wikijs', 'vm103', now - 10 * 60_000);
  containerRegistry.recordSeen('wikijs', 'vm103', now - 5 * 60_000);
  setCache('services', {
    nodes: { vm103: { reachable: true, services: [{ uid: 'vm103:wikijs', container: 'wikijs', source: 'presence' }, { uid: 'vm103:gitea', container: 'gitea', source: 'container' }] } },
  });
  const body = { node: 'vm103', container: 'wikijs' };
  assert.equal((await request(app).post('/api/containers/forget').send(body)).status, 401);
  assert.equal((await request(app).post('/api/containers/forget').set('x-auth-token', 'nope').send(body)).status, 401);
  assert.ok(containerRegistry.snapshot().wikijs);
});
