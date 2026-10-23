/**
 * Arcane's notices go through the push outbox and into the alert history
 * (#581). The real poller and weekly vulnerability digest over a fake Arcane,
 * their state opened as startArcane opens it (arcane/notices.js), the real
 * push snapshot in a temp data directory and the real sender over a fake
 * Google on a fake clock. Each poll or digest run writes its state and its
 * notices in one write of push-snapshot.json, so a crash on either side of it
 * loses no notice and repeats none, and neither loop waits on Google.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';

import { createArcanePoller } from './poller.js';
import { createVulnDigest } from './vulnDigest.js';
import { currentFindings } from './vulnDerive.js';
import { DIGEST, OLD_FILES, POLLER, openDigestState, openPollerState } from './notices.js';
import { createPushSnapshot } from '../push/dispatch.js';
import { createPushSender } from '../push/outbox.js';
import { createEventsRoutes } from '../routes/events.js';
import { onePhone } from '../testing/pushPipeline.js';
import { atomicWriteFileSync } from '../util/atomicWrite.js';

const fx = (n) => {
  const body = JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), 'utf8'));
  return 'success' in body ? body.data : body;
};
const clone = (v) => structuredClone(v);
const silent = { debug() {}, info() {}, warn() {}, error() {} };

const HOUR = 3_600_000;
const START = Date.parse('2026-10-18T14:00:00Z');
const VM103 = '0';
const SNAPSHOT = 'push-snapshot.json';
const types = (events) => events.map((e) => e.type);

function tmp(t) {
  const dir = mkdtempSync(join(tmpdir(), 'jh-581-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A clock the snapshot, the sender's waits, the poller and the digest all read. */
function fakeClock(start = START) {
  let now = start;
  const timers = [];
  const flush = async () => {
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
  };
  return {
    now: () => now,
    sleep: (ms) => new Promise((resolve) => timers.push({ at: now + ms, resolve })),
    async tick(ms) {
      now += ms;
      for (const timer of timers.filter((x) => x.at <= now)) {
        timers.splice(timers.indexOf(timer), 1);
        timer.resolve();
      }
      await flush();
    },
    flush,
  };
}

/**
 * Google as the sender meets it. Up: each send is accepted at once. Out of
 * reach: a send answers only after 145 s of the clock (the client's timeouts
 * and retries), and then fails as it would for every phone.
 */
function google(clock) {
  const sent = [];
  let reachable = true;
  let inFlight = 0;
  const fcm = {
    isPushEnabled: () => true,
    async sendToToken(_token, event) {
      if (!reachable) {
        inFlight += 1;
        await clock.sleep(145_000);
        inFlight -= 1;
        return { ok: false, prune: false, retry: true, allPhones: true, error: 'app/network-error' };
      }
      sent.push(`${event.type} ${event.id}`);
      return { ok: true, prune: false };
    },
  };
  return {
    fcm,
    sent,
    inFlight: () => inFlight,
    set reachable(v) {
      reachable = v;
    },
  };
}

/** Image scans an hour old for every container: no scan health news. */
function healthy(containers, nowMs) {
  const out = {};
  for (const c of containers) {
    out[c.imageId] = {
      imageId: c.imageId,
      scanTime: new Date(nowMs - HOUR).toISOString(),
      status: 'completed',
      summary: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0, total: 0 },
    };
  }
  return out;
}

/** A fake Arcane over the recorded fixtures: what the poller and the digest read. */
function fakeArcane() {
  const containers = fx('containers');
  const s = {
    envs: fx('environments').map((e) => ({ ...e, status: 'online' })),
    containers: { [VM103]: containers },
    activities: {
      [`${VM103}:auto_update`]: fx('activities-auto_update'),
      [`${VM103}:system_prune`]: fx('activities-system_prune'),
      [`${VM103}:job_run`]: fx('activities-job_run'),
    },
    history: { [VM103]: fx('updater-history') },
    version: { ...fx('app-version'), updateAvailable: false },
    summaries: { [VM103]: healthy(containers, START) },
    overview: { [VM103]: fx('vulnerabilities-overview') },
    rows: { [VM103]: fx('vulnerabilities-all') },
  };
  const client = {
    listEnvironments: async () => clone(s.envs),
    listContainers: async (id) => clone(s.containers[id] ?? []),
    listActivities: async (id, type, limit = 20, start = 0) =>
      clone(s.activities[`${id}:${type}`] ?? []).slice(start, start + limit),
    updaterHistory: async (id) => clone(s.history[id] ?? []),
    appVersion: async () => clone(s.version),
    vulnSummaries: async (id) => clone(s.summaries[id] ?? {}),
    vulnOverview: async (id) =>
      clone(s.overview[id] ?? { drivers: { knownExploited: 0, imagesScanned: 0 } }),
    listVulnerabilities: async (id, { start = 0, limit = 100 } = {}) => {
      const rows = s.rows[id] ?? [];
      return { data: clone(rows.slice(start, start + limit)), totalItems: rows.length };
    },
  };
  return { s, client };
}

/** A finished update run Arcane's scheduler started (`n` tells runs apart), with its results. */
function updateRun(s, n) {
  const startedAt = `2026-10-18T0${n}:00:00Z`;
  const a = {
    id: `act-au-new-${n}`,
    type: 'auto_update',
    status: 'success',
    startedAt,
    endedAt: `2026-10-18T0${n}:05:00Z`,
    error: '',
    batchId: `run-new-${n}`,
  };
  s.activities[`${VM103}:job_run`].unshift({
    id: `job-new-${n}`,
    type: 'job_run',
    status: 'success',
    batchId: a.batchId,
    startedAt,
    endedAt: a.endedAt,
    metadata: { trigger: 'scheduled', runId: a.batchId, domainActivityId: a.id },
  });
  s.activities[`${VM103}:auto_update`].unshift(a);
  s.history[VM103].unshift({
    id: `uh-gitea-${n}`,
    createdAt: `2026-10-18T0${n}:01:00Z`,
    resourceName: 'gitea',
    status: 'updated',
    oldImageVersions: { main: 'gitea:old' },
    newImageVersions: { main: 'gitea:new' },
    error: '',
  });
  return a.id;
}

/** A new critical finding with a fix, on an image a container uses. */
const NEW_FINDING = {
  vulnerabilityId: 'CVE-2099-0100',
  pkgName: 'bash',
  installedVersion: '5.1',
  fixedVersion: '5.2',
  severity: 'CRITICAL',
  imageId: 'sha256:fff666',
  imageName: 'nextcloud:30',
};
const setAgent = (s, name, status) => {
  s.envs.find((e) => e.name === name).status = status;
};

/**
 * JagHelm, as far as Arcane's notices go: the push snapshot in `dir`, its
 * sender, and the poller and digest with their state opened from it, as
 * startArcane opens them. A second `start` on the same dir is a restart.
 */
function start(dir, { arcane, clock, fcm, push = () => true, sender: senderOf, write, onRun } = {}) {
  const snapshot = createPushSnapshot({
    path: join(dir, SNAPSHOT),
    logger: silent,
    now: clock.now,
    ...(write ? { write } : {}),
  });
  const sender = senderOf
    ? senderOf(snapshot)
    : createPushSender({ outbox: snapshot, store: onePhone(), fcm, logger: silent, sleep: clock.sleep, now: clock.now });
  const runs = [];
  const recordRun = (r) => {
    onRun?.(r);
    runs.push(r);
  };
  const opened = { snapshot, sender, isPushEnabled: push, dir, logger: silent };
  const poller = createArcanePoller({
    client: arcane.client,
    ...openPollerState(opened),
    recordRun,
    checkOnlyEnvs: new Set(),
    logger: silent,
    now: clock.now,
  });
  const digest = createVulnDigest({
    client: arcane.client,
    ...openDigestState(opened),
    recordRun,
    logger: silent,
    envs: new Set(['vm-103']),
    now: clock.now,
    sleep: async () => {},
  });
  return { snapshot, sender, poller, digest, runs };
}

const fileOf = (dir) => JSON.parse(readFileSync(join(dir, SNAPSHOT), 'utf8'));
const outboxOf = (dir) => (fileOf(dir).outbox ?? []).map((e) => `${e.event.type} ${e.event.id}`);
const recordsOf = (dir) =>
  (fileOf(dir).history?.events ?? []).map((r) => `${r.type} ${r.key} ${r.push.state}`);

/** Resolves to 'settled', or 'stuck' when `promise` hasn't settled within a second. */
function settles(promise) {
  return Promise.race([
    promise.then(() => 'settled'),
    new Promise((resolve) => setTimeout(resolve, 1000, 'stuck').unref()),
  ]);
}

test('#581: an update, an agent offline and the digest go out through the outbox, in order, in one write each, and GET /api/events lists them', async (t) => {
  const dir = tmp(t);
  const clock = fakeClock();
  const g = google(clock);
  const arcane = fakeArcane();
  let writes = 0;
  let id = null;
  let atCronRun = null; // what the file held when the update run's cron run was recorded
  const jh = start(dir, {
    arcane,
    clock,
    fcm: g.fcm,
    write: (path, data) => {
      writes += 1;
      atomicWriteFileSync(path, data);
    },
    onRun: (run) => {
      if (run.job !== 'arcane-update') return;
      const seen = fileOf(dir).producers[POLLER].state.envs['vm-103'].activities.includes(id);
      atCronRun ??= { writes, outbox: outboxOf(dir), seen };
    },
  });
  await jh.poller.pollOnce(); // the silent baselines
  await jh.digest.runOnce();

  id = updateRun(arcane.s, 3);
  setAgent(arcane.s, 'pi-2', 'offline');
  writes = 0;
  assert.deepEqual(types((await jh.poller.pollOnce()).events), ['arcane_update']);
  assert.deepEqual(
    atCronRun,
    { writes: 1, outbox: ['arcane_update arcane:vm-103:update'], seen: true },
    'one write holds the activity seen and its push queued; its cron run is recorded after it'
  );
  assert.deepEqual(types((await jh.poller.pollOnce()).events), ['arcane_agent_offline']);
  arcane.s.rows[VM103].push(NEW_FINDING);
  await clock.tick(7 * 24 * HOUR);
  arcane.s.summaries[VM103] = healthy(arcane.s.containers[VM103], clock.now());
  assert.deepEqual(types((await jh.digest.runOnce()).events), ['arcane_vulns']);
  await jh.sender.idle();
  await clock.flush();

  assert.deepEqual(g.sent, [
    'arcane_update arcane:vm-103:update',
    'arcane_agent_offline arcane:pi-2:agent',
    'arcane_vulns arcane:vm-103:vulns',
  ]);
  assert.deepEqual(outboxOf(dir), []);
  const app = express();
  app.use('/api/events', createEventsRoutes({ history: jh.snapshot }));
  const res = await request(app).get('/api/events');
  assert.equal(res.status, 200);
  assert.deepEqual(
    res.body.events.map((e) => [e.type, e.key, e.entity, e.push.state, e.push.phones]),
    [
      ['arcane_vulns', 'arcane:vm-103:vulns', null, 'sent', 1],
      ['arcane_agent_offline', 'arcane:pi-2:agent', 'integrations/arcane:pi-2', 'sent', 1],
      ['arcane_update', 'arcane:vm-103:update', null, 'sent', 1],
    ]
  );
  assert.equal(res.body.events[2].body, '1 updated: gitea');
});

test('#581: Google out of reach stalls neither Arcane loop (fake clock); its notices go out in order once it answers', async (t) => {
  const dir = tmp(t);
  const clock = fakeClock();
  const g = google(clock);
  const arcane = fakeArcane();
  const jh = start(dir, { arcane, clock, fcm: g.fcm });
  await jh.poller.pollOnce();
  await jh.digest.runOnce();
  g.reachable = false;

  updateRun(arcane.s, 3);
  setAgent(arcane.s, 'pi-2', 'offline');
  const first = jh.poller.pollOnce();
  assert.equal(await settles(first), 'settled', 'the poll returns while its push hangs');
  assert.deepEqual(types((await first).events), ['arcane_update']);
  await clock.flush();
  assert.equal(g.inFlight(), 1, 'the sender is waiting on Google');
  const second = jh.poller.pollOnce();
  assert.equal(await settles(second), 'settled');
  assert.deepEqual(types((await second).events), ['arcane_agent_offline']);
  assert.equal(await settles(jh.poller.checkRelease()), 'settled');
  arcane.s.rows[VM103].push(NEW_FINDING);
  const run = jh.digest.runOnce();
  assert.equal(await settles(run), 'settled', 'the digest returns too');
  assert.deepEqual(types((await run).events), ['arcane_vulns']);
  assert.deepEqual(outboxOf(dir), [
    'arcane_update arcane:vm-103:update',
    'arcane_agent_offline arcane:pi-2:agent',
    'arcane_vulns arcane:vm-103:vulns',
  ]);
  assert.equal(g.inFlight(), 1, 'still one send: the loops sent nothing themselves');

  await clock.tick(145_000); // the send fails for every phone; the sender waits 10 s
  assert.deepEqual(g.sent, []);
  g.reachable = true;
  await clock.tick(10_000);
  await jh.sender.idle();
  assert.deepEqual(g.sent, [
    'arcane_update arcane:vm-103:update',
    'arcane_agent_offline arcane:pi-2:agent',
    'arcane_vulns arcane:vm-103:vulns',
  ]);
  assert.deepEqual(outboxOf(dir), []);
});

test('#581: a crash before the write loses no notice, one after it repeats none (real data dir)', async (t) => {
  const dir = tmp(t);
  const clock = fakeClock();
  const arcane = fakeArcane();

  // Before: the process dies as it writes the poll that found an update run
  // and the digest that found a new finding. The write never lands.
  const g1 = google(clock);
  let crashed = false;
  const a = start(dir, {
    arcane,
    clock,
    fcm: g1.fcm,
    write: (path, data) => {
      if (crashed) return; // gone: nothing after this happened
      atomicWriteFileSync(path, data);
    },
  });
  await a.poller.pollOnce();
  await a.digest.runOnce();
  updateRun(arcane.s, 3);
  arcane.s.rows[VM103].push(NEW_FINDING);
  crashed = true;
  g1.reachable = false;
  await a.poller.pollOnce();
  await a.digest.runOnce();
  assert.deepEqual(outboxOf(dir), [], 'nothing of it on disk');

  // After the restart both find it again, and queue it once.
  const g2 = google(clock);
  g2.reachable = false; // so it stays queued
  const b = start(dir, { arcane, clock, fcm: g2.fcm });
  assert.deepEqual(types((await b.poller.pollOnce()).events), ['arcane_update']);
  assert.deepEqual(types((await b.digest.runOnce()).events), ['arcane_vulns']);
  assert.deepEqual(outboxOf(dir), ['arcane_update arcane:vm-103:update', 'arcane_vulns arcane:vm-103:vulns']);
  assert.deepEqual(recordsOf(dir), [
    'arcane_update arcane:vm-103:update queued',
    'arcane_vulns arcane:vm-103:vulns queued',
  ]);
  assert.deepEqual(
    b.runs.map((r) => r.job),
    ['arcane-update', 'arcane-vuln-digest'],
    'each cron run once'
  );

  // After: the process dies with both on disk, a send still in flight. The
  // restart finds nothing again and sends each once.
  const g3 = google(clock);
  const c = start(dir, { arcane, clock, fcm: g3.fcm });
  assert.deepEqual((await c.poller.pollOnce()).events, []);
  const again = await c.digest.runOnce();
  assert.deepEqual([again.results[0].outcome, again.events], ['digest', []]);
  c.sender.wake(); // the refresh loop's first cycle does this
  await c.sender.idle();
  assert.deepEqual(g3.sent, ['arcane_update arcane:vm-103:update', 'arcane_vulns arcane:vm-103:vulns']);
  assert.deepEqual(outboxOf(dir), []);
  assert.deepEqual(recordsOf(dir), [
    'arcane_update arcane:vm-103:update sent',
    'arcane_vulns arcane:vm-103:vulns sent',
  ]);
  assert.deepEqual(
    c.runs.map((r) => r.job),
    ['arcane-vuln-digest'],
    "the update run's cron run not recorded again (each digest records its own)"
  );
});

test("#581: an agent's offline and its recovery, both unsent, leave the outbox together; updates never collapse", async (t) => {
  const dir = tmp(t);
  const clock = fakeClock();
  const arcane = fakeArcane();
  // Push is on and nothing is sent yet: the sender isn't woken.
  const jh = start(dir, { arcane, clock, sender: () => ({ wake() {} }) });
  await jh.poller.pollOnce();

  setAgent(arcane.s, 'pi-2', 'offline');
  await jh.poller.pollOnce();
  await jh.poller.pollOnce();
  updateRun(arcane.s, 3);
  await jh.poller.pollOnce();
  updateRun(arcane.s, 4);
  await jh.poller.pollOnce();
  assert.deepEqual(outboxOf(dir), [
    'arcane_agent_offline arcane:pi-2:agent',
    'arcane_update arcane:vm-103:update',
    'arcane_update arcane:vm-103:update',
  ]);
  setAgent(arcane.s, 'pi-2', 'online');
  assert.deepEqual(types((await jh.poller.pollOnce()).events), ['arcane_agent_recovered']);
  assert.deepEqual(outboxOf(dir), ['arcane_update arcane:vm-103:update', 'arcane_update arcane:vm-103:update']);
  assert.deepEqual(recordsOf(dir), [
    'arcane_agent_offline arcane:pi-2:agent dropped',
    'arcane_update arcane:vm-103:update queued',
    'arcane_update arcane:vm-103:update queued',
    'arcane_agent_recovered arcane:pi-2:agent dropped',
  ]);
});

test('#581: with push off the notices are recorded, not queued, and the state moves: push turned on later sends nothing old', async (t) => {
  const dir = tmp(t);
  const clock = fakeClock();
  const arcane = fakeArcane();
  let push = false;
  const g = google(clock);
  const jh = start(dir, { arcane, clock, fcm: g.fcm, push: () => push });
  await jh.poller.pollOnce();
  await jh.digest.runOnce();
  updateRun(arcane.s, 3);
  arcane.s.rows[VM103].push(NEW_FINDING);
  assert.deepEqual(types((await jh.poller.pollOnce()).events), ['arcane_update']);
  assert.deepEqual(types((await jh.digest.runOnce()).events), ['arcane_vulns']);
  assert.deepEqual(outboxOf(dir), []);
  assert.deepEqual(recordsOf(dir), [
    'arcane_update arcane:vm-103:update off',
    'arcane_vulns arcane:vm-103:vulns off',
  ]);

  push = true;
  assert.deepEqual((await jh.poller.pollOnce()).events, []);
  assert.deepEqual((await jh.digest.runOnce()).events, []);
  jh.sender.wake();
  await jh.sender.idle();
  assert.deepEqual(g.sent, []);
});

/** Write an old state file as an older JagHelm did at `atMs`. */
function writeOld(dir, name, text, atMs) {
  writeFileSync(join(dir, name), text);
  utimesSync(join(dir, name), atMs / 1000, atMs / 1000);
}

/**
 * The state a JagHelm before #581 kept in its own files, from a run of the
 * poller and digest; the digest's keys in its shape ([repo, id, pkg, sev]).
 */
async function oldFiles(t, arcane, clock) {
  const from = tmp(t);
  const jh = start(from, { arcane, clock, sender: () => ({ wake() {} }) });
  await jh.poller.pollOnce();
  await jh.digest.runOnce();
  updateRun(arcane.s, 3);
  setAgent(arcane.s, 'pi-2', 'offline');
  await jh.poller.pollOnce();
  await jh.poller.pollOnce(); // pi-2 offline: alerted
  arcane.s.version = { ...arcane.s.version, newestVersion: '9.9.9', updateAvailable: true };
  assert.equal((await jh.poller.checkRelease()).length, 1);
  const { producers } = fileOf(from);
  const imageIds = new Set(arcane.s.containers[VM103].map((c) => c.imageId));
  const vulns = structuredClone(producers[DIGEST].vulns);
  vulns.envs['vm-103'].keys = [...currentFindings(arcane.s.rows[VM103], { imageIds }).values()].map((e) => [
    e.repo,
    e.id,
    e.pkg,
    e.sev,
  ]);
  // As the old stores wrote them: arcane-state.json and arcane-held-back.json
  // indented, arcane-vuln-state.json compact.
  return {
    [OLD_FILES.state]: JSON.stringify(producers[POLLER].state, null, 2),
    [OLD_FILES.heldBack]: JSON.stringify(producers[POLLER].heldBack, null, 2),
    [OLD_FILES.vulns]: JSON.stringify(vulns),
  };
}

test('#581: the upgrade reads the old Arcane state files once, sends nothing again, and leaves them in place', async (t) => {
  const clock = fakeClock();
  const arcane = fakeArcane();
  const old = await oldFiles(t, arcane, clock);
  const dir = tmp(t);
  for (const [name, text] of Object.entries(old)) writeOld(dir, name, text, START - HOUR);
  // A push snapshot from before #581: no producers.
  writeFileSync(join(dir, SNAPSHOT), JSON.stringify({ services: {}, hosts: {}, ups: { state: 'online' }, cron: {} }));

  const g = google(clock);
  const jh = start(dir, { arcane, clock, fcm: g.fcm });
  assert.ok(fileOf(dir).producers[POLLER], 'written at once');
  assert.ok(fileOf(dir).producers[DIGEST]);
  assert.deepEqual((await jh.poller.pollOnce()).events, [], 'the update run, held-back set and offline agent are known');
  assert.deepEqual(await jh.poller.checkRelease(), [], 'the release is known');
  const run = await jh.digest.runOnce();
  assert.deepEqual(
    [run.results[0].outcome, run.results[0].digest.push, run.events],
    ['digest', false, []],
    'the findings are known: a digest, not a baseline'
  );
  setAgent(arcane.s, 'pi-2', 'online');
  assert.deepEqual(types((await jh.poller.pollOnce()).events), ['arcane_agent_recovered'], 'the alerted flag came along');
  arcane.s.rows[VM103].push(NEW_FINDING);
  const news = await jh.digest.runOnce();
  assert.deepEqual([news.results[0].digest.newCritical, news.results[0].digest.newHigh], [1, 0], 'only the new finding is new');
  await jh.sender.idle();
  for (const [name, text] of Object.entries(old)) {
    assert.equal(readFileSync(join(dir, name), 'utf8'), text, `${name} left as it was`);
  }

  // Read once: from now on the snapshot holds the state, and an old file no
  // JagHelm wrote since is not read.
  writeOld(
    dir,
    OLD_FILES.state,
    JSON.stringify({ envs: { 'pi-2': { known: true, agent: { downPolls: 2, alerted: true }, activities: [] } } }),
    START - HOUR / 2
  );
  rmSync(join(dir, OLD_FILES.vulns));
  const again = start(dir, { arcane, clock, fcm: g.fcm });
  assert.deepEqual((await again.poller.pollOnce()).events, []);
  assert.equal((await again.digest.runOnce()).results[0].outcome, 'digest');
  assert.deepEqual(g.sent, ['arcane_agent_recovered arcane:pi-2:agent', 'arcane_vulns arcane:vm-103:vulns']);
});

test('#581 review: a roll-forward after a rollback takes the old files the older JagHelm wrote since, not the stale producers it left in the snapshot', async (t) => {
  const clock = fakeClock();
  const arcane = fakeArcane();
  const stub = () => ({ wake() {} });
  const dir = tmp(t);
  const jh = start(dir, { arcane, clock, sender: stub });
  await jh.poller.pollOnce();
  await jh.digest.runOnce();
  assert.equal(fileOf(dir).producers[POLLER].savedAt, START);
  assert.equal(fileOf(dir).producers[DIGEST].savedAt, START);

  // Rolled back for an hour: the older JagHelm notifies an update run, pi-2
  // offline and a release into its own files, and leaves `producers` as they were.
  await clock.tick(HOUR);
  const old = await oldFiles(t, arcane, clock);
  for (const [name, text] of Object.entries(old)) writeOld(dir, name, text, clock.now());
  assert.equal(fileOf(dir).producers[POLLER].savedAt, START, 'stale in the snapshot');

  await clock.tick(HOUR);
  const rolled = start(dir, { arcane, clock, sender: stub });
  assert.deepEqual((await rolled.poller.pollOnce()).events, [], 'the update run and pi-2 offline were notified during the rollback');
  assert.deepEqual(await rolled.poller.checkRelease(), [], 'so was the release');
  assert.equal(fileOf(dir).producers[POLLER].savedAt, START + 2 * HOUR, 'the old files taken in');
  assert.equal(fileOf(dir).producers[DIGEST].savedAt, START + 2 * HOUR);
  assert.equal((await rolled.digest.runOnce()).results[0].outcome, 'digest');

  // Old files older than the snapshot's copy are not read: no write at the start.
  const later = tmp(t);
  writeFileSync(join(later, SNAPSHOT), readFileSync(join(dir, SNAPSHOT)));
  for (const [name, text] of Object.entries(old)) writeOld(later, name, text, START + HOUR);
  const savedAt = fileOf(later).producers[POLLER].savedAt;
  start(later, { arcane, clock, sender: stub });
  assert.equal(fileOf(later).producers[POLLER].savedAt, savedAt);
});

test('#581: a push snapshot that does not parse is moved aside, and the old files are not read in its place', async (t) => {
  const dir = tmp(t);
  const clock = fakeClock();
  const arcane = fakeArcane();
  // Old files that would page pi-2's recovery if they were read.
  writeOld(
    dir,
    OLD_FILES.state,
    JSON.stringify({ envs: { 'pi-2': { known: true, agent: { downPolls: 2, alerted: true }, activities: [] } } }),
    START + HOUR
  );
  writeFileSync(join(dir, SNAPSHOT), '{"producers": {"arcane": ');
  const jh = start(dir, { arcane, clock, sender: () => ({ wake() {} }) });
  assert.equal(jh.snapshot.unreadable(), true);
  assert.deepEqual((await jh.poller.pollOnce()).events, [], 'a fresh start: a silent baseline');
  assert.equal(existsSync(join(dir, OLD_FILES.state)), true);
});
