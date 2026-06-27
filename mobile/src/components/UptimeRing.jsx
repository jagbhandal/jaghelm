import React from 'react';
import { uptimePct, uptimeColor } from '../data/derive.js';

/**
 * UptimeRing — inline-SVG radial arc gauge for a uptime24 scalar (0–1).
 *
 * Props:
 *   uptime24  number | null — 0–1 uptime fraction. null/undefined → render nothing.
 *
 * Structure:
 *   - Background track ring (`.uptime-ring__track`)
 *   - Colored progress arc (`.uptime-ring__arc`), color via uptimeColor ramp
 *   - Centered percentage text (`.uptime-ring__pct`) in --mono, colored by ramp
 *   - "24H" label (`.uptime-ring__label`) as a SEPARATE SVG text element
 *
 * The "24H" label and the "%" value are intentionally separate SVG <text> nodes so
 * they can never collapse into a whitespace-free "24H99.9%" string the way a
 * flex `justify-content:space-between` row with a {' '} text node does (Bug #1 fix).
 */

const SIZE = 96;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R = 34;
const STROKE_W = 7;
const CIRCUMFERENCE = 2 * Math.PI * R;

export default function UptimeRing({ uptime24 }) {
  if (uptime24 == null) return null;

  const pct = uptimePct(uptime24);      // e.g. "99.9"
  const color = uptimeColor(uptime24);  // e.g. "var(--green)"
  const fraction = Math.min(1, Math.max(0, uptime24));
  const dashFilled = (fraction * CIRCUMFERENCE).toFixed(2);
  const dashTotal = CIRCUMFERENCE.toFixed(2);
  const dashArray = `${dashFilled} ${dashTotal}`;

  return (
    <div className="uptime-ring" aria-label={`24-hour uptime ${pct}%`}>
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        aria-hidden="true"
      >
        {/* Background track — static neutral ring */}
        <circle
          className="uptime-ring__track"
          cx={CX}
          cy={CY}
          r={R}
          fill="none"
          strokeWidth={STROKE_W}
        />

        {/* Colored progress arc — fraction of full circle, starts at 12 o'clock */}
        <circle
          className="uptime-ring__arc"
          cx={CX}
          cy={CY}
          r={R}
          fill="none"
          stroke={color}
          strokeWidth={STROKE_W}
          strokeDasharray={dashArray}
          strokeLinecap="round"
          transform={`rotate(-90 ${CX} ${CY})`}
        />

        {/* Centered percentage — SEPARATE node from "24H" label (Bug #1 guard) */}
        <text
          x={CX}
          y={CY - 6}
          textAnchor="middle"
          dominantBaseline="middle"
          className="uptime-ring__pct"
          style={{ fill: color }}
        >
          {pct}%
        </text>

        {/* "24H" label — intentionally a distinct SVG text element, not a sibling
            text node inside a flex row; prevents the {' '} whitespace-node jam */}
        <text
          x={CX}
          y={CY + 13}
          textAnchor="middle"
          dominantBaseline="middle"
          className="uptime-ring__label"
        >
          24H
        </text>
      </svg>
    </div>
  );
}
