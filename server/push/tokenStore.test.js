/**
 * Push token store — registration upsert, prefs, prune, persistence round-trip.
 * Pure-ish store: the only clock is the injected `now`, so every assertion uses
 * a FIXED fake clock (never real Date.now). Each test gets its own mkdtemp path.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTokenStore, DEFAULT_PREFS, deviceIdOf } from './tokenStore.js';

/** Fresh temp dir + store with a settable fake clock. */
function freshStore(startMs = 1_000_000) {
  const dir = mkdtempSync(join(tmpdir(), 'jaghelm-tokens-'));
  const path = join(dir, 'push-tokens.json');
  let clock = startMs;
  const now = () => clock;
  const store = createTokenStore({ path, now });
  return { dir, path, store, setNow: (ms) => { clock = ms; }, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('registerToken seeds DEFAULT_PREFS and stamps registeredAt/lastSeenAt from injected now', () => {
  const { store, setNow, cleanup } = freshStore(5000);
  setNow(5000);
  const rec = store.registerToken('tok-a', { platform: 'android', appVersion: '1.2.3' });
  assert.equal(rec.platform, 'android');
  assert.equal(rec.appVersion, '1.2.3');
  assert.equal(rec.registeredAt, 5000);
  assert.equal(rec.lastSeenAt, 5000);
  assert.deepEqual(rec.prefs, DEFAULT_PREFS);
  cleanup();
});

test('returned records are deep-isolated — mutating them never touches the store', () => {
  const { store, setNow, cleanup } = freshStore(1000);
  setNow(1000);
  const rec = store.registerToken('tok-a', { platform: 'android', appVersion: '1.0.0' });
  rec.prefs.enabled = false;
  rec.prefs.categories.service = false;
  // store is unaffected — getToken still returns the seeded defaults
  assert.deepEqual(store.getToken('tok-a').prefs, DEFAULT_PREFS);
  // and DEFAULT_PREFS itself stays frozen/untouched
  assert.equal(DEFAULT_PREFS.enabled, true);
  cleanup();
});

test('getToken returns null for an unknown token', () => {
  const { store, cleanup } = freshStore();
  assert.equal(store.getToken('nope'), null);
  cleanup();
});

test('registerToken upsert refreshes lastSeenAt, keeps registeredAt + prefs', () => {
  const { store, setNow, cleanup } = freshStore();
  setNow(1000);
  store.registerToken('tok-x', { platform: 'android', appVersion: '1.0.0' });
  // Snapshot the seeded default prefs so we can prove the upsert preserves them
  // WITHOUT depending on setPrefs (which lands in Task 17) — keeps Task 15
  // red->green in isolation. (The setPrefs-mutated preservation case is
  // covered in Task 17.)
  const seededPrefs = store.getToken('tok-x').prefs;

  setNow(9000);
  const rec = store.registerToken('tok-x', { platform: 'android', appVersion: '1.4.0' });
  assert.equal(rec.registeredAt, 1000, 'registeredAt is immutable across re-registration');
  assert.equal(rec.lastSeenAt, 9000, 'lastSeenAt refreshed from injected now');
  assert.equal(rec.appVersion, '1.4.0', 'appVersion updated on re-register');
  assert.deepEqual(store.getToken('tok-x').prefs, seededPrefs, 'prefs preserved across upsert');
  cleanup();
});

test('registerToken upsert without platform/appVersion leaves prior values intact', () => {
  const { store, setNow, cleanup } = freshStore();
  setNow(1000);
  store.registerToken('tok-y', { platform: 'android', appVersion: '2.0.0' });
  setNow(2000);
  const rec = store.registerToken('tok-y');
  assert.equal(rec.platform, 'android');
  assert.equal(rec.appVersion, '2.0.0');
  assert.equal(rec.lastSeenAt, 2000);
  cleanup();
});

test('removeToken deletes a token and reports whether it existed', () => {
  const { store, setNow, cleanup } = freshStore();
  setNow(1000);
  store.registerToken('tok-1', { platform: 'android', appVersion: '1.0.0' });
  assert.equal(store.removeToken('tok-1'), true);
  assert.equal(store.getToken('tok-1'), null);
  assert.equal(store.removeToken('tok-1'), false, 'second removal returns false');
  assert.equal(store.removeToken('never-seen'), false);
  cleanup();
});

test('getAllTokens returns every token with its record merged under `token`', () => {
  const { store, setNow, cleanup } = freshStore();
  setNow(1000);
  store.registerToken('tok-a', { platform: 'android', appVersion: '1.0.0' });
  store.registerToken('tok-b', { platform: 'android', appVersion: '1.1.0' });
  const all = store.getAllTokens();
  assert.equal(all.length, 2);
  const byToken = Object.fromEntries(all.map((r) => [r.token, r]));
  assert.equal(byToken['tok-a'].appVersion, '1.0.0');
  assert.equal(byToken['tok-b'].appVersion, '1.1.0');
  assert.equal(byToken['tok-a'].registeredAt, 1000);
  assert.ok(byToken['tok-a'].prefs, 'record carries prefs');
  cleanup();
});

test('getPrefs returns DEFAULT_PREFS for a token with no overrides', () => {
  const { store, setNow, cleanup } = freshStore();
  setNow(1000);
  store.registerToken('tok-p', { platform: 'android', appVersion: '1.0.0' });
  assert.deepEqual(store.getPrefs('tok-p'), DEFAULT_PREFS);
  cleanup();
});

test('getPrefs returns DEFAULT_PREFS for an unknown token', () => {
  const { store, cleanup } = freshStore();
  assert.deepEqual(store.getPrefs('ghost'), DEFAULT_PREFS);
  cleanup();
});

test('setPrefs normalizes: coerces booleans, drops unknown keys, fills missing from defaults', () => {
  const { store, setNow, cleanup } = freshStore();
  setNow(1000);
  store.registerToken('tok-q', { platform: 'android', appVersion: '1.0.0' });
  const rec = store.setPrefs('tok-q', {
    categories: { service: false, host: 1, bogus: true }, // host coerces true, bogus dropped, ups/cron default
    notifyRecoveries: 0, // coerces false
    enabled: 'yes',      // coerces true
    junk: 'ignored',     // unknown top-level key dropped
  });
  assert.deepEqual(rec.prefs, {
    categories: { service: false, host: true, ups: true, cron: true, watchtower: true },
    notifyRecoveries: false,
    enabled: true,
  });
  assert.equal(Object.prototype.hasOwnProperty.call(rec.prefs, 'junk'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(rec.prefs.categories, 'bogus'), false);
  // Persisted and reflected by getPrefs.
  assert.deepEqual(store.getPrefs('tok-q'), rec.prefs);
  cleanup();
});

test('setPrefs with an empty/garbage object yields full DEFAULT_PREFS', () => {
  const { store, setNow, cleanup } = freshStore();
  setNow(1000);
  store.registerToken('tok-r', { platform: 'android', appVersion: '1.0.0' });
  assert.deepEqual(store.setPrefs('tok-r', {}).prefs, DEFAULT_PREFS);
  assert.deepEqual(store.setPrefs('tok-r', null).prefs, DEFAULT_PREFS);
  cleanup();
});

const DAY = 24 * 60 * 60 * 1000;

test('pruneStale removes tokens unseen for longer than the 270-day default', () => {
  const { store, setNow, cleanup } = freshStore();
  setNow(1000);
  store.registerToken('old', { platform: 'android', appVersion: '1.0.0' }); // lastSeenAt 1000

  setNow(1000 + 280 * DAY);
  store.registerToken('recent', { platform: 'android', appVersion: '1.0.0' }); // lastSeenAt now

  // now = 1000 + 280d. Default maxAge 270d => cutoff = 1000 + 10d. `old` (1000) is older => pruned.
  const removed = store.pruneStale();
  assert.equal(removed, 1);
  assert.equal(store.getToken('old'), null);
  assert.ok(store.getToken('recent'), 'recent token survives');
  cleanup();
});

test('pruneStale keeps a token whose app has not launched for 31 or 269 days (#247)', () => {
  const { store, setNow, cleanup } = freshStore();
  setNow(1000);
  store.registerToken('quiet-phone', { platform: 'android', appVersion: '1.0.0' });

  setNow(1000 + 31 * DAY);
  assert.equal(store.pruneStale(), 0, 'a month without an app launch is not evidence the token is dead');
  setNow(1000 + 269 * DAY);
  assert.equal(store.pruneStale(), 0, 'still inside the 270-day window');
  assert.ok(store.getToken('quiet-phone'));
  cleanup();
});

test('markDelivered bumps lastSeenAt for known tokens and persists it', () => {
  const { path, store, setNow, cleanup } = freshStore();
  setNow(1000);
  store.registerToken('tok-a', { platform: 'android', appVersion: '1.0.0' });
  store.registerToken('tok-b', { platform: 'android', appVersion: '1.0.0' });
  store.setPrefs('tok-a', { ...DEFAULT_PREFS, notifyRecoveries: false });

  setNow(1000 + 40 * DAY);
  assert.equal(store.markDelivered(['tok-a']), 1);
  const rec = store.getToken('tok-a');
  assert.equal(rec.lastSeenAt, 1000 + 40 * DAY, 'an FCM-accepted send counts as seen');
  assert.equal(rec.registeredAt, 1000, 'registeredAt untouched');
  assert.equal(rec.appVersion, '1.0.0', 'appVersion untouched');
  assert.equal(rec.prefs.notifyRecoveries, false, 'prefs untouched');
  assert.equal(store.getToken('tok-b').lastSeenAt, 1000, 'tokens not delivered to are not bumped');
  // Survives a reload from disk.
  assert.equal(createTokenStore({ path, now: () => 0 }).getToken('tok-a').lastSeenAt, 1000 + 40 * DAY);
  cleanup();
});

test('markDelivered ignores unknown tokens and writes nothing when nothing changed', () => {
  const { path, store, setNow, cleanup } = freshStore();
  setNow(1000);
  // A token pruned or deleted mid-dispatch must not be re-created by a late delivery.
  assert.equal(store.markDelivered(['ghost', '__proto__']), 0);
  assert.equal(store.markDelivered([]), 0);
  assert.equal(store.getToken('ghost'), null);
  assert.equal(existsSync(path), false, 'no file write for a no-op');
  assert.equal(({}).lastSeenAt, undefined, 'Object.prototype not touched');
  cleanup();
});

test('markDelivered skips a token already seen within the last day, and writes a delivery at most once an hour (#320)', () => {
  const { path, store, setNow, cleanup } = freshStore();
  const HOUR = 60 * 60 * 1000;
  setNow(1000);
  store.registerToken('tok', { platform: 'android', appVersion: '1.0.0' });
  const inode = statSync(path).ino; // every save is an atomic rename: a write changes the inode

  setNow(1000 + HOUR / 2); // a flapping service: another accepted push within the hour
  assert.equal(store.markDelivered(['tok']), 0);
  assert.equal(store.getToken('tok').lastSeenAt, 1000);
  assert.equal(store.getToken('tok').lastDeliveredAt, 1000 + HOUR / 2, 'the delivery is known at once');
  assert.equal(statSync(path).ino, inode, 'push-tokens.json not rewritten');

  setNow(1000 + 23 * HOUR); // the same day, over an hour since the last write
  assert.equal(store.markDelivered(['tok']), 0, 'lastSeenAt is still bumped once a day');
  const written = statSync(path).ino;
  assert.notEqual(written, inode, 'the delivery time is written once an hour has passed');
  setNow(1000 + 23.5 * HOUR);
  store.markDelivered(['tok']);
  assert.equal(statSync(path).ino, written, 'and not again within the hour');

  setNow(1000 + 25 * HOUR);
  assert.equal(store.markDelivered(['tok']), 1);
  assert.equal(store.getToken('tok').lastSeenAt, 1000 + 25 * HOUR);
  assert.notEqual(statSync(path).ino, written, 'written once a day has passed');
  cleanup();
});

test('recordFailure keeps the last failed send until an accepted one clears it (#320)', () => {
  const { path, store, setNow, cleanup } = freshStore();
  setNow(1000);
  store.registerToken('tok', { platform: 'android', appVersion: '1.0.0' });
  assert.equal(store.recordFailure('ghost', 'x'), false);
  setNow(2000);
  assert.equal(store.recordFailure('tok', 'messaging/server-unavailable'), true);
  assert.deepEqual(store.getToken('tok').lastError, { at: 2000, code: 'messaging/server-unavailable' });
  // Written: a reload sees it.
  assert.deepEqual(createTokenStore({ path, now: () => 0 }).getToken('tok').lastError, {
    at: 2000,
    code: 'messaging/server-unavailable',
  });
  const inode = statSync(path).ino;
  setNow(3000); // the same failure again within the hour: memory only
  store.recordFailure('tok', 'messaging/server-unavailable');
  assert.equal(store.getToken('tok').lastError.at, 3000);
  assert.equal(statSync(path).ino, inode);
  store.recordFailure('tok', undefined); // a new code is written at once
  assert.notEqual(statSync(path).ino, inode);
  assert.equal(store.getToken('tok').lastError.code, 'unknown');

  setNow(4000);
  store.markDelivered(['tok']);
  const rec = store.getToken('tok');
  assert.equal(rec.lastError, undefined);
  assert.equal(rec.lastDeliveredAt, 4000);
  assert.equal(createTokenStore({ path, now: () => 0 }).getToken('tok').lastError, undefined);
  cleanup();
});

test('devices: listed by fingerprint without a token; found and removed by it; model and Android kept (#320)', () => {
  const { path, store, setNow, cleanup } = freshStore();
  setNow(1000);
  store.registerToken('tok-old', { platform: 'android', appVersion: '1.2.0' });
  setNow(2000);
  store.registerToken('tok-new', { platform: 'android', appVersion: '1.3.0', model: ' Pixel 8 ', os: '15' });
  const devices = store.getDevices();
  assert.deepEqual(
    devices.map((d) => [d.id, d.appVersion, d.model, d.os]),
    [
      [deviceIdOf('tok-old'), '1.2.0', undefined, undefined],
      [deviceIdOf('tok-new'), '1.3.0', 'Pixel 8', '15'],
    ]
  );
  assert.match(devices[0].id, /^[0-9a-f]{12}$/);
  assert.ok(!JSON.stringify(devices).includes('tok-'), 'no token in the list');
  // A later registration without a model keeps the one it had.
  store.registerToken('tok-new', { platform: 'android', appVersion: '1.3.1' });
  assert.equal(store.getToken('tok-new').model, 'Pixel 8');

  assert.equal(store.tokenOfDevice(deviceIdOf('tok-new')), 'tok-new');
  assert.equal(store.tokenOfDevice('nope'), null);
  assert.equal(store.removeDevice(deviceIdOf('tok-old')), true);
  assert.equal(store.removeDevice(deviceIdOf('tok-old')), false);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(path, 'utf8'))), ['tok-new']);
  cleanup();
});

test('load drops #320 fields it cannot read, keeping the record', () => {
  const { dir, path, cleanup } = freshStore();
  writeFileSync(
    path,
    JSON.stringify({
      tok: { registeredAt: 1, lastSeenAt: 1, lastDeliveredAt: 'soon', lastError: 'boom', model: 7 },
    })
  );
  const rec = createTokenStore({ path, now: () => 5 }).getToken('tok');
  assert.ok(dir && rec);
  assert.equal(rec.lastDeliveredAt, undefined);
  assert.equal(rec.lastError, undefined);
  assert.equal(rec.model, undefined);
  cleanup();
});

test('deliveries alone keep a never-reopened token past the prune window (#247)', () => {
  const { store, setNow, cleanup } = freshStore();
  setNow(1000);
  store.registerToken('alert-receiver', { platform: 'android', appVersion: '1.0.0' });
  // The app is never opened again, but FCM keeps accepting pushes to it.
  setNow(1000 + 200 * DAY);
  store.markDelivered(['alert-receiver']);
  setNow(1000 + 400 * DAY); // 400 days since the last launch, 200 since the last delivery
  assert.equal(store.pruneStale(), 0);
  assert.ok(store.getToken('alert-receiver'));
  cleanup();
});

test('pruneStale keeps a token exactly at the cutoff (strictly-older is pruned)', () => {
  const { store, setNow, cleanup } = freshStore();
  setNow(10_000);
  store.registerToken('edge', { platform: 'android', appVersion: '1.0.0' }); // lastSeenAt 10_000
  // Set now so that now - maxAge === 10_000 exactly.
  const maxAge = 5_000;
  setNow(15_000); // cutoff = 15_000 - 5_000 = 10_000 === lastSeenAt => KEEP
  assert.equal(store.pruneStale(maxAge), 0);
  assert.ok(store.getToken('edge'));
  // One ms later, it is strictly older than the cutoff => pruned.
  setNow(15_001);
  assert.equal(store.pruneStale(maxAge), 1);
  assert.equal(store.getToken('edge'), null);
  cleanup();
});

test('pruneStale returns 0 and persists nothing surprising on an empty store', () => {
  const { store, setNow, cleanup } = freshStore();
  setNow(99_999_999);
  assert.equal(store.pruneStale(), 0);
  cleanup();
});

test('persistence round-trip: a fresh store over the same path sees prior writes', () => {
  const { path, store, setNow, cleanup } = freshStore();
  const now = () => 4242;
  setNow(4242);
  store.registerToken('persist-me', { platform: 'android', appVersion: '3.0.0' });
  store.setPrefs('persist-me', { ...DEFAULT_PREFS, enabled: false });

  // Re-open from disk — no shared in-memory state.
  const reopened = createTokenStore({ path, now });
  const rec = reopened.getToken('persist-me');
  assert.ok(rec, 'token survived reload');
  assert.equal(rec.platform, 'android');
  assert.equal(rec.appVersion, '3.0.0');
  assert.equal(rec.registeredAt, 4242);
  assert.equal(rec.prefs.enabled, false);
  assert.equal(reopened.getAllTokens().length, 1);
  cleanup();
});

test('construct tolerates a missing file (empty store, no throw)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jaghelm-tokens-'));
  const path = join(dir, 'does-not-exist.json');
  const store = createTokenStore({ path, now: () => 1 });
  assert.deepEqual(store.getAllTokens(), []);
  assert.equal(store.getToken('x'), null);
  rmSync(dir, { recursive: true, force: true });
});

test('construct tolerates a corrupt JSON file (falls back to empty store)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jaghelm-tokens-'));
  const path = join(dir, 'push-tokens.json');
  // Write garbage that is not valid JSON.
  writeFileSync(path, '{ this is not json', 'utf8');
  const store = createTokenStore({ path, now: () => 1 });
  assert.deepEqual(store.getAllTokens(), []);
  // And it can recover by registering anew.
  store.registerToken('recover', { platform: 'android', appVersion: '1.0.0' });
  assert.equal(createTokenStore({ path, now: () => 1 }).getToken('recover').platform, 'android');
  rmSync(dir, { recursive: true, force: true });
});

test('load drops records that are not objects, so one bad record cannot stop every push cycle', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jaghelm-tokens-'));
  const path = join(dir, 'push-tokens.json');
  const good = { platform: 'android', appVersion: '1.0.0', registeredAt: 1000, lastSeenAt: 1000, prefs: DEFAULT_PREFS };
  writeFileSync(path, JSON.stringify({ good, nul: null, str: 'x', num: 5, arr: [1] }), 'utf8');
  const store = createTokenStore({ path, now: () => 2000 });
  assert.deepEqual(store.getAllTokens().map((r) => r.token), ['good']);
  assert.equal(store.pruneStale(), 0);
  assert.equal(store.getToken('nul'), null);
  rmSync(dir, { recursive: true, force: true });
});

test('load repairs a record with a non-number lastSeenAt (kept, not pruned) or no prefs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jaghelm-tokens-'));
  const path = join(dir, 'push-tokens.json');
  writeFileSync(path, JSON.stringify({
    iso: { platform: 'android', registeredAt: 1000, lastSeenAt: '2026-06-25T00:00:00Z', prefs: DEFAULT_PREFS },
    noprefs: { platform: 'android', registeredAt: 1000, lastSeenAt: 4000 },
  }), 'utf8');
  const store = createTokenStore({ path, now: () => 5000 });
  assert.equal(store.getToken('iso').lastSeenAt, 5000, 'an unreadable lastSeenAt is not evidence the token is dead');
  assert.equal(store.pruneStale(), 0);
  assert.deepEqual(store.getToken('noprefs').prefs, DEFAULT_PREFS);
  assert.equal(store.getAllTokens().length, 2);
  rmSync(dir, { recursive: true, force: true });
});

test('setPrefs with an ARRAY categories falls back to all defaults, no crash', () => {
  const { store, setNow, cleanup } = freshStore();
  setNow(1000);
  store.registerToken('tok-arr', { platform: 'android', appVersion: '1.0.0' });
  const rec = store.setPrefs('tok-arr', { categories: ['bad', 'input'] });
  assert.deepEqual(rec.prefs, DEFAULT_PREFS);
  cleanup();
});

test('setPrefs on an unknown token returns null', () => {
  const { store, cleanup } = freshStore();
  assert.equal(store.setPrefs('ghost', {}), null);
  cleanup();
});

test('setPrefs with a PRIMITIVE categories falls back to all defaults, no crash', () => {
  const { store, setNow, cleanup } = freshStore();
  setNow(1000);
  store.registerToken('tok-prim', { platform: 'android', appVersion: '1.0.0' });
  const rec = store.setPrefs('tok-prim', { categories: 42 });
  assert.deepEqual(rec.prefs, DEFAULT_PREFS);
  cleanup();
});

// ── C1: prototype-pollution hardening ────────────────────────────────────────

test('registerToken("__proto__") does NOT pollute Object.prototype', () => {
  const { store, setNow, cleanup } = freshStore();
  setNow(1000);
  store.registerToken('__proto__', { platform: 'x' });
  // Object.prototype must NOT have been poisoned.
  assert.equal(({}).platform, undefined, 'Object.prototype.platform must be undefined');
  cleanup();
});

test('registerToken("__proto__") round-trips as a normal own entry', () => {
  const { store, setNow, cleanup } = freshStore();
  setNow(1000);
  const rec = store.registerToken('__proto__', { platform: 'android' });
  assert.equal(rec.platform, 'android');
  const got = store.getToken('__proto__');
  assert.ok(got, 'getToken("__proto__") returns the stored record');
  assert.equal(got.platform, 'android');
  cleanup();
});

test('registerToken("constructor") does NOT pollute Object.prototype', () => {
  const { store, setNow, cleanup } = freshStore();
  setNow(1000);
  store.registerToken('constructor', { platform: 'ios' });
  assert.equal(({}).platform, undefined, 'Object.prototype.platform must be undefined after constructor key');
  cleanup();
});
