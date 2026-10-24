/**
 * `cn` joins class names and drops any utility that a later one overrides, so a
 * caller's className beats a component's own classes. It is clsx's join and
 * tailwind-merge's merge, taught JagHelm's theme (tailwind.css, #285). Stock,
 * the merge knows only Tailwind's default names: it reads `text-body-sm` and
 * `text-caption` as colours, so `cn('text-caption text-crit-fg')` dropped the
 * size; it never let a caller's `h-<n>` replace `h-control`; and it kept both
 * of `z-dialog z-toast`, leaving the stylesheet's order to pick one.
 * scripts/ui-stack.test.mjs fails when these lists and tailwind.css's @theme
 * block disagree, and when any other file in src/ui/ imports a `cn` or
 * `twMerge` that isn't this one.
 *
 * It was the `cn` package's engine until #444: tailwind-merge with the same
 * lists merges every pair of the classes src/ui/ writes the same, in half the
 * bytes (about 7 KB gzipped of the first load).
 */
import { clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/** The type scale's steps, as `text-<step>` (tailwind.css `--text-*`). */
export const TYPE_STEPS = Object.freeze([
  'badge',
  'overline',
  'caption',
  'body-sm',
  'body',
  'title-xs',
  'title-sm',
  'title',
  'title-lg',
  'headline',
  'display',
  'metric',
  'metric-lg',
]);

/** The named spacing: `h-row`, `p-panel`, `left-gutter`, `h-control`... (`--spacing-*`). */
export const SPACING = Object.freeze([
  'row',
  'panel',
  'gutter',
  'control',
  'control-sm',
  'segment',
]);

/** The shadows: `shadow-control`, `shadow-pop` and `shadow-thumb` (`--shadow-*`). */
export const SHADOWS = Object.freeze(['control', 'pop', 'thumb']);

/** The layers, lowest first, as `z-<layer>`: `z-dialog`, `z-toast`... (`--z-index-*`). */
export const Z_INDEX = Object.freeze(['sticky', 'header', 'overlay', 'dialog', 'toast']);

/** The motion's duration, as `duration-<name>` (`--transition-duration-*`). */
export const DURATIONS = Object.freeze(['standard']);

/** The motion's easing, as `ease-<name>` (`--ease-*`). */
export const EASES = Object.freeze(['standard']);

// Pure, so a bundle that never calls cn leaves tailwind-merge out.
const merge = /* @__PURE__ */ extendTailwindMerge({
  extend: {
    theme: {
      text: [...TYPE_STEPS],
      spacing: [...SPACING],
      shadow: [...SHADOWS],
      ease: [...EASES],
    },
    classGroups: {
      z: [{ z: [...Z_INDEX] }],
      duration: [{ duration: [...DURATIONS] }],
    },
  },
});

/** Class names joined as clsx joins them (strings, arrays, an object's true keys), then merged. */
export const cn = (...inputs) => merge(clsx(inputs));
