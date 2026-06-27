/**
 * SystemStatusCard — glass hero annunciator for the Overview screen.
 *
 * Props:
 *   severity      'critical' | 'caution' | 'healthy' | 'unknown'
 *   headline      string — full headline sentence (e.g. "Two services down")
 *   word          string (optional) — the specific word within `headline` to
 *                 color-span. Case-insensitive first-occurrence match. The
 *                 caller knows which word to highlight when building the
 *                 sentence (e.g. "down" for critical, "healthy" for healthy),
 *                 so passing it separately keeps the component purely
 *                 presentational.
 *   subline       string — DM Sans prose subline
 *   counts        string — mono footer (e.g. "14 up · 2 down · 3 nodes")
 *
 * Headline prop shape (chosen design):
 *   `headline` is a plain string; `word` is the substring to highlight.
 *   This is cleanest: the parent (Overview) already knows the sentence and
 *   the word to highlight when it derives them — no internal re-parsing of
 *   intent. Avoids the complexity of accepting React children (hard to test)
 *   or a structured `{text,word}` object (no gain over two flat props).
 *
 * CSS: styles are appended to MobileApp.css under `#mobile-root`.
 *   - `.sys-status-card--{severity}` drives ::before radial tint + border.
 *   - `.sys-status-card__word--{severity}` drives the colored word span.
 */

const SEV_COLOR = {
  critical: 'var(--red)',
  caution:  'var(--amber)',
  healthy:  'var(--green)',
  unknown:  'var(--steel)',
};

export default function SystemStatusCard({ severity, headline, word, subline, counts }) {
  const color = SEV_COLOR[severity] ?? 'var(--steel)';

  // Split headline around the first case-insensitive occurrence of `word`.
  // When `word` is absent or not found, render the headline as a plain string.
  let headlineParts = null;
  if (word && headline) {
    const idx = headline.toLowerCase().indexOf(word.toLowerCase());
    if (idx !== -1) {
      headlineParts = {
        before: headline.slice(0, idx),
        match:  headline.slice(idx, idx + word.length),
        after:  headline.slice(idx + word.length),
      };
    }
  }

  return (
    <div className={`sys-status-card sys-status-card--${severity}`}>
      {/* Silkscreen mono label — spec §7.2 */}
      <p className="sys-status-card__label">System status</p>

      {/* Outfit headline — status WORD color-spanned */}
      <p className="sys-status-card__headline">
        {headlineParts ? (
          <>
            {headlineParts.before}
            <span
              className={`sys-status-card__word sys-status-card__word--${severity}`}
              style={{ color }}
            >
              {headlineParts.match}
            </span>
            {headlineParts.after}
          </>
        ) : (
          headline
        )}
      </p>

      {/* DM Sans prose subline */}
      <p className="sys-status-card__subline">{subline}</p>

      {/* Mono counts footer */}
      <p className="sys-status-card__counts">{counts}</p>
    </div>
  );
}
