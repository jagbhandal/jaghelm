import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { deviceIdOf } from './prefs.js';
import { generateVapidKeys } from './webPushCrypto.js';
import {
  checkKeys,
  cleanName,
  createWebPushStore,
  isWebToken,
  MAX_NAME_LENGTH,
  MAX_SUBSCRIPTIONS,
  subscriptionId,
} from './webPushStore.js';

const ENDPOINT = (n = 'one') => `https://fcm.googleapis.com/fcm/send/ENDPOINT-SECRET-${n}`;
const keys = () => ({
  p256dh: generateVapidKeys().publicKey,
  auth: randomBytes(16).toString('base64url'),
});
const sub = (n = 'one', extra = {}) => ({ endpoint: ENDPOINT(n), ...keys(), name: 'Pixel', ...extra });

describe('web push store', () => {
  let dir;
  let path;
  let t;
  const open = () => createWebPushStore({ path, now: () => t });
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wp-store-'));
    path = join(dir, 'push-subscriptions.json');
    t = Date.UTC(2026, 9, 24);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('registers a subscription, persists it 0600, and reloads it', () => {
    const s = open();
    const r = s.register(sub());
    assert.equal(r.ok, true);
    assert.equal(r.created, true);
    assert.match(r.id, /^[0-9a-f]{12}$/);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    const again = open();
    assert.deepEqual(again.list().map((x) => x.id), [r.id]);
    assert.ok(again.subscriptionOf(`wp:${r.id}`).endpoint.startsWith('https://fcm.googleapis.com/'));
  });

  it('is idempotent per endpoint: the same record is refreshed, not added', () => {
    const s = open();
    const a = s.register(sub('x', { name: 'Old' }));
    t += 1000;
    const b = s.register({ ...sub('x', { name: 'New' }) });
    assert.equal(b.id, a.id);
    assert.equal(b.created, false);
    assert.equal(s.list().length, 1);
    assert.equal(s.list()[0].name, 'New');
    assert.equal(s.list()[0].lastSeen, new Date(t).toISOString());
  });

  it('lists id, name, createdAt and lastSeen, and nothing that is a capability', () => {
    const s = open();
    s.register(sub('leak'));
    const everything = JSON.stringify([s.list(), s.getDevices(), s.getAllTokens(), s.getPrefs(`wp:${s.list()[0].id}`)]);
    assert.deepEqual(Object.keys(s.list()[0]).sort(), ['createdAt', 'id', 'lastSeen', 'name']);
    assert.ok(!everything.includes('ENDPOINT-SECRET'));
    assert.ok(!everything.includes('fcm.googleapis.com'));
    assert.ok(!/p256dh|"auth"|endpoint/.test(everything));
  });

  it('gives the sender the endpoint and keys only through subscriptionOf', () => {
    const s = open();
    const r = s.register(sub('k'));
    const got = s.subscriptionOf(`wp:${r.id}`);
    assert.deepEqual(Object.keys(got).sort(), ['auth', 'endpoint', 'p256dh']);
    assert.equal(s.subscriptionOf('wp:000000000000'), null);
    assert.equal(s.subscriptionOf('not-a-token'), null);
  });

  it('names a device with the id the outbox derives from its pseudo token', () => {
    const s = open();
    const r = s.register(sub('d'));
    assert.equal(deviceIdOf(`wp:${r.id}`), r.id);
    assert.equal(s.getDevices()[0].id, r.id);
    assert.equal(s.getDevices()[0].platform, 'web');
    assert.equal(r.id, subscriptionId(ENDPOINT('d')));
    assert.equal(isWebToken(`wp:${r.id}`), true);
    assert.equal(isWebToken('wp:xyz'), false);
  });

  it('limits: the count, the name, the endpoint host, the keys', () => {
    const s = open();
    for (let i = 0; i < MAX_SUBSCRIPTIONS; i += 1) assert.equal(s.register(sub(`n${i}`)).ok, true);
    const full = s.register(sub('overflow'));
    assert.equal(full.ok, false);
    assert.match(full.reason, /at most 20/);
    // an existing one still refreshes when full
    assert.equal(s.register(sub('n0')).ok, true);

    const s2 = createWebPushStore({ path: join(dir, 'two.json'), now: () => t });
    assert.equal(s2.register({ ...sub(), endpoint: 'http://192.168.1.1/x' }).ok, false);
    assert.equal(s2.register({ ...sub(), endpoint: 'https://evil.example/x' }).ok, false);
    assert.equal(s2.register({ ...sub(), p256dh: 'AAAA' }).ok, false);
    assert.equal(s2.register({ ...sub(), auth: 'AAAA' }).ok, false);
    assert.equal(cleanName('x'.repeat(500)).length, MAX_NAME_LENGTH);
    assert.equal(cleanName('  \n\t '), 'Web browser');
    assert.equal(cleanName(undefined), 'Web browser');
    assert.equal(cleanName('a\u0000b\nc'), 'a b c');
  });

  it('checkKeys wants a point on the curve and a 16 byte secret', () => {
    assert.equal(checkKeys(keys()).ok, true);
    const off = Buffer.alloc(65, 9);
    off[0] = 4;
    assert.equal(checkKeys({ p256dh: off.toString('base64url'), auth: keys().auth }).ok, false);
    assert.equal(checkKeys({ p256dh: keys().p256dh, auth: randomBytes(15).toString('base64url') }).ok, false);
    assert.equal(checkKeys({ p256dh: 'x'.repeat(500), auth: 'y' }).ok, false);
    assert.equal(checkKeys(null).ok, false);
    assert.equal(checkKeys({ p256dh: 1, auth: 2 }).ok, false);
    assert.equal(checkKeys({ p256dh: '***', auth: '***' }).ok, false);
  });

  it('removes by id, token and device id; reports what it did not have', () => {
    const s = open();
    const a = s.register(sub('a'));
    const b = s.register(sub('b'));
    const c = s.register(sub('c'));
    assert.equal(s.removeById(a.id), true);
    assert.equal(s.removeById(a.id), false);
    assert.equal(s.removeToken(`wp:${b.id}`), true);
    assert.equal(s.removeToken('some-retired-token'), false);
    assert.equal(s.removeDevice(c.id), true);
    assert.equal(s.removeDevice('zzzz'), false);
    assert.deepEqual(s.list(), []);
    assert.deepEqual(open().list(), []);
  });

  it('records deliveries and failures for the device list, and prunes the stale', () => {
    const s = open();
    const a = s.register(sub('a'));
    const tok = `wp:${a.id}`;
    assert.equal(s.recordFailure(tok, 'webpush/server-error'), true);
    assert.equal(s.getDevices()[0].lastError.code, 'webpush/server-error');
    t += 1000;
    s.markDelivered([tok]);
    const d = s.getDevices()[0];
    assert.equal(d.lastDeliveredAt, t);
    assert.equal(d.lastError, undefined);
    assert.equal(s.recordFailure('wp:ffffffffffff', 'x'), false);
    t += 181 * 24 * 3600 * 1000;
    assert.equal(s.pruneStale(), 1);
    assert.equal(s.list().length, 0);
  });

  it('prefs: default on, kept per subscription', () => {
    const s = open();
    const a = s.register(sub('a'));
    const tok = `wp:${a.id}`;
    assert.equal(s.getPrefs(tok).enabled, true);
    const prefs = { ...s.getPrefs(tok), notifyRecoveries: false };
    assert.equal(s.setPrefs(tok, prefs).prefs.notifyRecoveries, false);
    assert.equal(open().getPrefs(tok).notifyRecoveries, false);
    assert.equal(s.setPrefs('wp:ffffffffffff', prefs), null);
  });

  it('survives a damaged file and drops records that do not fit (a hand-edited endpoint)', () => {
    writeFileSync(path, '{not json');
    assert.deepEqual(open().list(), []);
    const good = sub('good');
    const gid = subscriptionId(good.endpoint);
    const evil = 'https://169.254.169.254/latest/meta-data';
    const k = keys();
    writeFileSync(
      path,
      JSON.stringify({
        [gid]: { ...good, createdAt: t, lastSeenAt: t, prefs: {} },
        [subscriptionId(evil)]: { endpoint: evil, ...k, createdAt: t, lastSeenAt: t },
        '0123456789ab': { endpoint: good.endpoint, ...k, createdAt: t, lastSeenAt: t },
        '__proto__': { endpoint: good.endpoint },
        bad: 5,
      })
    );
    const s = open();
    assert.deepEqual(s.list().map((x) => x.id), [gid]);
    assert.equal(s.getPrefs(`wp:${gid}`).enabled, true);
    assert.equal(JSON.parse(readFileSync(path, 'utf8'))[gid].endpoint, good.endpoint);
  });
});

describe('the health counts (#653)', () => {
  it('count subscriptions and the ones whose last send failed, from the device records alone', () => {
    const dir2 = mkdtempSync(join(tmpdir(), 'wp-health-'));
    const s = createWebPushStore({ path: join(dir2, 's.json') });
    const a = s.register(sub('ha'));
    s.register(sub('hb'));
    s.recordFailure(`wp:${a.id}`, 'webpush/server-error');
    const web = s.getDevices();
    assert.equal(web.length, 2);
    assert.equal(web.filter((d) => d.lastError).length, 1);
    assert.ok(!JSON.stringify(web.map((d) => d.lastError)).includes('ENDPOINT'));
    rmSync(dir2, { recursive: true, force: true });
  });
});
