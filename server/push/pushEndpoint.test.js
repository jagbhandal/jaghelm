import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { checkEndpoint, isPushServiceHost, MAX_ENDPOINT_LENGTH } from './pushEndpoint.js';

const ok = (u) => assert.equal(checkEndpoint(u).ok, true, u);
const refused = (u) => assert.equal(checkEndpoint(u).ok, false, String(u).slice(0, 80));

describe('checkEndpoint (SSRF allowlist)', () => {
  it('accepts the real push services', () => {
    ok('https://fcm.googleapis.com/fcm/send/abc:def');
    ok('https://fcm.googleapis.com/wp/abc');
    ok('https://updates.push.services.mozilla.com/wpush/v2/abc');
    ok('https://web.push.apple.com/QGQ3x');
    ok('https://wns2-par02p.notify.windows.com/w/?token=abc');
  });

  it('refuses http, and any other scheme', () => {
    refused('http://fcm.googleapis.com/fcm/send/abc');
    refused('ftp://fcm.googleapis.com/fcm/send/abc');
    refused('file:///etc/passwd');
    refused('javascript:alert(1)');
  });

  it('refuses private, loopback, link-local and metadata addresses and names', () => {
    for (const host of [
      '127.0.0.1',
      'localhost',
      '10.0.0.5',
      '192.168.68.11',
      '172.16.0.1',
      '169.254.169.254',
      '[::1]',
      '[::ffff:127.0.0.1]',
      '0.0.0.0',
      'metadata.google.internal',
      '2130706433',
      '0x7f.0.0.1',
    ]) {
      refused(`https://${host}/fcm/send/abc`);
    }
  });

  it('refuses look-alike hosts: a suffix without the dot, a prefix, a subdomain trick', () => {
    refused('https://evilfcm.googleapis.com.evil.example/fcm/send/abc');
    refused('https://fcm.googleapis.com.evil.example/fcm/send/abc');
    refused('https://xfcm-googleapis.com/x');
    refused('https://evil-push.apple.com.example.org/x');
    refused('https://pushxapple.com/x');
    refused('https://fcm.googleapis.com./fcm/send/abc');
    refused('https://example.com/fcm.googleapis.com/x');
    refused('https://example.com/?u=https://fcm.googleapis.com/x');
    refused('https://fcm.googleapis.com@evil.example/x');
    refused('https://evil.example\\@fcm.googleapis.com/x');
  });

  it('refuses credentials, a port, a fragment, a bare host', () => {
    refused('https://user:pass@fcm.googleapis.com/fcm/send/abc');
    refused('https://user@fcm.googleapis.com/fcm/send/abc');
    refused('https://fcm.googleapis.com:8443/fcm/send/abc');
    refused('https://fcm.googleapis.com/fcm/send/abc#frag');
    refused('https://fcm.googleapis.com/');
    refused('https://fcm.googleapis.com');
  });

  it('refuses huge, empty, non-string and whitespace-laden values', () => {
    refused(`https://fcm.googleapis.com/fcm/send/${'a'.repeat(MAX_ENDPOINT_LENGTH)}`);
    ok(`https://fcm.googleapis.com/${'a'.repeat(MAX_ENDPOINT_LENGTH - 'https://fcm.googleapis.com/'.length)}`);
    refused('');
    refused(null);
    refused(undefined);
    refused(42);
    refused({ toString: () => 'https://fcm.googleapis.com/x' });
    refused(' https://fcm.googleapis.com/fcm/send/abc');
    refused('https://fcm.googleapis.com/fcm/send/a b');
    refused('https://fcm.googleapis.com/fcm/send/a\nb');
    refused('not a url');
  });

  it('never puts any part of the URL in a reason', () => {
    for (const u of [
      'https://fcm.googleapis.com/fcm/send/SECRET-PATH-TOKEN#x',
      'http://192.168.1.1/SECRET-PATH-TOKEN',
      'https://user:SECRET-PATH-TOKEN@fcm.googleapis.com/x',
      `https://fcm.googleapis.com/SECRET-PATH-TOKEN${'a'.repeat(2000)}`,
    ]) {
      const r = checkEndpoint(u);
      assert.equal(r.ok, false);
      assert.ok(!JSON.stringify(r).includes('SECRET-PATH-TOKEN'));
      assert.ok(!JSON.stringify(r).includes('192.168'));
    }
  });

  it('matches hosts by whole labels', () => {
    assert.equal(isPushServiceHost('push.apple.com'), true);
    assert.equal(isPushServiceHost('web.push.apple.com'), true);
    assert.equal(isPushServiceHost('xpush.apple.com'), false);
    assert.equal(isPushServiceHost('apple.com'), false);
  });
});
