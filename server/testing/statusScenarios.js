/**
 * The status fixtures (#293): named boards, each built the way the live loop
 * builds /api/status (refresh.js updateStatus). A fixture is a list of cycles,
 * each one the caches the refreshes would leave, read through readStatusInputs
 * into one status tracker. Nothing here is status JSON written by hand, so a
 * fixture can only say what the model says.
 *
 * - `healthy`, `incident`: the demo's two boards, as the demo builds its
 *   /api/status from them (demoFixtures.js demoStatusCycles: a warm-up cycle
 *   15 minutes before `now`, then `now`, #442), one source of truth with what
 *   the demo serves.
 * - `source-down`: the healthy board, then two cycles in which Prometheus
 *   fails: its node batch throws and the UPS read fails with it, as
 *   refresh.js handles that. Kuma and the cron reports carry on.
 * - `first-run`: nothing set up: services.yaml has no nodes (the refresh's
 *   own payload for that, Prometheus answering its probe), Prometheus has no
 *   UPS, and there is no Kuma, Gitea, integration or cron job.
 * - `thresholds`: the healthy board, two cycles, with node readings on, over,
 *   just under and (after falling back) held inside the lines of the threshold
 *   table (status/thresholds.js): the readings the other fixtures never reach.
 * - `every-state`: the healthy board, two cycles, with one of every other kind
 *   of state: a node unreachable, the UPS on battery, a job failed, a job and
 *   a backup overdue, a service pending (for 2 cycles) and one in
 *   maintenance, a container gone missing, an integration failing and an
 *   Arcane agent offline.
 * - `low-battery`: the healthy board with the UPS on low battery, which the
 *   model tells apart from on battery.
 * - `container-blind`: the healthy board, with cAdvisor's container readings
 *   gone for one node (#838): the read names it silent, and the model lists
 *   its `containers-source:<node>` as a source, which push pages like any.
 * - `config-broken`: JagHelm booted on a services.yaml that doesn't parse
 *   (#505): it holds no config, so the refreshes leave the first-run board,
 *   and the status model is told why (readStatusInputs' `configProblem`).
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
  demoStatusCycles,
} from '../demoFixtures.js';
import { assembleServices, noNodesCacheEntry, servicesCacheEntry } from '../refresh.js';
import { createStatusTracker, readStatusInputs } from '../status/index.js';
import { CYCLE_THRESHOLDS } from './statusFixtures.js';

export const STATUS_SCENARIOS = Object.freeze([
  'healthy',
  'incident',
  'source-down',
  'first-run',
  'thresholds',
  'every-state',
  'low-battery',
  'config-broken',
  'container-blind',
]);

/**
 * A background cycle's length: the cycles of a scenario are this far apart,
 * except the demo boards', whose warm-up is 15 minutes back (#442).
 */
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

/**
 * `cycle`'s caches with some keys replaced: `cached` for getCached,
 * `internal` for the services entry, `cron` for the cron store.
 */
function withCaches(cycle, { cached = {}, internal, cron } = {}) {
  const { caches } = cycle;
  return {
    ...cycle,
    caches: {
      getCached: (key) => (Object.hasOwn(cached, key) ? cached[key] : caches.getCached(key)),
      getCachedInternal: (key) =>
        key === 'services' && internal !== undefined ? internal : caches.getCachedInternal(key),
      getAllCronStatuses: cron === undefined ? caches.getAllCronStatuses : () => cron,
    },
  };
}

/**
 * The services cache entry for the demo's board, assembled by the live
 * refresh's assembleServices() and servicesCacheEntry() from `nodeResults`
 * (each `[nodeKey, nodeCfg, nodeData]`), the monitors (the healthy ones by
 * default), the container registry (none by default) and the sources' flags.
 */
function servicesEntry(
  nodeResults,
  now,
  {
    prometheusOk = true,
    prometheusError = null,
    monitors = demoMonitors('healthy', now),
    containerRegistry = null,
  } = {}
) {
  const assembled = assembleServices({
    nodeResults,
    monitors,
    config: demoServicesConfig(),
    lastSeenNodeOf: () => null,
    lastSeenContainerOf: () => null,
    containerRegistry,
    now: () => now,
    presenceKnown: prometheusOk,
  });
  return servicesCacheEntry(assembled, { prometheusOk, kumaOk: true, prometheusError });
}

/**
 * The demo's node readings with some metrics replaced, `{ nodeKey: { metric:
 * value } }`, and some fields of a node's data, `{ nodeKey: { field: value } }`.
 */
function nodeResultsWith(metricsByNode, dataByNode = {}) {
  const config = demoServicesConfig();
  const readings = demoNodeReadings();
  return Object.entries(config.nodes).map(([key, nodeCfg]) => [
    key,
    nodeCfg,
    {
      ...readings[key],
      ...dataByNode[key],
      metrics: { ...readings[key].metrics, ...metricsByNode[key] },
    },
  ]);
}

/** A cycle of the healthy board with node readings replaced (the `thresholds` fixture). */
function readingsCycle(metricsByNode, now) {
  const { payload, internal } = servicesEntry(nodeResultsWith(metricsByNode), now);
  const cycle = withCaches(demoStatusCycle({ scenario: 'healthy', now }), {
    cached: { services: payload },
    internal,
  });
  // This fixture's two cycles are 30 s apart: CPU's 30 min hold (#764) is off, so its 2 cycles count.
  return { ...cycle, thresholds: { ...cycle.thresholds, cpu: { ...cycle.thresholds.cpu, holdMs: 0 } } };
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
  // What the services refresh caches with no nodes in services.yaml, its
  // probe answered (refresh.js noNodesCacheEntry, #449).
  const { payload, internal } = noNodesCacheEntry({ prometheusOk: true });
  const cached = { services: payload, ups: NO_UPS, integrations: {} };
  return {
    caches: {
      getCached: (key) => cached[key] ?? null,
      getCachedInternal: (key) => (key === 'services' ? internal : null),
      getAllCronStatuses: () => [],
    },
    extra: { env: { PROMETHEUS_URL: 'http://prom' }, backupJobs: [] },
    thresholds: CYCLE_THRESHOLDS,
  };
}

/** The reason config.js gives the model for the file `config-broken` boots on (#505). */
export const CONFIG_BROKEN = "services.yaml doesn't parse (line 12)";

function configBrokenCycle() {
  // JagHelm holds `{}` (config.js keepAfterFailedRead): no nodes, as at a first run.
  const cycle = firstRunCycle();
  return { ...cycle, extra: { ...cycle.extra, configProblem: CONFIG_BROKEN } };
}

/** The node `container-blind` loses its container readings for. */
export const CONTAINER_BLIND_NODE = 'storage';

/** The healthy board whose container events read says one node stopped reporting (#838). */
function containerBlindCycle(t) {
  const cycle = demoStatusCycle({ scenario: 'healthy', now: t });
  const read = {
    state: 'ok',
    startMs: t - 3_600_000,
    endMs: t,
    stepMs: 60_000,
    events: [],
    truncated: false,
    blindNodes: [],
    silentNodes: [CONTAINER_BLIND_NODE],
    oomCounter: true,
  };
  const { caches } = cycle;
  return { ...cycle, caches: { ...caches, getCached: (key) => (key === 'containerEvents' ? read : caches.getCached(key)) } };
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/**
 * The demo's UPS with a NUT status: 2 on battery, 3 low battery. On battery
 * its runtime is 21.5 min, so the clients' "22 min left" pins the model's
 * rounding (#549): rounded down, it would read 21.
 */
const upsAt = (now, status, charge) => ({
  ...demoStatusCycle({ scenario: 'healthy', now }).caches.getCached('ups'),
  status,
  charge,
  runtime: status === 3 ? 240 : 1290,
});

// The `every-state` fixture's monitors: Netdata's check is retrying
// (pending), Paperless is in a maintenance window. Kuma reports both with no
// up or down (monitors.js: kumaStatusFromValue 2 and 3).
const KUMA_STATES = { Netdata: 'pending', Paperless: 'maintenance' };

/** The healthy monitors, with KUMA_STATES applied. */
function everyStateMonitors(now) {
  const monitors = demoMonitors('healthy', now);
  for (const m of Object.values(monitors)) {
    if (Object.hasOwn(KUMA_STATES, m.name)) {
      Object.assign(m, { status: 'unknown', kumaStatus: KUMA_STATES[m.name], ping: null });
    }
  }
  return monitors;
}

/**
 * The healthy cron store with: db-dump's last run failed; image-prune and
 * the nightly backup last reporting three days ago (overdue).
 */
function everyStateCron(now) {
  const late = demoStatusCycle({ scenario: 'healthy', now: now - 3 * DAY }).caches;
  const lateJobs = new Map(
    late.getAllCronStatuses().flatMap((n) => n.jobs.map((j) => [`${n.node}:${j.job}`, j]))
  );
  const store = demoStatusCycle({ scenario: 'healthy', now }).caches.getAllCronStatuses();
  return store.map((n) => ({
    ...n,
    jobs: n.jobs.map((j) => {
      const key = `${n.node}:${j.job}`;
      if (key === 'apps:db-dump') {
        const [last, ...rest] = j.runs;
        return { ...j, runs: [{ ...last, status: 'failure', error: 'exit code 3' }, ...rest] };
      }
      if (key === 'apps:image-prune' || key === 'storage:nightly-backup') return lateJobs.get(key);
      return j;
    }),
  }));
}

/** The `every-state` board's container under a temporary name (`<12 hex>_<name>`, #772). */
const TEMP_NAME_CONTAINER = '0123456789ab_nginx';

/** A cycle of the `every-state` board at `now`. */
function everyStateCycle(now) {
  // The edge node's exporter can't be scraped (`up` is 0): no readings.
  const baseResults = nodeResultsWith(
    { edge: { cpu: null, memPercent: null, diskPercent: null, temp: null } },
    { edge: { reachable: false } }
  );
  // A container running under a temporary name (#772, #799): an interrupted recreate on `apps`.
  const nodeResults = baseResults.map(([key, cfg, data]) =>
    key === 'apps'
      ? [key, cfg, { ...data, containers: [...data.containers, { ...data.containers[0], container: TEMP_NAME_CONTAINER }] }]
      : [key, cfg, data]
  );
  // A container that stopped ten minutes ago, with no monitor of its own.
  const containerRegistry = {
    recordSeen() {},
    getMissing: () => [
      { container: 'redis-cache', lastSeenNode: 'apps', lastSeenAt: now - 10 * MINUTE },
    ],
  };
  const { payload, internal } = servicesEntry(nodeResults, now, {
    monitors: everyStateMonitors(now),
    containerRegistry,
  });
  const cycle = withCaches(demoStatusCycle({ scenario: 'healthy', now }), {
    cached: {
      services: payload,
      ups: upsAt(now, 2, 64),
      integrations: {
        jellyfin: {
          _preset: 'jellyfin',
          _error: 'HTTP 502',
          _status: { state: 'backing_off', since: now - 5 * MINUTE },
        },
      },
    },
    internal,
    cron: everyStateCron(now),
  });
  return {
    ...cycle,
    extra: {
      ...cycle.extra,
      arcaneAgents: [
        { env: 'apps', state: 'down' },
        { env: 'storage', state: 'up' },
      ],
    },
  };
}

/** A cycle of the healthy board with the UPS on low battery. */
function lowBatteryCycle(now) {
  return withCaches(demoStatusCycle({ scenario: 'healthy', now }), {
    cached: { ups: upsAt(now, 3, 18) },
  });
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
      // The demo's own cycles, as it builds /api/status (#442).
      return demoStatusCycles({ scenario: name, now });
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
    case 'every-state':
      // Two cycles: a service pending for one cycle is Kuma retrying, not yet a warning.
      cycles = [everyStateCycle, everyStateCycle];
      break;
    case 'low-battery':
      cycles = [lowBatteryCycle];
      break;
    case 'config-broken':
      cycles = [configBrokenCycle];
      break;
    case 'container-blind':
      cycles = [containerBlindCycle];
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
 * @param {{ now?: number, units?: string }} [opts]  `units`: the temperature unit the model writes in (#494)
 */
export function runScenario(name, opts = {}) {
  const tracker = createStatusTracker();
  const cycles = scenarioCycles(name, opts);
  let status = null;
  for (const { caches, extra, thresholds, now } of cycles) {
    status = tracker.update({ inputs: readStatusInputs(caches, extra), thresholds, units: opts.units, now });
  }
  return { status, cycle: cycles[cycles.length - 1] };
}

/** /api/status for a scenario. */
export function scenarioStatus(name, opts = {}) {
  return runScenario(name, opts).status;
}
