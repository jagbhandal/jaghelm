// server/watchtower/heldBackStore.test.js
// The store lives in memory; since #581 the Arcane poller persists its
// toFile() in push-snapshot.json (arcane/notices.test.js). `reopen` is a
// restart: a new store from that, through JSON as the file holds it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHeldBackStore } from './heldBackStore.js';

const reopen = (s) => createHeldBackStore({ initial: JSON.parse(JSON.stringify(s.toFile())) });

test('first sighting of a stale container is newly held back', () => {
  const s = createHeldBackStore();
  const r = s.diffAndSet('vm-101', [{ name: 'vaultwarden', current: '1a', latest: '2b' }]);
  assert.deepEqual(r.newlyHeldBack, [{ name: 'vaultwarden', current: '1a', latest: '2b' }]);
  assert.deepEqual(r.cleared, []);
  assert.equal(r.current.length, 1);
});

test('an unchanged stale set produces no transitions and no change to write', () => {
  const s = createHeldBackStore();
  s.diffAndSet('vm-101', [{ name: 'vaultwarden', current: '1a', latest: '2b' }]);
  const revision = s.revision();
  assert.equal(revision, 1);
  const r = s.diffAndSet('vm-101', [{ name: 'vaultwarden', current: '1a', latest: '2b' }]);
  assert.deepEqual(r.newlyHeldBack, []);
  assert.deepEqual(r.cleared, []);
  assert.equal(s.revision(), revision, 'steady-state must not rewrite the file');
});

test('a newer latest image on an already-stale container re-fires as newly held back', () => {
  const s = createHeldBackStore();
  s.diffAndSet('vm-101', [{ name: 'vaultwarden', current: '1a', latest: '2b' }]);
  const r = s.diffAndSet('vm-101', [{ name: 'vaultwarden', current: '1a', latest: '3c' }]);
  assert.deepEqual(r.newlyHeldBack, [{ name: 'vaultwarden', current: '1a', latest: '3c' }]);
  assert.deepEqual(r.cleared, []);
});

test('a container dropping off the stale set is reported cleared', () => {
  const s = createHeldBackStore();
  s.diffAndSet('vm-101', [
    { name: 'vaultwarden', current: '1a', latest: '2b' },
    { name: 'adguard', current: 'aa', latest: 'bb' },
  ]);
  const r = s.diffAndSet('vm-101', [{ name: 'adguard', current: 'aa', latest: 'bb' }]);
  assert.deepEqual(r.newlyHeldBack, []);
  assert.deepEqual(r.cleared, [{ name: 'vaultwarden', current: '1a', latest: '2b' }]);
  assert.deepEqual(r.current, [{ name: 'adguard', current: 'aa', latest: 'bb' }]);
});

test('state persists across a reload (no spurious re-ping after restart)', () => {
  const s1 = createHeldBackStore();
  s1.diffAndSet('vm-101', [{ name: 'vaultwarden', current: '1a', latest: '2b' }]);
  const s2 = reopen(s1); // simulate a restart
  const r = s2.diffAndSet('vm-101', [{ name: 'vaultwarden', current: '1a', latest: '2b' }]);
  assert.deepEqual(r.newlyHeldBack, [], 'reloaded state must not treat the backlog as new');
  assert.deepEqual(r.cleared, []);
});

test('nodes are isolated from each other', () => {
  const s = createHeldBackStore();
  s.diffAndSet('vm-101', [{ name: 'vaultwarden', current: '1a', latest: '2b' }]);
  const r = s.diffAndSet('pi-2', [{ name: 'adguard', current: 'aa', latest: 'bb' }]);
  assert.deepEqual(r.newlyHeldBack, [{ name: 'adguard', current: 'aa', latest: 'bb' }]);
  assert.deepEqual(r.cleared, [], 'a new node must not clear another node\'s set');
  assert.deepEqual(s.getNode('vm-101'), [{ name: 'vaultwarden', current: '1a', latest: '2b' }]);
});

test('duplicate names in one report collapse (last wins)', () => {
  const s = createHeldBackStore();
  const r = s.diffAndSet('vm-101', [
    { name: 'dup', current: '1', latest: 'a' },
    { name: 'dup', current: '1', latest: 'b' },
  ]);
  assert.deepEqual(r.current, [{ name: 'dup', current: '1', latest: 'b' }]);
});

test('a __proto__ node name does not pollute Object.prototype', () => {
  const s = createHeldBackStore();
  s.diffAndSet('__proto__', [{ name: 'x', current: '1', latest: '2' }]);
  assert.equal(({}).x, undefined);
  assert.deepEqual(s.getNode('__proto__'), [{ name: 'x', current: '1', latest: '2' }]);
});

test('over-long fields are length-bounded (anti-stuffing)', () => {
  const s = createHeldBackStore();
  const big = 'a'.repeat(5000);
  const r = s.diffAndSet('vm-101', [{ name: big, current: big, latest: big }]);
  assert.equal(r.current[0].name.length, 256);
  assert.equal(r.current[0].current.length, 256);
  assert.equal(r.current[0].latest.length, 256);
});

test('node count is bounded; oldest nodes are evicted under a flood', () => {
  const s = createHeldBackStore();
  for (let i = 0; i < 150; i += 1) {
    s.diffAndSet(`node-${i}`, [{ name: 'x', current: '1', latest: '2' }]);
  }
  assert.equal(s.getNode('node-0').length, 0, 'oldest node should be evicted');
  assert.equal(s.getNode('node-149').length, 1, 'newest node should be retained');
});

test('empty stale set for an unseen node creates no entry and no write', () => {
  const s = createHeldBackStore();
  const r = s.diffAndSet('vm-101', []);
  assert.deepEqual(r, { newlyHeldBack: [], cleared: [], current: [] });
  assert.equal(s.revision(), 0);
  assert.deepEqual(s.toFile(), {});
});

test('toFile is the old arcane-held-back.json shape, prototype-safe, and anything else loads as empty', () => {
  const s = createHeldBackStore();
  s.diffAndSet('__proto__', [{ name: 'x', current: '1', latest: '2' }]);
  s.diffAndSet('vm-101', [{ name: 'a', current: '1', latest: '2' }]);
  const text = JSON.stringify(s.toFile());
  assert.equal(text, '{"__proto__":[{"name":"x","current":"1","latest":"2"}],"vm-101":[{"name":"a","current":"1","latest":"2"}]}');
  assert.deepEqual(reopen(s).getNode('__proto__'), [{ name: 'x', current: '1', latest: '2' }]);
  assert.equal(({}).x, undefined);
  for (const initial of [undefined, null, 'junk', [], { 'vm-101': 'nope' }]) {
    assert.deepEqual(createHeldBackStore({ initial }).getNode('vm-101'), []);
  }
});
