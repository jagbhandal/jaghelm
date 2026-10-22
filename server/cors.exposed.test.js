/**
 * CORS exposedHeaders contract. exposedHeaders:['ETag'] is REQUIRED only on the
 * WebView-fetch fallback (cross-origin JS can't read ETag by default, which
 * would silently break useData.js's If-None-Match 304 caching). It is additive:
 * unset CORS_ORIGIN ⇒ no Access-Control-Expose-Headers (desktop unchanged).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-cors-'));
process.env.JAGHELM_DATA_DIR = dataDir;
delete process.env.DASH_PASS; // auth disabled
process.env.PROMETHEUS_URL = 'http://127.0.0.1:1';
process.env.KUMA_URL = 'http://127.0.0.1:1';
// Set the allow-list BEFORE importing the app (CORS config is module-load).
process.env.CORS_ORIGIN = 'capacitor://localhost,https://localhost';

const { app } = await import('./index.js');
const { stopBackgroundRefresh } = await import('./refresh.js');

after(() => {
  stopBackgroundRefresh();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.CORS_ORIGIN;
});

test('with CORS_ORIGIN set, responses expose ETag for cross-origin 304 caching', async () => {
  const r = await request(app)
    .get('/api/health')
    .set('Origin', 'https://localhost');
  assert.equal(r.status, 200);
  const exposed = (r.headers['access-control-expose-headers'] || '').toLowerCase();
  assert.match(exposed, /etag/, 'ETag must be in Access-Control-Expose-Headers');
});

// #499: the status's age is the server's own Date less its Last-Modified, so
// a cross-origin page reads Date too (Last-Modified is CORS-safelisted).
test('with CORS_ORIGIN set, responses expose Date, for the age by the server clock', async () => {
  const r = await request(app).get('/api/health').set('Origin', 'https://localhost');
  const exposed = (r.headers['access-control-expose-headers'] || '').toLowerCase();
  assert.match(exposed, /(^|,\s*)date(\s*,|$)/, 'Date must be in Access-Control-Expose-Headers');
});
