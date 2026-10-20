/**
 * `cn` joins class names and drops any utility that a later one overrides, so a
 * caller's className beats a component's own classes. It is the `cn` package's
 * engine taught JagHelm's theme (tailwind.css, #285). Stock, it knows only
 * Tailwind's default names: it reads `text-body-sm` and `text-caption` as
 * colours, so `cn('text-caption text-crit-fg')` dropped the size; it never let
 * a caller's `h-9` replace `h-control`; and it kept both of `z-dialog z-toast`,
 * leaving the stylesheet's order to pick one. scripts/ui-stack.test.mjs fails
 * when these lists and tailwind.css's @theme block disagree, and when any other
 * file in src/ui/ imports a `cn` or `twMerge` that isn't this one.
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

/** The shadows: `shadow-control`, `shadow-pop` and `shadow-thumb` (`--shadow-*`). */
export const SHADOWS = Object.freeze(['control', 'pop', 'thumb']);

/** The layers: `z-sticky` up to `z-toast` (`--z-index-*`). */
export const Z_INDEX = Object.freeze(['sticky', 'header', 'overlay', 'dialog', 'toast']);

/** The motion's duration, `duration-standard` (`--transition-duration-*`). */
export const DURATIONS = Object.freeze(['standard']);

/** The motion's easing, `ease-standard` (`--ease-*`). */
export const EASES = Object.freeze(['standard']);

// Pure, so a bundle that never calls cn leaves the cn package out: the Android
// app's, whose status components draw its own look until Phase 4 (#287).
export const cn = /* @__PURE__ */ createCn({
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
