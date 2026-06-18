import React from 'react';

/**
 * Sparkline — a tiny inline trend line, no library, just an SVG path.
 *
 * `data` is an array of numbers (oldest → newest). `domain` is the FIXED value
 * range it's drawn against (default 0–100 for usage %), so a flat line at 90%
 * reads differently from one at 10% — the absolute level is honest, not
 * auto-scaled to the window. The newest point gets a dot.
 *
 * Decorative + aria-hidden: the value text and its SR severity label already
 * convey the data; this is glance-context for sighted users only.
 */
export default React.memo(function Sparkline({
  data,
  width = 60,
  height = 16,
  domain = [0, 100],
  color = 'currentColor',
  className = '',
}) {
  if (!Array.isArray(data) || data.length < 2) return null;

  const [min, max] = domain;
  const span = max - min || 1;
  const n = data.length;
  const pts = data.map((v, i) => {
    const x = (i / (n - 1)) * width;
    const clamped = Math.max(min, Math.min(Number(v), max));
    const y = height - ((clamped - min) / span) * height;
    return [Math.round(x * 100) / 100, Math.round(y * 100) / 100];
  });
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]} ${p[1]}`).join(' ');
  const last = pts[pts.length - 1];

  return (
    <svg
      className={`sparkline ${className}`.trim()}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.6"
      />
      <circle cx={last[0]} cy={last[1]} r="1.6" fill={color} />
    </svg>
  );
});
