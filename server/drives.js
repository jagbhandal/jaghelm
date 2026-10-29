// @ts-check
/**
 * Drive health (SMART), the source half (docs/superpowers/specs/2026-10-29-drive-health-design.md
 * §4, §7): what the status model's `drives` input is. JagHelm never talks to a
 * disk. It reads `smartctl_exporter` series from the Prometheus it already
 * uses, as diskForecast.js reads filesystem series: one answer is kept for
 * CACHE_TTL_MS and shared by every reader, and a failed read is kept for
 * FAILURE_TTL_MS before Prometheus is asked again.
 *
 * An optional module (§7). One probe, `count(smartctl_devices)`, decides
 * whether any node has drive series; with none the answer is empty and the
 * probe is the only query. `JAGHELM_DRIVES=off` turns it off even when series
 * exist (`drivesEnabled`, which will also read a flag Settings stores). Off or
 * absent, the status model builds exactly what it did before drives.
 *
 * The read is 11 instant queries per window, every visible node at once, each
 * aggregated `by (node, device…)`, so the series' other labels never arrive.
 * The info series `smartctl_device` carries `serial_number`: it is aggregated
 * away in the query (`by (node, device, model_name, protocol)`) and no
 * field of a record is derived from it, so a serial is never read, stored,
 * logged or served.
 *
 *  - the info series (model name, protocol), the drive's values (health check,
 *    NVMe critical warning, spare, media errors, wear, power-on time, rotation
 *    rate, smartctl's exit status), its temperature
 *    (`temperature_type="current"` only: the series also carries the drive's
 *    own limits), and the raw SATA sector counts of attributes 5, 197 and 198;
 *  - growth over GROWTH_WINDOW: `delta` of each sector count (one query per
 *    attribute id) and `increase` of the media errors. A counter is judged by
 *    its growth, never "above zero" (status/drives.js);
 *  - `smartctl_devices` per node (present while the exporter answers) and the
 *    `up` of the smartctl scrape (a job whose name starts `smartctl`), which
 *    tell a drive that is gone from an exporter that is.
 *
 * The exporter caches (about every 10 minutes), and a drive in standby is not
 * woken, so Prometheus keeps the last cached values for a sleeping drive: that
 * can't be told from a fresh reading here, and is accepted (§4).
 */
import { getConfig } from './config.js';
import { promQuery, promString } from './discovery.js';
import { envValue } from './env.js';
import { failureDetail, failureSentence } from './failureWords.js';
import { resolveEntity } from './promHistory.js';
import { createLogger } from './util/logger.js';

const log = createLogger('drives');

/** How far back growth is judged: Prometheus' range syntax, and in words (status/drives.js). */
export const GROWTH_WINDOW = '7d';
/** An answer, and the probe's, is kept this long; every reader in that time shares it. */
export const CACHE_TTL_MS = 10 * 60_000;
/** A failed read is kept this long before Prometheus is asked again. */
export const FAILURE_TTL_MS = 30_000;

/** The SATA attributes whose raw count is a sector problem: reallocated, pending, offline-uncorrectable. */
export const SECTOR_ATTRIBUTES = Object.freeze({
  5: 'reallocated',
  197: 'pending',
  198: 'uncorrectable',
});

// The per-drive values read in one query, by series name.
const VALUE_SERIES = [
  'smart_status',
  'critical_warning',
  'available_spare',
  'available_spare_threshold',
  'media_errors',
  'percentage_used',
  'power_on_seconds',
  'rotation_rate',
  'smartctl_exit_status',
];

/**
 * Whether the module is on: not while `JAGHELM_DRIVES=off`, and not while a
 * stored switch (Settings, a later change) says so. `stored` is that switch's
 * value; `undefined` is "not set", which is on.
 *
 * @param {{ env?: Record<string, string | undefined>, stored?: boolean }} [opts]
 */
export function drivesEnabled({ env, stored } = {}) {
  if (envValue('JAGHELM_DRIVES', env) === 'off') return false;
  return stored !== false;
}

/**
 * The queries for a node matcher (`node=~"a|b"`), by name. None selects the
 * `serial_number` label: every query aggregates it away.
 *
 * @param {string} matcher
 */
export function driveQueries(matcher) {
  const m = matcher;
  /** @type {Record<string, string>} */
  const q = {
    probe: `count(smartctl_devices{${m}})`,
    info: `max by (node, device, model_name, protocol) (smartctl_device{${m}})`,
    values: `max by (__name__, node, device) ({__name__=~${promString(`smartctl_device_(${VALUE_SERIES.join('|')})`)},${m}})`,
    temperature: `max by (node, device) (smartctl_device_temperature{${m},temperature_type="current"})`,
    sectors: `max by (node, device, attribute_id) (smartctl_device_attribute{${m},attribute_id=~"5|197|198",attribute_value_type="raw"})`,
    devices: `max by (node) (smartctl_devices{${m}})`,
    up: `max by (node) (up{${m},job=~"smartctl.*"})`,
    mediaGrowth: `max by (node, device) (increase(smartctl_device_media_errors{${m}}[${GROWTH_WINDOW}]))`,
  };
  for (const id of Object.keys(SECTOR_ATTRIBUTES)) {
    q[`growth${id}`] =
      `max by (node, device) (delta(smartctl_device_attribute{${m},attribute_id="${id}",attribute_value_type="raw"}[${GROWTH_WINDOW}]))`;
  }
  return q;
}

/** A sample's value as a number, null when it isn't one. */
function valueOf(/** @type {any} */ sample) {
  const raw = Array.isArray(sample?.value) ? sample.value[1] : undefined;
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Whether growth is seen: anything above zero (a drop is a reset, not growth). */
const grew = (/** @type {number | null | undefined} */ n) => typeof n === 'number' && n > 0;

/** A drive's identity in one read: its node label and device. */
const idOf = (/** @type {any} */ metric) => `${metric?.node}\u0000${metric?.device}`;

/**
 * One drive's kind: NVMe by protocol or a device named `nvme…`, else spinning
 * (`hdd`) or solid state (`ssd`) by the rotation rate; with none given, `sata`.
 */
function typeOf(/** @type {string} */ device, /** @type {string | null} */ protocol, /** @type {number | null} */ rate) {
  if (protocol === 'NVMe' || device.startsWith('nvme')) return 'nvme';
  if (rate === null) return 'sata';
  return rate > 0 ? 'hdd' : 'ssd';
}

/**
 * The per-node drive records for the instant results of driveQueries (`r`),
 * and the node labels no JagHelm node has (`unmatched`). Pure.
 *
 * `{ nodes: { [nodeKey]: { devices, scrapeUp, drives } } }`: `devices` is
 * `smartctl_devices` for the node (null when the exporter reports none),
 * `scrapeUp` the smartctl scrape's `up` (null when unknown), and each drive
 *
 *   device, model, type, smartPassed, criticalWarning, availableSpare,
 *   spareThreshold, percentageUsed, temperature, powerOnSeconds, exitStatus,
 *   mediaErrors { count, grew } (null off NVMe),
 *   sectors { reallocated|pending|uncorrectable: { count, grew } } (null on NVMe)
 *
 * A node appears only if the read had something for it.
 *
 * @param {Record<string, any[]>} r  each query's result, by name (driveQueries)
 * @param {(metric: any) => string[]} lineOf  the node keys a node label stands for (resolveEntity)
 */
export function normalise(r, lineOf) {
  const list = (/** @type {string} */ name) => (Array.isArray(r[name]) ? r[name] : []);
  /** @type {Map<string, any>} */
  const drives = new Map();
  const unmatched = new Set();
  const at = (/** @type {any} */ metric) => {
    const device = metric?.device;
    if (typeof device !== 'string' || device === '') return null;
    const id = idOf(metric);
    if (!drives.has(id)) {
      const lines = lineOf(metric);
      if (lines.length === 0) {
        if (typeof metric?.node === 'string') unmatched.add(metric.node);
        return null;
      }
      drives.set(id, { lines, device, protocol: null, model: null, values: {}, temperature: null, sectors: {}, growth: {} });
    }
    return drives.get(id);
  };

  for (const s of list('info')) {
    const d = at(s.metric);
    if (!d) continue;
    d.model = typeof s.metric.model_name === 'string' && s.metric.model_name ? s.metric.model_name : null;
    d.protocol = typeof s.metric.protocol === 'string' && s.metric.protocol ? s.metric.protocol : null;
  }
  for (const s of list('values')) {
    const d = at(s.metric);
    const name = String(s.metric?.__name__ ?? '').replace(/^smartctl_device_/, '');
    if (d && VALUE_SERIES.includes(name)) d.values[name] = valueOf(s);
  }
  for (const s of list('temperature')) {
    const d = at(s.metric);
    if (d) d.temperature = valueOf(s);
  }
  for (const s of list('sectors')) {
    const d = at(s.metric);
    const kind = /** @type {Record<string, string>} */ (SECTOR_ATTRIBUTES)[String(s.metric?.attribute_id)];
    if (d && kind) d.sectors[kind] = valueOf(s);
  }
  for (const [id, kind] of Object.entries(SECTOR_ATTRIBUTES)) {
    for (const s of list(`growth${id}`)) {
      const d = at(s.metric);
      if (d) d.growth[kind] = valueOf(s);
    }
  }
  for (const s of list('mediaGrowth')) {
    const d = at(s.metric);
    if (d) d.growth.media = valueOf(s);
  }

  /** @type {Record<string, { devices: number | null, scrapeUp: boolean | null, drives: any[] }>} */
  const nodes = {};
  const node = (/** @type {string} */ key) => (nodes[key] ??= { devices: null, scrapeUp: null, drives: [] });
  for (const d of drives.values()) {
    const v = d.values;
    const type = typeOf(d.device, d.protocol, v.rotation_rate ?? null);
    const nvme = type === 'nvme';
    const has = (/** @type {string} */ k) => v[k] !== undefined && v[k] !== null;
    const record = {
      device: d.device,
      model: d.model,
      type,
      smartPassed: has('smart_status') ? v.smart_status > 0 : null,
      criticalWarning: nvme && has('critical_warning') ? v.critical_warning : null,
      availableSpare: nvme && has('available_spare') ? v.available_spare : null,
      spareThreshold: nvme && has('available_spare_threshold') ? v.available_spare_threshold : null,
      percentageUsed: nvme && has('percentage_used') ? v.percentage_used : null,
      temperature: d.temperature,
      powerOnSeconds: has('power_on_seconds') ? v.power_on_seconds : null,
      exitStatus: has('smartctl_exit_status') ? v.smartctl_exit_status : null,
      mediaErrors: nvme && has('media_errors') ? { count: v.media_errors, grew: grew(d.growth.media) } : null,
      sectors: nvme
        ? null
        : Object.fromEntries(
            Object.values(SECTOR_ATTRIBUTES).map((kind) => [
              kind,
              { count: d.sectors[kind] ?? null, grew: grew(d.growth[kind]) },
            ])
          ),
    };
    for (const key of d.lines) node(key).drives.push(record);
  }
  for (const s of list('devices')) {
    const lines = lineOf(s.metric);
    if (lines.length === 0 && typeof s.metric?.node === 'string') unmatched.add(s.metric.node);
    for (const key of lines) node(key).devices = valueOf(s);
  }
  for (const s of list('up')) {
    const lines = lineOf(s.metric);
    if (lines.length === 0 && typeof s.metric?.node === 'string') unmatched.add(s.metric.node);
    const up = valueOf(s);
    for (const key of lines) node(key).scrapeUp = up === null ? null : up > 0;
  }
  for (const n of Object.values(nodes)) n.drives.sort((a, b) => (a.device < b.device ? -1 : a.device > b.device ? 1 : 0));
  const sorted = Object.fromEntries(Object.entries(nodes).sort(([a], [b]) => (a < b ? -1 : 1)));
  return { nodes: sorted, unmatched: [...unmatched].sort() };
}

/**
 * The cache. `query` asks Prometheus (promQuery's signature), `now` is the
 * clock in ms, `enabled` says whether the module is on (drivesEnabled), `logger`
 * where a failure's detail goes.
 *
 * `read()` answers the status model's `drives` input: `{ enabled: false }`
 * when the module is off; `{ enabled: true, nodes }` when it read (`nodes` is
 * empty when the probe found no series); and null when the read failed, which
 * the model takes as a read that did not run: what it holds for drives stays.
 *
 * @param {{ query?: (q: string) => Promise<any[]>, now?: () => number, enabled?: () => boolean, logger?: { warn: Function, info: Function } }} [deps]
 */
export function createDrivesCache({
  query = promQuery,
  now = Date.now,
  enabled = () => drivesEnabled(),
  logger = log,
} = {}) {
  /** @type {{ key: string, at: number, failed: boolean, data: any } | null} */
  let entry = null;
  /** @type {{ key: string, promise: Promise<any> } | null} */
  let asking = null;
  /** @type {string | null} */
  let failing = null;
  let unmatchedSeen = '';

  async function compute(/** @type {any} */ target, /** @type {string} */ key) {
    const at = now();
    try {
      const q = driveQueries(target.matcher);
      const probe = await query(q.probe);
      let data;
      if (probe.length === 0 || !(Number(valueOf(probe[0])) > 0)) {
        data = { enabled: true, nodes: {} };
      } else {
        const names = Object.keys(q).filter((n) => n !== 'probe');
        const results = await Promise.all(names.map((n) => query(q[n])));
        const r = Object.fromEntries(names.map((n, i) => [n, results[i]]));
        const { nodes, unmatched } = normalise(r, target.lineOf);
        // A node label no JagHelm node has: ignored, warned once until it changes.
        const seen = unmatched.join(',');
        if (seen !== unmatchedSeen) {
          unmatchedSeen = seen;
          if (unmatched.length > 0) {
            logger.warn(
              { nodes: unmatched },
              'smartctl series carry a node label no node in services.yaml has; they are ignored'
            );
          }
        }
        data = { enabled: true, nodes };
      }
      if (failing !== null) {
        logger.info({ source: 'prometheus' }, 'drive queries answer again');
        failing = null;
      }
      entry = { key, at, failed: false, data };
      return data;
    } catch (err) {
      const error = failureSentence('prometheus', err);
      if (error !== failing) {
        failing = error;
        logger.warn(
          { source: 'prometheus', err: failureDetail(err) },
          'drive queries failed; the status model keeps what it holds for drives until Prometheus answers'
        );
      }
      entry = { key, at, failed: true, data: null };
      return null;
    }
  }

  return {
    async read(/** @type {any} */ config = getConfig()) {
      if (!enabled()) return { enabled: false };
      const target = resolveEntity({ kind: 'node', entity: null }, config);
      if (!target.matcher) return { enabled: true, nodes: {} };
      const key = target.matcher;
      const ttl = entry?.failed ? FAILURE_TTL_MS : CACHE_TTL_MS;
      if (entry && entry.key === key && now() - entry.at < ttl) return entry.data;
      if (!asking || asking.key !== key) {
        const promise = compute(target, key).finally(() => {
          if (asking?.promise === promise) asking = null;
        });
        asking = { key, promise };
      }
      return asking.promise;
    },
    /** Test seam: forget the answer. */
    clear() {
      entry = null;
      asking = null;
      failing = null;
      unmatchedSeen = '';
    },
  };
}

/** The server's one cache, which the loop reads through (refresh.js). */
export const drivesCache = createDrivesCache();
