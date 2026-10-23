/*
 * What a detail screen's web look (#303, components/DetailParts.jsx) reads
 * from its data: whether its sources have answered yet, and how long the
 * model has had a thing in its state.
 */
import { durationText } from '@ui/lib/ago.js';
import { formatClock } from './derive.js';

/**
 * Whether what a detail shows is still on its way: the status before the
 * poll's first answer, or the cards before /api/services' first. A sheet
 * drawn then (a reload with it open, or Forward to it) waits, and says
 * nothing is gone until they have answered without it.
 */
export function detailLoading(data) {
  return (!data.status && data.reach === 'loading') || (!data.servicesBody && Boolean(data.loading));
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * How long the model has had a thing in its state, from its `since`, aged
 * against the status's time `at` (as the issue rows are): "for 4 min · since
 * 08:38", or past a day "for 3 d". Null without either, and while the status
 * is stale, when the state drawn is no signal, not the one `since` dates.
 */
export function sinceLine(since, at, freshness) {
  if (freshness?.stale || !Number.isFinite(since) || !Number.isFinite(at)) return null;
  const span = Math.max(0, at - since);
  const lasted = `for ${durationText(span)}`;
  return span < DAY ? `${lasted} · since ${formatClock(since)}` : lasted;
}
