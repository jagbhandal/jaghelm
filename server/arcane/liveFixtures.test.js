// server/arcane/liveFixtures.test.js
// Shapes recorded from the live Arcane v2.16.1 manager on 2026-10-17 by
// `node scripts/arcane-poll-once.js --record`, projected to the fields the client reads
// and anonymized by projectFixture (the repository is public): containers are ctr-NN,
// images registry.example/img-NN, tags and digests placeholders, edge ids fake UUIDs.
// Environment names and the Arcane version are real (both public).
// fixtures/live/ keeps only the responses that had rows: environments, containers (pi-1,
// the first environment by name with rows), app-version, and one image_update_check
// activity (vm-101's, projected with the same projectFixture). auto_update, system_prune,
// job_run and updater history were empty on every environment (auto-update and prune were
// still off), so those shapes stay hand-built in fixtures/ until a real run produces them.
//
// What the live data showed that the hand-built fixtures did not:
//   - container names carry no leading "/";
//   - a digest update has latestVersion "" (only a tag update sets it), so "latest" is
//     the 19-character digest prefix, and a newer digest is still news;
//   - containers Arcane does not check (its own agent, some images) have no updateInfo;
//   - edge environments have UUID ids and report "online" over gRPC; local is "0";
//   - app-version is unenveloped and its versions carry a "v" prefix;
//   - timestamps are RFC 3339 with nanoseconds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createArcaneClient } from './client.js';
import {
  envKey,
  envHealth,
  containerState,
  heldBackSet,
  pendingMap,
  nextUpdateState,
  heldBackTransitions,
  isTerminal,
  summarizeUpdateRun,
} from './derive.js';
import { createArcanePoller } from './poller.js';
import { createArcaneStateStore } from './stateStore.js';
import { createHeldBackStore } from '../watchtower/heldBackStore.js';

const KEY = 'fake-live-fixture-key'; // pragma: allowlist secret
const live = (n) =>
  JSON.parse(readFileSync(new URL(`./fixtures/live/${n}.json`, import.meta.url), 'utf8'));
const silent = { debug() {}, info() {}, warn() {}, error() {} };

/** The real client over a fake fetch that serves one recorded body. */
function clientFor(body) {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    return { ok: true, status: 200, json: async () => structuredClone(body) };
  };
  return { urls, client: createArcaneClient({ baseUrl: 'https://m', apiKey: KEY, fetchImpl }) };
}

const DIGEST_PREFIX = /^sha256:[0-9a-f]{12}$/;

test('live environments: the four expected names, local id "0", all up', async () => {
  const envs = await clientFor(live('environments')).client.listEnvironments();
  assert.deepEqual(envs.map(envKey).sort(), ['pi-1', 'pi-2', 'vm-101', 'vm-103']);
  for (const e of envs) {
    assert.equal(e.status, 'online', e.name);
    assert.equal(envHealth(e), 'up', e.name);
    assert.equal(e.enabled, true, e.name);
    assert.equal(typeof e.id, 'string', e.name);
  }
  const local = envs.filter((e) => e.id === '0');
  assert.deepEqual(
    local.map((e) => e.name),
    ['vm-103']
  );
  // Edge ids are UUIDs; the client puts them in the path unchanged.
  const edge = envs.find((e) => e.id !== '0');
  assert.match(edge.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  const { urls, client } = clientFor({ success: true, data: [] });
  await client.listContainers(edge.id);
  assert.equal(urls[0], `https://m/api/environments/${edge.id}/containers?limit=-1`);
});

test('live containers: slashless names, digest updates, unchecked containers', async () => {
  const rows = await clientFor(live('containers')).client.listContainers('x');
  assert.ok(rows.length > 0);
  for (const c of rows) {
    assert.equal(c.names.length, 1);
    assert.doesNotMatch(c.names[0], /^\//, 'Arcane strips the leading slash');
  }
  const by = (s) =>
    rows
      .filter((c) => containerState(c) === s)
      .map((c) => c.names[0])
      .sort();
  assert.deepEqual(by('pending'), ['ctr-05', 'ctr-09']);
  assert.deepEqual(by('unknown'), ['ctr-03', 'ctr-10']);
  for (const c of rows.filter((r) => !r.updateInfo)) assert.equal(containerState(c), 'unknown');
  assert.equal(by('current').length, 8);
  assert.equal(rows.length, 12);
  // A digest update: no latestVersion, so "latest" falls back to the digest prefix.
  for (const c of rows.filter((r) => r.updateInfo?.hasUpdate)) {
    assert.equal(c.updateInfo.latestVersion, '');
    assert.notEqual(c.updateInfo.latestDigest, c.updateInfo.currentDigest);
  }
  // Both pending containers are auto-tier: held back only in a check-only environment.
  assert.deepEqual(heldBackSet(rows, { checkOnly: false }), []);
  const held = heldBackSet(rows, { checkOnly: true });
  assert.deepEqual(
    held.map((e) => e.name),
    ['ctr-05', 'ctr-09']
  );
  for (const e of held) {
    assert.equal(e.current, 'latest'); // the tag; currentVersion is set
    assert.match(e.latest, DIGEST_PREFIX);
  }
  assert.deepEqual([...pendingMap(rows).keys()], ['ctr-05', 'ctr-09']);
});

test('a newer digest on a live pending container is news; the same digest is not', () => {
  const rows = live('containers').data;
  const base = nextUpdateState({
    containers: rows,
    checkOnly: true,
    prevHeld: [],
    prevPending: null,
  });
  const again = nextUpdateState({
    containers: rows,
    checkOnly: true,
    prevHeld: base.held,
    prevPending: base.pending,
  });
  assert.deepEqual([...again.pending], [...base.pending]);

  const newer = structuredClone(rows);
  newer.find((c) => c.names[0] === 'ctr-09').updateInfo.latestDigest = 'sha256:' + 'c'.repeat(64);
  const next = nextUpdateState({
    containers: newer,
    checkOnly: true,
    prevHeld: base.held,
    prevPending: base.pending,
  });
  const { heldBack, caughtUp } = heldBackTransitions({
    newlyHeldBack: next.held, // as if every entry were newly held: only the changed one is news
    cleared: [],
    prevPending: base.pending,
    nextPending: next.pending,
  });
  assert.deepEqual(
    heldBack.map((e) => e.name),
    ['ctr-09']
  );
  assert.deepEqual(caughtUp, []);
});

test('live app-version: unenveloped, "v"-prefixed, nothing to announce', async () => {
  const body = live('app-version');
  assert.equal('success' in body, false);
  const v = await clientFor(body).client.appVersion();
  assert.match(v.currentVersion, /^v\d+\.\d+\.\d+$/);
  assert.equal(v.newestVersion, v.currentVersion);
  assert.equal(v.updateAvailable, false);
  assert.match(v.releaseUrl, /^https:\/\/github\.com\/getarcaneapp\/arcane\/releases\/tag\/v/);
});

test('a "v"-prefixed release is announced verbatim, once', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'arcane-live-rel-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const newer = { ...live('app-version'), newestVersion: 'v2.17.0', updateAvailable: true };
  const stateStore = createArcaneStateStore({ path: join(dir, 'arcane-state.json') });
  const poller = createArcanePoller({
    client: { appVersion: async () => structuredClone(newer) },
    stateStore,
    heldBackStore: createHeldBackStore({ path: join(dir, 'arcane-held-back.json') }),
    recordRun() {},
    dispatch: async () => {},
    pushStore: null,
    fcm: null,
    checkOnlyEnvs: new Set(),
    logger: silent,
  });
  const events = await poller.checkRelease();
  assert.deepEqual(
    events.map((e) => [e.title, e.body]),
    [['Arcane v2.17.0 available', 'Running v2.16.1. Upgrade by PR: bump the pinned tag.']]
  );
  assert.equal(stateStore.getReleaseNotified(), 'v2.17.0');
  assert.deepEqual(await poller.checkRelease(), []);
});

test('live activity row: terminal, nanosecond timestamps work in the run window', () => {
  const [row] = live('activities-image_update_check').data;
  assert.equal(row.type, 'image_update_check');
  assert.equal(row.status, 'failed');
  assert.ok(isTerminal(row));
  assert.match(row.startedAt, /\.\d{7,9}Z$/);
  const start = Date.parse(row.startedAt);
  const end = Date.parse(row.endedAt);
  assert.ok(Number.isFinite(start) && Number.isFinite(end) && end >= start);
  // The same Go time.Time encoding on an update run and its history rows.
  const run = { ...row, type: 'auto_update', status: 'success' };
  const history = [
    {
      createdAt: row.endedAt,
      resourceName: 'a',
      status: 'updated',
      oldImageVersions: { main: 'x:1' },
      newImageVersions: { main: 'x:2' },
    },
    { createdAt: '2026-10-17T21:44:11.999999999Z', resourceName: 'early', status: 'updated' },
  ];
  const s = summarizeUpdateRun(run, history);
  assert.deepEqual(s.updated, [{ name: 'a', from: 'x:1', to: 'x:2' }]);
});

/** A fake manager serving the live snapshot: pi-1's containers, nothing else. */
function liveWorld() {
  const envs = live('environments').data;
  const pi1 = envs.find((e) => e.name === 'pi-1').id;
  const containers = { [pi1]: live('containers').data };
  return {
    containers,
    pi1,
    client: {
      listEnvironments: async () => structuredClone(envs),
      listContainers: async (id) => structuredClone(containers[id] ?? []),
      listActivities: async () => [],
      updaterHistory: async () => [],
      appVersion: async () => live('app-version'),
    },
  };
}

test('poller over the live snapshot: silent baseline, silent check-only flip, then image news', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'arcane-live-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const w = liveWorld();
  const stores = () => ({
    stateStore: createArcaneStateStore({ path: join(dir, 'arcane-state.json') }),
    heldBackStore: createHeldBackStore({ path: join(dir, 'arcane-held-back.json') }),
  });
  const pushed = [];
  const runs = [];
  const poller = (checkOnlyEnvs, s) =>
    createArcanePoller({
      client: w.client,
      ...s,
      recordRun: (r) => runs.push(r),
      dispatch: async (events) => pushed.push(...events),
      pushStore: null,
      fcm: null,
      checkOnlyEnvs,
      logger: silent,
    });

  // Deploy: ARCANE_CHECK_ONLY_ENVS empty. Baseline, then a quiet second poll.
  const before = stores();
  const deploy = poller(new Set(), before);
  for (let i = 0; i < 2; i++) assert.deepEqual(await deploy.pollOnce(), { events: [], errors: [] });
  assert.deepEqual(before.heldBackStore.getNode('pi-1'), []);
  assert.equal(await deploy.checkRelease().then((e) => e.length), 0);

  // The flip: pi-1,pi-2 check-only (a restart reads the same files). Policy only: silent.
  const after = stores();
  const flipped = poller(new Set(['pi-1', 'pi-2']), after);
  assert.deepEqual(await flipped.pollOnce(), { events: [], errors: [] });
  assert.deepEqual(
    after.heldBackStore.getNode('pi-1').map((e) => e.name),
    ['ctr-05', 'ctr-09']
  );

  // A newer image for one of them is news: one push naming only it.
  w.containers[w.pi1].find((c) => c.names[0] === 'ctr-09').updateInfo.latestDigest =
    'sha256:' + 'd'.repeat(64);
  const { events } = await flipped.pollOnce();
  assert.deepEqual(
    events.map((e) => [e.type, e.node, e.body]),
    [['arcane_heldback', 'pi-1', '1 update held back: ctr-09']]
  );
  assert.deepEqual(pushed, events);
  assert.deepEqual(runs, []);
});
