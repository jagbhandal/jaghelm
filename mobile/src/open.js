/**
 * Light Action v1 = "Open" ONLY — a READ-ONLY deep-link/navigation to the
 * underlying service URL. No backend write, no mutation. Targets without a URL
 * (UPS/cron) have no external destination yet, so Open is a no-op for them.
 *
 * Security: only http/https schemes are allowed; javascript:/data:/etc. are
 * silently blocked. Malformed URLs are also a no-op.
 */
export function openTarget(target) {
  const url = target && target.url;
  if (!url || typeof url !== 'string') return;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
  } catch {
    return; // malformed URL — no-op
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
