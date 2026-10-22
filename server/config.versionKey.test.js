/**
 * #423: services.yaml's version is an HMAC-SHA256 of the file, keyed with 32
 * random bytes kept in DATA_DIR/config-version.key (mode 0600) and made on
 * first use. Unkeyed, a version kept in a HAR file or a screenshot let anyone
 * rebuild a JagHelm-written file from the masked read and test guesses at a
 * weak plaintext credential in it offline.
 *
 * Each "boot" here is a fresh copy of the config module (a new import URL),
 * which reads its key from disk again, as after a restart.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'jh-config-key-'));
process.env.JAGHELM_DATA_DIR = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const KEY_PATH = join(dir, 'config-version.key');
const YAML_PATH = join(dir, 'services.yaml');
const FILE = "nodes:\n  pi1:\n    display_name: Gateway\nintegrations:\n  npm:\n    password: 'hunter2'\n"; // pragma: allowlist secret

let boots = 0;
/** A fresh config module, as after a restart. */
const boot = () => import(`./config.js?boot=${++boots}`);
const hmac = (key, text) => createHmac('sha256', key).update(text).digest('base64url');
const sha256 = (text) => createHash('sha256').update(text).digest('base64url');

test('a missing key file is made on first use: 32 random bytes, mode 0600', async () => {
  writeFileSync(YAML_PATH, FILE);
  assert.equal(existsSync(KEY_PATH), false);
  const { readConfig } = await boot();
  const { version } = readConfig();

  const key = readFileSync(KEY_PATH);
  assert.equal(key.length, 32);
  assert.equal(statSync(KEY_PATH).mode & 0o777, 0o600);
  assert.equal(version, hmac(key, FILE));
  assert.notEqual(version, sha256(FILE), 'the version is a plain hash of the file');
  assert.deepEqual(
    readdirSync(dir).sort(),
    ['config-version.key', 'services.yaml'],
    'a temp file was left behind'
  );
});

test('the version is the same after a restart (the same key file)', async () => {
  const first = (await boot()).readConfig().version;
  const second = (await boot()).readConfig().version;
  assert.equal(second, first);
  assert.equal(second, hmac(readFileSync(KEY_PATH), FILE));
});

test('another key gives another version of the same file', async () => {
  const before = (await boot()).readConfig().version;
  writeFileSync(KEY_PATH, randomBytes(32), { mode: 0o600 });
  const after = (await boot()).readConfig().version;
  assert.notEqual(after, before);
  assert.equal(after, hmac(readFileSync(KEY_PATH), FILE));
});

test('boots racing to make the key all end up with the one key on disk', async () => {
  rmSync(KEY_PATH, { force: true });
  const configUrl = new URL('./config.js', import.meta.url).href;
  const src = `const { readConfig } = await import(${JSON.stringify(configUrl)});
    process.stdout.write(readConfig().version);`;
  const run = () =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', src], {
        env: { ...process.env, JAGHELM_DATA_DIR: dir, LOG_LEVEL: 'silent' },
        stdio: ['ignore', 'pipe', 'inherit'],
      });
      let out = '';
      child.stdout.on('data', (c) => (out += c));
      child.on('error', reject);
      child.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(`exit ${code}`))));
    });
  const versions = await Promise.all([run(), run(), run(), run()]);
  const want = hmac(readFileSync(KEY_PATH), FILE);
  assert.deepEqual(versions, [want, want, want, want]);
  assert.equal(readFileSync(KEY_PATH).length, 32);
  assert.equal(statSync(KEY_PATH).mode & 0o777, 0o600);
});

test('a key file that cannot be used fails loudly: no other key is used, none is written', async (t) => {
  const cases = {
    'a directory': () => mkdirSync(KEY_PATH),
    'too short': () => writeFileSync(KEY_PATH, 'k3y-material-x', { mode: 0o600 }),
    empty: () => writeFileSync(KEY_PATH, '', { mode: 0o600 }),
    'unreadable (mode 000)': () => {
      writeFileSync(KEY_PATH, randomBytes(32));
      chmodSync(KEY_PATH, 0o000);
    },
  };
  const isRoot = process.getuid?.() === 0;
  for (const [name, make] of Object.entries(cases)) {
    await t.test(name, { skip: name.startsWith('unreadable') && isRoot }, async () => {
      rmSync(KEY_PATH, { recursive: true, force: true });
      make();
      const config = await boot();
      // At boot (index.js loads the config first) and on every read after.
      for (const call of [() => config.loadConfig(), () => config.readConfig()]) {
        assert.throws(call, (err) => {
          assert.match(err.message, /config-version\.key/);
          assert.ok(!err.message.includes('k3y-material'), 'the error quotes the key');
          return true;
        });
      }
      assert.deepEqual(
        readdirSync(dir).sort(),
        ['config-version.key', 'services.yaml'],
        'another key was written'
      );
    });
  }
  rmSync(KEY_PATH, { recursive: true, force: true });
});
