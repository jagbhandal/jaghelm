// server/containerRegistry.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { createContainerRegistry } from './containerRegistry.js';

function tmpPath(name) {
  return join(tmpdir(), `jaghelm-cregistry-${process.pid}-${name}.json`);
}
const WINDOW = { graceMs: 90_000, ttlMs: 86_400_000, establishMs: 60_000 };

test('containerRegistry: recordSeen sets firstSeenAt once, updates lastSeen*', () => {
  const path = tmpPath('record');
  try {
    const r = createContainerRegistry({ path });
    r.recordSeen('redis', 'vm103', 0);
    r.recordSeen('redis', 'pi1', 60_000);
    const snap = r.snapshot();
    assert.equal(snap.redis.firstSeenAt, 0);
    assert.equal(snap.redis.lastSeenAt, 60_000);
    assert.equal(snap.redis.lastSeenNode, 'pi1');
  } finally { if (existsSync(path)) rmSync(path); }
});

test('containerRegistry: a container still within the grace window is NOT missing', () => {
  const path = tmpPath('grace');
  try {
    const r = createContainerRegistry({ path });
    r.recordSeen('redis', 'vm103', 0);
    r.recordSeen('redis', 'vm103', 60_000);          // established (span 60s)
    const missing = r.getMissing({ now: 60_000 + 30_000, ...WINDOW }); // absent 30s < grace
    assert.deepEqual(missing, []);
  } finally { if (existsSync(path)) rmSync(path); }
});

test('containerRegistry: an established container absent past grace and within TTL is missing', () => {
  const path = tmpPath('window');
  try {
    const r = createContainerRegistry({ path });
    r.recordSeen('redis', 'vm103', 0);
    r.recordSeen('redis', 'vm103', 60_000);
    const missing = r.getMissing({ now: 60_000 + 120_000, ...WINDOW }); // absent 120s
    assert.equal(missing.length, 1);
    assert.deepEqual(missing[0], { container: 'redis', lastSeenNode: 'vm103', lastSeenAt: 60_000, ageMs: 120_000 });
  } finally { if (existsSync(path)) rmSync(path); }
});

test('containerRegistry: past TTL it fades (not missing)', () => {
  const path = tmpPath('ttl');
  try {
    const r = createContainerRegistry({ path });
    r.recordSeen('redis', 'vm103', 0);
    r.recordSeen('redis', 'vm103', 60_000);
    const missing = r.getMissing({ now: 60_000 + 200_000, graceMs: 90_000, ttlMs: 100_000, establishMs: 60_000 });
    assert.deepEqual(missing, []);
  } finally { if (existsSync(path)) rmSync(path); }
});

test('containerRegistry: the establish-guard excludes an ephemeral one-shot container', () => {
  const path = tmpPath('establish');
  try {
    const r = createContainerRegistry({ path });
    r.recordSeen('build-job', 'vm103', 0);            // single sight, span 0 < 60s
    const missing = r.getMissing({ now: 200_000, ...WINDOW });
    assert.deepEqual(missing, []);
  } finally { if (existsSync(path)) rmSync(path); }
});

test('containerRegistry: prune drops entries absent longer than ttl', () => {
  const path = tmpPath('prune');
  try {
    const r = createContainerRegistry({ path });
    r.recordSeen('old', 'vm103', 0);
    r.recordSeen('old', 'vm103', 60_000);
    r.prune(100_000, 60_000 + 200_000);               // age 200s > ttl 100s → dropped
    assert.equal(r.snapshot().old, undefined);
  } finally { if (existsSync(path)) rmSync(path); }
});

test('containerRegistry: persists across instances (save → reload)', () => {
  const path = tmpPath('persist');
  try {
    const a = createContainerRegistry({ path });
    a.recordSeen('pg', 'pi1', 0);
    a.recordSeen('pg', 'pi1', 60_000);
    a.save();
    const b = createContainerRegistry({ path });
    const missing = b.getMissing({ now: 60_000 + 120_000, ...WINDOW });
    assert.equal(missing.length, 1);
    assert.equal(missing[0].lastSeenNode, 'pi1');
  } finally { if (existsSync(path)) rmSync(path); }
});

test('containerRegistry: corrupt file loads as empty (no throw)', () => {
  const path = tmpPath('corrupt');
  try {
    writeFileSync(path, 'definitely not json');
    const r = createContainerRegistry({ path });
    assert.deepEqual(r.getMissing({ now: 1e9, ...WINDOW }), []);
  } finally { if (existsSync(path)) rmSync(path); }
});
