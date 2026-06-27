/**
 * StatusWord — mono, weight-500, UPPERCASE severity word.
 *
 * Props:
 *   word     string — the status word to display (e.g. 'DOWN', 'OK', 'ON BATTERY')
 *   severity 'critical' | 'caution' | 'healthy' | 'unknown'
 *
 * The word is ALWAYS present in the DOM (triple-coding requirement: word + color + shape).
 * Font-weight is 500 — JetBrains Mono only ships 400/500; 700 would clamp (see spec §4).
 * Color is applied via inline style to keep it testable in jsdom (CSS vars resolve to
 * the right token; class-based color is added in MobileApp.css for completeness).
 */

const SEVERITY_COLOR = {
  critical: 'var(--red)',
  caution:  'var(--amber)',
  healthy:  'var(--green)',
  unknown:  'var(--steel)',
};

export default function StatusWord({ word, severity }) {
  const color = SEVERITY_COLOR[severity] ?? 'var(--steel)';

  return (
    <span
      className={`status-word word--${severity}`}
      style={{
        fontFamily:     'var(--mono)',
        fontWeight:     500,
        textTransform:  'uppercase',
        color,
      }}
    >
      {(word ?? '').toUpperCase()}
    </span>
  );
}
