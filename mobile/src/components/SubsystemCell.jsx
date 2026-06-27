/**
 * SubsystemCell — one cell in the 2×2 Overview subsystem strip.
 *
 * Props:
 *   cell  { key, label, severity, word, detail } — one element from deriveSubsystems().
 *
 * Lamp shape rule (computed locally, deterministic — documented here):
 *
 *   1. key === 'ups' AND severity === 'caution'  →  'bolt'
 *      Reason: UPS on battery is the unique amber-bolt condition; no other
 *      cell uses bolt. Bolt is the only shape that says "power-from-battery".
 *
 *   2. severity === 'critical'                   →  'slash'
 *      Reason: only the Services cell reaches critical; slash = "down/stopped".
 *
 *   3. severity === 'unknown'                    →  'ring'
 *      Reason: no signal = hollow ring (no fill = nothing to show).
 *
 *   4. severity === 'healthy' OR severity === 'caution' (non-ups)  →  'disc'
 *      Reason: nodes DEGRADED (hot resources) and cron FAILED are amber but
 *      still a filled-disc — the color carries the caution signal; the shape
 *      stays disc because the subsystem is reachable and reporting (≠ bolt).
 *
 * CSS: styles in MobileApp.css under `#mobile-root .subsystem-cell`.
 *   - `.subsystem-cell--{severity}` drives the tint + border via CSS vars.
 */
import StatusLamp from './StatusLamp.jsx';
import StatusWord from './StatusWord.jsx';

function cellLampShape(cell) {
  if (cell.key === 'ups' && cell.severity === 'caution') return 'bolt';
  if (cell.severity === 'critical') return 'slash';
  if (cell.severity === 'unknown') return 'ring';
  return 'disc'; // healthy or caution (non-UPS)
}

export default function SubsystemCell({ cell }) {
  const shape = cellLampShape(cell);

  return (
    <div className={`subsystem-cell subsystem-cell--${cell.severity}`}>
      {/* Header row: silkscreen mono label (left) + StatusLamp (right) */}
      <div className="subsystem-cell__header">
        <span className="subsystem-cell__label">{cell.label}</span>
        <StatusLamp
          shape={shape}
          severity={cell.severity}
          label={`${cell.label}: ${cell.word}`}
          size={14}
        />
      </div>

      {/* Big mono status WORD */}
      <StatusWord word={cell.word} severity={cell.severity} />

      {/* Mono detail line */}
      <span className="subsystem-cell__detail">{cell.detail}</span>
    </div>
  );
}
