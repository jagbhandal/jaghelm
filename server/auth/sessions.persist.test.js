/**
 * Sessions survive a restart (#250, ADR 0002). The store keeps the SHA-256 of
 * each token in DATA_DIR/sessions.json (0600, atomic), never the token. A
 * session ends after 30 days without use and 90 days after sign-in in any
 * case; a use is written at most once an hour.
 *
 * A restart is a fresh instance of the module over the same data dir: it
 * reads the file the way a restarted server does. The clock is node:test's
 * mocked Date.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs, { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';

const FILE = join(process.env.JAGHELM_DATA_DIR, 'sessions.json');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 9, 1, 12);

let boots = 0;
/** The store a (re)started server has: a fresh module instance, the same data dir. */
const boot = () => import(`./sessions.js?boot=${++boots}`);

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const onDisk = () => JSON.parse(readFileSync(FILE, 'utf8'));

beforeEach(() => rmSync(FILE, { recursive: true, force: true }));

/** The logger's lines while `fn` runs; anything else on stdout/stderr passes through. */
async function captureLogs(fn) {
  const lines = [];
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  const tap = (orig) =>
    function (chunk, ...rest) {
      const text = String(chunk);
      try {
        const obj = JSON.parse(text);
        if (obj && obj.module && obj.level) {
          lines.push({ text, ...obj });
          return true;
        }
      } catch {
        // not one of ours
      }
      return orig.call(this, chunk, ...rest);
    };
  process.stdout.write = tap(origOut);
  process.stderr.write = tap(origErr);
  try {
    await fn();
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
  return lines;
}

/** Run `fn` with every write of sessions.json failing as a full disk does. */
async function withFullDisk(fn) {
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (to !== FILE) return rename(from, to);
    throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
  };
  syncBuiltinESMExports();
  try {
    await fn();
  } finally {
    fs.renameSync = rename;
    syncBuiltinESMExports();
  }
}

/** No 16 characters of `token` in a row appear in `text`. */
function assertNoPieceOf(token, text, where) {
  for (let i = 0; i + 16 <= token.length; i++) {
    assert.ok(!text.includes(token.slice(i, i + 16)), `a piece of the token in ${where}`);
  }
}

test('a session survives a restart', async () => {
  const before = await boot();
  const token = before.createSession('admin');
  const listed = before.createSession(['admin']); // what a JSON body can pass the login route
  const after = await boot();
  assert.equal(after.getSession(token)?.user, 'admin', 'the token still authenticates');
  assert.equal(after.getSession(listed)?.user, 'admin', 'the user is kept as a string');
  assert.equal(after.getSession('f'.repeat(64)), null, 'an unknown token still does not');
});

test('sessions.json keys each session by the SHA-256 of its token, never the token, and is 0600', async () => {
  const s = await boot();
  const a = s.createSession('admin');
  const b = s.createSession('admin');
  const text = readFileSync(FILE, 'utf8');
  assert.deepEqual(Object.keys(onDisk().sessions).sort(), [sha256(a), sha256(b)].sort());
  assertNoPieceOf(a, text, 'sessions.json');
  assertNoPieceOf(b, text, 'sessions.json');
  for (const entry of Object.values(onDisk().sessions)) {
    assert.deepEqual(Object.keys(entry).sort(), ['created', 'lastUsed', 'user']);
  }
  assert.equal(statSync(FILE).mode & 0o777, 0o600);

  chmodSync(FILE, 0o644); // widened by hand: the next write puts it back
  s.createSession('admin');
  assert.equal(statSync(FILE).mode & 0o777, 0o600);
});

test('use slides the 30-day window, and the slide survives a restart', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const s = await boot();
  const token = s.createSession('admin');

  t.mock.timers.setTime(T0 + 29 * DAY);
  assert.ok(s.getSession(token), 'used after 29 days');
  t.mock.timers.setTime(T0 + 58 * DAY);
  const restarted = await boot();
  assert.ok(restarted.getSession(token), 'used again 29 days later, after a restart');
  t.mock.timers.setTime(T0 + 88 * DAY);
  assert.equal(restarted.getSession(token), null, '30 days without use ends it');
  assert.equal((await boot()).getSession(token), null, 'and it stays ended after a restart');
});

test('90 days after sign-in a session ends, however recently it was used', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const s = await boot();
  const token = s.createSession('admin');
  for (let day = 10; day < 90; day += 10) {
    t.mock.timers.setTime(T0 + day * DAY);
    assert.ok(s.getSession(token), `in use on day ${day}`);
  }
  t.mock.timers.setTime(T0 + 90 * DAY - 1);
  assert.ok((await boot()).getSession(token), 'a moment before day 90, after a restart');
  t.mock.timers.setTime(T0 + 90 * DAY);
  assert.equal(s.getSession(token), null, 'day 90, used a moment ago');
  assert.equal((await boot()).getSession(token), null, 'and after a restart');
});

test('a use is written at most once an hour per session', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const s = await boot();
  const token = s.createSession('admin');
  const lastUsedOnDisk = () => onDisk().sessions[sha256(token)].lastUsed;
  assert.equal(lastUsedOnDisk(), T0);

  for (let m = 1; m < 60; m++) {
    t.mock.timers.setTime(T0 + m * 60 * 1000);
    assert.ok(s.getSession(token));
  }
  assert.equal(lastUsedOnDisk(), T0, 'an hour of polling wrote nothing');
  assert.equal(s.getSession(token).lastUsed, T0 + 59 * 60 * 1000, 'the use is kept in memory');

  t.mock.timers.setTime(T0 + HOUR);
  s.getSession(token);
  assert.equal(lastUsedOnDisk(), T0 + HOUR, 'an hour on, the use is written');
});

test('a signed-out session stays signed out after a restart', async () => {
  const s = await boot();
  const out = s.createSession('admin');
  const other = s.createSession('admin');
  assert.equal(s.deleteSession(out), true);
  assert.ok(!(sha256(out) in onDisk().sessions), 'its entry is gone from the file');

  const restarted = await boot();
  assert.equal(restarted.getSession(out), null);
  assert.ok(restarted.getSession(other), 'the other session carries on');
});

test("a password change's sign-out of the other sessions holds after a restart", async () => {
  const s = await boot();
  const keep = s.createSession('admin');
  const a = s.createSession('admin');
  const b = s.createSession('admin');
  s.deleteAllSessionsExcept(keep);

  const restarted = await boot();
  assert.ok(restarted.getSession(keep), 'the session that changed it carries on');
  assert.equal(restarted.getSession(a), null);
  assert.equal(restarted.getSession(b), null);
  assert.deepEqual(Object.keys(onDisk().sessions), [sha256(keep)]);
});

test('no sessions.json is no sessions, and nothing is logged', async () => {
  let s;
  const lines = await captureLogs(async () => {
    s = await boot();
    assert.equal(s.getSession('a'.repeat(64)), null);
  });
  assert.deepEqual(lines, []);
  assert.equal(existsSync(FILE), false, 'a lookup writes nothing');
});

test('a sessions.json that does not parse is no sessions and one warning that does not quote it', async () => {
  const quoted = 'Hunter2Sessions';
  writeFileSync(FILE, `{"version": 1, "sessions": {"x": ${quoted}}}`);
  let s;
  let token;
  const lines = await captureLogs(async () => {
    s = await boot();
    assert.equal(s.getSession('a'.repeat(64)), null);
    token = s.createSession('admin');
  });
  assert.deepEqual(
    lines.map(({ level, module }) => ({ level, module })),
    [{ level: 'warn', module: 'sessions' }],
    'one warning, nothing else'
  );
  assert.ok(!lines[0].text.includes(quoted.slice(0, 7)), lines[0].text);
  assert.ok(lines[0].parseError, 'the reason and position are logged');
  assert.ok(s.getSession(token), 'sign-in still works');
  assert.ok((await boot()).getSession(token), 'and the new file is good');
});

test('a sessions.json of another shape, or that cannot be read, is no sessions and one warning', async () => {
  for (const [what, make] of [
    ['an array', () => writeFileSync(FILE, '[]')],
    ['another version', () => writeFileSync(FILE, '{"version": 2, "sessions": {}}')],
    ['sessions not an object', () => writeFileSync(FILE, '{"version": 1, "sessions": "x"}')],
    ['a directory', () => mkdirSync(FILE)],
  ]) {
    rmSync(FILE, { recursive: true, force: true });
    make();
    const lines = await captureLogs(async () => {
      assert.equal((await boot()).getSession('a'.repeat(64)), null, what);
    });
    assert.deepEqual(
      lines.map(({ level, module }) => ({ level, module })),
      [{ level: 'warn', module: 'sessions' }],
      `${what}: one warning`
    );
  }
});

test('entries that are not sessions are dropped with one warning; the good ones load', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const s = await boot();
  const good = s.createSession('admin');
  const file = onDisk();
  const ok = file.sessions[sha256(good)];
  file.sessions['not-a-hash'] = ok;
  file.sessions[sha256('no user')] = { created: T0, lastUsed: T0 };
  file.sessions[sha256('bad time')] = { user: 'admin', created: 'yesterday', lastUsed: T0 };
  file.sessions[sha256('from the future')] = { user: 'admin', created: T0 + DAY, lastUsed: T0 + DAY };
  file.sessions[sha256('used before made')] = { user: 'admin', created: T0, lastUsed: T0 - 1 };
  file.sessions[sha256('null')] = null;
  writeFileSync(FILE, JSON.stringify(file));

  let restarted;
  const lines = await captureLogs(async () => {
    restarted = await boot();
    assert.ok(restarted.getSession(good), 'the good session loads');
  });
  assert.deepEqual(
    lines.map(({ level, module, dropped }) => ({ level, module, dropped })),
    [{ level: 'warn', module: 'sessions', dropped: 6 }]
  );
  for (const token of ['no user', 'bad time', 'from the future', 'used before made', 'null']) {
    assert.equal(restarted.getSession(token), null, token);
  }
});

test('expired sessions are dropped when the file is read, and by the sweep', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const s = await boot();
  const old = s.createSession('admin');
  t.mock.timers.setTime(T0 + 20 * DAY);
  const fresh = s.createSession('admin');

  // The sweep: in a running store, an expired entry leaves memory and the file.
  t.mock.timers.setTime(T0 + 31 * DAY);
  assert.ok(sha256(old) in onDisk().sessions, 'in the file before the sweep');
  s.sweepExpiredSessions();
  assert.deepEqual(Object.keys(onDisk().sessions), [sha256(fresh)]);
  assert.equal(s.getSession(old), null);

  // The read: one that expired while the server was down never loads.
  const file = onDisk();
  file.sessions[sha256('expired while down')] = { user: 'admin', created: T0, lastUsed: T0 };
  writeFileSync(FILE, JSON.stringify(file));
  const lines = await captureLogs(async () => {
    const restarted = await boot();
    assert.equal(restarted.getSession('expired while down'), null);
    assert.ok(restarted.getSession(fresh));
  });
  assert.deepEqual(lines, [], 'an expired session is not a warning');
  assert.deepEqual(Object.keys(onDisk().sessions), [sha256(fresh)], 'and the next write leaves it out');
});

test('past MAX_SESSIONS a sign-in ends the least recently used session', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const s = await boot();
  assert.equal(s.MAX_SESSIONS, 50);
  const tokens = [];
  for (let i = 0; i < s.MAX_SESSIONS; i++) {
    t.mock.timers.setTime(T0 + i * 1000);
    tokens.push(s.createSession('admin'));
  }
  t.mock.timers.setTime(T0 + 2 * HOUR);
  assert.ok(s.getSession(tokens[0]), 'the oldest sign-in, used just now');

  const newest = s.createSession('admin');
  assert.equal(s.getSession(tokens[1]), null, 'the least recently used is ended');
  assert.ok(s.getSession(tokens[0]), 'a recently used one is kept, however old');
  assert.ok(s.getSession(newest));
  assert.equal(Object.keys(onDisk().sessions).length, s.MAX_SESSIONS);
  assert.equal((await boot()).getSession(tokens[1]), null, 'and stays ended after a restart');
});

test('a file holding more than MAX_SESSIONS loads the most recently used of them', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const s = await boot();
  s.createSession('admin'); // a file with this credential's stamp
  const file = onDisk();
  file.sessions = {};
  const tokens = Array.from({ length: s.MAX_SESSIONS + 5 }, (_, i) => `token-${i}`);
  tokens.forEach((token, i) => {
    file.sessions[sha256(token)] = { user: 'admin', created: T0 - DAY, lastUsed: T0 - DAY + i };
  });
  writeFileSync(FILE, JSON.stringify(file));

  const restarted = await boot();
  for (const token of tokens.slice(0, 5)) assert.equal(restarted.getSession(token), null, token);
  for (const token of tokens.slice(5)) assert.ok(restarted.getSession(token), token);
});

test('a write that fails is logged without the token; the session works until the restart', async () => {
  const s = await boot();
  const saved = s.createSession('admin');
  let token;
  const lines = await captureLogs(() =>
    withFullDisk(() => {
      token = s.createSession('admin'); // no throw, so no 500 on sign-in
    })
  );
  assert.deepEqual(
    lines.map(({ level, module }) => ({ level, module })),
    [{ level: 'error', module: 'sessions' }]
  );
  assertNoPieceOf(token, lines[0].text, 'the log line');
  assert.ok(s.getSession(token), 'the new session works in memory');

  const restarted = await boot();
  assert.equal(restarted.getSession(token), null, 'it never reached the file, so a restart ends it');
  assert.ok(restarted.getSession(saved), 'the file as last written still loads');
});

test("a sign-out whose write fails removes the file, so a restart can't bring the session back", async () => {
  const s = await boot();
  const out = s.createSession('admin');
  const other = s.createSession('admin');
  const lines = await captureLogs(() =>
    withFullDisk(() => {
      assert.equal(s.deleteSession(out), true);
    })
  );
  assert.equal(lines.length, 1);
  assert.equal(lines[0].level, 'error');
  assert.equal(s.getSession(out), null, 'signed out at once');
  assert.ok(s.getSession(other), 'the other session carries on until the restart');
  assert.equal(existsSync(FILE), false, 'the file is gone');

  const restarted = await boot();
  assert.equal(restarted.getSession(out), null, 'the restart brings back no revoked session');
  assert.equal(restarted.getSession(other), null, 'everyone signs in again instead');
});

// Last: it changes the password for the rest of this file.
test('a restart after the password changed outside Settings starts with no sessions', async () => {
  const { setPassword } = await import('./passwords.js');
  const s = await boot();
  const token = s.createSession('admin');
  setPassword('changed-by-hand-1'); // as an auth.json or DASH_PASS change found at the next start

  let restarted;
  const lines = await captureLogs(async () => {
    restarted = await boot();
    assert.equal(restarted.getSession(token), null);
  });
  assert.deepEqual(
    lines.map(({ level, module }) => ({ level, module })),
    [{ level: 'info', module: 'sessions' }]
  );
  assert.deepEqual(onDisk().sessions, {}, 'the file is emptied, so going back to the old password brings none back');
  const after = restarted.createSession('admin');
  assert.ok((await boot()).getSession(after), 'a sign-in after the change survives restarts as usual');
});
