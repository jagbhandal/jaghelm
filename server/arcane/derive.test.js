import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  envKey, envHealth, heldBackSet, isTerminal, summarizeUpdateRun, summarizePruneRun,
  pendingMap, heldBackTransitions, runOrigin, containerState, nextUpdateState,
  checkOrigin, summarizeCheckRun,
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
  const c = fx('containers');
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

test('pendingMap holds every container with an update, any tier', () => {
  const m = pendingMap(fx('containers'));
  assert.deepEqual([...m], [['gitea', '1.22.4'], ['immich-server', 'v1.131.0']]);
  const digest = pendingMap([
    { names: ['/z'], updateInfo: { hasUpdate: true, latestDigest: 'sha256:' + 'b'.repeat(60) } },
    { names: ['/n'], updateInfo: { hasUpdate: false } },
    { names: [], updateInfo: { hasUpdate: true, latestVersion: 'x' } },
  ]);
  assert.deepEqual([...digest], [['z', 'sha256:' + 'b'.repeat(12)]]);
});

test('heldBackTransitions: only image news is held back, only a resolved update is caught up', () => {
  const e = (name, latest) => ({ name, current: 'c', latest });
  const prevPending = new Map([['label-added', 'v2'], ['newer', 'v2'], ['label-removed', 'v2']]);
  const nextPending = new Map([['label-added', 'v2'], ['newer', 'v3'], ['label-removed', 'v2'], ['fresh', 'v1']]);
  const r = heldBackTransitions({
    newlyHeldBack: [e('label-added', 'v2'), e('newer', 'v3'), e('fresh', 'v1')],
    cleared: [e('label-removed', 'v2'), e('updated', 'v2')],
    prevPending,
    nextPending,
  });
  assert.deepEqual(r.heldBack.map((x) => x.name), ['newer', 'fresh']);
  assert.deepEqual(r.caughtUp.map((x) => x.name), ['updated']);
  // No pending map yet (state file from before it existed): held back as before.
  const old = heldBackTransitions({
    newlyHeldBack: [e('label-added', 'v2')], cleared: [], prevPending: null, nextPending,
  });
  assert.deepEqual(old.heldBack.map((x) => x.name), ['label-added']);
});

test('runOrigin: only a job run the scheduler started makes a run scheduled', () => {
  const jobs = fx('activities-job_run');
  const [au3, au2, au1] = fx('activities-auto_update');
  const [sp2, sp1] = fx('activities-system_prune');
  assert.equal(runOrigin(sp2, jobs), 'scheduled');
  assert.equal(runOrigin(au1, jobs), 'scheduled');
  assert.equal(runOrigin(au2, jobs), 'scheduled');
  assert.equal(runOrigin(sp1, jobs), 'manual', 'Prune button: no job run at all');
  // The job run is still going (no domain activity recorded yet): judge it later.
  assert.equal(runOrigin({ ...au3, status: 'success' }, jobs), 'pending');

  const job = (trigger, domainActivityId, extra = {}) => ({
    id: `j-${trigger}`, type: 'job_run', status: 'success', batchId: 'b1',
    metadata: { trigger, domainActivityId }, ...extra,
  });
  const run = { id: 'd1', type: 'system_prune', status: 'success', batchId: 'b1' };
  assert.equal(runOrigin(run, [job('recovery', 'd1')]), 'scheduled', 'a missed slot caught up');
  assert.equal(runOrigin(run, [job('manual', 'd1')]), 'manual', 'Jobs page "Run now"');
  assert.equal(runOrigin(run, [job('remote', 'd1')]), 'manual');
  // A finished job run that points at another activity (a retried attempt): not this one.
  assert.equal(runOrigin(run, [job('scheduled', 'd2')]), 'manual');
  assert.equal(runOrigin(run, [job('scheduled', 'd1', { type: 'auto_update' })]), 'manual');
  assert.equal(runOrigin(run, [job('scheduled', '', { status: 'running' })]), 'pending');
  assert.equal(runOrigin({ ...run, batchId: undefined }, [job('scheduled', '', { status: 'running' })]), 'manual');
  assert.equal(runOrigin(run, []), 'manual');
  assert.equal(runOrigin(run, [{ type: 'job_run', metadata: 'junk' }, null]), 'manual');
});

test('summarizeUpdateRun window ends at the next run start (exclusive) when that is sooner', () => {
  const act = { id: 'a', status: 'success', startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T00:00:30Z' };
  const row = (createdAt, name) => ({ createdAt, status: 'updated', resourceName: name });
  const rows = [row('2026-01-01T00:00:29Z', 'mine'), row('2026-01-01T00:00:31Z', 'next'), row('2026-01-01T00:00:59Z', 'next2')];
  const until = Date.parse('2026-01-01T00:00:31Z');
  assert.deepEqual(summarizeUpdateRun(act, rows, { until }).updated.map((x) => x.name), ['mine']);
  // A later next run leaves the endedAt + 60 s grace in charge.
  const late = Date.parse('2026-01-01T00:05:00Z');
  assert.deepEqual(summarizeUpdateRun(act, rows, { until: late }).updated.map((x) => x.name), ['mine', 'next', 'next2']);
  assert.deepEqual(summarizeUpdateRun(act, rows).updated.map((x) => x.name), ['mine', 'next', 'next2']);
});

test('containerState: pending, up to date, or unknown (check errored or never ran)', () => {
  const states = fx('containers').map((c) => [c.names[0], containerState(c)]);
  assert.deepEqual(states, [
    ['/immich-server', 'pending'],
    ['/gitea', 'pending'],
    ['/redis', 'current'],
    ['/nextcloud', 'unknown'],
    ['/whoami', 'unknown'],
  ]);
  assert.equal(containerState({ updateInfo: null }), 'unknown');
  assert.equal(containerState({ updateInfo: { hasUpdate: true, error: 'x' } }), 'pending');
});

test('nextUpdateState carries held-back and pending entries through an unknown state', () => {
  const c = (name, info, auto = false) => ({ names: [`/${name}`], autoUpdateEnabled: auto, updateInfo: info });
  const prevHeld = [
    { name: 'err', current: 'c1', latest: 'l1' },
    { name: 'nocheck', current: 'c2', latest: 'l2' },
    { name: 'fixed', current: 'c3', latest: 'l3' },
    { name: 'gone', current: 'c4', latest: 'l4' },
  ];
  const prevPending = new Map([['err', 'l1'], ['nocheck', 'l2'], ['fixed', 'l3'], ['gone', 'l4'], ['autoerr', 'l5']]);
  const r = nextUpdateState({
    containers: [
      c('err', { hasUpdate: false, error: 'registry 503' }),
      c('nocheck', undefined),
      c('fixed', { hasUpdate: false, error: '' }),
      c('autoerr', { hasUpdate: false, error: 'timeout' }, true),
      c('new', { hasUpdate: true, currentVersion: 'a', latestVersion: 'b' }),
    ],
    checkOnly: false,
    prevHeld,
    prevPending,
  });
  assert.deepEqual(r.held, [
    { name: 'err', current: 'c1', latest: 'l1' },
    { name: 'new', current: 'a', latest: 'b' },
    { name: 'nocheck', current: 'c2', latest: 'l2' },
  ]);
  assert.deepEqual([...r.pending], [['autoerr', 'l5'], ['err', 'l1'], ['new', 'b'], ['nocheck', 'l2']]);
  // Without a previous pending map nothing is carried for pending; held-back still is.
  const fresh = nextUpdateState({ containers: [c('err', { error: 'x' })], checkOnly: true, prevHeld, prevPending: null });
  assert.deepEqual(fresh.held.map((e) => e.name), ['err']);
  assert.deepEqual([...fresh.pending], []);
});

test('checkOrigin: a bound check is scheduled unless a job run says otherwise', () => {
  const B = '0f3c1a2e-5b6d-4e7f-8a9b-0000000000c1';
  const bound = { id: `image-check-${B}-1`, type: 'image_update_check', batchId: B };
  const jr = (trigger, extra = {}) => ({
    id: 'jr', type: 'job_run', status: 'success', batchId: 'other', metadata: { trigger }, ...extra,
  });
  // Scheduled and watcher runs of image-polling have no job_run at all.
  assert.equal(checkOrigin(bound, []), 'scheduled');
  assert.equal(checkOrigin(bound, undefined), 'scheduled');
  // An unrelated job run (another batch, another activity) changes nothing.
  assert.equal(checkOrigin(bound, [jr('manual', { metadata: { trigger: 'manual', domainActivityId: 'x' } })]), 'scheduled');
  // Jobs-page "Run now", here or delivered to an agent: a job run with this batch, trigger manual.
  assert.equal(checkOrigin(bound, [jr('manual', { batchId: B, status: 'running' })]), 'manual');
  assert.equal(checkOrigin(bound, [jr('manual', { metadata: { trigger: 'manual', domainActivityId: bound.id } })]), 'manual');
  // A job run naming a scheduler trigger keeps it scheduled.
  assert.equal(checkOrigin(bound, [jr('scheduled', { batchId: B })]), 'scheduled');
  assert.equal(checkOrigin(bound, [jr('recovery', { batchId: B })]), 'scheduled');
  // Only job_run rows count.
  assert.equal(checkOrigin(bound, [{ ...jr('manual', { batchId: B }), type: 'auto_update' }]), 'scheduled');
});

test('checkOrigin: an unbound check (Check Updates button, API) is manual', () => {
  const B = '0f3c1a2e-5b6d-4e7f-8a9b-0000000000c2';
  // Unbound: image-check-<uuid>, no batchId.
  assert.equal(checkOrigin({ id: 'image-check-01a00000-0000-7000-8000-0000000000b1' }, []), 'manual');
  // A batchId that is not the one in the id, or an id of another shape.
  assert.equal(checkOrigin({ id: `image-check-${B}-1`, batchId: 'client-batch' }, []), 'manual');
  assert.equal(checkOrigin({ id: `image-check-${B}`, batchId: B }, []), 'manual');
  assert.equal(checkOrigin({ id: `auto-update-${B}-1`, batchId: B }, []), 'manual');
  assert.equal(checkOrigin({}, []), 'manual');
  assert.equal(checkOrigin(null, []), 'manual');
});

test('summarizeCheckRun: a failure only when nothing came of the check', () => {
  const sum = (n, m) => `Image update check completed: ${n} checked, ${m} errors`;
  const ok = { cronStatus: 'success', error: '' };
  const pick = ({ cronStatus, error }) => ({ cronStatus, error });
  assert.deepEqual(pick(summarizeCheckRun({ id: 'a', status: 'success', latestMessage: sum(39, 0) })), ok);
  assert.deepEqual(pick(summarizeCheckRun({ id: 'a', status: 'cancelled' })), ok);
  // Some images errored: Arcane marks the check failed, but it ran.
  assert.deepEqual(pick(summarizeCheckRun({ id: 'a', status: 'failed', latestMessage: sum(34, 2), error: sum(34, 2) })), ok);
  assert.deepEqual(pick(summarizeCheckRun({ id: 'a', status: 'failed', error: `${sum(5, 0)}, 1 tag policy errors` })), ok);
  // Every image errored, or the check failed before its summary.
  assert.deepEqual(pick(summarizeCheckRun({ id: 'a', status: 'failed', latestMessage: sum(3, 3), error: sum(3, 3) })), {
    cronStatus: 'failure', error: sum(3, 3),
  });
  assert.deepEqual(pick(summarizeCheckRun({ id: 'a', status: 'failed', error: 'Docker unavailable' })), {
    cronStatus: 'failure', error: 'Docker unavailable',
  });
  assert.deepEqual(pick(summarizeCheckRun({ id: 'a', status: 'failed' })), { cronStatus: 'failure', error: '' });
  assert.equal(summarizeCheckRun({ id: 'a', status: 'failed', error: 'e'.repeat(5000) }).error.length, 2048);
  assert.equal(summarizeCheckRun({ id: 'x', status: 'success' }).id, 'x');
});
