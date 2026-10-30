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
import { BEATS_KEPT, createBeatStore } from './kumaBeats.js';
import { generateDefaultConfig } from './config.js';
import { createStatusTracker, readStatusInputs } from './status/index.js';
import { resolveBackupJobs } from './status/backupJobs.js';
import { monitorMappingView } from './monitorMapping.js';
import { HISTORY_RANGES, HISTORY_SERIES, parseHistoryQuery, rangeWindow } from './promHistory.js';
import { MONITORING_CHARTS, diskRunwayOf, parseMonitoringRange } from './monitoring.js';
import { arraysOf, drivesAnswer } from './monitoringDrives.js';

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
    failure: null,
    failedReads: [],
    reachable: true,
    metrics: { ...metrics },
    containers: containers.map(([name, cpu, memMB, rx, tx]) => ({
      container: name,
      status: 'running',
      docker: {
        cpu,
        memMB,
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

// The heartbeat strips (#312): every monitor's last BEATS_KEPT checks, one
// every 30 s up to its last beat 20 s ago, as Kuma's status page lists them.
// Each run of checks that weren't up: [monitor, scenario (or both), from,
// to, Kuma's status], counted back from the newest check (0). Jellyfin's
// outage is the incident's: down for 16 minutes after a check pending, so
// since before the board's warm-up (DEMO_WARM_UP_MS), when the model saw it
// down first. In the incident too, Nextcloud was down for a minute ten
// minutes ago and PhotoPrism had a check pending. Backrest's maintenance
// window stays quiet, so the healthy board's strips light nothing up.
const BEAT_EVERY = 30_000;
const LAST_BEAT_AGO = 20_000;
const KUMA_DOWN = 0;
const KUMA_PENDING = 2;
const KUMA_MAINTENANCE = 3;
const NOT_UP = [
  ['Jellyfin', 'incident', 0, 31, KUMA_DOWN],
  ['Jellyfin', 'incident', 32, 32, KUMA_PENDING],
  ['Nextcloud', 'incident', 20, 21, KUMA_DOWN],
  ['Nextcloud', 'incident', 22, 22, KUMA_PENDING],
  ['PhotoPrism', 'incident', 33, 33, KUMA_PENDING],
  ['Backrest', null, 36, 41, KUMA_MAINTENANCE],
];

/** A monitor's beats, oldest first, in kumaBeats()' shape. */
function demoBeats(id, name, ping, scenario, now) {
  return Array.from({ length: BEATS_KEPT }, (_, k) => {
    const back = BEATS_KEPT - 1 - k;
    const run = NOT_UP.find(
      ([n, only, from, to]) =>
        n === name && (only == null || only === scenario) && back >= from && back <= to
    );
    const s = run ? run[4] : 1;
    // A response time that wobbles a little from check to check, the same every time.
    const p = s === 1 ? Math.max(1, ping + ((back * 7 + id * 3) % 9) - 4) : null;
    return { t: now - LAST_BEAT_AGO - back * BEAT_EVERY, s, p };
  });
}

/**
 * The monitors, in the shape monitors.js fetchMonitors() gives them on its
 * status page path, Kuma's beats included (checked against it by
 * server/demoFixtures.test.js).
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
      lastBeatAt: now - LAST_BEAT_AGO,
      beats: demoBeats(id, name, ping, scenario, now),
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
  const monitors = demoMonitors(scenario, now);
  const assembled = assembleServices({
    nodeResults,
    monitors,
    config,
    lastSeenNodeOf: () => null,
    lastSeenContainerOf: () => null,
    containerRegistry: null,
    now: () => now,
  });
  // Each service's strip, as the live refresh keeps them (kumaBeats.js).
  const beatStore = createBeatStore();
  beatStore.record({ ok: true, monitors, now });
  const beats = beatStore.encodedFor(assembled.monitorOf, { ok: true });
  return servicesCacheEntry(assembled, { prometheusOk: true, kumaOk: true, beats });
}

/** /api/services/monitor-mapping (#319): the demo board's monitors, read as the live route reads its own. */
export function demoMonitorMapping({ scenario = 'incident', now = Date.now() } = {}) {
  const { payload, internal } = demoServicesEntry(scenario, now);
  return {
    services: monitorMappingView({
      nodes: payload.nodes,
      monitorOf: internal.monitorOf,
      monitors: demoMonitors(scenario, now),
      services: demoServicesConfig().services,
    }),
  };
}

/** /api/services, assembled by the live server's assembleServices(). */
export function demoServices({ scenario = 'incident', now = Date.now() } = {}) {
  return demoServicesEntry(scenario, now).payload;
}

// ── History (charts, #311) ───────────────────────────────────────────────

const TAU = 2 * Math.PI;

/**
 * A repeatable wobble at `t` (seconds): a day's swell, a 3-hour drift, a
 * 20-minute ripple and a little noise, so an hour moves and a week shows its
 * days.
 */
function wobble(t, phase) {
  const noise = Math.sin(t * 0.0137 + phase * 7.1) * Math.sin(t * 0.0071 + phase);
  return (
    0.6 * Math.sin((TAU * t) / 86_400 + phase) +
    0.25 * Math.sin((TAU * t) / 10_800 + 2 * phase) +
    0.15 * Math.sin((TAU * t) / 1_200 + 3 * phase) +
    0.1 * noise
  );
}

/** Swap in use now, in percent, of each demo node that has swap (the rest have none). */
const DEMO_SWAP = { apps: 12.4, storage: 3.1 };

/**
 * Each series' reading at `t` for the demo: around its current value, which
 * it reaches on the minute `now` is in, so a node card's last hour ends on
 * the reading its meter shows. A node's disk fills a little over the week.
 * `null` where the node has no such reading (no sensor).
 */
const DEMO_SERIES = {
  'node.cpu': (r) => r.node && { base: Number(r.node.metrics.cpu), swing: 5, max: 100 },
  // Waiting on I/O: a small share of the CPU reading.
  'node.iowait': (r) => r.node && { base: Number(r.node.metrics.cpu) * 0.12, swing: 0.8, max: 100 },
  'node.memory': (r) => r.node && { base: Number(r.node.metrics.memPercent), swing: 3, max: 100 },
  // Swap in use (#757): the nodes in DEMO_SWAP have swap; the others have none, so no line.
  'node.swap': (r) => r.node && r.key in DEMO_SWAP && { base: DEMO_SWAP[r.key], swing: 1.5, max: 100 },
  'node.disk': (r) =>
    r.node && { base: Number(r.node.metrics.diskPercent), swing: 0.2, max: 100, growth: 1.5 },
  'node.temperature': (r) =>
    r.node?.metrics.temp != null && { base: Number(r.node.metrics.temp), swing: 2.5 },
  'drive.temperature': (r) => r.drive && { base: r.drive.temperature, swing: 1.5 },
  net: (r) => ({ base: r.base, swing: r.base * 0.4, bytes: true }),
  'container.cpu': (r) => r.box && { base: r.box[1], swing: Math.max(0.4, r.box[1] * 0.6) },
  'container.memory': (r) =>
    r.box && { base: r.box[2] * MiB, swing: r.box[2] * MiB * 0.06, bytes: true },
};

function demoLine(name, entity, reading, { start, step, count }, nowSec, phase) {
  const shape = DEMO_SERIES[name]({ ...reading, key: entity });
  if (!shape || !Number.isFinite(shape.base)) return null;
  const values = [];
  for (let i = 0; i < count; i += 1) {
    const t = start + i * step;
    let v = shape.base + shape.swing * (wobble(t, phase) - wobble(nowSec, phase));
    if (shape.growth) v -= (shape.growth * (nowSec - t)) / 604_800;
    v = Math.max(0, shape.max ? Math.min(shape.max, v) : v);
    values.push(shape.bytes ? Math.round(v) : oneDecimal(v));
  }
  return { entity, values };
}

/**
 * /api/history (#311): the live route's answer for the demo's world, with
 * readings made up around each node's and container's current one. It
 * refuses what the live route refuses (parseHistoryQuery), and answers a
 * node, or a container on a node, the demo doesn't have 404, as the live
 * route does for one the server hasn't seen.
 */
export function demoHistory({ query = {}, now = Date.now() } = {}) {
  const parsed = parseHistoryQuery(query);
  if (!parsed.ok) return { status: parsed.status, body: { error: parsed.error } };
  const kind = HISTORY_SERIES[parsed.series[0]].kind;
  const nodeKey =
    parsed.entity == null ? null : kind === 'node' ? parsed.entity : parsed.entity.split('/')[0];
  if (nodeKey != null && !Object.hasOwn(READINGS, nodeKey)) {
    return { status: 404, body: { error: 'No node by that name in services.yaml' } };
  }
  if (kind === 'container') {
    const container = parsed.entity.slice(nodeKey.length + 1);
    if (!READINGS[nodeKey].containers.some(([c]) => c === container)) {
      return { status: 404, body: { error: 'No container by that name on that node' } };
    }
  }
  const keys = nodeKey == null ? Object.keys(READINGS) : [nodeKey];
  const nowSec = Math.floor(now / MINUTE) * 60;
  const series = parsed.series.map((name) => {
    const window = rangeWindow(parsed.range, now);
    if (HISTORY_SERIES[name].perDevice) {
      // Drives (#728): a line per drive the demo's node has, around its reading,
      // as the exporter's plateaus are (flat for a stretch).
      const drives = demoDrives().nodes[nodeKey]?.drives ?? [];
      const lines = drives
        .filter((d) => Number.isFinite(d.temperature))
        .map((d, n) =>
          demoLine(name, d.device, { drive: d }, window, nowSec, n + 5)
        );
      return {
        series: name,
        unit: HISTORY_SERIES[name].unit,
        startMs: window.start * 1000,
        stepMs: window.step * 1000,
        count: window.count,
        ok: true,
        lines: lines.sort((a, b) => (a.entity < b.entity ? -1 : 1)),
      };
    }
    const lines = keys
      .map((key, n) => {
        const node = READINGS[key];
        if (kind === 'node') return demoLine(name, key, { node }, window, nowSec, n);
        const container = parsed.entity.slice(key.length + 1);
        const box = node.containers.find(([c]) => c === container);
        return demoLine(name, parsed.entity, { box }, window, nowSec, n + container.length);
      })
      .filter(Boolean);
    return {
      series: name,
      unit: HISTORY_SERIES[name].unit,
      startMs: window.start * 1000,
      stepMs: window.step * 1000,
      count: window.count,
      ok: true,
      lines,
    };
  });
  return { status: 200, body: { range: parsed.range, entity: parsed.entity, series } };
}

/** The demo UPS's draw: its load (demoUps) of a 500 W nominal rating, plus a daily swing. */
const DEMO_WATTS = 90;

/**
 * /api/monitoring (#751): the live route's answer for the demo's world, each
 * chart of the table made up around the nodes' current readings (the history
 * charts' way). A range the live route refuses is its 400. The charts the
 * table has so far are CPU (cpu-overview), power draw, monthly cost and network; a later card adds its chart's
 * readings here beside its row in MONITORING_CHARTS (the test in
 * demoFixtures.test.js holds the two in step).
 */
const DEMO_MONITORING = {
  'power-draw': (window, nowSec, range) => {
    const phase = 2.3;
    const values = [];
    for (let i = 0; i < window.count; i += 1) {
      const t = window.start + i * window.step;
      values.push(oneDecimal(DEMO_WATTS + 6 * (wobble(t, phase) - wobble(nowSec, phase))));
    }
    // The long ranges carry a max band: the peak of each step, a little over its average.
    const maxValues = HISTORY_RANGES[range].max
      ? values.map((v, i) => oneDecimal(v + 4 + 3 * Math.abs(Math.sin(i * 1.7))))
      : null;
    const top = maxValues ?? values;
    return {
      unit: 'W',
      startMs: window.start * 1000,
      stepMs: window.step * 1000,
      count: window.count,
      state: 'ok',
      values,
      maxValues,
      stats: {
        minWatts: Math.min(...values),
        maxWatts: Math.max(...top),
        avgWatts: oneDecimal(values.reduce((a, b) => a + b, 0) / values.length),
      },
      // As the live chart: only the 1 h and 24 h answers carry the runtime.
      ...(['1h', '24h'].includes(range) ? { runtimeMinutes: Math.round(demoUps().runtime / 60) } : {}),
    };
  },
  // Thirty days to today (UTC, the demo's zone): about 2.2 kWh a day, $0.14 per
  // kWh until the 17th of the month and $0.16 after (a rate change in the history).
  'monthly-cost': (window, nowSec) => {
    const today = new Date(nowSec * 1000);
    const dayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const day = (ms) => new Date(ms).toISOString().slice(0, 10);
    const monthStart = day(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const days = [];
    for (let n = 29; n >= 0; n -= 1) {
      const startMs = dayMs - n * 86_400_000;
      const partial = n === 0;
      const kWh = Math.round((2.15 + 0.12 * Math.sin(startMs / 86_400_000) + (partial ? -1.1 : 0)) * 1000) / 1000;
      const ratePerKwh = day(startMs) >= `${monthStart.slice(0, 7)}-17` ? 0.16 : 0.14;
      days.push({
        day: day(startMs),
        startMs,
        kWh,
        cost: Math.round(kWh * ratePerKwh * 10_000) / 10_000,
        ratePerKwh,
        coverage: 1,
        partial,
      });
    }
    const inMonth = days.filter((d) => d.day >= monthStart);
    const mtdCost = inMonth.reduce((a, d) => a + d.cost, 0);
    const mtdKwh = inMonth.reduce((a, d) => a + d.kWh, 0);
    const dim = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)).getUTCDate();
    const daysLeft = dim - today.getUTCDate() + 0.5;
    return {
      state: 'ok',
      zone: 'UTC',
      currency: '$',
      currentRatePerKwh: 0.16,
      throughMs: nowSec * 1000,
      days,
      month: {
        month: monthStart.slice(0, 7),
        since: null,
        daysLeft,
        kWh: Math.round(mtdKwh * 1000) / 1000,
        cost: Math.round(mtdCost * 100) / 100,
        projected: {
          kWh: Math.round((mtdKwh + daysLeft * 2.2) * 100) / 100,
          cost: Math.round((mtdCost + daysLeft * 2.2 * 0.16) * 100) / 100,
          basisDays: 7,
          meanDailyKWh: 2.2,
        },
      },
    };
  },
  // The demo's drives: the status model's own rows for its NAS (the board's
  // lamps), a temperature line per drive around its reading, and one healthy
  // three-disk array, through the live chart's own assembly (monitoringDrives.js).
  drives: (window, nowSec, range, now) => {
    const status = demoStatus({ now });
    const head = {
      unit: HISTORY_SERIES['drive.temperature'].unit,
      startMs: window.start * 1000,
      stepMs: window.step * 1000,
      count: window.count,
    };
    const temps = {};
    for (const [key, node] of Object.entries(demoDrives().nodes)) {
      temps[key] = node.drives
        .filter((d) => Number.isFinite(d.temperature))
        .map((d, n) => demoLine('drive.temperature', d.device, { drive: d }, window, nowSec, n + 5));
    }
    const md = (state, n) => ({ metric: { node: 'storage', device: 'md0', state }, value: [nowSec, String(n)] });
    const raid = arraysOf(
      [md('active', 3), md('failed', 0), md('spare', 0)],
      [{ metric: { node: 'storage', device: 'md0' }, value: [nowSec, '3'] }],
      (metric) => (metric.node === 'storage' ? ['storage'] : [])
    );
    return drivesAnswer({ status, drivesRead: demoDrives(), temps, raid, head });
  },
  // The CPU small multiples and their drill-down (#756): every node's CPU, and its
  // I/O wait and temperature (a node with no sensor has no temperature line). The
  // long ranges carry the max band: each step's peak a little over its average.
  'cpu-overview': (window, nowSec, range) => {
    const head = {
      startMs: window.start * 1000,
      stepMs: window.step * 1000,
      count: window.count,
    };
    const linesOfSeries = (name) =>
      Object.entries(READINGS)
        .map(([key, node], n) => demoLine(name, key, { node }, window, nowSec, n))
        .filter(Boolean);
    const peaks = (lines, over) =>
      lines.map(({ entity, values }) => ({
        entity,
        values: values.map((v, i) =>
          oneDecimal(Math.min(100, v + over * (1 + Math.abs(Math.sin(i * 1.7)))))
        ),
      }));
    const part = (name, over) => {
      const lines = linesOfSeries(name);
      return {
        ok: true,
        unit: HISTORY_SERIES[name].unit,
        lines,
        ...(HISTORY_RANGES[range].max && { maxLines: peaks(lines, over) }),
      };
    };
    const cpu = part('node.cpu', 4);
    return {
      ...head,
      unit: cpu.unit,
      nodes: Object.keys(READINGS),
      lines: cpu.lines,
      ...(cpu.maxLines && { maxLines: cpu.maxLines }),
      thresholds: { cpu: { warn: 90 }, temp: { warn: 75, crit: 85 } },
      iowait: part('node.iowait', 1.5),
      temperature: part('node.temperature', 2),
    };
  },
  // The disk forecast's own demo answer, ranked as the live chart ranks it.
  'disk-runway': (window, nowSec) => diskRunwayOf(demoDiskForecast({ now: nowSec * 1000 }), {}),
  // A few events spread over the range, by fraction of it, snapped to a step as the live read's are:
  // a recreation, a plain restart, two OOM kills of paperless-ngx, one of photoprism, and a flapping backrest.
  restarts: (window) => {
    const stepMs = window.step * 1000;
    const startMs = window.start * 1000;
    const endMs = window.end * 1000;
    const span = endMs - startMs;
    const when = (f) => startMs + Math.round((f * span) / stepMs) * stepMs;
    const RESTART = 'container recreated';
    const RESET = 'process restarted';
    const events = [
      { f: 0.12, kind: 'restart', node: 'apps', name: 'nextcloud', how: RESTART },
      { f: 0.31, kind: 'restart', node: 'apps', name: 'jellyfin', how: RESET },
      { f: 0.55, kind: 'oom', node: 'apps', name: 'paperless-ngx', count: 1 },
      { f: 0.56, kind: 'restart', node: 'apps', name: 'paperless-ngx', how: RESET },
      { f: 0.83, kind: 'oom', node: 'apps', name: 'paperless-ngx', count: 2 },
      { f: 0.64, kind: 'oom', node: 'storage', name: 'photoprism', count: 1 },
      ...[0.7, 0.76, 0.82, 0.88, 0.94].map((f) => ({ f, kind: 'restart', node: 'storage', name: 'backrest', how: RESET })),
    ].map(({ f, ...e }) => ({ time: when(f), ...e }));
    return {
      state: 'ok',
      startMs,
      endMs,
      stepMs,
      events: events.sort((a, b) => a.time - b.time),
      truncated: false,
      blindNodes: [],
      oomCounter: true,
    };
  },
  // Added by #760 (E1): a week of working set per container, growth the rule's difference.
  'container-growth': (window, nowSec) => {
    const step = 7_200;
    const end = Math.floor(nowSec / step) * step;
    const count = 84;
    const growers = [
      ['apps', 'loki', 1.9e9, 2.4e9],
      ['apps', 'immich-server', 1.2e9, 1.1e9],
      ['storage', 'win11-vm-agent', 3.1e9, 0.7e9],
      ['apps', 'grafana', 0.45e9, 0.3e9],
      ['edge', 'adguard', 0.2e9, 0.12e9],
    ];
    return {
      state: 'ok',
      trendStartMs: (end - (count - 1) * step) * 1000,
      trendStepMs: step * 1000,
      rows: growers.map(([node, name, base, growth], n) => ({
        key: `${node}/${name}`,
        node,
        name,
        growthBytes: growth,
        trend: Array.from({ length: count }, (_, i) =>
          Math.round(base + (growth * i) / (count - 1) + growth * 0.05 * Math.sin(i / 3 + n))
        ),
      })),
    };
  },
  // Per node, in and out around a base that scales with its containers' traffic.
  network: (window, nowSec) => ({
    unit: HISTORY_SERIES['node.net.rx'].unit,
    startMs: window.start * 1000,
    stepMs: window.step * 1000,
    count: window.count,
    nodes: Object.entries(READINGS).map(([entity, node], n) => {
      const sum = (i) => node.containers.reduce((a, c) => a + c[i], 0);
      const line = (base, phase) =>
        demoLine('net', entity, { base }, window, nowSec, phase).values;
      return { entity, rx: line(sum(3), n), tx: line(sum(4), n + 3) };
    }),
  }),
  // The memory small multiples (#757): each node's memory in use, and its swap where it has any.
  memory: (window, nowSec) => {
    const head = { startMs: window.start * 1000, stepMs: window.step * 1000, count: window.count };
    const linesOfSeries = (name) =>
      Object.entries(READINGS)
        .map(([key, node], n) => demoLine(name, key, { node }, window, nowSec, n + 3))
        .filter(Boolean);
    return {
      ...head,
      unit: HISTORY_SERIES['node.memory'].unit,
      nodes: Object.keys(READINGS),
      lines: linesOfSeries('node.memory'),
      thresholds: { mem: { warn: 90 } },
      swap: { ok: true, unit: HISTORY_SERIES['node.swap'].unit, lines: linesOfSeries('node.swap') },
    };
  },
};

export function demoMonitoring({ query = {}, now = Date.now() } = {}) {
  const range = parseMonitoringRange(query);
  if (range === null) return { status: 400, body: { error: 'Unknown range: one of 1h, 24h, 7d, 30d' } };
  const window = rangeWindow(range, now);
  const nowSec = Math.floor(now / MINUTE) * 60;
  const charts = Object.entries(MONITORING_CHARTS).map(([id, chart]) => ({
    id,
    title: chart.title,
    question: chart.question,
    section: chart.section,
    ok: true,
    ...DEMO_MONITORING[id](window, nowSec, range, now),
  }));
  return { status: 200, body: { range, charts } };
}

// ── Disk forecast ────────────────────────────────────────────────────────

/**
 * /api/disk-forecast: the shape diskForecast.js serves. Every number is far
 * enough off (yet inside the 180 day cutoff, #812) to be drawn plain (past the 14 day line), so the demo's boards
 * keep their one amber and no red (the browser tests read the hues): the edge
 * is stable, the app server and the NAS fill slowly, the NAS faster in the
 * incident, where it is at 94.6 %.
 */
export function demoDiskForecast({ scenario = 'incident', now = Date.now() } = {}) {
  // The size is what the Monitoring page's projection ends at; the used bytes follow from the days left.
  const ok = (mount, daysLeft, growthBytesPerDay, sizeBytes = 250e9) => ({
    sizeBytes,
    usedBytes: Math.round(sizeBytes - daysLeft * growthBytesPerDay),
    mount,
    primary: true,
    status: 'ok',
    daysLeft,
    growthBytesPerDay,
    r2: 0.97,
    samples: 169,
  });
  const incident = scenario === 'incident';
  const nasForecast = (poolDays) => {
    const pool = ok('/volume1', poolDays, 2.0e10, 11.5e12);
    const overlay = { ...ok('/overlay', 24, 0.3e9, 16.5e9), primary: false };
    return { ...overlay, mounts: [overlay, pool] };
  };
  return {
    ok: true,
    computedAt: new Date(now).toISOString(),
    windowDays: 7,
    nodes: {
      edge: {
        mount: '/',
        primary: true,
        status: 'stable',
        daysLeft: null,
        growthBytesPerDay: 0,
        r2: 0,
        samples: 169,
        sizeBytes: 128e9,
        usedBytes: 41e9,
      },
      apps: ok('/', 142, 0.9e9),
      // The NAS: a small /overlay fills first and stands for the node; the pool
      // is the main data volume and has its own row (#797).
      storage: nasForecast(incident ? 31 : 170),
    },
  };
}

// ── UPS ──────────────────────────────────────────────────────────────────

/** The cached UPS reading (no route serves it, #328): a UPS on mains power, as refresh.js shapes the NUT exporter's readings. */
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

// A fetch that worked, as the backoff gives it back to the payload (#239). It
// has been ok since the board's warm-up clock, which the status model takes
// as the `since` of everything in it (server/demoStatus.test.js, #442).
const integrationOk = (now) => ({
  state: 'ok',
  since: now - DEMO_WARM_UP_MS,
  failures: 0,
  nextAttemptAt: null,
});

/**
 * /api/integrations (#518): what refreshIntegrations serves for a board with
 * eight integrations set up, one entry per enabled integration, in config
 * order, keyed by its type as a first install saves it. An entry is the
 * preset's display fields (the strings formatValue gives, not numbers) plus
 * the `_`-prefixed internals the refresh stamps: `_preset` and `_status`.
 *
 * Every entry is healthy. Syncthing, Backrest and WireGuard have no preset,
 * and Nextcloud's was retired (RETIRED_PRESETS), so they have no entry and
 * their rows show no metric: the unconfigured state. A failing integration is
 * left out on purpose: it would be a third open issue (judgeIntegration) and
 * change the incident's story, its events and its headline. No `_target` is
 * set, so each entry is matched to its container by name (useAppDataMatching),
 * as on a first install. Nothing here is a URL, a key or a login: the live
 * payload carries none either. server/demoFixtures.test.js holds this to the
 * presets' own fields and to backoff.js's `_status`.
 *
 * @param {{ now?: number }} [opts]
 */
export function demoIntegrations({ now = Date.now() } = {}) {
  const ok = () => integrationOk(now);
  return {
    adguard: {
      Queries: '41,208',
      Blocked: '9,386',
      'Block %': '22.8%',
      Latency: '12ms',
      _preset: 'adguard',
      _status: ok(),
    },
    npm: { Online: '14', Offline: '1', Certs: '12', _preset: 'npm', _status: ok() },
    gitea: { Repos: '11', Issues: '6', Stars: '23', _preset: 'gitea', _status: ok() },
    grafana: { Alerts: 'All OK', Rules: '18', _preset: 'grafana', _status: ok() },
    jellyfin: { Version: '10.10.3', Update: 'false', _preset: 'jellyfin', _status: ok() },
    vaultwarden: { Status: 'Online', _preset: 'vaultwarden', _status: ok() },
    paperless: { Docs: '1,284', _preset: 'paperless', _status: ok() },
    photoprism: {
      Photos: '24,499',
      Videos: '812',
      Albums: '64',
      People: '19',
      _preset: 'photoprism',
      _status: ok(),
    },
  };
}

// ── Status (/api/status) ─────────────────────────────────────────────────

// The environment the status model reads: a live install with Kuma and Gitea
// set up, as the board shows (Kuma monitors on its services, Gitea commits in
// its Pipeline panel). The model reads only whether each is set.
const STATUS_ENV = Object.freeze({
  PROMETHEUS_URL: 'https://prometheus.example.com',
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
  const cached = {
    services: services.payload,
    ups: demoUps(),
    integrations: demoIntegrations({ now }),
    drives: demoDrives(),
  };
  return {
    getCached: (key) => cached[key] ?? null,
    getCachedInternal: (key) => (key === 'services' ? services.internal : null),
    getAllCronStatuses: () => demoCronStore({ scenario, now }),
  };
}

// ── Drives (the drive-health module, drives.js) ──────────────────────────

const zeroCount = { count: 0, grew: false };

// A drive in the shape drives.js normalise() gives (server/demoFixtures.test.js
// keeps the two in step): a spinning NAS drive, and an NVMe.
const demoHdd = (device, over = {}) => ({
  device,
  model: 'ST8000VN004-3CP101',
  type: 'hdd',
  smartPassed: true,
  criticalWarning: null,
  availableSpare: null,
  spareThreshold: null,
  percentageUsed: null,
  temperature: 41,
  powerOnSeconds: 19_872_000,
  exitStatus: 0,
  mediaErrors: null,
  sectors: { reallocated: zeroCount, pending: zeroCount, uncorrectable: zeroCount },
  ...over,
});
const demoNvme = (device, over = {}) => ({
  device,
  model: 'CT1000P310SSD8',
  type: 'nvme',
  smartPassed: true,
  criticalWarning: 0,
  availableSpare: 100,
  spareThreshold: 5,
  percentageUsed: 2,
  temperature: 31,
  powerOnSeconds: 19_674_000,
  exitStatus: 0,
  mediaErrors: zeroCount,
  sectors: null,
  ...over,
});

/**
 * The drive read the demo's board has (the `drives` cache, drives.js): the
 * storage node's NVMe cache and three NAS drives, all healthy in both
 * scenarios, so the incident board is the one it was without drives. The
 * other nodes have no SMART data, as a Raspberry Pi or a VM has none.
 */
export function demoDrives() {
  const drives = [demoHdd('sda', { temperature: 40 }), demoHdd('sdb', { temperature: 42 }), demoHdd('sdc', { temperature: 39 }), demoNvme('nvme0')];
  return { enabled: true, nodes: { storage: { devices: drives.length, scrapeUp: true, drives, readingSeconds: 3600 } } };
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
