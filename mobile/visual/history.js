// What the Android screenshots' server answers to GET /api/history (#602,
// android.spec.mjs): a node's or a container's readings in the live route's
// shape (server/promHistory.js), made up and repeatable, ending at NOW; and
// the answer of a server from before #311, the ring buffer's.
import { NOW } from './fixtures.js';

const MINUTE = 60_000;

/** Each range's step and count of readings, as the live route serves them. */
const RANGES = {
  '1h': { stepMs: MINUTE, count: 61 },
  '24h': { stepMs: 5 * MINUTE, count: 289 },
  '7d': { stepMs: 30 * MINUTE, count: 337 },
};

/** Each series' level, swing and unit: a calm node, a container ticking over. */
const SERIES = {
  'node.cpu': [22, 6, '%'],
  'node.memory': [38, 2, '%'],
  'node.disk': [41, 0.3, '%'],
  'node.temperature': [48, 2, '°C'],
  'container.cpu': [3, 2, '%'],
  // Memory is in bytes: about 180 MB.
  'container.memory': [180 * 1024 * 1024, 12 * 1024 * 1024, 'bytes'],
};

const wave = (base, swing, n, phase) =>
  Array.from(
    { length: n },
    (_, i) =>
      Math.round((base + swing * Math.sin(i / 9 + phase) + (swing / 3) * Math.sin(i * 1.7)) * 10) /
      10
  );

/**
 * /api/history's answer for `query` (series, entity, range), every series
 * answered; a node with no temperature in `services` (the board's
 * /api/services) has no line of it, as Prometheus has none for a node
 * without a sensor.
 */
export function historyAnswer(query, services) {
  const range = query.get('range');
  const entity = query.get('entity');
  const { stepMs, count } = RANGES[range] ?? RANGES['1h'];
  const startMs = NOW - (count - 1) * stepMs;
  return {
    range,
    entity,
    series: query
      .get('series')
      .split(',')
      .map((series, i) => {
        const [base, swing, unit] = SERIES[series] ?? [10, 2, '%'];
        const sensor = services?.nodes?.[entity]?.metrics?.temp != null;
        const line = series !== 'node.temperature' || sensor;
        return {
          series,
          unit,
          startMs,
          stepMs,
          count,
          ok: true,
          lines: line ? [{ entity, values: wave(base, swing, count, i) }] : [],
        };
      }),
  };
}

/** GET /api/history on a server before #311: the ring buffer's, whatever is asked. */
export const RING_BUFFER = Object.freeze({
  'vm-101:cpu': [21.5, 22.4, 23.1],
  'vm-101:mem': [38.0, 38.1, 38.3],
  'vm-101:disk': [41.0, 41.0, 41.0],
});
