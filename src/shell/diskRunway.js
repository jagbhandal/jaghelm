/**
 * Disk runway's rows and projection (#754): the plain functions behind
 * DiskRunwayBody.jsx. See there for what is drawn and why the client forecasts
 * nothing.
 */
import { bytesText } from './backups.js';
import { daysLeftText, forecastState } from './diskForecast.js';

export const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** The projection's line is drawn as this many points before now and after it. */
const BEFORE_POINTS = 12;
const AFTER_POINTS = 28;

/** The words of a row that has no date, by the forecast's status. */
const NO_DATE = Object.freeze({
  nodata: 'No signal',
  noisy: 'Too irregular to forecast',
  insufficient: 'Not enough history',
});

/**
 * A row's name: the node, the mount the forecast is of and that mount's size
 * ("nas /ugreen, 4.2 GB"), so a small system partition is never read as the
 * node's data pool (#797).
 */
export const rowName = (r) => {
  if (!r.mount) return r.node;
  const size = Number.isFinite(r.sizeBytes) && r.sizeBytes > 0 ? `, ${bytesText(r.sizeBytes)}` : '';
  return `${r.node} ${r.mount}${size}`;
};

/** A row's identity: a node can have two rows, its fullest mount and its main one. */
export const rowKey = (r) => (r.mount ? `${r.node} ${r.mount}` : r.node);

/** The value, its words and its state for one row of the server's answer. */
export function runwayRow(r, lines) {
  const name = rowName(r);
  if (r.status === 'ok' && Number.isFinite(r.daysLeft)) {
    return {
      key: rowKey(r),
      name,
      value: r.daysLeft,
      valueText: daysLeftText(r.daysLeft),
      state: forecastState(r.daysLeft, lines),
    };
  }
  if (r.status === 'stable') {
    // Flat or shrinking, or further off than about six months: a forecast, but no date to draw.
    const growing = Number.isFinite(r.growthBytesPerDay) && r.growthBytesPerDay > 0;
    return {
      key: rowKey(r),
      name,
      value: null,
      valueText: growing ? 'Over 6 months' : 'Not filling',
      state: 'ok',
    };
  }
  return {
    key: rowKey(r),
    name,
    value: null,
    valueText: NO_DATE[r.status] ?? 'No forecast',
    state: 'unknown',
  };
}

/** Whether a row has what the projection needs: a date, the size, the reading now and a growth. */
export const canProject = (r) =>
  r.status === 'ok' &&
  [r.daysLeft, r.sizeBytes, r.usedBytes, r.growthBytesPerDay].every(Number.isFinite) &&
  r.sizeBytes > 0 &&
  r.growthBytesPerDay > 0;

/**
 * The drill-in's two series for one row: `{ fitted, projection, startMs,
 * nowMs, fullMs }`, each `[{ time, value }]` on one shared time grid in
 * percent of the disk used (null where the series is not drawn, which breaks
 * its line). The fitted line looks back over the hours the server fitted;
 * the projection runs from now to the day the disk is full, ending on 100 %.
 */
export function projectionOf(r, nowMs) {
  const pct = (bytes) => Math.min(Math.max((bytes / r.sizeBytes) * 100, 0), 100);
  const hours = Math.min(Math.max(r.samples ?? 0, 2), 24 * 7);
  const startMs = nowMs - hours * HOUR_MS;
  const fullMs = nowMs + r.daysLeft * DAY_MS;
  const perMs = r.growthBytesPerDay / DAY_MS;
  const times = [
    ...Array.from({ length: BEFORE_POINTS }, (_, i) => startMs + ((nowMs - startMs) * i) / BEFORE_POINTS),
    nowMs,
    ...Array.from({ length: AFTER_POINTS }, (_, i) => nowMs + ((fullMs - nowMs) * (i + 1)) / AFTER_POINTS),
  ];
  const at = (t) => pct(r.usedBytes + (t - nowMs) * perMs);
  const fitted = times.map((time) => ({ time, value: time <= nowMs ? at(time) : null }));
  const projection = times.map((time, i) => ({
    time,
    value: time < nowMs ? null : i === times.length - 1 ? 100 : at(time),
  }));
  return { fitted, projection, startMs, nowMs, fullMs };
}
