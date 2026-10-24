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

describe('Web Push in parallel (#653)', () => {
  const tokens = ['wp:000000000001', 'wp:000000000002', 'wp:000000000003', 'wp:000000000004', 'wp:000000000005', 'wp:000000000006'];
  const fcm = { isPushEnabled: () => true, sendToToken: async () => ({ ok: true, prune: false, via: 'fcm' }) };
  const event = { type: 'service_down', id: 'x' };

  function harness({ answers }) {
    let running = 0;
    let peak = 0;
    const started = [];
    const sender = {
      isEnabled: () => true,
      async sendToToken(token) {
        started.push(token);
        running += 1;
        peak = Math.max(peak, running);
        const a = answers[token];
        await new Promise((r) => setTimeout(r, a.ms));
        running -= 1;
        if (a.throws) throw new Error('boom https://fcm.googleapis.com/fcm/send/LEAK');
        return a.result;
      },
    };
    const channels = createChannels(fcm, () => sender, { webTokens: () => tokens });
    return { channels, started, peak: () => peak };
  }
  const ok = { ok: true, prune: false };

  it('sends an event to every subscription together, four at a time, and the outbox gets each its own answer', async () => {
    const answers = Object.fromEntries(tokens.map((t) => [t, { ms: 40, result: { ...ok, token: t } }]));
    const { channels, started, peak } = harness({ answers });
    const t0 = Date.now();
    const results = [];
    for (const t of tokens) results.push(await channels.sendToToken(t, event)); // as the outbox: one after another
    assert.deepEqual(results.map((r) => r.token), tokens);
    assert.equal(peak(), 4, 'bounded at four');
    assert.equal(started.length, 6, 'each sent once');
    assert.ok(Date.now() - t0 < 6 * 40 - 40, 'not one after another');
  });

  it('a dead or failing push service stays its own: the others still succeed, and it is not sent twice', async () => {
    const answers = Object.fromEntries(tokens.map((t) => [t, { ms: 5, result: ok }]));
    answers[tokens[1]] = { ms: 5, result: { ok: false, prune: false, retry: true, allPhones: false, error: 'webpush/network-timeout' } };
    answers[tokens[2]] = { ms: 5, throws: true };
    answers[tokens[3]] = { ms: 5, result: { ok: false, prune: true, retry: false, allPhones: false, error: 'webpush/gone' } };
    const { channels, started } = harness({ answers });
    const out = [];
    for (const t of tokens) out.push(await channels.sendToToken(t, event));
    assert.deepEqual(out.map((r) => r.ok), [true, false, false, false, true, true]);
    assert.equal(out[1].retry, true);
    assert.equal(out[2].error, 'thrown');
    assert.equal(out[3].prune, true);
    assert.ok(!JSON.stringify(out).includes('LEAK'));
    assert.equal(started.length, 6);
  });

  it('a subscription that just failed is not sent ahead again; the outbox’s backoff owns its retry', async () => {
    const answers = Object.fromEntries(tokens.map((t) => [t, { ms: 1, result: ok }]));
    answers[tokens[0]] = { ms: 1, result: { ok: false, prune: false, retry: true, allPhones: false, error: 'webpush/server-error' } };
    const h = harness({ answers });
    for (const t of tokens) await h.channels.sendToToken(t, event);
    h.started.length = 0;
    await h.channels.sendToToken(tokens[1], { ...event, id: 'y' }); // a new event: ahead for all but the one that failed
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(!h.started.includes(tokens[0]));
    assert.equal(h.started.length, 5);
  });

  it('FCM tokens are sent as before, not through the lanes', async () => {
    const h = harness({ answers: {} });
    assert.equal((await h.channels.sendToToken('fcm-token', event)).via, 'fcm');
    assert.equal(h.started.length, 0);
  });
});
