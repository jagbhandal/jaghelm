/**
 * The expiry tracker's targets and lines (#676): what a typed target may be
 * (a host or host:port and nothing else, so no scheme, path or credential
 * reaches a socket), the list's clean-up, and the lines' fallbacks.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EXPIRY_DEFAULT,
  MAX_TLS_TARGETS,
  cleanTargets,
  expiryLines,
  parseTarget,
} from './expiryTargets.js';

test('a host, host:port, an IPv4 address and a bracketed IPv6 address are targets, in canonical form', () => {
  assert.deepEqual(parseTarget('Example.COM'), { host: 'example.com', port: 443, key: 'example.com' });
  assert.deepEqual(parseTarget(' nas.lan:8443 '), { host: 'nas.lan', port: 8443, key: 'nas.lan:8443' });
  assert.deepEqual(parseTarget('example.com:443'), { host: 'example.com', port: 443, key: 'example.com' });
  assert.deepEqual(parseTarget('192.168.68.11:3060'), { host: '192.168.68.11', port: 3060, key: '192.168.68.11:3060' });
  assert.deepEqual(parseTarget('[fd00::1]:8443'), { host: 'fd00::1', port: 8443, key: '[fd00::1]:8443' });
  assert.deepEqual(parseTarget('[fd00::1]'), { host: 'fd00::1', port: 443, key: '[fd00::1]' });
  assert.equal(parseTarget('nas')?.host, 'nas');
});

test('anything that is not a bare host and port is refused', () => {
  for (const bad of [
    '',
    '   ',
    'https://example.com',
    'example.com/path',
    'example.com?x=1',
    'user@example.com',
    'user:pw@example.com',
    'exa mple.com',
    'example.com:0',
    'example.com:65536',
    'example.com:abc',
    'example.com:',
    'a:b:c',
    'example..com',
    '-bad.example.com',
    'example.com.',
    '999.1.1.1',
    '1.2.3',
    '[::1',
    '[1:2]',
    '[fd00::1]x',
    'a'.repeat(64) + '.com',
    'x'.repeat(300),
    'exa\u0000mple.com',
    42,
    null,
    undefined,
    {},
  ]) {
    assert.equal(parseTarget(bad), null, JSON.stringify(bad));
  }
});

test('a list keeps the entries that parse, canonical, once each, in order, at most 30', () => {
  assert.deepEqual(
    cleanTargets(['B.example.com', 'nope://x', 'a.example.com:443', 'b.example.com', 7, 'c.example.com:8443']),
    ['b.example.com', 'a.example.com', 'c.example.com:8443']
  );
  assert.deepEqual(cleanTargets('not a list'), []);
  assert.deepEqual(cleanTargets(undefined), []);
  const many = Array.from({ length: 80 }, (_, i) => `h${i}.example.com`);
  const cut = cleanTargets(many);
  assert.equal(cut.length, MAX_TLS_TARGETS);
  assert.equal(cut[0], 'h0.example.com');
});

test('the lines are the saved pair, or the defaults when a line is missing, out of range or not under the other', () => {
  assert.deepEqual(EXPIRY_DEFAULT, { warn: 21, crit: 7 });
  assert.deepEqual(expiryLines(undefined), { warn: 21, crit: 7 });
  assert.deepEqual(expiryLines({}), { warn: 21, crit: 7 });
  assert.deepEqual(expiryLines({ expiryWarnDays: 30, expiryCritDays: 10 }), { warn: 30, crit: 10 });
  // One saved line pairs with the other's default.
  assert.deepEqual(expiryLines({ expiryWarnDays: 40 }), { warn: 40, crit: 7 });
  assert.deepEqual(expiryLines({ expiryCritDays: 3 }), { warn: 21, crit: 3 });
  for (const bad of [
    { expiryWarnDays: 5, expiryCritDays: 9 },
    { expiryWarnDays: 5, expiryCritDays: 5 },
    { expiryWarnDays: 0, expiryCritDays: 0 },
    { expiryWarnDays: 400, expiryCritDays: 400 },
    { expiryWarnDays: 'x', expiryCritDays: 3.5 },
    { expiryWarnDays: 5 }, // 5 is not over the default crit of 7
  ]) {
    assert.deepEqual(expiryLines(bad), { warn: 21, crit: 7 }, JSON.stringify(bad));
  }
});
