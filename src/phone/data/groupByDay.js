/**
 * Format a Date as YYYY-MM-DD using local calendar date.
 * @param {Date} d
 * @returns {string}
 */
export function dateToDayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Group items by calendar day (local date), newest day first.
 * `getDate(item)` must return a Date. `day` is the YYYY-MM-DD key.
 * Pure; no I/O, no Date() calls inside the core logic — ready for Phase-5
 * real push-history feed.
 *
 * @param {T[]} items
 * @param {(item: T) => Date} getDate
 * @returns {Array<{ day: string, items: T[] }>}
 */
export function groupByDay(items, getDate) {
  const byDay = new Map();
  for (const item of items) {
    const key = dateToDayKey(getDate(item));
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(item);
  }
  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([day, list]) => ({ day, items: list }));
}

/**
 * Format a YYYY-MM-DD day key for display.
 * Returns "Today" / "Yesterday" / readable date like "Jun 25".
 * PURE — todayKey is passed in explicitly (no new Date() inside).
 *
 * @param {string} dayKey      - YYYY-MM-DD of the group
 * @param {string} todayKey    - YYYY-MM-DD of today (caller provides)
 * @returns {string}
 */
export function formatDayLabel(dayKey, todayKey) {
  if (dayKey === todayKey) return 'Today';

  // Build yesterday's key without calling new Date()
  const [y, m, d] = todayKey.split('-').map(Number);
  const todayDate = new Date(y, m - 1, d);
  const prev = new Date(todayDate);
  prev.setDate(prev.getDate() - 1);
  const yesterdayKey = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')}`;
  if (dayKey === yesterdayKey) return 'Yesterday';

  // Older: parse and format as "Mon D" e.g. "Jun 25"
  const [dy, dm, dd] = dayKey.split('-').map(Number);
  const date = new Date(dy, dm - 1, dd);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
