/**
 * POST /api/auth/login against the rate limiter (#257): a 429 with Retry-After
 * per address, no global lock, one bucket for the account whatever the user
 * name. The limiter runs on a fake clock (`_resetAllLoginRate({ now })`).
 *
 * TRUST_PROXY=loopback lets each request name its address in X-Forwarded-For,
 * as a proxy would. Auth is frozen at module load (DASH_PASS is read once), so
 * both are set before the app is imported.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

process.env.DASH_PASS = 'test-pass-1234'; // pragma: allowlist secret
process.env.TRUST_PROXY = 'loopback';
process.env.PROMETHEUS_URL = 'http://127.0.0.1:1';
process.env.KUMA_URL = 'http://127.0.0.1:1';

const { app } = await import('../index.js');
const { stopBackgroundRefresh } = await import('../refresh.js');
const { _resetAllLoginRate } = await import('./rateLimit.js');

after(() => {
  stopBackgroundRefresh();
  delete process.env.DASH_PASS;
  delete process.env.TRUST_PROXY;
});

let clock = 0;
beforeEach(() => {
  clock = 0;
  _resetAllLoginRate({ now: () => clock });
});

const RIGHT = { username: 'admin', password: 'test-pass-1234' }; // pragma: allowlist secret
const WRONG = { username: 'admin', password: 'wrong' }; // pragma: allowlist secret

const login = (ip, body) =>
  request(app).post('/api/auth/login').set('X-Forwarded-For', ip).send(body);
/** `n` sign-ins at once from `ip`, answered in parallel (each failure takes ~0.4 s). */
const many = (n, ip, body) => Promise.all(Array.from({ length: n }, () => login(ip, body)));
const statuses = (responses) => responses.map((r) => r.status);

test('failures from one address are a 429 with Retry-After there, and never lock out another address', async () => {
  assert.deepEqual(statuses(await many(5, '192.0.2.1', WRONG)), [401, 401, 401, 401, 401]);

  const refused = await login('192.0.2.1', WRONG);
  assert.equal(refused.status, 429);
  assert.equal(refused.headers['retry-after'], '30');
  assert.equal(refused.body.error, 'Too many login attempts. Try again in 30 seconds.');
  assert.equal((await login('192.0.2.1', RIGHT)).status, 429, 'the wait holds for the right password too');

  assert.equal((await login('192.0.2.2', WRONG)).status, 401, 'another address: a plain 401');
  const other = await login('192.0.2.2', RIGHT);
  assert.equal(other.status, 200);
  assert.ok(other.body.token);
});

test('after the wait the address is let through, and a sign-in clears it', async () => {
  await many(5, '192.0.2.3', WRONG);
  clock += 29_999;
  assert.equal((await login('192.0.2.3', RIGHT)).status, 429);
  clock += 1;
  assert.equal((await login('192.0.2.3', RIGHT)).status, 200);
  assert.deepEqual(statuses(await many(5, '192.0.2.3', WRONG)), [401, 401, 401, 401, 401]);
  assert.equal((await login('192.0.2.3', WRONG)).status, 429);
});

test('a request that cannot be a guess (not text) is a 400 and does not count', async () => {
  for (let i = 0; i < 10; i++) {
    assert.equal((await login('192.0.2.4', { username: ['admin'], password: 'x' })).status, 400);
  }
  assert.deepEqual(statuses(await many(5, '192.0.2.4', WRONG)), [401, 401, 401, 401, 401]);
});

test('the account: wrong names from many addresses slow a new address, the right name too, by at most 30 s', async () => {
  const names = Array.from({ length: 10 }, (_, i) => ({ username: `user${i}`, password: 'x' }));
  const answers = await Promise.all(names.map((body, i) => login(`198.51.100.${i + 1}`, body)));
  assert.deepEqual(new Set(statuses(answers)), new Set([401]));

  const owner = await login('203.0.113.7', RIGHT);
  assert.equal(owner.status, 429, 'every name counts against the one account');
  const wait = Number(owner.headers['retry-after']);
  assert.ok(wait >= 1 && wait <= 30, `Retry-After ${wait}`);

  clock += wait * 1000;
  assert.equal((await login('203.0.113.7', RIGHT)).status, 200, 'in after the wait it was given');
});

test("the owner's address that signed in skips the account's wait", async () => {
  assert.equal((await login('203.0.113.8', RIGHT)).status, 200);
  await Promise.all(Array.from({ length: 10 }, (_, i) => login(`198.51.100.${i + 1}`, WRONG)));
  assert.equal((await login('203.0.113.9', RIGHT)).status, 429, 'a new address waits');
  assert.equal((await login('203.0.113.8', RIGHT)).status, 200, 'his own does not');
});

test('an address in LOGIN_TRUSTED_NETS gets in while new addresses wait on the account', async () => {
  _resetAllLoginRate({ now: () => clock, trustedNets: '192.168.68.0/22' });
  await Promise.all(Array.from({ length: 10 }, (_, i) => login(`198.51.100.${i + 1}`, WRONG)));
  assert.equal((await login('203.0.113.10', RIGHT)).status, 429);
  assert.equal((await login('192.168.69.4', RIGHT)).status, 200);
});

// Last: it changes the password.
test('a password change forgets the other known addresses; the one it came from stays known', async () => {
  const phone = await login('203.0.113.20', RIGHT);
  assert.equal(phone.status, 200);
  const laptop = await login('203.0.113.21', RIGHT);
  const changed = await request(app)
    .post('/api/auth/change-password')
    .set('X-Forwarded-For', '203.0.113.21')
    .set('x-auth-token', laptop.body.token)
    .send({ currentPassword: RIGHT.password, newPassword: 'test-pass-5678' }); // pragma: allowlist secret
  assert.equal(changed.status, 200);

  await Promise.all(Array.from({ length: 10 }, (_, i) => login(`198.51.100.${i + 1}`, WRONG)));
  const NEW = { username: 'admin', password: 'test-pass-5678' }; // pragma: allowlist secret
  assert.equal((await login('203.0.113.20', NEW)).status, 429, 'the phone waits like a new address');
  assert.equal((await login('203.0.113.21', NEW)).status, 200, 'the laptop is still known');
});
