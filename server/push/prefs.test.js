/**
 * The pieces every push device record shares: the notification prefs and the
 * fingerprint. (The device store itself is push/webPushStore.js, tested there.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORY_KEYS, clonePrefs, DEFAULT_PREFS, deviceIdOf, normalizePrefs } from './prefs.js';

test('normalizePrefs: coerces booleans, drops unknown keys, fills missing from defaults', () => {
  const prefs = normalizePrefs({
    categories: { service: false, host: 1, bogus: true }, // host coerces true, bogus dropped, the rest default
    notifyRecoveries: 0, // coerces false
    enabled: 'yes', // coerces true
    junk: 'ignored', // unknown top-level key dropped
  });
  assert.deepEqual(prefs, {
    categories: { service: false, host: true, ups: true, cron: true, watchtower: true },
    notifyRecoveries: false,
    enabled: true,
  });
  assert.equal(Object.hasOwn(prefs, 'junk'), false);
  assert.equal(Object.hasOwn(prefs.categories, 'bogus'), false);
});

test('normalizePrefs: an empty, null, array or primitive input yields the full defaults', () => {
  for (const input of [{}, null, undefined, 'x', 42, { categories: ['bad', 'input'] }, { categories: 42 }]) {
    assert.deepEqual(normalizePrefs(input), DEFAULT_PREFS);
  }
});

test('DEFAULT_PREFS names every category and is frozen; clonePrefs is a deep copy', () => {
  assert.deepEqual(Object.keys(DEFAULT_PREFS.categories), CATEGORY_KEYS);
  assert.ok(Object.isFrozen(DEFAULT_PREFS) && Object.isFrozen(DEFAULT_PREFS.categories));
  const copy = clonePrefs(DEFAULT_PREFS);
  copy.categories.service = false;
  copy.enabled = false;
  assert.equal(DEFAULT_PREFS.categories.service, true);
  assert.equal(DEFAULT_PREFS.enabled, true);
});

test('deviceIdOf: a Web Push pseudo token is its own id; any other token is a 12 character fingerprint', () => {
  assert.equal(deviceIdOf('wp:0123456789ab'), '0123456789ab');
  const id = deviceIdOf('some-token');
  assert.match(id, /^[0-9a-f]{12}$/);
  assert.equal(deviceIdOf('some-token'), id);
  assert.notEqual(deviceIdOf('other-token'), id);
  assert.ok(!id.includes('some-token'));
});
