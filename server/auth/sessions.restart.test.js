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
