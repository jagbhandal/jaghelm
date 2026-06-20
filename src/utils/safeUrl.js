/**
 * Allow only http(s)/mailto + relative URLs at the render boundary.
 *
 * Link URLs come from config, which can arrive via a BackupTab import or an
 * out-of-band data/services.yaml edit — not just the add-form. A stored
 * `javascript:fetch('/api/secrets')` would execute in JagHelm's origin when the
 * link is clicked. Returns the original URL when safe, or null when it must be
 * rendered inert (drop the href / skip window.open).
 *
 * @param {unknown} u
 * @returns {string|null}
 */
export function safeUrl(u) {
  if (!u || typeof u !== 'string') return null;
  const s = u.trim();
  if (!s) return null;
  try {
    const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const proto = new URL(s, base).protocol;
    return proto === 'http:' || proto === 'https:' || proto === 'mailto:' ? s : null;
  } catch {
    return null;
  }
}
