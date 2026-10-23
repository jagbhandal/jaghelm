/**
 * The auth routes against a restart (#250). A sign-in survives one; a sign-out
 * and a password change are written before the route answers, so what they
 * revoked stays revoked after one. A restart is a fresh instance of the
 * session store over the same data dir, as in sessions.persist.test.js.
 *
 * Auth is frozen at module load (DASH_PASS is read once), so it is set before
 * the app is imported.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import request from 'supertest';

process.env.DASH_PASS = 'test-pass-1234'; // pragma: allowlist secret
process.env.PROMETHEUS_URL = 'http://127.0.0.1:1';
process.env.KUMA_URL = 'http://127.0.0.1:1';

const { app } = await import('../index.js');
const { stopBackgroundRefresh } = await import('../refresh.js');

after(() => {
  stopBackgroundRefresh();
  delete process.env.DASH_PASS;
});

let boots = 0;
/** The store a restarted server has: a fresh module instance, the same data dir. */
const restart = () => import(`./sessions.js?boot=${++boots}`);

const FILE = join(process.env.JAGHELM_DATA_DIR, 'sessions.json');

/** Run `fn` with sessions.json neither writable nor removable, as on a read-only disk. */
async function withReadOnlyDisk(fn) {
  const { renameSync: rename, unlinkSync: unlink } = fs;
  const refuse = () => {
    throw Object.assign(new Error('EROFS: read-only file system'), { code: 'EROFS' });
  };
  fs.renameSync = (from, to) => (to === FILE ? refuse() : rename(from, to));
  fs.unlinkSync = (path) => (path === FILE ? refuse() : unlink(path));
  syncBuiltinESMExports();
  try {
    await fn();
  } finally {
    fs.renameSync = rename;
    fs.unlinkSync = unlink;
    syncBuiltinESMExports();
  }
}

const signOut = (token) => request(app).post('/api/auth/logout').set('x-auth-token', token);

let password = 'test-pass-1234'; // pragma: allowlist secret
async function signIn() {
  const res = await request(app).post('/api/auth/login').send({ username: 'admin', password });
  assert.equal(res.status, 200);
  return res.body.token;
}

test('a sign-in survives a restart', async () => {
  const token = await signIn();
  const restarted = await restart();
  assert.equal(restarted.getSession(token)?.user, 'admin');
});

test('a sign-out holds after a restart; the other session carries on', async () => {
  const out = await signIn();
  const other = await signIn();
  assert.equal((await request(app).post('/api/auth/logout').set('x-auth-token', out)).status, 204);

  const restarted = await restart();
  assert.equal(restarted.getSession(out), null);
  assert.ok(restarted.getSession(other));
});

test('a password change signs the other sessions out for good, and keeps its own across a restart', async () => {
  const own = await signIn();
  const phone = await signIn();
  const res = await request(app)
    .post('/api/auth/change-password')
    .set('x-auth-token', own)
    .send({ currentPassword: password, newPassword: 'new-pass-5678' }); // pragma: allowlist secret
  assert.equal(res.status, 200);
  password = 'new-pass-5678'; // pragma: allowlist secret

  const restarted = await restart();
  assert.equal(restarted.getSession(phone), null, 'the other device is signed out');
  assert.ok(restarted.getSession(own), 'the session that changed it carries on after a restart');
  const fresh = await signIn();
  assert.ok((await restart()).getSession(fresh), 'a sign-in with the new password survives too');
});

test('a password change from the only session keeps it across a restart', async () => {
  const { _resetAllSessions } = await import('./sessions.js');
  _resetAllSessions();
  const only = await signIn();
  const res = await request(app)
    .post('/api/auth/change-password')
    .set('x-auth-token', only)
    .send({ currentPassword: password, newPassword: 'third-pass-9012' }); // pragma: allowlist secret
  assert.equal(res.status, 200);
  password = 'third-pass-9012'; // pragma: allowlist secret
  assert.ok((await restart()).getSession(only), 'nothing else to sign out, and it still carries on');
});

test('a sign-out the disk can neither write nor remove answers 503 until a retry saves it', async () => {
  const token = await signIn();
  await withReadOnlyDisk(async () => {
    const first = await signOut(token);
    assert.equal(first.status, 503, 'not a success: the client keeps the sign-out to send again');
    const res = await request(app).get('/api/todos').set('x-auth-token', token);
    assert.equal(res.status, 401, 'the session ends at once all the same');
    assert.equal((await signOut(token)).status, 503, 'a retry while the disk still refuses');
  });
  assert.equal((await signOut(token)).status, 204, 'the retry once it can');
  assert.equal((await restart()).getSession(token), null, 'and a restart keeps it signed out');
  assert.equal((await signOut('f'.repeat(64))).status, 204, 'an unknown token still gets 204');
});

test("a password change the sessions file can't take still holds: a restart signs the other device out", async () => {
  const own = await signIn();
  const phone = await signIn();
  await withReadOnlyDisk(async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('x-auth-token', own)
      .send({ currentPassword: password, newPassword: 'fourth-pass-3456' }); // pragma: allowlist secret
    assert.equal(res.status, 200, 'the password changed (auth.json took it)');
  });
  password = 'fourth-pass-3456'; // pragma: allowlist secret
  // sessions.json still holds the phone, but stamped for the old password.
  assert.equal((await restart()).getSession(phone), null);
});

test('a sign-in whose user name or password is not a string is refused with 400', async () => {
  for (const body of [
    { username: ['admin'], password },
    { username: { toString: 'admin' }, password },
    { username: 'admin', password: [password] },
    { password },
    {},
  ]) {
    const res = await request(app).post('/api/auth/login').send(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.token, undefined);
  }
});
