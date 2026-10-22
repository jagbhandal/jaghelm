/**
 * #536: a services.yaml JagHelm can't read is a config failure, like one that
 * doesn't parse (#505), and it mends itself.
 *
 * A file that can't be read (EACCES, EISDIR, EIO…) used to give an empty,
 * calm board at boot, and a Settings save over it was a 500. Now the config
 * source is down with the reason ("services.yaml can't be read (permission
 * denied)"), `/api/health` says `unreadable`, and every writer refuses it as
 * `config_unreadable`. A permission fix doesn't change the file's mtime, so
 * the watcher, which looked at nothing else, never saw it: it now compares
 * the file's ctime, size and inode too, so a chmod or chown of the file shows
 * at its next look. A fix the file's own stat doesn't show (its folder's
 * permissions, a network share's cached attributes) needs the retry: while the
 * source is down (unreadable or unparseable) it re-reads the file every 30 s,
 * one timer at most, stopped once the source is up and on shutdown. A broken
 * or unreadable file deleted is broken no more: what a missing file means
 * today.
 *
 * Its own file because the module's state is the point: the first test runs
 * against a fresh module, as at boot. Reads go through a stand-in for
 * readFileSync, which counts them, can fail them (as a permission change
 * does: the file and its stat stay) and can answer other bytes than the file
 * holds (a network share's cached view); root reads a mode-000 file anyway,
 * so the real EACCES runs only as another user, and EISDIR always.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';

const {
  CONFIG_ABSENT,
  configHealth,
  configProblem,
  getConfig,
  loadConfig,
  readConfig,
  saveConfig,
  startConfigWatcher,
  stopConfigWatcher,
  writeConfig,
} = await import('./config.js');

const CONFIG_PATH = join(process.env.JAGHELM_DATA_DIR, 'services.yaml');
const GOOD = 'nodes:\n  pi1:\n    display_name: Gateway\nservices: {}\n';
const BROKEN = 'nodes:\n  pi1:\n    display_name: Gateway\n   visible: true\n';

// Every read of services.yaml goes through here: counted; while `blocked`
// names a code, one of a file that is there fails with it; while `bytes` is
// set, it answers those instead of the file's.
const realRead = fs.readFileSync;
const reads = { count: 0, blocked: null, bytes: null };
fs.readFileSync = function readFileSync(path, ...rest) {
  if (path === CONFIG_PATH) {
    reads.count += 1;
    if (reads.blocked && fs.existsSync(path)) {
      throw Object.assign(new Error(`${reads.blocked}: blocked, open '${path}'`), {
        code: reads.blocked,
      });
    }
    if (reads.bytes !== null) return Buffer.from(reads.bytes);
  }
  return realRead(path, ...rest);
};

/** Wait out the clock's coarse tick, so the next change gets a new ctime. */
function nextCtime() {
  const until = Date.now() + 25;
  while (Date.now() < until) {
    // busy: the timers are fake in these tests
  }
}
syncBuiltinESMExports();
after(() => {
  stopConfigWatcher();
  fs.readFileSync = realRead;
  syncBuiltinESMExports();
});

const fileText = () => realRead(CONFIG_PATH, 'utf8');
const UNREADABLE = "services.yaml can't be read (permission denied)";
const REFUSAL = `${UNREADABLE}: fix it on the host; JagHelm won't save over a file it can't read`;

test('unreadable at boot: the config source is down with the reason, health says unreadable, the board starts empty', () => {
  fs.writeFileSync(CONFIG_PATH, GOOD);
  reads.blocked = 'EACCES';
  // A file is there, so this is no first boot: no discovery, nothing written.
  assert.deepEqual(loadConfig(), {});
  assert.deepEqual(configHealth(), { state: 'unreadable', code: 'EACCES' });
  assert.deepEqual(configProblem(), { line: null, reason: UNREADABLE });
  assert.equal(fileText(), GOOD);
});

test('a read while unreadable answers why, never throws, and names no path', () => {
  const read = readConfig();
  assert.deepEqual(read, {
    config: null,
    version: null,
    unusable: REFUSAL,
    code: 'config_unreadable',
  });
  assert.doesNotMatch(JSON.stringify([read, configHealth(), configProblem()]), /\//);
});

test('every write while unreadable is refused and the file is untouched', () => {
  for (const version of [CONFIG_ABSENT, 'any-version', null]) {
    const saved = writeConfig({ nodes: {}, services: {} }, version);
    assert.deepEqual(saved, { ok: false, unusable: REFUSAL, code: 'config_unreadable' });
  }
  assert.equal(saveConfig({ nodes: {}, services: {} }), false, 'nor the first-boot writer');
  assert.equal(fileText(), GOOD);
  assert.deepEqual(getConfig(), {}, 'the board keeps what it had');
});

test('each read error is said in plain words, or by its code', () => {
  const cases = {
    EISDIR: "it's a directory",
    EIO: 'I/O error',
    EPERM: 'operation not permitted',
    ELOOP: 'too many symlinks',
    ESTALE: 'ESTALE',
  };
  for (const [code, words] of Object.entries(cases)) {
    reads.blocked = code;
    loadConfig();
    assert.deepEqual(configHealth(), { state: 'unreadable', code });
    assert.equal(configProblem().reason, `services.yaml can't be read (${words})`);
    assert.equal(readConfig().code, 'config_unreadable');
  }
  reads.blocked = null;
});

test('readable again: the next read loads it and the source is up', () => {
  assert.equal(readConfig().config.nodes.pi1.display_name, 'Gateway');
  assert.deepEqual(configHealth(), { state: 'ok' });
  assert.equal(configProblem(), null);
});

test('unreadable after a good load: the last good config stays, as for a reload that fails to parse (#505)', () => {
  reads.blocked = 'EACCES';
  // The watcher's reload, and a route's read.
  assert.equal(loadConfig().nodes.pi1.display_name, 'Gateway');
  assert.equal(readConfig().config, null);
  assert.equal(getConfig().nodes.pi1.display_name, 'Gateway');
  assert.deepEqual(configHealth(), { state: 'unreadable', code: 'EACCES' });
  reads.blocked = null;
  loadConfig();
  assert.deepEqual(configHealth(), { state: 'ok' });
});

test('the retry: one re-read every 30 s however many reads failed; a permission fix recovers within one retry, then it stops', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  reads.blocked = 'EACCES';
  // Failure after failure: the boot, the watcher's reload, routes' reads.
  loadConfig();
  loadConfig();
  readConfig();
  readConfig();
  startConfigWatcher();
  readConfig();

  // The watcher only stats the file, and its stat hasn't changed.
  let before = reads.count;
  t.mock.timers.tick(29_999);
  assert.equal(reads.count, before, 'no retry before 30 s');
  t.mock.timers.tick(1);
  assert.equal(reads.count, before + 1, 'one timer, one re-read');
  t.mock.timers.tick(30_000);
  assert.equal(reads.count, before + 2);
  assert.deepEqual(configHealth(), { state: 'unreadable', code: 'EACCES' });

  // Fixed in a way the file's stat doesn't show (its folder's permissions).
  // The watcher can't see it.
  reads.blocked = null;
  t.mock.timers.tick(29_999);
  assert.equal(configHealth().state, 'unreadable');
  t.mock.timers.tick(1);
  assert.deepEqual(configHealth(), { state: 'ok' }, 'recovered within one retry');
  assert.equal(configProblem(), null);
  assert.equal(getConfig().nodes.pi1.display_name, 'Gateway');

  // Up: the retry has stopped. Unreadable again with nothing reading it, and
  // no re-read in two minutes.
  reads.blocked = 'EACCES';
  before = reads.count;
  t.mock.timers.tick(120_000);
  assert.equal(reads.count, before, 'the retry stopped on recovery');
  reads.blocked = null;
  stopConfigWatcher();
});

test('the retry stops on shutdown', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  reads.blocked = 'EIO';
  loadConfig();
  startConfigWatcher();
  let before = reads.count;
  t.mock.timers.tick(30_000);
  assert.equal(reads.count, before + 1);
  stopConfigWatcher();
  before = reads.count;
  t.mock.timers.tick(300_000);
  assert.equal(reads.count, before, 'no re-read after shutdown');
  reads.blocked = null;
  loadConfig();
  assert.deepEqual(configHealth(), { state: 'ok' });
});

test('the retry mends a broken file whose fix the stat does not show (a network share\'s cached view)', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  fs.writeFileSync(CONFIG_PATH, BROKEN);
  loadConfig();
  assert.equal(configHealth().state, 'unparseable');
  startConfigWatcher();
  // The watcher's first look reads it again (its stat is new), still broken.
  t.mock.timers.tick(5_000);
  t.mock.timers.tick(250);
  assert.equal(configHealth().state, 'unparseable');
  // Fixed where the file's stat, as this host sees it, stays the same.
  reads.bytes = GOOD;
  t.mock.timers.tick(30_000 - 5_250 - 1);
  assert.equal(configHealth().state, 'unparseable', 'the watcher alone sees no change');
  t.mock.timers.tick(1);
  assert.deepEqual(configHealth(), { state: 'ok' });
  stopConfigWatcher();
  reads.bytes = null;
  fs.writeFileSync(CONFIG_PATH, GOOD);
  loadConfig();
});

// A chmod or chown changes the file's ctime, not its mtime (#536 review): the
// watcher's next look reads it, so the source goes down, and back up, at once.
for (const [how, opts, block] of [
  ['a real chmod 000', { skip: process.getuid?.() === 0 && 'root reads a mode-000 file' }, false],
  ['a chmod whose read then fails (as root)', {}, true],
]) {
  test(`after a good load, ${how}: down at the watcher's next look, and up at the next after the fix`, opts, (t) => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
    t.after(() => stopConfigWatcher());
    fs.writeFileSync(CONFIG_PATH, GOOD);
    loadConfig();
    startConfigWatcher();
    nextCtime();
    fs.chmodSync(CONFIG_PATH, block ? 0o600 : 0o000);
    if (block) reads.blocked = 'EACCES';
    try {
      t.mock.timers.tick(5_000);
      t.mock.timers.tick(250);
      assert.deepEqual(configHealth(), { state: 'unreadable', code: 'EACCES' }, 'no route read it');
      assert.equal(getConfig().nodes.pi1.display_name, 'Gateway', 'the last good config stays');
    } finally {
      nextCtime();
      fs.chmodSync(CONFIG_PATH, 0o644);
      reads.blocked = null;
    }
    // The next look, well before the 30 s retry.
    t.mock.timers.tick(5_000);
    t.mock.timers.tick(250);
    assert.deepEqual(configHealth(), { state: 'ok' });
    stopConfigWatcher();
  });
}

for (const [what, breakIt] of [
  ["a file that doesn't parse", () => fs.writeFileSync(CONFIG_PATH, BROKEN)],
  ["a file that can't be read", () => (reads.blocked = 'EACCES')],
]) {
  test(`${what}, deleted: broken no more, and a missing file means what it means today`, (t) => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
    fs.writeFileSync(CONFIG_PATH, GOOD);
    loadConfig();
    breakIt();
    loadConfig();
    assert.notEqual(configHealth().state, 'ok');
    startConfigWatcher();
    fs.rmSync(CONFIG_PATH);
    // The watcher's next look, 5 s on, not the 30 s retry.
    t.mock.timers.tick(5_000);
    assert.deepEqual(configHealth(), { state: 'ok' });
    assert.equal(configProblem(), null);
    // No file: the board keeps what it had, a read says there is none, and
    // the next save writes a new one, as when a good file is deleted.
    assert.equal(getConfig().nodes.pi1.display_name, 'Gateway');
    const read = readConfig();
    assert.equal(read.version, CONFIG_ABSENT);
    assert.equal(read.unusable, undefined);
    assert.equal(writeConfig({ nodes: {}, services: {} }, CONFIG_ABSENT).ok, true);
    assert.equal(fs.existsSync(CONFIG_PATH), true);
    reads.blocked = null;
    stopConfigWatcher();
  });
}

test('a real directory where services.yaml should be: unreadable (EISDIR), and nothing is written', () => {
  fs.rmSync(CONFIG_PATH, { force: true });
  fs.mkdirSync(CONFIG_PATH);
  try {
    loadConfig();
    assert.deepEqual(configHealth(), { state: 'unreadable', code: 'EISDIR' });
    assert.equal(configProblem().reason, "services.yaml can't be read (it's a directory)");
    assert.equal(saveConfig({ nodes: {}, services: {} }), false);
    assert.equal(fs.statSync(CONFIG_PATH).isDirectory(), true);
  } finally {
    fs.rmSync(CONFIG_PATH, { recursive: true, force: true });
  }
});

test('a real mode-000 file: unreadable (EACCES); its permissions fixed, the next read loads it', {
  skip: process.getuid?.() === 0 && 'root reads a mode-000 file',
}, () => {
  fs.writeFileSync(CONFIG_PATH, GOOD);
  fs.chmodSync(CONFIG_PATH, 0o000);
  try {
    assert.equal(readConfig().code, 'config_unreadable');
    assert.deepEqual(configHealth(), { state: 'unreadable', code: 'EACCES' });
    assert.equal(configProblem().reason, UNREADABLE);
  } finally {
    fs.chmodSync(CONFIG_PATH, 0o644);
  }
  assert.equal(readConfig().config.nodes.pi1.display_name, 'Gateway');
  assert.deepEqual(configHealth(), { state: 'ok' });
});
