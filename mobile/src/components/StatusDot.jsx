export default function StatusDot({ status, source }) {
  const isUp = status === 'up' || status === 'running';
  const isDown = status === 'down';
  // A presence breadcrumb is grey (muted), never the amber a tracked 'unknown'
  // monitor would get — we are not claiming it broke.
  const isBreadcrumb = source === 'presence';
  const color = isBreadcrumb ? 'var(--text-muted)' : isUp ? 'var(--green)' : isDown ? 'var(--red)' : 'var(--amber)';
  const label = isUp ? 'Up' : isDown ? 'Down' : 'Unknown';
  const glyph = isUp ? '▲' : isDown ? '▼' : '◆';
  return (
    <span
      role="status"
      aria-label={`Status: ${label}`}
      style={{ flexShrink: 0, lineHeight: 1, fontSize: 9, color, textShadow: `0 0 6px ${color}`, fontFamily: 'var(--font-mono)' }}
    >
      <span aria-hidden="true">{glyph}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
