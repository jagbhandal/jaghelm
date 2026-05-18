/**
 * Tests for handler.js SSRF guard + res.ok handling.
 *
 * We don't run the full fetchIntegration pipeline here — that requires presets,
 * cache, etc. We exercise:
 *   1. assertSafeUrl() directly (the guard's pure-function core).
 *   2. fetchIntegration() with a stubbed safeFetch via globalThis.fetch override,
 *      to confirm a non-2xx response surfaces an error instead of being parsed
 *      as data.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { assertSafeUrl } from './handler.js';

test('assertSafeUrl: rejects non-http schemes', () => {
  assert.throws(() => assertSafeUrl('file:///etc/passwd'), /Blocked URL scheme/);
  assert.throws(() => assertSafeUrl('gopher://example.com/'), /Blocked URL scheme/);
  assert.throws(() => assertSafeUrl('data:text/plain,hello'), /Blocked URL scheme/);
});

test('assertSafeUrl: always blocks cloud-metadata IP and 0.0.0.0', () => {
  assert.throws(() => assertSafeUrl('http://169.254.169.254/latest/meta-data/'), /Blocked host/);
  assert.throws(() => assertSafeUrl('http://0.0.0.0/'), /Blocked host/);
});

test('assertSafeUrl: default (permissive) allows private/loopback hosts — homelab use case', () => {
  // No JAGHELM_BLOCK_PRIVATE_NETWORKS env → permissive.
  assert.doesNotThrow(() => assertSafeUrl('http://localhost/'));
  assert.doesNotThrow(() => assertSafeUrl('http://127.0.0.1/'));
  assert.doesNotThrow(() => assertSafeUrl('http://10.0.0.1/'));
  assert.doesNotThrow(() => assertSafeUrl('http://192.168.68.10/api2/json/'));   // Proxmox
  assert.doesNotThrow(() => assertSafeUrl('http://172.16.0.1/'));
  assert.doesNotThrow(() => assertSafeUrl('http://[::1]/'));
  assert.doesNotThrow(() => assertSafeUrl('http://[fc00::1]/'));
});

test('assertSafeUrl: default allows public hosts', () => {
  assert.doesNotThrow(() => assertSafeUrl('http://8.8.8.8/'));
  assert.doesNotThrow(() => assertSafeUrl('https://1.1.1.1/'));
  assert.doesNotThrow(() => assertSafeUrl('https://api.example.com:8443/path'));
});

test('assertSafeUrl: rejects malformed URLs', () => {
  assert.throws(() => assertSafeUrl('not a url'), /Invalid URL/);
  assert.throws(() => assertSafeUrl(''), /Invalid URL/);
});

test('assertSafeUrl: strict mode (JAGHELM_BLOCK_PRIVATE_NETWORKS=true) blocks private ranges', (t) => {
  const original = process.env.JAGHELM_BLOCK_PRIVATE_NETWORKS;
  process.env.JAGHELM_BLOCK_PRIVATE_NETWORKS = 'true';
  t.after(() => {
    if (original === undefined) delete process.env.JAGHELM_BLOCK_PRIVATE_NETWORKS;
    else process.env.JAGHELM_BLOCK_PRIVATE_NETWORKS = original;
  });

  assert.throws(() => assertSafeUrl('http://localhost/'), /Blocked host/);
  assert.throws(() => assertSafeUrl('http://127.0.0.1/'), /private IPv4/);
  assert.throws(() => assertSafeUrl('http://10.0.0.1/'), /private IPv4/);
  assert.throws(() => assertSafeUrl('http://192.168.1.1/'), /private IPv4/);
  assert.throws(() => assertSafeUrl('http://172.16.0.1/'), /private IPv4/);
  assert.throws(() => assertSafeUrl('http://[::1]/'), /private IPv6/);
  assert.throws(() => assertSafeUrl('http://[fc00::1]/'), /private IPv6/);
  assert.throws(() => assertSafeUrl('http://[::ffff:127.0.0.1]/'), /private IPv6/);

  // Public targets still allowed in strict mode.
  assert.doesNotThrow(() => assertSafeUrl('http://8.8.8.8/'));
  // Boundary: 172.32 is outside 172.16/12.
  assert.doesNotThrow(() => assertSafeUrl('http://172.32.0.1/'));
  assert.doesNotThrow(() => assertSafeUrl('http://172.15.0.1/'));
});

// ── res.ok handling ───────────────────────────────────────────────────────
// Stub global fetch to simulate an HTML error page (non-2xx) and confirm
// fetchIntegration surfaces an error instead of parsing HTML as JSON.

test('fetchIntegration: rejects non-2xx responses with HTTP status', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 502,
    statusText: 'Bad Gateway',
    json: async () => { throw new Error('Should not parse'); },
  });
  t.after(() => { globalThis.fetch = originalFetch; });

  // Import after stub so the module sees the override. (Module is cached,
  // but the call site uses the live globalThis.fetch via safeFetch.)
  const { fetchIntegration } = await import('./handler.js');

  // Use a minimal yamlConfig that doesn't depend on presets. fetchIntegration
  // returns { error, fields } on failure rather than throwing.
  const result = await fetchIntegration('__test_502__', {
    url: 'https://api.example.com',
    endpoint: '/status',
    fields: [],
  }, /* bustCache */ true);

  assert.equal(result.error?.startsWith('HTTP 502'), true,
    `Expected error to start with "HTTP 502", got: ${result.error}`);
  assert.deepEqual(result.fields, {});
});
