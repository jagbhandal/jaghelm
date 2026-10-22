/**
 * When each Prometheus target found waiting for its first scrape began waiting
 * (#476), kept in the data dir so a restart doesn't start the count again.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SEEN_STEP_MS, WAIT_GAP_MS, createTargetWaits, targetKey } from './targetWaits.js';

const T0 = 1_782_345_600_000;

function tempFile() {
  const dir = mkdtempSync(join(tmpdir(), 'jaghelm-waits-'));
  return { path: join(dir, 'prometheus-target-waits.json'), done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('#476: a wait begins at its first sighting and keeps that start while it is seen', () => {
  const f = tempFile();
  try {
    const waits = createTargetWaits({ path: f.path });
    assert.equal(waits.sighted('a', T0), T0);
    assert.equal(waits.sighted('a', T0 + 30_000), T0);
    assert.equal(waits.sighted('a', T0 + 4 * 60_000), T0);
    assert.equal(waits.sighted('b', T0 + 60_000), T0 + 60_000, 'each target its own');
  } finally {
    f.done();
  }
});

test('#476: a restart reads the waits back: the count goes on', () => {
  const f = tempFile();
  try {
    const before = createTargetWaits({ path: f.path });
    before.sighted('a', T0);
    before.save();
    const after = createTargetWaits({ path: f.path });
    assert.equal(after.sighted('a', T0 + 90_000), T0, 'seen 90 s later, after a restart: the same wait');
  } finally {
    f.done();
  }
});

test('#476: a gap longer than WAIT_GAP_MS between two sightings starts the wait again (JagHelm was off: Prometheus may have restarted too)', () => {
  const f = tempFile();
  try {
    const waits = createTargetWaits({ path: f.path });
    waits.sighted('a', T0);
    assert.equal(waits.sighted('a', T0 + WAIT_GAP_MS), T0, 'at the gap: goes on');
    const later = T0 + WAIT_GAP_MS + WAIT_GAP_MS + 1;
    assert.equal(waits.sighted('a', later), later, 'past it: starts again');
    assert.equal(waits.sighted('b', T0), T0);
    assert.equal(waits.sighted('b', T0 + 20 * 60_000, 30 * 60_000), T0, "a longer gap given (the target's own limit) goes on");
  } finally {
    f.done();
  }
});

test('#476: retain forgets every target but those still waiting, and that is written', () => {
  const f = tempFile();
  try {
    const waits = createTargetWaits({ path: f.path });
    waits.sighted('a', T0);
    waits.sighted('b', T0);
    waits.retain(new Set(['b']));
    waits.save();
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(f.path, 'utf8'))), ['b']);
    waits.retain(new Set());
    waits.save();
    assert.deepEqual(JSON.parse(readFileSync(f.path, 'utf8')), {});
    assert.equal(createTargetWaits({ path: f.path }).sighted('a', T0 + 1000), T0 + 1000, 'forgotten: a new wait');
  } finally {
    f.done();
  }
});

test('#476: a target that keeps waiting is written when its wait begins and then at most once a minute, not every cycle', () => {
  const f = tempFile();
  const written = [];
  try {
    const waits = createTargetWaits({ path: f.path, write: (path, data) => written.push(JSON.parse(data)) });
    waits.sighted('a', T0);
    waits.save();
    for (let i = 1; i < SEEN_STEP_MS / 30_000; i += 1) {
      waits.sighted('a', T0 + i * 30_000);
      waits.save();
    }
    assert.equal(written.length, 1, 'only the start, inside the first minute');
    waits.sighted('a', T0 + SEEN_STEP_MS);
    waits.save();
    assert.deepEqual(written, [{ a: { since: T0, seen: T0 } }, { a: { since: T0, seen: T0 + SEEN_STEP_MS } }]);
  } finally {
    f.done();
  }
});

test('#476: an unreadable or hand-broken file starts with no waits', () => {
  const f = tempFile();
  try {
    writeFileSync(f.path, '{ not json');
    assert.equal(createTargetWaits({ path: f.path }).sighted('a', T0), T0);
    writeFileSync(f.path, JSON.stringify({ a: { since: 'soon', seen: T0 }, b: { since: T0 - 5, seen: T0 } }));
    const waits = createTargetWaits({ path: f.path });
    assert.deepEqual(waits.entries(), { b: { since: T0 - 5, seen: T0 } });
  } finally {
    f.done();
  }
});

test('#476: a target is keyed by its scrape pool and URL, or by its labels when the list gives no URL', () => {
  assert.equal(targetKey({ scrapePool: 'node', scrapeUrl: 'http://vm103:9100/metrics' }), 'node http://vm103:9100/metrics');
  assert.equal(
    targetKey({ labels: { node: 'vm103', instance: 'vm103:9100' } }),
    targetKey({ labels: { instance: 'vm103:9100', node: 'vm103' } }),
    'labels in any order'
  );
});
