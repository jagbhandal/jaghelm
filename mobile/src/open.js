/**
 * Light Action v1 = "Open" ONLY — a READ-ONLY deep-link/navigation to the
 * underlying service URL. No backend write, no mutation. Targets without a URL
 * (UPS/cron) have no external destination yet, so Open is a no-op for them.
 */
export function openTarget(target) {
  const url = target && target.url;
  if (url && typeof url === 'string') {
    window.open(url, '_blank', 'noopener');
  }
}
