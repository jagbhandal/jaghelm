/**
 * What Settings → Notifications calls each device and says about it (#320):
 * the name its browser gave (a default for one that gave none), two of a name
 * told apart, times in ISO, and a failed send in words.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deviceList } from './devices.js';
import { sendFailureWords, UNKNOWN_FAILURE } from './sendWords.js';

test('deviceList: a name each, two of a name told apart, times in ISO, a failed send in words, no token', () => {
  const prefs = { enabled: true, notifyRecoveries: true, categories: {} };
  const list = deviceList([
    { id: 'aaaaaa111111', platform: 'web', registeredAt: 0, lastSeenAt: 0, prefs },
    {
      id: 'bbbbbb222222',
      platform: 'web',
      name: 'Pixel 8 (Chrome)',
      registeredAt: 1000,
      lastSeenAt: 2000,
      lastDeliveredAt: 3000,
      lastError: { at: 4000, code: 'webpush/server-error' },
      prefs,
    },
    { id: 'cccccc333333', platform: 'web', registeredAt: 5, lastSeenAt: 5, prefs },
  ]);
  assert.deepEqual(
    list.map((d) => d.name),
    ['Web browser (aaaaaa)', 'Pixel 8 (Chrome)', 'Web browser (cccccc)']
  );
  assert.deepEqual(
    [list[1].registeredAt, list[1].lastDeliveredAt, list[0].lastDeliveredAt],
    ['1970-01-01T00:00:01.000Z', '1970-01-01T00:00:03.000Z', null]
  );
  assert.deepEqual(list[1].lastError, {
    at: '1970-01-01T00:00:04.000Z',
    sentence: "The browser's push service failed on it; JagHelm tries again",
  });
  assert.deepEqual(Object.keys(list[1]).sort(), [
    'id',
    'lastDeliveredAt',
    'lastError',
    'lastSeenAt',
    'name',
    'platform',
    'prefs',
    'registeredAt',
  ]);
});

test('sendFailureWords: a sentence for each code webPush.js gives, never the code', () => {
  for (const code of [
    'webpush/gone',
    'webpush/bad-request',
    'webpush/rejected',
    'webpush/network-error',
    'webpush/network-timeout',
    'webpush/server-error',
    'webpush/disabled',
    'thrown',
  ]) {
    const words = sendFailureWords(code);
    assert.ok(words !== UNKNOWN_FAILURE && !words.includes(code), code);
  }
  assert.equal(sendFailureWords('messaging/something-new'), UNKNOWN_FAILURE);
  // The retired Firebase sender's codes have no words any more.
  assert.equal(sendFailureWords('messaging/registration-token-not-registered'), UNKNOWN_FAILURE);
  assert.equal(sendFailureWords(undefined), UNKNOWN_FAILURE);
  assert.equal(sendFailureWords('__proto__'), UNKNOWN_FAILURE);
});
