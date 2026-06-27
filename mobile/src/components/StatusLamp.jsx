/**
 * StatusLamp — colorblind-safe inline-SVG status indicator.
 *
 * Props:
 *   shape    'disc' | 'slash' | 'ring' | 'bolt'
 *   severity 'critical' | 'caution' | 'healthy' | 'unknown'
 *   label    string — aria-label for screen readers (sr-only fallback too)
 *   size     number — rendered px dimensions (default 16)
 *
 * Color is applied via a `lamp--{severity}` CSS class that sets `color`;
 * SVG primitives use `fill="currentColor"` / `stroke="currentColor"` to
 * inherit that color. See MobileApp.css for the class→token map.
 */
export default function StatusLamp({ shape, severity, label, size = 16 }) {
  const half = size / 2;
  const r = size * 0.34; // disc/ring radius — fits comfortably inside viewBox
  const sw = Math.max(1.5, size * 0.125); // stroke-width for ring / slash

  let inner;

  if (shape === 'disc') {
    // Filled solid disc — "up / ok"
    inner = <circle cx={half} cy={half} r={r} fill="currentColor" />;

  } else if (shape === 'ring') {
    // Hollow ring — "unknown / no-signal"
    inner = (
      <circle
        cx={half}
        cy={half}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={sw}
      />
    );

  } else if (shape === 'slash') {
    // Filled disc + diagonal slash cut — "down / critical"
    // The slash is rendered in white so it reads as a physical cut-through.
    const offset = r * 0.72;
    inner = (
      <>
        <circle cx={half} cy={half} r={r} fill="currentColor" />
        <line
          x1={half - offset}
          y1={half + offset}
          x2={half + offset}
          y2={half - offset}
          stroke="white"
          strokeWidth={sw}
          strokeLinecap="round"
        />
      </>
    );

  } else if (shape === 'bolt') {
    // Lightning bolt — "UPS on battery / caution"
    // Path drawn in a 16×16 coordinate space, scaled from `size`.
    const s = size / 16; // scale factor
    inner = (
      <path
        // classic lightning: upper-right point → mid-left → mid-right → lower-left point
        d={[
          `M${9 * s} ${1 * s}`,
          `L${4 * s} ${9 * s}`,
          `H${8 * s}`,
          `L${7 * s} ${15 * s}`,
          `L${12 * s} ${7 * s}`,
          `H${8.5 * s}`,
          'Z',
        ].join(' ')}
        fill="currentColor"
      />
    );
  }

  return (
    <svg
      className={`status-lamp lamp--${severity}`}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label || undefined}
    >
      {inner}
      {/* sr-only title as a belt-and-suspenders accessibility signal */}
      {label && <title>{label}</title>}
    </svg>
  );
}
