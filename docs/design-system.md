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
- **Accents:** [`src/ui/accents.js`](../src/ui/accents.js) is the one list of
  accents: Violet (default), Fuchsia and Cyan. `tokens.css`, the contrast check
  and this page follow it, and a test fails when any of them disagrees.
- **Typefaces:** [`src/ui/typefaces.js`](../src/ui/typefaces.js) is the one list
  of faces: Manrope (default), Plus Jakarta Sans and Montserrat, and JetBrains
  Mono. [`src/ui/fonts.css`](../src/ui/fonts.css) self-hosts them from
  `src/fonts/`, `tokens.css` switches them, and this page lists them
  ([Type](#type)); `scripts/fonts.test.mjs` fails when any of them, or a font
  file, disagrees.
- **Contrast:** [`scripts/ui-contrast.mjs`](../scripts/ui-contrast.mjs) checks every
  pairing below in both themes and all three accents, on sRGB and Display P3
  screens, each accent's hover against its rest state, and each accent against
  the status colours, in `npm test`. Run `node scripts/ui-contrast.mjs` to see
  the lowest ratio per rule on each screen and each accent's nearest status.
- **Components:** the controls in `src/ui/` (#285) are listed under
  [Components](#components), with their variants, sizes and keyboard use, and
  the status components (#287) under [Status components](#status-components).
  No web screen uses them yet; the Android app's screens use the status
  components, in its own look.
- How the stack sits beside today's CSS: [ARCHITECTURE.md §5.1](ARCHITECTURE.md#51-ui-stack-tailwind-css-v4-shadcnui-lucide).

## The rules

1. **JagHelm looks like JagHelm** (epic #333, rule 9). Graphite neutrals tinted
   toward hue 286, one violet accent, flat panels with a 1px border and a 12px
   radius, the shaped status lamps. No blur, frosted glass, mesh, dot grid,
   text shadow or gradient text: the theme has no blur or text-shadow
   utilities, and a test fails if the built stack contains a blur, a text
   shadow or text clipped to its background (`bg-clip-text`, how gradient text
   is made). Check visual work against the signed-off mock,
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
   threshold colour. The other two accents, Fuchsia and Cyan, follow the same
   rule. **An accent must never read as a status colour: ΔE OK ≥ 0.05 from
   every status colour in both themes.** Each colour an accent paints (the
   button at rest and hovered, a link, a meter, the focus ring) is measured
   against every status lamp, bar and word, and the check fails below 0.05
   ("Accent against status", below). Blue, Indigo and Graphite were dropped
   for this (Jag, 2026-10-19): Blue sat on maintenance's blue, Indigo nearly
   did in light, and Graphite's meter was the "no signal" grey.
3. **Status hues mean status only.** Green ok, amber warn, red crit, steel
   unknown, blue maintenance and info. Status is always a word, a colour and a
   shape together (filled disc, slashed disc, disc with a bar, hollow ring,
   wrench), so it never rests on colour alone. No signal is steel, never red.
   Healthy stays quiet: at most a small lamp. A meter changes colour only above
   its threshold, to `warn-solid` or `crit-solid`.
4. **Roles, never raw colours.** Components use the role utilities. Palette
   steps (`--jh-graphite-198`) exist for the roles to read; no component and no
   utility reads one (a test checks both). Tailwind's default palette, type
   sizes, font families, radii, shadows, text shadows and blurs are cleared,
   so `bg-red-500`, `text-sm`, `font-serif`, `shadow-md`, `text-shadow-sm` and
   `backdrop-blur` produce nothing, and a test fails on any class in `src/ui/`
   that compiles to nothing (`scripts/ui-stack.test.mjs`).
5. **Text sits only where its contrast was checked** (the pairings below). On
   a violet fill use `text-on-accent`; on a status fill use that status's
   `on-solid`. Status words may sit in hovered and selected rows. `text-3` is
   for sparing captions: never on `surface-3`, never in a selected nav item,
   and never on a selected item in a popover or menu (`accent-tint` over
   `surface-2`). The check names these three as ruled out and refuses them.
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
| `data-accent` | `fuchsia`, `cyan` | violet |
| `data-density` | `compact` | comfortable |
| `data-typeface` | `plus-jakarta-sans`, `montserrat` | manrope |

The `dark:` variant applies inside any root without `data-theme="light"`. Don't
nest roots of different themes. "System" (follow the device) is Settings'
job: it sets `data-theme` from `prefers-color-scheme`.

Portalled content gets its root from
[`src/ui/lib/portal.js`](../src/ui/lib/portal.js): `usePortalRoot(ref)` gives
the portal element `jh-ui` and copies each switch from the root around the
control that opened it (`ROOT_SWITCHES`), read when the control mounts and
again when the popup opens. The Select's list uses it; popovers, dialogs and
menus (#286) will too. A new switch goes into `ROOT_SWITCHES` as well as
`tokens.css`; `scripts/ui-stack.test.mjs` fails until both list it.

## Contrast floors

Each foreground is checked on exactly these backgrounds. "Over" means a
translucent token painted over that surface.

| Foreground | Floor | Opaque backgrounds | Translucent backgrounds |
| --- | --- | --- | --- |
| `text-1` | 7:1 | bg, sidebar, surface-1, surface-2, surface-3 | accent-tint over bg, sidebar and surface-1; row-hover over bg, surface-1 and surface-2 (a Select's highlighted option); each status tint over bg and surface-1 |
| `text-2` | 4.5:1 | bg, sidebar, surface-1, surface-2, surface-3 | the same as `text-1` |
| `text-3` | 4.5:1 | bg, sidebar, surface-1, surface-2 | accent-tint over bg and surface-1; row-hover over bg and surface-1; each status tint over bg and surface-1 |
| `accent-text` | 4.5:1 | bg, sidebar, surface-1, surface-2 | accent-tint over bg, sidebar and surface-1; row-hover over bg, surface-1 and surface-2 (a Select's chosen tick under the highlight) |
| `on-accent` | 4.5:1 | accent, accent-hover | none |
| status `fg` | 4.5:1 | bg, sidebar, surface-1, surface-2 | its own tint, row-hover and accent-tint, each over bg and surface-1 |
| status `on-solid` | 4.5:1 | its own solid | none |
| `focus-ring` | 3:1 | bg, sidebar, surface-1, surface-2, surface-3 (the ring sits 2px outside the control) | none |
| `control-edge` | 3:1 | bg, sidebar, surface-1, surface-2 | row-hover over bg and surface-1 |

`control-edge` is the edge of a control with no fill of its own, an empty
checkbox or an off switch. WCAG 1.4.11 asks 3:1 of the boundary that shows
where a control is; `border-strong` (1.4:1 to 1.5:1) and `surface-3` on the page
(1.2:1 in light) are too faint for it. Its worst case is 3.77:1 (light, in a
hovered row on the page).

Ruled out by name, because they fall below 4.5:1 somewhere and the mock never
draws them (`FORBIDDEN` in the script):

| Pairing | Where it would appear | Worst ratio |
| --- | --- | --- |
| `text-3` on surface-3 | a chip or segmented-control track | 4.49:1 (light) |
| `text-3` on accent-tint over sidebar | a selected nav item | 4.42:1 (light) |
| `text-3` on accent-tint over surface-2 | a selected item in a popover or menu | 4.29:1 (light) |

Contrast is WCAG 2's, computed from the OKLCH values as CSS Color 4 converts
them, and compared unrounded (4.4999:1 fails 4.5:1; the report never rounds a
miss up to its floor). Every pairing must pass on two kinds of screen:

- **sRGB.** A colour outside sRGB scores the lower of clipping (what browsers
  do today) and CSS Color 4's gamut mapping.
- **Display P3** (Macs, iPhones, many Android phones). A colour outside sRGB
  but inside P3 shows at its true value there, not clipped, and luminance is
  P3's own. Vivid violets can be lighter on P3 than on sRGB.

`text-disabled` is not checked (WCAG exempts disabled controls); it sits near
3:1 on surface-1.

**Hover.** Each accent's `accent-hover` must differ from its `accent` by at
least ΔE OK 0.02 (distance in OKLab, CSS Color 4's just-noticeable difference),
as either screen paints them, so a primary button always shows that it is
under the pointer. The check reports the closest pair.

**Accent against status** (rule 2). Each of an accent's `accent`,
`accent-hover`, `accent-text`, `meter` and `focus-ring` must sit at least ΔE OK
0.05 from every status's `solid` (a lamp or bar) and `fg` (its word), in the
same theme, as either screen paints them. 0.05 is two and a half times the
just-noticeable difference: under it a link or meter reads as the status next
to it. The dropped accents sat at 0.018 (Graphite's dark meter against the "no
signal" ring), 0.021 (a light Blue hover against the word Maintenance) and
0.037 (Indigo's light meter against a maintenance bar). The check reports each
accent's nearest status colour; the accents table below lists them.

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
| `surface-3` | `bg-surface-3` | graphite-285 | graphite-930 | segmented-control track, a switch's off track, chips, skeletons |
| `border-subtle` | `border-border-subtle` (`border-border`) | white 8 % | graphite L 0.25, 10 % | panel and row edges |
| `border-strong` | `border-border-strong` | white 15 % | graphite L 0.25, 18 % | inputs, hover edges |
| `control-edge` | `border-control-edge` | graphite-580 | graphite-580 | an empty checkbox's and an off switch's edge (3:1, WCAG 1.4.11) |
| `text-1` | `text-text-1` | graphite-975 | graphite-205 | headings, values, body |
| `text-2` | `text-text-2` | graphite-775 | graphite-430 | secondary text |
| `text-3` | `text-text-3` | graphite-665 | graphite-520 | captions, overlines (sparing) |
| `text-disabled` | `text-text-disabled` | graphite-500 | graphite-660 | disabled controls |

### Accent

| Role | Utility | Use |
| --- | --- | --- |
| `accent` | `bg-accent` | primary buttons, selected nav app chip, toggles on |
| `accent-hover` | `hover:bg-accent-hover` | a primary button under the pointer (at least ΔE OK 0.02 from `accent`) |
| `on-accent` | `text-on-accent` | text and icons on `accent` |
| `accent-text` | `text-accent-text` | links, active tab label, accent icons |
| `accent-tint` | `bg-accent-tint` | selected nav item, selected row, section icon chip |
| `accent-border` | `border-accent-border` | the selected card's edge, the section chip's ring |
| `focus-ring` | `outline-focus-ring` | 2px ring, 2px offset (the base style sets it) |
| `row-hover` | `hover:bg-row-hover` | a clickable row under the pointer |
| `meter` | `bg-meter` | a meter below its threshold |

The three accents, as `src/ui/accents.js` lists them. `on-accent` is violet-969
for all. "Nearest status" is the smallest ΔE OK between any of the accent's
colours and any status colour (rule 2; at least 0.05).

| Accent | `data-accent` | `accent`, dark | `accent`, light | Nearest status, dark / light |
| --- | --- | --- | --- | --- |
| Violet (default) | none | `oklch(0.541 0.281 293.009)` | same | 0.103 / 0.129 |
| Fuchsia | `fuchsia` | `oklch(0.56 0.23 328)` | `oklch(0.53 0.22 328)` | 0.124 / 0.196 |
| Cyan | `cyan` | `oklch(0.52 0.09 215)` | same | 0.095 / 0.064 |

Violet's nearest is its dark link against the word Maintenance (in light, its
meter against a maintenance bar); Fuchsia's is its link against the "no signal"
word; Cyan's is its dark meter against the word Maintenance and, in light, its
link against the "no signal" word.

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
cut into warn and crit lamps, the panel colour), `scrim`, `switch-thumb` (a
switch's thumb, white in both themes, as the mock's), and the shadows below.

### Type

**Faces.** Self-hosted, never from a CDN or Google Fonts (#244, #284). Each is
the variable latin subset Google Fonts serves, under the SIL Open Font License
1.1; the files and their licences are in `src/fonts/`. `data-typeface` picks
the sans face (Settings → Appearance, #321); there is one monospace face.

| Face | `data-typeface` | Weights | Use |
| --- | --- | --- | --- |
| Manrope (default) | none | 200–800 | all text: `font-sans`, which the root sets |
| Plus Jakarta Sans | `plus-jakarta-sans` | 200–800 | all text, when picked |
| Montserrat | `montserrat` | 100–900 | all text, when picked (Arcane's face: offered, never the default) |
| JetBrains Mono | none | 400–800 | hostnames, SHAs, paths and code only: `font-mono`, and `code`, `kbd`, `samp` and `pre` |

- **Only what a screen uses downloads.** A browser fetches a face when text
  renders in it: the picked sans face, and JetBrains Mono once a screen shows
  mono text. Nothing is preloaded, so a face nobody picked never downloads.
  `font-display: swap` shows the system face until the file arrives, and
  characters outside the latin subset always use it.
- **Budget: fonts on first load ≤ 60 KB** for the default setup. Manrope
  (24.3 KB) and JetBrains Mono (30.7 KB) come to 55.0 KB, 57.1 KB on the wire
  with JagHelm's response headers, and a test fails when the files pass 60 KB.
  Plus Jakarta Sans is 26.7 KB and Montserrat 37.1 KB. Until Phase 1 replaces
  them, today's screens load their own three files first (98.3 KB, the same
  files Google Fonts served them); the new UI shares JetBrains Mono's.
- **Use the families by role** (`font-sans`, `font-mono`), never by name.
  `font-mono` turns off JetBrains Mono's programming ligatures, as the mock
  does, so a hostname or a SHA reads character by character.
- **Tabular figures everywhere.** The root sets `font-variant-numeric:
  tabular-nums`, as the mock does, so values line up in rows, tiles and meters
  without a class. The utilities are Tailwind's: `proportional-nums` opts a run
  of prose out, `tabular-nums` opts back in.
- **Smoothing.** The root sets the mock's grayscale smoothing
  (`-webkit-font-smoothing: antialiased`, `-moz-osx-font-smoothing:
  grayscale`) and `text-rendering: optimizeLegibility`.

**Scale.** Sizes are px, as `text-<step>`; a step sets its size, line height
and, where listed, weight and tracking (a weight utility overrides it):

| Step | Size / line | Weight | Use |
| --- | --- | --- | --- |
| `overline` | 11/16, 0.07em | 700 | uppercase labels; text-3 or stronger |
| `caption` | 12/16 | | timestamps, hints |
| `body-sm` | 13/18 | | rows, controls |
| `body` | 14/20 | | the default (the root sets it) |
| `title-xs` | 15/20 | 700 | panel and card titles, node names, the healthy overview's line |
| `title-sm` | 16/22 | 700 | entity names |
| `title` | 20/26 | 700 | section titles, drawer titles |
| `headline` | 24/30, -0.015em | 700 | the overview's status sentence |
| `display` | 28/32, -0.02em | 800 | page titles |
| `metric` | 24/28 | 700 | values |
| `metric-lg` | 32/36 | 700 | headline values |

Nothing is smaller than 12px except the 11px uppercase overline. The Large text
size (#321) is a setting on the root, not a step.

**Sizes the mock draws off the scale** map onto it (#284). The mock uses 15px
titles in two dozen places, so they got a step (`title-xs`); the others are
one-offs:

| Mock | Where | Step |
| --- | --- | --- |
| 10px, 800 | app chip initials (20 and 22px chips), the phone tab bar's count badge | `overline` (11/16), `font-extrabold` |
| 10.5px | overline labels on meters, palette result kinds, the phone's subsystem labels | `overline` |
| 14/18, 700 | the phone's subsystem values | `body` (14/20), `font-bold` |
| 15px, 700 | panel and card titles in Settings, node names, the healthy overview's line, the header's status word | `title-xs` |
| 15px | the command palette's search field | `title-xs`, `font-normal` |
| 15.5/22 | body text at the Large text size (the mock's `ts-large`) | not a step: the text-size setting (#321) |
| 17px, 800 | the phone header's wordmark | `title-sm` (16/22), `font-extrabold` |
| 18/24, 700 | subsystem strip values | `title-sm` (16/22) |
| 18/24, 700 | the "won't open inside JagHelm" dialog's title | `title` (20/26) |
| 22/28, 800 | the phone's status word | `headline` (24/30), as on desktop |
| 22/28, 800 | the phone drawer's title | `title` (20/26), as the desktop drawer's |
| 26/30, 700 | the typeface picker's "Aa" samples | `headline` (24/30) |
| 26/32, 700 | the settings map's page title | `display` (28/32) |

### Shape, space, elevation, layering, motion

- **Radius**, one token (`--radius`, 8px) mapped: `rounded-xs` 2 (heartbeat
  bars), `rounded-sm` 4 (badges), `rounded-md` 6 (segments inside a control),
  `rounded-lg` 8 (controls, rows), `rounded-xl` 12 (panels, dialogs, drawers),
  `rounded-full` (pills, lamps). There is no other radius: the mock's few
  off-scale ones map onto these (below).
- **Spacing:** Tailwind's 4px steps; prefer 4, 8, 12, 16, 24, 32, 48 (`1`, `2`,
  `3`, `4`, `6`, `8`, `12`).
- **Density:** `h-row` is 40px (comfortable) or 32px (compact); `p-panel` is 20
  or 16. Compact is spacing: the controls keep the mock's heights in both
  densities ([Components](#density-and-sizes)): `h-control` 34 (md buttons,
  inputs, selects, tabs), `h-control-sm` 30 (sm buttons, a select's options),
  `h-segment` 30 (a segment, whose track makes it 34), and `size-control` and
  `size-control-sm` for square icon buttons.
- **Page gutter:** `px-gutter`, 16px on phones, 24 from 768px, 32 from 1536px.
- **Elevation:** `shadow-control` (the slight lift on buttons and the selected
  segment), `shadow-pop` (popovers, palette, dialogs, drawers), `shadow-thumb`
  (a switch's thumb, the mock's `0 1px 2px` at 30 % black in both themes),
  `bg-scrim`.
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
violet, and `accent-foreground` compiles to nothing. Stock menus, selects and
command lists highlight an item with `focus:bg-accent
focus:text-accent-foreground`; pasted as-is, that paints the item solid violet
with `text-1` on it (3.05:1 in light). A test fails on any `accent-foreground`
in `src/ui/`: highlight with `bg-row-hover` or `bg-surface-2` and
`text-text-1` instead. When a component is shaped for a screen, switch it to the
JagHelm names.

## Components

The controls (spec §5.4, #285), one file each in `src/ui/`, imported as
`@ui/<file>`. Each is a Base UI primitive, which brings the focus handling,
the keys and the ARIA, drawn from the role tokens in the signed-off mock's
shapes. No screen uses them yet; the gallery (#289) will show every state.

| Component | Import | Base UI part | Props | Keys |
| --- | --- | --- | --- | --- |
| `Button` | `@ui/button` | Button | `variant`: `primary`, `secondary` (default), `ghost`, `danger`; `size`: `sm`, `md` (default); `tone`: `neutral` (default), `accent` (ghost only) | Tab; Enter or Space |
| `IconButton` | `@ui/icon-button` | Button | `label` (required); the Button's variants (`ghost` by default), sizes and tones | Tab; Enter or Space |
| `Input` | `@ui/input` | Input | the input's own | Tab |
| `Select` | `@ui/select` | Select | `items` (`[{ value, label, disabled? }]`), `placeholder`, `value` or `defaultValue`, `onValueChange`, `name` and Base UI's other Select props; the rest, `ref` included, go to the trigger (`style`, `data-*`, ARIA, `title`, focus handlers) | Enter, Space or an arrow opens; the arrows and typing move; Enter picks; Escape closes |
| `Switch` | `@ui/switch` | Switch | `checked` or `defaultChecked`, `onCheckedChange`, `name` | Space |
| `Checkbox` | `@ui/checkbox` | Checkbox | as the Switch, and `indeterminate` | Space |
| `Field` | `@ui/field` | Field | `label`, `description` (help text), `error`, `invalid`, `disabled`, `nativeLabel` | its control's |
| `SegmentedControl` | `@ui/segmented-control` | RadioGroup, Radio | `options` (`[{ value, label, icon?, disabled? }]`), `value` or `defaultValue`, `onValueChange`, `name` | Tab enters at the chosen segment; the arrows move and choose |
| `Tabs`, `TabList`, `Tab`, `TabPanel` | `@ui/tabs` | Tabs | `value` or `defaultValue`; `activateOnFocus` on `TabList` (default on) | the arrows, Home and End move; Tab goes to the panel |

### How each looks

From the mock's Settings and Overview boards:

- **Button.** The mock's `.jh-primary`, `.jh-btn` and `.jh-ghost`: `rounded-lg`
  (8px), `text-body-sm` (13px).
  - `primary`: `bg-accent`, `text-on-accent`, bold, `shadow-control`;
    `accent-hover` under the pointer. One per view at most.
  - `secondary`, the default: `bg-surface-1` in a `border-border` edge,
    semibold, `shadow-control`; under the pointer the edge is `border-strong`
    and the fill `surface-2`.
  - `ghost`: no fill or edge, `text-text-2`; `surface-2` and `text-1` under the
    pointer. At sm it is the mock's row action (Edit, Remove, Sign out):
    `rounded-md` (6px) and 10px padding. `tone="accent"` draws it in
    `accent-text`, which it keeps under the pointer, as the mock's Edit and
    Clear filter.
  - `danger`: the secondary's shape in `text-crit-fg` with a
    `border-crit-border` edge, `surface-2` under the pointer. It warns about an
    action, so it never takes `crit-solid`, which is a status (rule 3).
  - Padding is the mock's: at md 14px for primary, 12 for secondary and
    danger, 10 for ghost; at sm 12, 10 and 10. Icons are Lucide in
    `currentColor`, 16px at md and 14 at sm, at the mock's 1.75 stroke.
  - A link drawn as a button puts `buttonVariants({ variant, size, tone })` on
    its `<a>`.
- **IconButton.** Square, 34px (`size-control`) or 30 at sm, `rounded-lg`
  (8px) at both, ghost by default, as the mock's theme, reload and close
  buttons. `label` becomes its accessible name. Without one (or an
  `aria-label` or `aria-labelledby`) it throws in development; a production
  build logs the error instead, so a label read from data that comes back
  empty doesn't take the screen down.
- **Input** and the **Select** trigger: the mock's `.field`, `bg-background` in
  a `border-border-strong` edge, 13px `text-1`, placeholder `text-3`, 10px
  padding. Their focus ring sits 1px out, as the mock's does. An invalid one's
  edge is `border-crit-border`.
- **The Select's list** is a popover: `surface-2` in a `border-strong` edge
  with `shadow-pop`, 6px around 8px-radius options (`h-control-sm`, 10px
  padding), the highlighted one tinted `row-hover` as the command palette's
  rows are, the chosen one ticked in `accent-text`. It opens below the
  trigger, not over it, portalled ([Switches](#switches)).
- **Switch.** The mock's `.tog`: a 36 × 20 track, `surface-3` off and `accent`
  on, a 16px white thumb (`switch-thumb`) with `shadow-thumb`. Off, the track
  has a 1px `control-edge` edge, which the mock lacks (3:1 for WCAG 1.4.11; see
  [Contrast floors](#contrast-floors)); on, the edge is the accent, so the
  track is the mock's. The mock's locked toggle is a disabled one.
- **Checkbox.** 16px, `rounded-sm`, `bg-background` in a `control-edge` edge,
  as easy to see as the browser's own box in the mock; checked or mixed,
  `accent` with an `on-accent` tick or bar. An invalid one's edge is
  `crit-fg`, which keeps 3:1. The mock uses the browser's checkbox in the
  accent colour; this one is drawn, so it looks the same everywhere.
- **Field.** The mock's label (13px semibold `text-1`), the control, then the
  help text (12px `text-3`), 6px apart; an error under them in `text-crit-fg`
  with an alert icon, so it never rests on colour alone. Help text is `text-3`,
  so a Field never sits on `surface-3` (rule 5).
- **SegmentedControl.** The mock's Density, Text size and Temperature pickers:
  a `surface-3` track with 2px around 6px-radius segments, the chosen one on
  `surface-1` with `shadow-control` in `text-1`, the others `text-2` (never
  `text-3`, which fails on `surface-3`). A segment is 30px (`h-segment`), so
  the control is 34px, as an Input or Button beside it.
- **Tabs.** The mock draws none, so they follow §5.2: `text-2` labels, the
  active one in `accent-text` over a 2px `accent` bar on the list's
  `border-subtle` bottom edge, not shadcn's pill tabs.

### Accessibility

- **Base UI does the behaviour:** focus order, roving focus in a group, the
  keys above, the roles and states (`aria-checked`, `aria-selected`,
  `aria-expanded`, `aria-controls`), and the hidden inputs that carry a
  Switch, Checkbox, segment or Select in a form. None of it is hand-rolled.
- **Every control has a name:** its text (Button, segment, tab), `label`
  (IconButton), a Field, an enclosing `<label>` (Switch and Checkbox, the
  mock's pattern), or `aria-label` or `aria-labelledby` (Select,
  SegmentedControl, TabList).
  - A Field names a Select or a SegmentedControl with a `<div>`, not a
    `<label>`, however deeply the control is wrapped
    ([`lib/field-context.js`](../src/ui/lib/field-context.js)). A `<label>`
    would open a Select's list when clicked; clicking the `<div>` focuses the
    trigger instead. For a SegmentedControl the `<div>` names the group, as a
    fieldset's legend does, and each segment keeps its own text as its name.
    `nativeLabel` on the Field sets the choice by hand.
- **Field wiring.** The help text and the error are in the control's
  `aria-describedby`, and an error sets `aria-invalid`. `invalid={false}`
  clears both, and hides the error. Say what is wrong and how to fix it.
- **Edges.** An empty checkbox's and an off switch's edge are `control-edge`,
  3:1 against the surface they sit on (WCAG 1.4.11), checked in CI.
- **Focus ring.** Every control keeps the base style's 2px `focus-ring`
  ([tailwind.css](../src/ui/tailwind.css)), and a test fails on any class in
  `src/ui/` that removes it (`outline-none`, `outline-hidden`, `outline-0`,
  `outline-transparent`, `outline-[0px]`, an arbitrary `[outline:none]`, each
  with or without a variant or `!`), or on a `style` prop that sets the
  outline. Inputs and the Select trigger draw it 1px out; tabs and a list's
  options draw it inset, clear of their neighbours.
- **Disabled.** Dimmed to 55 % with a not-allowed cursor, as the mock's locked
  toggle. A disabled button, input, switch, checkbox or segment leaves the
  keyboard order. A disabled option or tab stays in the arrow-key order,
  marked `aria-disabled`, so it can be found, and can't be chosen.
- **Icons** are Lucide in `currentColor`, hidden from assistive tech
  (`aria-hidden`). No emoji.

### Density and sizes

`data-density="compact"` on the root ([Switches](#switches)) is spacing: it
takes 8px off a row (`h-row`) and 4px off a panel's padding (`p-panel`), and
leaves every control at the mock's height, as the mock's own compact mode
does. Nothing is set per component.

| Control | Height, both densities | Utility |
| --- | --- | --- |
| Button (md), Input, Select trigger, Tab | 34px | `h-control` |
| Button (sm), a Select's option | 30px | `h-control-sm` |
| IconButton, md and sm | 34 and 30px | `size-control`, `size-control-sm` |
| A segment (its track adds 4px, to 34) | 30px | `h-segment` |
| Switch, Checkbox | 36 × 20, 16px | fixed |

### Class names

`cn` ([`src/ui/lib/utils.js`](../src/ui/lib/utils.js)) is the `cn` package
taught this theme: the type steps (`TYPE_STEPS`), the named spacing
(`SPACING`), the shadows (`SHADOWS`), the layers (`Z_INDEX`) and the motion's
duration and easing (`DURATIONS`, `EASES`). Stock, it read `text-body-sm` as a
colour, so a colour class beside it dropped the size; it never let a caller's
`h-9` replace `h-control`; and it kept both of `z-dialog z-toast`, leaving the
stylesheet's order to pick one. A caller's `className` wins over a component's
own classes. A new name in `tailwind.css`'s `@theme` block goes into those
lists too; `scripts/ui-stack.test.mjs` fails until it does.

Import `cn` from there, never from the `cn` package, `tailwind-merge` or
`clsx`: a test fails on any other in `src/ui/`. `npx shadcn add` writes
`import { cn } from 'cn'`; switch it to `./lib/utils.js`.

Keep class strings in `className`, `cn()`, `cva()` or a lookup object read by
key, where the empty-class check reads them (rule 4). The one exception is the
status components' `android` look ([Two looks](#two-looks)): it writes the
Android app's own class names, which compile to nothing here. The check lets
through only names the Android app's stylesheets style, or the block or element
whose modifiers they style, so a misspelt utility still fails.

### Where the components differ from the mock

- **Ghost sm buttons** are 30px, the sm height; the mock's row actions are
  28px. Their padding and radius are the mock's.
- **The off switch has an edge**, `control-edge`, which the mock's toggle
  lacks: without it the track is 1.2:1 against the page in light, under WCAG
  1.4.11's 3:1.
- **The segmented control is a radio group**; the mock marks its segments
  `aria-pressed` in a `group`. A radio group also says "one of", and its arrow
  keys choose.
- **One segmented look.** The Overview board's Cards / Table picker sits on
  `surface-2` with an edge; it uses the Settings board's `surface-3` track
  here.
- **The classes' intent, not a slip in the mock's stylesheet.** The mock's
  `.jh button, .jh input { font: inherit; color: inherit }` outranks its own
  `.jh-primary`, `.seg-off` and `.field`, so the boards draw light-theme
  primary buttons in dark text (3.05:1), unselected segments in `text-1`
  and text fields at 14px. The controls follow the classes and §5.2:
  `on-accent` (5.36:1), `text-2` and 13px. The mock's Phone board sets
  `on-accent` on its primary button inline, which confirms the intent.
- **Not in the mock, derived from its tokens:** the danger button, tabs, the
  Select's list, a drawn checkbox, and the error line.

## Status components

The status components (spec §5.4, #287), moved here from the Android app and
grown to the mock's, one file each in `src/ui/`, imported as `@ui/<file>`.
Each takes a `state` from the status model (`ok`, `warn`, `crit`, `unknown`,
`maintenance`, spec §6) or one of the Android app's severities (`healthy`,
`caution`, `critical`, `unknown`), which
[`lib/status.js`](../src/ui/lib/status.js) reads as a state. Anything else
reads as no signal: never green, never red.

| Component | Import | Props |
| --- | --- | --- |
| `StatusLamp` | `@ui/status-lamp` | `state`; `label`, its name (the state's word by default); `size`: `sm` (10px, the default), `lg` (14px) or px; `decorative` |
| `StatusWord` | `@ui/status-word` | `state`; `word` (the state's word by default) |
| `StatusBadge` | `@ui/status-word` | `state`; `word` |
| `IssueRow` | `@ui/issue-row` | `issue` (`{ state, word, title, where, reason, age }`); `onOpen` or `href` |
| `SubsystemStrip` | `@ui/subsystem-strip` | `cells` (`[{ key, label, state, word, value, sub }]`); `selected`, `onSelect` |
| `AttentionPanel` | `@ui/attention-panel` | `state`, `word`, `counts`, `subline`, `action`, `issues` (IssueRow's, each with an `id` and its `onOpen` or `href`), `filter` and `onClearFilter`, `meta`, `titleAs` (`h1` by default) |

Each also takes `look` ([Two looks](#two-looks)) and `className`. A state's word,
when none is given, is the mock's: OK, Warning, Critical, No signal,
Maintenance.

### How the status components look

From the mock's Overview board, and its Phone board where a component sits
narrower than 672px (`@2xl` of its own container, so it follows the column it
is in, not the window):

- **StatusLamp.** The mock's lamps, drawn as SVG in the state's `solid`: a
  filled disc for ok, a disc slashed from bottom left to top right for warn, a
  disc with a level bar for crit, a 2px hollow ring for no signal, and the
  Tokens board's wrench for maintenance. The slash and the bar are cut in
  `lamp-cut`, 2px wide at 10px and 2.5px from 14px. A lamp always draws its
  state's shape.
- **StatusWord.** Bold, in the state's `fg`, at the size around it and in the
  case it is given ("Down", "On battery").
- **StatusBadge.** The word and its lamp, 12px semibold, on the state's `tint`
  inside its `border`, 4px round and 20px tall.
- **IssueRow.** From 672px, the attention panel's row: the lamp, the word
  (13px), the title (semibold) over where (12px `text-3`), the reason in
  `text-2`, the age (12px `text-3`) and a chevron, in the mock's columns (18,
  96, 1.1fr, 2fr, 44 and 16px), at least 48px tall and padded by density.
  Narrower, the Phone board's: the lamp, "title · word" over the reason (13px),
  and the age, at least 56px tall. `row-hover` under the pointer.
- **SubsystemStrip.** The joined annunciator strip: tiles 1px apart, the gaps
  showing `border-subtle`, in one 12px-round frame. A tile is `surface-1`, or
  its state's tint when it isn't ok: a lamp and an overline label, over the
  value (`title-sm`) and `sub` (12px `text-3`). Six sit in a row from 672px,
  three from 320px and two below that, where a tile is the Phone board's: a
  14px value and no `sub`. With `onSelect` the tiles are toggles, `surface-2`
  under the pointer, the selected one inside a 1.5px accent edge.
- **AttentionPanel.** With issues, or in any state but ok and maintenance
  (which never make an issue, spec §6.1), the mock's attention panel: a 14px
  lamp beside the heading, at `headline` (24/30): the word in its colour, then
  " · " and the counts, semibold in `text-2`. The subline under it in `text-2`,
  at most 72 characters wide; the action at the top right; "Showing … only"
  and Clear when the list is filtered; then the issues as IssueRows. Otherwise
  the mock's quiet line: the lamp, "All systems normal" at `title-xs` in
  `text-1`, the counts in `text-2`, and `meta` at the right in 12px `text-3`.
  Healthy stays quiet (rule 3): no green word.

### Two looks

Until Phase 4 rebuilds the Android screens on `src/ui/`, each status
component draws one of two looks:

- `ui`: the above. The web's, and the default anywhere but the Android build.
- `android`: the Android app's own components as they were in
  `mobile/src/components/`: mono upper-case words, glass cards, the 2×2 strip
  and its lamp shapes (`disc`, `slash`, `ring` and the UPS's `bolt`, passed as
  `shape`). It writes the class names `MobileApp.css` styles in the `legacy`
  layer, and its colours are the app's own. The Android build defines
  `__ANDROID_LOOK__` (`mobile/vite.config.mobile.js`), and there every status
  component draws this look, so the app's screens look as they did (#287
  compared them pixel for pixel). Phase 4 deletes the define and this look.

Outside the Android build, `look="android"` on a component draws that look
for one use (its tests). The choice is a build constant
(`DEFAULT_LOOK` in [`lib/status.js`](../src/ui/lib/status.js)), so the
Android bundle carries none of the `ui` look's code, nor `cn`: its script
grows by 7.6 KB (2.9 KB compressed), not the 94 KB the `ui` look and its
packages would add. Keep a
component's two looks as two functions behind its one-line
`if (DEFAULT_LOOK === 'android' || look === 'android') return …`, which is
what lets the bundler drop the other.

### Accessibility of the status components

- **Never colour alone.** Every state is a shape, a word and a colour. A lamp
  is an image named by its word. Where the word is printed beside it
  (StatusBadge, IssueRow, the panel's heading) the lamp is `decorative`, so a
  screen reader doesn't say it twice. A subsystem tile prints no word, so its
  lamp keeps the name. A test checks that the five states draw five different
  shapes, each with a name.
- **Rows.** A row that opens something is a button (`onOpen`) or a link
  (`href`), named "title, word, where" and described by its reason and age; an
  abbreviated word is spelled out ("UNKN" is said as "unknown"). A row with
  nothing to open is plain content, so it neither looks nor announces as
  tappable (#279).
- **Strip and panel.** Selectable tiles are toggle buttons (`aria-pressed`).
  The strip is a region named "Subsystems"; the panel is one named "Needs
  attention", or "Status" when quiet, and its heading is the page's `h1`
  unless `titleAs` says otherwise.
- **Focus.** Rows and tiles draw the base style's focus ring inset, clear of
  their neighbours.

### Where the status components differ from the mock

- **The slash stops at the disc's edge.** The mock's 13px cut overhangs a
  10px lamp by 1.5px each side, which shows on a tinted row or tile as a
  surface-coloured tick.
- **The wrench is the lamp's size**, 10 or 14px, filling its box, so rows keep
  their columns. The mock draws it only on its Tokens board, at 16px beside
  10px discs.
- **The last issue row has no bottom edge**, which doubled the panel's own in
  the mock.
- **Type steps over the mock's sizes:** subsystem values are `title-sm`
  (16/22, the mock's 18/24) and the narrow tiles' `body` bold (14/20, the
  mock's 14/18), as the mapping under [Type](#type) says. The rows keep the
  mock's 20px lines for where and the reason, so they are its height.
- **A lamp beside its printed word is decorative.** The mock names every lamp,
  so a screen reader heard "Critical Critical".
- **One frame at every width.** The Phone board splits the status box from
  the issue list; the panel keeps one frame, with the phone's rows, and the
  Overview (Phase 1) lays out the phone screen.
- **Not in the mock, derived from it:** StatusBadge; a row as a link; the
  quiet line for maintenance (its wrench and word); strips of other than six
  tiles (four sit two by two when narrow, five in rows of three).

## Changing a token

Values come from the signed-off mock. A change Jag hasn't seen goes into the
mock first.

- Edit `tokens.css`. Every token has its default on `.jh-ui` (dark, violet,
  comfortable); the switches only override. Each accent sets the same eight
  roles in its dark and light blocks.
- A new accent goes into `src/ui/accents.js`, gets a dark and a light block in
  `tokens.css` (and its value in that file's header), and a row in the
  switches and accents tables above. A test fails until all of them agree, and
  the check fails if any of its colours sits within ΔE OK 0.05 of a status
  colour.
- A new typeface goes into `src/ui/typefaces.js`, its woff2 into `src/fonts/`
  with its licence in `src/fonts/licences/`, an `@font-face` into
  `src/ui/fonts.css`, a `data-typeface` block into `tokens.css` (and its id in
  that file's header), and a row in the switches and typefaces tables above.
  `scripts/fonts.test.mjs` fails until all of them agree with each other and
  with the file (its weights and style), and if the default face and the mono
  go over 60 KB.
- A new colour role needs a utility in `tailwind.css`'s `@theme` block, and its
  pairings in `PAIRINGS` in `scripts/ui-contrast.mjs`. A plausible pairing
  that fails and that the mock never draws goes in `FORBIDDEN` instead, and in
  rule 5 above. A new switch needs teaching to that script's reader, which
  refuses selectors it doesn't know.
- `node scripts/ui-contrast.mjs` must report nothing below its floor on either
  screen, no hover too close to its rest state, and no accent too close to a
  status.

Where the tokens differ from the mock, and why:

- **Three accents, not five.** The mock offers Violet, Indigo, Blue, Fuchsia
  and Graphite. Jag dropped Blue, Indigo and Graphite on 2026-10-19 because
  they read as status colours (rule 2), and added Cyan (hue 215, between ok's
  163 and maintenance's 254), which the mock doesn't have. Cyan's values were
  tuned to pass every floor on both screens and to stay off the status
  colours: its chroma is close to sRGB's limit, and every value is inside sRGB,
  so every screen paints it alike.
- **Hover on dark accents.** The mock lightens a primary button on hover. That
  took Fuchsia's label to 4.05:1, and violet's L 0.585 passed only on sRGB
  screens: clipping darkens it to 4.50:1, while a P3 screen shows it at 4.37:1.
  - Violet still lightens, to the lightest L that keeps 4.5:1 on both screens:
    0.575 (mock 0.585; 4.65:1 sRGB, 4.57:1 P3).
  - Fuchsia darkens instead, to L 0.52 (mock 0.6). The lightest hover that
    kept 4.5:1 sat only ΔE OK 0.014 from rest, a hover nobody could see;
    darkened, it is 0.041 from rest at 5.69:1. Cyan darkens in both themes, and
    the light theme already darkens every hover.
- **Radii off the scale.** The mock draws four radii that aren't on it. They map
  onto the scale: 5px (kbd) to `rounded-sm` 4; 7px (28px icon chips) and 9px
  (the helm mark) to `rounded-lg` 8; 10px (phone touch targets and inputs) to
  `rounded-lg` 8, as every control.
- **Tokens the mock didn't draw** are derived from it: `text-disabled`; `tint`
  for ok, maintenance and info (10 %); every status `border` (solid at 38 % dark,
  32 % light, as the accent's); every `on-solid`; `info`, which shares
  maintenance's blue.
