import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { createChannels, createCombinedStore, initWebPush, webPushStatus, getWebSender } from './channels.js';
import { deviceList } from './devices.js';
import { createTokenStore, deviceIdOf } from './tokenStore.js';
import { generateVapidKeys } from './webPushCrypto.js';
import { createWebPushStore } from './webPushStore.js';

const dir = mkdtempSync(join(tmpdir(), 'jh-channels-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
let n = 0;
function stores() {
  n += 1;
  let t = 1000;
  const fcm = createTokenStore({ path: join(dir, `t${n}.json`), now: () => t++ });
  const web = createWebPushStore({ path: join(dir, `s${n}.json`), now: () => t++ });
  return { fcm, web, both: createCombinedStore(fcm, web) };
}
const sub = (name) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${name}-abc`,
  p256dh: generateVapidKeys().publicKey,
  auth: randomBytes(16).toString('base64url'),
  name,
});

describe('combined store', () => {
  it('lists FCM tokens and Web Push subscriptions as one set of devices, in registration order', () => {
    const { fcm, web, both } = stores();
    fcm.registerToken('fcm-token-1', { platform: 'android', model: 'Pixel 8' });
    const w = web.register(sub('laptop'));
    fcm.registerToken('fcm-token-2', { platform: 'android' });
    const tokens = both.getAllTokens().map((x) => x.token);
    assert.deepEqual(tokens.sort(), ['fcm-token-1', 'fcm-token-2', `wp:${w.id}`].sort());
    const names = deviceList(both.getDevices()).map((d) => d.name);
    assert.deepEqual(names, ['Pixel 8', 'laptop', 'Android phone']);
    assert.equal(deviceIdOf(`wp:${w.id}`), w.id);
  });

  it('routes prefs, failures, deliveries and removal by the token’s kind', () => {
    const { fcm, web, both } = stores();
    fcm.registerToken('fcm-token-1', {});
    const w = web.register(sub('laptop'));
    const wt = `wp:${w.id}`;
    both.recordFailure(wt, 'webpush/server-error');
    both.recordFailure('fcm-token-1', 'messaging/internal-error');
    assert.equal(web.getDevices()[0].lastError.code, 'webpush/server-error');
    assert.equal(fcm.getDevices()[0].lastError.code, 'messaging/internal-error');
    both.markDelivered([wt, 'fcm-token-1']);
    assert.ok(web.getDevices()[0].lastDeliveredAt && fcm.getDevices()[0].lastDeliveredAt);
    assert.equal(both.getPrefs(wt).enabled, true);
    assert.equal(both.removeToken(wt), true);
    assert.equal(web.list().length, 0);
    assert.equal(fcm.getAllTokens().length, 1);
    assert.equal(both.removeDevice(fcm.getDevices()[0].id), true);
    assert.equal(both.removeDevice('0123456789ab'), false);
  });

  it('never exposes an endpoint or key through any listing', () => {
    const { web, both } = stores();
    web.register(sub('secretdevice'));
    const text = JSON.stringify([both.getAllTokens(), both.getDevices(), deviceList(both.getDevices())]);
    assert.ok(!/secretdevice-abc|googleapis|p256dh|"auth"/.test(text));
  });
});

describe('channels', () => {
  const fcm = (up) => ({ isPushEnabled: () => up, sendToToken: async (t) => ({ ok: true, via: 'fcm', t }) });
  const web = (up) => ({ isEnabled: () => up, sendToToken: async (t) => ({ ok: true, via: 'web', t }) });

  it('is on when either channel is, and says which', () => {
    assert.equal(createChannels(fcm(false), () => null).isPushEnabled(), false);
    assert.equal(createChannels(fcm(true), () => null).isPushEnabled(), true);
    assert.equal(createChannels(fcm(false), () => web(true)).isPushEnabled(), true);
    assert.deepEqual(createChannels(fcm(true), () => web(false)).status(), { fcm: true, web: false });
  });

  it('sends a wp: token by Web Push and any other by FCM', async () => {
    const c = createChannels(fcm(true), () => web(true));
    assert.equal((await c.sendToToken('wp:0123456789ab', {})).via, 'web');
    assert.equal((await c.sendToToken('fcm-token', {})).via, 'fcm');
    assert.equal((await c.sendToToken('wp:short', {})).via, 'fcm', 'only a real pseudo token is Web Push’s');
  });

  it('answers a wp: token without a sender as a quiet no-send, not a throw', async () => {
    const out = await createChannels(fcm(true), () => null).sendToToken('wp:0123456789ab', {});
    assert.equal(out.ok, false);
    assert.equal(out.retry, false);
  });
});

describe('initWebPush', () => {
  const lines = [];
  const logger = { info: (...a) => lines.push(a), warn: (...a) => lines.push(a) };
  const keys = generateVapidKeys();

  it('is off without keys, with the reason, and says so without a value', () => {
    initWebPush({ store: { subscriptionOf: () => null }, env: {}, logger });
    assert.deepEqual(webPushStatus(), { enabled: false, reason: 'unset' });
    assert.equal(getWebSender().isEnabled(), false);
  });

  it('is on with a good pair; the status carries the public key only', () => {
    lines.length = 0;
    initWebPush({
      store: { subscriptionOf: () => null },
      env: { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: 'mailto:ops@example.net' },
      logger,
    });
    assert.deepEqual(webPushStatus(), { enabled: true, publicKey: keys.publicKey });
    assert.ok(!JSON.stringify(lines).includes(keys.privateKey));
    assert.ok(!JSON.stringify(webPushStatus()).includes(keys.privateKey));
  });

  it('is off, with a warning that names no value, for a pair that does not match', () => {
    lines.length = 0;
    const other = generateVapidKeys();
    initWebPush({
      store: { subscriptionOf: () => null },
      env: { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: other.privateKey, VAPID_SUBJECT: 'mailto:ops@example.net' },
      logger,
    });
    assert.equal(webPushStatus().enabled, false);
    assert.equal(webPushStatus().reason, 'invalid');
    const text = JSON.stringify(lines);
    for (const secret of [keys.publicKey, other.privateKey]) assert.ok(!text.includes(secret));
  });
});
