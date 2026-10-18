// server/arcane/vulnDigest.test.js
// Stub client/dispatch/recordRun; the REAL vulnStateStore on a mkdtemp path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVulnDigest, nextSlotMs, WEEK_MS, MAX_FINDINGS, DIGEST_JOB } from './vulnDigest.js';
import { createVulnStateStore } from './vulnStateStore.js';
import { ArcaneError } from './client.js';

const fxRaw = (n) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), 'utf8'));
const fx = (n) => {
  const body = fxRaw(n);
  return 'success' in body ? body.data : body;
};
const clone = (v) => structuredClone(v);
const silent = { debug() {}, info() {}, warn() {}, error() {} };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// Sunday 2026-10-18 14:00 UTC: the default slot.
const SUN_1400 = Date.parse('2026-10-18T14:00:00Z');

const VM103 = '0';
const VM101 = '1';
const PI2 = '3';

const row = (imageName, id, pkg, severity = 'HIGH') => ({
  vulnerabilityId: id,
  pkgName: pkg,
  installedVersion: '1',
  fixedVersion: '2',
  severity,
  imageId: 'sha256:x',
  imageName,
});

/** Every container image of the fixture scanned an hour ago: no scan health problem. */
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

/** A fake Arcane manager with vulnerability results on vm-103 only. */
function world(nowMs = SUN_1400) {
  const containers = fx('containers');
  const s = {
    envs: [
      { id: VM103, name: 'vm-103', status: 'online' },
      { id: VM101, name: 'vm-101', status: 'online' },
      { id: PI2, name: 'pi-2', status: 'offline' },
    ],
    containers: {
      [VM103]: containers,
      [VM101]: [{ names: ['/x'], image: 'x:1', imageId: 'sha256:x1', state: 'running' }],
    },
    summaries: { [VM103]: healthy(containers, nowMs) },
    overview: {
      [VM103]: fx('vulnerabilities-overview'),
      [VM101]: { drivers: { knownExploited: 0, imagesScanned: 0 }, threatIntel: { enabled: true } },
    },
    rows: { [VM103]: fx('vulnerabilities-all') },
    total: {}, // id -> totalItems override (function of call number or a number)
    fail: {}, // call key -> Error
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
    async listContainers(id) {
      hit(`containers:${id}`);
      return clone(s.containers[id] ?? []);
    },
    async vulnSummaries(id, imageIds) {
      hit(`summaries:${id}`);
      s.lastImageIds = imageIds;
      return clone(s.summaries[id] ?? {});
    },
    async vulnOverview(id) {
      hit(`overview:${id}`);
      return clone(
        s.overview[id] ?? {
          drivers: { knownExploited: 0, imagesScanned: 0 },
          threatIntel: { enabled: true },
        }
      );
    },
    async listVulnerabilities(id, { start = 0, limit = 100 } = {}) {
      hit(`findings:${id}`);
      s.pages = (s.pages || 0) + 1;
      const rows = s.rows[id] ?? [];
      const t = s.total[id];
      const totalItems = typeof t === 'function' ? t(s.pages) : (t ?? rows.length);
      return { data: clone(rows.slice(start, start + Math.min(limit, 100))), totalItems };
    },
  };
  return { s, client };
}

function setup(
  t,
  { w = world(), dispatch, logger, now, fcm, sleep, setTimer, clearTimer, day, hour, dir } = {}
) {
  if (!dir) {
    dir = mkdtempSync(join(tmpdir(), 'arcane-vuln-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
  }
  const statePath = join(dir, 'arcane-vuln-state.json');
  const stateStore = createVulnStateStore({ path: statePath });
  const runs = [];
  const dispatched = [];
  const clock = { ms: SUN_1400 };
  const digest = createVulnDigest({
    client: w.client,
    stateStore,
    recordRun: (r) => runs.push(r),
    dispatch: dispatch || (async (events, deps) => dispatched.push({ events, deps })),
    pushStore: { name: 'push-store' },
    fcm: fcm || { name: 'fcm' },
    logger: logger || silent,
    now: now || (() => clock.ms),
    ...(sleep ? { sleep } : {}),
    ...(setTimer ? { setTimer } : {}),
    ...(clearTimer ? { clearTimer } : {}),
    ...(day !== undefined ? { day } : {}),
    ...(hour !== undefined ? { hour } : {}),
  });
  const pushes = () => dispatched.flatMap((d) => d.events);
  return { dir, w, s: w.s, digest, stateStore, runs, dispatched, pushes, statePath, clock };
}

const capture = () => {
  const lines = [];
  const at = (level) => (fields, msg) => lines.push({ level, fields, msg });
  return { lines, logger: { debug() {}, info: at('info'), warn: at('warn'), error: at('error') } };
};

test('first run is a silent baseline: no push, a success run, keys stored', async (t) => {
  const { digest, runs, pushes, stateStore, s } = setup(t);
  const { results } = await digest.runOnce();
  assert.deepEqual(pushes(), []);
  assert.deepEqual(runs, [
    { job: DIGEST_JOB, node: 'vm-103', status: 'success', expected_every_seconds: 604800 },
  ]);
  assert.equal(stateStore.getEnv('vm-103').keys.size, 5);
  assert.equal(stateStore.getEnv('vm-103').kev, 1);
  assert.equal(stateStore.getLastRun(), SUN_1400);
  // vm-101 has no scan results: skipped, nothing recorded. pi-2 is offline and unknown.
  assert.deepEqual(
    results.map((r) => [r.env, r.outcome]),
    [
      ['pi-2', 'down'],
      ['vm-101', 'no-results'],
      ['vm-103', 'baseline'],
    ]
  );
  assert.equal(stateStore.isKnown('vm-101'), false);
  // vm-101 was never paged: no results, nothing to read.
  assert.equal(s.calls.includes('findings:1'), false);
});

test("the digest only reads: the image ids asked for are the containers' images, once each", async (t) => {
  const w = world();
  w.s.containers[VM103].push({ ...w.s.containers[VM103][0], names: ['/twin'] });
  const { digest, s } = setup(t, { w });
  await digest.runOnce();
  assert.deepEqual(s.lastImageIds, [
    'sha256:aaa111',
    'sha256:ccc333',
    'sha256:eee555',
    'sha256:fff666',
    'sha256:999777',
  ]);
  const kinds = new Set(s.calls.map((c) => c.split(':')[0]));
  assert.deepEqual([...kinds].sort(), [
    'containers',
    'environments',
    'findings',
    'overview',
    'summaries',
  ]);
});

test('unchanged findings next week: no push, a success run', async (t) => {
  const { digest, runs, pushes, clock } = setup(t);
  await digest.runOnce();
  // A week on, the scans (an hour before the first run) are 7 days old: not yet stale.
  clock.ms += WEEK_MS;
  const { events } = await digest.runOnce();
  assert.deepEqual(events, []);
  assert.deepEqual(pushes(), []);
  assert.equal(runs.length, 2);
  assert.equal(runs[1].status, 'success');
});

test('new critical and high findings push once, with the top images and what was fixed', async (t) => {
  const w = world();
  const { digest, pushes, stateStore } = setup(t, { w });
  await digest.runOnce();
  const rows = w.s.rows[VM103];
  rows.splice(4, 1); // redis zlib fixed
  rows.push(
    row('nextcloud:30', 'CVE-2099-0100', 'php', 'CRITICAL'),
    row('docker.io/library/nextcloud:31', 'CVE-2099-0101', 'apache2', 'CRITICAL'),
    row('nextcloud:30', 'CVE-2099-0102', 'curl'),
    row('ghcr.io/immich-app/immich-server:release', 'CVE-2099-0103', 'node', 'CRITICAL'),
    row('gitea/gitea:1.22', 'CVE-2099-0104', 'git'),
    // Same key as an existing finding under another tag: not new.
    row('gitea/gitea:1.23', 'CVE-2099-0002', 'libcurl')
  );
  const { events } = await digest.runOnce();
  assert.deepEqual(events, [
    {
      type: 'arcane_vulns',
      id: 'arcane:vm-103:vulns',
      node: 'vm-103',
      title: 'Vulnerabilities · vm-103',
      body:
        '3 new critical, 2 new high (fix available) · 3 images · ' +
        'top: nextcloud 2C 1H, immich-server 1C, gitea 1H · KEV 1 · 1 fixed',
      severity: 'warning',
    },
  ]);
  assert.equal(stateStore.getEnv('vm-103').keys.size, 9);
  // Pushed once: the same results again are not news.
  await digest.runOnce();
  assert.equal(pushes().length, 1);
});

test('fixed findings alone never push', async (t) => {
  const w = world();
  const { digest, pushes, runs, stateStore } = setup(t, { w });
  await digest.runOnce();
  w.s.rows[VM103] = w.s.rows[VM103].slice(0, 2);
  await digest.runOnce();
  assert.deepEqual(pushes(), []);
  assert.equal(runs[1].status, 'success');
  assert.equal(stateStore.getEnv('vm-103').keys.size, 2);
});

test('a new KEV entry pushes a warning; the count stays when threat intel goes quiet', async (t) => {
  const w = world();
  const { digest, pushes, stateStore } = setup(t, { w });
  await digest.runOnce();
  w.s.overview[VM103].drivers.knownExploited = 2;
  await digest.runOnce();
  assert.deepEqual(
    pushes().map((e) => [e.body, e.severity]),
    [['KEV 2 (1 new)', 'warning']]
  );
  // Threat intel off: the count is unknown, nothing pushes and the last count is kept.
  w.s.overview[VM103].threatIntel.enabled = false;
  await digest.runOnce();
  assert.equal(stateStore.getEnv('vm-103').kev, 2);
  w.s.overview[VM103].threatIntel.enabled = true;
  await digest.runOnce();
  assert.equal(pushes().length, 1);
});

test('scan health: stale and failed scans push as info every week while they last', async (t) => {
  const w = world();
  w.s.summaries[VM103] = fx('vulnerabilities-summaries').summaries;
  const { digest, pushes, runs } = setup(t, { w });
  await digest.runOnce(); // baseline: silent even with health problems
  assert.deepEqual(pushes(), []);
  await digest.runOnce();
  await digest.runOnce();
  assert.deepEqual(
    pushes().map((e) => [e.body, e.severity]),
    [
      ['KEV 1 · 1 image not scanned in 9 days: redis · 1 scan failed: nextcloud', 'info'],
      ['KEV 1 · 1 image not scanned in 9 days: redis · 1 scan failed: nextcloud', 'info'],
    ]
  );
  assert.deepEqual(
    runs.map((r) => r.status),
    ['success', 'success', 'success']
  );
});

test('a failed scan hides its findings without reporting them fixed, or new once it scans again', async (t) => {
  const w = world();
  const { digest, pushes, stateStore } = setup(t, { w });
  await digest.runOnce();
  const all = w.s.rows[VM103];
  // gitea's latest scan failed: Arcane lists none of its findings.
  w.s.summaries[VM103]['sha256:ccc333'].status = 'failed';
  w.s.rows[VM103] = all.filter((r) => !r.imageName.startsWith('gitea/'));
  await digest.runOnce();
  assert.deepEqual(
    pushes().map((e) => e.body),
    ['KEV 1 · 1 scan failed: gitea']
  );
  assert.equal(stateStore.getEnv('vm-103').keys.size, 5);
  // It scans again with the same findings: nothing new.
  w.s.summaries[VM103]['sha256:ccc333'].status = 'completed';
  w.s.rows[VM103] = all;
  await digest.runOnce();
  assert.equal(pushes().length, 1);
});

test('403 (no vulnerabilities:read): no push, no run recorded, state untouched, logged once', async (t) => {
  const w = world();
  const { lines, logger } = capture();
  const { digest, runs, pushes, stateStore } = setup(t, { w, logger });
  const denied = new ArcaneError(
    'Arcane HTTP 403 for /api/environments/0/images/vulnerabilities/summaries',
    403
  );
  w.s.fail['summaries:0'] = denied;
  const first = await digest.runOnce();
  await digest.runOnce();
  assert.deepEqual(pushes(), []);
  assert.deepEqual(runs, []);
  assert.equal(stateStore.isKnown('vm-103'), false);
  assert.deepEqual(
    first.results.find((r) => r.env === 'vm-103'),
    { env: 'vm-103', outcome: 'no-permission', error: denied.message }
  );
  const warns = lines.filter((l) => l.level === 'warn');
  assert.equal(warns.length, 1);
  assert.match(warns[0].msg, /vulnerabilities:read/);
  assert.equal(warns[0].fields.env, 'vm-103');
  // Granted later: the next run baselines, and the recovery is logged once.
  delete w.s.fail['summaries:0'];
  await digest.runOnce();
  assert.equal(stateStore.isKnown('vm-103'), true);
  assert.equal(lines.filter((l) => /recovered/.test(l.msg)).length, 1);
});

test('403 on a digested environment records nothing (as the poller does) and keeps its state', async (t) => {
  const w = world();
  const { digest, runs, stateStore } = setup(t, { w });
  await digest.runOnce();
  const before = stateStore.getEnv('vm-103');
  w.s.fail['findings:0'] = new ArcaneError(
    'Arcane HTTP 403 for /api/environments/0/vulnerabilities/all',
    403
  );
  await digest.runOnce();
  assert.equal(runs.length, 1);
  assert.deepEqual(stateStore.getEnv('vm-103'), before);
  // 401 is the same.
  w.s.fail['findings:0'] = new ArcaneError(
    'Arcane HTTP 401 for /api/environments/0/vulnerabilities/all',
    401
  );
  await digest.runOnce();
  assert.equal(runs.length, 1);
});

test('a read failure records a failure for a digested environment, nothing for a new one', async (t) => {
  const w = world();
  const { lines, logger } = capture();
  const { digest, runs, stateStore, pushes } = setup(t, { w, logger });
  w.s.fail['overview:0'] = new ArcaneError(
    'Arcane HTTP 500 for /api/environments/0/vulnerabilities/overview',
    500
  );
  await digest.runOnce();
  assert.deepEqual(runs, []);
  delete w.s.fail['overview:0'];
  await digest.runOnce(); // baseline
  const before = stateStore.getEnv('vm-103');
  w.s.fail['findings:0'] = new ArcaneError(
    'Arcane request failed: fetch failed (ECONNRESET)',
    null
  );
  const { results } = await digest.runOnce();
  assert.deepEqual(runs.at(-1), {
    job: DIGEST_JOB,
    node: 'vm-103',
    status: 'failure',
    error: 'Arcane request failed: fetch failed (ECONNRESET)',
    expected_every_seconds: 604800,
  });
  assert.equal(results.find((r) => r.env === 'vm-103').outcome, 'error');
  assert.deepEqual(stateStore.getEnv('vm-103'), before);
  assert.deepEqual(pushes(), []);
  // Each distinct error is logged once, never the key.
  assert.equal(lines.filter((l) => l.level === 'warn').length, 2);
});

test('an offline environment that was digested records a failure', async (t) => {
  const w = world();
  const { digest, runs } = setup(t, { w });
  await digest.runOnce();
  w.s.envs[0].status = 'offline';
  await digest.runOnce();
  assert.deepEqual(runs.at(-1), {
    job: DIGEST_JOB,
    node: 'vm-103',
    status: 'failure',
    error: 'Arcane agent not online; vulnerability results not read',
    expected_every_seconds: 604800,
  });
});

test('the environment list failing records a failure for each digested environment', async (t) => {
  const w = world();
  const { digest, runs, stateStore } = setup(t, { w });
  await digest.runOnce();
  w.s.fail.environments = new ArcaneError('Arcane HTTP 502 for /api/environments', 502);
  const { results } = await digest.runOnce();
  assert.deepEqual(
    runs.slice(1).map((r) => [r.node, r.status, r.error]),
    [['vm-103', 'failure', 'Arcane HTTP 502 for /api/environments']]
  );
  assert.deepEqual(results, [
    { env: null, outcome: 'error', error: 'Arcane HTTP 502 for /api/environments' },
  ]);
  assert.equal(stateStore.getLastRun(), SUN_1400);
});

test('findings are read page by page, 100 at a time, up to totalItems', async (t) => {
  const w = world();
  w.s.rows[VM103] = Array.from({ length: 250 }, (_, i) =>
    row('app:1', `CVE-2099-${1000 + i}`, 'p')
  );
  const { digest, stateStore, s } = setup(t, { w });
  await digest.runOnce();
  assert.equal(s.calls.filter((c) => c === 'findings:0').length, 3);
  assert.equal(stateStore.getEnv('vm-103').keys.size, 250);
});

test('a total that changes between pages, or a short read, is a read failure', async (t) => {
  for (const total of [(page) => (page === 1 ? 250 : 251), () => 300]) {
    const w = world();
    w.s.rows[VM103] = Array.from({ length: 250 }, (_, i) =>
      row('app:1', `CVE-2099-${1000 + i}`, 'p')
    );
    w.s.total[VM103] = total;
    const { digest, stateStore } = setup(t, { w });
    const { results } = await digest.runOnce();
    const r = results.find((x) => x.env === 'vm-103');
    assert.equal(r.outcome, 'error');
    assert.match(r.error, /changed while being read|incomplete/);
    assert.equal(stateStore.isKnown('vm-103'), false);
  }
});

test(`more than ${MAX_FINDINGS} critical and high findings is a read failure, not a truncated digest`, async (t) => {
  const w = world();
  w.s.total[VM103] = MAX_FINDINGS + 1;
  const { digest, s } = setup(t, { w });
  const { results } = await digest.runOnce();
  const r = results.find((x) => x.env === 'vm-103');
  assert.equal(r.outcome, 'error');
  assert.match(r.error, /more than 20000/);
  assert.equal(s.calls.filter((c) => c === 'findings:0').length, 1);
});

test('state advances before the push; a failing dispatch is swallowed', async (t) => {
  const w = world();
  const { lines, logger } = capture();
  let seen = null;
  const env = setup(t, {
    w,
    logger,
    dispatch: async () => {
      seen = env.stateStore.getEnv('vm-103').kev;
      throw new Error('fcm down');
    },
  });
  await env.digest.runOnce();
  w.s.overview[VM103].drivers.knownExploited = 4;
  const { events } = await env.digest.runOnce();
  assert.equal(events.length, 1);
  assert.equal(seen, 4);
  assert.equal(lines.filter((l) => /dispatch failed/.test(l.msg)).length, 1);
});

test('a state file survives a restart: the next process does not re-baseline', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'arcane-vuln-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const w = world();
  await setup(t, { w, dir }).digest.runOnce();
  assert.ok(existsSync(join(dir, 'arcane-vuln-state.json')));
  w.s.rows[VM103].push(row('redis:7', 'CVE-2099-0200', 'openssl', 'CRITICAL'));
  const second = setup(t, { w, dir });
  await second.digest.runOnce();
  assert.equal(second.pushes().length, 1);
});

test('nextSlotMs: the next given weekday and hour in UTC, strictly after now', () => {
  const at = (iso) => Date.parse(iso);
  // Sunday 14:00 from various points of the week.
  assert.equal(nextSlotMs(at('2026-10-18T13:59:59Z'), 0, 14), at('2026-10-18T14:00:00Z'));
  assert.equal(nextSlotMs(at('2026-10-18T14:00:00Z'), 0, 14), at('2026-10-25T14:00:00Z'));
  assert.equal(nextSlotMs(at('2026-10-21T08:00:00Z'), 0, 14), at('2026-10-25T14:00:00Z'));
  assert.equal(nextSlotMs(at('2026-10-24T23:00:00Z'), 0, 14), at('2026-10-25T14:00:00Z'));
  // Wednesday 00:00 and Saturday 23:00.
  assert.equal(nextSlotMs(at('2026-10-18T14:00:00Z'), 3, 0), at('2026-10-21T00:00:00Z'));
  assert.equal(nextSlotMs(at('2026-10-18T14:00:00Z'), 6, 23), at('2026-10-24T23:00:00Z'));
  assert.equal(WEEK_MS, 7 * DAY);
});

function timers() {
  const set = [];
  const cleared = [];
  return {
    set,
    cleared,
    setTimer: (fn, ms) => {
      const h = { fn, ms, unref() {} };
      set.push(h);
      return h;
    },
    clearTimer: (h) => cleared.push(h),
  };
}
const flush = () => new Promise((r) => setImmediate(r));

test('start: no state yet runs at once (the baseline), then waits for the next slot', async (t) => {
  const tm = timers();
  const env = setup(t, { setTimer: tm.setTimer, clearTimer: tm.clearTimer });
  env.clock.ms = Date.parse('2026-10-21T08:00:00Z'); // Wednesday
  env.digest.start();
  await flush();
  assert.equal(env.stateStore.isKnown('vm-103'), true);
  assert.equal(tm.set.length, 1);
  assert.equal(tm.set[0].ms, Date.parse('2026-10-25T14:00:00Z') - env.clock.ms);
  env.digest.stop();
  assert.deepEqual(tm.cleared, [tm.set[0]]);
});

test('start: a run since the last slot means no catch-up; the timer runs it and re-arms a week on', async (t) => {
  const tm = timers();
  const env = setup(t, { setTimer: tm.setTimer, clearTimer: tm.clearTimer });
  env.clock.ms = Date.parse('2026-10-18T15:00:00Z');
  await env.digest.runOnce(); // baseline after Sunday's slot
  const calls = env.s.calls.length;
  env.clock.ms = Date.parse('2026-10-22T10:00:00Z');
  env.digest.start();
  await flush();
  assert.equal(env.s.calls.length, calls, 'no catch-up run');
  const slot = Date.parse('2026-10-25T14:00:00Z');
  assert.equal(tm.set[0].ms, slot - env.clock.ms);
  // The slot arrives.
  env.clock.ms = slot;
  tm.set[0].fn();
  await flush();
  await flush();
  assert.ok(env.s.calls.length > calls);
  assert.equal(env.stateStore.getLastRun(), slot);
  assert.equal(tm.set.length, 2);
  assert.equal(tm.set[1].ms, WEEK_MS);
  env.digest.stop();
});

test('start: a missed slot (restart across Sunday) runs once at start', async (t) => {
  const tm = timers();
  const env = setup(t, { setTimer: tm.setTimer, clearTimer: tm.clearTimer });
  env.clock.ms = Date.parse('2026-10-11T14:00:00Z');
  await env.digest.runOnce();
  const calls = env.s.calls.length;
  env.clock.ms = Date.parse('2026-10-19T09:00:00Z'); // Monday after a missed Sunday
  env.digest.start();
  await flush();
  assert.ok(env.s.calls.length > calls);
  assert.equal(env.stateStore.getLastRun(), env.clock.ms);
  env.digest.stop();
});

test('start: honours a configured day and hour', async (t) => {
  const tm = timers();
  const env = setup(t, { setTimer: tm.setTimer, clearTimer: tm.clearTimer, day: 3, hour: 6 });
  env.clock.ms = Date.parse('2026-10-18T14:00:00Z');
  await env.digest.runOnce();
  env.digest.start();
  assert.equal(tm.set[0].ms, Date.parse('2026-10-21T06:00:00Z') - env.clock.ms);
  env.digest.stop();
});

test('start: with push configured but not ready, the catch-up run waits for it (bounded)', async (t) => {
  const tm = timers();
  let ready = false;
  const slept = [];
  const fcm = { isPushConfigured: () => true, isPushEnabled: () => ready };
  const env = setup(t, {
    setTimer: tm.setTimer,
    clearTimer: tm.clearTimer,
    fcm,
    sleep: async (ms) => {
      slept.push(ms);
      if (slept.length === 3) ready = true;
    },
  });
  env.digest.start();
  await flush();
  await flush();
  assert.equal(slept.length, 3);
  assert.equal(env.stateStore.isKnown('vm-103'), true);
  env.digest.stop();
});

test('stop before a waiting catch-up run drops it', async (t) => {
  const tm = timers();
  let release;
  const gate = new Promise((r) => (release = r));
  const fcm = { isPushConfigured: () => true, isPushEnabled: () => false };
  const env = setup(t, {
    setTimer: tm.setTimer,
    clearTimer: tm.clearTimer,
    fcm,
    sleep: () => gate,
  });
  env.digest.start();
  env.digest.stop();
  release();
  await flush();
  await flush();
  assert.equal(env.s.calls.length, 0);
});

test('start: nothing digested yet (the grant was missing) runs at once even after a run this week', async (t) => {
  const tm = timers();
  const w = world();
  w.s.fail['summaries:0'] = new ArcaneError('Arcane HTTP 403 for /x', 403);
  const env = setup(t, { w, setTimer: tm.setTimer, clearTimer: tm.clearTimer });
  await env.digest.runOnce(); // Sunday's run: refused
  assert.equal(env.stateStore.getLastRun(), SUN_1400);
  assert.equal(env.stateStore.knownCount(), 0);
  // Jag grants vulnerabilities:read and restarts JagHelm on Tuesday.
  delete w.s.fail['summaries:0'];
  env.clock.ms = Date.parse('2026-10-20T10:00:00Z');
  env.digest.start();
  await flush();
  assert.equal(env.stateStore.isKnown('vm-103'), true);
  env.digest.stop();
});
