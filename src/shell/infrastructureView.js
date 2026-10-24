/**
 * The Overview's Infrastructure section (#299, spec §8 item 3): each node the
 * status model has, as its card or its table row draws it. The client judges
 * nothing (spec §6):
 *
 *  - the node's state, word and reason are its entity's in /api/status;
 *  - each reading's meter is valued from /api/services, takes the model's
 *    level for that reading as its state (the entity's `conditions`, so a
 *    reading held inside its hysteresis band, or a CPU spike in its first
 *    cycle, reads as the model judged it), and its lines are the ones
 *    /api/status serves (`readingLines`, #451); its number is printed by the
 *    model's one rule (`shownReading`, #450);
 *  - a reading the model didn't judge this cycle (the node unreachable or with
 *    no signal, its query failed, no value) has no value: an old number is
 *    never drawn as current;
 *  - the hosted services' up and down counts are the model's service and
 *    container entities on that node.
 *
 * With a stale status (`freshness`, statusFreshness.js, #480, #495), nothing
 * is drawn in a level colour from it: each node and each meter is drawn as no
 * signal, a meter keeping the number /api/services gives it, and the node its
 * word and reason, as last known; the section's count says how old they are.
 *
 * The temperature is in the model's °C, as its reason says it, so the meter
 * and the reason print one number in one unit. Settings' unit (`units`,
 * the weather's) doesn't reach it: one unit for both is #494.
 *
 * And the section's cards / table choice, kept per browser
 * (useInfrastructureView). The Infrastructure page (#313) lists the same
 * nodes, narrowed by its filters (pageFilters.js).
 */
import { readingLines, shownReading } from '../../server/status/readings.js';
import { entityAnchor } from './entityAnchors.js';
import { drawnState } from './statusFreshness.js';
import { countsText } from './statusView.js';
import { nodeCpuHour } from './historyLines.js';
import { forecastNote } from './diskForecast.js';
import { usePref } from './usePref.js';

/** The readings a node card shows, in the mock's order, and where /api/services has each. */
export const READINGS = Object.freeze([
  Object.freeze({ key: 'cpu', label: 'CPU', field: 'cpu' }),
  Object.freeze({ key: 'mem', label: 'Memory', field: 'memPercent' }),
  Object.freeze({ key: 'disk', label: 'Disk', field: 'diskPercent' }),
  Object.freeze({ key: 'temp', label: 'Temp', field: 'temp' }),
]);

// The levels the model gives a reading it read this cycle.
const JUDGED = new Set(['ok', 'warn', 'crit']);

const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** One reading's meter: `{ key, label, value, unit, max, state, warn, crit, band, shown }`. */
function readingOf({ key, label, field }, entity, metrics, thresholds, freshness) {
  const level = entity.conditions?.[key];
  const value = JUDGED.has(level) ? num(metrics?.[field]) : null;
  const lines = readingLines(thresholds, key);
  // Percent of 100, or °C on a 0–100 °C scale.
  const unit = key === 'temp' ? '°C' : '%';
  const max = 100;
  return {
    key,
    label,
    value,
    unit,
    max,
    state: level == null ? null : drawnState(level, freshness),
    ...lines,
    shown: value == null ? null : `${shownReading(value, lines)}${unit}`,
  };
}

/** Whether the node has a reading of `key` to show: always CPU, memory and disk. */
function hasReading({ key, field }, entity, metrics) {
  if (key !== 'temp') return true;
  return entity.conditions?.temp != null || num(metrics?.[field]) != null;
}

/** The node's hosted services, counted by the model: `{ total, up, down }`. */
function servicesOf(status, nodeKey) {
  const hosted = status.entities.filter(
    (e) => (e.kind === 'service' || e.kind === 'container') && e.node === nodeKey
  );
  return {
    total: hosted.length,
    up: hosted.filter((e) => e.state === 'ok').length,
    down: hosted.filter((e) => e.state === 'crit').length,
  };
}

/**
 * Each node the model has, in services.yaml's order (as /api/services lists
 * them), then any it has that /api/services has yet to list; a node hidden in
 * Settings (`sections[key].visible === false`) is left out, as on the board.
 * With a stale status (`freshness.stale`), each is drawn as no signal.
 *
 * `history` is /api/history's answer for every node's hour of CPU (#311,
 * historyLines.js), or none.
 *
 * `forecast` is `{ nodes, lines }`: /api/disk-forecast's nodes by key and the
 * lines Settings keeps (diskForecast.js, #670); each node's disk meter then
 * carries a `note` ("12 days left"), or none.
 *
 * @param {{ status: any, services?: any, history?: any,
 *   sections?: Record<string, any>, freshness?: { stale: boolean },
 *   forecast?: { nodes: Record<string, any>, lines: { warn: number, crit: number } } | null }} board
 */
export function infrastructureNodes({
  status,
  services = null,
  history = null,
  sections = {},
  freshness = null,
  forecast = null,
}) {
  const entities = (status?.entities ?? []).filter((e) => e.kind === 'node');
  if (entities.length === 0) return [];
  const listed = Object.keys(services?.nodes ?? {});
  const rank = (e) => {
    const at = listed.indexOf(e.node);
    return at === -1 ? listed.length : at;
  };
  const cpuLines = readingLines(status.thresholds, 'cpu');
  const cpuHour = nodeCpuHour(history);
  return entities
    .filter((e) => sections?.[e.node]?.visible !== false)
    .map((e, order) => ({ e, order }))
    .sort((a, b) => rank(a.e) - rank(b.e) || a.order - b.order)
    .map(({ e }) => {
      const node = services?.nodes?.[e.node] ?? null;
      const counts = servicesOf(status, e.node);
      const metrics = node?.metrics ?? null;
      const readings = READINGS.filter((r) => hasReading(r, e, metrics)).map((r) =>
        readingOf(r, e, metrics, status.thresholds, freshness)
      );
      const disk = readings.find((r) => r.key === 'disk');
      if (disk && forecast?.nodes) {
        const note = forecastNote(forecast.nodes[e.node], forecast.lines, {
          stale: Boolean(freshness?.stale),
          unread: disk.value == null,
        });
        if (note) disk.note = note;
      }
      // Whether the model read the node this cycle; the last hour of CPU, only
      // while the CPU reading is current.
      const read = Object.values(e.conditions ?? {}).some((l) => JUDGED.has(l));
      const cpuNow = readings.find((r) => r.key === 'cpu')?.value != null;
      const points = cpuHour(e.node);
      const trend =
        cpuNow && points && points.filter((p) => p.value != null).length >= 2
          ? {
              points,
              label: 'CPU, last hour',
              formatValue: (v) => `${shownReading(v, cpuLines)}%`,
            }
          : null;
      return {
        id: e.id,
        anchor: entityAnchor(e.id),
        key: e.node,
        name: e.name,
        host: e.node,
        subtitle: node?.subtitle || null,
        colour: node?.border_color || sections?.[e.node]?.borderColor || null,
        state: drawnState(e.state, freshness),
        word: e.word,
        reason: e.state === 'ok' ? null : e.reason,
        readings,
        serviceCounts: counts,
        services: servicesText(counts),
        uptime: read && metrics?.uptime ? `Up ${metrics.uptime}` : null,
        trend,
      };
    });
}

/**
 * The section's count: "3 nodes", "3 nodes · 1 critical, 1 warning"; with a
 * stale status, how old it is instead: "3 nodes · No signal · last known 3
 * min ago". With `of`, the nodes are what a filter left of that many: "1 of 3
 * nodes · 1 warning".
 */
export function infrastructureCount(nodes, freshness = null, { of = null } = {}) {
  const n = nodes.length;
  const said = freshness?.stale ? freshness.note : countsText(nodes);
  const total = of ?? n;
  const first = `${of == null ? '' : `${n} of `}${total} ${total === 1 ? 'node' : 'nodes'}`;
  return [first, said].filter(Boolean).join(' · ');
}

/** The hosted services in words: "4 / 5 services up · 1 down", or "No services". */
export function servicesText({ total, up, down }) {
  if (total === 0) return 'No services';
  return [`${up} / ${total} ${total === 1 ? 'service' : 'services'} up`, down && `${down} down`]
    .filter(Boolean)
    .join(' · ');
}

/** Where the section's cards / table choice is kept, per browser (`prefs`). */
export const VIEW_PREF = 'jaghelm-infrastructure-view';
const VIEWS = Object.freeze(['cards', 'table']);

/**
 * The section's view, `cards` or `table`, and what changes it: kept per
 * browser, one choice for the Overview and the Infrastructure page (usePref).
 */
export function useInfrastructureView() {
  return usePref(VIEW_PREF, VIEWS, 'cards');
}
