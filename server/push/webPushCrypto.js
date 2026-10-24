// @ts-check
/**
 * Web Push's cryptography (#653), on node:crypto alone (no web-push package:
 * the FCM sender is written by hand for the same reason, a dependency widens
 * the audit surface of a service that holds the keys to every phone):
 *
 *  - RFC 8291 message encryption with the aes128gcm content coding (RFC 8188):
 *    an ephemeral ECDH P-256 key against the browser's `p256dh`, HKDF-SHA-256
 *    keyed by the subscription's `auth` secret, AES-128-GCM, one record. The
 *    push service sees only the ciphertext and the endpoint.
 *  - RFC 8292 VAPID: an ES256 JWT (audience = the push service's origin,
 *    expiry under 24 h, subject = a mailto: or https: contact) sent as
 *    `Authorization: vapid t=<jwt>, k=<public key>`.
 *
 * Keys are the encodings every Web Push tool uses: the public key is the 65
 * byte uncompressed P-256 point, the private key the 32 byte scalar, both in
 * unpadded base64url. `scripts/vapid-keys.mjs` prints a pair in them.
 *
 * Pure but for the randomness (a fresh key and salt per message), which tests
 * can pin through `encrypt`'s options: the RFC 8291 appendix A example is the
 * golden vector (webPushCrypto.test.js). Nothing here logs or throws a secret.
 */
import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  sign,
} from 'node:crypto';

/** The record size written in the header; one record holds a whole message. */
export const RECORD_SIZE = 4096;
/**
 * The whole body is at most RECORD_SIZE bytes (RFC 8030 §7.2: a push service
 * accepts 4096): the 86 byte header (16 salt, 4 record size, 1 key id length,
 * 65 key id), the 16 byte GCM tag and the 1 byte delimiter come out of it.
 */
export const HEADER_SIZE = 16 + 4 + 1 + 65;
export const MAX_PLAINTEXT = RECORD_SIZE - HEADER_SIZE - 16 - 1;

/** @param {string} text */
export function fromBase64url(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text)) {
    throw new Error('not base64url');
  }
  return Buffer.from(text, 'base64url');
}

/** @param {Uint8Array} bytes */
export const toBase64url = (bytes) => Buffer.from(bytes).toString('base64url');

/** An uncompressed P-256 point: 0x04, then x and y. @param {Uint8Array} bytes */
export function isUncompressedPoint(bytes) {
  return bytes.length === 65 && bytes[0] === 0x04;
}

/**
 * A public key from its 65 byte point, or throws. Node checks that the point
 * is on the curve (RFC 8291 §7 requires it), so an invalid `p256dh` is refused
 * here, before any ECDH.
 * @param {Uint8Array} point
 */
export function publicKeyOf(point) {
  if (!isUncompressedPoint(point)) throw new Error('not an uncompressed P-256 point');
  return createPublicKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: Buffer.from(point.subarray(1, 33)).toString('base64url'),
      y: Buffer.from(point.subarray(33, 65)).toString('base64url'),
    },
    format: 'jwk',
  });
}

/**
 * A private key from the 32 byte scalar and the public point it belongs to.
 * @param {Uint8Array} scalar
 * @param {Uint8Array} point
 */
export function privateKeyOf(scalar, point) {
  if (scalar.length !== 32) throw new Error('not a 32 byte P-256 scalar');
  if (!isUncompressedPoint(point)) throw new Error('not an uncompressed P-256 point');
  return createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: Buffer.from(scalar).toString('base64url'),
      x: Buffer.from(point.subarray(1, 33)).toString('base64url'),
      y: Buffer.from(point.subarray(33, 65)).toString('base64url'),
    },
    format: 'jwk',
  });
}

/**
 * A new VAPID key pair in the usual encodings: `{ publicKey, privateKey }`,
 * base64url of the 65 byte point and the 32 byte scalar.
 */
export function generateVapidKeys() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const pub = publicKey.export({ format: 'jwk' });
  const point = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(String(pub.x), 'base64url'),
    Buffer.from(String(pub.y), 'base64url'),
  ]);
  return { publicKey: toBase64url(point), privateKey: String(jwk.d) };
}

/**
 * Encrypt `plaintext` for a subscription (RFC 8291 §3.4): the whole request
 * body, header and record.
 *
 * @param {Uint8Array} plaintext  at most MAX_PLAINTEXT bytes
 * @param {{ p256dh: Uint8Array, auth: Uint8Array }} subscription  the browser's key (65 bytes) and secret (16)
 * @param {{ salt?: Uint8Array, senderPrivate?: Uint8Array }} [fixed]  only a test fixes these
 * @returns {Buffer}
 */
export function encrypt(plaintext, subscription, fixed = {}) {
  if (plaintext.length > MAX_PLAINTEXT) throw new Error('message too large for one record');
  const uaPublic = Buffer.from(subscription.p256dh);
  const authSecret = Buffer.from(subscription.auth);
  if (authSecret.length !== 16) throw new Error('auth secret must be 16 bytes');
  publicKeyOf(uaPublic); // on the curve, or it throws

  const ecdh = createECDH('prime256v1');
  if (fixed.senderPrivate) ecdh.setPrivateKey(Buffer.from(fixed.senderPrivate));
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey(); // uncompressed, 65 bytes
  const secret = ecdh.computeSecret(uaPublic);

  const salt = Buffer.from(fixed.salt ?? randomBytes(16));
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', secret, authSecret, keyInfo, 32));
  const cek = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16)
  );
  const nonce = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12)
  );

  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  // The last (only) record ends with the delimiter 0x02 and no further padding.
  const body = Buffer.concat([
    cipher.update(Buffer.concat([Buffer.from(plaintext), Buffer.from([0x02])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  const header = Buffer.alloc(16 + 4 + 1);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

/** How long a VAPID token lives; RFC 8292 caps it at 24 hours. */
export const VAPID_LIFETIME_S = 12 * 60 * 60;

/**
 * The `Authorization` value for a push to `audience` (the endpoint's origin).
 *
 * @param {{ audience: string, subject: string, publicKey: string, privateKey: import('node:crypto').KeyObject, now?: number }} args
 *   `now` in ms; `publicKey` the base64url point, as it is sent in `k=`
 */
export function vapidAuthorization({ audience, subject, publicKey, privateKey, now = Date.now() }) {
  const part = (/** @type {object} */ o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const signingInput = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({
    aud: audience,
    exp: Math.floor(now / 1000) + VAPID_LIFETIME_S,
    sub: subject,
  })}`;
  // ES256 signatures are the raw r||s pair (JWS), not DER.
  const signature = sign('sha256', Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  return `vapid t=${signingInput}.${toBase64url(signature)}, k=${publicKey}`;
}
