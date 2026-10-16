// Compact duration label: minutes under 1h, hours under 48h, otherwise days.
// Pure and dependency-free: also imported by the Android app via @shared.
export function fmtSpan(s) {
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 172800) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}
