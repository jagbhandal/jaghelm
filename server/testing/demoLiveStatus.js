/**
 * The live side of the demo's drift test (#437, #442): what the loop's own
 * status step (refresh.js updateStatus, with the live caches, env and
 * thresholds) builds once what the demo serves is put where a live cycle's
 * refreshes put theirs (the caches, the cron store, display-config.json), run
 * at the demo's two clocks: its warm-up, then the request's.
 *
 * One scenario per process. The loop's tracker lives in refresh.js, so a
 * second board built in the same process would start from the first one's
 * memory, not from a fresh boot's as the demo's does. node:test runs each test
 * file in its own process, so each scenario's drift test has its own file
 * (server/demoStatus.test.js, server/demoStatus.healthy.test.js).
 *
 * It unsets DEMO_MODE, KUMA_URL and JAGHELM_GITEA_URL (and GITEA_URL) before it loads the server: the
 * live side runs outside demo mode, and the demo can't lean on either variable
 * (they are set only around the loop's own step).
 */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

delete process.env.DEMO_MODE;
delete process.env.KUMA_URL;
delete process.env.JAGHELM_GITEA_URL;
delete process.env.GITEA_URL;

const { DATA_DIR } = await import('../util/dataDir.js');
const { setCache } = await import('../cache.js');
const { assembleServices, servicesCacheEntry, stopBackgroundRefresh, updateStatus } =
  await import('../refresh.js');
const { demoResponse, isDemoMode } = await import('../demo.js');
const { DEMO_WARM_UP_MS, demoMonitors, demoNodeReadings, demoServicesConfig } =
  await import('../demoFixtures.js');

export { isDemoMode, stopBackgroundRefresh };

/** The request's clock in these tests. */
export const NOW = Date.parse('2026-10-19T12:00:00Z');

/** What the demo answers a read of `path` at `now`. */
export function served(path, scenario, now = NOW) {
  const out = demoResponse({ path, scenario, now });
  assert.equal(out.status, 200, path);
  return out.body;
}

/**
 * Puts what the demo serves for `scenario` at NOW where a live cycle puts it,
 * and runs the loop's status step at the demo's warm-up clock, then at NOW.
 * Returns the last status.
 */
export function liveStatusOf(scenario) {
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
  // The display config the demo serves is the live one: its thresholds, and
  // the jobs it marks as backups (#291), which the loop reads from the file.
  writeFileSync(
    join(DATA_DIR, 'display-config.json'),
    JSON.stringify(served('/api/display-config', scenario))
  );
  // A live install with Kuma and Gitea set up, as the demo's board shows (its
  // services carry Kuma monitors, its Pipeline panel Gitea commits). Only for
  // the loop's step: the demo must not need them in its own environment.
  process.env.KUMA_URL = 'http://kuma.example.com';
  process.env.JAGHELM_GITEA_URL = 'http://git.example.com';
  try {
    // A board that has been running a while (#442): the same caches read at
    // the warm-up clock, then at the request's.
    let status = null;
    for (const now of [NOW - DEMO_WARM_UP_MS, NOW]) {
      status = updateStatus([], now);
      assert.ok(status, `the model built at ${new Date(now).toISOString()}`);
    }
    return status;
  } finally {
    delete process.env.KUMA_URL;
    delete process.env.JAGHELM_GITEA_URL;
  }
}
