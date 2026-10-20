/**
 * The demo's /api/status (#437) is what the live loop builds from the demo's
 * board: the payloads the demo serves are put where a live cycle's refreshes
 * put theirs (the caches, the cron store), the loop's own status step
 * (refresh.js updateStatus, with the live caches, env and thresholds) builds
 * the status, and the demo must answer the same. So the demo's fixture-to-input
 * wiring can't drift from the live one: a payload it leaves out, a scenario it
 * mixes up, a clock it doesn't pass, all change what it answers.
 *
 * Runs outside demo mode, in its own process (node:test spawns per file), so
 * the loop's tracker starts as on a fresh boot with push not set up.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

delete process.env.DEMO_MODE;
delete process.env.KUMA_URL;
delete process.env.GITEA_URL;

const { DATA_DIR } = await import('./util/dataDir.js');
const { setCache } = await import('./cache.js');
const { assembleServices, servicesCacheEntry, stopBackgroundRefresh, updateStatus } =
  await import('./refresh.js');
const { demoResponse, isDemoMode } = await import('./demo.js');
const { demoMonitors, demoNodeReadings, demoServicesConfig } = await import('./demoFixtures.js');

after(() => stopBackgroundRefresh());

const NOW = Date.parse('2026-10-19T12:00:00Z');
const served = (path, scenario) => {
  const out = demoResponse({ path, scenario, now: NOW });
  assert.equal(out.status, 200, path);
  return out.body;
};

/**
 * Puts what the demo serves for `scenario` where a live cycle puts it, and
 * runs the loop's status step.
 */
function liveStatusOf(scenario) {
  // /api/services and what the services refresh keeps beside it: the live
  // refresh's own entry for the demo's node readings and monitors.
  const config = demoServicesConfig();
  const readings = demoNodeReadings();
  const assembled = assembleServices({
    nodeResults: Object.entries(config.nodes).map(([key, nodeCfg]) => [
      key,
      nodeCfg,
      readings[key],
    ]),
    monitors: demoMonitors(scenario, NOW),
    config,
    lastSeenNodeOf: () => null,
    lastSeenContainerOf: () => null,
    containerRegistry: null,
    now: () => NOW,
  });
  const { payload, internal } = servicesCacheEntry(assembled, { prometheusOk: true, kumaOk: true });
  assert.deepEqual(payload, served('/api/services', scenario), 'the board the demo serves');
  setCache('services', payload, internal);
  setCache('ups', served('/api/ups', scenario));
  setCache('integrations', served('/api/integrations', scenario));
  // The cron store holds each job's runs, newest first: the runs the demo's
  // /api/cron/status lists.
  const store = {};
  for (const { node, jobs } of served('/api/cron/status', scenario)) {
    store[node] = Object.fromEntries(jobs.map(({ job, runs }) => [job, runs]));
  }
  writeFileSync(join(DATA_DIR, 'cron-jobs.json'), JSON.stringify(store));
  // A live install with Kuma and Gitea set up, as the demo's board shows (its
  // services carry Kuma monitors, its Pipeline panel Gitea commits). Only for
  // the loop's step: the demo must not need them in its own environment.
  process.env.KUMA_URL = 'http://kuma.example.com';
  process.env.GITEA_URL = 'http://git.example.com';
  try {
    const status = updateStatus([], NOW);
    assert.ok(status, 'the model built');
    return status;
  } finally {
    delete process.env.KUMA_URL;
    delete process.env.GITEA_URL;
  }
}

test('demo /api/status: incident: the headline and issues are what the live loop builds for the same board (#437)', () => {
  assert.equal(isDemoMode(), false, 'the live side runs outside demo mode');
  const live = liveStatusOf('incident');
  const demo = served('/api/status', 'incident');

  assert.deepEqual(demo.overall, live.overall, 'the headline');
  assert.deepEqual(demo.issues, live.issues, 'the issue list');
  assert.deepEqual(demo, live, 'and the rest of the status');
  // Not vacuous: the incident board has its two issues.
  assert.deepEqual(live.overall, { state: 'crit', sentence: '1 service down · 1 job failed' });
  assert.deepEqual(
    live.issues.map((i) => i.id),
    ['services/apps:jellyfin', 'jobs/storage:nightly-backup']
  );
});

test('demo /api/status: healthy: the same as the live loop builds for that board (#437)', () => {
  // The loop's tracker carries the incident cycle's memory into this one. At
  // the same clock nothing it holds differs from a fresh boot's: the entities
  // that changed state take this cycle's time, the others kept the same one.
  const live = liveStatusOf('healthy');
  const demo = served('/api/status', 'healthy');

  assert.deepEqual(demo, live);
  assert.deepEqual(live.overall, { state: 'ok', sentence: 'All 12 services up · 3 nodes healthy' });
  assert.deepEqual(live.issues, []);
});
