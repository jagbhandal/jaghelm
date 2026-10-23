// server/arcane/vulnDigest.test.js
// Stub client/recordRun; the REAL vulnStateStore, opened as startArcane opens
// it from a push snapshot on a mkdtemp path (#581). Each run's notices are
// committed with its state there; `dispatched` lists the commits that carried any.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVulnDigest, nextSlotMs, WEEK_MS, MAX_FINDINGS, DIGEST_JOB } from './vulnDigest.js';
import { DIGEST, openDigestState } from './notices.js';
import { ArcaneError } from './client.js';
import { createPushSnapshot } from '../push/dispatch.js';

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

// The fixture containers' image ids, so a row belongs to an image a container uses.
const IMAGE_ID = {
  nextcloud: 'sha256:fff666',
  'immich-server': 'sha256:aaa111',
  gitea: 'sha256:ccc333',
  redis: 'sha256:eee555',
};
const row = (imageName, id, pkg, severity = 'HIGH', imageId) => ({
  vulnerabilityId: id,
  pkgName: pkg,
  installedVersion: '1',
  fixedVersion: '2',
  severity,
  imageId: imageId ?? IMAGE_ID[imageName.split('/').pop().split(':')[0]] ?? 'sha256:aaa111',
  imageName,
});
const LISTED = new Set(['vm-103', 'vm-101', 'pi-2']);

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
    failOnce: {}, // call key -> Error, thrown once
    after: {}, // id -> summaries returned by the second summaries read of a run
    calls: [],
  };
  const hit = (key) => {
    s.calls.push(key);
    if (s.failOnce[key]) {
      const err = s.failOnce[key];
      delete s.failOnce[key];
      throw err;
    }
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
      // A read right after the findings read gets `after`, when the test set one.
      const afterFindings = s.calls.at(-2) === `findings:${id}`;
      return clone((afterFindings && s.after[id]) || s.summaries[id] || {});
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
  {
    w = world(),
    commit,
    onRun,
    logger,
    now,
    sleep,
    setTimer,
    clearTimer,
    day,
    hour,
    dir,
    envs = LISTED,
  } = {}
) {
  if (!dir) {
    dir = mkdtempSync(join(tmpdir(), 'arcane-vuln-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
  }
  const snapshotPath = join(dir, 'push-snapshot.json');
  const snapshot = createPushSnapshot({ path: snapshotPath, logger: silent });
  const { stateStore, notices } = openDigestState({
    snapshot,
    sender: { wake() {} },
    isPushEnabled: () => true,
    dir,
    logger: silent,
  });
  const runs = [];
  const dispatched = [];
  const slept = [];
  const clock = { ms: SUN_1400 };
  const digest = createVulnDigest({
    client: w.client,
    stateStore,
    recordRun: (r) => {
      onRun?.(r);
      runs.push(r);
    },
    notices: {
      commit(events) {
        if (commit) commit(events);
        notices.commit(events);
        if (events.length > 0) dispatched.push({ events });
      },
    },
    logger: logger || silent,
    now: now || (() => clock.ms),
    envs,
    // No real pauses between read attempts in tests.
    sleep: sleep || (async (ms) => slept.push(ms)),
    ...(setTimer ? { setTimer } : {}),
    ...(clearTimer ? { clearTimer } : {}),
    ...(day !== undefined ? { day } : {}),
    ...(hour !== undefined ? { hour } : {}),
  });
  const pushes = () => dispatched.flatMap((d) => d.events);
  // The digest's state as push-snapshot.json holds it.
  const held = () => JSON.parse(readFileSync(snapshotPath, 'utf8')).producers?.[DIGEST] ?? null;
  return { dir, w, s: w.s, digest, stateStore, runs, dispatched, pushes, held, snapshot, clock, slept };
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

test('scan health: an image newly stale or failed pushes once; known problems only ride along', async (t) => {
  const w = world();
  const { digest, pushes, runs } = setup(t, { w });
  await digest.runOnce(); // baseline, healthy
  w.s.summaries[VM103] = fx('vulnerabilities-summaries').summaries; // redis stale, nextcloud failed
  await digest.runOnce();
  await digest.runOnce(); // the same problems: not news
  w.s.summaries[VM103]['sha256:ccc333'].status = 'failed'; // gitea fails too
  await digest.runOnce();
  assert.deepEqual(
    pushes().map((e) => [e.body, e.severity]),
    [
      ['KEV 1 · 1 image not scanned in 9 days: redis · 1 scan failed: nextcloud', 'info'],
      [
        'KEV 1 · 1 scan failed: gitea · still not scanned: redis · still failing: nextcloud',
        'info',
      ],
    ]
  );
  assert.deepEqual(
    runs.map((r) => r.status),
    ['success', 'success', 'success', 'success']
  );
  // Recovery is silent.
  w.s.summaries[VM103] = healthy(w.s.containers[VM103], SUN_1400);
  await digest.runOnce();
  assert.equal(pushes().length, 2);
});

test('scan health: problems present at the baseline are stored silently, not pushed later', async (t) => {
  const w = world();
  w.s.summaries[VM103] = fx('vulnerabilities-summaries').summaries;
  const { digest, pushes, stateStore } = setup(t, { w });
  await digest.runOnce();
  assert.deepEqual(
    [stateStore.getEnv('vm-103').stale, stateStore.getEnv('vm-103').failed],
    [['redis'], ['nextcloud']]
  );
  await digest.runOnce();
  assert.deepEqual(pushes(), []);
});

test('a restart in the same week (a catch-up run, then the slot) sends no second health push', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'arcane-vuln-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const w = world();
  await setup(t, { w, dir }).digest.runOnce(); // baseline
  w.s.summaries[VM103] = fx('vulnerabilities-summaries').summaries;
  const first = setup(t, { w, dir });
  await first.digest.runOnce();
  assert.equal(first.pushes().length, 1);
  const again = setup(t, { w, dir }); // JagHelm restarted later that week
  await again.digest.runOnce();
  await again.digest.runOnce();
  assert.deepEqual(again.pushes(), []);
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

test('the commit carries the advanced state with the push; one that throws is logged, and the cron run still recorded', async (t) => {
  const w = world();
  const { lines, logger } = capture();
  let seen = null;
  const env = setup(t, {
    w,
    logger,
    commit: (events) => {
      if (events.length === 0) return;
      seen = env.stateStore.getEnv('vm-103').kev;
      throw new Error('commit throws');
    },
  });
  await env.digest.runOnce();
  w.s.overview[VM103].drivers.knownExploited = 4;
  const { events } = await env.digest.runOnce();
  assert.equal(events.length, 1);
  assert.equal(seen, 4);
  assert.equal(lines.filter((l) => /notices not committed/.test(l.msg)).length, 1);
  assert.deepEqual(
    env.runs.map((r) => r.status),
    ['success', 'success']
  );
});

test('the run is written in one commit with its push queued, and its cron run recorded after it (#581)', async (t) => {
  const w = world();
  let atRun = null;
  const env = setup(t, {
    w,
    onRun: () => {
      atRun ??= { kev: env.held()?.vulns.envs['vm-103']?.kev ?? null, queued: env.snapshot.outbox().length };
    },
  });
  await env.digest.runOnce();
  atRun = null;
  w.s.overview[VM103].drivers.knownExploited = 4;
  const { events } = await env.digest.runOnce();
  assert.deepEqual(env.snapshot.outbox(), events);
  assert.deepEqual(atRun, { kev: 4, queued: 1 });
});

test('a state file survives a restart: the next process does not re-baseline', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'arcane-vuln-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const w = world();
  const first = setup(t, { w, dir });
  await first.digest.runOnce();
  assert.ok(first.held().vulns.envs['vm-103'], 'in push-snapshot.json (#581)');
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

test('I3: an unused image whose rescan fails for a week causes no fixed-then-new push', async (t) => {
  const w = world();
  // tool:3 is on the daemon but no container uses it.
  const tool = row('tool:3', 'CVE-2099-0300', 'busybox', 'HIGH', 'sha256:tool');
  w.s.rows[VM103] = [...fx('vulnerabilities-all'), tool];
  const { digest, pushes, stateStore } = setup(t, { w });
  await digest.runOnce();
  // Week 2: its rescan fails, so Arcane lists none of its findings.
  w.s.rows[VM103] = fx('vulnerabilities-all');
  await digest.runOnce();
  // Week 3: it scans again. Before the fix this pushed
  // '1 new high (fix available) · 1 image · top: tool'.
  w.s.rows[VM103] = [...fx('vulnerabilities-all'), tool];
  await digest.runOnce();
  assert.deepEqual(pushes(), []);
  assert.equal(stateStore.getEnv('vm-103').keys.size, 5);
});

test('I4: KEV dropping while a scan failed does not come back as a new KEV entry', async (t) => {
  const w = world();
  const { digest, pushes, stateStore } = setup(t, { w });
  await digest.runOnce(); // KEV 1
  // Week 2: gitea's scan fails; its findings leave Arcane's overview, KEV drops to 0.
  w.s.summaries[VM103]['sha256:ccc333'].status = 'failed';
  w.s.overview[VM103].drivers.knownExploited = 0;
  await digest.runOnce();
  const storedWhileFailed = stateStore.getEnv('vm-103').kev;
  // Week 3: the scan succeeds and KEV is 1 again. Before the fix: 'KEV 1 (1 new)', warning.
  w.s.summaries[VM103]['sha256:ccc333'].status = 'completed';
  w.s.overview[VM103].drivers.knownExploited = 1;
  await digest.runOnce();
  assert.deepEqual(
    pushes().map((e) => [e.body, e.severity]),
    [['1 scan failed: gitea', 'info']]
  );
  assert.equal(storedWhileFailed, 1);
  // With nothing uncertain, a lower count is stored as it is.
  w.s.overview[VM103].drivers.knownExploited = 0;
  await digest.runOnce();
  assert.equal(stateStore.getEnv('vm-103').kev, 0);
});

test('I5: a container just recreated on an unscanned image is not "not scanned in 9 days"', async (t) => {
  const w = world();
  const { digest, pushes, clock } = setup(t, { w });
  await digest.runOnce();
  // Between the 09:00 scan and the digest, nextcloud is recreated on a new image.
  const nc = w.s.containers[VM103].find((c) => c.names[0] === '/nextcloud');
  nc.imageId = 'sha256:new';
  nc.created = Math.floor((clock.ms - HOUR) / 1000);
  await digest.runOnce();
  // Before the fix: '1 image not scanned in 9 days: nextcloud'.
  assert.deepEqual(pushes(), []);
  // Ten days on, every other image rescanned, the new one never: now it is stale.
  clock.ms += 10 * DAY;
  w.s.summaries[VM103] = healthy(
    w.s.containers[VM103].filter((c) => c.imageId !== 'sha256:new'),
    clock.ms
  );
  await digest.runOnce();
  assert.deepEqual(
    pushes().map((e) => e.body),
    ['KEV 1 · 1 image not scanned in 9 days: nextcloud']
  );
});

test('a scan that starts while the findings are read is uncertain, not fixed and then new', async (t) => {
  const w = world();
  const { digest, pushes, stateStore } = setup(t, { w });
  await digest.runOnce();
  const all = w.s.rows[VM103];
  // gitea's rescan starts between the first summaries read and the findings read.
  const during = clone(w.s.summaries[VM103]);
  during['sha256:ccc333'].status = 'scanning';
  w.s.after[VM103] = during;
  w.s.rows[VM103] = all.filter((r) => !r.imageName.startsWith('gitea/'));
  await digest.runOnce();
  assert.equal(stateStore.getEnv('vm-103').keys.size, 5);
  // Next week all is back: before the fix '2 new high (fix available) · 1 image · top: gitea 2H'.
  delete w.s.after[VM103];
  w.s.rows[VM103] = all;
  await digest.runOnce();
  assert.deepEqual(pushes(), []);
});

test('the findings read is tried up to 3 times, 30 s apart, before the week fails', async (t) => {
  const w = world();
  const env = setup(t, { w });
  await env.digest.runOnce();
  env.s.calls.length = 0;
  w.s.failOnce['findings:0'] = new ArcaneError('Arcane HTTP 502 for /x', 502);
  await env.digest.runOnce();
  assert.equal(env.runs.at(-1).status, 'success');
  assert.deepEqual(env.slept, [30000]);
  // Failing every time: three attempts, then a failure run.
  env.s.calls.length = 0;
  w.s.fail['findings:0'] = new ArcaneError('Arcane HTTP 502 for /x', 502);
  await env.digest.runOnce();
  assert.equal(env.s.calls.filter((c) => c === 'findings:0').length, 3);
  assert.equal(env.runs.at(-1).status, 'failure');
  // A refused read is not retried.
  env.s.calls.length = 0;
  w.s.fail['findings:0'] = new ArcaneError('Arcane HTTP 403 for /x', 403);
  await env.digest.runOnce();
  assert.equal(env.s.calls.filter((c) => c === 'findings:0').length, 1);
});

test(`more than ${MAX_FINDINGS} keys to keep (current plus carried) fails loudly, never truncates`, async (t) => {
  const w = world();
  const { lines, logger } = capture();
  const { digest, runs, stateStore } = setup(t, { w, logger });
  // nextcloud carries 20,000 findings from earlier digests, and its scan failed this week.
  const carried = Array.from({ length: MAX_FINDINGS }, (_, i) => ({
    repo: 'nextcloud',
    id: `CVE-2099-${String(i).padStart(5, '0')}`,
    pkg: 'p',
    sev: 'H',
  }));
  assert.equal(stateStore.setEnv('vm-103', { keys: carried, kev: 1, atMs: 1 }), true);
  w.s.summaries[VM103]['sha256:fff666'].status = 'failed';
  const { results } = await digest.runOnce();
  const r = results.find((x) => x.env === 'vm-103');
  assert.equal(r.outcome, 'error');
  assert.match(r.error, /20000/);
  assert.equal(runs.at(-1).status, 'failure');
  assert.equal(stateStore.getEnv('vm-103').keys.size, MAX_FINDINGS);
  assert.ok(lines.some((l) => l.level === 'error' && /cap/.test(l.msg)));
});

test('I1: only environments in the list are read; a listed name Arcane lacks is logged once', async (t) => {
  const w = world();
  const { lines, logger } = capture();
  const { digest, s } = setup(t, { w, logger, envs: new Set(['vm-103', 'gone']) });
  const { results } = await digest.runOnce();
  await digest.runOnce();
  assert.deepEqual(
    results.map((r) => [r.env, r.outcome]),
    [
      ['gone', 'not-found'],
      ['vm-103', 'baseline'],
    ]
  );
  // vm-101 and pi-2 are never touched, not even their containers.
  assert.equal(
    s.calls.some((c) => c.endsWith(':1') || c.endsWith(':3')),
    false
  );
  assert.equal(
    lines.filter((l) => /gone|not found/i.test(l.msg + JSON.stringify(l.fields))).length,
    1
  );
});

test('I1: the environment-list failure records failures only for listed environments', async (t) => {
  const w = world();
  const { digest, runs, stateStore } = setup(t, { w, envs: new Set(['vm-103']) });
  await digest.runOnce();
  stateStore.setEnv('old-env', { keys: new Map(), kev: 0, atMs: 1 });
  w.s.fail.environments = new ArcaneError('Arcane HTTP 502 for /api/environments', 502);
  await digest.runOnce();
  assert.deepEqual(
    runs.slice(1).map((r) => [r.node, r.status]),
    [['vm-103', 'failure']]
  );
});

test('I1: an empty list turns the digest off: no timer, no request, one log line', async (t) => {
  const tm = timers();
  const { lines, logger } = capture();
  const env = setup(t, {
    envs: new Set(),
    logger,
    setTimer: tm.setTimer,
    clearTimer: tm.clearTimer,
  });
  env.digest.start();
  await flush();
  assert.deepEqual(tm.set, []);
  assert.deepEqual(env.s.calls, []);
  assert.deepEqual(await env.digest.runOnce(), { events: [], results: [] });
  assert.deepEqual(env.s.calls, []);
  assert.equal(lines.filter((l) => /off/.test(l.msg)).length, 1);
  env.digest.stop();
});
