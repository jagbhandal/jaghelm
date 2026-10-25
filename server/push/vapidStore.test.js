/**
 * JagHelm's own VAPID key pair (#698): made once, kept 0600, never replaced
 * over a subscription, never in a log, a status or a response.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, chownSync, unlinkSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { initWebPush, webPushStatus, getWebSender } from './channels.js';
import { loadOrCreateVapidKeys } from './vapidStore.js';
import { generateVapidKeys } from './webPushCrypto.js';
import { createWebPushRoutes } from '../routes/webPush.js';

const dir = mkdtempSync(join(tmpdir(), 'jh-vapid-'));
chmodSync(dir, 0o755); // a child as another user must reach the cases
process.on('exit', () => {
  // Cases made read-only on purpose go back to normal first.
  const open = (d) => {
    try { chmodSync(d, 0o755); } catch { return; }
    for (const e of readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) open(join(d, e.name));
  };
  open(dir);
  rmSync(dir, { recursive: true, force: true });
});

/**
 * loadOrCreateVapidKeys in a child process. As root (CI) the child runs as
 * uid 1000, so permission failures are real there too; anyone else runs it as
 * themselves.
 */
function probe(path, { subs = 0 } = {}) {
  const module = fileURLToPath(new URL('./vapidStore.js', import.meta.url));
  const script = `import(${JSON.stringify(module)}).then((m) => { const r = m.loadOrCreateVapidKeys({ path: ${JSON.stringify(path)}, subscriptionCount: () => ${subs} }); process.stdout.write(JSON.stringify({ ok: r.ok, problem: r.problem, detail: r.detail })); });`;
  const asOther = process.getuid() === 0 ? { uid: 1000, gid: 1000 } : {};
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', script], { env: { ...process.env, JAGHELM_DATA_DIR: dir }, ...asOther });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('error', reject);
    child.on('close', () => resolve(JSON.parse(out)));
  });
}
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
/** Root hands the file to uid 1000 so the child that can't read it is that user, not its owner. */
const chownSafe = (p) => { if (process.getuid() === 0) chownSync(p, 1000, 1000); };
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
    assert.deepEqual(readdirSync(join(path, '..')), ['vapid-keys.json']); // no temp, no lock
  });

  it('fails loudly on a corrupt file when browsers are subscribed, and leaves the file alone', () => {
    for (const bad of ['{not json', '{}', JSON.stringify({ publicKey: 'AAAA', privateKey: 'AAAA' }), '']) {
      const path = withDir(fresh());
      writeFileSync(path, bad, { mode: 0o600 });
      const out = loadOrCreateVapidKeys({ path, subscriptionCount: () => 2 });
      assert.equal(out.ok, false);
      assert.match(out.detail, /vapid-keys\.json/);
      assert.match(out.detail, /2 browsers are subscribed/);
      assert.equal(out.problem, 'damaged');
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
    const aside = readdirSync(join(path, '..')).filter((f) => f.startsWith('vapid-keys.json.bad-'));
    assert.equal(aside.length, 1, 'the damaged file is kept, not deleted');
    assert.equal(statSync(join(path, '..', aside[0])).mode & 0o777, 0o600);
  });

  it('keeps only the newest 3 damaged files', () => {
    const path = withDir(fresh());
    for (let i = 0; i < 5; i += 1) {
      writeFileSync(path, `bad ${i}`, { mode: 0o600 });
      assert.equal(loadOrCreateVapidKeys({ path }).ok, true);
      unlinkSync(path);
    }
    assert.equal(readdirSync(join(path, '..')).filter((f) => f.includes('.bad-')).length, 3);
  });

  it('tightens a key file others could read to 0600, warns once, and logs no content', () => {
    const path = withDir(fresh());
    const made = loadOrCreateVapidKeys({ path });
    chmodSync(path, 0o644);
    const { lines, logger } = recorder();
    const again = loadOrCreateVapidKeys({ path, logger });
    assert.equal(again.publicKey, made.publicKey);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(lines.filter(([level]) => level === 'warn').length, 1);
    assert.ok(!JSON.stringify(lines).includes(made.privateKey));
    loadOrCreateVapidKeys({ path, logger });
    assert.equal(lines.filter(([level]) => level === 'warn').length, 1, 'nothing more once tightened');
  });

  it('warns once, with the count, when it makes a pair while browsers are subscribed', () => {
    const path = withDir(fresh());
    const { lines, logger } = recorder();
    const out = loadOrCreateVapidKeys({ path, subscriptionCount: () => 4, logger });
    assert.equal(out.ok, true);
    const warns = lines.filter(([level]) => level === 'warn');
    assert.equal(warns.length, 1);
    assert.deepEqual(warns[0][1], { subscriptions: 4 });
    assert.match(warns[0][2], /re-subscribes when it opens JagHelm/);
    assert.ok(!JSON.stringify(lines).includes(out.privateKey));
    const quiet = recorder();
    loadOrCreateVapidKeys({ path, subscriptionCount: () => 4, logger: quiet.logger });
    assert.equal(quiet.lines.length, 0, 'a later boot says nothing');
  });

  it('sweeps temp files older than 5 minutes and keeps newer ones', () => {
    const path = withDir(fresh());
    const old = `${path}.tmp.1.2.abc`;
    const young = `${path}.tmp.3.4.def`;
    writeFileSync(old, 'x', { mode: 0o600 });
    writeFileSync(young, 'y', { mode: 0o600 });
    const past = new Date(Date.now() - 6 * 60 * 1000);
    utimesSync(old, past, past);
    loadOrCreateVapidKeys({ path });
    assert.equal(existsSync(old), false);
    assert.equal(existsSync(young), true);
  });

  it('a key file nobody may read is unreadable, never replaced (a real EACCES, as another user when root)', async () => {
    const path = withDir(fresh());
    loadOrCreateVapidKeys({ path });
    const before = readFileSync(path, 'utf8');
    chownSafe(path);
    chmodSync(path, 0o000);
    const out = await probe(path);
    chmodSync(path, 0o600);
    assert.equal(out.ok, false);
    assert.equal(out.problem, 'unreadable');
    assert.match(out.detail, /EACCES/);
    assert.equal(readFileSync(path, 'utf8'), before);
  });

  it('a data folder that can’t be written is unwritable (a real EACCES, as another user when root)', async () => {
    const path = withDir(fresh());
    const folder = join(path, '..');
    chmodSync(folder, 0o555);
    const out = await probe(path);
    chmodSync(folder, 0o755);
    assert.equal(out.ok, false);
    assert.equal(out.problem, 'unwritable');
    assert.match(out.detail, /EACCES|EROFS|ENOSPC/);
    assert.deepEqual(readdirSync(folder), []);
  });

  it('racing replacements of a damaged file (no subscribers) end with one pair and one kept file', async () => {
    const path = withDir(fresh());
    writeFileSync(path, 'damaged', { mode: 0o600 });
    const module = fileURLToPath(new URL('./vapidStore.js', import.meta.url));
    const script = `import(${JSON.stringify(module)}).then((m) => { const r = m.loadOrCreateVapidKeys({ path: ${JSON.stringify(path)} }); process.stdout.write(r.ok ? r.publicKey : 'FAIL'); });`;
    const runs = Array.from({ length: 8 }, () =>
      new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['-e', script], { env: { ...process.env, JAGHELM_DATA_DIR: dir } });
        let out = '';
        child.stdout.on('data', (d) => (out += d));
        child.on('error', reject);
        child.on('close', () => resolve(out));
      })
    );
    const keys = await Promise.all(runs);
    assert.ok(!keys.includes('FAIL'));
    assert.equal(new Set(keys).size, 1);
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).publicKey, keys[0]);
    assert.equal(readdirSync(join(path, '..')).filter((f) => f.includes('.bad-')).length, 1);
    assert.equal(readdirSync(join(path, '..')).length, 2, 'the pair and the damaged file; no lock or temp');
  });

  it('never makes a new pair over a file it cannot read, even with no subscriptions', () => {
    const path = withDir(fresh());
    mkdirSync(path); // a directory where the file should be: EISDIR
    const out = loadOrCreateVapidKeys({ path, subscriptionCount: () => 0 });
    assert.equal(out.ok, false);
    assert.equal(out.problem, 'unreadable');
    assert.match(out.detail, /EISDIR/);
  });

  it('says it could not save when the data directory is not there, without a key', () => {
    const out = loadOrCreateVapidKeys({ path: join(dir, 'no-such-dir', 'vapid-keys.json') });
    assert.equal(out.ok, false);
    assert.equal(out.problem, 'unwritable');
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
    assert.equal(status.reason, 'key-file-damaged');
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

  it('a data folder that is not there: push off with reason key-file-unwritable and an error line', () => {
    const { lines, logger } = recorder();
    initWebPush({ store: store(), env: {}, logger, keyFile: join(dir, 'missing', 'vapid-keys.json') });
    assert.equal(webPushStatus().enabled, false);
    assert.equal(webPushStatus().reason, 'key-file-unwritable');
    assert.ok(lines.some(([level]) => level === 'error'));
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
