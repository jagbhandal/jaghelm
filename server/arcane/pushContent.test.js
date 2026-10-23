/**
 * Arcane's pushes stay push events (spec §6.2, #291): the status model shows an
 * offline agent as an Integrations entity, and nothing else Arcane reports
 * (updates, held-back updates, releases, vulnerability digests) becomes a
 * model issue. What the phone receives for each is pinned here as a snapshot
 * (pushContent.test.js.snapshot): the FCM message, title, body and data keys,
 * of every Arcane push type, produced by the real poller over a fake Arcane
 * (the digest by its real builder). A change to any of them fails this test;
 * rewrite the snapshot only on purpose (`node --test --test-update-snapshots`
 * on this file).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createArcanePoller } from './poller.js';
import { createArcaneStateStore } from './stateStore.js';
import { buildVulnDigestPush } from './format.js';
import { createHeldBackStore } from '../watchtower/heldBackStore.js';
import { buildMessage } from '../push/fcm.js';
import { buildStatus, readStatusInputs } from '../status/index.js';
import { DEFAULT_THRESHOLDS } from '../status/thresholds.js';

const fx = (n) => {
  const body = JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), 'utf8'));
  return 'success' in body ? body.data : body;
};
const clone = (v) => structuredClone(v);
const silent = { debug() {}, info() {}, warn() {}, error() {} };

// The fixture environments: vm-103 ("0"), vm-101 ("1"), pi-1 ("2", standby),
// pi-2 ("3", offline in the fixture, online here until the agent step).
const VM103 = '0';

/** A fake Arcane manager over the recorded fixtures, as poller.test.js has it. */
function fakeArcane() {
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
  };
  s.envs.find((e) => e.name === 'pi-2').status = 'online';
  const client = {
    listEnvironments: async () => clone(s.envs),
    listContainers: async (id) => clone(s.containers[id] ?? []),
    listActivities: async (id, type, limit = 20, start = 0) =>
      clone(s.activities[`${id}:${type}`] ?? []).slice(start, start + limit),
    updaterHistory: async (id) => clone(s.history[id] ?? []),
    appVersion: async () => clone(s.version),
  };
  return { s, client };
}

const ctr = (name, { current = 'v1', latest = 'v2' } = {}) => ({
  id: `c-${name}`,
  names: [`/${name}`],
  image: `${name}:latest`,
  autoUpdateEnabled: false,
  updateInfo: {
    hasUpdate: true,
    currentVersion: current,
    latestVersion: latest,
    currentDigest: 'sha256:aaaa',
    latestDigest: 'sha256:bbbb',
  },
});

/** A finished auto_update run Arcane's scheduler started, with its job_run row. */
function scheduledUpdateRun(s) {
  const a = {
    id: 'act-au-5',
    type: 'auto_update',
    status: 'success',
    startedAt: '2026-10-18T03:00:00Z',
    endedAt: '2026-10-18T03:05:00Z',
    error: '',
    batchId: 'run-act-au-5',
  };
  s.activities[`${VM103}:job_run`].unshift({
    id: 'job-act-au-5',
    type: 'job_run',
    status: 'success',
    batchId: a.batchId,
    startedAt: a.startedAt,
    endedAt: a.endedAt,
    metadata: { trigger: 'scheduled', runId: a.batchId, domainActivityId: a.id },
  });
  s.activities[`${VM103}:auto_update`].unshift(a);
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
  s.history[VM103].unshift(
    row('2026-10-18T03:02:00Z', 'nextcloud', 'failed', { error: 'pull access denied' }),
    row('2026-10-18T03:01:00Z', 'gitea', 'updated')
  );
}

/**
 * Every push type Arcane sends, in the order a run of the real poller sends
 * them, and the poller (for its agents).
 */
async function everyArcanePush() {
  const { s, client } = fakeArcane();
  const dispatched = [];
  const poller = createArcanePoller({
    client,
    stateStore: createArcaneStateStore(),
    heldBackStore: createHeldBackStore(),
    recordRun: () => {},
    // What goes to the outbox (#581), as the sender hands it to fcm.js.
    notices: {
      commit(events) {
        dispatched.push(...events);
      },
    },
    logger: silent,
  });
  const setStatus = (name, status) => {
    s.envs.find((e) => e.name === name).status = status;
  };

  await poller.pollOnce(); // the silent baseline
  // A new held-back update, a held-back container caught up, a finished update run.
  s.containers[VM103] = s.containers[VM103].filter((c) => c.names[0] !== '/immich-server');
  s.containers[VM103].push(ctr('homeassistant', { current: '2026.10.1', latest: '2026.10.2' }));
  scheduledUpdateRun(s);
  await poller.pollOnce();
  // An agent offline for two polls, then back.
  setStatus('vm-101', 'offline');
  await poller.pollOnce();
  await poller.pollOnce();
  const offlineAgents = poller.agents?.() ?? null;
  setStatus('vm-101', 'online');
  await poller.pollOnce();
  await poller.checkRelease();

  const digest = buildVulnDigestPush({
    env: 'vm-103',
    digest: {
      newCritical: 3,
      newHigh: 11,
      images: 9,
      top: [
        { name: 'nextcloud', critical: 2, high: 0 },
        { name: 'immich-server', critical: 1, high: 0 },
      ],
      kev: 1,
      kevNew: 1,
      fixed: 2,
      stale: ['redis'],
      failed: [],
      stillStale: [],
      stillFailed: ['whoami'],
      push: true,
      severity: 'warning',
    },
  });
  return { events: [...dispatched, digest], poller, offlineAgents };
}

test('Arcane pushes are unchanged in content: every type, as the phone receives it (#291)', async (t) => {
  const { events } = await everyArcanePush();
  assert.deepEqual(
    events.map((e) => e.type),
    [
      'arcane_heldback',
      'arcane_cleared',
      'arcane_update',
      'arcane_agent_offline',
      'arcane_agent_recovered',
      'arcane_release',
      'arcane_vulns',
    ],
    'every Arcane push type, once'
  );
  t.assert.snapshot(events.map((e) => buildMessage('phone', e)));
});

test('Arcane updates, held-back updates, releases and digests never become status model issues (#291)', async () => {
  const { poller, offlineAgents } = await everyArcanePush();
  const none = { getCached: () => null, getCachedInternal: () => null, getAllCronStatuses: () => [] };
  const statusWith = (arcaneAgents) =>
    buildStatus({
      inputs: readStatusInputs(none, { arcaneAgents, env: {} }),
      thresholds: DEFAULT_THRESHOLDS,
      now: Date.parse('2026-10-20T12:00:00Z'),
    }).status;

  // While vm-101 was offline: its agent is the one issue.
  const offline = statusWith(offlineAgents);
  assert.deepEqual(
    offline.issues.map((i) => [i.id, i.state]),
    [['integrations/arcane:vm-101', 'warn']]
  );
  // At the end of the run: every agent is up, and nothing Arcane pushed (an
  // update run, a held-back update, one caught up, a release) is an entity.
  const now = statusWith(poller.agents());
  assert.deepEqual(
    now.entities.map((e) => [e.id, e.kind, e.state]),
    [
      ['integrations/arcane:pi-1', 'agent', 'ok'],
      ['integrations/arcane:pi-2', 'agent', 'ok'],
      ['integrations/arcane:vm-101', 'agent', 'ok'],
      ['integrations/arcane:vm-103', 'agent', 'ok'],
    ]
  );
  assert.deepEqual(now.issues, []);
  assert.equal(now.overall.state, 'ok');
});
