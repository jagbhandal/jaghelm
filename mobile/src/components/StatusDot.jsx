import React from 'react';

/**
 * Glowing status dot with a redundant glyph + SR label (WCAG 1.4.1 — never
 * color-only). 'running' counts as up; anything not up/down is unknown.
 */
export default function StatusDot({ status }) {
  const isUp = status === 'up' || status === 'running';
  const isDown = status === 'down';
  const color = isUp ? 'var(--green)' : isDown ? 'var(--red)' : 'var(--amber)';
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
