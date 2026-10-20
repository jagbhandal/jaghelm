import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertSafeUrl } from './ssrf.js';

test('blocks non-http(s) schemes', () => {
  for (const u of ['file:///etc/passwd', 'gopher://x/', 'data:text/plain,hi', 'ftp://x/']) {
    assert.throws(() => assertSafeUrl(u), /Blocked URL scheme/, u);
  }
});

test('always blocks cloud metadata + 0/8 (even outside strict mode)', () => {
  delete process.env.JAGHELM_BLOCK_PRIVATE_NETWORKS;
  assert.throws(() => assertSafeUrl('http://169.254.169.254/latest/meta-data/'), /Blocked host/);
  assert.throws(() => assertSafeUrl('http://0.0.0.0/'), /Blocked host/);
});

test('non-strict mode allows private homelab targets (the default)', () => {
  delete process.env.JAGHELM_BLOCK_PRIVATE_NETWORKS;
  assert.doesNotThrow(() => assertSafeUrl('http://192.168.1.10:9090/'));
  assert.doesNotThrow(() => assertSafeUrl('http://10.0.0.5/'));
});

test('strict mode blocks private / loopback / link-local', () => {
  process.env.JAGHELM_BLOCK_PRIVATE_NETWORKS = 'true';
  try {
    for (const u of [
      'http://192.168.1.10/',
      'http://10.0.0.5/',
      'http://127.0.0.1/',
      'http://172.16.0.1/',
      'http://localhost/',
      'http://[::1]/',
    ]) {
      assert.throws(() => assertSafeUrl(u), /Blocked/, u);
    }
  } finally {
    delete process.env.JAGHELM_BLOCK_PRIVATE_NETWORKS;
  }
});

test('strict mode catches obfuscated IPv4 (decimal/hex/octal normalize via the URL parser)', () => {
  process.env.JAGHELM_BLOCK_PRIVATE_NETWORKS = 'true';
  try {
    assert.throws(() => assertSafeUrl('http://2130706433/'), /Blocked/); // decimal 127.0.0.1
    assert.throws(() => assertSafeUrl('http://0x7f000001/'), /Blocked/); // hex 127.0.0.1
    assert.throws(() => assertSafeUrl('http://0177.0.0.1/'), /Blocked/); // octal 127.0.0.1
  } finally {
    delete process.env.JAGHELM_BLOCK_PRIVATE_NETWORKS;
  }
});

test('strict mode catches IPv4-mapped IPv6 (dotted and hex-normalized forms)', () => {
  process.env.JAGHELM_BLOCK_PRIVATE_NETWORKS = 'true';
  try {
    assert.throws(() => assertSafeUrl('http://[::ffff:127.0.0.1]/'), /Blocked/);
    assert.throws(() => assertSafeUrl('http://[::ffff:7f00:1]/'), /Blocked/); // hex 127.0.0.1
  } finally {
    delete process.env.JAGHELM_BLOCK_PRIVATE_NETWORKS;
  }
});

test('trusted infra callers are exempt from the private block — but never from metadata', () => {
  process.env.JAGHELM_BLOCK_PRIVATE_NETWORKS = 'true';
  try {
    assert.doesNotThrow(() => assertSafeUrl('http://192.168.1.10:9090/', { trusted: true }));
    assert.doesNotThrow(() => assertSafeUrl('http://127.0.0.1:3001/', { trusted: true }));
    assert.throws(() => assertSafeUrl('http://169.254.169.254/', { trusted: true }), /Blocked host/);
  } finally {
    delete process.env.JAGHELM_BLOCK_PRIVATE_NETWORKS;
  }
});

test('rejects malformed URLs', () => {
  assert.throws(() => assertSafeUrl('not a url'), /Invalid URL/);
});

test('always blocks the IPv6 unspecified address :: (0.0.0.0 equivalent), even outside strict mode', () => {
  assert.throws(() => assertSafeUrl('http://[::]/'), /Blocked host/);
  assert.throws(() => assertSafeUrl('http://[::ffff:0.0.0.0]/'), /Blocked host/);
  assert.throws(() => assertSafeUrl('http://[0:0:0:0:0:0:0:0]/'), /Blocked host/);
});

test('the metadata address and 0/8 written as IPv6 are blocked too, even outside strict mode', () => {
  delete process.env.JAGHELM_BLOCK_PRIVATE_NETWORKS;
  // Node connects an IPv4-mapped literal over IPv4, so each of these reaches
  // 169.254.169.254. The URL parser turns every spelling into its hex form.
  for (const u of [
    'http://[::ffff:169.254.169.254]/latest/meta-data/',
    'http://[::ffff:a9fe:a9fe]/',
    'http://[0:0:0:0:0:ffff:a9fe:a9fe]/',
    'http://[::FFFF:A9FE:A9FE]/',
    'http://[::169.254.169.254]/', // IPv4-compatible (deprecated)
    'http://[::a9fe:a9fe]/',
    'http://[::ffff:0:a9fe:a9fe]/', // IPv4-translated
    'http://[::ffff:0.1.2.3]/', // 0/8
  ]) {
    assert.throws(() => assertSafeUrl(u), /Blocked host/, u);
    assert.throws(() => assertSafeUrl(u, { trusted: true }), /Blocked host/, u);
  }
});

test('other IPv6 addresses, and mapped addresses that are not blocked as IPv4, still pass', () => {
  delete process.env.JAGHELM_BLOCK_PRIVATE_NETWORKS;
  for (const u of [
    'http://[2001:db8::1]/',
    'http://[fd00::1]:8080/',
    'http://[::ffff:8.8.8.8]/',
    'http://[::ffff:192.168.1.10]/', // private is allowed outside strict mode, as for IPv4
    'http://[::1]/',
    'http://[64:ff9b::a9fe:a9fe]/', // NAT64: an IPv6 address the OS connects to as IPv6
  ]) {
    assert.doesNotThrow(() => assertSafeUrl(u), u);
  }
});

test('strict mode treats IPv4-compatible IPv6 as its IPv4 address', () => {
  process.env.JAGHELM_BLOCK_PRIVATE_NETWORKS = 'true';
  try {
    assert.throws(() => assertSafeUrl('http://[::127.0.0.1]/'), /Blocked/);
    assert.throws(() => assertSafeUrl('http://[::a00:5]/'), /Blocked/); // 10.0.0.5
    assert.doesNotThrow(() => assertSafeUrl('http://[::ffff:8.8.8.8]/'));
  } finally {
    delete process.env.JAGHELM_BLOCK_PRIVATE_NETWORKS;
  }
});
