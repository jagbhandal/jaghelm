/**
 * The demo's world (#248): the payloads DEMO_MODE answers /api reads with.
 *
 * It is written as what JagHelm's sources would hand the server (discovery's
 * node readings, Uptime Kuma's monitors, the cron reports) and shaped into each
 * payload by the code the live server uses: assembleServices() builds
 * /api/services, decorateStatuses() /api/cron/status, and generateDefaultConfig()
 * the services.yaml behind /api/services/config. /api/status is the status
 * model built from those payloads, read the way the live loop reads its caches
 * (demoStatus, #437). So the board matches what a live install serves, and a
 * down monitor turns it red the way a real one does.
 * The parts written by hand are checked against the live code's own output by
 * server/demoFixtures.test.js: the node readings, the Kuma monitors and the
 * cron runs for their keys and value types, the UPS and Gitea payloads whole.
 *
 * Two scenarios: `incident` (the default) has one service failing its health
 * check and a failed backup job, so the board is not green; `healthy` has
 * neither. DEMO_SCENARIO picks one (demo.js).
 *
 * Every name, host and URL is generic: made-up nodes, example.com links. The
 * author-strings scan (scripts/author-strings.test.mjs) covers this file.
 *
 * Pure: each payload is built from `now`, so ages stay the same however long
 * the demo runs; nothing here reads a file, writes one or sends a request.
 */

import { assembleServices, servicesCacheEntry, thresholdsOf } from './refresh.js';
import { decorateStatuses } from './cron-overdue.js';
import { generateDefaultConfig } from './config.js';
import { createStatusTracker, readStatusInputs } from './status/index.js';
import { resolveBackupJobs } from './status/backupJobs.js';

// The fixture sets, as DEMO_SCENARIO names them (env.js).
export { DEMO_SCENARIOS } from './env.js';

const MiB = 1024 * 1024;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// ── Nodes ────────────────────────────────────────────────────────────────

// What a first boot generates for these labels (config.js), with names set.
const NODE_NAMES = {
  edge: {
    display_name: 'Network Edge',
    subtitle: 'Raspberry Pi 4',
    icon: '🛡',
    border_color: '#a78bfa',
  },
  apps: { display_name: 'App Server', subtitle: 'Proxmox VM', icon: '🚀', border_color: '#6366f1' },
  storage: { display_name: 'Storage', subtitle: 'NAS', icon: '💾', border_color: '#14b8a6' },
};

/** The services.yaml the demo runs with: /api/services/config. */
export function demoServicesConfig() {
  const cfg = generateDefaultConfig(Object.keys(NODE_NAMES));
  for (const [key, names] of Object.entries(NODE_NAMES)) Object.assign(cfg.nodes[key], names);
  return cfg;
}

// Each node's readings, in the shape discovery's getNodesData() gives them:
// metrics as its buildMetrics() formats them, and the running containers as
// [name, cpu %, working set MiB, RX bytes/s, TX bytes/s]. Prometheus,
// node-exporter and cAdvisor run on every node and are hidden by the `hide`
// list a first boot writes, as on a live install.
const READINGS = {
  edge: {
    metrics: {
      cpu: '6.2',
      memUsedGB: '1.4',
      memTotalGB: '7.6',
      memPercent: '18.4',
      memWithCachePercent: '43.1',
      memCacheGB: '1.9',
      uptime: '41d 6h',
      temp: '47.3',
      diskUsed: '18.2',
      diskTotal: '58.3',
      diskUnit: 'GB',
      diskPercent: '31.2',
    },
    containers: [
      ['adguard-home', 2.1, 96.4, 52_300, 61_800],
      ['nginx-proxy-manager', 0.8, 142.7, 210_400, 198_900],
      ['wireguard', 0.2, 12.3, 18_200, 21_400],
      ['node-exporter', 0.4, 18.2, 3_100, 9_800],
      ['cadvisor', 1.9, 64.0, 2_200, 14_600],
    ],
  },
  apps: {
    metrics: {
      cpu: '23.8',
      memUsedGB: '9.7',
      memTotalGB: '15.6',
      memPercent: '62.2',
      memWithCachePercent: '88.5',
      memCacheGB: '4.1',
      uptime: '12d 3h',
      temp: null,
      diskUsed: '148.6',
      diskTotal: '245.1',
      diskUnit: 'GB',
      diskPercent: '60.6',
    },
    containers: [
      ['nextcloud', 3.4, 612.5, 88_100, 402_700],
      ['jellyfin', 11.8, 1_284.0, 1_180_000, 6_450_000],
      ['grafana', 0.9, 118.3, 12_400, 30_100],
      ['gitea', 0.6, 221.9, 9_800, 14_300],
      ['vaultwarden', 0.1, 38.6, 1_200, 2_100],
      ['paperless-ngx', 1.7, 512.0, 4_300, 3_900],
      ['prometheus', 2.6, 742.1, 61_000, 8_200],
      ['node-exporter', 0.3, 19.0, 3_400, 10_200],
      ['cadvisor', 2.4, 88.5, 2_600, 18_900],
    ],
  },
  storage: {
    metrics: {
      cpu: '9.4',
      memUsedGB: '3.2',
      memTotalGB: '7.7',
      memPercent: '41.6',
      memWithCachePercent: '79.0',
      memCacheGB: '2.9',
      uptime: '87d 14h',
      temp: '41.0',
      diskUsed: '9.6',
      diskTotal: '14.5',
      diskUnit: 'TB',
      diskPercent: '66.2',
    },
    containers: [
      ['syncthing', 1.2, 88.0, 342_000, 120_000],
      ['photoprism', 4.9, 1_024.0, 45_000, 220_000],
      ['backrest', 0.3, 64.2, 2_100, 812_000],
      ['node-exporter', 0.2, 17.5, 2_900, 8_700],
      ['cadvisor', 1.1, 58.3, 1_900, 12_100],
    ],
  },
};

const oneDecimal = (n) => Math.round(n * 10) / 10;

/** One node's readings as discovery's getNodesData() gives them. */
function nodeData({ metrics, containers }) {
  return {
    ok: true,
    error: null,
    failedReads: [],
    reachable: true,
    metrics: { ...metrics },
    containers: containers.map(([name, cpu, memMB, rx, tx]) => ({
      container: name,
      status: 'running',
      docker: {
        cpu,
        memMB,
        // The cumulative counters: about three days at the current rate.
        rxMB: oneDecimal((rx * 3 * 86_400) / MiB),
        txMB: oneDecimal((tx * 3 * 86_400) / MiB),
        rxBytesPerSec: rx,
        txBytesPerSec: tx,
        networkMode: null,
      },
    })),
  };
}

/** Each node's readings, keyed by node: what discovery would hand assembleServices(). */
export function demoNodeReadings() {
  return Object.fromEntries(Object.entries(READINGS).map(([key, r]) => [key, nodeData(r)]));
}

// ── Uptime Kuma ──────────────────────────────────────────────────────────

// [id, name, ping ms, 24 h uptime]. The incident scenario has Jellyfin's
// health check failing while its container runs.
const MONITORS = [
  [1, 'AdGuard Home', 12, 1],
  [2, 'Nginx Proxy Manager', 18, 1],
  [3, 'Nextcloud', 142, 0.9993],
  [4, 'Jellyfin', 64, 0.9986],
  [5, 'Grafana', 38, 1],
  [6, 'Gitea', 41, 0.9997],
  [7, 'Vaultwarden', 22, 1],
  [8, 'Paperless', 96, 0.9991],
  [9, 'Syncthing', 27, 1],
  [10, 'PhotoPrism', 118, 0.9978],
  [11, 'Backrest', 33, 1],
  [12, 'WireGuard', 9, 1],
];
const DOWN_IN_INCIDENT = new Set(['Jellyfin']);

/**
 * The monitors, in the shape monitors.js fetchMonitors() gives them (checked
 * against it by server/demoFixtures.test.js).
 */
export function demoMonitors(scenario, now) {
  const out = {};
  for (const [id, name, ping, uptime24] of MONITORS) {
    const down = scenario === 'incident' && DOWN_IN_INCIDENT.has(name);
    out[id] = {
      id,
      name,
      status: down ? 'down' : 'up',
      kumaStatus: down ? 'down' : 'up',
      ping: down ? 0 : ping,
      uptime24: down ? 0.9612 : uptime24,
      active: true,
      lastBeatAt: now - 20_000,
    };
  }
  return out;
}

/** /api/services/monitors: every monitor's name, sorted. */
export function demoMonitorNames() {
  return MONITORS.map(([, name]) => name).sort();
}

/**
 * The services cache entry a live cycle would leave for this board:
 * `{ payload, internal }`, the /api/services payload and what the refresh
 * keeps beside it, both from the live server's assembleServices() and
 * servicesCacheEntry(). Every source answered.
 */
function demoServicesEntry(scenario, now) {
  const config = demoServicesConfig();
  const readings = demoNodeReadings();
  const nodeResults = Object.entries(config.nodes).map(([key, nodeCfg]) => [
    key,
    nodeCfg,
    readings[key],
  ]);
  const assembled = assembleServices({
    nodeResults,
    monitors: demoMonitors(scenario, now),
    config,
    lastSeenNodeOf: () => null,
    lastSeenContainerOf: () => null,
    containerRegistry: null,
    now: () => now,
  });
  return servicesCacheEntry(assembled, { prometheusOk: true, kumaOk: true });
}

/** /api/services, assembled by the live server's assembleServices(). */
export function demoServices({ scenario = 'incident', now = Date.now() } = {}) {
  return demoServicesEntry(scenario, now).payload;
}

// ── History (sparklines) ─────────────────────────────────────────────────

const HISTORY_SAMPLES = 60;

/** A gentle, repeatable hour of samples ending on `last`. */
function wave(last, amplitude, phase) {
  const out = [];
  for (let i = HISTORY_SAMPLES - 1; i >= 0; i -= 1) {
    const v =
      last + amplitude * (Math.sin(i / 4 + phase) - Math.sin(phase)) + (i % 3) * amplitude * 0.15;
    out.push(oneDecimal(Math.min(100, Math.max(0, v))));
  }
  return out;
}

/** /api/history: each node's CPU, memory and disk usage, keyed as history.js keys them. */
export function demoHistory() {
  const out = {};
  Object.entries(READINGS).forEach(([key, { metrics }], n) => {
    out[`${key}:cpu`] = wave(Number(metrics.cpu), 4, n);
    out[`${key}:mem`] = wave(Number(metrics.memPercent), 1.5, n + 1);
    out[`${key}:disk`] = wave(Number(metrics.diskPercent), 0.05, n + 2);
  });
  return out;
}

// ── UPS ──────────────────────────────────────────────────────────────────

/** /api/ups: a UPS on mains power, as refresh.js shapes the NUT exporter's readings. */
export function demoUps() {
  return {
    status: 1,
    charge: 100,
    runtime: 2460,
    load: 18,
    ok: true,
    configured: true,
    model: 'Example UPS 1500VA',
  };
}

// ── Gitea ────────────────────────────────────────────────────────────────

// [repo, [age ms, sha, message, author, branch, CI word]...], newest commit
// first. A repo whose rows have no word has no Actions: no lamp (#532).
const REPOS = [
  [
    'infrastructure',
    [
      [4 * MINUTE, '3f7e2a0', 'Raise the backup job timeout', 'sam', 'main', 'Running'],
      [42 * MINUTE, 'a41c9e2', 'Pin the reverse proxy image to 2.12', 'alex', 'main', 'Passed'],
      [
        5 * HOUR,
        '9be03f1',
        'Move the media stack to its own network',
        'alex',
        'media-network',
        'Failed',
      ],
      [2 * DAY, '17d4c08', 'Add the nightly backup check', 'sam', 'main', 'Passed'],
    ],
  ],
  [
    'dashboard-config',
    [
      [
        3 * HOUR,
        'c0f8a51',
        'Add Quick Launch links for the photo library',
        'sam',
        'main',
        'Passed',
      ],
      [3 * DAY, '5e2b7d9', 'Group the media services', 'sam', 'main', 'Passed'],
    ],
  ],
  [
    'media-scripts',
    [
      [26 * HOUR, 'e7a3310', 'Retry the library scan on a timeout', 'alex', 'main', null],
      [6 * DAY, '0c9d4f6', 'Log the transcode queue length', 'alex', 'main', null],
    ],
  ],
];

// Each CI word's state, as the status rules judge it (judgeCiRuns).
const CI_STATES = { Passed: 'ok', Failed: 'crit', Running: 'unknown' };

/**
 * /api/gitea/activity: recent commits per repo, newest first, each with its
 * branch and CI result, as gitea.js shapes them.
 */
export function demoGiteaActivity({ now = Date.now() } = {}) {
  return REPOS.map(([repo, commits]) => ({
    repo,
    fullName: `demo/${repo}`,
    commits: commits.map(([age, sha, message, author, ref, word]) => ({
      sha,
      message,
      date: new Date(now - age).toISOString(),
      author,
      ref,
      ci: word ? { state: CI_STATES[word], word } : null,
    })),
  }));
}

// ── Scheduled jobs ───────────────────────────────────────────────────────

/**
 * The last `count` times a schedule ran before `now`, newest first, in ms:
 * every `step` ms from `first` (a time it ran), the newest at least
 * RUN_MIN_AGE before `now`. The demo's reporters keep UTC, as their schedules
 * say, so each run is on its schedule (#578).
 */
const RUN_MIN_AGE = 20 * MINUTE;
function runTimes(now, { first, step }, count = 3) {
  const latest = first + Math.floor((now - RUN_MIN_AGE - first) / step) * step;
  return Array.from({ length: count }, (_, i) => latest - i * step);
}

// 1970-01-04 was a Sunday: a weekly schedule's first Sunday.
const SUNDAY = 3 * DAY;

/** One reported run: it started at `start` and reported when it ended. */
const run = (start, seconds, extra) => ({
  status: 'success',
  timestamp: new Date(start + seconds * 1000).toISOString(),
  duration_seconds: seconds,
  ...extra,
});

/**
 * The cron store's statuses (cron-store.js getAllStatuses), nodes and jobs
 * sorted. Each run has the keys recordRun() stores (checked against it by
 * server/demoFixtures.test.js). Each job ran when its schedule says, in UTC,
 * the schedule saying so ("(UTC)", the zone the reporter keeps): the newest
 * run at least 20 minutes before `now`, so never newer than the demo's
 * warm-up (DEMO_WARM_UP_MS), and none overdue.
 */
export function demoCronStore({ scenario = 'incident', now = Date.now() } = {}) {
  const backupFailed = scenario === 'incident';
  const sixHourly = runTimes(now, { first: 0, step: 6 * HOUR });
  const at4 = runTimes(now, { first: 4 * HOUR, step: DAY });
  const at2 = runTimes(now, { first: 2 * HOUR, step: DAY });
  const sundays = runTimes(now, { first: SUNDAY + 3 * HOUR, step: 7 * DAY });
  return [
    {
      node: 'apps',
      jobs: [
        {
          job: 'db-dump',
          runs: sixHourly.map((t) =>
            run(t, 48, { schedule: '0 */6 * * *', expected_every_seconds: 21_600 })
          ),
        },
        {
          job: 'image-prune',
          runs: at4.map((t) =>
            run(t, 12, { schedule: '0 4 * * * (UTC)', expected_every_seconds: 86_400 })
          ),
        },
      ],
    },
    {
      node: 'storage',
      jobs: [
        {
          job: 'nightly-backup',
          runs: at2.map((t, i) => {
            const schedule = { schedule: '0 2 * * * (UTC)', expected_every_seconds: 86_400 };
            return backupFailed && i === 0
              ? run(t, 4, {
                  ...schedule,
                  status: 'failure',
                  error: 'repository is locked by another process',
                })
              : run(t, 1_380, schedule);
          }),
        },
        {
          job: 'scrub-check',
          runs: sundays.map((t) =>
            run(t, 2_940, { schedule: '0 3 * * 0 (UTC)', expected_every_seconds: 604_800 })
          ),
        },
      ],
    },
  ];
}

/** /api/cron/status, decorated by the live route's decorateStatuses(). */
export function demoCronStatus({ scenario = 'incident', now = Date.now() } = {}) {
  return decorateStatuses(demoCronStore({ scenario, now }), now);
}

// ── Integrations ─────────────────────────────────────────────────────────

/** /api/integrations: none set up. */
export function demoIntegrations() {
  return {};
}

// ── Status (/api/status) ─────────────────────────────────────────────────

// The environment the status model reads: a live install with Kuma and Gitea
// set up, as the board shows (Kuma monitors on its services, Gitea commits in
// its Pipeline panel). The model reads only whether each is set.
const STATUS_ENV = Object.freeze({
  KUMA_URL: 'https://status.example.com',
  JAGHELM_GITEA_URL: 'https://git.example.com',
});

/**
 * The caches a live cycle would leave for this board, in the shape of the
 * status model's live seam (status/index.js liveCaches): the payloads the demo
 * serves (/api/services, /api/ups, /api/integrations), what the services
 * refresh keeps beside its payload, and the cron store's statuses.
 */
function demoStatusCaches(scenario, now) {
  const services = demoServicesEntry(scenario, now);
  const cached = { services: services.payload, ups: demoUps(), integrations: demoIntegrations() };
  return {
    getCached: (key) => cached[key] ?? null,
    getCachedInternal: (key) => (key === 'services' ? services.internal : null),
    getAllCronStatuses: () => demoCronStore({ scenario, now }),
  };
}

/**
 * What one live cycle of this board gives the status model, as the loop reads
 * it (refresh.js updateStatus): the caches for readStatusInputs(), its extras
 * (the environment, and the jobs the demo display config marks as backups),
 * and that config's thresholds. demoStatusCycles runs it twice for
 * /api/status, and the other cross-client status fixtures
 * (testing/statusScenarios.js, #293) start from its `healthy` board.
 */
export function demoStatusCycle({ scenario = 'incident', now = Date.now() } = {}) {
  const config = demoDisplayConfig();
  return {
    caches: demoStatusCaches(scenario, now),
    extra: { env: STATUS_ENV, backupJobs: resolveBackupJobs(config.backupJobs).jobs },
    thresholds: thresholdsOf(config),
  };
}

/**
 * How long the demo's board has been running when a request comes in (#442).
 * Long enough that an issue's age reads as a board that has been up a while
 * ("15 m", not "0 s"), and far past any "for 2 cycles" rule (a minute at the
 * default 30 s refresh). Short enough that every time the model reads in the
 * board (the cron runs; the newest is an hour old) is before it, which
 * demoStatusCycles relies on.
 */
export const DEMO_WARM_UP_MS = 15 * MINUTE;

/**
 * The cycles /api/status is built from, oldest first, each
 * `{ caches, extra, thresholds, now }`: a warm-up cycle DEMO_WARM_UP_MS before
 * `now`, then `now`, over the same board (#442). So the demo answers as a
 * board that has been running a while, not as a fresh boot: every `since` is
 * the warm-up clock (a job's is its last run), and a "for 2 cycles" rule has
 * had its two. The cross-client fixtures' `healthy` and `incident`
 * (testing/statusScenarios.js) are these cycles, so they are what the demo
 * serves.
 *
 * Both cycles read the board as it is at `now`. That is also the board as it
 * was at the warm-up clock, because nothing in it happened in between: every
 * time the model reads is before the warm-up (server/demoStatus.test.js checks
 * it). Building the board again at the warm-up clock would not be: its ages are
 * fixed, so every cron run would move back with the clock, and a job's `since`
 * would be a run before the one /api/cron/status lists.
 */
export function demoStatusCycles({ scenario = 'incident', now = Date.now() } = {}) {
  const cycle = demoStatusCycle({ scenario, now });
  return [now - DEMO_WARM_UP_MS, now].map((at) => ({ ...cycle, now: at }));
}

/**
 * /api/status: the status model of this board, built as the live loop builds
 * it (refresh.js updateStatus): readStatusInputs() over the board's caches,
 * the demo display config's thresholds and backup jobs, through one status
 * tracker over demoStatusCycles, so a board that has been running for
 * DEMO_WARM_UP_MS. The tracker is new on every request: nothing is kept
 * between requests (and the demo runs no push to seed it from), so the answer
 * depends on the scenario and the clock alone. Every `since` is the warm-up
 * clock, except a job's, which is its last run's. Two model runs per request,
 * still about as cheap as /api/services. The demo has no Arcane, so no agents.
 */
export function demoStatus({ scenario = 'incident', now = Date.now() } = {}) {
  const tracker = createStatusTracker();
  let status = null;
  for (const cycle of demoStatusCycles({ scenario, now })) {
    status = tracker.update({
      inputs: readStatusInputs(cycle.caches, cycle.extra),
      thresholds: cycle.thresholds,
      now: cycle.now,
    });
  }
  return status;
}

// ── Display config and the checklist ─────────────────────────────────────

const link = (name, icon, host) => ({ name, icon, url: `https://${host}.example.com` });

/**
 * /api/display-config: the Overview's sections need no layout of their own.
 * The storage node's nightly backup is marked as a backup (#291), so the status
 * model judges it as one: its failed run in `incident` is a failed backup.
 */
export function demoDisplayConfig() {
  return {
    title: 'JagHelm',
    subtitle: 'Live Demo',
    theme: 'dark',
    showSearch: true,
    showWeather: false,
    showDots: true,
    refreshInterval: 30,
    backupJobs: ['storage:nightly-backup'],
    tabs: [],
    sections: {},
    links: {
      personal: [
        link('Nextcloud', 'nextcloud', 'cloud'),
        link('Jellyfin', 'jellyfin', 'media'),
        link('PhotoPrism', 'photoprism', 'photos'),
      ],
      management: [
        link('Proxmox', 'proxmox', 'proxmox'),
        link('AdGuard Home', 'adguard-home', 'dns'),
        link('Nginx Proxy Manager', 'nginx-proxy-manager', 'proxy'),
      ],
      devops: [
        link('Grafana', 'grafana', 'grafana'),
        link('Gitea', 'gitea', 'git'),
        link('Uptime Kuma', 'uptime-kuma', 'status'),
      ],
    },
  };
}

/** /api/todos. */
export function demoTodos() {
  return [
    {
      id: 'demo-1',
      text: 'This is a read-only demo: nothing you change is saved',
      done: false,
      due: null,
    },
    { id: 'demo-2', text: 'Renew the TLS certificate for the proxy', done: false, due: null },
    { id: 'demo-3', text: 'Test a restore from last week’s backup', done: true, due: null },
  ];
}
