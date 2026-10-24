/**
 * A self-signed (or "issued by someone else") X.509 certificate made in
 * process, for tests that need a TLS server to present a chosen end date,
 * expired or not (#676). No library and no file: the DER is built by hand and
 * signed with a throwaway P-256 key, so nothing secret is committed.
 *
 * Not a general encoder: one name attribute (CN) per name, UTCTime dates (years
 * up to 2049), no extensions.
 */
import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';

const der = (tag, body) => {
  const len = body.length;
  const head =
    len < 128
      ? Buffer.from([tag, len])
      : len < 256
        ? Buffer.from([tag, 0x81, len])
        : Buffer.from([tag, 0x82, len >> 8, len & 0xff]);
  return Buffer.concat([head, body]);
};
const seq = (...parts) => der(0x30, Buffer.concat(parts));
const set = (...parts) => der(0x31, Buffer.concat(parts));
const oid = (bytes) => der(0x06, Buffer.from(bytes));
const utf8 = (s) => der(0x0c, Buffer.from(s, 'utf8'));
const int = (n) => der(0x02, Buffer.from([n]));
const utc = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  const text = `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  return der(0x17, Buffer.from(text, 'ascii'));
};

const ECDSA_SHA256 = seq(oid([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02]));
const CN = [0x55, 0x04, 0x03];
const name = (cn) => seq(set(seq(oid(CN), utf8(cn))));

/**
 * @param {{ cn?: string, issuerCn?: string, notBefore: Date, notAfter: Date }} opts
 * @returns {{ key: string, cert: string }}  PEM, ready for tls.createServer
 */
export function makeCert({ cn = 'localhost', issuerCn = cn, notBefore, notAfter }) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const tbs = seq(
    der(0xa0, int(2)), // version 3
    int(1),
    ECDSA_SHA256,
    name(issuerCn),
    seq(utc(notBefore), utc(notAfter)),
    name(cn),
    spki
  );
  const signature = sign('sha256', tbs, createPrivateKey(privateKey.export({ type: 'pkcs8', format: 'pem' })));
  const cert = seq(tbs, ECDSA_SHA256, der(0x03, Buffer.concat([Buffer.from([0]), signature])));
  const b64 = cert.toString('base64').match(/.{1,64}/g).join('\n');
  return {
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    cert: `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`,
  };
}
