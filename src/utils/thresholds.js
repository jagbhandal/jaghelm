// Shared usage-severity thresholds for the dashboard's "glance" emphasis.
//
// A high usage percentage is bad. These mirror the metric-bar fill colors that
// already existed inline (>90 red, >70 amber) so the value tint, the bar, and
// the card halo all agree — the whole card goes red together, pre-attentively,
// instead of hiding the signal in a 4px bar.

export const USAGE_CRITICAL = 90;
export const USAGE_WARN = 70;

/**
 * Severity of a usage percentage: 'critical' (>90), 'warn' (>70), or null
 * (normal — no emphasis). null/NaN inputs are treated as "no data" → null.
 */
export function usageSeverity(percent) {
  if (percent == null || Number.isNaN(Number(percent))) return null;
  if (percent > USAGE_CRITICAL) return 'critical';
  if (percent > USAGE_WARN) return 'warn';
  return null;
}

/**
 * The worst severity across a node's metrics, for the card halo. Uses each
 * metric's real usage (`percent`) — cache (`withCachePercent`) is reclaimable, so
 * it colors the bar but should not flag the whole card as critical.
 */
export function cardSeverity(metrics) {
  let worst = null;
  for (const m of metrics || []) {
    const s = usageSeverity(m?.percent);
    if (s === 'critical') return 'critical';
    if (s === 'warn') worst = 'warn';
  }
  return worst;
}

/** Token color for a severity, falling back to a caller-supplied accent. */
export function severityColor(severity, fallback) {
  if (severity === 'critical') return 'var(--red)';
  if (severity === 'warn') return 'var(--amber)';
  return fallback;
}

/** Human label for a severity, for screen-reader text (never color-only). */
export function severityLabel(severity) {
  if (severity === 'critical') return 'critical';
  if (severity === 'warn') return 'elevated';
  return null;
}
