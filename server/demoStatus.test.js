/**
 * The demo's /api/status (#437) is what the live loop builds from the demo's
 * board, as a board that has been running a while (#442).
 *
 * - Its clocks: the status is built from a warm-up cycle 15 minutes before the
 *   request, then the request's, so every `since` is the warm-up clock (a
 *   job's is its last run), never "since now". Nothing is kept between
 *   requests.
 * - Its drift from the live loop: the payloads the demo serves are put where a
 *   live cycle's refreshes put theirs, the loop's own status step runs at the
 *   same two clocks (testing/demoLiveStatus.js), and the demo must answer the
 *   same. So the demo's fixture-to-input wiring can't drift from the live one:
 *   a payload it leaves out, a scenario it mixes up, a clock it doesn't pass,
 *   all change what it answers. `incident` here; `healthy` in
 *   demoStatus.healthy.test.js, so each starts from a fresh boot's tracker.
 *
 * Runs outside demo mode, in its own process (node:test spawns per file), so
 * the loop's tracker starts as on a fresh boot with push not set up.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { NOW, isDemoMode, liveStatusOf, served, stopBackgroundRefresh } =
  await import('./testing/demoLiveStatus.js');
const { DEMO_SCENARIOS, DEMO_WARM_UP_MS, demoStatusCycle } = await import('./demoFixtures.js');
const { readStatusInputs } = await import('./status/index.js');

after(() => stopBackgroundRefresh());

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const WARM_UP = NOW - 15 * MINUTE;

/** Each job's last run, by "node:job", from what the demo's /api/cron/status lists. */
function lastRuns(scenario) {
  const out = {};
  for (const { node, jobs } of served('/api/cron/status', scenario)) {
    for (const { job, runs } of jobs) {
      out[`${node}:${job}`] = Math.max(...runs.map((r) => Date.parse(r.timestamp)));
    }
  }
  return out;
}

/** Every time in `value` (ISO timestamps, and epoch-ms numbers from 2000 to 2100), by path. */
function timesIn(value, path, out = []) {
  if (typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value)) {
    out.push([path, Date.parse(value)]);
  } else if (typeof value === 'number' && value >= 946_684_800_000 && value < 4_102_444_800_000) {
    out.push([path, value]);
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) timesIn(v, `${path}.${k}`, out);
  }
  return out;
}

test("demo /api/status: incident: Jellyfin is down since the warm-up clock, not the request's (#442)", () => {
  const jellyfinOf = (status) => status.issues.find((i) => i.id === 'services/apps:jellyfin');
  const status = served('/api/status', 'incident');
  assert.ok(jellyfinOf(status), 'Jellyfin is an issue');
  assert.equal(jellyfinOf(status).since, WARM_UP, 'down for 15 minutes when the request comes in');

  // Nothing is kept between requests: the same request answers the same, and
  // one an hour later is a board that has been running as long at its clock.
  assert.deepEqual(served('/api/status', 'incident'), status);
  const later = served('/api/status', 'incident', NOW + HOUR);
  assert.equal(jellyfinOf(later).since, NOW + HOUR - 15 * MINUTE);
});

test('demo /api/status: every since is the warm-up clock, or a job its last run, in both scenarios (#442)', () => {
  for (const scenario of DEMO_SCENARIOS) {
    const status = served('/api/status', scenario);
    const ran = lastRuns(scenario);
    let jobs = 0;
    for (const e of status.entities) {
      if (e.kind === 'job' || e.kind === 'backup') {
        // Its run, as /api/cron/status lists it: never a time before the run.
        jobs += 1;
        assert.equal(e.since, ran[`${e.node}:${e.name}`], `${scenario}: ${e.id}`);
      } else {
        assert.equal(e.since, WARM_UP, `${scenario}: ${e.id}`);
      }
    }
    assert.equal(jobs, 4, `${scenario}: every job and backup was checked`);
    for (const [name, s] of Object.entries(status.sources)) {
      assert.equal(s.since, WARM_UP, `${scenario}: the ${name} source`);
    }
    for (const issue of status.issues) {
      assert.equal(
        issue.since,
        status.entities.find((e) => e.id === issue.id).since,
        `${scenario}: ${issue.id}`
      );
    }
  }
});

test('demo /api/status: the warm-up cycle reads nothing from after its clock (#442)', () => {
  // Both cycles read the board as it is at the request. That is the board at
  // the warm-up clock too only while every time in it is before the warm-up:
  // a cron run in between would be seen by the warm-up cycle before it ran.
  for (const scenario of DEMO_SCENARIOS) {
    const { caches, extra } = demoStatusCycle({ scenario, now: NOW });
    const times = timesIn(readStatusInputs(caches, extra), 'inputs');
    assert.ok(times.length > 0, `${scenario}: the cron runs are times`);
    for (const [path, t] of times) {
      assert.ok(
        t <= NOW - DEMO_WARM_UP_MS,
        `${scenario}: ${path} is ${new Date(t).toISOString()}, after the warm-up clock`
      );
    }
  }
});

test('demo /api/status: incident: the headline and issues are what the live loop builds for the same board (#437)', () => {
  assert.equal(isDemoMode(), false, 'the live side runs outside demo mode');
  const live = liveStatusOf('incident');
  const demo = served('/api/status', 'incident');

  assert.deepEqual(demo.overall, live.overall, 'the headline');
  assert.deepEqual(demo.issues, live.issues, 'the issue list');
  assert.deepEqual(demo, live, 'and the rest of the status');
  // Not vacuous: the incident board has its three issues, and the failed
  // nightly backup is a backup, as docs/DEMO.md says (#291). The third is the
  // storage node, in warning for a drive that keeps remapping sectors (#727).
  assert.deepEqual(live.overall, {
    state: 'crit',
    sentence: '1 service down · 1 backup failed · 1 node in warning',
  });
  assert.deepEqual(
    live.issues.map((i) => i.id),
    ['services/apps:jellyfin', 'backups/storage:nightly-backup', 'nodes/storage']
  );
});
