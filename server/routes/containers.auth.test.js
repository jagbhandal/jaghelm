/** POST /api/containers/forget (#688) is behind a session, and refused with no dashboard password set. */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-forget-auth-'));
process.env.JAGHELM_DATA_DIR = dataDir;
process.env.PROMETHEUS_URL = 'http://127.0.0.1:1';
process.env.KUMA_URL = 'http://127.0.0.1:1';
delete process.env.JAGHELM_ALLOW_OPEN_SECRETS;
delete process.env.DASH_PASS; // no password: fail closed

const { app } = await import('../index.js');
const { stopBackgroundRefresh } = await import('../refresh.js');
const { setCache } = await import('../cache.js');
const { containerRegistry } = await import('../containerRegistry.js');

after(() => {
  stopBackgroundRefresh();
  rmSync(dataDir, { recursive: true, force: true });
});

test('with no dashboard password set, forget is a 403 and the container stays', async () => {
  const now = Date.now();
  containerRegistry.recordSeen('wikijs', 'vm103', now - 10 * 60_000);
  containerRegistry.recordSeen('wikijs', 'vm103', now - 5 * 60_000);
  setCache('services', { nodes: { vm103: { reachable: true, services: [{ uid: 'vm103:wikijs', container: 'wikijs', source: 'presence' }] } } });
  const res = await request(app).post('/api/containers/forget').send({ node: 'vm103', container: 'wikijs' });
  assert.equal(res.status, 403);
  assert.ok(containerRegistry.snapshot().wikijs);
});
