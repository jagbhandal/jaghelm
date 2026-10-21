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
 * The temperature is the model's °C, or °F when the user picked it (Settings,
 * `tempUnit`): the reading and its lines are converted, so the meter still
 * colours and prints as the model judged it.
 *
 * And the section's cards / table choice, kept per browser
 * (useInfrastructureView).
 */
import { useCallback, useState } from 'react';
import { readingLines, shownReading } from '../../server/status/readings.js';
import { prefs } from '../storage/index.js';
import { entityAnchor } from './entityAnchors.js';
import { countsText } from './statusView.js';

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

const fahrenheit = (c) => (c * 9) / 5 + 32;

/**
 * A temperature reading and its lines in `unit` ('C' or 'F'): the meter's
 * unit, scale and lines. A band is a difference, so it scales without the
 * offset.
 */
function temperature(value, lines, unit) {
  if (unit !== 'F') return { value, unit: '°C', max: 100, lines };
  const out = {};
  if (lines.warn != null) out.warn = fahrenheit(lines.warn);
  if (lines.crit != null) out.crit = fahrenheit(lines.crit);
  if (lines.band != null) out.band = (lines.band * 9) / 5;
  return { value: value == null ? null : fahrenheit(value), unit: '°F', max: 212, lines: out };
}

/** One reading's meter: `{ key, label, value, unit, max, state, warn, crit, band, shown }`. */
function readingOf({ key, label, field }, entity, metrics, thresholds, tempUnit) {
  const level = entity.conditions?.[key];
  const raw = JUDGED.has(level) ? num(metrics?.[field]) : null;
  const served = readingLines(thresholds, key);
  const { value, unit, max, lines } =
    key === 'temp'
      ? temperature(raw, served, tempUnit)
      : { value: raw, unit: '%', max: 100, lines: served };
  return {
    key,
    label,
    value,
    unit,
    max,
    state: level ?? null,
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
 *
 * @param {{ status: any, services?: any, history?: Record<string, number[]>,
 *   sections?: Record<string, any>, tempUnit?: 'C' | 'F' }} board
 */
export function infrastructureNodes({
  status,
  services = null,
  history = null,
  sections = {},
  tempUnit = 'C',
}) {
  const entities = (status?.entities ?? []).filter((e) => e.kind === 'node');
  if (entities.length === 0) return [];
  const listed = Object.keys(services?.nodes ?? {});
  const rank = (e) => {
    const at = listed.indexOf(e.node);
    return at === -1 ? listed.length : at;
  };
  const cpuLines = readingLines(status.thresholds, 'cpu');
  return entities
    .filter((e) => sections?.[e.node]?.visible !== false)
    .map((e, order) => ({ e, order }))
    .sort((a, b) => rank(a.e) - rank(b.e) || a.order - b.order)
    .map(({ e }) => {
      const node = services?.nodes?.[e.node] ?? null;
      const counts = servicesOf(status, e.node);
      const metrics = node?.metrics ?? null;
      const readings = READINGS.filter((r) => hasReading(r, e, metrics)).map((r) =>
        readingOf(r, e, metrics, status.thresholds, tempUnit)
      );
      // Whether the model read the node this cycle; the last hour of CPU, only
      // while the CPU reading is current.
      const read = Object.values(e.conditions ?? {}).some((l) => JUDGED.has(l));
      const cpuNow = readings.find((r) => r.key === 'cpu')?.value != null;
      const points = history?.[`${e.node}:cpu`];
      const trend =
        cpuNow && Array.isArray(points) && points.length >= 2
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
        state: e.state,
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

/** The section's count: "3 nodes", "3 nodes · 1 critical, 1 warning". */
export function infrastructureCount(nodes) {
  const n = nodes.length;
  return [`${n} ${n === 1 ? 'node' : 'nodes'}`, countsText(nodes)].filter(Boolean).join(' · ');
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
const VIEWS = ['cards', 'table'];

/** The section's view, `cards` or `table`, and what changes it: kept per browser. */
export function useInfrastructureView() {
  const [view, setView] = useState(() => {
    const stored = prefs.get(VIEW_PREF);
    return VIEWS.includes(stored) ? stored : 'cards';
  });
  const choose = useCallback((next) => {
    if (!VIEWS.includes(next)) return;
    setView(next);
    prefs.set(VIEW_PREF, next);
  }, []);
  return [view, choose];
}
