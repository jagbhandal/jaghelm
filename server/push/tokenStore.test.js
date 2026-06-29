/**
 * Push token store — registration upsert, prefs, prune, persistence round-trip.
 * Pure-ish store: the only clock is the injected `now`, so every assertion uses
 * a FIXED fake clock (never real Date.now). Each test gets its own mkdtemp path.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTokenStore, DEFAULT_PREFS } from './tokenStore.js';

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

test('pruneStale removes tokens older than maxAge using the injected now', () => {
  const { store, setNow, cleanup } = freshStore();
  const DAY = 24 * 60 * 60 * 1000;
  setNow(1000);
  store.registerToken('fresh', { platform: 'android', appVersion: '1.0.0' }); // lastSeenAt 1000

  setNow(1000 + 40 * DAY);
  store.registerToken('recent', { platform: 'android', appVersion: '1.0.0' }); // lastSeenAt now

  // now = 1000 + 40d. Default maxAge 30d => cutoff = 1000 + 10d. `fresh` (1000) is older => pruned.
  const removed = store.pruneStale();
  assert.equal(removed, 1);
  assert.equal(store.getToken('fresh'), null);
  assert.ok(store.getToken('recent'), 'recent token survives');
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
