/*
 * Banner (spec §5.4, #286): what is wrong with a part of the screen, and why,
 * where that part shows. It keeps JagHelm's cause-naming pattern (today's
 * DegradedBanner: "Live metrics unavailable — Prometheus unreachable"): the
 * title says what failed, `cause` says why, naming the thing to go and check,
 * and `detail` adds a quieter line ("Updated 3 min ago"). A banner in a
 * failing tone (crit, warn, unknown) without a cause (or with a blank one)
 * throws in development and logs in production, as an IconButton without a
 * label does.
 *
 * It is drawn as the mock's status box at the top of the detail drawer: the
 * tone's icon (the lamp's shape, lib/tone.jsx), the title bold in the tone's
 * word colour, the cause in text-2, the detail in 12px text-3, on the tone's
 * tint inside a subtle edge, 14px of padding, a 12px radius. Ok has no tint:
 * healthy stays quiet. `action` (a Retry button) sits at the end.
 *
 * Status is a word, a colour and a shape together (design-system rule 3), so
 * the tone never rests on colour alone. Put a banner on the page or a panel
 * (bg or surface-1), where its colours are checked.
 *
 * It is not a live region: the same failure can show on several panels at
 * once, so the screen announces each cause once, from one place, as today's
 * dashboard does. Give `role="alert"` only to a banner that stands alone.
 */
import { cva } from 'class-variance-authority';
import { hasText } from './lib/name.js';
import { cn } from './lib/utils.js';
import { ToneIcon } from './lib/tone.jsx';

const FAILING = new Set(['crit', 'warn', 'unknown']);
const NO_CAUSE =
  'Banner needs a `cause` in a failing tone: say what failed (title) and why (cause)';

const bannerVariants = cva(
  'flex items-start gap-3 rounded-xl border border-border p-3.5 text-body text-text-1',
  {
    variants: {
      tone: {
        crit: 'bg-crit-tint',
        warn: 'bg-warn-tint',
        unknown: 'bg-unknown-tint',
        maintenance: 'bg-maintenance-tint',
        info: 'bg-info-tint',
        ok: '',
      },
    },
    defaultVariants: { tone: 'crit' },
  }
);

const titles = {
  crit: 'text-crit-fg',
  warn: 'text-warn-fg',
  unknown: 'text-unknown-fg',
  maintenance: 'text-maintenance-fg',
  info: 'text-info-fg',
  ok: 'text-ok-fg',
};

function Banner({ tone = 'crit', title, cause, detail, action, icon, className, ...props }) {
  if (FAILING.has(tone) && !hasText(cause)) {
    if (import.meta.env.DEV) throw new Error(NO_CAUSE);
    console.error(NO_CAUSE);
  }
  return (
    <div
      data-slot="banner"
      data-tone={tone}
      className={cn(bannerVariants({ tone }), className)}
      {...props}
    >
      <span className="flex shrink-0 pt-0.5">{icon ?? <ToneIcon tone={tone} />}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className={cn('font-bold', titles[tone])}>{title}</p>
        {cause != null ? <p className="text-text-2">{cause}</p> : null}
        {detail != null ? <p className="text-caption text-text-3">{detail}</p> : null}
      </div>
      {action != null ? (
        <div className="flex shrink-0 items-center self-center">{action}</div>
      ) : null}
    </div>
  );
}

export { Banner, bannerVariants };
