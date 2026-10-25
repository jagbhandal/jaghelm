/**
 * The data-folder check at boot (#697): a missing, read-only or wrong-kind
 * folder stops the start with one plain message (the folder, the uid/gid, the
 * fix commands, no stack) and a non-zero exit; a usable folder prints nothing
 * new. The real server is started for the end-to-end cases.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkDataDirs, dataDirMessage, dirProblem } from './util/dataDirCheck.js';

const serverEntry = fileURLToPath(new URL('./index.js', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'jh-datadir-'));
// root ignores permission bits (CI runs as root), so the unwritable cases run
// as an ordinary user, uid 1000 as in the image, over folders root owns that
// others can read but not write. The root dir must let that user in.
const asRoot = process.getuid?.() === 0;
const lowUser = asRoot ? { uid: 1000, gid: 1000 } : {};
chmodSync(root, 0o755);
const READ_ONLY = 0o555;
const lockedDirs = [];
after(() => {
  for (const d of lockedDirs) chmodSync(d, 0o700);
  rmSync(root, { recursive: true, force: true });
});
/** A folder nobody can write to (root-owned in CI, as a Docker-made bind mount is). */
function lockedDir(name) {
  const d = join(root, name);
  mkdirSync(d);
  chmodSync(d, READ_ONLY);
  lockedDirs.push(d);
  return d;
}
/** dirProblem(dir), run as the low user so permission bits count. */
function problemAs(dir) {
  const code = `import(${JSON.stringify(new URL('./util/dataDirCheck.js', import.meta.url).href)}).then((m) => console.log(JSON.stringify(m.dirProblem(${JSON.stringify(dir)}))))`;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], { ...lowUser, encoding: 'utf8' }));
}

test('dirProblem: a writable folder is fine, a missing one is made', () => {
  const ok = join(root, 'ok');
  mkdirSync(ok);
  assert.equal(dirProblem(ok), null);
  const made = join(root, 'made', 'deep');
  assert.equal(dirProblem(made), null);
  assert.ok(existsSync(made));
});

test('dirProblem: a file in place of the folder is named as such', () => {
  const f = join(root, 'afile');
  writeFileSync(f, 'x');
  assert.match(dirProblem(f) ?? '', /not a folder/);
  assert.match(dirProblem(join(f, 'inside')) ?? '', /not a folder/);
});

test('dirProblem: a read-only folder, and one that cannot be made under a read-only parent', () => {
  const ro = lockedDir('ro');
  assert.match(problemAs(ro) ?? '', /not writable/);
  assert.match(problemAs(join(ro, 'data')) ?? '', /can't be created/);
});

test('dirProblem leaves no probe file behind, on success', () => {
  const ok = join(root, 'probe-ok');
  mkdirSync(ok);
  assert.equal(dirProblem(ok), null);
  assert.deepEqual(readdirSync(ok), []);
});

test('checkDataDirs: usable folders write nothing', () => {
  const dir = join(root, 'quiet');
  mkdirSync(dir);
  let wrote = '';
  assert.equal(checkDataDirs([{ label: 'data', dir }], { write: (t) => (wrote += t) }), true);
  assert.equal(wrote, '');
});

test('the message names the folder, the uid/gid and the fix, with no stack', () => {
  let wrote = '';
  const dir = join(root, 'afile');
  assert.equal(checkDataDirs([{ label: 'data', dir }], { write: (t) => (wrote += t), uid: 1000, gid: 1000, inDocker: true, customData: false }), false);
  assert.ok(wrote.includes(dir));
  assert.match(wrote, /uid 1000, gid 1000/);
  assert.match(wrote, /mkdir -p \.\/data && sudo chown -R 1000:1000 \.\/data/);
  assert.match(wrote, /named volume/);
  assert.doesNotMatch(wrote, /\n\s+at |EACCES|Error:/);
  // the real uid:gid, and JAGHELM_DATA_DIR's own path when it is set
  wrote = '';
  checkDataDirs([{ label: 'data', dir }], { write: (t) => (wrote += t), uid: 1234, gid: 5678, inDocker: true, customData: true });
  assert.ok(wrote.includes(`sudo chown -R 1234:5678 ${dir}`));
  assert.doesNotMatch(dataDirMessage([{ label: 'data', dir, problem: 'x' }], { uid: 1, gid: 2, inDocker: false }), /sudo/);
});

/** Start the server; resolve with what it printed and its exit code, or stop it once it listens. */
function boot(env, user = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [serverEntry], {
      cwd: root,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, JAGHELM_HOST: '127.0.0.1', PORT: '0', DASH_SECRET: 'datadir-test-secret-at-least-16', ...env }, // pragma: allowlist secret
      stdio: ['ignore', 'pipe', 'pipe'],
      ...user,
    });
    let out = '';
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      child.kill('SIGTERM');
      resolve({ out, code });
    };
    const deadline = setTimeout(() => finish(null), 30_000);
    const onData = (d) => {
      out += d;
      if (out.includes('"listening"')) finish(null);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => finish(code));
  });
}

test('boot: a data path that is a file stops the start with the one message, exit 1, no stack', async () => {
  const f = join(root, 'boot-file');
  writeFileSync(f, 'x');
  const { out, code } = await boot({ JAGHELM_DATA_DIR: f }, lowUser);
  assert.equal(code, 1);
  assert.ok(out.includes(f));
  assert.match(out, /uid \d+, gid \d+/);
  assert.doesNotMatch(out, /\n\s+at |fatal boot error|EACCES/);
  assert.equal(out.match(/cannot start/g)?.length, 1);
});

test('boot: a read-only data folder stops the start with the one message', async () => {
  const ro = lockedDir('boot-ro');
  const { out, code } = await boot({ JAGHELM_DATA_DIR: ro }, lowUser);
  assert.equal(code, 1);
  assert.ok(out.includes(ro));
  assert.match(out, /not writable/);
  assert.doesNotMatch(out, /\n\s+at |fatal boot error/);
});

test('boot: a missing data folder under an unwritable parent stops the start', async () => {
  const ro = lockedDir('boot-ro-parent');
  const { out, code } = await boot({ JAGHELM_DATA_DIR: join(ro, 'data') }, lowUser);
  assert.equal(code, 1);
  assert.match(out, /can't be created/);
  assert.doesNotMatch(out, /\n\s+at |fatal boot error/);
});

test('boot: a writable data folder starts as before, with no check message', async () => {
  const ok = join(root, 'boot-ok');
  const { out, code } = await boot({ JAGHELM_DATA_DIR: ok });
  assert.equal(code, null);
  assert.ok(out.includes('"listening"'));
  assert.doesNotMatch(out, /cannot start/);
});
