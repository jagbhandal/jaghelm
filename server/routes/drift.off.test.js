/** Config drift (#674) without JAGHELM_CRON_SECRET: the endpoint is off and the row is absent. */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-drift-off-'));
process.env.JAGHELM_DATA_DIR = dataDir;
process.env.DASH_PASS = 'test-pass-1234';
delete process.env.JAGHELM_CRON_SECRET;
process.env.PROMETHEUS_URL = 'http://127.0.0.1:1';
process.env.KUMA_URL = 'http://127.0.0.1:1';

const { app } = await import('../index.js');
const { stopBackgroundRefresh } = await import('../refresh.js');
const { createSession } = await import('../auth/sessions.js');
const token = createSession('admin');
after(() => {
  stopBackgroundRefresh();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DASH_PASS;
});

test('without the secret a push is 401 (even an empty secret) and the read says not configured', async () => {
  for (const secret of ['', undefined, 'x']) {
    const r = await request(app)
      .post('/api/drift/report')
      .send({ secret, host: 'a', checkedAt: new Date().toISOString(), status: 'ok', items: [] });
    assert.equal(r.status, 401);
  }
  const r = await request(app).get('/api/drift').set('x-auth-token', token);
  assert.deepEqual(r.body, { configured: false });
});
