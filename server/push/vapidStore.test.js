/**
 * JagHelm's own VAPID key pair (#698): made once, kept 0600, never replaced
 * over a subscription, never in a log, a status or a response.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { initWebPush, webPushStatus, getWebSender } from './channels.js';
import { loadOrCreateVapidKeys } from './vapidStore.js';
import { generateVapidKeys } from './webPushCrypto.js';
import { createWebPushRoutes } from '../routes/webPush.js';

const dir = mkdtempSync(join(tmpdir(), 'jh-vapid-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
let n = 0;
const fresh = () => join(dir, `case-${(n += 1)}`, 'vapid-keys.json');
const withDir = (path) => {
  // The data dir exists in a real boot; make this case's.
  mkdirSync(join(path, '..'), { recursive: true });
  return path;
};

function recorder() {
  const lines = [];
  const rec = (level) => (...a) => lines.push([level, ...a]);
  return { lines, logger: { info: rec('info'), warn: rec('warn'), error: rec('error') } };
}
const store = (count = 0) => ({ subscriptionOf: () => null, list: () => new Array(count).fill({}) });
const privateOf = (path) => JSON.parse(readFileSync(path, 'utf8')).privateKey;

describe('loadOrCreateVapidKeys', () => {
  it('makes a pair on the first call and reads the same one back on the second', () => {
    const path = withDir(fresh());
    const first = loadOrCreateVapidKeys({ path });
    assert.equal(first.ok, true);
    assert.equal(first.created, true);
    const second = loadOrCreateVapidKeys({ path });
    assert.equal(second.ok, true);
    assert.equal(second.created, false);
    assert.equal(second.publicKey, first.publicKey);
    assert.equal(second.privateKey, first.privateKey);
  });

  it('keeps the file at mode 0600 and leaves no temp file behind', () => {
    const path = withDir(fresh());
    loadOrCreateVapidKeys({ path });
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.deepEqual(readdirSync(join(path, '..')), ['vapid-keys.json']);
  });

  it('fails loudly on a corrupt file when browsers are subscribed, and leaves the file alone', () => {
    for (const bad of ['{not json', '{}', JSON.stringify({ publicKey: 'AAAA', privateKey: 'AAAA' }), '']) {
      const path = withDir(fresh());
      writeFileSync(path, bad, { mode: 0o600 });
      const out = loadOrCreateVapidKeys({ path, subscriptionCount: () => 2 });
      assert.equal(out.ok, false);
      assert.match(out.detail, /vapid-keys\.json/);
      assert.match(out.detail, /2 browsers are subscribed/);
      assert.match(out.detail, /will not make a new pair/);
      assert.equal(readFileSync(path, 'utf8'), bad);
    }
  });

  it('refuses a mismatched pair (a public key that is not the private key’s) the same way', () => {
    const path = withDir(fresh());
    const a = generateVapidKeys();
    const b = generateVapidKeys();
    writeFileSync(path, JSON.stringify({ publicKey: a.publicKey, privateKey: b.privateKey }), { mode: 0o600 });
    assert.equal(loadOrCreateVapidKeys({ path, subscriptionCount: () => 1 }).ok, false);
  });

  it('makes a new pair over a corrupt file only when no browser is subscribed, and says so', () => {
    const path = withDir(fresh());
    writeFileSync(path, '{not json', { mode: 0o600 });
    const { lines, logger } = recorder();
    const out = loadOrCreateVapidKeys({ path, subscriptionCount: () => 0, logger });
    assert.equal(out.ok, true);
    assert.equal(out.replaced, true);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.ok(lines.some(([, msg]) => /unusable and no browser was subscribed/.test(msg)));
    assert.equal(loadOrCreateVapidKeys({ path }).publicKey, out.publicKey);
  });

  it('never makes a new pair over a file it cannot read, even with no subscriptions', () => {
    const path = withDir(fresh());
    mkdirSync(path); // a directory where the file should be: EISDIR
    const out = loadOrCreateVapidKeys({ path, subscriptionCount: () => 0 });
    assert.equal(out.ok, false);
    assert.match(out.detail, /EISDIR/);
  });

  it('says it could not save when the data directory is not there, without a key', () => {
    const out = loadOrCreateVapidKeys({ path: join(dir, 'no-such-dir', 'vapid-keys.json') });
    assert.equal(out.ok, false);
    assert.match(out.detail, /data directory writable/);
  });

  it('concurrent callers in separate processes end up with one pair', async () => {
    const path = withDir(fresh());
    const module = fileURLToPath(new URL('./vapidStore.js', import.meta.url));
    const script = `import(${JSON.stringify(module)}).then((m) => { const r = m.loadOrCreateVapidKeys({ path: ${JSON.stringify(path)} }); process.stdout.write(r.ok ? r.publicKey + ' ' + r.created : 'FAIL'); });`;
    const runs = Array.from({ length: 8 }, () =>
      new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['-e', script], { env: { ...process.env, JAGHELM_DATA_DIR: dir } });
        let out = '';
        child.stdout.on('data', (d) => (out += d));
        child.on('error', reject);
        child.on('close', () => resolve(out));
      })
    );
    const results = (await Promise.all(runs)).map((o) => o.split(' '));
    assert.ok(results.every(([pub]) => pub !== 'FAIL'));
    assert.equal(new Set(results.map(([pub]) => pub)).size, 1, 'one public key');
    assert.equal(results.filter(([, created]) => created === 'true').length, 1, 'one creator');
    assert.equal(readdirSync(join(path, '..')).length, 1);
  });
});

describe('initWebPush with the stored pair (#698)', () => {
  const subject = 'mailto:ops@example.net';

  it('first boot makes and uses a pair; second boot reuses it; only the public key is exposed', () => {
    const keyFile = withDir(fresh());
    const { lines, logger } = recorder();
    initWebPush({ store: store(), env: {}, logger, keyFile });
    const first = webPushStatus();
    assert.equal(first.enabled, true);
    const priv = privateOf(keyFile);
    initWebPush({ store: store(), env: {}, logger, keyFile });
    assert.deepEqual(webPushStatus(), first);
    assert.equal(privateOf(keyFile), priv);
    assert.equal(getWebSender().isEnabled(), true);
    assert.equal(lines.filter(([, msg]) => /made a new VAPID key pair/.test(msg)).length, 1);
    // No secret in the logs or the status.
    assert.ok(!JSON.stringify(lines).includes(priv));
    assert.ok(!JSON.stringify(first).includes(priv));
    assert.deepEqual(Object.keys(first).sort(), ['enabled', 'publicKey']);
  });

  it('env values win when both are set: no file is made', () => {
    const keyFile = withDir(fresh());
    const env = generateVapidKeys();
    initWebPush({
      store: store(),
      env: { VAPID_PUBLIC_KEY: env.publicKey, VAPID_PRIVATE_KEY: env.privateKey, VAPID_SUBJECT: subject },
      logger: recorder().logger,
      keyFile,
    });
    assert.deepEqual(webPushStatus(), { enabled: true, publicKey: env.publicKey });
    assert.equal(existsSync(keyFile), false);
  });

  it('env wins over an existing file too', () => {
    const keyFile = withDir(fresh());
    initWebPush({ store: store(), env: {}, logger: recorder().logger, keyFile });
    const stored = webPushStatus().publicKey;
    const env = generateVapidKeys();
    initWebPush({
      store: store(),
      env: { VAPID_PUBLIC_KEY: env.publicKey, VAPID_PRIVATE_KEY: env.privateKey },
      logger: recorder().logger,
      keyFile,
    });
    assert.equal(webPushStatus().publicKey, env.publicKey);
    assert.notEqual(env.publicKey, stored);
  });

  it('one of the pair set: warns as before, names the missing one, makes no file', () => {
    for (const [set, missing] of [
      ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'],
      ['VAPID_PRIVATE_KEY', 'VAPID_PUBLIC_KEY'],
    ]) {
      const keyFile = withDir(fresh());
      const { lines, logger } = recorder();
      initWebPush({ store: store(), env: { [set]: generateVapidKeys().privateKey }, logger, keyFile });
      assert.deepEqual(webPushStatus(), { enabled: false, reason: 'incomplete', detail: `not set: ${missing}` });
      assert.ok(lines.some(([level]) => level === 'warn'));
      assert.equal(existsSync(keyFile), false);
    }
  });

  it('a VAPID_SUBJECT from the environment is used with the stored pair; a bad one turns push off', () => {
    const keyFile = withDir(fresh());
    initWebPush({ store: store(), env: { VAPID_SUBJECT: subject }, logger: recorder().logger, keyFile });
    assert.equal(webPushStatus().enabled, true);
    initWebPush({ store: store(), env: { VAPID_SUBJECT: 'ops@example.net' }, logger: recorder().logger, keyFile });
    assert.equal(webPushStatus().reason, 'invalid');
  });

  it('a corrupt file with subscriptions: push stays off, an error is logged, nothing replaced, no key in either', () => {
    const keyFile = withDir(fresh());
    initWebPush({ store: store(), env: {}, logger: recorder().logger, keyFile });
    const priv = privateOf(keyFile);
    const damaged = readFileSync(keyFile, 'utf8').slice(0, 40); // cut short
    writeFileSync(keyFile, damaged, { mode: 0o600 });
    const { lines, logger } = recorder();
    initWebPush({ store: store(3), env: {}, logger, keyFile });
    const status = webPushStatus();
    assert.equal(status.enabled, false);
    assert.equal(status.reason, 'invalid');
    assert.match(status.detail, /vapid-keys\.json/);
    assert.equal(readFileSync(keyFile, 'utf8'), damaged);
    assert.ok(lines.some(([level]) => level === 'error'));
    const text = JSON.stringify([lines, status]);
    assert.ok(!text.includes(priv));
    assert.ok(!text.includes(damaged.slice(-20)));
  });

  it('a corrupt file with no subscriptions: a new pair, push on', () => {
    const keyFile = withDir(fresh());
    writeFileSync(keyFile, 'garbage', { mode: 0o600 });
    initWebPush({ store: store(0), env: {}, logger: recorder().logger, keyFile });
    assert.equal(webPushStatus().enabled, true);
    assert.equal(statSync(keyFile).mode & 0o777, 0o600);
  });

  it('GET /api/push/web/key answers the public key only', async () => {
    const keyFile = withDir(fresh());
    initWebPush({ store: store(), env: {}, logger: recorder().logger, keyFile });
    const priv = privateOf(keyFile);
    const app = express();
    app.use('/api/push/web', createWebPushRoutes({ webStore: store(), status: webPushStatus }));
    const server = app.listen(0);
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/push/web/key`);
      const text = await res.text();
      assert.equal(res.status, 200);
      assert.deepEqual(Object.keys(JSON.parse(text)).sort(), ['enabled', 'publicKey']);
      assert.ok(!text.includes(priv));
    } finally {
      server.close();
    }
  });
});
