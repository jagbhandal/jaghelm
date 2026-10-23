/**
 * The lines of an answer of GET /api/history (#311, server/promHistory.js):
 * a series, and one entity's line as timed points. Apart from
 * historySeries.js (the drawer's charts, in its chunk) so the Overview's
 * node cards, on the first screen, carry only this.
 */

/** The series `name` in an answer of /api/history, or null. */
export function seriesIn(body, name) {
  return Array.isArray(body?.series) ? (body.series.find((s) => s?.series === name) ?? null) : null;
}

/**
 * One line of a series as the Chart's points, `{ time, value }` from the
 * answer's start and step, or null when the series has no line for `entity`.
 */
export function pointsOf(series, entity) {
  if (!series?.ok || !Array.isArray(series.lines)) return null;
  const line = series.lines.find((l) => l?.entity === entity);
  if (!line || !Array.isArray(line.values)) return null;
  const { startMs, stepMs } = series;
  return line.values.map((value, i) => ({
    time: startMs + i * stepMs,
    value: typeof value === 'number' && Number.isFinite(value) ? value : null,
  }));
}

/** The Overview's node cards: each node's hour of CPU, by node key, from /api/history?series=node.cpu&range=1h. */
export function nodeCpuHour(body) {
  const cpu = seriesIn(body, 'node.cpu');
  return (node) => pointsOf(cpu, node);
}
