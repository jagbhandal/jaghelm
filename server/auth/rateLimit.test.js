import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  checkLoginRate,
  resetLoginRate,
  registerLoginFailure,
  loginFailureDelay,
  _resetAllLoginRate,
} from './rateLimit.js';

beforeEach(() => _resetAllLoginRate());

test('per-IP: allows 5 attempts then locks the 6th', () => {
  const ip = '1.2.3.4';
  for (let i = 0; i < 5; i++) assert.equal(checkLoginRate(ip), true, `attempt ${i + 1}`);
  assert.equal(checkLoginRate(ip), false, '6th attempt is locked');
});

test('per-IP: resetLoginRate (successful login) clears the lock', () => {
  const ip = '1.2.3.5';
  for (let i = 0; i < 5; i++) checkLoginRate(ip);
  assert.equal(checkLoginRate(ip), false);
  resetLoginRate(ip);
  assert.equal(checkLoginRate(ip), true);
});

test('global: a fresh IP is refused once GLOBAL_MAX failures accrue across IPs', () => {
  for (let i = 0; i < 50; i++) registerLoginFailure(); // distributed brute force
  assert.equal(checkLoginRate('9.9.9.9'), false, 'global lock refuses an unseen IP');
});

test('global: under the threshold, a fresh IP is still allowed', () => {
  for (let i = 0; i < 10; i++) registerLoginFailure();
  assert.equal(checkLoginRate('8.8.8.8'), true);
});

test('loginFailureDelay resolves only after the floor delay', async () => {
  const t0 = Date.now();
  await loginFailureDelay();
  assert.ok(Date.now() - t0 >= 380, 'waited at least ~the 400ms floor');
});
