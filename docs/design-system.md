# JagHelm design system

The tokens and rules every new component in `src/ui/` follows. The values are the
ones Jag signed off in the overview mock on 2026-10-19
(https://claude.ai/artifact/Dv7EGVXZLe4ocsssZrwmkf, its Tokens, Overview and
Settings boards), per the overhaul spec
(`docs/superpowers/specs/2026-10-18-jaghelm-overhaul-design.md`, §5.2, §5.3 and
the sign-off amendments in §15).

- **Tokens:** [`src/ui/tokens.css`](../src/ui/tokens.css), CSS custom properties on
  `.jh-ui`, prefixed `--jh-`.
- **Utilities:** [`src/ui/tailwind.css`](../src/ui/tailwind.css) maps each role to a
  Tailwind utility (`bg-surface-1`, `text-text-2`, `text-crit-fg`).
- **Contrast:** [`scripts/ui-contrast.mjs`](../scripts/ui-contrast.mjs) checks every
  pairing below in both themes and all five accents, in `npm test`. Run
  `node scripts/ui-contrast.mjs` to see the lowest ratio per rule.
- How the stack sits beside today's CSS: [ARCHITECTURE.md §5.1](ARCHITECTURE.md#51-ui-stack-tailwind-css-v4-shadcnui-lucide).

## The rules

1. **JagHelm looks like JagHelm** (epic #333, rule 9). Graphite neutrals tinted
   toward hue 286, one violet accent, flat panels with a 1px border and a 12px
   radius, the shaped status lamps. No blur, frosted glass, mesh, dot grid or
   gradient text: the theme has no blur utilities, and a test fails if the
   built stack contains a blur. Check visual work against the signed-off mock,
   never against Arcane. Arcane is a benchmark for craft (crisp type, polish),
   never a source: no code, components, assets or layouts come from it, and
   Montserrat (Arcane's face) is offered but never the default (Manrope is,
   #284). A stock shadcn/ui component is reshaped with these tokens before a
   screen uses it.
2. **Violet means interactive or selected.** Primary buttons, the selected nav
   item, the active tab, toggles that are on, links, the focus ring. It also
   tints section icon chips (`bg-accent-tint`, `text-accent-text`,
   `border-accent-border`) and fills meters below their threshold
   (`bg-meter`), as the mock shows (§15). It is never a status and never a
   threshold colour. The other four accents follow the same rule.
3. **Status hues mean status only.** Green ok, amber warn, red crit, steel
   unknown, blue maintenance and info. Status is always a word, a colour and a
   shape together (filled disc, slashed disc, disc with a bar, hollow ring,
   wrench), so it never rests on colour alone. No signal is steel, never red.
   Healthy stays quiet: at most a small lamp. A meter changes colour only above
   its threshold, to `warn-solid` or `crit-solid`.
4. **Roles, never raw colours.** Components use the role utilities. Palette
   steps (`--jh-graphite-198`) exist for the roles to read; no component and no
   utility reads one (a test checks both). Tailwind's default palette, type
   sizes, radii, shadows and blurs are cleared, so `bg-red-500`, `text-sm`,
   `shadow-md` and `backdrop-blur` produce nothing.
5. **Text sits only where its contrast was checked** (the pairings below). On
   a violet fill use `text-on-accent`; on a status fill use that status's
   `on-solid`. `text-3` is for sparing captions: never on `surface-3`, never in
   a selected nav item.
6. **In the light theme lamps stay bright and the words darken.** A status's
   `solid` is the lamp; its `fg` is the word, darkened to carry 4.5:1.
7. **Panels are flat.** Only popovers, the command palette, dialogs and drawers
   cast a shadow (`shadow-pop`), over a scrim (`bg-scrim`) when modal.

## Switches

Set on the element that carries `jh-ui`, and on every portal root (dialogs,
popovers and menus render outside their parent):

| Attribute | Values | Default |
| --- | --- | --- |
| `data-theme` | `light` | dark |
| `data-accent` | `indigo`, `blue`, `fuchsia`, `graphite` | violet |
| `data-density` | `compact` | comfortable |

The `dark:` variant applies inside any root without `data-theme="light"`. Don't
nest roots of different themes. "System" (follow the device) is Settings'
job: it sets `data-theme` from `prefers-color-scheme`.

## Contrast floors

| Rule | Floor | Checked on |
| --- | --- | --- |
| `text-1` | 7:1 | bg, sidebar, surface-1/2/3; accent-tint, row-hover and every status tint over the surfaces they're used on |
| `text-2` | 4.5:1 | as text-1 |
| `text-3` | 4.5:1 | bg, sidebar, surface-1/2; accent-tint over bg and surface-1; row-hover; status tints |
| `accent-text` | 4.5:1 | bg, sidebar, surface-1/2; accent-tint; row-hover |
| `on-accent` | 4.5:1 | accent, and accent-hover |
| status `fg` | 4.5:1 | bg, sidebar, surface-1/2; its own tint over bg and surface-1 |
| status `on-solid` | 4.5:1 | its own solid |
| `focus-ring` | 3:1 | bg, sidebar, surface-1/2/3 (the ring sits 2px outside the control) |

Translucent tokens are painted over the surface beneath before measuring.
Contrast is WCAG 2's, computed from the OKLCH values as CSS Color 4 converts
them to sRGB; a colour outside sRGB scores the lower of clipping and CSS gamut
mapping. `text-disabled` is not checked (WCAG exempts disabled controls); it
sits near 3:1 on surface-1.

## Tokens

Each utility below reads `var(--jh-<role>)`. Values are in `tokens.css`; dark is
listed first.

### Surfaces, borders, text

| Role | Utility | Dark | Light | Use |
| --- | --- | --- | --- | --- |
| `bg` | `bg-background` | graphite-155 | graphite-982 | the page |
| `sidebar` | `bg-sidebar` | graphite-172 | graphite-972 | the nav rail |
| `surface-1` | `bg-surface-1` | graphite-198 | white | panels, tiles, dialogs |
| `surface-2` | `bg-surface-2` | graphite-238 | graphite-962 | hover, popovers, toasts |
| `surface-3` | `bg-surface-3` | graphite-285 | graphite-930 | segmented-control track, chips, skeletons |
| `border-subtle` | `border-border-subtle` (`border-border`) | white 8 % | graphite L 0.25, 10 % | panel and row edges |
| `border-strong` | `border-border-strong` | white 15 % | graphite L 0.25, 18 % | inputs, hover edges |
| `text-1` | `text-text-1` | graphite-975 | graphite-205 | headings, values, body |
| `text-2` | `text-text-2` | graphite-775 | graphite-430 | secondary text |
| `text-3` | `text-text-3` | graphite-665 | graphite-520 | captions, overlines (sparing) |
| `text-disabled` | `text-text-disabled` | graphite-500 | graphite-660 | disabled controls |

### Accent

| Role | Utility | Use |
| --- | --- | --- |
| `accent` | `bg-accent` | primary buttons, selected nav app chip, toggles on |
| `accent-hover` | `hover:bg-accent-hover` | a primary button under the pointer |
| `on-accent` | `text-on-accent` | text and icons on `accent` |
| `accent-text` | `text-accent-text` | links, active tab label, accent icons |
| `accent-tint` | `bg-accent-tint` | selected nav item, selected row, section icon chip |
| `accent-border` | `border-accent-border` | the selected card's edge, the section chip's ring |
| `focus-ring` | `outline-focus-ring` | 2px ring, 2px offset (the base style sets it) |
| `row-hover` | `hover:bg-row-hover` | a clickable row under the pointer |
| `meter` | `bg-meter` | a meter below its threshold |

The five accents (violet is the default). `on-accent` is violet-969 for all.

| Accent | `accent`, dark | `accent`, light |
| --- | --- | --- |
| Violet | `oklch(0.541 0.281 293.009)` | same |
| Indigo | `oklch(0.52 0.22 270)` | same |
| Blue | `oklch(0.53 0.19 255)` | same |
| Fuchsia | `oklch(0.56 0.23 328)` | `oklch(0.53 0.22 328)` |
| Graphite | `oklch(0.5 0.025 286)` | `oklch(0.38 0.02 286)` |

### Status

Six roles, each with five tokens: `fg` (`text-crit-fg`), `tint`
(`bg-crit-tint`), `border` (`border-crit-border`), `solid` (`bg-crit-solid`) and
`on-solid` (`text-crit-on-solid`). The spec's `bg-tint` is `tint` here.

| Role | Hue | Lamp | Meaning |
| --- | --- | --- | --- |
| `ok` | green 163 | filled disc | healthy |
| `warn` | amber 62–84 | slashed disc | degraded, caution |
| `crit` | red 22–27 | disc with a bar | down, critical |
| `unknown` | steel 250 | hollow ring | no signal: a source failed or has no data |
| `maintenance` | blue 254–260 | wrench | planned work |
| `info` | blue, as maintenance | none | neutral information, not a state |

`on-solid` is ink (graphite-120) on every solid, except white on blue in the
light theme.

### Component tokens

`track` (a meter's empty track), `tick` (its quarter marks), `beat-ok` (a
healthy heartbeat bar; failures use `crit-solid`), `lamp-cut` (the slash and bar
cut into warn and crit lamps, the panel colour), `scrim`, and the shadows below.

### Type

Families are tokens by name only (`font-sans`, `font-mono`); #284 self-hosts
Manrope (default), Plus Jakarta Sans and Montserrat, and JetBrains Mono for
hostnames, SHAs, paths and code. Sizes are px, as `text-<step>`:

| Step | Size / line | Weight | Use |
| --- | --- | --- | --- |
| `overline` | 11/16, 0.07em | 700 | uppercase labels; text-3 or stronger |
| `caption` | 12/16 | | timestamps, hints |
| `body-sm` | 13/18 | | rows, controls |
| `body` | 14/20 | | the default (the root sets it) |
| `title-sm` | 16/22 | 700 | entity names |
| `title` | 20/26 | 700 | section titles |
| `headline` | 24/30, -0.015em | 700 | the overview's status sentence |
| `display` | 28/32, -0.02em | 800 | page titles |
| `metric` | 24/28 | 700 | values |
| `metric-lg` | 32/36 | 700 | headline values |

Nothing is smaller than 12px except the 11px uppercase overline.

### Shape, space, elevation, layering, motion

- **Radius**, one token (`--radius`, 8px) mapped: `rounded-xs` 2 (heartbeat
  bars), `rounded-sm` 4 (badges), `rounded-md` 6 (segments inside a control),
  `rounded-lg` 8 (controls, rows), `rounded-xl` 12 (panels, dialogs, drawers),
  `rounded-full` (pills, lamps).
- **Spacing:** Tailwind's 4px steps; prefer 4, 8, 12, 16, 24, 32, 48 (`1`, `2`,
  `3`, `4`, `6`, `8`, `12`).
- **Density:** `h-row` is 40px (comfortable) or 32px (compact); `p-panel` is 20
  or 16.
- **Page gutter:** `px-gutter`, 16px on phones, 24 from 768px, 32 from 1536px.
- **Elevation:** `shadow-control` (the slight lift on buttons and the selected
  segment), `shadow-pop` (popovers, palette, dialogs, drawers), `bg-scrim`.
- **Z-index:** `z-sticky` 20, `z-header` 40, `z-overlay` 50 (scrims),
  `z-dialog` 60, `z-toast` 80.
- **Motion:** 150ms `ease` (`transition-*`, `duration-standard`,
  `ease-standard`) for drawers and popovers; animate bars only. With reduced
  motion asked for, transitions and animations are cut to nothing.

### shadcn/ui names

So that a generated component compiles in JagHelm's colours, shadcn's role names
map onto these: `background` bg, `foreground` text-1, `card` surface-1,
`popover` surface-2, `primary` accent, `primary-foreground` on-accent,
`secondary` and `muted` surface-2, `muted-foreground` text-2, `destructive`
crit-fg, `border` border-subtle, `input` border-strong, `ring` focus-ring.
shadcn's own `accent` (a hover surface) is not offered: `accent` here is the
violet. When a component is shaped for a screen, switch it to the JagHelm names.

## Changing a token

Values come from the signed-off mock. A change Jag hasn't seen goes into the
mock first.

- Edit `tokens.css`. Every token has its default on `.jh-ui` (dark, violet,
  comfortable); the switches only override. Each accent sets the same eight
  roles in its dark and light blocks.
- A new colour role needs a utility in `tailwind.css`'s `@theme` block, and its
  pairings in `PAIRINGS` in `scripts/ui-contrast.mjs`. A new switch needs
  teaching to that script's reader, which refuses selectors it doesn't know.
- `node scripts/ui-contrast.mjs` must report nothing below its floor.

Where the tokens differ from the mock, contrast required it:

- **Hover on dark accents.** The mock lightens a primary button on hover, which
  took the label below 4.5:1 for four accents. Each dark hover is now the
  lightest that keeps 4.5:1: indigo L 0.555 (mock 0.565), blue 0.545 (0.605),
  fuchsia 0.57 (0.6), graphite 0.545 (0.55). Violet keeps the mock's 0.585, at
  4.50:1.
- **Blue, dark.** The mock's dark blue (`oklch(0.56 0.19 255)`) carries its label
  at 4.3:1; the dark theme uses the light theme's `oklch(0.53 0.19 255)`, and its
  tint and row hover follow.
- **Tokens the mock didn't draw** are derived from it: `text-disabled`; `tint`
  for ok, maintenance and info (10 %); every status `border` (solid at 38 % dark,
  32 % light, as the accent's); every `on-solid`; `info`, which shares
  maintenance's blue.
