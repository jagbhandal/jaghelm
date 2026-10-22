/**
 * When each Prometheus target found waiting for its first scrape began waiting
 * (#476), kept in the data dir so a restart doesn't start the count again.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SEEN_STEP_MS, createTargetWaits, targetKey } from './targetWaits.js';

const T0 = 1_782_345_600_000;

function tempFile() {
  const dir = mkdtempSync(join(tmpdir(), 'jaghelm-waits-'));
  return { path: join(dir, 'prometheus-target-waits.json'), done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('#476: a wait keeps its start while it is seen, each target its own', () => {
  const f = tempFile();
  try {
    const waits = createTargetWaits({ path: f.path });
    assert.equal(waits.get('a'), undefined);
    waits.begin('a', T0);
    waits.touch('a', T0 + 30_000);
    waits.touch('a', T0 + 4 * 60_000);
    assert.deepEqual(waits.get('a'), { since: T0, seen: T0 + 4 * 60_000 });
    waits.begin('b', T0 + 60_000);
    assert.equal(waits.get('b').since, T0 + 60_000);
    waits.begin('a', T0 + 5 * 60_000); // started again
    assert.deepEqual(waits.get('a'), { since: T0 + 5 * 60_000, seen: T0 + 5 * 60_000 });
    waits.touch('c', T0); // no wait: nothing
    assert.equal(waits.get('c'), undefined);
  } finally {
    f.done();
  }
});

test('#476: a restart reads the waits back: the count goes on', () => {
  const f = tempFile();
  try {
    const before = createTargetWaits({ path: f.path });
    before.begin('a', T0);
    before.save();
    assert.deepEqual(createTargetWaits({ path: f.path }).get('a'), { since: T0, seen: T0 });
  } finally {
    f.done();
  }
});

test('#476: retain forgets every target but those still waiting, and that is written', () => {
  const f = tempFile();
  try {
    const waits = createTargetWaits({ path: f.path });
    waits.begin('a', T0);
    waits.begin('b', T0);
    waits.retain(new Set(['b']));
    waits.save();
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(f.path, 'utf8'))), ['b']);
    waits.retain(new Set());
    waits.save();
    assert.deepEqual(JSON.parse(readFileSync(f.path, 'utf8')), {});
    assert.equal(createTargetWaits({ path: f.path }).get('a'), undefined);
  } finally {
    f.done();
  }
});

test('#476: a target that keeps waiting is written when its wait begins and then at most once a minute, not every cycle', () => {
  const f = tempFile();
  const written = [];
  try {
    const waits = createTargetWaits({ path: f.path, write: (path, data) => written.push(JSON.parse(data)) });
    waits.begin('a', T0);
    waits.save();
    for (let i = 1; i < SEEN_STEP_MS / 30_000; i += 1) {
      waits.touch('a', T0 + i * 30_000);
      waits.save();
    }
    assert.equal(written.length, 1, 'only the start, inside the first minute');
    waits.touch('a', T0 + SEEN_STEP_MS);
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
    assert.deepEqual(createTargetWaits({ path: f.path }).entries(), {});
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
