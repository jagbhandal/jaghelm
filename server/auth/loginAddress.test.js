/**
 * The login limiter's view of a client address (#257): the key it counts
 * failures under (an IPv4 address, or an IPv6 /64) and the trusted networks
 * of LOGIN_TRUSTED_NETS.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { addressKey, isKnownKey, parseTrustedNets } from './loginAddress.js';

test('an IPv4 address is its own key', () => {
  assert.equal(addressKey('192.0.2.1'), '192.0.2.1');
  assert.equal(addressKey('100.88.196.41'), '100.88.196.41');
});

test('an IPv6 address counts per /64: rotating inside one network is one key', () => {
  const key = '2001:db8:1:2::/64';
  assert.equal(addressKey('2001:db8:1:2::1'), key);
  assert.equal(addressKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), key);
  assert.equal(addressKey('2001:0DB8:0001:0002:ffff:0:0:1'), key, 'case and leading zeros');
  assert.equal(addressKey('fe80::1%eth0'), 'fe80:0:0:0::/64', 'a zone is dropped');
  assert.notEqual(addressKey('2001:db8:1:3::1'), key, 'the next /64 is another key');
  assert.equal(addressKey('::1'), '0:0:0:0::/64');
});

test('an IPv4 client on a dual-stack socket (::ffff:a.b.c.d) is keyed as IPv4, not one /64 for all', () => {
  assert.equal(addressKey('::ffff:192.0.2.1'), '192.0.2.1');
  assert.equal(addressKey('::FFFF:c000:0201'), '192.0.2.1');
  assert.notEqual(addressKey('::ffff:192.0.2.1'), addressKey('::ffff:192.0.2.2'));
});

test('anything that is not an IP (spoofed junk, oversized, missing) shares the key unknown', () => {
  for (const junk of ['not-an-ip', '1'.repeat(10_000), '', undefined, null, 42, '192.0.2.1/24']) {
    assert.equal(addressKey(junk), 'unknown', String(junk).slice(0, 20));
  }
});

test('isKnownKey takes only keys addressKey makes, so a hand-edited file cannot add others', () => {
  for (const ok of ['192.0.2.1', '2001:db8:1:2::/64']) assert.equal(isKnownKey(ok), true, ok);
  for (const bad of ['unknown', '2001:db8:1:2::1', '::ffff:192.0.2.1', '2001:DB8:1:2::/64', '10.0.0.0/8', 7, '']) {
    assert.equal(isKnownKey(bad), false, String(bad));
  }
});

test('LOGIN_TRUSTED_NETS: IPv4 and IPv6 CIDRs and bare addresses; IPv4 on a dual-stack socket matches', () => {
  const warnings = [];
  const nets = parseTrustedNets(
    '192.168.68.0/22, 100.64.0.0/10,fd7a:115c:a1e0::/48 ,10.9.9.9',
    { warn: (...a) => warnings.push(a) }
  );
  assert.equal(warnings.length, 0);
  for (const inside of ['192.168.68.1', '192.168.71.254', '100.88.196.41', '::ffff:192.168.69.5', 'fd7a:115c:a1e0:ab12::1', '10.9.9.9']) {
    assert.equal(nets.has(inside), true, inside);
  }
  for (const outside of ['192.168.72.1', '100.128.0.1', 'fd7a:115c:a1e1::1', '10.9.9.10', 'junk', undefined]) {
    assert.equal(nets.has(outside), false, String(outside));
  }
});

test('LOGIN_TRUSTED_NETS: empty or unset trusts nothing, without a warning', () => {
  const warnings = [];
  const log = { warn: (...a) => warnings.push(a) };
  for (const text of [undefined, '', ' , ']) assert.equal(parseTrustedNets(text, log).has('192.168.68.1'), false);
  assert.equal(warnings.length, 0);
});

test('LOGIN_TRUSTED_NETS: a bad entry is refused, the rest kept, with one warning naming them', () => {
  const warnings = [];
  const nets = parseTrustedNets(
    'nope,10.0.0.0/33,0.0.0.0/0,192.168.68.0/22,fd00::/129,::/0,1.2.3.4/x,10.0.0.0/-1',
    { warn: (fields, msg) => warnings.push({ fields, msg }) }
  );
  assert.equal(nets.has('192.168.68.9'), true);
  for (const ip of ['10.0.0.1', '8.8.8.8', 'fd00::1', '2001:db8::1', '1.2.3.4']) assert.equal(nets.has(ip), false, ip);
  assert.equal(warnings.length, 1);
  assert.deepEqual(warnings[0].fields.refused, [
    'nope',
    '10.0.0.0/33',
    '0.0.0.0/0',
    'fd00::/129',
    '::/0',
    '1.2.3.4/x',
    '10.0.0.0/-1',
  ]);
  assert.match(warnings[0].msg, /LOGIN_TRUSTED_NETS/);
});
