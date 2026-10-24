import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, hkdfSync, verify } from 'node:crypto';

import { TEST_PUSH } from './dispatch.js';
import { STATUS_CHECK } from './differ.js';
import { buildWebPayload, createWebPushSender, deliveryOptions, readVapid, SEND_TIMEOUT_MS } from './webPush.js';
import { fromBase64url, generateVapidKeys, publicKeyOf } from './webPushCrypto.js';

const SECRET_PATH = 'ENDPOINT-SECRET-PATH';
const ENDPOINT = `https://fcm.googleapis.com/fcm/send/${SECRET_PATH}`;
const SUBJECT = 'mailto:ops@example.net';

/** A browser: its keys, so the test can decrypt what the sender posts. */
function browser() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = Buffer.from('0123456789abcdef');
  return {
    ecdh,
    auth,
    sub: { endpoint: ENDPOINT, p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') },
  };
}

/** RFC 8291 section 3.4 from the receiver's side. */
function decrypt(body, ua) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const secret = ua.ecdh.computeSecret(asPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), ua.ecdh.getPublicKey(), asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', secret, ua.auth, keyInfo, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const record = body.subarray(21 + idlen);
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(record.subarray(record.length - 16));
  const plain = Buffer.concat([d.update(record.subarray(0, record.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2, 'record delimiter');
  return JSON.parse(plain.subarray(0, plain.length - 1).toString());
}

const keyPair = generateVapidKeys();
const vapidEnv = { VAPID_PUBLIC_KEY: keyPair.publicKey, VAPID_PRIVATE_KEY: keyPair.privateKey, VAPID_SUBJECT: SUBJECT };
const vapid = readVapid(vapidEnv);

const silent = () => {
  const lines = [];
  const add = (level) => (fields, msg) => lines.push({ level, fields, msg });
  return { lines, warn: add('warn'), info: add('info') };
};

const critical = { type: 'service_down', id: 'apps:jellyfin', node: 'apps', title: 'Service down', body: 'Jellyfin on apps · Kuma reports it down', severity: 'critical' };

function harness({ answer = { status: 201 }, sub = browser().sub } = {}) {
  const calls = [];
  const logger = silent();
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (answer instanceof Error) throw answer;
    return new Response(null, { status: answer.status, headers: answer.headers });
  };
  const sender = createWebPushSender({
    vapid,
    store: { subscriptionOf: (t) => (t === 'wp:aaaaaaaaaaaa' ? sub : null) },
    fetchImpl,
    logger,
    now: () => Date.UTC(2026, 9, 24, 12),
  });
  return { sender, calls, logger };
}

describe('readVapid', () => {
  it('accepts a matching pair and a mailto: or https: subject', () => {
    assert.equal(vapid.enabled, true);
    assert.equal(vapid.publicKey, keyPair.publicKey);
    assert.equal(readVapid({ ...vapidEnv, VAPID_SUBJECT: 'https://dash.example.net' }).enabled, true);
  });
  it('is off with the reason: unset, incomplete, invalid', () => {
    assert.deepEqual(readVapid({}), { enabled: false, reason: 'unset' });
    const partial = readVapid({ VAPID_PUBLIC_KEY: keyPair.publicKey });
    assert.equal(partial.reason, 'incomplete');
    assert.equal(partial.detail, 'not set: VAPID_PRIVATE_KEY, VAPID_SUBJECT');
    assert.ok(!JSON.stringify(partial).includes(keyPair.publicKey));
    assert.equal(readVapid({ ...vapidEnv, VAPID_SUBJECT: 'ops@example.net' }).reason, 'invalid');
    assert.equal(readVapid({ ...vapidEnv, VAPID_SUBJECT: 'http://dash.example.net' }).reason, 'invalid');
    assert.equal(readVapid({ ...vapidEnv, VAPID_PUBLIC_KEY: 'AAAA' }).reason, 'invalid');
    assert.equal(readVapid({ ...vapidEnv, VAPID_PRIVATE_KEY: 'AAAA' }).reason, 'invalid');
  });
  it('refuses a private key that is not the public key’s pair, and never names a value', () => {
    const other = generateVapidKeys();
    const r = readVapid({ ...vapidEnv, VAPID_PRIVATE_KEY: other.privateKey });
    assert.equal(r.enabled, false);
    assert.equal(r.reason, 'invalid');
    assert.ok(!JSON.stringify(r).includes(other.privateKey));
    assert.ok(!JSON.stringify(r).includes(keyPair.publicKey));
  });
});

describe('buildWebPayload', () => {
  it('says the state and the subject, and nothing of the reason', () => {
    const p = buildWebPayload(critical);
    assert.deepEqual(p, {
      v: 1,
      title: 'Service down',
      body: 'Jellyfin on apps',
      tag: 'services/apps:jellyfin',
      url: '/?entity=services/apps:jellyfin',
      severity: 'critical',
      type: 'service_down',
      actions: true,
      keys: ['services/apps:jellyfin'],
    });
    assert.ok(!JSON.stringify(p).includes('Kuma'));
  });
  it('offers Snooze and Ack for a page only, with the tags they apply to; a recovery, a test push and news carry neither', () => {
    assert.deepEqual(buildWebPayload(critical).keys, ['services/apps:jellyfin']);
    for (const event of [
      { ...critical, type: 'service_recovered', title: 'Service recovered', severity: 'info' },
      { type: 'push_test', id: 'all', title: 'JagHelm test push', body: 'x', severity: 'info' },
      { type: 'arcane_update', id: 'x', title: 'Updates', body: 'y', severity: 'info' },
    ]) {
      const p = buildWebPayload(event);
      assert.equal('actions' in p, false, event.type);
      assert.equal('keys' in p, false, event.type);
    }
  });
  it('appends a known cause to a page’s body; a summary carries its members’ tags and its own words', () => {
    assert.equal(buildWebPayload({ ...critical, cause: 'AP reboot' }).body, 'Jellyfin on apps · AP reboot');
    const s = buildWebPayload({
      type: 'alert_group', id: 'group', title: '3 services down on apps', body: 'A, B, C', severity: 'critical',
      members: ['services/a', 'services/b'], actionable: true, cause: 'ignored',
    });
    assert.deepEqual(s.keys, ['services/a', 'services/b']);
    assert.equal(s.actions, true);
    assert.equal(s.body, 'A, B, C');
    assert.equal(s.url, '/alerts');
    assert.equal(buildWebPayload({ type: 'alert_group', id: 'group', title: 't', body: 'b', members: ['x'], actionable: false }).actions, undefined);
  });
  it('tags a recovery like its outage, so it replaces it', () => {
    const rec = buildWebPayload({ ...critical, type: 'service_recovered', title: 'Service recovered', severity: 'info' });
    assert.equal(rec.tag, buildWebPayload(critical).tag);
  });
  it('points at the dashboard root when the event is no entity’s, and tags a test push', () => {
    const p = buildWebPayload({ type: 'push_test', id: 'all', title: 'JagHelm test push', body: 'Sent from Settings', severity: 'info' });
    assert.equal(p.url, '/');
    assert.equal(p.tag, 'push_test');
    assert.equal(buildWebPayload({ type: 'source_down', id: STATUS_CHECK, title: 'x', body: 'y', severity: 'warning' }).url, '/');
  });
  it('keeps the url a relative path whatever the id holds', () => {
    const p = buildWebPayload({ ...critical, id: 'x/../../evil?a=b#c' });
    assert.ok(p.url.startsWith('/?entity='));
    assert.ok(!p.url.includes('#'));
    assert.ok(!/^\/\//.test(p.url));
  });
  it('bounds the copy', () => {
    const p = buildWebPayload({ ...critical, title: 'T'.repeat(500), body: 'B'.repeat(500) });
    assert.ok(p.title.length <= 80 && p.body.length <= 140);
  });
});

describe('deliveryOptions', () => {
  it('Urgency high and a day’s TTL for critical; normal and an hour otherwise; a test push is urgent', () => {
    assert.deepEqual(deliveryOptions({ severity: 'critical' }), { urgency: 'high', ttl: 86400 });
    assert.deepEqual(deliveryOptions({ severity: 'warning' }), { urgency: 'normal', ttl: 3600 });
    assert.deepEqual(deliveryOptions({ severity: 'info' }), { urgency: 'normal', ttl: 3600 });
    assert.deepEqual(deliveryOptions({ type: TEST_PUSH, severity: 'info' }), { urgency: 'high', ttl: 3600 });
  });
});

describe('sendToToken', () => {
  it('posts the encrypted payload with the RFC headers and a verifiable VAPID signature', async () => {
    const ua = browser();
    const { sender, calls } = harness({ sub: ua.sub });
    const out = await sender.sendToToken('wp:aaaaaaaaaaaa', critical);
    assert.deepEqual(out, { ok: true, prune: false });
    assert.equal(calls.length, 1);
    const { url, init } = calls[0];
    assert.equal(url, ENDPOINT);
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'manual', 'a push service redirect is never followed');
    assert.ok(init.signal instanceof AbortSignal);
    assert.equal(init.headers['Content-Encoding'], 'aes128gcm');
    assert.equal(init.headers.TTL, '86400');
    assert.equal(init.headers.Urgency, 'high');
    // the receiver can read it
    assert.equal(decrypt(init.body, ua).body, 'Jellyfin on apps');
    assert.equal(decrypt(init.body, ua).url, '/?entity=services/apps:jellyfin');
    // VAPID: audience is the origin, the signature verifies under the published key
    const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(init.headers.Authorization);
    assert.ok(m);
    assert.equal(m[4], keyPair.publicKey);
    const claims = JSON.parse(Buffer.from(m[2], 'base64url').toString());
    assert.equal(claims.aud, 'https://fcm.googleapis.com');
    assert.equal(claims.sub, SUBJECT);
    assert.equal(claims.exp, Math.floor(Date.UTC(2026, 9, 24, 12) / 1000) + 12 * 3600);
    assert.equal(
      verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key: publicKeyOf(fromBase64url(m[4])), dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3], 'base64url')),
      true
    );
  });

  it('sends Urgency normal for a recovery', async () => {
    const { sender, calls } = harness();
    await sender.sendToToken('wp:aaaaaaaaaaaa', { ...critical, severity: 'info', type: 'service_recovered' });
    assert.equal(calls[0].init.headers.Urgency, 'normal');
    assert.equal(calls[0].init.headers.TTL, '3600');
  });

  it('201 and any 2xx are accepted', async () => {
    for (const status of [200, 201, 202]) {
      const { sender } = harness({ answer: { status } });
      assert.equal((await sender.sendToToken('wp:aaaaaaaaaaaa', critical)).ok, true);
    }
  });

  it('404 and 410 prune the subscription, without a retry', async () => {
    for (const status of [404, 410]) {
      const { sender } = harness({ answer: { status } });
      assert.deepEqual(await sender.sendToToken('wp:aaaaaaaaaaaa', critical), {
        ok: false, prune: true, retry: false, allPhones: false, error: 'webpush/gone',
      });
    }
  });

  it('429 and 5xx are retried for this browser only; the round never stops for all', async () => {
    for (const [status, error] of [[429, 'webpush/rate-limited'], [500, 'webpush/server-error'], [502, 'webpush/server-error'], [503, 'webpush/server-error']]) {
      const { sender } = harness({ answer: { status } });
      assert.deepEqual(await sender.sendToToken('wp:aaaaaaaaaaaa', critical), {
        ok: false, prune: false, retry: true, allPhones: false, error,
      });
    }
  });

  it('no other 4xx, and no redirect, is ever retried or pruned', async () => {
    for (const status of [301, 302, 307, 400, 401, 403, 405, 409, 413, 422]) {
      const { sender } = harness({ answer: { status } });
      const out = await sender.sendToToken('wp:aaaaaaaaaaaa', critical);
      assert.equal(out.ok, false, String(status));
      assert.equal(out.retry, false, String(status));
      assert.equal(out.prune, false, String(status));
    }
    assert.equal((await harness({ answer: { status: 403 } }).sender.sendToToken('wp:aaaaaaaaaaaa', critical)).error, 'webpush/rejected');
    assert.equal((await harness({ answer: { status: 413 } }).sender.sendToToken('wp:aaaaaaaaaaaa', critical)).error, 'webpush/too-large');
    assert.equal((await harness({ answer: { status: 302 } }).sender.sendToToken('wp:aaaaaaaaaaaa', critical)).error, 'webpush/redirect');
  });

  it('a network failure or timeout is retried for this browser, and the error text is not logged', async () => {
    const boom = Object.assign(new TypeError('fetch failed'), { cause: new Error(`connect ECONNRESET ${ENDPOINT}`) });
    const { sender, logger } = harness({ answer: boom });
    const out = await sender.sendToToken('wp:aaaaaaaaaaaa', critical);
    assert.deepEqual(out, { ok: false, prune: false, retry: true, allPhones: false, error: 'webpush/network-error' });
    assert.ok(!JSON.stringify(logger.lines).includes(SECRET_PATH));
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    assert.equal((await harness({ answer: timeout }).sender.sendToToken('wp:aaaaaaaaaaaa', critical)).error, 'webpush/network-timeout');
    assert.ok(SEND_TIMEOUT_MS <= 15_000);
  });

  it('a subscription gone from the store, or Web Push off, sends nothing', async () => {
    const { sender, calls } = harness();
    assert.equal((await sender.sendToToken('wp:bbbbbbbbbbbb', critical)).error, 'webpush/removed');
    const off = createWebPushSender({ vapid: { enabled: false, reason: 'unset' }, store: { subscriptionOf: () => browser().sub }, fetchImpl: async () => { throw new Error('no'); }, logger: silent() });
    assert.equal((await off.sendToToken('wp:aaaaaaaaaaaa', critical)).error, 'webpush/disabled');
    assert.equal(off.isEnabled(), false);
    assert.equal(off.publicKey(), null);
    assert.equal(calls.length, 0);
  });

  it('never posts to an endpoint that is not on the allowlist, even from a stored record, and prunes it', async () => {
    for (const endpoint of ['http://192.168.68.11:3060/x', 'https://evil.example/x', 'https://169.254.169.254/latest']) {
      const { sender, calls } = harness({ sub: { ...browser().sub, endpoint } });
      const out = await sender.sendToToken('wp:aaaaaaaaaaaa', critical);
      assert.equal(out.prune, true);
      assert.equal(out.error, 'webpush/endpoint-refused');
      assert.equal(calls.length, 0);
    }
  });

  it('bad stored keys fail the encryption, not the process, and are not retried', async () => {
    const { sender, calls } = harness({ sub: { ...browser().sub, auth: 'AAAA' } });
    const out = await sender.sendToToken('wp:aaaaaaaaaaaa', critical);
    assert.equal(out.error, 'webpush/encrypt-failed');
    assert.equal(out.retry, false);
    assert.equal(calls.length, 0);
  });

  it('logs the device id and a code, never the endpoint, its path, or a key', async () => {
    const ua = browser();
    for (const answer of [{ status: 410 }, { status: 500 }, { status: 403 }, new Error(ENDPOINT)]) {
      const { sender, logger } = harness({ answer, sub: ua.sub });
      await sender.sendToToken('wp:aaaaaaaaaaaa', critical);
      const text = JSON.stringify(logger.lines);
      assert.ok(logger.lines.length > 0);
      for (const secret of [SECRET_PATH, 'fcm.googleapis.com', ua.sub.p256dh, ua.sub.auth, keyPair.privateKey]) {
        assert.ok(!text.includes(secret), `${secret.slice(0, 12)} in the log`);
      }
    }
  });

  it('never throws, whatever the store does', async () => {
    const sender = createWebPushSender({ vapid, store: { subscriptionOf: () => { throw new Error(ENDPOINT); } }, logger: silent() });
    const out = await sender.sendToToken('wp:aaaaaaaaaaaa', critical);
    assert.equal(out.error, 'thrown');
  });
});
