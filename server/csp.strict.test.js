/**
 * The CSP is fixed (#663). CSP_CONNECT_EXTRA once widened connect-src for the
 * retired Android WebView; it is gone, so setting it must change nothing.
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
// Set BEFORE import: the policy is built at module load.
process.env.CSP_CONNECT_EXTRA = 'https://example.test, https://two.test';

const { app } = await import('./index.js');
const { stopBackgroundRefresh } = await import('./refresh.js');

after(() => {
  stopBackgroundRefresh();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.CSP_CONNECT_EXTRA;
});

// What production sends today (read from the live server before this change).
const STRICT_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https://cdn.jsdelivr.net https://raw.githubusercontent.com",
  "connect-src 'self' https://cdn.jsdelivr.net https://raw.githubusercontent.com",
  "frame-src 'self' https: http:",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join(';');

const directive = (csp, name) =>
  csp
    .split(';')
    .map((d) => d.trim().split(/\s+/))
    .find(([n]) => n === name)
    ?.slice(1);
const cspOf = async () => (await request(app).get('/api/health')).headers['content-security-policy'];

test('the CSP is exactly the strict policy, and CSP_CONNECT_EXTRA no longer has any effect', async () => {
  assert.equal(await cspOf(), STRICT_CSP);
});

test('connect-src is self and the two icon hosts only', async () => {
  assert.deepEqual(directive(await cspOf(), 'connect-src'), [
    "'self'",
    'https://cdn.jsdelivr.net',
    'https://raw.githubusercontent.com',
  ]);
});

test('the extra origins appear in no directive', async () => {
  const csp = await cspOf();
  assert.ok(!csp.includes('example.test') && !csp.includes('two.test'));
});

test('script-src stays self only', async () => {
  assert.deepEqual(directive(await cspOf(), 'script-src'), ["'self'"]);
});

test('the policy is enforcing, not report-only', async () => {
  const r = await request(app).get('/api/health');
  assert.ok(r.headers['content-security-policy']);
  assert.equal(r.headers['content-security-policy-report-only'], undefined);
});

test('the policy is the same on another route', async () => {
  const r = await request(app).get('/');
  assert.equal(r.headers['content-security-policy'], STRICT_CSP);
});
