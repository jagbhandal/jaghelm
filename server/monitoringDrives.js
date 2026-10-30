// @ts-check
/**
 * The Monitoring page's Drives chart (#762, spec §5 chart 8, monitoring.js
 * `drives`): which drives are healthy, what each runs at, and whether a NAS
 * array has all its members.
 *
 * No drive logic of its own. The lamp, word and reason of each drive are the
 * status model's (status/drives.js judgeDrive, as the model served them in
 * `status.entities[].drives`), and the temperature lines are the thresholds the
 * model judged by (`status.thresholds.driveTemp`, per kind), so this chart and
 * the banner never disagree. What this module reads itself is the two things
 * the model does not carry: each drive's temperature over the range
 * (HISTORY_SERIES `drive.temperature`) and the arrays' members
 * (`node_md_disks`, with `node_md_disks_required` for how many there should be).
 *
 * The answer is `{ unit, startMs, stepMs, count, smart, nodes }`.
 *
 *   smart   'ok' (some node has drives, or a blind one), 'off' (JAGHELM_DRIVES=off),
 *           'none' (the module is on and no node reports drives: no smartctl
 *           exporter), 'unread' (the model has not read drives yet). Never
 *           'ok' by default: no reading is words, not a healthy lamp.
 *   nodes   `[{ key, name, blind, readingSeconds, drives, raid }]`, the nodes
 *           with drives, a blind drive source, or an array.
 *     blind   the model's sentence when the node's drives can no longer be seen
 *             (their lamps are then not drawn: the last levels are held in the
 *             status model, not judged again here), else null.
 *     drives  `{ key, device, model, type, state, word, reason, temperature,
 *             lines: { warn, crit }, values }`: `values` is one number or null
 *             per step, null for a gap.
 *     raid    `{ device, active, required, failed, spare, state, word, reason }`.
 *
 * An array is judged here, and only on member counts: critical when fewer
 * members are active than the array needs (degraded), a warning when a member
 * has failed but the needed number are active (a spare has taken over), no
 * signal when `node_md_disks_required` is missing (members cannot be set
 * against nothing). A failed query throws and the cache words it.
 */
import { getCached } from './cache.js';
import { promQuery } from './discovery.js';
import { HISTORY_RANGES, HISTORY_SERIES, linesOf, resolveEntity } from './promHistory.js';
import { DEFAULT_THRESHOLDS } from './status/thresholds.js';
import { driveTempLines, DRIVES_SOURCE } from './status/drives.js';

/** How long a failed Prometheus read of the two series is kept. */
const FAILURE_TTL_MS = 10_000;

const WORD = /** @type {Record<string, string>} */ ({ ok: 'Healthy', warn: 'Warning', crit: 'Critical', unknown: 'No signal' });

/** A sample's value as a number, null when it isn't one. */
const num = (/** @type {any} */ sample) => {
  const raw = Array.isArray(sample?.value) ? sample.value[1] : undefined;
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
};

const plural = (/** @type {number} */ n, /** @type {string} */ one, /** @type {string} */ many) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * One array judged from its member counts (see the header).
 * @param {string} device
 * @param {{ active: number | null, required: number | null, failed: number, spare: number }} m
 */
export function judgeArray(device, m) {
  const base = { device, active: m.active, required: m.required, failed: m.failed, spare: m.spare };
  const answer = (/** @type {string} */ state, /** @type {string} */ reason) => ({
    ...base,
    state,
    word: WORD[state],
    reason,
  });
  if (m.required === null || m.active === null) {
    return answer('unknown', 'The expected number of members is not reported');
  }
  if (m.active < m.required) {
    const gone = m.required - m.active;
    return answer('crit', `degraded: ${m.active} of ${m.required} members active, ${plural(gone, 'member', 'members')} missing`);
  }
  if (m.failed > 0) {
    return answer('warn', `${plural(m.failed, 'member', 'members')} failed; ${m.active} of ${m.required} active`);
  }
  return answer('ok', `All ${m.required} members active`);
}

/**
 * The arrays of the instant results, per node key: `{ [nodeKey]: array[] }`,
 * in device order. `disks` is `node_md_disks` by (node, device, state),
 * `required` is `node_md_disks_required` by (node, device).
 *
 * @param {any[]} disks
 * @param {any[]} required
 * @param {(metric: any) => string[]} lineOf
 */
export function arraysOf(disks, required, lineOf) {
  /** @type {Map<string, Map<string, { active: number | null, required: number | null, failed: number, spare: number }>>} */
  const nodes = new Map();
  const at = (/** @type {any} */ metric) => {
    const device = metric?.device;
    if (typeof device !== 'string' || device === '') return [];
    return lineOf(metric).map((key) => {
      const arrays = nodes.get(key) ?? new Map();
      nodes.set(key, arrays);
      if (!arrays.has(device)) arrays.set(device, { active: null, required: null, failed: 0, spare: 0 });
      return arrays.get(device);
    });
  };
  for (const s of disks) {
    const n = num(s);
    if (n === null) continue;
    for (const a of at(s.metric)) {
      const state = s.metric?.state;
      if (state === 'active') a.active = n;
      else if (state === 'failed') a.failed = n;
      else if (state === 'spare') a.spare = n;
    }
  }
  for (const s of required) {
    const n = num(s);
    if (n === null) continue;
    for (const a of at(s.metric)) a.required = n;
  }
  return Object.fromEntries(
    [...nodes].map(([key, arrays]) => [
      key,
      [...arrays].sort(([a], [b]) => (a < b ? -1 : 1)).map(([device, m]) => judgeArray(device, m)),
    ])
  );
}

/**
 * The chart's answer from what is known: the status model's slice, what the
 * drives module read, each node's temperature lines and its arrays. Pure.
 *
 * @param {{ status: any, drivesRead: any, temps: Record<string, Array<{ entity: string, values: Array<number | null> }>>, raid: Record<string, any[]>, head: object }} a
 */
export function drivesAnswer({ status, drivesRead, temps, raid, head }) {
  const entities = Array.isArray(status?.entities) ? status.entities : [];
  const sources = status?.sources && typeof status.sources === 'object' ? status.sources : {};
  const thresholds = status?.thresholds?.driveTemp ? status.thresholds : DEFAULT_THRESHOLDS;
  /** @type {Map<string, any>} */
  const byKey = new Map();
  const node = (/** @type {string} */ key, /** @type {string} */ name) => {
    if (!byKey.has(key)) {
      byKey.set(key, { key, name, blind: null, readingSeconds: null, drives: [], raid: [] });
    }
    return byKey.get(key);
  };
  for (const e of entities) {
    if (e?.kind !== 'node' || typeof e.node !== 'string') continue;
    const name = typeof e.name === 'string' && e.name ? e.name : e.node;
    const source = sources[`${DRIVES_SOURCE}${e.node}`];
    const blind = source?.state === 'failed' ? String(source.error ?? 'No drive signal') : null;
    const rows = Array.isArray(e.drives) ? e.drives : [];
    if (rows.length === 0 && blind === null) continue;
    const n = node(e.node, name);
    n.blind = blind;
    if (Number.isFinite(e.driveReadingSeconds)) n.readingSeconds = e.driveReadingSeconds;
    const lines = temps[e.node] ?? [];
    for (const d of rows) {
      const { warn, crit } = driveTempLines(d, thresholds);
      n.drives.push({
        key: d.key,
        device: d.device,
        model: d.model ?? null,
        type: d.type,
        state: d.state,
        word: d.word,
        reason: d.reason,
        temperature: Number.isFinite(d.temperature) ? d.temperature : null,
        lines: { warn, crit },
        values: lines.find((l) => l.entity === d.device)?.values ?? null,
      });
    }
  }
  const names = new Map(
    entities.filter((/** @type {any} */ e) => e?.kind === 'node').map((/** @type {any} */ e) => [e.node, e.name || e.node])
  );
  for (const [key, arrays] of Object.entries(raid)) {
    if (arrays.length > 0) node(key, names.get(key) ?? key).raid = arrays;
  }
  const nodes = [...byKey.values()];
  let smart = 'unread';
  if (drivesRead?.enabled === false) smart = 'off';
  else if (nodes.some((n) => n.drives.length > 0 || n.blind !== null)) smart = 'ok';
  else if (drivesRead?.enabled === true) smart = 'none';
  return { ...head, smart, nodes };
}

/**
 * Drives' temperature lines and arrays for the range, kept until the range's
 * next step as every chart is, so the lamps (always the model's latest) cost no
 * Prometheus read of their own.
 */
/**
 * @param {{ range: '1h' | '24h' | '7d' | '30d', span: any, queryRange: any, query: any, kept: Map<string, any> }} ctx
 *   `kept` is the cache's own scratch map (monitoring.js), emptied with it
 * @param {any} target
 */
function seriesFor({ range, span, queryRange, query, kept }, target) {
  const key = `${range}|${span.end}|${target.matcher}`;
  const hit = kept.get(key);
  if (hit && (hit.failedAt == null || Date.now() - hit.failedAt < FAILURE_TTL_MS)) return hit.promise;
  const { unit, query: tempQuery } = HISTORY_SERIES['drive.temperature'];
  const m = target.matcher;
  const promise = (async () => {
    const [matrix, disks, required] = await Promise.all([
      queryRange(tempQuery(m, HISTORY_RANGES[range].window), { start: span.start, end: span.end, step: span.step }),
      query(`max by (node, device, state) (node_md_disks{${m}})`),
      query(`max by (node, device) (node_md_disks_required{${m}})`),
    ]);
    /** @type {Record<string, any[]>} */
    const temps = {};
    for (const nodeKey of target.keys) {
      const lines = linesOf(matrix, {
        ...span,
        unit,
        keys: [nodeKey],
        perDevice: true,
        lineOf: (/** @type {any} */ metric) => (target.lineOf(metric).includes(nodeKey) ? [nodeKey] : []),
      });
      if (lines.length > 0) temps[nodeKey] = lines;
    }
    return { temps, raid: arraysOf(disks, required, target.lineOf) };
  })();
  kept.delete(key);
  if (kept.size >= 20) kept.delete(/** @type {string} */ (kept.keys().next().value));
  kept.set(key, { promise });
  promise.catch(() => {
    const entry = kept.get(key);
    if (entry?.promise === promise) entry.failedAt = Date.now();
  });
  return promise;
}

/**
 * The chart's reader (monitoring.js): `status()` is the status model's last
 * build, `drives()` what the drives module last read, `query` an instant query.
 * A chart is `live`: the lamps are the model's of this moment.
 */
/** @param {any} ctx */
export async function readDrives(ctx) {
  const { span, config, status = () => getCached('status'), drives = () => getCached('drives'), query = promQuery } = ctx;
  const head = { unit: HISTORY_SERIES['drive.temperature'].unit, startMs: span.start * 1000, stepMs: span.step * 1000, count: span.count };
  const target = resolveEntity({ kind: 'node', entity: null }, config);
  const got = target.ok && target.matcher ? await seriesFor({ ...ctx, query, kept: ctx.kept ?? new Map() }, target) : { temps: {}, raid: {} };
  return drivesAnswer({ status: status(), drivesRead: drives(), temps: got.temps, raid: got.raid, head });
}
