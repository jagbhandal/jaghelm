import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  envKey, envHealth, heldBackSet, isTerminal, summarizeUpdateRun, summarizePruneRun,
} from './derive.js';

const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), 'utf8')).data;

test('envKey rejects unsafe names', () => {
  for (const bad of ['vm:103', '__proto__', '', 'x'.repeat(65), 'constructor', 'prototype']) {
    assert.equal(envKey({ name: bad }), null, bad);
  }
  assert.equal(envKey({ name: 'x'.repeat(64) }), 'x'.repeat(64));
  assert.equal(envKey({ name: 'pi-1' }), 'pi-1');
  assert.equal(envKey(null), null);
  assert.equal(envKey({ name: 5 }), null);
});

test('envHealth maps statuses', () => {
  assert.equal(envHealth({ status: 'online' }), 'up');
  assert.equal(envHealth({ status: 'standby' }), 'up');
  assert.equal(envHealth({ status: 'offline' }), 'down');
  assert.equal(envHealth({ status: 'error' }), 'down');
  assert.equal(envHealth({ status: 'pending' }), 'unknown');
  assert.equal(envHealth({}), 'unknown');
});

test('heldBackSet uses autoUpdateEnabled and checkOnly', () => {
  const c = fx('containers-has-update');
  assert.deepEqual(heldBackSet(c, { checkOnly: false }), [
    { name: 'immich-server', current: 'v1.130.0', latest: 'v1.131.0' },
  ]);
  assert.deepEqual(heldBackSet(c, { checkOnly: true }).map((x) => x.name), ['gitea', 'immich-server']);
  const none = [{ names: ['/a'], autoUpdateEnabled: false, updateInfo: { hasUpdate: false } }];
  assert.deepEqual(heldBackSet(none, { checkOnly: true }), []);
});

test('heldBackSet falls back to digest prefix', () => {
  const r = heldBackSet([{
    names: ['/z'], autoUpdateEnabled: false,
    updateInfo: { hasUpdate: true, currentDigest: 'sha256:' + 'a'.repeat(60), latestDigest: 'sha256:' + 'b'.repeat(60) },
  }], { checkOnly: false });
  assert.deepEqual(r, [{ name: 'z', current: 'sha256:' + 'a'.repeat(12), latest: 'sha256:' + 'b'.repeat(12) }]);
});

test('isTerminal', () => {
  for (const s of ['success', 'failed', 'cancelled']) assert.equal(isTerminal({ status: s }), true);
  for (const s of ['queued', 'running']) assert.equal(isTerminal({ status: s }), false);
});

test('summarizeUpdateRun windows history rows and splits them', () => {
  const hist = fx('updater-history');
  const acts = fx('activities-auto_update');
  const ok = summarizeUpdateRun(acts[2], hist);
  assert.deepEqual(ok.updated, [{ name: 'gitea', from: 'gitea/gitea:1.22.3', to: 'gitea/gitea:1.22.4' }]);
  assert.deepEqual(ok.failed, []);
  assert.equal(ok.cronStatus, 'success');
  assert.equal(ok.id, 'act-au-1');

  const failedRun = summarizeUpdateRun(acts[1], hist);
  assert.deepEqual(failedRun.failed, [{ name: 'nextcloud', error: 'pull access denied' }]);
  assert.equal(failedRun.cronStatus, 'success');
});

test('summarizeUpdateRun window end is endedAt + 60s, inclusive', () => {
  const act = { id: 'a', status: 'success', startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T00:01:00Z' };
  const row = (createdAt, name) => ({ createdAt, status: 'updated', resourceName: name, oldImageVersions: { main: 'o' }, newImageVersions: { main: 'n' } });
  const r = summarizeUpdateRun(act, [
    row('2025-12-31T23:59:59Z', 'before'), row('2026-01-01T00:00:00Z', 'start'),
    row('2026-01-01T00:02:00Z', 'edge'), row('2026-01-01T00:02:01Z', 'after'),
  ]);
  assert.deepEqual(r.updated.map((x) => x.name), ['start', 'edge']);
  const noEnd = summarizeUpdateRun({ id: 'b', status: 'success', startedAt: '2026-01-01T00:00:00Z', endedAt: null }, [
    row('2026-01-01T00:01:00Z', 'in'), row('2026-01-01T00:01:01Z', 'out'),
  ]);
  assert.deepEqual(noEnd.updated.map((x) => x.name), ['in']);
});

test('summarizeUpdateRun caps row error at 200 and decides cronStatus', () => {
  const act = { id: 'f', status: 'failed', startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T00:00:10Z', error: 'boom' };
  const bad = { createdAt: '2026-01-01T00:00:05Z', status: 'failed', resourceName: 'x', error: 'e'.repeat(500) };
  const one = summarizeUpdateRun(act, [bad]);
  assert.equal(one.failed[0].error.length, 200);
  assert.equal(one.cronStatus, 'success');
  const zero = summarizeUpdateRun(act, []);
  assert.equal(zero.cronStatus, 'failure');
  assert.equal(zero.error, 'boom');
  assert.equal(summarizeUpdateRun({ ...act, status: 'cancelled' }, []).cronStatus, 'success');
});

test('summarizePruneRun', () => {
  const [ok, cancelled] = fx('activities-system_prune');
  assert.deepEqual(summarizePruneRun(ok), { id: 'act-sp-2', cronStatus: 'success', error: '' });
  assert.equal(summarizePruneRun(cancelled).cronStatus, 'success');
  const f = summarizePruneRun({ id: 'p', status: 'failed', error: 'x'.repeat(3000) });
  assert.equal(f.cronStatus, 'failure');
  assert.equal(f.error.length, 2048);
});
