/**
 * #423: services.yaml's version is an HMAC-SHA256 of the file, keyed with 32
 * random bytes kept in DATA_DIR/config-version.key (mode 0600) and made on
 * first use. Unkeyed, a version kept in a HAR file or a screenshot let anyone
 * rebuild a JagHelm-written file from the masked read and test guesses at a
 * weak plaintext credential in it offline. Since #547 the key and the
 * versions live in util/fileVersion.js, which display-config.json's version
 * shares.
 *
 * Each "boot" here is a fresh copy of the version module (a new import URL),
 * which reads its key from disk again, as after a restart. What the config
 * module does with it at boot runs in a process of its own.
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
const FILE =
  "nodes:\n  pi1:\n    display_name: Gateway\nintegrations:\n  npm:\n    password: 'hunter2'\n"; // pragma: allowlist secret

let boots = 0;
/** A fresh version module, as after a restart. */
const boot = () => import(`./fileVersion.js?boot=${++boots}`);
/** services.yaml's version as a fresh version module makes it. */
const versionNow = async () => (await boot()).readVersioned(YAML_PATH).version;
const hmac = (key, text) => createHmac('sha256', key).update(text).digest('base64url');
const sha256 = (text) => createHash('sha256').update(text).digest('base64url');

const CONFIG_URL = new URL('../config.js', import.meta.url).href;

/** Run `src` (an ES module) in a process of its own on this data dir; its stdout. */
function runNode(src) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', src], {
      env: { ...process.env, JAGHELM_DATA_DIR: dir, LOG_LEVEL: 'silent' },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(`exit ${code}`))));
  });
}

test('a missing key file is made on first use: 32 random bytes, mode 0600', async () => {
  writeFileSync(YAML_PATH, FILE);
  assert.equal(existsSync(KEY_PATH), false);
  const version = await versionNow();

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

test("services.yaml's version is the one the config module answers", async () => {
  const out = await runNode(
    `const { readConfig } = await import(${JSON.stringify(CONFIG_URL)});
    process.stdout.write(readConfig().version);`
  );
  assert.equal(out, hmac(readFileSync(KEY_PATH), FILE));
});

test('the version is the same after a restart (the same key file)', async () => {
  const first = await versionNow();
  const second = await versionNow();
  assert.equal(second, first);
  assert.equal(second, hmac(readFileSync(KEY_PATH), FILE));
});

test('another key gives another version of the same file', async () => {
  const before = await versionNow();
  writeFileSync(KEY_PATH, randomBytes(32), { mode: 0o600 });
  const after = await versionNow();
  assert.notEqual(after, before);
  assert.equal(after, hmac(readFileSync(KEY_PATH), FILE));
});

test('boots racing to make the key all end up with the one key on disk', async () => {
  rmSync(KEY_PATH, { force: true });
  const src = `const { readConfig } = await import(${JSON.stringify(CONFIG_URL)});
    process.stdout.write(readConfig().version);`;
  const versions = await Promise.all([runNode(src), runNode(src), runNode(src), runNode(src)]);
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
  const fails = (err) => {
    assert.match(err.message, /config-version\.key/);
    assert.ok(!err.message.includes('k3y-material'), 'the error quotes the key');
    return true;
  };
  for (const [name, make] of Object.entries(cases)) {
    await t.test(name, { skip: name.startsWith('unreadable') && isRoot }, async () => {
      rmSync(KEY_PATH, { recursive: true, force: true });
      make();
      const versions = await boot();
      // Every version needs the key: services.yaml's and display-config.json's.
      assert.throws(() => versions.versionKey(), fails);
      assert.throws(() => versions.readVersioned(YAML_PATH), fails);
      assert.throws(() => versions.versionOf('{}'), fails);
      // At boot (index.js loads the config first) and on every read after.
      const out = await runNode(
        `const config = await import(${JSON.stringify(CONFIG_URL)});
        for (const call of ['loadConfig', 'readConfig']) {
          try { config[call](); process.stdout.write(call + ' did not throw\\n'); }
          catch (err) { process.stdout.write(call + ' threw: ' + err.message + '\\n'); }
        }`
      );
      const lines = out.trim().split('\n');
      assert.equal(lines.length, 2, out);
      for (const line of lines) {
        assert.match(line, /^(loadConfig|readConfig) threw: /, out);
        fails(new Error(line));
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
