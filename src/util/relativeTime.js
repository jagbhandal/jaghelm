/**
 * Shared compact relative-time helpers for the "last seen X ago" breadcrumb
 * subtitle. Imported by the web ServiceCard and (via the `@shared` Vite alias)
 * the mobile ServiceRow, so both clients format presence ages identically.
 */

/** Compact human age for a millisecond duration: 45s, 12m, 3h, 5d. */
export function formatAge(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** "last seen 3m ago" for a lastSeenAt epoch-ms, relative to now. */
export function lastSeenLabel(lastSeenAt, now = Date.now()) {
  if (!lastSeenAt) return 'last seen recently';
  return `last seen ${formatAge(now - lastSeenAt)} ago`;
}
