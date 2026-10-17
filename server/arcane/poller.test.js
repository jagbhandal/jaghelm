// server/arcane/poller.test.js
// Stub client/dispatch/recordRun; REAL stateStore + heldBackStore on mkdtemp
// paths, so the restart test reads back what an earlier poller wrote.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createArcanePoller } from './poller.js';
import { createArcaneStateStore } from './stateStore.js';
import { ArcaneError } from './client.js';
import { createHeldBackStore } from '../watchtower/heldBackStore.js';

const fxRaw = (n) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), 'utf8'));
const fx = (n) => {
  const body = fxRaw(n);
  return 'success' in body ? body.data : body;
};
const clone = (v) => structuredClone(v);
const silent = { debug() {}, info() {}, warn() {}, error() {} };

// Fixture environments: vm-103 (id "0", online), vm-101 ("1", online),
// pi-1 ("2", standby = up), pi-2 ("3", offline).
const VM103 = '0';
const VM101 = '1';
const PI1 = '2';
const PI2 = '3';

/** A fake Arcane manager: mutable per-environment data + injectable failures. */
function world() {
  const s = {
    envs: fx('environments'),
    containers: { [VM103]: fx('containers') },
    activities: {
      [`${VM103}:auto_update`]: fx('activities-auto_update'),
      [`${VM103}:system_prune`]: fx('activities-system_prune'),
      [`${VM103}:job_run`]: fx('activities-job_run'),
    },
    history: { [VM103]: fx('updater-history') },
    version: fx('app-version'),
    fail: {}, // call key -> Error to throw
    calls: [],
  };
  // The fixture's pi-2 is offline. Default it to online so its agent push
  // stays out of every data test; connectivity tests take it down explicitly.
  s.envs.find((e) => e.id === PI2).status = 'online';
  const hit = (key) => {
    s.calls.push(key);
    if (s.fail[key]) throw s.fail[key];
  };
  const client = {
    async listEnvironments() {
      hit('environments');
      return clone(s.envs);
    },
    async listContainers(id) {
      hit(`containers:${id}`);
      return clone(s.containers[id] ?? []);
    },
    async listActivities(id, type, limit, start = 0) {
      hit(`activities:${id}:${type}`);
      const all = clone(s.activities[`${id}:${type}`] ?? []);
      return typeof limit === 'number' ? all.slice(start, start + limit) : all;
    },
    async updaterHistory(id) {
      hit(`history:${id}`);
      return clone(s.history[id] ?? []);
    },
    async appVersion() {
      hit('app-version');
      return clone(s.version);
    },
  };
  return { s, client };
}

const PUSH_STORE = { name: 'push-store' };
const FCM = { name: 'fcm' };

function setup(t, { dir, w = world(), checkOnlyEnvs = new Set(), dispatch, onRun } = {}) {
  if (!dir) {
    dir = mkdtempSync(join(tmpdir(), 'arcane-poller-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
  }
  const statePath = join(dir, 'arcane-state.json');
  const heldPath = join(dir, 'arcane-held-back.json');
  const stateStore = createArcaneStateStore({ path: statePath });
  const heldBackStore = createHeldBackStore({ path: heldPath });
  const runs = [];
  const dispatched = [];
  const poller = createArcanePoller({
    client: w.client,
    stateStore,
    heldBackStore,
    recordRun: (report) => {
      runs.push(report);
      if (onRun) onRun(report);
    },
    dispatch:
      dispatch ||
      (async (events, deps) => {
        dispatched.push({ events, deps });
      }),
    pushStore: PUSH_STORE,
    fcm: FCM,
    checkOnlyEnvs,
    logger: silent,
  });
  const files = () => ({
    state: existsSync(statePath) ? readFileSync(statePath, 'utf8') : null,
    held: existsSync(heldPath) ? readFileSync(heldPath, 'utf8') : null,
  });
  return { dir, w, s: w.s, poller, stateStore, heldBackStore, runs, dispatched, files, statePath };
}

const ctr = (name, { auto = false, current = 'v1', latest = 'v2' } = {}) => ({
  id: `c-${name}`,
  names: [`/${name}`],
  image: `${name}:latest`,
  autoUpdateEnabled: auto,
  updateInfo: {
    hasUpdate: true,
    currentVersion: current,
    latestVersion: latest,
    currentDigest: 'sha256:aaaa',
    latestDigest: 'sha256:bbbb',
  },
});
const act = (id, type, status, startedAt, endedAt = startedAt, extra = {}) => ({
  id,
  type,
  status,
  startedAt,
  endedAt,
  error: '',
  ...extra,
});
const row = (createdAt, name, status, extra = {}) => ({
  id: `uh-${name}-${createdAt}`,
  createdAt,
  resourceName: name,
  status,
  oldImageVersions: { main: `${name}:old` },
  newImageVersions: { main: `${name}:new` },
  error: '',
  ...extra,
});
/**
 * Make `a` a run Arcane's scheduler started: give it a batch id and add its finished
 * job_run summary (newest first, as Arcane lists them) linking back to it.
 */
const scheduled = (s, envId, a, trigger = 'scheduled') => {
  a.batchId = `run-${a.id}`;
  const key = `${envId}:job_run`;
  s.activities[key] = [
    {
      id: `job-${a.id}`,
      type: 'job_run',
      status: 'success',
      batchId: a.batchId,
      startedAt: a.startedAt,
      endedAt: a.endedAt,
      metadata: { trigger, runId: a.batchId, domainActivityId: a.id },
    },
    ...(s.activities[key] ?? []),
  ];
  return a;
};
const setStatus = (s, id, status) => {
  s.envs.find((e) => e.id === id).status = status;
};
const names = (list) => list.map((e) => e.name);

test('first poll is a silent baseline', async (t) => {
  const h = setup(t);
  h.s.containers[VM101] = [ctr('code-server')];
  h.s.containers[PI1] = [ctr('adguard', { auto: true })];

  const r = await h.poller.pollOnce();
  assert.deepEqual(r, { events: [], errors: [] });
  assert.equal(h.runs.length, 0);
  assert.equal(h.dispatched.length, 0);

  // The backlog is stored as the baseline, not announced.
  assert.deepEqual(names(h.heldBackStore.getNode('vm-103')), ['immich-server']);
  assert.deepEqual(names(h.heldBackStore.getNode('vm-101')), ['code-server']);
  assert.deepEqual(h.heldBackStore.getNode('pi-1'), []);
  for (const id of ['act-au-1', 'act-au-2', 'act-sp-1', 'act-sp-2']) {
    assert.equal(h.stateStore.hasActivity('vm-103', id), true, id);
  }
  assert.equal(h.stateStore.hasActivity('vm-103', 'act-au-3'), false, 'running: not seen yet');
  assert.equal(h.s.calls.includes(`history:${VM103}`), false, 'unknown env needs no history');
  assert.equal(h.s.calls.includes(`activities:${VM103}:job_run`), false, 'nor job runs');
  for (const name of ['vm-103', 'vm-101', 'pi-1', 'pi-2']) {
    assert.equal(h.stateStore.isKnownEnv(name), true, name);
    assert.deepEqual(h.stateStore.getAgent(name), { downPolls: 0, alerted: false }, name);
  }

  const again = await h.poller.pollOnce();
  assert.deepEqual(again, { events: [], errors: [] });
  assert.equal(h.runs.length, 0);
});

test('new held-back container pushes once, then is silent', async (t) => {
  const h = setup(t);
  await h.poller.pollOnce();
  h.s.containers[VM103].push(ctr('homeassistant', { current: '2026.10.1', latest: '2026.10.2' }));

  const r = await h.poller.pollOnce();
  assert.deepEqual(r.events, [
    {
      type: 'arcane_heldback',
      id: 'arcane:vm-103:heldback',
      node: 'vm-103',
      title: 'Updates · vm-103',
      body: '1 update held back: homeassistant',
      severity: 'info',
    },
  ]);
  assert.equal(h.dispatched.length, 1);
  assert.deepEqual(h.dispatched[0].events, r.events);
  assert.equal(h.dispatched[0].deps.store, PUSH_STORE);
  assert.equal(h.dispatched[0].deps.fcm, FCM);

  assert.deepEqual((await h.poller.pollOnce()).events, []);
  assert.equal(h.dispatched.length, 1);

  // A newer image dropping on an already-held-back container is a new transition.
  h.s.containers[VM103].find((c) => c.names[0] === '/homeassistant').updateInfo.latestVersion =
    '2026.10.3';
  const newer = await h.poller.pollOnce();
  assert.deepEqual(
    newer.events.map((e) => e.body),
    ['1 update held back: homeassistant']
  );
  assert.deepEqual((await h.poller.pollOnce()).events, []);
  assert.equal(h.runs.length, 0);
});

test('container leaving the held-back set pushes caught up', async (t) => {
  const h = setup(t);
  await h.poller.pollOnce();
  h.s.containers[VM103] = h.s.containers[VM103].filter((c) => c.names[0] !== '/immich-server');

  const r = await h.poller.pollOnce();
  assert.deepEqual(r.events, [
    {
      type: 'arcane_cleared',
      id: 'arcane:vm-103:cleared',
      node: 'vm-103',
      title: 'Updates · vm-103',
      body: '1 caught up: immich-server',
      severity: 'info',
    },
  ]);
  assert.deepEqual(h.heldBackStore.getNode('vm-103'), []);
  assert.deepEqual((await h.poller.pollOnce()).events, []);
});

test('check-only environment treats every pending update as held back', async (t) => {
  const h = setup(t, { checkOnlyEnvs: new Set(['pi-1']) });
  // Same rows on both: gitea has autoUpdateEnabled true, immich-server false.
  h.s.containers[PI1] = fx('containers');
  h.s.containers[VM101] = fx('containers');
  await h.poller.pollOnce();
  assert.deepEqual(names(h.heldBackStore.getNode('pi-1')), ['gitea', 'immich-server']);
  assert.deepEqual(names(h.heldBackStore.getNode('vm-101')), ['immich-server']);

  h.s.containers[PI1].push(ctr('nginx', { auto: true }));
  h.s.containers[VM101].push(ctr('nginx', { auto: true }));
  const r = await h.poller.pollOnce();
  assert.deepEqual(r.events, [
    {
      type: 'arcane_heldback',
      id: 'arcane:pi-1:heldback',
      node: 'pi-1',
      title: 'Updates · pi-1',
      body: '1 update held back: nginx',
      severity: 'info',
    },
  ]);
});

test('completed update run with one updated and one failed container pushes one warning event and records success', async (t) => {
  const h = setup(t);
  await h.poller.pollOnce();
  h.s.activities[`${VM103}:auto_update`].unshift(
    scheduled(
      h.s,
      VM103,
      act('act-au-5', 'auto_update', 'success', '2026-10-18T03:00:00Z', '2026-10-18T03:05:00Z')
    ),
    // Older, cancelled, nothing in its window: recorded, but silent.
    scheduled(
      h.s,
      VM103,
      act('act-au-4', 'auto_update', 'cancelled', '2026-10-17T12:00:00Z', '2026-10-17T12:00:10Z')
    )
  );
  h.s.activities[`${VM103}:system_prune`].unshift(
    scheduled(
      h.s,
      VM103,
      act('act-sp-3', 'system_prune', 'success', '2026-10-18T04:00:00Z', '2026-10-18T04:00:30Z')
    )
  );
  h.s.history[VM103].unshift(
    row('2026-10-18T03:03:00Z', 'redis', 'up_to_date'),
    row('2026-10-18T03:02:00Z', 'nextcloud', 'failed', { error: 'pull access denied' }),
    row('2026-10-18T03:01:00Z', 'gitea', 'updated')
  );

  const r = await h.poller.pollOnce();
  assert.deepEqual(r.events, [
    {
      type: 'arcane_update',
      id: 'arcane:vm-103:update',
      node: 'vm-103',
      title: 'Updates · vm-103',
      body: '1 updated: gitea · 1 failed: nextcloud',
      severity: 'warning',
    },
  ]);
  const ok = (job) => ({ job, node: 'vm-103', status: 'success', expected_every_seconds: 86400 });
  // Oldest first within a type; auto_update before system_prune.
  assert.deepEqual(h.runs, [ok('arcane-update'), ok('arcane-update'), ok('arcane-prune')]);
  assert.equal(h.s.calls.filter((c) => c === `history:${VM103}`).length, 1, 'history at most once');

  const again = await h.poller.pollOnce();
  assert.deepEqual(again.events, []);
  assert.equal(h.runs.length, 3);
  assert.equal(
    h.s.calls.filter((c) => c === `history:${VM103}`).length,
    1,
    'nothing new: no fetch'
  );
});

test('failed run with no container rows records failure and pushes nothing', async (t) => {
  const seenAtRun = [];
  const idFor = { 'arcane-update': 'act-au-4', 'arcane-prune': 'act-sp-3' };
  const h = setup(t, {
    onRun: (r) => seenAtRun.push(h.stateStore.hasActivity('vm-103', idFor[r.job])),
  });
  await h.poller.pollOnce();
  h.s.activities[`${VM103}:auto_update`].unshift(
    scheduled(
      h.s,
      VM103,
      act('act-au-4', 'auto_update', 'failed', '2026-10-18T03:00:00Z', '2026-10-18T03:00:20Z', {
        error: 'registry unreachable',
      })
    )
  );
  h.s.activities[`${VM103}:system_prune`].unshift(
    scheduled(
      h.s,
      VM103,
      act('act-sp-3', 'system_prune', 'failed', '2026-10-18T04:00:00Z', '2026-10-18T04:00:05Z', {
        error: 'docker daemon busy',
      })
    )
  );
  // An up_to_date row in the window is not a per-container result.
  h.s.history[VM103].unshift(row('2026-10-18T03:00:10Z', 'redis', 'up_to_date'));

  const r = await h.poller.pollOnce();
  assert.deepEqual(r, { events: [], errors: [] });
  assert.equal(h.dispatched.length, 0);
  assert.deepEqual(h.runs, [
    {
      job: 'arcane-update',
      node: 'vm-103',
      status: 'failure',
      error: 'registry unreachable',
      expected_every_seconds: 86400,
    },
    {
      job: 'arcane-prune',
      node: 'vm-103',
      status: 'failure',
      error: 'docker daemon busy',
      expected_every_seconds: 86400,
    },
  ]);
  // Marked seen before its cron run is written: at most one run even across a crash.
  assert.deepEqual(seenAtRun, [true, true]);
  await h.poller.pollOnce();
  assert.equal(h.runs.length, 2);
});

test('running activity is processed only after it becomes terminal', async (t) => {
  const h = setup(t);
  await h.poller.pollOnce(); // act-au-3 is still running in the fixture
  h.s.history[VM103].unshift(row('2026-10-17T03:04:00Z', 'gitea', 'updated'));
  // A terminal prune without a parseable startedAt is skipped, not marked seen.
  h.s.activities[`${VM103}:system_prune`].unshift(
    scheduled(h.s, VM103, act('act-sp-9', 'system_prune', 'success', null, '2026-10-17T05:00:00Z'))
  );

  let r = await h.poller.pollOnce();
  assert.deepEqual(r, { events: [], errors: [] });
  assert.equal(h.runs.length, 0);
  assert.equal(h.stateStore.hasActivity('vm-103', 'act-au-3'), false);
  assert.equal(h.stateStore.hasActivity('vm-103', 'act-sp-9'), false);
  assert.equal(h.s.calls.includes(`history:${VM103}`), false);

  const running = h.s.activities[`${VM103}:auto_update`].find((a) => a.id === 'act-au-3');
  running.status = 'success';
  running.endedAt = '2026-10-17T03:10:00Z';
  // Its scheduled job run finishes too and records the activity it ran.
  const job = h.s.activities[`${VM103}:job_run`].find((j) => j.id === 'job-au-3');
  job.status = 'success';
  job.metadata.domainActivityId = 'act-au-3';
  h.s.activities[`${VM103}:system_prune`][0].startedAt = '2026-10-17T04:59:00Z';

  r = await h.poller.pollOnce();
  assert.deepEqual(r.events, [
    {
      type: 'arcane_update',
      id: 'arcane:vm-103:update',
      node: 'vm-103',
      title: 'Updates · vm-103',
      body: '1 updated: gitea',
      severity: 'info',
    },
  ]);
  assert.deepEqual(
    h.runs.map((x) => `${x.job}:${x.status}`),
    ['arcane-update:success', 'arcane-prune:success']
  );

  r = await h.poller.pollOnce();
  assert.deepEqual(r.events, []);
  assert.equal(h.runs.length, 2);
});

test('agent offline needs two consecutive down polls; recovery pushes once', async (t) => {
  const h = setup(t);
  setStatus(h.s, PI2, 'offline'); // down from first sight, for the whole test
  await h.poller.pollOnce(); // vm-101 known while up
  const polls = [];
  const poll = async (status) => {
    setStatus(h.s, VM101, status);
    const r = await h.poller.pollOnce();
    polls.push(r.events);
    return r.events.filter((e) => e.node === 'vm-101');
  };

  assert.deepEqual(await poll('offline'), []);
  assert.deepEqual(h.stateStore.getAgent('vm-101'), { downPolls: 1, alerted: false });
  assert.equal(h.s.calls.includes(`containers:${VM101}`), true);
  const fetchesBefore = h.s.calls.filter((c) => c === `containers:${VM101}`).length;
  assert.deepEqual(await poll('online'), [], 'up resets the streak');
  assert.deepEqual(h.stateStore.getAgent('vm-101'), { downPolls: 0, alerted: false });
  assert.deepEqual(await poll('offline'), []);
  assert.deepEqual(await poll('pending'), [], 'unknown health changes nothing');
  assert.deepEqual(h.stateStore.getAgent('vm-101'), { downPolls: 1, alerted: false });
  assert.deepEqual(await poll('error'), [
    {
      type: 'arcane_agent_offline',
      id: 'arcane:vm-101:agent',
      node: 'vm-101',
      title: 'Arcane · vm-101',
      body: 'Agent disconnected; Arcane cannot manage vm-101',
      severity: 'warning',
    },
  ]);
  assert.deepEqual(h.stateStore.getAgent('vm-101'), { downPolls: 2, alerted: true });
  assert.deepEqual(await poll('offline'), []);
  // A down (or unknown) environment is never fetched.
  assert.equal(h.s.calls.filter((c) => c === `containers:${VM101}`).length, fetchesBefore + 1);

  assert.deepEqual(await poll('standby'), [
    {
      type: 'arcane_agent_recovered',
      id: 'arcane:vm-101:agent',
      node: 'vm-101',
      title: 'Arcane · vm-101',
      body: 'Agent reconnected',
      severity: 'info',
    },
  ]);
  assert.deepEqual(h.stateStore.getAgent('vm-101'), { downPolls: 0, alerted: false });
  assert.deepEqual(await poll('online'), []);
  // pi-2, offline since first sight, alerted exactly once: on poll 2.
  const pi2 = polls.flat().filter((e) => e.node === 'pi-2');
  assert.deepEqual(
    pi2.map((e) => e.type),
    ['arcane_agent_offline']
  );
  assert.equal(polls[0].includes(pi2[0]), true);
});

test('environment down at first sight alerts on the second poll and recovers once', async (t) => {
  const h = setup(t);
  setStatus(h.s, PI2, 'offline');
  h.s.containers[PI2] = [ctr('adguard')];
  h.s.activities[`${PI2}:auto_update`] = [
    act('act-p-1', 'auto_update', 'success', '2026-10-16T03:00:00Z', '2026-10-16T03:01:00Z'),
  ];
  h.s.history[PI2] = [row('2026-10-16T03:00:30Z', 'adguard', 'failed')];
  const pi2 = async () => (await h.poller.pollOnce()).events.filter((e) => e.node === 'pi-2');

  assert.deepEqual(await pi2(), []);
  assert.deepEqual(h.stateStore.getAgent('pi-2'), { downPolls: 1, alerted: false });
  assert.equal(h.stateStore.isKnownEnv('pi-2'), false, 'no data baseline while down');
  assert.deepEqual(await pi2(), [
    {
      type: 'arcane_agent_offline',
      id: 'arcane:pi-2:agent',
      node: 'pi-2',
      title: 'Arcane · pi-2',
      body: 'Agent disconnected; Arcane cannot manage pi-2',
      severity: 'warning',
    },
  ]);
  assert.deepEqual(await pi2(), []);
  assert.equal(
    h.s.calls.some((c) => c.includes(`:${PI2}`)),
    false,
    'down: never fetched'
  );

  // Back up: one recovery push, and the first data pass is still a silent baseline.
  setStatus(h.s, PI2, 'standby');
  assert.deepEqual(
    (await pi2()).map((e) => e.type),
    ['arcane_agent_recovered']
  );
  assert.equal(h.stateStore.isKnownEnv('pi-2'), true);
  assert.deepEqual(names(h.heldBackStore.getNode('pi-2')), ['adguard']);
  assert.equal(h.stateStore.hasActivity('pi-2', 'act-p-1'), true);
  assert.equal(h.runs.length, 0);
  assert.deepEqual(await pi2(), []);
});

test('an up poll with a fetch error still resets the down streak', async (t) => {
  const h = setup(t);
  await h.poller.pollOnce();
  const vm101 = async (status) => {
    setStatus(h.s, VM101, status);
    return (await h.poller.pollOnce()).events.filter((e) => e.node === 'vm-101');
  };

  assert.deepEqual(await vm101('offline'), []);
  h.s.fail[`containers:${VM101}`] = new ArcaneError(
    'Arcane HTTP 500 for /api/environments/1/containers',
    500
  );
  assert.deepEqual(await vm101('online'), []);
  assert.deepEqual(h.stateStore.getAgent('vm-101'), { downPolls: 0, alerted: false });
  delete h.s.fail[`containers:${VM101}`];
  assert.deepEqual(await vm101('offline'), [], 'down, up, down is not two consecutive downs');
  assert.deepEqual(h.stateStore.getAgent('vm-101'), { downPolls: 1, alerted: false });
  assert.deepEqual(
    (await vm101('offline')).map((e) => e.type),
    ['arcane_agent_offline']
  );
});

test('a restart after a first-sight-down alert stays silent', async (t) => {
  const a = setup(t);
  setStatus(a.s, PI2, 'offline');
  await a.poller.pollOnce();
  assert.deepEqual(
    (await a.poller.pollOnce()).events.map((e) => `${e.node}|${e.type}`),
    ['pi-2|arcane_agent_offline']
  );

  const b = setup(t, { dir: a.dir, w: a.w });
  assert.deepEqual(await b.poller.pollOnce(), { events: [], errors: [] });
  assert.deepEqual(await b.poller.pollOnce(), { events: [], errors: [] });
  assert.equal(b.dispatched.length, 0);

  setStatus(a.s, PI2, 'online');
  assert.deepEqual(
    (await b.poller.pollOnce()).events.map((e) => `${e.node}|${e.type}`),
    ['pi-2|arcane_agent_recovered']
  );
  assert.deepEqual((await b.poller.pollOnce()).events, []);
});

test('pollOnce leaves state untouched when the API fails', async (t) => {
  // (a) The environment list fails: network error, then a 401.
  for (const err of [
    new ArcaneError('Arcane request failed: connect ECONNREFUSED', null),
    new ArcaneError('Arcane HTTP 401 for /api/environments', 401),
  ]) {
    const h = setup(t);
    await h.poller.pollOnce();
    const before = h.files();
    h.s.containers[VM103] = []; // would clear immich-server
    setStatus(h.s, VM101, 'offline'); // would count a down poll
    h.s.fail.environments = err;
    const r = await h.poller.pollOnce();
    assert.deepEqual(r.events, []);
    assert.equal(r.errors.length, 1);
    assert.deepEqual(h.files(), before, 'state files unchanged');
    assert.deepEqual(h.stateStore.getAgent('vm-101'), { downPolls: 0, alerted: false });
    assert.equal(h.s.calls.at(-1), 'environments');
  }

  // (b) A containers 500 for one environment: only that environment is frozen.
  {
    const h = setup(t);
    await h.poller.pollOnce();
    h.s.containers[VM103] = []; // would clear immich-server
    h.s.activities[`${VM103}:auto_update`].unshift(
      act('act-au-4', 'auto_update', 'failed', '2026-10-18T03:00:00Z', '2026-10-18T03:00:20Z')
    );
    h.s.containers[VM101] = [ctr('code-server')]; // vm-101 still advances
    h.s.fail[`containers:${VM103}`] = new ArcaneError(
      'Arcane HTTP 500 for /api/environments/0/containers',
      500
    );
    const r = await h.poller.pollOnce();
    assert.deepEqual(
      r.events.map((e) => e.type),
      ['arcane_heldback']
    );
    assert.equal(r.events[0].node, 'vm-101');
    assert.equal(r.events.filter((e) => e.type === 'arcane_cleared').length, 0);
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /^vm-103: /);
    assert.deepEqual(names(h.heldBackStore.getNode('vm-103')), ['immich-server']);
    assert.equal(h.stateStore.hasActivity('vm-103', 'act-au-4'), false);
    assert.deepEqual(h.stateStore.getAgent('vm-103'), { downPolls: 0, alerted: false });
    assert.equal(h.runs.length, 0);
  }

  // (c) A 401 mid-poll, after containers succeeded, on an alerted agent that came back.
  {
    const h = setup(t);
    h.s.containers[VM101] = [ctr('code-server')];
    await h.poller.pollOnce();
    setStatus(h.s, VM101, 'offline');
    await h.poller.pollOnce();
    await h.poller.pollOnce();
    assert.deepEqual(h.stateStore.getAgent('vm-101'), { downPolls: 2, alerted: true });

    setStatus(h.s, VM101, 'online'); // would recover
    h.s.containers[VM101] = []; // would clear code-server
    h.s.fail[`activities:${VM101}:auto_update`] = new ArcaneError(
      'Arcane HTTP 401 for /api/environments/1/activities',
      401
    );
    const r = await h.poller.pollOnce();
    // Connectivity comes from the environment list alone, so recovery is not held back;
    // the data (held-back set) is frozen until its reads succeed.
    assert.deepEqual(
      r.events.map((e) => e.type),
      ['arcane_agent_recovered']
    );
    assert.equal(r.errors.length, 1);
    assert.deepEqual(h.stateStore.getAgent('vm-101'), { downPolls: 0, alerted: false });
    assert.deepEqual(names(h.heldBackStore.getNode('vm-101')), ['code-server']);

    // Once the API answers again, only the deferred data transition arrives, once.
    delete h.s.fail[`activities:${VM101}:auto_update`];
    const ok = await h.poller.pollOnce();
    assert.deepEqual(
      ok.events.map((e) => e.type),
      ['arcane_cleared']
    );
    assert.deepEqual((await h.poller.pollOnce()).events, []);
  }
});

test('renamed environment gets a silent baseline', async (t) => {
  const h = setup(t);
  h.s.containers[VM101] = [ctr('code-server')];
  await h.poller.pollOnce();

  // vm-101 is renamed, and it has a fresh backlog and a finished run.
  h.s.envs.find((e) => e.id === VM101).name = 'vm-101-new';
  h.s.containers[VM101].push(ctr('n8n'));
  h.s.activities[`${VM101}:auto_update`] = [
    act('act-r-1', 'auto_update', 'success', '2026-10-18T03:00:00Z', '2026-10-18T03:01:00Z'),
  ];
  h.s.history[VM101] = [row('2026-10-18T03:00:30Z', 'gitea', 'updated')];
  // pi-1 is renamed to an unsafe name: skipped without touching any store.
  h.s.envs.find((e) => e.id === PI1).name = 'pi:1';
  const callsBefore = h.s.calls.length;

  const r = await h.poller.pollOnce();
  assert.deepEqual(r, { events: [], errors: [] });
  assert.equal(h.runs.length, 0);
  assert.equal(h.stateStore.isKnownEnv('vm-101-new'), true);
  assert.deepEqual(names(h.heldBackStore.getNode('vm-101-new')), ['code-server', 'n8n']);
  assert.equal(h.stateStore.hasActivity('vm-101-new', 'act-r-1'), true);
  assert.equal(
    h.s.calls.slice(callsBefore).some((c) => c.includes(`:${PI1}`)),
    false
  );
  assert.equal(h.stateStore.isKnownEnv('pi:1'), false);
  assert.equal(h.stateStore.getAgent('pi:1'), null);
  assert.deepEqual(h.heldBackStore.getNode('pi:1'), []);
  assert.equal(h.files().state.includes('pi:1'), false);
  assert.equal(h.files().held.includes('pi:1'), false);

  // From here on the new name behaves like any known environment.
  h.s.containers[VM101].push(ctr('whoami'));
  const next = await h.poller.pollOnce();
  assert.deepEqual(
    next.events.map((e) => `${e.node}|${e.body}`),
    ['vm-101-new|1 update held back: whoami']
  );
});

test('environments sharing a name are all skipped', async (t) => {
  const h = setup(t);
  await h.poller.pollOnce();
  const before = h.stateStore.getAgent('vm-101');
  // A second "vm-101", listed before and then after the real one.
  const twin = { id: '9', name: 'vm-101', status: 'offline', enabled: true, isEdge: true };
  for (const order of ['before', 'after', 'before']) {
    const real = h.s.envs.filter((e) => e.id !== '9');
    h.s.envs = order === 'before' ? [twin, ...real] : [...real, twin];
    h.s.containers[VM101] = [ctr(`n-${h.s.calls.length}`)]; // would push if processed
    const from = h.s.calls.length;
    const r = await h.poller.pollOnce();
    assert.deepEqual(r, { events: [], errors: [] }, order);
    const calls = h.s.calls.slice(from);
    assert.equal(
      calls.some((c) => c.includes(`:${VM101}`) || c.includes(':9')),
      false,
      order
    );
    assert.ok(calls.includes(`containers:${VM103}`), 'other environments still polled');
  }
  assert.deepEqual(h.stateStore.getAgent('vm-101'), before);
  assert.deepEqual(h.heldBackStore.getNode('vm-101'), []);
});

test('a fresh poller on the same state files emits nothing new', async (t) => {
  const a = setup(t);
  await a.poller.pollOnce();
  a.s.containers[VM103].push(ctr('homeassistant'));
  a.s.activities[`${VM103}:auto_update`].unshift(
    scheduled(
      a.s,
      VM103,
      act('act-au-4', 'auto_update', 'success', '2026-10-18T03:00:00Z', '2026-10-18T03:01:00Z')
    )
  );
  a.s.history[VM103].unshift(row('2026-10-18T03:00:30Z', 'gitea', 'updated'));
  setStatus(a.s, VM101, 'offline');
  const second = await a.poller.pollOnce();
  assert.deepEqual(
    second.events.map((e) => e.type),
    ['arcane_heldback', 'arcane_update']
  );
  assert.equal(a.dispatched.length, 1, 'one dispatch per poll with every event');
  assert.deepEqual(a.dispatched[0].events, second.events);
  const third = await a.poller.pollOnce();
  assert.deepEqual(
    third.events.map((e) => e.type),
    ['arcane_agent_offline']
  );
  assert.equal(a.runs.length, 1);

  // JagHelm restarts: new stores load the same files; Arcane state is unchanged.
  const b = setup(t, { dir: a.dir, w: a.w });
  const r = await b.poller.pollOnce();
  assert.deepEqual(r, { events: [], errors: [] });
  assert.equal(b.runs.length, 0);
  assert.equal(b.dispatched.length, 0);

  // The persisted alerted flag still drives exactly one recovery.
  setStatus(a.s, VM101, 'online');
  const back = await b.poller.pollOnce();
  assert.deepEqual(
    back.events.map((e) => e.type),
    ['arcane_agent_recovered']
  );
});

test('dispatch failure does not block state advance', async (t) => {
  for (const sync of [false, true]) {
    let h;
    const atDispatch = [];
    // Records what state looked like when dispatch ran, then fails.
    const dispatch = (events) => {
      atDispatch.push({
        types: events.map((e) => e.type),
        seen: h.stateStore.hasActivity('vm-103', 'act-au-4'),
        held: names(h.heldBackStore.getNode('vm-103')),
        release: h.stateStore.getReleaseNotified(),
      });
      if (sync) throw new Error('sync throw');
      return Promise.reject(new Error('fcm unavailable'));
    };
    h = setup(t, { dispatch });
    await h.poller.pollOnce();
    h.s.containers[VM103].push(ctr('homeassistant'));
    h.s.activities[`${VM103}:auto_update`].unshift(
      scheduled(
        h.s,
        VM103,
        act('act-au-4', 'auto_update', 'success', '2026-10-18T03:00:00Z', '2026-10-18T03:01:00Z')
      )
    );
    h.s.history[VM103].unshift(row('2026-10-18T03:00:30Z', 'gitea', 'updated'));

    const r = await h.poller.pollOnce();
    assert.deepEqual(
      r.events.map((e) => e.type),
      ['arcane_heldback', 'arcane_update']
    );
    assert.deepEqual(r.errors, []);
    assert.equal(h.runs.length, 1);
    // State was already advanced when dispatch ran.
    assert.deepEqual(atDispatch[0], {
      types: ['arcane_heldback', 'arcane_update'],
      seen: true,
      held: ['homeassistant', 'immich-server'],
      release: null,
    });

    // Nothing is re-announced, so enabling push later is quiet.
    assert.deepEqual((await h.poller.pollOnce()).events, []);
    assert.equal(h.runs.length, 1);

    assert.equal((await h.poller.checkRelease()).length, 1);
    assert.equal(atDispatch[1].release, '2.17.0');
    assert.deepEqual(await h.poller.checkRelease(), []);
    assert.equal(atDispatch.length, 2);
  }
});

test('checkRelease pushes once per new version and stays silent when updateAvailable is false', async (t) => {
  const h = setup(t);
  const first = await h.poller.checkRelease();
  assert.deepEqual(first, [
    {
      type: 'arcane_release',
      id: 'arcane:release',
      node: 'arcane',
      title: 'Arcane 2.17.0 available',
      body: 'Running 2.16.1. Upgrade by PR: bump the pinned tag.',
      severity: 'info',
    },
  ]);
  assert.equal(h.dispatched.length, 1);
  assert.deepEqual(h.dispatched[0].events, first);

  assert.deepEqual(await h.poller.checkRelease(), []);
  assert.equal(h.dispatched.length, 1);

  h.s.version.newestVersion = '2.17.1';
  assert.deepEqual(
    (await h.poller.checkRelease()).map((e) => e.title),
    ['Arcane 2.17.1 available']
  );

  h.s.version = { ...h.s.version, newestVersion: '2.18.0', updateAvailable: false };
  assert.deepEqual(await h.poller.checkRelease(), []);
  assert.equal(h.stateStore.getReleaseNotified(), '2.17.1');

  h.s.fail['app-version'] = new ArcaneError('Arcane HTTP 503 for /api/app-version', 503);
  assert.deepEqual(await h.poller.checkRelease(), []);
  delete h.s.fail['app-version'];

  // Persisted across a restart.
  h.s.version = { ...h.s.version, newestVersion: '2.17.1', updateAvailable: true };
  const fresh = setup(t, { dir: h.dir, w: h.w });
  assert.deepEqual(await fresh.poller.checkRelease(), []);
  assert.equal(h.dispatched.length + fresh.dispatched.length, 2);
});

test('start polls now and on intervals, skips re-entry, and stop clears the timers', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const h = setup(t);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const real = h.w.client.listEnvironments;
  let listCalls = 0;
  h.w.client.listEnvironments = async () => {
    listCalls += 1;
    if (listCalls === 1) await gate;
    return real();
  };
  let versionCalls = 0;
  const realVersion = h.w.client.appVersion;
  h.w.client.appVersion = async () => {
    versionCalls += 1;
    return realVersion();
  };

  h.poller.start({ pollMs: 60_000, releaseMs: 3_600_000 });
  assert.equal(listCalls, 1, 'runs once now');
  assert.equal(versionCalls, 1);

  t.mock.timers.tick(60_000); // first poll still in flight
  assert.equal(listCalls, 1, 're-entry guard');

  release();
  await new Promise((r) => setImmediate(r));
  t.mock.timers.tick(60_000);
  assert.equal(listCalls, 2);
  t.mock.timers.tick(3_540_000);
  assert.equal(versionCalls, 2);

  h.poller.stop();
  await new Promise((r) => setImmediate(r));
  const after = listCalls;
  t.mock.timers.tick(3_600_000);
  assert.equal(listCalls, after);
  assert.equal(versionCalls, 2);
});

test('a held-back label added to a pending container is silent; only image news pushes', async (t) => {
  const h = setup(t);
  await h.poller.pollOnce(); // baseline: immich-server held back, gitea pending in the auto tier
  const gitea = () => h.s.containers[VM103].find((c) => c.names[0] === '/gitea');

  gitea().autoUpdateEnabled = false; // label added, same latest
  assert.deepEqual(await h.poller.pollOnce(), { events: [], errors: [] });
  assert.deepEqual(names(h.heldBackStore.getNode('vm-103')), ['gitea', 'immich-server']);

  gitea().updateInfo.latestVersion = '1.22.5'; // a newer image: news
  assert.deepEqual(
    (await h.poller.pollOnce()).events.map((e) => e.body),
    ['1 update held back: gitea']
  );

  gitea().autoUpdateEnabled = true; // label removed while still pending: not caught up
  assert.deepEqual(await h.poller.pollOnce(), { events: [], errors: [] });
  assert.deepEqual(names(h.heldBackStore.getNode('vm-103')), ['immich-server']);

  // A real update: immich-server no longer has one.
  h.s.containers[VM103] = h.s.containers[VM103].filter((c) => c.names[0] !== '/immich-server');
  assert.deepEqual(
    (await h.poller.pollOnce()).events.map((e) => e.body),
    ['1 caught up: immich-server']
  );
  assert.deepEqual((await h.poller.pollOnce()).events, []);
});

test('switching an environment to check-only and back is silent', async (t) => {
  const a = setup(t);
  a.s.containers[VM101] = [
    ctr('gitea', { auto: true }),
    ctr('nginx', { auto: true }),
    ctr('immich-server'),
  ];
  await a.poller.pollOnce(); // baseline: only immich-server held back on vm-101
  assert.deepEqual(names(a.heldBackStore.getNode('vm-101')), ['immich-server']);

  // JagHelm restarts with vm-101 check-only: every pending update is now held back.
  const b = setup(t, { dir: a.dir, w: a.w, checkOnlyEnvs: new Set(['vm-101']) });
  assert.deepEqual(await b.poller.pollOnce(), { events: [], errors: [] });
  assert.deepEqual(names(b.heldBackStore.getNode('vm-101')), ['gitea', 'immich-server', 'nginx']);

  a.s.containers[VM101].find((c) => c.names[0] === '/nginx').updateInfo.latestVersion = 'v3';
  const news = await b.poller.pollOnce();
  assert.deepEqual(
    news.events.map((e) => `${e.node}|${e.body}`),
    ['vm-101|1 update held back: nginx']
  );

  // Check-only switched off again: nothing was applied, so nothing is caught up.
  const c = setup(t, { dir: a.dir, w: a.w });
  assert.deepEqual(await c.poller.pollOnce(), { events: [], errors: [] });
  assert.deepEqual(names(c.heldBackStore.getNode('vm-101')), ['immich-server']);
  assert.equal(c.runs.length + b.runs.length, 0);
});

test('a state file from before the pending map behaves as before for one poll', async (t) => {
  const a = setup(t);
  await a.poller.pollOnce();
  // Strip the pending map, as a 2.1.0-pre state file would have it.
  const j = JSON.parse(readFileSync(a.statePath, 'utf8'));
  for (const rec of Object.values(j.envs)) delete rec.pending;
  writeFileSync(a.statePath, JSON.stringify(j));

  a.s.containers[VM103].find((c) => c.names[0] === '/gitea').autoUpdateEnabled = false;
  const b = setup(t, { dir: a.dir, w: a.w });
  assert.deepEqual(
    (await b.poller.pollOnce()).events.map((e) => e.body),
    ['1 update held back: gitea'],
    'no pending map yet: newly held back as before'
  );
  // The map is recorded silently; from here on a policy change is silent.
  a.s.containers[VM103].find((c) => c.names[0] === '/gitea').autoUpdateEnabled = true;
  assert.deepEqual(await b.poller.pollOnce(), { events: [], errors: [] });
  a.s.containers[VM103].find((c) => c.names[0] === '/gitea').autoUpdateEnabled = false;
  assert.deepEqual(await b.poller.pollOnce(), { events: [], errors: [] });
});

test('only runs the scheduler started become cron runs; manual runs still push', async (t) => {
  const h = setup(t);
  await h.poller.pollOnce();
  const au = `${VM103}:auto_update`;
  const sp = `${VM103}:system_prune`;
  const job = (id, trigger, domainActivityId, at) => ({
    id,
    type: 'job_run',
    status: 'success',
    batchId: `b-${id}`,
    startedAt: at,
    endedAt: at,
    metadata: { trigger, domainActivityId },
  });

  // The Prune button: no job run at all.
  h.s.activities[sp].unshift(
    act('man-sp', 'system_prune', 'success', '2026-10-18T01:00:00Z', '2026-10-18T01:00:10Z')
  );
  // A container's Update button: one container, no job run.
  h.s.activities[au].unshift(
    act('man-c', 'auto_update', 'success', '2026-10-18T01:10:00Z', '2026-10-18T01:10:20Z', {
      resourceType: 'container',
    })
  );
  h.s.history[VM103].unshift(row('2026-10-18T01:10:15Z', 'immich-server', 'updated'));
  let r = await h.poller.pollOnce();
  assert.deepEqual(
    r.events.map((e) => e.body),
    ['1 updated: immich-server']
  );
  assert.deepEqual(h.runs, [], 'manual prune and manual update: no cron run');
  assert.equal(h.stateStore.hasActivity('vm-103', 'man-sp'), true);
  assert.equal(h.stateStore.hasActivity('vm-103', 'man-c'), true);

  // Jobs page "Run now" on auto-update: a job run, but trigger manual.
  h.s.activities[au].unshift(
    act('now-au', 'auto_update', 'failed', '2026-10-18T02:00:00Z', '2026-10-18T02:01:00Z', {
      batchId: 'b-j-now',
    })
  );
  h.s.activities[`${VM103}:job_run`].unshift(
    job('j-now', 'manual', 'now-au', '2026-10-18T02:01:01Z')
  );
  h.s.history[VM103].unshift(row('2026-10-18T02:00:30Z', 'gitea', 'failed'));
  r = await h.poller.pollOnce();
  assert.deepEqual(
    r.events.map((e) => e.body),
    ['1 failed: gitea']
  );
  assert.deepEqual(h.runs, []);

  // The scheduler: one on time, one late (recovery) after a missed slot.
  h.s.activities[sp].unshift(
    act('sch-sp', 'system_prune', 'success', '2026-10-19T00:00:00Z', '2026-10-19T00:00:10Z')
  );
  h.s.activities[au].unshift(
    act('rec-au', 'auto_update', 'success', '2026-10-19T00:30:00Z', '2026-10-19T00:31:00Z')
  );
  h.s.activities[`${VM103}:job_run`].unshift(
    job('j-rec', 'recovery', 'rec-au', '2026-10-19T00:31:01Z'),
    job('j-sch', 'scheduled', 'sch-sp', '2026-10-19T00:00:11Z')
  );
  r = await h.poller.pollOnce();
  assert.deepEqual(r.events, [], 'nothing updated, nothing failed');
  assert.deepEqual(
    h.runs.map((x) => `${x.job}:${x.status}`),
    ['arcane-update:success', 'arcane-prune:success']
  );
  assert.deepEqual((await h.poller.pollOnce()).events, []);
  assert.equal(h.runs.length, 2);
});

test('a job run read failure leaves the environment unchanged', async (t) => {
  const h = setup(t);
  await h.poller.pollOnce();
  h.s.activities[`${VM103}:system_prune`].unshift(
    scheduled(
      h.s,
      VM103,
      act('act-sp-3', 'system_prune', 'success', '2026-10-18T04:00:00Z', '2026-10-18T04:00:30Z')
    )
  );
  h.s.containers[VM103] = []; // would clear immich-server
  h.s.fail[`activities:${VM103}:job_run`] = new ArcaneError('Arcane HTTP 500 for /x', 500);
  const r = await h.poller.pollOnce();
  assert.deepEqual(r.events, []);
  assert.equal(r.errors.length, 1);
  assert.equal(h.stateStore.hasActivity('vm-103', 'act-sp-3'), false, 'nothing marked seen');
  assert.deepEqual(names(h.heldBackStore.getNode('vm-103')), ['immich-server']);
  assert.equal(h.runs.length, 0);

  delete h.s.fail[`activities:${VM103}:job_run`];
  const ok = await h.poller.pollOnce();
  assert.deepEqual(
    ok.events.map((e) => e.type),
    ['arcane_cleared']
  );
  assert.deepEqual(
    h.runs.map((x) => x.job),
    ['arcane-prune']
  );
});

test('a run whose job is still finishing is judged on a later poll', async (t) => {
  const h = setup(t);
  await h.poller.pollOnce();
  // The prune activity has finished; its scheduled job run has not recorded it yet.
  h.s.activities[`${VM103}:system_prune`].unshift(
    act('act-sp-3', 'system_prune', 'success', '2026-10-18T04:00:00Z', '2026-10-18T04:00:30Z', {
      batchId: 'run-x',
    })
  );
  const job = {
    id: 'job-x',
    type: 'job_run',
    status: 'running',
    batchId: 'run-x',
    startedAt: '2026-10-18T04:00:00Z',
    metadata: { trigger: 'scheduled', domainActivityId: '' },
  };
  h.s.activities[`${VM103}:job_run`].unshift(job);
  assert.deepEqual(await h.poller.pollOnce(), { events: [], errors: [] });
  assert.equal(h.stateStore.hasActivity('vm-103', 'act-sp-3'), false, 'not judged yet');
  assert.equal(h.runs.length, 0);

  job.status = 'success';
  job.endedAt = '2026-10-18T04:00:31Z';
  job.metadata.domainActivityId = 'act-sp-3';
  await h.poller.pollOnce();
  assert.equal(h.stateStore.hasActivity('vm-103', 'act-sp-3'), true);
  assert.deepEqual(
    h.runs.map((x) => x.job),
    ['arcane-prune']
  );
});

test('job runs are paged back to the oldest unseen run, with a bounded page count', async (t) => {
  const heal = (i, at) => ({
    id: `heal-${i}`,
    type: 'job_run',
    status: 'success',
    batchId: `h-${i}`,
    startedAt: at,
    endedAt: at,
    metadata: { trigger: 'scheduled', domainActivityId: `heal-act-${i}` },
  });
  const ts = (min) => new Date(Date.parse('2026-10-18T10:00:00Z') + min * 60_000).toISOString();
  for (const [newer, expectRun] of [
    [120, true],
    [260, false],
  ]) {
    const h = setup(t);
    await h.poller.pollOnce();
    h.s.activities[`${VM103}:system_prune`].unshift(
      act('act-sp-3', 'system_prune', 'success', ts(0), ts(1), { batchId: 'run-p' })
    );
    // An auto-heal job run every 5 minutes after it, newest first, then the prune's own.
    const jobs = [];
    for (let i = newer; i >= 1; i--) jobs.push(heal(i, ts(1 + i * 5)));
    jobs.push({
      ...heal(0, ts(1)),
      id: 'job-p',
      batchId: 'run-p',
      metadata: { trigger: 'scheduled', domainActivityId: 'act-sp-3' },
    });
    h.s.activities[`${VM103}:job_run`] = jobs;
    const from = h.s.calls.length;
    await h.poller.pollOnce();
    const pages = h.s.calls.slice(from).filter((c) => c === `activities:${VM103}:job_run`);
    assert.equal(h.runs.length, expectRun ? 1 : 0, `${newer} newer job runs`);
    assert.equal(pages.length, expectRun ? 3 : 4, 'pages read');
    assert.equal(h.stateStore.hasActivity('vm-103', 'act-sp-3'), true, 'judged either way');
  }
});

test('back-to-back update runs report each container in exactly one push', async (t) => {
  const h = setup(t);
  await h.poller.pollOnce();
  const au = `${VM103}:auto_update`;
  // Two manual container updates 30 s apart (Arcane queues them back to back).
  h.s.activities[au].unshift(
    act('b', 'auto_update', 'success', '2026-10-18T10:00:31Z', '2026-10-18T10:01:00Z'),
    act('a', 'auto_update', 'success', '2026-10-18T10:00:00Z', '2026-10-18T10:00:30Z')
  );
  h.s.history[VM103].unshift(
    row('2026-10-18T10:00:59Z', 'immich-machine-learning', 'updated'),
    row('2026-10-18T10:00:29Z', 'immich-server', 'updated')
  );
  const r = await h.poller.pollOnce();
  assert.deepEqual(
    r.events.map((e) => e.body),
    ['1 updated: immich-server', '1 updated: immich-machine-learning']
  );

  // A run still going when a later, short one finishes: the later one is seen first,
  // and still caps the earlier one's window when that one is judged.
  h.s.activities[au].unshift(
    act('d', 'auto_update', 'success', '2026-10-18T11:00:20Z', '2026-10-18T11:00:40Z'),
    act('c', 'auto_update', 'running', '2026-10-18T11:00:00Z', null)
  );
  h.s.history[VM103].unshift(
    row('2026-10-18T11:00:35Z', 'redis', 'updated'),
    row('2026-10-18T11:00:10Z', 'nextcloud', 'updated')
  );
  assert.deepEqual(
    (await h.poller.pollOnce()).events.map((e) => e.body),
    ['1 updated: redis'],
    'd is judged alone; c is still running'
  );
  Object.assign(h.s.activities[au].find((x) => x.id === 'c'), {
    status: 'success',
    endedAt: '2026-10-18T11:01:00Z',
  });
  assert.deepEqual(
    (await h.poller.pollOnce()).events.map((e) => e.body),
    ['1 updated: nextcloud']
  );
});

test('a registry error never reads as caught up', async (t) => {
  const h = setup(t);
  await h.poller.pollOnce(); // immich-server held back
  const immich = () => h.s.containers[VM103].find((c) => c.names[0] === '/immich-server');
  const good = structuredClone(immich().updateInfo);

  // Arcane's check fails: it stores the error and hasUpdate false.
  immich().updateInfo = { ...good, hasUpdate: false, latestVersion: '', error: 'registry 503' };
  assert.deepEqual(await h.poller.pollOnce(), { events: [], errors: [] });
  assert.deepEqual(h.heldBackStore.getNode('vm-103'), [
    { name: 'immich-server', current: 'v1.130.0', latest: 'v1.131.0' },
  ]);
  // Not checked at all (no update info): the same.
  delete immich().updateInfo;
  assert.deepEqual(await h.poller.pollOnce(), { events: [], errors: [] });
  // The check recovers with the same pending update: still nothing new.
  immich().updateInfo = good;
  assert.deepEqual(await h.poller.pollOnce(), { events: [], errors: [] });

  // Updated for real: Arcane reports it up to date. One caught-up push.
  immich().updateInfo = { ...good, hasUpdate: false, currentVersion: 'v1.131.0' };
  assert.deepEqual(
    (await h.poller.pollOnce()).events.map((e) => e.body),
    ['1 caught up: immich-server']
  );
  assert.deepEqual((await h.poller.pollOnce()).events, []);

  // A held-back container that is removed is caught up too (accepted semantics).
  h.s.containers[VM103].push(ctr('n8n'));
  assert.deepEqual(
    (await h.poller.pollOnce()).events.map((e) => e.body),
    ['1 update held back: n8n']
  );
  h.s.containers[VM103] = h.s.containers[VM103].filter((c) => c.names[0] !== '/n8n');
  assert.deepEqual(
    (await h.poller.pollOnce()).events.map((e) => e.body),
    ['1 caught up: n8n']
  );
});

test('a pending update that errors and comes back is not re-announced', async (t) => {
  const h = setup(t);
  await h.poller.pollOnce();
  const gitea = () => h.s.containers[VM103].find((c) => c.names[0] === '/gitea');
  const good = structuredClone(gitea().updateInfo);
  gitea().updateInfo = { ...good, hasUpdate: false, error: 'timeout' };
  await h.poller.pollOnce();
  // Back, now held back by a label, same latest: policy-only, silent.
  gitea().updateInfo = good;
  gitea().autoUpdateEnabled = false;
  assert.deepEqual(await h.poller.pollOnce(), { events: [], errors: [] });
  assert.deepEqual(names(h.heldBackStore.getNode('vm-103')), ['gitea', 'immich-server']);
});
