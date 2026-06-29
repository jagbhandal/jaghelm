// server/watchtower/heldBackStore.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHeldBackStore } from './heldBackStore.js';

function tmpStorePath() {
  const dir = mkdtempSync(join(tmpdir(), 'heldback-'));
  return { path: join(dir, 'held-back.json'), dir };
}

test('first sighting of a stale container is newly held back', () => {
  const { path, dir } = tmpStorePath();
  try {
    const s = createHeldBackStore({ path });
    const r = s.diffAndSet('vm-101', [{ name: 'vaultwarden', current: '1a', latest: '2b' }]);
    assert.deepEqual(r.newlyHeldBack, [{ name: 'vaultwarden', current: '1a', latest: '2b' }]);
    assert.deepEqual(r.cleared, []);
    assert.equal(r.current.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an unchanged stale set produces no transitions and no disk write', () => {
  const { path, dir } = tmpStorePath();
  try {
    const s = createHeldBackStore({ path });
    s.diffAndSet('vm-101', [{ name: 'vaultwarden', current: '1a', latest: '2b' }]);
    rmSync(path, { force: true }); // delete the file written by the first call
    const r = s.diffAndSet('vm-101', [{ name: 'vaultwarden', current: '1a', latest: '2b' }]);
    assert.deepEqual(r.newlyHeldBack, []);
    assert.deepEqual(r.cleared, []);
    assert.equal(existsSync(path), false, 'steady-state must not rewrite the file');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a newer latest image on an already-stale container re-fires as newly held back', () => {
  const { path, dir } = tmpStorePath();
  try {
    const s = createHeldBackStore({ path });
    s.diffAndSet('vm-101', [{ name: 'vaultwarden', current: '1a', latest: '2b' }]);
    const r = s.diffAndSet('vm-101', [{ name: 'vaultwarden', current: '1a', latest: '3c' }]);
    assert.deepEqual(r.newlyHeldBack, [{ name: 'vaultwarden', current: '1a', latest: '3c' }]);
    assert.deepEqual(r.cleared, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a container dropping off the stale set is reported cleared', () => {
  const { path, dir } = tmpStorePath();
  try {
    const s = createHeldBackStore({ path });
    s.diffAndSet('vm-101', [
      { name: 'vaultwarden', current: '1a', latest: '2b' },
      { name: 'adguard', current: 'aa', latest: 'bb' },
    ]);
    const r = s.diffAndSet('vm-101', [{ name: 'adguard', current: 'aa', latest: 'bb' }]);
    assert.deepEqual(r.newlyHeldBack, []);
    assert.deepEqual(r.cleared, [{ name: 'vaultwarden', current: '1a', latest: '2b' }]);
    assert.deepEqual(r.current, [{ name: 'adguard', current: 'aa', latest: 'bb' }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('state persists across a reload (no spurious re-ping after restart)', () => {
  const { path, dir } = tmpStorePath();
  try {
    createHeldBackStore({ path }).diffAndSet('vm-101', [{ name: 'vaultwarden', current: '1a', latest: '2b' }]);
    const s2 = createHeldBackStore({ path }); // simulate a restart
    const r = s2.diffAndSet('vm-101', [{ name: 'vaultwarden', current: '1a', latest: '2b' }]);
    assert.deepEqual(r.newlyHeldBack, [], 'reloaded state must not treat the backlog as new');
    assert.deepEqual(r.cleared, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('nodes are isolated from each other', () => {
  const { path, dir } = tmpStorePath();
  try {
    const s = createHeldBackStore({ path });
    s.diffAndSet('vm-101', [{ name: 'vaultwarden', current: '1a', latest: '2b' }]);
    const r = s.diffAndSet('pi-2', [{ name: 'adguard', current: 'aa', latest: 'bb' }]);
    assert.deepEqual(r.newlyHeldBack, [{ name: 'adguard', current: 'aa', latest: 'bb' }]);
    assert.deepEqual(r.cleared, [], 'a new node must not clear another node\'s set');
    assert.deepEqual(s.getNode('vm-101'), [{ name: 'vaultwarden', current: '1a', latest: '2b' }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('duplicate names in one report collapse (last wins)', () => {
  const { path, dir } = tmpStorePath();
  try {
    const s = createHeldBackStore({ path });
    const r = s.diffAndSet('vm-101', [
      { name: 'dup', current: '1', latest: 'a' },
      { name: 'dup', current: '1', latest: 'b' },
    ]);
    assert.deepEqual(r.current, [{ name: 'dup', current: '1', latest: 'b' }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a __proto__ node name does not pollute Object.prototype', () => {
  const { path, dir } = tmpStorePath();
  try {
    const s = createHeldBackStore({ path });
    s.diffAndSet('__proto__', [{ name: 'x', current: '1', latest: '2' }]);
    assert.equal(({}).x, undefined);
    assert.deepEqual(s.getNode('__proto__'), [{ name: 'x', current: '1', latest: '2' }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('over-long fields are length-bounded (anti-stuffing)', () => {
  const { path, dir } = tmpStorePath();
  try {
    const s = createHeldBackStore({ path });
    const big = 'a'.repeat(5000);
    const r = s.diffAndSet('vm-101', [{ name: big, current: big, latest: big }]);
    assert.equal(r.current[0].name.length, 256);
    assert.equal(r.current[0].current.length, 256);
    assert.equal(r.current[0].latest.length, 256);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('node count is bounded; oldest nodes are evicted under a flood', () => {
  const { path, dir } = tmpStorePath();
  try {
    const s = createHeldBackStore({ path });
    for (let i = 0; i < 150; i += 1) {
      s.diffAndSet(`node-${i}`, [{ name: 'x', current: '1', latest: '2' }]);
    }
    assert.equal(s.getNode('node-0').length, 0, 'oldest node should be evicted');
    assert.equal(s.getNode('node-149').length, 1, 'newest node should be retained');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('empty stale set for an unseen node creates no entry and no write', () => {
  const { path, dir } = tmpStorePath();
  try {
    const s = createHeldBackStore({ path });
    const r = s.diffAndSet('vm-101', []);
    assert.deepEqual(r, { newlyHeldBack: [], cleared: [], current: [] });
    assert.equal(existsSync(path), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
