/**
 * CSP connect-src extension. CSP_CONNECT_EXTRA lets a self-hoster widen
 * connectSrc (e.g. a WebView-fetch fallback deployment) without editing source.
 * Additive + fallback-only: unset ⇒ connect-src is byte-for-byte as today.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-csp-'));
process.env.JAGHELM_DATA_DIR = dataDir;
delete process.env.DASH_PASS;
process.env.PROMETHEUS_URL = 'http://127.0.0.1:1';
process.env.KUMA_URL = 'http://127.0.0.1:1';
// Set BEFORE import (cspDirectives is computed at module load).
process.env.CSP_CONNECT_EXTRA = 'https://example.test, ,  https://two.test';

const { app } = await import('./index.js');
const { stopBackgroundRefresh } = await import('./refresh.js');

after(() => {
  stopBackgroundRefresh();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.CSP_CONNECT_EXTRA;
});

test('CSP_CONNECT_EXTRA appends trimmed, non-empty origins to connect-src', async () => {
  const r = await request(app).get('/api/health');
  const csp = r.headers['content-security-policy'] || '';
  // Existing defaults still present (byte-for-byte base preserved).
  assert.match(csp, /connect-src[^;]*'self'/);
  assert.match(csp, /connect-src[^;]*https:\/\/cdn\.jsdelivr\.net/);
  // Extras appended; empty/whitespace entries filtered out.
  assert.match(csp, /connect-src[^;]*https:\/\/example\.test/);
  assert.match(csp, /connect-src[^;]*https:\/\/two\.test/);
});
