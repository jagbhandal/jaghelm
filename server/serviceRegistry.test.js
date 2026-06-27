import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { createServiceRegistry } from './serviceRegistry.js';

function tmpPath(name) {
  return join(tmpdir(), `jaghelm-registry-${process.pid}-${name}.json`);
}

test('registry: record then look up returns the last-seen node', () => {
  const path = tmpPath('lookup');
  try {
    const r = createServiceRegistry({ path, now: () => 1000 });
    r.recordSeen('42', 'vm103');
    assert.equal(r.getLastSeenNode('42'), 'vm103');
    assert.equal(r.getLastSeenNode('999'), null);
  } finally { if (existsSync(path)) rmSync(path); }
});

test('registry: persists across instances (save → reload)', () => {
  const path = tmpPath('persist');
  try {
    const a = createServiceRegistry({ path, now: () => 1 });
    a.recordSeen('7', 'pi1');
    a.save();
    const b = createServiceRegistry({ path });
    assert.equal(b.getLastSeenNode('7'), 'pi1');
  } finally { if (existsSync(path)) rmSync(path); }
});

test('registry: corrupt file loads as empty (no throw)', () => {
  const path = tmpPath('corrupt');
  try {
    writeFileSync(path, '{ this is not json');
    const r = createServiceRegistry({ path });
    assert.equal(r.getLastSeenNode('1'), null);
  } finally { if (existsSync(path)) rmSync(path); }
});

test('registry: re-recording the same node does not require a write', () => {
  const path = tmpPath('dirty');
  try {
    const r = createServiceRegistry({ path, now: () => 5 });
    r.recordSeen('1', 'vm103');
    r.save();                       // writes once
    rmSync(path);                   // delete the file
    r.recordSeen('1', 'vm103');     // same node → not dirty
    r.save();                       // should be a no-op, file stays absent
    assert.equal(existsSync(path), false);
  } finally { if (existsSync(path)) rmSync(path); }
});
