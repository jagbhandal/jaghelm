/**
 * History charts from Prometheus (#311, spec §8): what GET /api/history
 * serves, in place of the old in-memory ring buffer (history.js, #266).
 *
 * Only the series named here can be asked for, never PromQL from the client:
 *
 *   node.cpu          %    100 less the idle rate, averaged over the node's CPUs
 *   node.memory       %    used (total less available), as the node's meter
 *   node.swap         %    swap in use (total less free); a node with no swap has no line
 *                          (#757, the Monitoring memory chart)
 *   node.disk         %    `/`, or the largest filesystem on a node without one
 *                          (a NAS), as discovery's disk reading picks it
 *   node.temperature  °C   the hottest sensor
 *   drive.temperature °C   each of a node's drives, one line per drive named
 *                          by its device (`sda`), from smartctl_exporter
 *                          (drive health, #728); a node series that needs a
 *                          node, and asked only for a node with drives
 *   container.cpu     %    of one core (cAdvisor)
 *   container.memory  bytes the working set (cAdvisor)
 *
 * each over one of four ranges, at a fixed step so a line is at most a few
 * hundred points: 1h every minute (61), 24h every 5 minutes (289), 7d every
 * 30 minutes (337), 30d every 2 hours (361, Prometheus's retention, #745).
 * Rates and averages run over a window as long as the step (2 minutes at least), so no sample between two points is skipped. A range
 * ends on a whole step (`end` = now rounded down to the step), so every read
 * within one step asks Prometheus the same question and gets the same answer.
 *
 * The long ranges (7d, 30d) can also carry a max companion, for a line chart's
 * band (#745): `max=1` on the request adds `maxLines` to each series, the same
 * lines as `lines` but the highest reading in each step's window instead of its
 * average, so an average does not hide a spike. 1h and 24h have none (their
 * step is short enough that the average is the reading), and ignore `max`.
 * It is a second query per series, so it is cached and shared like the first
 * and costs nothing for a reader that does not ask.
 *
 * Each (series, entity, range[, max]) is cached until its range's next step
 * begins, so any number of open drawers and Overviews cost one Prometheus query per
 * step; reads of one that is being asked share the one query. A failed query
 * is kept for FAILURE_TTL_MS, so a Prometheus that doesn't answer isn't asked
 * again by every poll, and its error goes out instead of a line: a chart
 * never draws an empty line that looks healthy.
 *
 * The entity: a node series names a node of services.yaml by its key, or
 * none for every visible node at once (the Overview's node cards, one query);
 * a container series names `<node>/<container>`, a container the server
 * itself has seen on that node (its services cards, or the container
 * registry): one it doesn't know is a 404 before anything is cached or
 * asked, so made-up names can neither query Prometheus nor push real
 * answers out of the cache, and the name in the query is the server's own.
 * The queries ask for the node's Prometheus `node` label (`prometheus_node`,
 * else its key), as the refresh loop does, and were each run against a live
 * Prometheus 3 with node-exporter and cAdvisor series.
 *
 * A failed query goes out as a fixed sentence per cause, the one a failed
 * Prometheus says everywhere (failureWords.js, #605: "Prometheus refused the
 * connection", "Prometheus refused the query (HTTP 400)", "No Prometheus is
 * set up"), never Prometheus's own text or a fetch error's: those are logged
 * here instead, once when the failure starts or changes, and once when
 * Prometheus answers again, not on every read.
 */
import { getCached } from './cache.js';
import { getConfig } from './config.js';
import { containerRegistry } from './containerRegistry.js';
import { nodeMatcher, promQueryRange, promString } from './discovery.js';
import { failureDetail, failureSentence } from './failureWords.js';
import { createLogger } from './util/logger.js';

const log = createLogger('history');

/**
 * Each range: its length and step in seconds, the window rates and averages
 * run over, and `max` where it can carry a max companion.
 */
export const HISTORY_RANGES = Object.freeze({
  '1h': Object.freeze({ seconds: 3_600, step: 60, window: '2m' }),
  '24h': Object.freeze({ seconds: 86_400, step: 300, window: '5m' }),
  '7d': Object.freeze({ seconds: 604_800, step: 1_800, window: '30m', max: true }),
  '30d': Object.freeze({ seconds: 2_592_000, step: 7_200, window: '2h', max: true }),
});

/**
 * The max companion's query: the highest of the series' own readings (taken
 * over MAX_INNER, short enough for a rate to have two samples) across the
 * range's step window, one reading per step as the average's is.
 */
export const MAX_INNER = '5m';
export const maxQueryOf = (query, matcher, window) =>
  `max_over_time((${query(matcher, MAX_INNER)})[${window}:${MAX_INNER}])`;

const FS = 'fstype!="tmpfs"';
const ANY_FS = `${FS},fstype!=""`;

/** Each series: its kind (what its entity names), unit, and query over a matcher and a window. */
export const HISTORY_SERIES = Object.freeze({
  'node.cpu': Object.freeze({
    kind: 'node',
    unit: '%',
    query: (m, w) =>
      `100 - (avg by (node) (rate(node_cpu_seconds_total{${m},mode="idle"}[${w}])) * 100)`,
  }),
  'node.memory': Object.freeze({
    kind: 'node',
    unit: '%',
    query: (m, w) =>
      `max by (node) (100 * (1 - avg_over_time(node_memory_MemAvailable_bytes{${m}}[${w}]) / avg_over_time(node_memory_MemTotal_bytes{${m}}[${w}])))`,
  }),
  'node.swap': Object.freeze({
    kind: 'node',
    unit: '%',
    // The `> 0` drops a node with no swap (0 / 0 is NaN, not "no swap"): it has no line, never a flat one at 0.
    query: (m, w) =>
      `max by (node) (100 * (1 - avg_over_time(node_memory_SwapFree_bytes{${m}}[${w}]) / (avg_over_time(node_memory_SwapTotal_bytes{${m}}[${w}]) > 0)))`,
  }),
  'node.disk': Object.freeze({
    kind: 'node',
    unit: '%',
    // `/` where the node has it; else the largest filesystem (the size that
    // equals the node's largest), as discovery's pickDisk() does.
    query: (m) => {
      const used = (sel) =>
        `100 * (1 - node_filesystem_free_bytes{${sel}} / node_filesystem_size_bytes{${sel}})`;
      const root = `${m},mountpoint="/",${FS}`;
      const any = `${m},${ANY_FS}`;
      const size = `node_filesystem_size_bytes{${any}}`;
      return (
        `max by (node) (${used(root)}) or max by (node) (${used(any)} and on (node, instance, mountpoint) ` +
        `(${size} == on (node) group_left max by (node) (${size})))`
      );
    },
  }),
  'node.temperature': Object.freeze({
    kind: 'node',
    unit: '°C',
    query: (m, w) => `max by (node) (avg_over_time(node_hwmon_temp_celsius{${m}}[${w}]))`,
  }),
  // One line per drive, by `device`: the lines are the drives the answer holds,
  // never a list the client names (`perDevice`, linesOf). Only the "current"
  // temperature is read: the series also carries the drive's own limits.
  'drive.temperature': Object.freeze({
    kind: 'node',
    unit: '°C',
    perDevice: true,
    query: (m, w) =>
      `max by (node, device) (avg_over_time(smartctl_device_temperature{${m},temperature_type="current"}[${w}]))`,
  }),
  'container.cpu': Object.freeze({
    kind: 'container',
    unit: '%',
    query: (m, w) => `max by (name) (rate(container_cpu_usage_seconds_total{${m}}[${w}])) * 100`,
  }),
  'container.memory': Object.freeze({
    kind: 'container',
    unit: 'bytes',
    query: (m, w) =>
      `max by (name) (avg_over_time(container_memory_working_set_bytes{${m}}[${w}]))`,
  }),
});

/** At most this many series in one request: a node's drawer asks for its four at once, five with drives. */
export const MAX_SERIES_PER_REQUEST = 5;
/** How long a failed query is kept before Prometheus is asked again. */
export const FAILURE_TTL_MS = 10_000;
/** Distinct (series, entity, range) entries kept; the oldest written goes first. */
const MAX_ENTRIES = 200;
const MAX_ENTITY = 200;

// eslint-disable-next-line no-control-regex -- refusing control characters is the point
const CONTROL = /[\u0000-\u001f\u007f]/;

const refuse = (error) => ({ ok: false, status: 400, error });

/**
 * Read a request's query: `{ ok: true, series, entity, range }` (`series`
 * the distinct names in order, `entity` a string or null), or `{ ok: false,
 * status: 400, error }` for an unknown series or range, a malformed entity,
 * or one a series' kind needs and lacks. Pure: it doesn't look at
 * services.yaml (resolveEntity does).
 *
 * `max: true` is present only when it was asked for and the range has a max companion.
 *
 * @param {Record<string, unknown>} query  Express's req.query
 */
export function parseHistoryQuery(query = {}) {
  const { series: rawSeries, entity: rawEntity, range } = query;
  // `max` asks for the max companion; only the long ranges have one.
  const wantsMax = query.max === '1' || query.max === 'true';
  if (typeof rawSeries !== 'string' || rawSeries.trim() === '') {
    return refuse(`Name the series: one or more of ${Object.keys(HISTORY_SERIES).join(', ')}`);
  }
  const series = [...new Set(rawSeries.split(',').map((s) => s.trim()))];
  const unknown = series.find((s) => !Object.hasOwn(HISTORY_SERIES, s));
  if (unknown !== undefined)
    return refuse(`Unknown series: ${JSON.stringify(unknown.slice(0, 64))}`);
  if (series.length > MAX_SERIES_PER_REQUEST) {
    return refuse(`At most ${MAX_SERIES_PER_REQUEST} series in one request`);
  }
  const kinds = new Set(series.map((s) => HISTORY_SERIES[s].kind));
  if (kinds.size > 1) return refuse('Ask for node series and container series separately');
  const [kind] = kinds;
  if (typeof range !== 'string' || !Object.hasOwn(HISTORY_RANGES, range)) {
    return refuse(`Unknown range: one of ${Object.keys(HISTORY_RANGES).join(', ')}`);
  }

  const withMax = wantsMax && HISTORY_RANGES[range].max === true;

  if (rawEntity === undefined) {
    if (kind === 'container')
      return refuse('A container series needs an entity: <node>/<container>');
    if (series.some((name) => HISTORY_SERIES[name].perDevice))
      return refuse('A drive series needs an entity: a node');
    return { ok: true, series, entity: null, range, ...(withMax && { max: true }) };
  }
  if (
    typeof rawEntity !== 'string' ||
    rawEntity === '' ||
    rawEntity.length > MAX_ENTITY ||
    CONTROL.test(rawEntity)
  ) {
    return refuse('Malformed entity');
  }
  if (kind === 'node') {
    if (rawEntity.includes('/')) return refuse('Malformed entity: a node series names a node');
    return { ok: true, series, entity: rawEntity, range, ...(withMax && { max: true }) };
  }
  // Any name past the last slash: whether the server knows it decides (resolveEntity).
  const cut = rawEntity.lastIndexOf('/');
  if (cut <= 0 || cut === rawEntity.length - 1) {
    return refuse('Malformed entity: a container series names <node>/<container>');
  }
  return { ok: true, series, entity: rawEntity, range, ...(withMax && { max: true }) };
}

/** A node's Prometheus `node` label, as the refresh loop asks for it. */
export const promLabelOf = (key, cfg) =>
  (typeof cfg?.prometheus_node === 'string' && cfg.prometheus_node) || key;

/**
 * The containers the server has seen on `nodeKey`, by name: those its
 * services cards name (the refresh loop's last /api/services), and those
 * the container registry last saw there (a container gone for under a day).
 */
export function containersOn(nodeKey) {
  const names = new Set();
  const node = getCached('services')?.nodes?.[nodeKey];
  for (const card of Array.isArray(node?.services) ? node.services : []) {
    if (typeof card?.container === 'string' && card.container) names.add(card.container);
  }
  for (const [name, rec] of Object.entries(containerRegistry.snapshot() ?? {})) {
    if (rec?.lastSeenNode === nodeKey) names.add(name);
  }
  return names;
}

/**
 * What a parsed request asks Prometheus about, against services.yaml's
 * nodes and the containers the server knows (`known`, containersOn's
 * signature): `{ ok: true, matcher, lineOf, keys }` (the series matcher, each
 * answer's line name, and the lines in their order), or `{ ok: false,
 * status: 404, error }` for a node or a container it doesn't have.
 */
export function resolveEntity({ kind, entity }, config = getConfig(), known = containersOn) {
  const nodes =
    config?.nodes && typeof config.nodes === 'object' && !Array.isArray(config.nodes)
      ? config.nodes
      : {};
  if (kind === 'node' && entity === null) {
    const visible = Object.entries(nodes).filter(([, cfg]) => cfg?.visible !== false);
    const keysByLabel = new Map();
    for (const [key, cfg] of visible) {
      const label = promLabelOf(key, cfg);
      keysByLabel.set(label, [...(keysByLabel.get(label) ?? []), key]);
    }
    return {
      ok: true,
      matcher: visible.length ? nodeMatcher([...keysByLabel.keys()]) : null,
      lineOf: (metric) => keysByLabel.get(metric?.node) ?? [],
      keys: visible.map(([key]) => key),
    };
  }
  const nodeKey = kind === 'node' ? entity : entity.slice(0, entity.lastIndexOf('/'));
  if (!Object.hasOwn(nodes, nodeKey)) {
    return { ok: false, status: 404, error: 'No node by that name in services.yaml' };
  }
  const label = promLabelOf(nodeKey, nodes[nodeKey]);
  if (kind === 'node') {
    return {
      ok: true,
      matcher: nodeMatcher([label]),
      lineOf: (metric) => (metric?.node === label ? [entity] : []),
      keys: [entity],
    };
  }
  const asked = entity.slice(entity.lastIndexOf('/') + 1);
  // The server's own name for it, never the request's string.
  const name = [...known(nodeKey)].find((n) => n === asked);
  if (name === undefined) {
    return { ok: false, status: 404, error: 'No container by that name on that node' };
  }
  return {
    ok: true,
    matcher: `node=${promString(label)},name=${promString(name)}`,
    lineOf: (metric) => (metric?.name === name ? [entity] : []),
    keys: [entity],
  };
}

/** The range as Prometheus is asked it at `now` (ms): seconds, ending on a whole step. */
export function rangeWindow(range, now = Date.now()) {
  const { seconds, step } = HISTORY_RANGES[range];
  const end = Math.floor(now / 1000 / step) * step;
  return { start: end - seconds, end, step, count: seconds / step + 1 };
}

/** A reading as a line carries it: one decimal (bytes whole), null for none. */
function valueOf(raw, unit) {
  const n = typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return null;
  return unit === 'bytes' ? Math.round(n) : Math.round(n * 10) / 10;
}

/**
 * A matrix as lines: each `{ entity, values }`, `values` one per step from
 * `start` (null where Prometheus has no point), in `keys`' order; a key with
 * no series has no line.
 */
export function linesOf(matrix, { start, step, count, unit, lineOf, keys, perDevice = false }) {
  const byKey = new Map();
  for (const r of matrix ?? []) {
    const drive = perDevice && typeof r?.metric?.device === 'string' ? r.metric.device : null;
    // A drive's line is named by its device, once the node is the one asked for.
    const lines = perDevice
      ? drive !== null && lineOf(r?.metric).length > 0
        ? [drive]
        : []
      : lineOf(r?.metric);
    for (const key of lines) {
      const values = byKey.get(key) ?? new Array(count).fill(null);
      for (const [ts, raw] of Array.isArray(r?.values) ? r.values : []) {
        const i = Math.round((Number(ts) - start) / step);
        if (i < 0 || i >= count) continue;
        const v = valueOf(raw, unit);
        if (v !== null) values[i] = values[i] === null ? v : Math.max(values[i], v);
      }
      byKey.set(key, values);
    }
  }
  // A drive series names its lines itself: the devices the answer holds, in
  // name order, each line named by its device.
  const names = perDevice ? [...byKey.keys()].sort() : keys.filter((k) => byKey.has(k));
  return names.map((entity) => ({ entity, values: byKey.get(entity) }));
}

/**
 * The cache of answered series (see the header). `queryRange` asks
 * Prometheus (promQueryRange's signature); `now` is the clock, in ms;
 * `known` the containers the server has seen on a node (containersOn);
 * `logger` where a failure's detail goes.
 */
export function createHistoryCache({
  queryRange = promQueryRange,
  now = Date.now,
  known = containersOn,
  logger = log,
} = {}) {
  const entries = new Map(); // key -> { end, failedAt, data }
  const asking = new Map(); // key -> { end, promise }
  // The failure being logged (its words), so an outage logs once, not per read,
  // and again only when its cause changes, however its raw detail varies.
  let failing = null;

  const keep = (key, entry) => {
    entries.delete(key);
    if (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value);
    entries.set(key, entry);
  };

  /** One series' answer for the request, from the cache or Prometheus. */
  async function read(name, parsed, target) {
    const { unit, query } = HISTORY_SERIES[name];
    const { window } = HISTORY_RANGES[parsed.range];
    const at = now();
    const { start, end, step, count } = rangeWindow(parsed.range, at);
    const head = { series: name, unit, startMs: start * 1000, stepMs: step * 1000, count };
    if (!target.matcher) {
      return { ...head, ok: true, lines: [], ...(parsed.max === true ? { maxLines: [] } : {}) };
    }
    const withMax = parsed.max === true;
    const key = `${name}|${parsed.entity ?? '*'}|${parsed.range}${withMax ? '|max' : ''}`;

    const cached = entries.get(key);
    if (
      cached &&
      cached.end === end &&
      (cached.failedAt == null || at - cached.failedAt < FAILURE_TTL_MS)
    ) {
      return cached.data;
    }
    const pending = asking.get(key);
    if (pending && pending.end === end) return pending.promise;

    const span = { start, end, step };
    const ask = (q) => queryRange(q, span);
    const promise = Promise.all([
      ask(query(target.matcher, window)),
      withMax ? ask(maxQueryOf(query, target.matcher, window)) : null,
    ])
      .then(
        ([matrix, maxMatrix]) => {
          if (failing !== null) {
            logger.info({ source: 'prometheus' }, 'history queries answer again');
            failing = null;
          }
          const shape = {
            start,
            step,
            count,
            unit,
            ...target,
            perDevice: HISTORY_SERIES[name].perDevice === true,
          };
          const data = { ...head, ok: true, lines: linesOf(matrix, shape) };
          if (withMax) data.maxLines = linesOf(maxMatrix, shape);
          keep(key, { end, failedAt: null, data });
          return data;
        },
        (err) => {
          const error = failureSentence('prometheus', err);
          const detail = failureDetail(err);
          if (error !== failing) {
            failing = error;
            logger.warn(
              { source: 'prometheus', series: name, range: parsed.range, err: detail },
              'history query failed; its series say so until Prometheus answers'
            );
          }
          const data = { ...head, ok: false, error };
          keep(key, { end, failedAt: now(), data });
          return data;
        }
      )
      .finally(() => {
        if (asking.get(key)?.promise === promise) asking.delete(key);
      });
    asking.set(key, { end, promise });
    return promise;
  }

  return {
    /**
     * The answer to a parsed request (parseHistoryQuery): `{ status, body }`.
     * 200 with each series, answered or failed; 404 for a node services.yaml
     * doesn't have, or a container the server hasn't seen there, before
     * anything is cached or asked.
     */
    async answer(parsed, config = getConfig()) {
      const kind = HISTORY_SERIES[parsed.series[0]].kind;
      const target = resolveEntity({ kind, entity: parsed.entity }, config, known);
      if (!target.ok) return { status: target.status, body: { error: target.error } };
      const series = await Promise.all(parsed.series.map((name) => read(name, parsed, target)));
      return { status: 200, body: { range: parsed.range, entity: parsed.entity, series } };
    },
    /** How many answers are kept (tests: made-up names keep none). */
    size() {
      return entries.size;
    },
    /** Test seam: forget every answer. */
    clear() {
      entries.clear();
      asking.clear();
      failing = null;
    },
  };
}

/** The server's one cache, which the route reads through. */
export const historyCache = createHistoryCache();
