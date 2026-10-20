/**
 * `cn` joins class names and drops any utility that a later one overrides, so a
 * caller's className beats a component's own classes. It is the `cn` package's
 * engine taught JagHelm's theme (tailwind.css, #285). Stock, it knows only
 * Tailwind's default names: it reads `text-body-sm` and `text-caption` as
 * colours, so `cn('text-caption text-crit-fg')` dropped the size, and it never
 * let a caller's `h-9` replace `h-control`. scripts/ui-stack.test.mjs fails
 * when these lists and tailwind.css's @theme block disagree.
 */
import { createCn } from 'cn/config';

/** The type scale's steps, as `text-<step>` (tailwind.css `--text-*`). */
export const TYPE_STEPS = Object.freeze([
  'overline',
  'caption',
  'body-sm',
  'body',
  'title-xs',
  'title-sm',
  'title',
  'headline',
  'display',
  'metric',
  'metric-lg',
]);

/** The named spacing: `h-row`, `p-panel`, `px-gutter`, `h-control`... (`--spacing-*`). */
export const SPACING = Object.freeze([
  'row',
  'panel',
  'gutter',
  'control',
  'control-sm',
  'segment',
]);

/** The shadows: `shadow-control` and `shadow-pop` (`--shadow-*`). */
export const SHADOWS = Object.freeze(['control', 'pop']);

export const cn = createCn({
  extend: {
    theme: { text: [...TYPE_STEPS], spacing: [...SPACING], shadow: [...SHADOWS] },
  },
});
