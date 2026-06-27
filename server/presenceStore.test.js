import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { createPresenceStore } from './presenceStore.js';

function tmpPath(name) {
  return join(tmpdir(), `jaghelm-presence-${process.pid}-${name}.json`);
}

// sanitize that keeps only { v: number } records.
const sanitizeNum = (raw) =>
  raw && typeof raw === 'object' && typeof raw.v === 'number' ? { v: raw.v } : null;

test('presenceStore: absent file loads as an empty store', () => {
  const path = tmpPath('empty');
  try {
    const s = createPresenceStore({ path, sanitize: sanitizeNum });
    assert.deepEqual(s.snapshot(), {});
    assert.equal(s.get('x'), undefined);
  } finally { if (existsSync(path)) rmSync(path); }
});

test('presenceStore: sanitize drops malformed entries on load', () => {
  const path = tmpPath('sanitize');
  try {
    writeFileSync(path, JSON.stringify({ good: { v: 7 }, bad: { nope: 1 }, alsoBad: 5 }));
    const s = createPresenceStore({ path, sanitize: sanitizeNum });
    assert.deepEqual(s.get('good'), { v: 7 });
    assert.equal(s.has('bad'), false);
    assert.equal(s.has('alsoBad'), false);
  } finally { if (existsSync(path)) rmSync(path); }
});

test('presenceStore: save is a no-op until markDirty', () => {
  const path = tmpPath('dirty-gate');
  try {
    const s = createPresenceStore({ path, sanitize: sanitizeNum });
    s.set('a', { v: 1 });   // mutate but DO NOT markDirty
    s.save();
    assert.equal(existsSync(path), false);
    s.markDirty();
    s.save();
    assert.equal(existsSync(path), true);
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { a: { v: 1 } });
  } finally { if (existsSync(path)) rmSync(path); }
});

test('presenceStore: markDirty + save persists; a fresh instance reloads it', () => {
  const path = tmpPath('roundtrip');
  try {
    const a = createPresenceStore({ path, sanitize: sanitizeNum });
    a.set('k', { v: 42 });
    a.markDirty();
    a.save();
    const b = createPresenceStore({ path, sanitize: sanitizeNum });
    assert.deepEqual(b.get('k'), { v: 42 });
  } finally { if (existsSync(path)) rmSync(path); }
});

test('presenceStore: corrupt file loads as empty (no throw)', () => {
  const path = tmpPath('corrupt');
  try {
    writeFileSync(path, '{ not json at all');
    const s = createPresenceStore({ path, sanitize: sanitizeNum });
    assert.deepEqual(s.snapshot(), {});
  } finally { if (existsSync(path)) rmSync(path); }
});

test('presenceStore: __proto__ key is ignored on load (no prototype pollution)', () => {
  const path = tmpPath('proto');
  try {
    writeFileSync(path, '{"__proto__":{"v":1},"constructor":{"v":3},"prototype":{"v":4},"safe":{"v":2}}');
    const s = createPresenceStore({ path, sanitize: sanitizeNum });
    assert.deepEqual(s.get('safe'), { v: 2 });
    assert.equal(s.has('__proto__'), false);
    assert.equal(s.has('constructor'), false);
    assert.equal(s.has('prototype'), false);
    assert.equal(({}).v, undefined); // global proto untouched
  } finally { if (existsSync(path)) rmSync(path); }
});

test('presenceStore: injected now is exposed for wrappers', () => {
  const path = tmpPath('now');
  try {
    const s = createPresenceStore({ path, now: () => 1234, sanitize: sanitizeNum });
    assert.equal(s.now(), 1234);
  } finally { if (existsSync(path)) rmSync(path); }
});
