// server/arcane/poller.test.js
// Stub client/dispatch/recordRun; REAL stateStore + heldBackStore on mkdtemp
// paths, so the restart test reads back what an earlier poller wrote.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
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

/** A fake Arcane manager: mutable per-environment data + injectable failures. */
function world() {
  const s = {
    envs: fx('environments'),
    containers: { [VM103]: fx('containers-has-update') },
    activities: {
      [`${VM103}:auto_update`]: fx('activities-auto_update'),
      [`${VM103}:system_prune`]: fx('activities-system_prune'),
    },
    history: { [VM103]: fx('updater-history') },
    version: fx('app-version'),
    fail: {}, // call key -> Error to throw
    calls: [],
  };
  const hit = (key) => {
    s.calls.push(key);
    if (s.fail[key]) throw s.fail[key];
  };
  const client = {
    async listEnvironments() {
      hit('environments');
      return clone(s.envs);
    },
    async listPendingUpdates(id) {
      hit(`containers:${id}`);
      return clone(s.containers[id] ?? []);
    },
    async listActivities(id, type) {
      hit(`activities:${id}:${type}`);
      return clone(s.activities[`${id}:${type}`] ?? []);
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

function setup(t, { dir, w = world(), checkOnlyEnvs = new Set(), dispatch } = {}) {
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
    recordRun: (report) => runs.push(report),
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
  for (const name of ['vm-103', 'vm-101', 'pi-1'])
    assert.equal(h.stateStore.isKnownEnv(name), true);
  // pi-2 is offline: nothing fetched, so it has no baseline yet.
  assert.equal(h.stateStore.isKnownEnv('pi-2'), false);
  assert.equal(
    h.s.calls.some((c) => c.includes(':3')),
    false
  );

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
  h.s.containers[PI1] = fx('containers-has-update');
  h.s.containers[VM101] = fx('containers-has-update');
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
    act('act-au-5', 'auto_update', 'success', '2026-10-18T03:00:00Z', '2026-10-18T03:05:00Z'),
    // Older, cancelled, nothing in its window: recorded, but silent.
    act('act-au-4', 'auto_update', 'cancelled', '2026-10-17T12:00:00Z', '2026-10-17T12:00:10Z')
  );
  h.s.activities[`${VM103}:system_prune`].unshift(
    act('act-sp-3', 'system_prune', 'success', '2026-10-18T04:00:00Z', '2026-10-18T04:00:30Z')
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
  const h = setup(t);
  await h.poller.pollOnce();
  h.s.activities[`${VM103}:auto_update`].unshift(
    act('act-au-4', 'auto_update', 'failed', '2026-10-18T03:00:00Z', '2026-10-18T03:00:20Z', {
      error: 'registry unreachable',
    })
  );
  h.s.activities[`${VM103}:system_prune`].unshift(
    act('act-sp-3', 'system_prune', 'failed', '2026-10-18T04:00:00Z', '2026-10-18T04:00:05Z', {
      error: 'docker daemon busy',
    })
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
  await h.poller.pollOnce();
  assert.equal(h.runs.length, 2);
});

test('running activity is processed only after it becomes terminal', async (t) => {
  const h = setup(t);
  await h.poller.pollOnce(); // act-au-3 is still running in the fixture
  h.s.history[VM103].unshift(row('2026-10-17T03:04:00Z', 'gitea', 'updated'));
  // A terminal prune without a parseable startedAt is skipped, not marked seen.
  h.s.activities[`${VM103}:system_prune`].unshift(
    act('act-sp-9', 'system_prune', 'success', null, '2026-10-17T05:00:00Z')
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
  await h.poller.pollOnce(); // vm-101 known while up
  const all = [];
  const poll = async (status) => {
    setStatus(h.s, VM101, status);
    const r = await h.poller.pollOnce();
    all.push(...r.events);
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
  // pi-2 has been offline since first sight: no baseline, so it never alerts.
  assert.equal(all.filter((e) => e.node === 'pi-2').length, 0);
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
    assert.deepEqual(r.events, []);
    assert.equal(r.errors.length, 1);
    assert.deepEqual(h.stateStore.getAgent('vm-101'), { downPolls: 2, alerted: true });
    assert.deepEqual(names(h.heldBackStore.getNode('vm-101')), ['code-server']);

    // Once the API answers again, the deferred transitions arrive exactly once.
    delete h.s.fail[`activities:${VM101}:auto_update`];
    const ok = await h.poller.pollOnce();
    assert.deepEqual(
      ok.events.map((e) => e.type),
      ['arcane_agent_recovered', 'arcane_cleared']
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

test('a fresh poller on the same state files emits nothing new', async (t) => {
  const a = setup(t);
  await a.poller.pollOnce();
  a.s.containers[VM103].push(ctr('homeassistant'));
  a.s.activities[`${VM103}:auto_update`].unshift(
    act('act-au-4', 'auto_update', 'success', '2026-10-18T03:00:00Z', '2026-10-18T03:01:00Z')
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
      act('act-au-4', 'auto_update', 'success', '2026-10-18T03:00:00Z', '2026-10-18T03:01:00Z')
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
