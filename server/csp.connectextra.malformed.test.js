/**
 * CSP connect-src — malformed entry validation.
 *
 * CSP_CONNECT_EXTRA entries are NOT validated by helmet; we validate them
 * ourselves before passing to helmet. Entries that are not well-formed
 * http/https/wss/ws origins must be dropped (with a console.warn) so that
 * operators can't accidentally widen connect-src with wildcards, javascript:
 * URIs, or other garbage.
 *
 * This test boots with a mix of valid + malformed entries and asserts the CSP
 * header only contains the valid one.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-csp-mal-'));
process.env.JAGHELM_DATA_DIR = dataDir;
delete process.env.DASH_PASS;
process.env.PROMETHEUS_URL = 'http://127.0.0.1:1';
process.env.KUMA_URL = 'http://127.0.0.1:1';
// Set BEFORE import (cspDirectives is computed at module load).
// Mix of: wildcard (invalid), javascript: URI (invalid), valid https origin.
process.env.CSP_CONNECT_EXTRA = '*, javascript:alert(1), https://ok.test';

const { app } = await import('./index.js');
const { stopBackgroundRefresh } = await import('./refresh.js');

after(() => {
  stopBackgroundRefresh();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.CSP_CONNECT_EXTRA;
});

test('malformed CSP_CONNECT_EXTRA entries are dropped; valid https origin is kept', async () => {
  const r = await request(app).get('/api/health');
  const csp = r.headers['content-security-policy'] || '';

  // Valid entry must appear in connect-src.
  assert.match(csp, /connect-src[^;]*https:\/\/ok\.test/, 'valid https://ok.test must be in connect-src');

  // Malformed entries must NOT appear in connect-src.
  // Extract just the connect-src directive value.
  const connectSrcMatch = csp.match(/connect-src([^;]*)/);
  assert.ok(connectSrcMatch, 'connect-src directive must be present');
  const connectSrcValue = connectSrcMatch[1];

  // Bare wildcard '*' must be absent (would allow all origins).
  assert.ok(
    !connectSrcValue.split(/\s+/).includes('*'),
    `bare * must not appear in connect-src; got: ${connectSrcValue}`,
  );

  // javascript: URI must be absent.
  assert.ok(
    !connectSrcValue.includes('javascript:'),
    `javascript: must not appear in connect-src; got: ${connectSrcValue}`,
  );
});

test('desktop baseline: connect-src base origins are unchanged (self + CDNs)', async () => {
  const r = await request(app).get('/api/health');
  const csp = r.headers['content-security-policy'] || '';
  assert.match(csp, /connect-src[^;]*'self'/, "connect-src must include 'self'");
  assert.match(csp, /connect-src[^;]*https:\/\/cdn\.jsdelivr\.net/, 'connect-src must include jsdelivr CDN');
  assert.match(csp, /connect-src[^;]*https:\/\/raw\.githubusercontent\.com/, 'connect-src must include github raw');
});
