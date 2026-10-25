#!/usr/bin/env node
// Prints a fresh VAPID key pair for Web Push (#653), as the three lines JagHelm's
// .env takes. You don't need it: with VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY unset,
// JagHelm makes and keeps its own pair (#698). Use this only to bring your own. It writes no file and sends nothing: the pair appears on this
// terminal only, so run it where nobody is watching (copy this one file to the host if need be: it needs only Node), paste the lines into the
// host's .env yourself, and keep the private key out of chat, tickets and git.
//
//   node scripts/vapid-keys.mjs [mailto:you@example.com | https://your.site]
//
// The optional argument becomes VAPID_SUBJECT: a contact the push services can
// reach if JagHelm misbehaves (mailto: or https:). Without one the line is left
// for you to fill in.
import { generateKeyPairSync } from 'node:crypto';

// Self-contained on purpose: this one file runs on any machine with Node, with
// no checkout or install (server/push/webPushCrypto.js generateVapidKeys does
// the same; scripts/vapid-keys.test.mjs keeps the two compatible).
function generateVapidKeys() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const d = privateKey.export({ format: 'jwk' }).d;
  const { x, y } = publicKey.export({ format: 'jwk' });
  const point = Buffer.concat([Buffer.from([0x04]), Buffer.from(x, 'base64url'), Buffer.from(y, 'base64url')]);
  return { publicKey: point.toString('base64url'), privateKey: d };
}

const subject = process.argv[2] ?? '';
if (subject && !/^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s/]+\S*)$/.test(subject)) {
  console.error('The subject must be mailto:you@example.com or an https:// address.');
  process.exit(2);
}

const { publicKey, privateKey } = generateVapidKeys();
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log(`VAPID_SUBJECT=${subject}`);
console.error(
  '\nPaste the three lines into JagHelm\'s .env on the host and restart JagHelm.' +
    (subject ? '' : '\nFill in VAPID_SUBJECT first: mailto:you@example.com.') +
    '\nThe private key is a secret: not in chat, not in git. Run this again for a new pair (every browser then turns alerts on again).'
);
