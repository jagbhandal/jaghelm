import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { createChannels, initWebPush, webPushStatus, getWebSender } from './channels.js';
import { deviceList } from './devices.js';
import { deviceIdOf } from './prefs.js';
import { generateVapidKeys } from './webPushCrypto.js';
import { createWebPushStore } from './webPushStore.js';

const dir = mkdtempSync(join(tmpdir(), 'jh-channels-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
let n = 0;
function store() {
  n += 1;
  let t = 1000;
  return createWebPushStore({ path: join(dir, `s${n}.json`), now: () => t++ });
}
const sub = (name) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${name}-abc`,
  p256dh: generateVapidKeys().publicKey,
  auth: randomBytes(16).toString('base64url'),
  name,
});

describe('device store', () => {
  it('lists Web Push subscriptions in registration order, by id, and names the pseudo token’s id', () => {
    const web = store();
    const first = web.register(sub('laptop'));
    const second = web.register(sub('phone'));
    assert.deepEqual(
      web.getAllTokens().map((x) => x.token),
      [`wp:${first.id}`, `wp:${second.id}`]
    );
    assert.deepEqual(
      deviceList(web.getDevices()).map((d) => d.name),
      ['laptop', 'phone']
    );
    assert.equal(deviceIdOf(`wp:${first.id}`), first.id);
  });

  it('routes prefs, failures, deliveries and removal by the pseudo token', () => {
    const web = store();
    const w = web.register(sub('laptop'));
    const wt = `wp:${w.id}`;
    web.recordFailure(wt, 'webpush/server-error');
    assert.equal(web.getDevices()[0].lastError.code, 'webpush/server-error');
    web.markDelivered([wt]);
    assert.ok(web.getDevices()[0].lastDeliveredAt);
    assert.equal(web.getPrefs(wt).enabled, true);
    assert.equal(web.removeToken(wt), true);
    assert.equal(web.list().length, 0);
    assert.equal(web.removeDevice('0123456789ab'), false);
  });

  it('never exposes an endpoint or key through any listing', () => {
    const web = store();
    web.register(sub('secretdevice'));
    const text = JSON.stringify([web.getAllTokens(), web.getDevices(), deviceList(web.getDevices())]);
    assert.ok(!/secretdevice-abc|googleapis|p256dh|"auth"/.test(text));
  });
});

describe('channels', () => {
  const web = (up) => ({ isEnabled: () => up, sendToToken: async (t) => ({ ok: true, via: 'web', t }) });

  it('is on when Web Push is, and says so', () => {
    assert.equal(createChannels(() => null).isPushEnabled(), false);
    assert.equal(createChannels(() => web(false)).isPushEnabled(), false);
    assert.equal(createChannels(() => web(true)).isPushEnabled(), true);
    assert.deepEqual(createChannels(() => web(false)).status(), { web: false });
    assert.deepEqual(createChannels(() => web(true)).status(), { web: true });
  });

  it('sends a wp: token by Web Push; any other token is nobody’s, and never sent', async () => {
    const c = createChannels(() => web(true));
    assert.equal((await c.sendToToken('wp:0123456789ab', {})).via, 'web');
    for (const token of ['some-retired-token', 'wp:short']) {
      const out = await c.sendToToken(token, {});
      assert.deepEqual([out.ok, out.prune, out.retry, out.via], [false, false, false, undefined], token);
    }
  });

  it('answers a wp: token without a sender as a quiet no-send, not a throw', async () => {
    const out = await createChannels(() => null).sendToToken('wp:0123456789ab', {});
    assert.equal(out.ok, false);
    assert.equal(out.retry, false);
  });
});

describe('initWebPush', () => {
  const lines = [];
  const logger = { info: (...a) => lines.push(a), warn: (...a) => lines.push(a) };
  const keys = generateVapidKeys();

  it('is off with only one of the pair, saying which, and makes no file of its own', () => {
    lines.length = 0;
    const keyFile = join(dir, 'half-pair.json');
    initWebPush({ store: { subscriptionOf: () => null }, env: { VAPID_PUBLIC_KEY: keys.publicKey }, logger, keyFile });
    assert.deepEqual(webPushStatus(), { enabled: false, reason: 'incomplete', detail: 'not set: VAPID_PRIVATE_KEY' });
    assert.equal(getWebSender().isEnabled(), false);
    assert.equal(existsSync(keyFile), false);
    assert.ok(lines.length > 0 && !JSON.stringify(lines).includes(keys.publicKey));
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
    const channels = createChannels(() => sender, { webTokens: () => tokens });
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
});
