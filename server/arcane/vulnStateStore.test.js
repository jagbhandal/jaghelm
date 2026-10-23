// server/arcane/vulnStateStore.test.js
// The store lives in memory; since #581 its toFile() is persisted in
// push-snapshot.json with the digest's notices (notices.test.js). `reopen` is
// a restart: a new store from that, through JSON as the file holds it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVulnStateStore, MAX_KEYS } from './vulnStateStore.js';
import { findingKey } from './vulnDerive.js';

const fromFile = (text) => createVulnStateStore({ initial: JSON.parse(text) });
const reopen = (s) => fromFile(JSON.stringify(s.toFile()));
const e = (repo, id, pkg, sev) => ({ repo, id, pkg, sev });
const keysOf = (...entries) => new Map(entries.map((x) => [findingKey(x.repo, x.id, x.pkg), x]));

test('round-trips environments and the last run through a fresh instance', () => {
  const a = createVulnStateStore();
  assert.equal(a.getLastRun(), null);
  assert.equal(a.knownCount(), 0);
  a.setEnv('vm-103', {
    keys: keysOf(e('db', 'CVE-2', 'q', 'H'), e('app', 'CVE-1', 'p', 'C')),
    kev: 2,
    atMs: 1000,
  });
  a.setLastRun(5000);
  const b = reopen(a);
  assert.equal(b.isKnown('vm-103'), true);
  assert.equal(b.isKnown('vm-101'), false);
  assert.equal(b.knownCount(), 1);
  assert.equal(b.getLastRun(), 5000);
  const got = b.getEnv('vm-103');
  assert.equal(got.kev, 2);
  assert.equal(got.atMs, 1000);
  // Sorted by key on the way in.
  assert.deepEqual(
    [...got.keys.values()],
    [e('app', 'CVE-1', 'p', 'C'), e('db', 'CVE-2', 'q', 'H')]
  );
  assert.equal(b.getEnv('nope'), null);
});

test('it has the documented shape (the old arcane-vuln-state.json\'s)', () => {
  const s = createVulnStateStore();
  s.setEnv('vm-103', {
    keys: keysOf(e('app', 'CVE-1', 'p', 'C')),
    kev: null,
    atMs: 7,
    stale: ['redis'],
    failed: ['nextcloud'],
  });
  s.setLastRun(9);
  assert.deepEqual(JSON.parse(JSON.stringify(s.toFile())), {
    lastRunMs: 9,
    envs: {
      'vm-103': {
        kev: null,
        atMs: 7,
        stale: ['redis'],
        failed: ['nextcloud'],
        keys: [['app', 'CVE-1', 'p', 'C']],
      },
    },
    order: ['vm-103'],
  });
});

test('anything but the state loads as empty', () => {
  for (const content of ['null', '[]', '"x"', '{"envs":[],"lastRunMs":"5"}']) {
    const s = fromFile(content);
    assert.equal(s.knownCount(), 0, content);
    assert.equal(s.getLastRun(), null, content);
  }
});

test('keys are sanitised: bad entries dropped, fields capped, duplicates merged', () => {
  const long = 'x'.repeat(400);
  const s = fromFile(
    JSON.stringify({
      lastRunMs: -1,
      envs: {
        'vm-103': {
          kev: 1.5,
          atMs: 'x',
          keys: [
            ['app', 'CVE-1', 'p', 'C'],
            ['app', 'CVE-1', 'p', 'H'], // same key again
            ['app', 'CVE-2', 'p', 'M'], // not critical or high
            ['app', '', 'p', 'H'],
            ['app', 'CVE-3', 'p'],
            'app',
            null,
            [long, 'CVE-4', 'p', 'H'],
          ],
        },
      },
    })
  );
  assert.equal(s.getLastRun(), null);
  const got = s.getEnv('vm-103');
  assert.equal(got.kev, null);
  assert.equal(got.atMs, null);
  assert.deepEqual(
    [...got.keys.values()].map((x) => [x.repo.length, x.id, x.sev]),
    [
      [3, 'CVE-1', 'C'],
      [256, 'CVE-4', 'H'],
    ]
  );
  // The map is keyed exactly as vulnDerive keys a finding.
  assert.ok(got.keys.has(findingKey('app', 'CVE-1', 'p')));
});

test(`more than MAX_KEYS (${MAX_KEYS}) keys is refused, never truncated`, () => {
  const many = Array.from({ length: MAX_KEYS + 1 }, (_, i) =>
    e('app', `CVE-${String(i).padStart(6, '0')}`, 'p', 'H')
  );
  const s = createVulnStateStore();
  assert.equal(
    s.setEnv('vm-103', { keys: keysOf(e('a', 'CVE-1', 'p', 'H')), kev: 0, atMs: 1 }),
    true
  );
  const revision = s.revision();
  assert.equal(s.setEnv('vm-103', { keys: keysOf(...many), kev: 0, atMs: 2 }), false);
  assert.equal(s.revision(), revision, 'nothing to write');
  const kept = reopen(s).getEnv('vm-103');
  assert.deepEqual([kept.keys.size, kept.atMs], [1, 1]);
  // Exactly MAX_KEYS is fine.
  assert.equal(s.setEnv('vm-103', { keys: keysOf(...many.slice(1)), kev: 0, atMs: 3 }), true);
  assert.equal(reopen(s).getEnv('vm-103').keys.size, MAX_KEYS);
});

test('scan health names round-trip, sanitised and bounded', () => {
  const s = createVulnStateStore();
  const names = Array.from({ length: 250 }, (_, i) => `img-${String(i).padStart(3, '0')}`);
  s.setEnv('vm-103', {
    keys: new Map(),
    kev: 0,
    atMs: 1,
    stale: ['b', 'a', 'a', '', 7, 'x'.repeat(300), ...names],
    failed: 'nope',
  });
  const got = reopen(s).getEnv('vm-103');
  assert.equal(got.stale.length, 200);
  assert.deepEqual(got.stale.slice(0, 2), ['a', 'b']);
  assert.ok(got.stale.every((n) => typeof n === 'string' && n.length > 0 && n.length <= 256));
  assert.deepEqual(got.failed, []);
  // A file without them (or a new environment) has none.
  s.setEnv('pi-1', { keys: new Map(), kev: 0, atMs: 1 });
  assert.deepEqual([s.getEnv('pi-1').stale, s.getEnv('pi-1').failed], [[], []]);
});

test('at most 50 environments are kept, oldest-inserted evicted, never the one written', () => {
  const s = createVulnStateStore();
  for (let i = 0; i < 52; i++) s.setEnv(`env-${i}`, { keys: new Map(), kev: 0, atMs: i });
  const b = reopen(s);
  assert.equal(b.knownCount(), 50);
  assert.equal(b.isKnown('env-0'), false);
  assert.equal(b.isKnown('env-1'), false);
  assert.equal(b.isKnown('env-51'), true);
});

test('__proto__ and constructor as names are plain environments', () => {
  const s = createVulnStateStore();
  s.setEnv('__proto__', { keys: keysOf(e('a', 'CVE-1', 'p', 'H')), kev: 1, atMs: 1 });
  s.setEnv('constructor', { keys: new Map(), kev: 0, atMs: 1 });
  assert.equal({}.kev, undefined);
  const b = reopen(s);
  assert.equal(b.isKnown('__proto__'), true);
  assert.equal(b.getEnv('__proto__').keys.size, 1);
  assert.equal(b.isKnown('constructor'), true);
  assert.equal(b.isKnown('toString'), false);
});

test('invalid input is ignored; unchanged state is not rewritten', () => {
  const s = createVulnStateStore();
  s.setEnv('', { keys: new Map(), kev: 0, atMs: 1 });
  s.setEnv('vm-103', null);
  s.setLastRun(-5);
  s.setLastRun(1.5);
  assert.equal(s.knownCount(), 0);
  assert.equal(s.getLastRun(), null);
  s.setEnv('vm-103', { keys: keysOf(e('a', 'CVE-1', 'p', 'H')), kev: 1, atMs: 1 });
  s.setLastRun(10);
  const revision = s.revision();
  assert.equal(revision, 2);
  s.setEnv('vm-103', { keys: keysOf(e('a', 'CVE-1', 'p', 'H')), kev: 1, atMs: 1 });
  s.setLastRun(10);
  assert.equal(s.revision(), revision);
});

test('getEnv returns a copy', () => {
  const s = createVulnStateStore();
  s.setEnv('vm-103', { keys: keysOf(e('a', 'CVE-1', 'p', 'H')), kev: 1, atMs: 1 });
  s.getEnv('vm-103').keys.clear();
  assert.equal(s.getEnv('vm-103').keys.size, 1);
});

test('knownNames lists the digested environments in insertion order', () => {
  const s = createVulnStateStore();
  assert.deepEqual(s.knownNames(), []);
  s.setEnv('vm-103', { keys: new Map(), kev: 0, atMs: 1 });
  s.setEnv('2', { keys: new Map(), kev: 0, atMs: 1 });
  assert.deepEqual(reopen(s).knownNames(), ['vm-103', '2']);
});
