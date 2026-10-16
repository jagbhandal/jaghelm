// Compact duration label: minutes under 2h, hours under 48h, otherwise days.
// (Under 2h stays in minutes so a 1h job overdue at 75m never reads "1h".)
// Pure and dependency-free: also imported by the Android app via @shared.
export function fmtSpan(input) {
  const s = Math.max(0, input);
  if (s < 7200) return `${Math.round(s / 60)}m`;
  if (s < 172800) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}
