/**
 * Test-only: push up in the real app with one browser subscribed. Web Push is
 * initialised with fresh VAPID keys (push/channels.js initWebPush), a
 * subscription is registered in `store`, and the sender's `sendToToken` is
 * replaced by a recorder, so the pipeline (cycle, outbox, channels) runs as it
 * does live and no request leaves the process. `sent` holds each event handed
 * to the sender; `answer(event)` gives its outcome ({ ok, prune, retry, ... },
 * or a promise that never settles for a push service that never answers).
 */
import { createECDH, randomBytes } from 'node:crypto';

import { getWebSender, initWebPush } from '../push/channels.js';
import { generateVapidKeys } from '../push/webPushCrypto.js';

const silent = { debug() {}, info() {}, warn() {}, error() {} };

/**
 * @param {{ store: { register: Function }, answer?: (event: any) => any, name?: string }} opts
 */
export function webPhone({ store, answer = () => ({ ok: true, prune: false }), name = 'Test phone' }) {
  const keys = generateVapidKeys();
  initWebPush({
    store: /** @type {any} */ (store),
    env: { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: 'mailto:ops@example.net' },
    logger: silent,
  });
  /** @type {any[]} */
  const sent = [];
  const sender = /** @type {any} */ (getWebSender());
  sender.sendToToken = async (/** @type {string} */ _token, /** @type {any} */ event) => {
    sent.push(event);
    return answer(event);
  };
  const browser = createECDH('prime256v1');
  browser.generateKeys();
  const registered = store.register({
    endpoint: `https://fcm.googleapis.com/fcm/send/${name.replace(/\W/g, '-')}-ENDPOINT`,
    p256dh: browser.getPublicKey().toString('base64url'),
    auth: randomBytes(16).toString('base64url'),
    name,
  });
  return { sent, token: `wp:${registered.id}`, id: registered.id };
}
