/*
 * StatusLamp (spec §5.2, §5.4; #287): a status's shape, so status never rests
 * on colour alone. Each state has its own (docs/design-system.md, rule 3):
 *
 *   ok           filled disc
 *   warn         disc slashed corner to corner
 *   crit         disc with a bar across
 *   unknown      hollow ring (no signal: never red)
 *   maintenance  wrench
 *
 * The lamp is the signed-off mock's: 10px (`sm`) or 14px (`lg`), or
 * any size in px, in the state's `solid`, the slash and the bar cut in
 * `lamp-cut` (the panel's colour). It is an image named by its word ("No
 * signal") unless `label` names it otherwise; `decorative` hides it from
 * assistive tech where the word sits beside it. It always draws its state's
 * shape.
 */
import { cn } from './lib/utils.js';
import { WORDS, toState } from './lib/status.js';

const SHAPES = { ok: 'disc', warn: 'slash', crit: 'bar', unknown: 'ring', maintenance: 'wrench' };
const SIZES = { sm: 10, lg: 14 };

// Lucide's wrench, as the mock's Tokens board draws it. It spans 2 to 22 on
// Lucide's 24px grid; the lamp scales that span to its box, less half the line
// on each side, so the wrench and its line are as big as a disc beside it.
const WRENCH =
  'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z';

const solid = {
  ok: 'text-ok-solid',
  warn: 'text-warn-solid',
  crit: 'text-crit-solid',
  unknown: 'text-unknown-solid',
  maintenance: 'text-maintenance-solid',
};

/** The marks for `shape` in a `px`-square box. */
function uiMarks(shape, px) {
  const c = px / 2;
  const cut = px >= 14 ? 2.5 : 2; // the mock's slash and bar: 2px at 10, 2.5 from 14
  const disc = <circle cx={c} cy={c} r={c} fill="currentColor" />;
  if (shape === 'ring') {
    return <circle cx={c} cy={c} r={c - 1} fill="none" stroke="currentColor" strokeWidth={2} />;
  }
  if (shape === 'slash') {
    // Corner to corner, bottom left to top right, ending at the disc's edge.
    const k = c * Math.SQRT1_2;
    return (
      <>
        {disc}
        <line
          className="stroke-lamp-cut"
          x1={c - k}
          y1={c + k}
          x2={c + k}
          y2={c - k}
          strokeWidth={cut}
        />
      </>
    );
  }
  if (shape === 'bar') {
    // The mock's bar: 2px in from each side at 10px, 3 at 14, 3.5 at 16.
    const inset = Math.round(px * 0.215 * 2) / 2 + cut / 2;
    return (
      <>
        {disc}
        <line
          className="stroke-lamp-cut"
          x1={inset}
          y1={c}
          x2={px - inset}
          y2={c}
          strokeWidth={cut}
          strokeLinecap="round"
        />
      </>
    );
  }
  if (shape === 'wrench') {
    // Its own viewport onto the 2-to-22 span, widened by half the line (1.5px
    // whatever the size) on each side, so the box doesn't clip the jaw tips.
    // Hidden, so the lamp stays one image.
    const line = 1.5;
    const m = ((line / 2) * 20) / (px - line); // half the line, in Lucide's units
    return (
      <svg
        aria-hidden="true"
        width={px}
        height={px}
        viewBox={`${2 - m} ${2 - m} ${20 + 2 * m} ${20 + 2 * m}`}
      >
        <path
          d={WRENCH}
          fill="none"
          stroke="currentColor"
          strokeWidth={line}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  return disc;
}

function StatusLamp({
  state,
  severity,
  shape: _shape, // ignored: the lamp draws its state's own shape
  label,
  size,
  decorative = false,
  className,
  ...props
}) {
  const s = toState(state ?? severity);
  const px = typeof size === 'number' ? size : (SIZES[size] ?? SIZES.sm);
  const name = decorative
    ? { 'aria-hidden': 'true' }
    : { role: 'img', 'aria-label': label || WORDS[s] };
  return (
    <svg
      data-slot="status-lamp"
      data-state={s}
      data-shape={SHAPES[s]}
      width={px}
      height={px}
      viewBox={`0 0 ${px} ${px}`}
      className={cn('inline-block shrink-0 align-middle', solid[s], className)}
      {...name}
      {...props}
    >
      {uiMarks(SHAPES[s], px)}
    </svg>
  );
}

export { StatusLamp };
