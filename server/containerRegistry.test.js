// server/containerRegistry.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createContainerRegistry, PRESENCE_FLUSH_MS } from './containerRegistry.js';
import { atomicWriteFileSync } from './util/atomicWrite.js';

function tmpPath(name) {
  return join(tmpdir(), `jaghelm-cregistry-${process.pid}-${name}.json`);
}
const WINDOW = { graceMs: 90_000, ttlMs: 86_400_000, establishMs: 60_000 };

// Spies on the atomic writer: counts every write attempt, then really writes
// (so a fresh instance can reload it). `failFirst` makes the first attempt throw.
function writeSpy({ failFirst = false } = {}) {
  const spy = {
    calls: 0,
    write(path, data) {
      spy.calls += 1;
      if (failFirst && spy.calls === 1) throw new Error('disk full');
      atomicWriteFileSync(path, data);
    },
  };
  return spy;
}

// An established redis on vm103, last seen at `lastSeenAt`, as a file on disk.
function seedEstablished(path, lastSeenAt) {
  writeFileSync(path, JSON.stringify({ redis: { lastSeenNode: 'vm103', firstSeenAt: 0, lastSeenAt } }));
}

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

test('containerRegistry: steady-state cycles write nothing until the flush interval', () => {
  const path = tmpPath('steady');
  const start = 600_000;
  let clock = start;
  const spy = writeSpy();
  try {
    seedEstablished(path, start);
    const r = createContainerRegistry({ path, now: () => clock, write: spy.write });
    // The refresh loop's per-cycle calls: recordSeen, prune, save.
    for (clock = start + 30_000; clock < start + PRESENCE_FLUSH_MS; clock += 30_000) {
      r.recordSeen('redis', 'vm103', clock);
      r.prune();
      r.save();
    }
    assert.equal(spy.calls, 0, 'same container, same node: no write');
    clock = start + PRESENCE_FLUSH_MS;
    r.recordSeen('redis', 'vm103', clock);
    r.save();
    assert.equal(spy.calls, 1, 'the refreshed lastSeenAt is written once per PRESENCE_FLUSH_MS');
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).redis.lastSeenAt, clock);
  } finally { if (existsSync(path)) rmSync(path); }
});

test('containerRegistry: a new container, a node move or becoming established is written at once', () => {
  const path = tmpPath('changes');
  const spy = writeSpy();
  try {
    const r = createContainerRegistry({ path, now: () => 0, write: spy.write });
    r.recordSeen('redis', 'vm103', 0);
    r.save();
    assert.equal(spy.calls, 1, 'new container');
    r.recordSeen('redis', 'vm103', 30_000);
    r.save();
    assert.equal(spy.calls, 1, 'seen again, not yet established: no write');
    r.recordSeen('redis', 'vm103', 60_000);
    r.save();
    assert.equal(spy.calls, 2, 'established (ran 60s)');
    r.recordSeen('redis', 'pi1', 90_000);
    r.save();
    assert.equal(spy.calls, 3, 'moved node');
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).redis.lastSeenNode, 'pi1');
  } finally { if (existsSync(path)) rmSync(path); }
});

test('containerRegistry: a prune that drops an entry is written at once', () => {
  const path = tmpPath('prune-write');
  const spy = writeSpy();
  try {
    seedEstablished(path, 60_000);
    const r = createContainerRegistry({ path, now: () => 60_000, write: spy.write });
    r.prune(100_000, 60_000 + 200_000);
    r.save();
    assert.equal(spy.calls, 1);
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), {});
  } finally { if (existsSync(path)) rmSync(path); }
});

test('containerRegistry: a failed write is retried on the next save', () => {
  const path = tmpPath('retry');
  const spy = writeSpy({ failFirst: true });
  try {
    const r = createContainerRegistry({ path, now: () => 0, write: spy.write });
    r.recordSeen('redis', 'vm103', 0);
    r.save();                                   // throws inside, logged
    assert.equal(existsSync(path), false);
    r.save();                                   // nothing new, but the change is still unwritten
    assert.equal(spy.calls, 2);
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).redis.lastSeenNode, 'vm103');
  } finally { if (existsSync(path)) rmSync(path); }
});

test('containerRegistry: flush writes a refreshed lastSeenAt at once, and a restart sees it', () => {
  const path = tmpPath('flush');
  const spy = writeSpy();
  try {
    seedEstablished(path, 600_000);
    const a = createContainerRegistry({ path, now: () => 630_000, write: spy.write });
    a.flush();
    assert.equal(spy.calls, 0, 'nothing pending: no write');
    a.recordSeen('redis', 'vm103', 630_000);
    a.save();
    assert.equal(spy.calls, 0, 'inside the flush interval');
    a.flush();                                  // shutdown
    assert.equal(spy.calls, 1);
    const b = createContainerRegistry({ path });
    const missing = b.getMissing({ now: 630_000 + 120_000, ...WINDOW });
    assert.equal(missing[0].lastSeenAt, 630_000, 'restart reads the last sighting, not the stale one');
  } finally { if (existsSync(path)) rmSync(path); }
});

test('registry: a stopped container remembers its Compose project (#642), and keeps it when a sighting has none', () => {
  const r = createContainerRegistry({ path: join(tmpdir(), `cr-project-${process.pid}.json`), now: () => 0, write: () => {} });
  r.recordSeen('immich_redis', 'vm103', 0, 'immich');
  r.recordSeen('immich_redis', 'vm103', 120_000);
  const [gone] = r.getMissing({ now: 600_000 });
  assert.equal(gone.project, 'immich');
  r.recordSeen('plain', 'vm103', 0);
  r.recordSeen('plain', 'vm103', 120_000);
  assert.equal(r.getMissing({ now: 600_000 }).find((m) => m.container === 'plain').project, undefined);
});

test('registry: a container remembers that its monitor checked a web address (#642), across a restart, and never invents one', () => {
  const path = join(tmpdir(), `cr-web-${process.pid}.json`);
  rmSync(path, { force: true });
  let t = 0;
  const r = createContainerRegistry({ path, now: () => t });
  r.recordSeen('nextcloud-app', 'vm103', 0, 'nextcloud', true);
  r.recordSeen('nextcloud-cron', 'vm103', 0, 'nextcloud', false);
  t = 120_000;
  r.recordSeen('nextcloud-app', 'vm103', 120_000, 'nextcloud');
  r.recordSeen('nextcloud-cron', 'vm103', 120_000, 'nextcloud', false);
  r.flush();
  const again = createContainerRegistry({ path, now: () => 600_000 });
  const missing = Object.fromEntries(again.getMissing({ now: 600_000 }).map((m) => [m.container, m]));
  assert.equal(missing['nextcloud-app'].web, true);
  assert.equal('web' in missing['nextcloud-cron'], false);
  rmSync(path, { force: true });
});
