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

test('registry: remembers + returns the matched container (3-arg recordSeen)', () => {
  const path = tmpPath('container');
  try {
    const r = createServiceRegistry({ path, now: () => 1000 });
    r.recordSeen('7', 'vm103', 'radarr');
    assert.equal(r.getLastSeenContainer('7'), 'radarr');
    assert.equal(r.getLastSeenNode('7'), 'vm103');
    assert.equal(r.getLastSeenContainer('999'), null);
  } finally { if (existsSync(path)) rmSync(path); }
});

test('registry: the remembered container persists across reload', () => {
  const path = tmpPath('container-persist');
  try {
    const a = createServiceRegistry({ path, now: () => 1 });
    a.recordSeen('7', 'vm103', 'radarr');
    a.save();
    const b = createServiceRegistry({ path });
    assert.equal(b.getLastSeenContainer('7'), 'radarr');
    assert.equal(b.getLastSeenNode('7'), 'vm103');
  } finally { if (existsSync(path)) rmSync(path); }
});

test('registry: a changed container dirties the store (same node)', () => {
  const path = tmpPath('container-dirty');
  try {
    const r = createServiceRegistry({ path, now: () => 5 });
    r.recordSeen('1', 'vm103', 'radarr');
    r.save();
    rmSync(path);
    r.recordSeen('1', 'vm103', 'sonarr');   // same node, NEW container → must write
    r.save();
    assert.equal(existsSync(path), true);
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

// ---- home node for the monitor matcher (#240) ----

test('registry: a record this version writes is a home node; one the old matcher left is not', () => {
  const path = tmpPath('home');
  try {
    writeFileSync(path, JSON.stringify({ 1: { lastSeenNode: 'pi2', lastSeenAt: 1, lastSeenContainer: 'vaultwarden' } }));
    const r = createServiceRegistry({ path, now: () => 5 });
    assert.equal(r.getLastSeenNode('1'), 'pi2', 'still places an outage card');
    assert.equal(r.getHomeNode('1'), null);
    r.recordSeen('2', 'vm103', 'gitea');
    assert.equal(r.getHomeNode('2'), 'vm103');
    assert.equal(r.getHomeNode('999'), null);
  } finally { if (existsSync(path)) rmSync(path); }
});

test('registry: an old record is rewritten once to mark it, then not again', () => {
  const path = tmpPath('home-mark');
  try {
    writeFileSync(path, JSON.stringify({ 1: { lastSeenNode: 'vm103', lastSeenAt: 1, lastSeenContainer: 'gitea' } }));
    let writes = 0;
    const r = createServiceRegistry({ path, now: () => 5, write: () => { writes += 1; } });
    for (let i = 0; i < 3; i += 1) {
      r.recordSeen('1', 'vm103', 'gitea');
      r.save();
    }
    assert.equal(writes, 1);
    assert.equal(r.getHomeNode('1'), 'vm103');
  } finally { if (existsSync(path)) rmSync(path); }
});

test('registry: the marker survives a save and reload', () => {
  const path = tmpPath('home-persist');
  try {
    const a = createServiceRegistry({ path, now: () => 1 });
    a.recordSeen('7', 'vm103', 'radarr');
    a.save();
    const b = createServiceRegistry({ path });
    assert.equal(b.getHomeNode('7'), 'vm103');
  } finally { if (existsSync(path)) rmSync(path); }
});
