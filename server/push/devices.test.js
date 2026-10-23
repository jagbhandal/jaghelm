/**
 * What Settings → Notifications calls each phone and says about it (#320):
 * the model and Android version its User-Agent names, a name for one that
 * names none, two of a name told apart, and a failed send in words.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deviceFromUserAgent, deviceList } from './devices.js';
import { sendFailureWords, UNKNOWN_FAILURE } from './sendWords.js';

test('deviceFromUserAgent: the model and Android version an Android request names', () => {
  const rows = [
    [
      'Dalvik/2.1.0 (Linux; U; Android 15; Pixel 8 Build/AP3A.241005.015)',
      { model: 'Pixel 8', os: '15' },
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36',
      { model: 'SM-S918B', os: '14' },
    ],
    [
      'Mozilla/5.0 (Linux; U; Android 4.4.2; en-us; Nexus 5 Build/KOT49H)',
      { model: 'Nexus 5', os: '4.4.2' },
    ],
    ['Dalvik/2.1.0 (Linux; U; Android 13; Galaxy Tab S9)', { model: 'Galaxy Tab S9', os: '13' }],
    // Chrome's reduced User-Agent: "K" is no model.
    [
      'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36',
      { os: '10' },
    ],
    ['okhttp/4.12.0', {}],
    ['Mozilla/5.0 (X11; Linux x86_64) Firefox/131.0', {}],
    [undefined, {}],
    ['x'.repeat(2000), {}],
  ];
  for (const [ua, want] of rows)
    assert.deepEqual(deviceFromUserAgent(ua), want, String(ua).slice(0, 60));
});

test('deviceList: a name each, two of a name told apart, times in ISO, a failed send in words, no token', () => {
  const prefs = { enabled: true, notifyRecoveries: true, categories: {} };
  const list = deviceList([
    {
      id: 'aaaaaa111111',
      platform: 'android',
      appVersion: '1.2.0',
      registeredAt: 0,
      lastSeenAt: 0,
      prefs,
    },
    {
      id: 'bbbbbb222222',
      platform: 'android',
      appVersion: '1.3.0',
      model: 'Pixel 8',
      os: '15',
      registeredAt: 1000,
      lastSeenAt: 2000,
      lastDeliveredAt: 3000,
      lastError: { at: 4000, code: 'messaging/internal-error' },
      prefs,
    },
    {
      id: 'cccccc333333',
      platform: 'android',
      appVersion: null,
      registeredAt: 5,
      lastSeenAt: 5,
      prefs,
    },
  ]);
  assert.deepEqual(
    list.map((d) => d.name),
    ['Android phone (aaaaaa)', 'Pixel 8', 'Android phone (cccccc)']
  );
  assert.deepEqual(
    [list[1].registeredAt, list[1].lastDeliveredAt, list[0].lastDeliveredAt],
    ['1970-01-01T00:00:01.000Z', '1970-01-01T00:00:03.000Z', null]
  );
  assert.deepEqual(list[1].lastError, {
    at: '1970-01-01T00:00:04.000Z',
    sentence: "Google's push service failed on it; JagHelm tries again",
  });
  assert.deepEqual([list[1].model, list[1].os, list[0].model], ['Pixel 8', '15', null]);
});

test('sendFailureWords: a sentence for each code fcm.js gives, never the code', () => {
  for (const code of [
    'messaging/registration-token-not-registered',
    'messaging/invalid-argument',
    'messaging/mismatched-credential',
    'app/network-error',
    'app/invalid-credential',
    'thrown',
  ]) {
    const words = sendFailureWords(code);
    assert.ok(words !== UNKNOWN_FAILURE && !words.includes(code), code);
  }
  assert.equal(sendFailureWords('messaging/something-new'), UNKNOWN_FAILURE);
  assert.equal(sendFailureWords(undefined), UNKNOWN_FAILURE);
  assert.equal(sendFailureWords('__proto__'), UNKNOWN_FAILURE);
});
