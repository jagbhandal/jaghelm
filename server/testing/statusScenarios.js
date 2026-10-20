/**
 * The status fixtures (#293): named boards, each built the way the live loop
 * builds /api/status (refresh.js updateStatus). A fixture is a list of cycles,
 * each one the caches the refreshes would leave, read through readStatusInputs
 * into one status tracker. Nothing here is status JSON written by hand, so a
 * fixture can only say what the model says.
 *
 * - `healthy`, `incident`: the demo's two boards (demoFixtures.js
 *   demoStatusCycle), one source of truth with what the demo serves.
 * - `source-down`: the healthy board, then two cycles in which Prometheus
 *   fails: its node batch throws and the UPS read fails with it, as
 *   refresh.js handles that. Kuma and the cron reports carry on.
 * - `first-run`: nothing set up: services.yaml has no nodes (the refresh's
 *   own payload for that), Prometheus has no UPS, and there is no Kuma, Gitea,
 *   integration or cron job.
 * - `thresholds`: the healthy board, two cycles, with node readings on, over,
 *   just under and (after falling back) held inside the lines of the threshold
 *   table (status/thresholds.js): the readings the other fixtures never reach.
 *
 * Node only: it builds through the server's own code. The cross-client suite
 * runs on it (server/status/crossClient.test.js for push,
 * src/ui/crossClient.test.jsx for the screen). An e2e or gallery run can
 * import it on its Node side (a Playwright spec) and hand a page the JSON
 * that scenarioStatus() returns.
 */
import {
  demoMonitors,
  demoNodeReadings,
  demoServicesConfig,
  demoStatusCycle,
} from '../demoFixtures.js';
import { assembleServices, servicesCacheEntry } from '../refresh.js';
import { createStatusTracker, readStatusInputs } from '../status/index.js';
import { DEFAULT_THRESHOLDS } from '../status/thresholds.js';

export const STATUS_SCENARIOS = Object.freeze([
  'healthy',
  'incident',
  'source-down',
  'first-run',
  'thresholds',
]);

/** A background cycle's length: the cycles of a scenario are this far apart. */
export const CYCLE_MS = 30_000;

/** What Prometheus failing leaves in the UPS cache (refresh.js _refreshUPS: the query threw). */
const UPS_READ_FAILED = Object.freeze({
  status: null,
  charge: null,
  runtime: null,
  load: null,
  ok: false,
  configured: null,
  model: null,
});

/** What the UPS cache holds when Prometheus answers and there is no UPS. */
const NO_UPS = Object.freeze({
  status: null,
  charge: null,
  runtime: null,
  load: null,
  ok: true,
  configured: false,
  model: null,
});

/** The error Prometheus failing gives the services refresh (fetch failing). */
export const PROMETHEUS_ERROR = 'Prometheus query failed: fetch failed';

/** `cycle`'s caches with some keys replaced: `cached` for getCached, `internal` for the services entry. */
function withCaches(cycle, { cached = {}, internal } = {}) {
  const { caches } = cycle;
  return {
    ...cycle,
    caches: {
      getCached: (key) => (Object.hasOwn(cached, key) ? cached[key] : caches.getCached(key)),
      getCachedInternal: (key) =>
        key === 'services' && internal !== undefined ? internal : caches.getCachedInternal(key),
      getAllCronStatuses: caches.getAllCronStatuses,
    },
  };
}

/**
 * The services cache entry for the demo's board, assembled by the live
 * refresh's assembleServices() and servicesCacheEntry() from `nodeResults`
 * (each `[nodeKey, nodeCfg, nodeData]`), the healthy monitors and the
 * sources' flags.
 */
function servicesEntry(nodeResults, now, { prometheusOk = true, prometheusError = null } = {}) {
  const assembled = assembleServices({
    nodeResults,
    monitors: demoMonitors('healthy', now),
    config: demoServicesConfig(),
    lastSeenNodeOf: () => null,
    lastSeenContainerOf: () => null,
    containerRegistry: null,
    now: () => now,
    presenceKnown: prometheusOk,
  });
  return servicesCacheEntry(assembled, { prometheusOk, kumaOk: true, prometheusError });
}

/** The demo's node readings with some metrics replaced: `{ nodeKey: { metric: value } }`. */
function nodeResultsWith(metricsByNode) {
  const config = demoServicesConfig();
  const readings = demoNodeReadings();
  return Object.entries(config.nodes).map(([key, nodeCfg]) => [
    key,
    nodeCfg,
    { ...readings[key], metrics: { ...readings[key].metrics, ...metricsByNode[key] } },
  ]);
}

/** A cycle of the healthy board with node readings replaced (the `thresholds` fixture). */
function readingsCycle(metricsByNode, now) {
  const { payload, internal } = servicesEntry(nodeResultsWith(metricsByNode), now);
  return withCaches(demoStatusCycle({ scenario: 'healthy', now }), {
    cached: { services: payload },
    internal,
  });
}

/** A cycle of the healthy board in which Prometheus fails: no node, the UPS read failed. */
function prometheusDownCycle(now) {
  const { payload, internal } = servicesEntry([], now, {
    prometheusOk: false,
    prometheusError: PROMETHEUS_ERROR,
  });
  return withCaches(demoStatusCycle({ scenario: 'healthy', now }), {
    cached: { services: payload, ups: UPS_READ_FAILED },
    internal,
  });
}

/** A cycle of a fresh install with nothing set up. */
function firstRunCycle() {
  // What the services refresh caches with no nodes in services.yaml: no
  // sources' flags, nothing kept beside it.
  const cached = {
    services: { nodes: {}, overallHealth: 'unknown' },
    ups: NO_UPS,
    integrations: {},
  };
  return {
    caches: {
      getCached: (key) => cached[key] ?? null,
      getCachedInternal: () => null,
      getAllCronStatuses: () => [],
    },
    extra: { env: {}, backupJobs: [] },
    thresholds: DEFAULT_THRESHOLDS,
  };
}

// The `thresholds` fixture's readings (status/thresholds.js lines: CPU warn
// 90 % for 2 cycles; memory warn 90 %; disk warn 90 %, crit 95 %; temperature
// warn 75 °C, crit 85 °C; 5 points or 5 °C of hysteresis), first cycle, then
// second. Strings, as discovery formats them.
const LINE_READINGS = [
  {
    // Memory over its line, then back inside the band: held at warn.
    edge: { memPercent: '91.0' },
    // CPU over its line for 2 cycles; a disk just under the crit line.
    apps: { cpu: '97.0', diskPercent: '94.6' },
    // A disk on its crit line, the hottest sensor over its crit line.
    storage: { diskPercent: '95.0', temp: '86.0' },
  },
  {
    edge: { memPercent: '87.0' },
    apps: { cpu: '97.0', diskPercent: '94.6' },
    storage: { diskPercent: '95.0', temp: '86.0' },
  },
];

/**
 * A scenario's cycles, oldest first, the last at `now`: each is what one
 * background cycle gives the status model, `{ caches, extra, thresholds, now }`
 * (caches in the shape of status/index.js liveCaches; extra is
 * readStatusInputs' second argument).
 *
 * @param {string} name  one of STATUS_SCENARIOS
 * @param {{ now?: number }} [opts]
 */
export function scenarioCycles(name, { now = Date.now() } = {}) {
  const at = (n, total) => now - (total - 1 - n) * CYCLE_MS;
  let cycles;
  switch (name) {
    case 'healthy':
    case 'incident':
      cycles = [(t) => demoStatusCycle({ scenario: name, now: t })];
      break;
    case 'source-down':
      cycles = [
        (t) => demoStatusCycle({ scenario: 'healthy', now: t }),
        prometheusDownCycle,
        prometheusDownCycle,
      ];
      break;
    case 'first-run':
      cycles = [firstRunCycle];
      break;
    case 'thresholds':
      cycles = LINE_READINGS.map((readings) => (t) => readingsCycle(readings, t));
      break;
    default:
      throw new Error(`No status scenario named ${name}`);
  }
  return cycles.map((build, n) => {
    const t = at(n, cycles.length);
    return { ...build(t), now: t };
  });
}

/**
 * A scenario run through one status tracker, as the loop runs its cycles:
 * the last cycle's status (what /api/status answers), and that cycle, whose
 * caches push builds its snapshot from.
 *
 * @param {string} name  one of STATUS_SCENARIOS
 * @param {{ now?: number }} [opts]
 */
export function runScenario(name, opts = {}) {
  const tracker = createStatusTracker();
  const cycles = scenarioCycles(name, opts);
  let status = null;
  for (const { caches, extra, thresholds, now } of cycles) {
    status = tracker.update({ inputs: readStatusInputs(caches, extra), thresholds, now });
  }
  return { status, cycle: cycles[cycles.length - 1] };
}

/** /api/status for a scenario. */
export function scenarioStatus(name, opts = {}) {
  return runScenario(name, opts).status;
}
