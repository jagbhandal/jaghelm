import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { verify } from 'node:crypto';

import {
  encrypt,
  fromBase64url,
  generateVapidKeys,
  MAX_PLAINTEXT,
  privateKeyOf,
  publicKeyOf,
  toBase64url,
  vapidAuthorization,
} from './webPushCrypto.js';

// RFC 8291 section 5 and appendix A: the published example, every value public.
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  authSecret: 'BTBZMqHH6r4Tts7J_aSIgg', // pragma: allowlist secret
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', // pragma: allowlist secret
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', // pragma: allowlist secret
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml' +
    'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT' +
    'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

describe('encrypt (RFC 8291)', () => {
  it('reproduces the RFC 8291 appendix A example byte for byte', () => {
    const out = encrypt(
      Buffer.from(RFC.plaintext),
      { p256dh: fromBase64url(RFC.uaPublic), auth: fromBase64url(RFC.authSecret) },
      { salt: fromBase64url(RFC.salt), senderPrivate: fromBase64url(RFC.asPrivate) }
    );
    assert.equal(toBase64url(out), RFC.body);
    assert.equal(out.length, 86 + 41 + 1 + 16, 'header, plaintext, delimiter, GCM tag');
  });

  it('writes the aes128gcm header: salt, record size 4096, the 65 byte key id', () => {
    const { publicKey } = generateVapidKeys(); // any valid P-256 point
    const out = encrypt(Buffer.from('hi'), {
      p256dh: fromBase64url(publicKey),
      auth: Buffer.alloc(16, 1),
    });
    assert.equal(out.readUInt32BE(16), 4096);
    assert.equal(out[20], 65);
    assert.equal(out[21], 0x04);
    assert.equal(out.length, 16 + 4 + 1 + 65 + 2 + 1 + 16);
  });

  it('uses a fresh key and salt for every message', () => {
    const sub = { p256dh: fromBase64url(generateVapidKeys().publicKey), auth: Buffer.alloc(16, 1) };
    const a = encrypt(Buffer.from('same'), sub);
    const b = encrypt(Buffer.from('same'), sub);
    assert.notDeepEqual(a.subarray(0, 16), b.subarray(0, 16));
    assert.notDeepEqual(a.subarray(21, 86), b.subarray(21, 86));
  });

  it('refuses a key that is not on the curve, a wrong secret size and a message too big', () => {
    const point = Buffer.alloc(65, 7);
    point[0] = 4;
    assert.throws(() => encrypt(Buffer.from('x'), { p256dh: point, auth: Buffer.alloc(16) }));
    const good = fromBase64url(generateVapidKeys().publicKey);
    assert.throws(() => encrypt(Buffer.from('x'), { p256dh: good, auth: Buffer.alloc(15) }), /16 bytes/);
    assert.throws(
      () => encrypt(Buffer.alloc(MAX_PLAINTEXT + 1), { p256dh: good, auth: Buffer.alloc(16) }),
      /too large/
    );
    assert.equal(MAX_PLAINTEXT, 3993);
    assert.equal(encrypt(Buffer.alloc(MAX_PLAINTEXT), { p256dh: good, auth: Buffer.alloc(16) }).length, 4096, 'the largest message is a 4096 byte body');
  });
});

describe('vapidAuthorization (RFC 8292)', () => {
  const keys = generateVapidKeys();
  const point = fromBase64url(keys.publicKey);
  const privateKey = privateKeyOf(fromBase64url(keys.privateKey), point);
  const now = Date.UTC(2026, 9, 24, 12, 0, 0);
  const header = vapidAuthorization({
    audience: 'https://push.example.net',
    subject: 'mailto:ops@example.net',
    publicKey: keys.publicKey,
    privateKey,
    now,
  });

  it('is `vapid t=<jwt>, k=<public key>`', () => {
    const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
    assert.ok(m, 'shape');
    assert.equal(m[4], keys.publicKey);
  });

  it('carries ES256 claims: audience, expiry under 24 h, subject', () => {
    const [h, c] = header.slice('vapid t='.length, header.indexOf(',')).split('.');
    assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url').toString()), { typ: 'JWT', alg: 'ES256' });
    const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
    assert.equal(claims.aud, 'https://push.example.net');
    assert.equal(claims.sub, 'mailto:ops@example.net');
    assert.ok(claims.exp > now / 1000 && claims.exp - now / 1000 <= 24 * 3600);
  });

  it('is signed with the private key: the public key verifies the raw r||s signature', () => {
    const jwt = header.slice('vapid t='.length, header.indexOf(','));
    const [h, c, s] = jwt.split('.');
    const signature = Buffer.from(s, 'base64url');
    assert.equal(signature.length, 64);
    const ok = verify('sha256', Buffer.from(`${h}.${c}`), { key: publicKeyOf(point), dsaEncoding: 'ieee-p1363' }, signature);
    assert.equal(ok, true);
    const other = publicKeyOf(fromBase64url(generateVapidKeys().publicKey));
    assert.equal(verify('sha256', Buffer.from(`${h}.${c}`), { key: other, dsaEncoding: 'ieee-p1363' }, signature), false);
  });
});

describe('generateVapidKeys', () => {
  it('gives a 65 byte public point and a 32 byte scalar that belong together', () => {
    const { publicKey, privateKey } = generateVapidKeys();
    assert.equal(fromBase64url(publicKey).length, 65);
    assert.equal(fromBase64url(privateKey).length, 32);
    assert.ok(privateKeyOf(fromBase64url(privateKey), fromBase64url(publicKey)));
  });
});
