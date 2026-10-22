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
  screens, each accent's hover against its rest state, each accent against
  the status colours, and the chart colours ([Chart colours](#chart-colours)),
  in `npm test`. Run `node scripts/ui-contrast.mjs` to see the lowest ratio per
  rule on each screen, each accent's nearest status, and the chart colours'
  closest calls.
- **Components:** the controls (#285), the containers (#286), the status
  components (#287) and the data components (#288) in `src/ui/` are listed
  under [Components](#components), [Containers](#containers),
  [Status components](#status-components) and
  [Data components](#data-components), with their variants, sizes and keyboard
  use; the shell (#296), the Overview's sections (#299), the sign-in page
  (#305) and the utilities (#301) are built on them ([Shell](#shell),
  [Overview sections](#overview-sections), [Sign-in](#sign-in),
  [Utilities](#utilities)). The Android app's screens use the status
  components, in its own look.
- **Gallery:** every state of every component above, in both themes and both
  densities and, where colour follows the accent, all three accents, on one
  development page ([GALLERY.md](GALLERY.md), #289). CI screenshots each
  against its committed baseline and runs axe on it, in both themes, and fails
  on any violation or unapproved change.
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
   its threshold, to `warn-solid` or `crit-solid`. A status colour never draws
   a chart series, and a series colour never means a state
   ([Chart colours](#chart-colours)).
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
7. **Panels are flat.** Only what floats over the page casts a shadow
   (`shadow-pop`): popovers, tooltips, toasts, the command palette, dialogs
   and drawers, over a scrim (`bg-scrim`) when modal, and over a lighter one
   (`bg-scrim-nested`) when opened from another modal.

## Switches

Set on the element that carries `jh-ui`, and on every portal root (dialogs,
popovers and menus render outside their parent):

| Attribute | Values | Default |
| --- | --- | --- |
| `data-theme` | `light` | dark |
| `data-accent` | `fuchsia`, `cyan` | violet |
| `data-density` | `compact` | comfortable |
| `data-typeface` | `plus-jakarta-sans`, `montserrat` | manrope |

Roots can nest, in any theme: each carries its own tokens, so a light root
inside a dark one is light. The `dark:` variant applies inside any root
without `data-theme="light"`, so it can't tell such a root from its dark
parent; `src/ui/` doesn't use it, and `scripts/ui-stack.test.mjs` fails if a
class does. "System" (follow the device) is the app's job, not a switch's: it
sets `data-theme` from `prefers-color-scheme` (below).

**Themes** (#304, spec §2). JagHelm has two, dark and light, and a third
choice, system, which shows whichever the device asks for and changes with it,
live. One accent, violet; Fuchsia and Cyan come with Settings → Appearance's
picker (#321). [`src/shell/theme.js`](../src/shell/theme.js) holds the choice
(`useTheme`) and gives the shell's roots the theme shown; today's stylesheet
draws its views in the same two (`src/styles/global.css`, on these tokens'
values), so the page and the chrome match. The header's toggle switches dark
and light; Settings → Appearance and the command palette offer all three. The
ten themes before #304 are gone: a browser that saved one opens in dark or
light by what it drew ([ARCHITECTURE.md](ARCHITECTURE.md), "Design system").
`scripts/themes.test.mjs` fails if a third theme block or `#6366f1`, the old
indigo, comes back.

A screen's root is a `UiRoot` ([`src/ui/root.jsx`](../src/ui/root.jsx),
#286): `<UiRoot theme="light" density="compact">` renders the `.jh-ui`
element with those attributes (a default sets none) and gives the same
switches to everything portalled from the screen. It also holds the screen's
toasts and the tooltips' shared timing. A UiRoot inside another (a gallery of
states in both themes) shares the outer one's toasts and tooltip timing, and a
page has one toast viewport however many roots it holds
([Containers](#containers)).

Portalled content gets its root from
[`src/ui/lib/portal.js`](../src/ui/lib/portal.js). The portal element gets
`jh-ui` and each switch (`ROOT_SWITCHES`), taken from, in order:

1. the UiRoot around it, read again whenever its switches change. This
   covers an overlay opened from inside another (a Select in a dialog, a
   Confirm from a drawer), whose control sits in its parent's portal root,
   which may not have taken the change yet; a toast, which has no control;
   and a dialog opened from code;
2. with no UiRoot, the `.jh-ui` root around the control that opened it (a
   Select's trigger, a dialog's or popover's trigger), read when the control
   mounts and when the popup opens;
3. with neither, nothing: a bare `.jh-ui` root, dark and comfortable.

An open overlay, nested or not, follows a switch the screen changes. A new
switch goes into `SWITCHES` in `portal.js` as well as `tokens.css`;
`scripts/ui-stack.test.mjs` fails until both list it, and when a Base UI
portal in `src/ui/` isn't given the portal root's props (`{...portalRoot}`),
or gets a class, a container, a switch or another spread after them. Screens
import the components, never `@base-ui/react` itself (the same file checks).

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
| `series-1` to `series-6` | 3:1 | bg, surface-1, surface-2 | row-hover over surface-1 |
| `series-1` alone (a single series) | 3:1 | the same | the same; each status tint over surface-1; accent-tint over bg and surface-1 (a selected row) |

`control-edge` is the edge of a control with no fill of its own, an empty
checkbox or an off switch. WCAG 1.4.11 asks 3:1 of the boundary that shows
where a control is; `border-strong` (1.4:1 to 1.5:1) and `surface-3` on the page
(1.2:1 in light) are too faint for it. Its worst case is 3.77:1 (light, in a
hovered row on the page).

The `series` slots are a chart's lines, bars and legend swatches: WCAG 1.4.11's
3:1 for a graphical object. They are never words. The ramp has its own check
([Chart colours](#chart-colours)): its first steps recede by design.

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
cut into warn and crit lamps, the panel colour), `scrim`, `scrim-nested` (the
scrim of a modal opened from another, half as strong, so the one under it
reads as dimmed and the page under both never goes near black; derived from
`scrim` in `tailwind.css`, so it has no `--jh-` token of its own),
`switch-thumb` (a switch's thumb, white in both themes, as the mock's), and
the shadows below.

### Type

**Faces.** Self-hosted, never from a CDN or Google Fonts (#244, #284). Each is
two variable files, the latin and latin-ext subsets Google Fonts serves (#394),
under the SIL Open Font License 1.1; the files and their licences are in
`src/fonts/`. `data-typeface` picks the sans face (Settings → Appearance, #321);
there is one monospace face.

| Face | `data-typeface` | Weights | Use |
| --- | --- | --- | --- |
| Manrope (default) | none | 200–800 | all text: `font-sans`, which the root sets |
| Plus Jakarta Sans | `plus-jakarta-sans` | 200–800 | all text, when picked |
| Montserrat | `montserrat` | 100–900 | all text, when picked (Arcane's face: offered, never the default) |
| JetBrains Mono | none | 400–800 | hostnames, SHAs, paths and code only: `font-mono`, and `code`, `kbd`, `samp` and `pre` |

- **Only what a screen uses downloads.** A browser fetches a face when text
  renders in it: the picked sans face, and JetBrains Mono once a screen shows
  mono text. Nothing is preloaded, so a face nobody picked never downloads.
  `font-display: swap` shows the system face until the file arrives.
- **latin-ext only when the text needs it.** Each face's two `@font-face` rules
  carry Google's `unicode-range`, so its latin-ext file downloads only once a
  screen shows one of that subset's characters, such as the Ł and ź of a node
  named Łódź, and the whole word then draws in the face. The latin-ext files are
  Manrope 14.8 KB, Plus Jakarta Sans 21.2 KB, Montserrat 69.0 KB and JetBrains
  Mono 11.4 KB. Characters outside both subsets (Cyrillic, Greek, Vietnamese)
  use the system face.
- **Budget: fonts on first load ≤ 60 KB** for the default setup on latin text,
  which downloads no latin-ext file. Manrope (24.3 KB) and JetBrains Mono
  (30.7 KB) come to 55.0 KB, 57.1 KB on the wire with JagHelm's response
  headers, and a test fails when the files pass 60 KB. Plus Jakarta Sans is
  26.7 KB and Montserrat 37.1 KB. Until Phase 1 replaces them, today's screens
  load their own three files first (98.3 KB, the same files Google Fonts served
  them); the new UI shares JetBrains Mono's latin file.
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
  segment), `shadow-pop` (popovers, tooltips, toasts, palette, dialogs,
  drawers), `shadow-thumb`
  (a switch's thumb, the mock's `0 1px 2px` at 30 % black in both themes),
  `bg-scrim`, `bg-scrim-nested`.
- **Z-index:** `z-sticky` 20, `z-header` 40, `z-overlay` 50 (unused so far),
  `z-dialog` 60 (popups and their scrims), `z-toast` 80. The scrims share
  `z-dialog` with the popups, so a later overlay stacks above an earlier one:
  a modal opened from another portals after its parent's popup, and its scrim
  covers it.
- **Motion:** 150ms `ease` (`transition-*`, `duration-standard`,
  `ease-standard`) for drawers and popovers; animate bars only. With reduced
  motion asked for, transitions and animations are cut to nothing: the base
  style sets them to 0.01ms with `!important` inside every `.jh-ui` root,
  portals included, which even a utility's `!important` can't beat. No class
  in `src/ui/` sets a duration, delay, easing or keyframe animation of its
  own (`scripts/ui-stack.test.mjs`).

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

## Chart colours

Six categorical colours and one sequential ramp, for every chart (#386). Jag
signed them off on 2026-10-20 on the mock's Chart colours board. They are roles
in `tokens.css`, in dark and light, and they never change with the accent. The
Sparkline (#288, [Data components](#data-components)) draws slot 1; no screen
uses it yet, and the history charts (#311) will draw the rest.

| Slot | Name | Token | Dark | Light |
| --- | --- | --- | --- | --- |
| 1 | Azure | `series-1` | `oklch(0.6 0.138 240)` | `oklch(0.58 0.133 240)` |
| 2 | Rose | `series-2` | `oklch(0.64 0.15 355)` | `oklch(0.5 0.15 355)` |
| 3 | Lime | `series-3` | `oklch(0.66 0.15 125)` | `oklch(0.56 0.141 125)` |
| 4 | Plum | `series-4` | `oklch(0.55 0.15 325)` | `oklch(0.6 0.15 325)` |
| 5 | Orange | `series-5` | `oklch(0.66 0.15 55)` | `oklch(0.6 0.149 55)` |
| 6 | Teal | `series-6` | `oklch(0.66 0.112 200)` | `oklch(0.62 0.105 200)` |

Utilities: `stroke-series-1` for a line, `fill-series-1` for a bar or an area,
`bg-series-1` for a legend's swatch, and `text-series-1` for an SVG drawn in
`currentColor`, through `series-6`. Never for words: see the legend rule below.

- **In this order.** A chart takes the slots in order, 1 first. The order
  keeps neighbours apart for protanopia, deuteranopia and normal vision, so a
  slot is never skipped for taste.
- **Colour follows the entity.** A chart that draws one series by design, such
  as a sparkline, uses slot 1, azure. A chart of several gives each entity (a
  node, a disk, a service) its slot in a stable order, the order the entities
  are configured in, and the entity keeps it: when the chart is sorted, when a
  filter hides the others, and from chart to chart on a screen. Colour never
  follows a series' rank or what a filter left.
- **How many.** A line or stacked chart, where only neighbouring slots touch,
  can show all six. A scatter, a map or a small multiple, where any two can
  meet, shows at most three, slots 1 to 3, which stay apart in every pair, and
  folds the rest into one Other series. A line chart of more than six folds
  the rest the same way. Other is drawn in a neutral, never a slot or a status
  colour; it has no token yet.
- **Status is never a series, and a series never means a state.** Ok, warn,
  crit, no signal, maintenance and info never draw a series. A series keeps
  its slot when its value crosses a threshold: the state shows in the status
  components, never by recolouring the series. Every slot sits at least ΔE 8.5
  from every status lamp, bar and word (the gates below).
- **Legend and labels.** Two or more series always get a legend. Up to four
  also get direct labels, at a line's end or on its bar, so the eye needn't
  go back and forth. Labels and legend entries are words in `text-text-1` or
  `text-text-2` beside the series' swatch, never in the series colour: the
  slots are checked at 3:1 for a graphic, not 4.5:1 for text (rule 5).
- **Where they're drawn, and only there.** A chart of several series sits on
  the page (`bg`), a panel (`surface-1`), `surface-2` (a hovered tile, a
  chart's tooltip) or a hovered row (`row-hover` over `surface-1`), and
  nowhere else. Each slot is at least 3:1 (WCAG 1.4.11, a graphical object) on
  each, in both themes and every accent. The dimmest are dark plum (3.46:1 on a
  panel, 3.15:1 on `surface-2`) and light teal (3.48:1 and 3.11:1).
- **A single series also sits on tints.** Slot 1 alone, such as a sparkline
  inside a row or a tile, may also sit on each status tint over a panel (a
  warn-tinted tile: `ok-tint` to `info-tint` over `surface-1`) and in a
  selected row (`accent-tint` over `bg` or `surface-1`). It clears 3:1 on each
  in both themes and every accent, 3.47:1 at worst (a selected row on the
  light page). Slots 2 to 6 never sit on a status tint or in a selected row:
  dark plum falls to 2.86:1 on a warn tint and light teal to 2.86:1 in a
  selected row.
- **Never on `surface-3`** (a chip, a track), whatever the series: dark plum
  falls to 2.73:1 there and light teal to 2.82:1.

**The sequential ramp** is azure, slot 1's hue (240), in seven steps from none
to most. On the dark panel it lightens step by step, on the light one it
deepens. The sign-off lists it in hex; `tokens.css` writes each step in OKLCH at
hue 240 that paints that hex on an sRGB screen, clipped or gamut-mapped, and a
test checks each one.

| Step | Token | Dark | Light |
| --- | --- | --- | --- |
| 1 | `seq-1` | `oklch(0.3 0.07 240)` #00314d | `oklch(0.92 0.043 240)` #cce9ff |
| 2 | `seq-2` | `oklch(0.38 0.087 240)` #00476c | `oklch(0.84 0.08 240)` #9bd2fa |
| 3 | `seq-3` | `oklch(0.459 0.105 240)` #005e8c | `oklch(0.76 0.11 240)` #6bbaf0 |
| 4 | `seq-4` | `oklch(0.54 0.124 240)` #0076af | `oklch(0.68 0.135 240)` #36a2e3 |
| 5 | `seq-5` | `oklch(0.63 0.11 240)` #4191c5 | `oklch(0.6 0.138 240)` #0089c9 |
| 6 | `seq-6` | `oklch(0.72 0.08 240)` #75acd2 | `oklch(0.511 0.117 240)` #006da2 |
| 7 | `seq-7` | `oklch(0.81 0.05 240)` #a4c6de | `oklch(0.42 0.096 240)` #00537c |

- **Sequential magnitude only:** one quantity from none to most, such as a
  heatmap's cells. Never for categories or series: neighbouring steps are one
  hue, told apart by lightness alone.
- **The first steps recede** toward the panel, as a scale's "none" end should,
  so the ramp is not held to 3:1. It is drawn on panels (`surface-1`).
- **As an ordinal scale** (tiers, stages), start at step 3: 2.58:1 on a dark
  panel, 2.12:1 on a light one.
- **Checked:** every step further from `surface-1`'s lightness than the one
  before, by at least 0.06 (OKLCH L, as written), all at slot 1's hue, and
  step 3 at least 2:1 on `surface-1` (`checkRamp` in `scripts/ui-contrast.mjs`).
  Utilities: `fill-seq-1` to `fill-seq-7`, and `bg-`, `stroke-` and `text-` as
  for the slots.

**With Fuchsia and Cyan.** The slots avoid Violet, the default: every slot is
at least ΔE 12 from each violet mark (the button at rest and hovered, a link,
the meter, the focus ring). Fuchsia and Cyan sit nearer. With Fuchsia the slot
nearest the accent is plum (ΔE 8.1 dark, 9.9 light); with Cyan it is azure
(10.5 dark, 8.7 light). Charts never draw the accent inside the plot: no line,
bar, selection or highlight in it. So nothing changes per accent. The accents'
other marks come closer still: Cyan's dark focus ring is ΔE 2.9 from teal, and
its light meter 5.6; Fuchsia's dark hover is 7.6 from plum, and its light meter
5.9. A focus ring goes around a chart, never on a series, and a meter is never
drawn inside a plot. `node scripts/ui-contrast.mjs` prints these.

**Beside a meter, slot 1 only** (#288). A strip, row or card that holds a
meter draws its chart as a Sparkline, which is always slot 1, so a teal or
plum series never sits beside an accent-coloured meter: teal is ΔE 5.0 from
Cyan's dark meter and 5.6 from its light one, plum 5.9 from Fuchsia's light
meter. A chart of several series sits apart from meters, in its own panel or
the drawer's chart. Slot 1 itself is ΔE 11.5 or more from every accent's
meter but one: Cyan's light meter, 6.0 (violet's are 17.1 and 18.3). There a
meter and a sparkline are told apart by shape and place (a bar with a label
over it, a line), and the line is never drawn in the meter's colour.

**The gates that hold the slots**, which `checkChartPalette` in
`scripts/ui-contrast.mjs` enforces in `npm test` (`scripts/chart-palette.test.mjs`),
in both themes. The separation, chroma and lightness gates are the checks the
sign-off ran. The status and violet floors are set here, under the margins
the sign-off measured (8.8 from the nearest status colour, 16 from the violet
fill); the violet gate measures every violet mark, not only the fill. ΔE is
OKLab distance ×100 between the colours a screen paints, rounded down.
Protanopia and deuteranopia are simulated with Machado, Oliveira and Fernandes
(2009) at severity 1.0, on linear sRGB, clamped:

| Gate | Check | Floor | Worst |
| --- | --- | --- | --- |
| `adjacent-cvd` | neighbouring slots, protanopia and deuteranopia | 8 | 8.8, azure to rose (dark, protan) |
| `adjacent` | neighbouring slots, normal vision | 15 | 21.1, plum to orange (light) |
| `first-three-cvd` | slots 1 to 3, every pair, both CVDs | 8 | 8.8, azure to rose (dark, protan) |
| `first-three` | slots 1 to 3, every pair, normal vision | 15 | 23.1, azure to lime (light) |
| `status` | every slot to every status lamp, bar and word | 8.5 | 8.8, teal to the ok lamp (light) |
| `violet` | every slot to every violet mark | 12 | 13.1, plum to the meter (light) |
| `chroma` | every slot's OKLCH chroma, as written | 0.1 | 0.105, teal (light) |
| `lightness` | every slot's OKLCH L, as written, inside its theme's band | 0.48–0.67 dark, 0.43–0.77 light | L 0.66, lime, orange and teal (dark, 0.01 under the top) |

Trade-offs taken at sign-off:

- Only about six hue families are left once red, amber, green, blue and violet
  are reserved. Gold separated better but read as a warning beside amber, so it
  was dropped.
- Rose and plum are split by lightness rather than hue, so they stay apart
  where their lines cross.
- Dark plum is the dimmest slot and light lime leans olive. Both pass; they are
  the first to nudge if they look off.

## Components

The controls (spec §5.4, #285), one file each in `src/ui/`, imported as
`@ui/<file>`. Each is a Base UI primitive, which brings the focus handling,
the keys and the ARIA, drawn from the role tokens in the signed-off mock's
shapes. The [shell](#shell) uses them; the [gallery](GALLERY.md) (#289) shows
every state.

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
  edge is `border-crit-border`. A date Input (#301) is the same field: empty,
  its day, month and year are `text-3`, as a placeholder; the browser's
  calendar button is dimmed to 55%, full under the pointer.
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

`cn` ([`src/ui/lib/utils.js`](../src/ui/lib/utils.js)) is clsx's join and
tailwind-merge's merge, taught this theme (the `cn` package's engine until
#444, which merged every pair of these classes the same in twice the bytes):
the type steps (`TYPE_STEPS`), the named spacing
(`SPACING`), the shadows (`SHADOWS`), the layers (`Z_INDEX`) and the motion's
duration and easing (`DURATIONS`, `EASES`). Stock, it read `text-body-sm` as a
colour, so a colour class beside it dropped the size; it never let a caller's
`h-9` replace `h-control`; and it kept both of `z-dialog z-toast`, leaving the
stylesheet's order to pick one. A caller's `className` wins over a component's
own classes. A new name in `tailwind.css`'s `@theme` block goes into those
lists too; `scripts/ui-stack.test.mjs` fails until it does.

Import `cn` from there, never from `tailwind-merge`, `clsx` or the `cn`
package: a test fails on any other in `src/ui/`. `npx shadcn add` writes
`import { cn } from 'cn'`; switch it to `./lib/utils.js`.

Keep class strings in `className`, `cn()`, `cva()` or a lookup object read by
key, where the empty-class check reads them (rule 4). The one exception is the
status components' `android` look ([Two looks](#two-looks)), a stopgap until
#326: it writes the Android app's own class names, which compile to nothing
here. The check lets such a name through only in the five status component
files, only as one of the blocks they write (`status-lamp`, `status-word`,
`issue-row`, `subsystem-cell`, `subsys-strip`, `sys-status-card`) or an element
of one (`sys-status-card__word`), and only when the Android app's stylesheets
style it or its modifiers. A misspelt utility still fails, and so does an
Android class name anywhere else: `chip`, `secondary` or `note` on a web
component, which the Android stylesheets also style, would do nothing on the
web.

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

## Containers

The containers and feedback components (spec §5.4, #286), one file each in
`src/ui/`, imported as `@ui/<file>`. The overlays are Base UI primitives,
which bring the focus handling, the keys and the ARIA; the rest are plain
elements on the role tokens. The [shell](#shell) uses some (Drawer, Tooltip,
Banner, Skeleton); the [gallery](GALLERY.md) (#289) shows every state.

| Component | Import | Base UI part | Props | Keys |
| --- | --- | --- | --- | --- |
| `UiRoot` | `@ui/root` | Toast and Tooltip providers (the outermost root's) | `theme`, `accent`, `density`, `typeface` ([Switches](#switches)), `toastManager` | none |
| `Panel` | `@ui/panel` | none | `title`, `description`, `icon`, `actions`, `flush`, `titleAs` (`h2`) | none |
| `Dialog`, `DialogClose` | `@ui/dialog` | Dialog | `trigger` or `open` and `onOpenChange`, `title` (or `aria-label`), `description`, `footer`, `size` (`sm` 440, `md` 540, `lg` 600), `closeLabel`, `initialFocus`, `finalFocus` | Tab and Shift+Tab stay inside; Escape closes the top one |
| `Drawer`, `DrawerClose` | `@ui/drawer` | Dialog, at the edge | `trigger` or `open` and `onOpenChange`, `eyebrow`, `title` (or `aria-label`), `description`, `closeLabel` | as the Dialog |
| `Confirm` | `@ui/confirm` | AlertDialog | `trigger` or `open` and `onOpenChange`, `title` (required), `name` (required), `detail`, `description`, `confirmLabel`, `cancelLabel`, `destructive`, `value`, `onConfirm(value)`, `onCancel` | as the Dialog; Escape cancels |
| `Popover`, `PopoverClose` | `@ui/popover` | Popover | `trigger`, `title` (or `aria-label`; else its trigger names it), `description`, `side` (`bottom`), `align`, `openOnHover`, `open` and `onOpenChange` | Escape closes |
| `Tooltip` | `@ui/tooltip` | Tooltip | `content`, `side` (`top`), `align`, `delay`, `closeDelay`; the trigger is its child | focus opens it; Escape closes |
| `useToast`, `createToastManager` | `@ui/toast` | Toast | `add({ title, description, tone, action: { label, onClick }, timeout, id })`, `update`, `close`, `promise` | F6 reaches the toasts |
| `Banner` | `@ui/banner` | none | `tone` (`crit` by default, `warn`, `unknown`, `maintenance`, `info`, `ok`), `title`, `cause`, `detail`, `action`, `icon` | none |
| `EmptyState` | `@ui/empty-state` | none | `icon`, `title`, `description`, `action`, `size` (`md`, `sm`) | none |
| `Skeleton` | `@ui/skeleton` | none | `className` (its size and shape) | none |

### How each looks

From the mock's Overview, Settings and Phone boards:

- **Panel.** The mock's attention panel, utility cards and Settings sections:
  `bg-surface-1` in a `border-border` edge, `rounded-xl` (12px), flat, padded
  by the density (`p-panel`, 20 or 16px). The header is the mock's: an icon
  in its 28px accent chip (`accent-tint`, `accent-text`, an `accent-border`
  ring), the title at `title-xs` (15px bold), a `text-3` caption, actions at
  the end. `flush` lays rows edge to edge under a subtle rule, as the Settings
  lists.
- **Dialog.** The command palette's frame, the mock's one modal: `surface-1`
  in a `border-strong` edge, 12px radius, `shadow-pop` over `bg-scrim`, 96px
  from the top, centred, never wider than the screen less 16px a side. Its
  content is laid out as the "won't open inside JagHelm" card: 24px of
  padding, the title at `title` (20/26), the description in `text-2`, 12px
  apart, the actions in a row under them with the main one first, as the mock
  orders its buttons. A ghost close button sits beside the title.
- **Drawer.** The mock's detail drawer: the full height on the right, 460px
  (the whole screen on a phone), `surface-1` with a subtle left edge and
  `shadow-pop` over the scrim. Its header is the mock's 110px: an overline,
  the title at `title`, a 13px `text-3` line, a ghost close button (34px,
  flush with the header's padding), a subtle rule; the body has 20px of
  padding and 20px between sections, in both densities.
- **A modal opened from another** (a Confirm from a Drawer): over its own
  scrim, `bg-scrim-nested`, half the scrim's strength, so the drawer under it
  reads as dimmed and the page under both stays short of black.
- **Confirm.** The Dialog at 440px. Under the question, the thing it acts on,
  by its display name (`name`, semibold `text-1`) and `detail` (12px
  `text-3`), quoted on `surface-2` with no edge and an 8px radius (the
  Settings device row's anatomy), so it never reads as a field to type in,
  then what will happen.
- **Popover.** The mock's floating card (the "shows here" note over an app):
  `surface-2` in a `border-strong` edge, 12px radius, `shadow-pop`, 14px by
  18px of padding, an optional bold title over 13px `text-2`. It opens 6px from
  its trigger, below it by default, at most 460px wide.
- **Tooltip.** The mock has none (its notes are `title` attributes); it takes
  the popover's surface smaller: `surface-2`, `border-strong`, `rounded-md`,
  4px by 8px of padding, 12px `text-1`, `shadow-pop`, 6px above its trigger.
- **Toast.** The mock has none; the floating card's frame (`surface-2`,
  `border-strong`, 12px radius, `shadow-pop`), 360px wide at the bottom
  right, inset by the page gutter, the newest nearest the corner; on a phone
  they span the screen less the gutter. A title (semibold), a description in
  `text-2`, an action as an accent ghost button, a dismiss button.
- **Banner.** The mock's status box at the top of the detail drawer: the
  tone's icon, the title bold in the tone's word colour (`text-crit-fg`), the
  cause in `text-2`, the detail in 12px `text-3`, on the tone's tint
  (`bg-crit-tint`) in a subtle edge, 14px of padding, 12px radius. Ok has no
  tint: healthy stays quiet. Put it on the page or a panel (`bg`,
  `surface-1`), where its colours are checked.
- **EmptyState.** Centred: an icon in the Settings board's 32px chip
  (`surface-3`, `text-1`), the title at `title-xs`, the description in 13px
  `text-2`, the action under them. At `sm` it is the command palette's
  "Nothing matches" line: 13px `text-3`, 16px by 10px of padding.
- **Skeleton.** The mock's `.skel`: `surface-3`, a 6px radius, sized by the
  caller. Still: no shimmer or pulse.

### Tones

A Banner's and a toast's `tone` shows as the tone's StatusLamp, 14px and
decorative ([`lib/tone.jsx`](../src/ui/lib/tone.jsx)), so status never rests
on colour (rule 3): a filled disc for ok, a slashed disc for warn, a disc with
a bar for crit, a hollow ring for no signal (`unknown`), a wrench for
maintenance. Info, which is not a state, shows Lucide's Info at the same 14px
in its word colour (`fg`), so every title starts at the same place. The icon
sits centred on the title's first line. On a tinted Banner the slash and the
bar show in `lamp-cut`, as on the strip's tinted tiles. A toast with no tone
is neutral and shows none.

### Decisions

- **A destructive Confirm keeps danger quiet.** The confirm button is the
  `danger` button, red text and a red edge, never a red fill, which is a
  status (rule 3, #285). It still leads: it comes first, and Cancel is a
  `ghost` button, the quietest there is. Focus starts on Cancel, so Enter
  alone never destroys anything. A Confirm that destroys nothing confirms
  with the `primary` button, and focus starts on it.
- **Display names, never storage keys.** A Confirm names what it acts on by
  `name`, the name the person knows ("Pixel 8", "Immich"), and without one it
  throws in development and logs in production. The key the screen needs
  travels as `value`: `onConfirm` gets it back, and it is never rendered.
- **Cause-naming banners.** A Banner says what failed (`title`) and why
  (`cause`), naming the thing to go and check, as today's degraded banners
  ("Live metrics unavailable", "Prometheus unreachable"). In a failing tone
  (`crit`, `warn`, `unknown`) a missing cause throws in development and logs
  in production.
- **Portal roots come from the screen.** See [Switches](#switches): the
  UiRoot's switches, else the root around the opener, so a toast, a dialog
  opened from code and an overlay opened from another overlay all match the
  screen in light and compact, and follow it when it changes.
- **A modal opened from another stacks above it.** Base UI draws no scrim for
  a nested dialog unless told to; here each has its own, on the popups'
  layer, so a Confirm opened from a Drawer covers the drawer. The drawer is
  `inert` until the Confirm closes: a click where it shows lands on the
  Confirm's scrim, and only the Confirm's buttons or Escape answer it. The
  nested scrim is half as strong, so the page under both isn't dimmed twice
  to near black.
- **One toast viewport per page.** The first UiRoot at the top of the page
  renders it, in its switches, and it shows every root's toasts: a nested
  root uses the outer one's, and a manager several roots share shows each
  toast once. Several viewports would stack in the same corner and repeat the
  "Notifications" landmark, which axe fails.
- **The Drawer is a Dialog at the edge.** Base UI's Drawer adds swipe
  gestures and snap points, which the mock doesn't have; Base UI's advice for
  a drawer without them is a positioned Dialog.

### The floating layer

The overlays' Base UI parts (Tooltip, Popover, Select, Dialog, Drawer,
Confirm, and the Sparkline's readout) are one chunk,
[`src/ui/floating/`](../src/ui/floating/layer.js), which
[`lib/floating.jsx`](../src/ui/lib/floating.jsx) loads once for all of them,
on the page's first pointer or keyboard input, or at once when one is opened
from code or a Select mounts (#444). The first screen draws none of them, so
the first load leaves them out. Until the layer is in, each component draws
its trigger itself, as Base UI would: the caller's element with the closed
popup's ARIA (`aria-haspopup`, `aria-expanded="false"`, a Tooltip's
description), and the Select's own trigger, named and described by its Field.
When it arrives, Base UI draws the trigger anew, except one that has focus
or is being pressed: it waits until focus leaves it or the click is done, so
focus never moves and a screen reader never hears it twice (a tooltip
focused before then shows on its next focus). One clicked, or given Enter,
Space or a Select's arrow, opens its popup through Base UI, focus going in as
on any open. The API is the same either way.

A new floating component joins it in four steps:

1. Its Base UI part goes in `src/ui/floating/<name>.jsx`. It takes the
   trigger's id and `handoff`, gives its Root a handle
   (`createHandle()`), and calls `useHandoff(handoff, triggerRef, open)`
   (`floating/handoff.js`), `open` opening it through Base UI as its trigger
   would (`handle.open(triggerId)`).
2. `floating/layer.js` exports it.
3. `src/ui/<name>.jsx` keeps the component's API and documents it. It calls
   `useFloatingTrigger({ now })` (`now` true when `open` or `defaultOpen` asks
   for it) and renders the layer's part once `layer` is in, else
   `light(trigger, ariaOfTheClosedPopup)`; a popup with no trigger of its own
   calls `useFloatingLayer(open)` and renders nothing until then. It never
   imports from `floating/`, which would put the layer in the first load
   (`scripts/lazy-views.test.mjs` fails).
4. `src/ui/floating.test.jsx` opens it from the keyboard before the layer is
   in, and checks focus and its ARIA once it is.

### Accessibility

- **Modal overlays** (Dialog, Drawer, Confirm) move focus inside when they
  open (the first control; a destructive Confirm's Cancel), keep it there
  (Tab and Shift+Tab cycle), hide the page from screen readers and stop it
  scrolling, and give focus back to whatever opened them, a trigger or the
  control that set `open`. Escape closes them, the top one first; a click on
  the scrim closes a Dialog or Drawer, never a Confirm, which only its buttons
  or Escape (a cancel) close. One opened from another makes the one under it
  `inert` until it closes. Each is named by its title and described by its
  description; a Dialog or Drawer without a title takes an `aria-label`, and
  with neither it throws in development and logs in production, as a Confirm
  without its title does.
- **A Popover** is a non-modal dialog named by its title: focus moves in,
  Escape or a click outside closes it, and focus goes back to its trigger.
  `openOnHover` makes it an infotip, which a tooltip must not be: help that
  matters can't live in a tooltip. Without a title it is named by an
  `aria-label`, or else by its trigger, so it is never unnamed.
- **A Tooltip** opens on keyboard focus as well as under the pointer, and
  never on touch. The trigger keeps its own name (an `aria-label`, an
  IconButton's `label`, a Button's text); when the tooltip says more, the
  trigger is described by it (`aria-describedby`, a hidden copy that is
  always there), so a screen reader hears it without opening it. The copies
  sit in one hidden element in `<body>`, never beside the trigger,
  where they would break the row's `:last-child` and `+` selectors and a
  list's or a table's markup. The popup itself is hidden from assistive tech
  (`aria-hidden`): it only repeats the name or the description, and would
  otherwise sit at the end of `<body>` outside every landmark (#289).
- **Toasts** are announced: the viewport is a polite live region and a
  landmark named "Notifications", there before the first toast, and F6 jumps
  to it. A `crit` toast is announced as an alert and stays until dismissed,
  whether it was added so, `update`d to crit, or is a failed `promise` (an
  error is crit unless it names a tone; a success is ok); the others go
  after 5 seconds, a timer that pauses under the pointer or focus, and an
  update away from crit makes a toast polite again. Each keeps its tone's
  icon through updates and promises. A toast added while the screen mounts
  still shows; give one added from an effect an `id`, or React's StrictMode,
  which runs effects twice in development, shows it twice. A manager's toasts
  sent while no UiRoot listens (a legacy screen) wait for one, but one that
  isn't crit and is older than its timeout is dropped rather than shown late.
  A page has one viewport, so one "Notifications" landmark, however many
  UiRoots it holds.
- **A Banner is not a live region**: the same cause can show on several
  panels, so the screen announces each cause once, from one place, as today's
  dashboard does. `role="alert"` on a banner that stands alone.
- **Skeletons** are `aria-hidden`; the region holding them sets
  `aria-busy="true"` and says what is loading in a `sr-only` line.
- **Motion.** Dialogs, popovers, tooltips and the scrim fade, the Drawer
  slides in from the right and a toast rises 8px, each over 150ms. With
  reduced motion asked for, they appear and go at once (every portal is a
  `.jh-ui` root, where the base style cuts motion).

### Where the containers differ from the mock

- **The drawer box's 10px radius** is the Banner's 12, as the Phone board's
  same box (the radius scale has no 10).
- **The Dialog's title is 20/26** (`title`), where the "won't open" card it
  is laid out from uses 18/24: the type scale has no 18, and 20 matches the
  drawer's title.
- **Not in the mock, derived from it:** the Dialog's layout (the "won't open"
  card's), its widths (440 for a Confirm, 540 as that card, 600 as the
  palette), the Confirm's subject block, the lighter scrim of a nested modal,
  the Tooltip, the Toast, the EmptyState's centred layout, the Popover's
  left-aligned text (the mock's one floating card is centred), the Drawer's
  close button at the IconButton's 34px (the mock's is 32px), and the toasts'
  place and timing.
- **Type-scale steps, kept over the mock's sizes:** the Quick Launch card's
  title is 15px (`title-xs`; the mock's is 14) and its padding 20px when
  comfortable (the mock's is 16); the popover's description and a small
  EmptyState's line are 13/18 (the mock's are 13/20); the Banner's detail line
  is 16px tall (the mock's is 20, so its box is 90px against 94); and the
  drawer's title has no -0.01em tracking.

## Status components

The status components (spec §5.4, #287), moved here from the Android app and
grown to the mock's, one file each in `src/ui/`, imported as `@ui/<file>`.
Each takes a `state` from the status model (`ok`, `warn`, `crit`, `unknown`,
`maintenance`, spec §6) or one of the Android app's severities (`healthy`,
`caution`, `critical`, `unknown`), which
[`lib/status.js`](../src/ui/lib/status.js) reads as a state. Anything else
reads as no signal: never green, never red. AttentionPanel also takes the
overall state `empty` (`EMPTY`, a board with nothing set up, #449), which no
entity has, so it has no lamp or word of its own.

| Component | Import | Props |
| --- | --- | --- |
| `StatusLamp` | `@ui/status-lamp` | `state`; `label`, its name (the state's word by default); `size`: `sm` (10px, the default), `lg` (14px) or px; `decorative` |
| `StatusWord` | `@ui/status-word` | `state`; `word` (the state's word by default) |
| `StatusBadge` | `@ui/status-word` | `state`; `word` |
| `IssueRow` | `@ui/issue-row` | `issue` (`{ state, word, title, where, reason, age }`); `onOpen` or `href`, or both: a link's `onOpen` runs on a plain click or Enter only, a modified or middle click being the browser's |
| `SubsystemStrip` | `@ui/subsystem-strip` | `cells` (`[{ key, label, state, word, value, sub }]`); `selected`, `onSelect` |
| `AttentionPanel` | `@ui/attention-panel` | `state`, `word`, `counts`, `subline`, `action`, `issues` (IssueRow's, each with an `id` and its `onOpen` or `href`), `filter` and `onClearFilter`, `meta`, `titleAs` (`h1` by default), `between` (an element after the header: the Overview's strip) and `split` (#484) |

Each also takes `className`. A state's word, when none is given, is the
mock's: OK, Warning, Critical, No signal, Maintenance. Which look a component
draws is the build's, never a prop's ([Two looks](#two-looks)).

### How the status components look

From the mock's Overview board, and its Phone board where a component sits
narrower than 672px (`@2xl` of its own container, so it follows the column it
is in, not the window):

- **StatusLamp.** The mock's lamps, drawn as SVG in the state's `solid`: a
  filled disc for ok, a disc slashed from bottom left to top right for warn, a
  disc with a level bar for crit, a 2px hollow ring for no signal, and the
  Tokens board's wrench for maintenance, its 1.5px line inside the box. The
  slash and the bar are cut in `lamp-cut`, 2px wide at 10px and 2.5px from
  14px. A lamp always draws its state's shape.
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
  its state's tint when it is a warning, critical or no signal; maintenance
  stays on `surface-1`, its wrench saying it (spec §6.1). A tile is a lamp and
  an overline label, over the value (`title-sm`) and `sub` (12px `text-3`).
  The tint is laid over the tile's `surface-1` (a one-colour gradient over the
  background colour), never over the frame's `border-subtle` that shows in the
  gaps: there the `text-3` label and line fell to 3.85:1 in light, which the
  gallery's axe check found (#289); over `surface-1` they keep the 4.5:1 the
  contrast check holds. Under the pointer a tile is `surface-2`, tinted or not.
  The label ends in an ellipsis when it doesn't fit, after using 4px of the
  tile's padding; the value and `sub` wrap, and a word wider than its tile
  (the model's "1 in maintenance" with six to a row, from 1024px) breaks onto
  the next line rather than run under the tile beside it (#302). Six sit in a row from 672px, three from 320px and two below
  that, where a tile is the Phone board's: a 14px value and no `sub`. A strip
  holds one to six tiles and never leaves an empty slot, which would show the
  frame's `border-subtle`: four sit two by two when narrow, and five as 3 + 2
  or 2 + 2 + 1, the last tile spanning the rest of its row. With `onSelect` the
  tiles are toggles, `surface-2` under the pointer, the selected one inside a
  1.5px accent edge. With a stale status (#480) the shell gives every tile
  `unknown`, its word and count kept, and "Last known 3 min ago" as `sub`:
  the steel tint and ring, never a level's colour.
- **AttentionPanel.** With issues, or in any state but ok and maintenance
  (which never make an issue, spec §6.1), the mock's attention panel: a 14px
  lamp beside the heading, at `headline` (24/30): the word in its colour, then
  " · " and the counts, semibold in `text-2`. The subline under it in `text-2`,
  at most 72 characters wide; the action at the top right; "Showing … only"
  and Clear when the list is filtered; then the issues as IssueRows, or, when
  the filter leaves none, "Nothing in Jobs needs attention" in 13px `text-3`
  where the list would be. Otherwise the mock's quiet line: the lamp, "All
  systems normal" at `title-xs` in `text-1`, the counts in `text-2`, and
  `meta` at the right in 12px `text-3`. With a filter (the Overview's strip,
  #298), "Showing … only" in 13px `text-2` and Clear sit at the right of the
  quiet line too, before `meta`, since the board under it is filtered.
  Healthy stays quiet (rule 3): no green word. Maintenance doesn't break the quiet line (spec §6.1): its heading
  still says "All systems normal", its lamp is the wrench, and the strip's
  tile under it says what is in maintenance ("1 in maintenance"). An empty
  board (`empty`, nothing set up, #449) is the quiet line with no lamp: its
  heading is `word`, or else the sentence in `counts`, the model's "Nothing
  monitored yet", said once. It never says "All systems normal", since nobody
  checked anything, nor "No signal", since nothing went silent. With a stale
  status (no signal, #480) the shell draws the panel `unknown`: the steel ring
  and "No signal", the counts "last known 3 min ago: Critical · 2 critical"
  (or "…: All systems normal"), why as the subline ("Can't reach JagHelm"),
  and each issue `unknown`, its word, reason and age kept. Nothing from a
  stale status is green, amber or red. `between` follows the panel (the
  Overview's strip, 24px under it in its ShellSection). With `split` (the
  Overview below 768px, #484, the Phone board's status card, strip, issue
  list) the panel is two cards with `between` 24px from each: the header
  (lamp, heading, subline, action) in one, the rows in the other, headed by
  "Showing … only" and Clear when filtered, the list's top edge then the
  card's own. Over the rows' card, 8px above it, the Phone board's label,
  "Needs attention · 6", an overline in `text-3` (no count when the
  subsystem shown has none). The region itself draws no frame. With no rows and no filter
  there is no second card, and the quiet line, having no rows, keeps
  `between` right under it either way. The split changes the frame only:
  the same header, rows, colours and stale rule, plus that label.

### Two looks

A stopgap until Phase 4 rebuilds the Android screens on `src/ui/` (#326, which
removes it): each status component draws one of two looks.

- `ui`: the above. The web's.
- `android`: the Android app's own components as they were in
  `mobile/src/components/`: mono upper-case words, glass cards, the strip of
  cells two to a row and its lamp shapes (`disc`, `slash`, `ring` and the
  UPS's `bolt`, passed as `shape`). It writes the class names `MobileApp.css`
  styles in the `legacy` layer, and its colours are the app's own, so the
  app's screens look as they did (#287 compared them pixel for pixel). Since
  #325 the app hands it the status model's states and words, as the web
  does: its status card leaves out a line it isn't given and draws an empty
  board as the plain card (`sys-status-card--empty`), an issue row shows the
  model's reason on every row, and the Power cell keeps the bolt on battery
  and adds the UPS's readings (`readings`) on a line under the model's
  detail. Maintenance has its own colour, `--jh-maintenance-fg`, restated on
  `#mobile-root` (which isn't `.jh-ui`).

The build picks the look with its `__ANDROID_LOOK__` define: true in
`mobile/vite.config.mobile.js`, false in `vite.config.js`, and so in each app's
tests too. There is no prop for it: the web's tests check the `ui` look and the
Android app's tests the `android` look. Each component reads the define in its
one-line switch, `if (__ANDROID_LOOK__) return <AndroidStatusLamp {...props} />`,
never through an import: there the bundler sees a literal and leaves the other
look out, down to the icons it imports. (Read through an exported constant, it
stayed a variable until the minifier, and the APK kept the web row's chevron
and Lucide's runtime, about 1.4 KB compressed.) So the APK carries none of the
`ui` look's code, nor `cn` or Lucide, apart from the lamp marks the Android
lamp borrows for the bar and the wrench: its script grows by 3.1 KB (1.0 KB
compressed). The web's bundle leaves the Android look out the same way once a
screen imports these components.

#326 deletes the define (and its ESLint global), each component's Android
function and switch, the class-check exception and this section. In the
Android build a component with no Android look of its own (StatusBadge) still
draws the Android lamp; nothing there uses it.

### Accessibility of the status components

- **Never colour alone.** Every state is a shape, a word and a colour. A lamp
  is an image named by its word. Where the word is printed beside it
  (StatusBadge, IssueRow, the panel's heading, the quiet line's "All systems
  normal") the lamp is `decorative`, so a screen reader doesn't say it twice.
  A subsystem tile prints no word, so its lamp keeps the name. The wrench's
  inner viewport is hidden, so it is one image. A test checks that the five
  states draw five different shapes, each with a name.
- **A lamp is named by what it draws.** Under a stale status (#480) a row, a
  tile, a node card or a table row keeps its last known word ("Down",
  "Healthy") beside the steel ring; the lamp is then named "No signal"
  (`lampName`, `lib/status.js`), never by that word, and is not decorative,
  and a row's or a tile's name says it before the word ("Services, No
  signal, Down, 30 / 32 up"). A lamp beside the word "No signal" stays
  decorative.
- **Rows.** A row that opens something is a button (`onOpen`) or a link
  (`href`), named "title, word, where" and described by its reason and age; an
  abbreviated word is spelled out ("UNKN" is said as "unknown"). A row with
  nothing to open is plain content, so it neither looks nor announces as
  tappable (#279).
- **Strip and panel.** Selectable tiles are toggle buttons (`aria-pressed`),
  named as a row is, "label, word, value" ("Services, Down, 30 / 32 up"), and
  described by `sub`. The strip is a region named "Subsystems"; the panel is
  one named "Needs attention", or "Status" when quiet, and its heading is the
  page's `h1` unless `titleAs` says otherwise. Split (#484), it is still one
  region, `between` inside it after the header, so the DOM order is the
  order on screen: the focus goes header, `between`, rows. The rows' label
  is a heading a level under the panel's (an h3 under the Overview's h2),
  so heading navigation reaches them. Unsplit, `between` follows the region,
  outside it.
- **Focus.** Rows and tiles draw the base style's focus ring inset, clear of
  their neighbours.

### Where the status components differ from the mock

- **The slash stops at the disc's edge.** The mock's 13px cut overhangs a
  10px lamp by 1.5px each side, which shows on a tinted row or tile as a
  surface-coloured tick.
- **The wrench is the lamp's size**, 10 or 14px, filling its box with its
  line, so rows keep their columns. The mock draws it only on its Tokens
  board, at 16px beside 10px discs.
- **The last issue row has no bottom edge**, which doubled the panel's own in
  the mock.
- **Type steps over the mock's sizes:** subsystem values are `title-sm`
  (16/22, the mock's 18/24) and the narrow tiles' `body` bold (14/20, the
  mock's 14/18), as the mapping under [Type](#type) says. The rows keep the
  mock's 20px lines for where and the reason, so they are its height.
- **A lamp beside its printed word is decorative.** The mock names every lamp,
  so a screen reader heard "Critical Critical", and "All systems normal" twice
  on the quiet line.
- **One frame at every width.** The Phone board splits the status box from
  the issue list; the panel keeps one frame, with the phone's rows, and the
  Overview (Phase 1) lays out the phone screen.
- **A tile's label may use 4px of its padding** before its ellipsis. The
  mock's labels don't truncate, and "Integrations" runs a hair past its box at
  820px, where an ellipsis alone would cut it.
- **Not in the mock, derived from it:** StatusBadge; a row as a link; the
  quiet line for maintenance (the wrench beside "All systems normal", §6.1);
  the quiet line of an empty board, with no lamp (#449);
  maintenance tiles left untinted; strips of other than six tiles (four sit
  two by two when narrow, five as 3 + 2 or 2 + 2 + 1 with the last tile
  wider); the line a filter with nothing in it shows; the tiles' names.

## Data components

The data components (spec §5.4, #288), one file each in `src/ui/`, imported as
`@ui/<file>`: what the Overview and the detail drawer show about each entity.
They are plain elements on the role tokens, the Sparkline's tooltip excepted
(Base UI's). No screen uses them yet; the [gallery](GALLERY.md) (#289) shows
every state.
They have no Android look: the Android app keeps its own UsageBar and rows
until Phase 4 (#326).

| Component | Import | Props |
| --- | --- | --- |
| `MetricMeter` | `@ui/metric-meter` | `label`; `value` (a number, or null for no reading); `max` (100); `unit` (`%`); `warn`, `crit` (thresholds, in the reading's unit; for a node reading, `readingLines(status.thresholds, reading)`); `band` (the hysteresis, in the same unit: only sets how many decimals print); `state` (the server's, which wins over the thresholds; `unknown` with a value is a reading with no current level, drawn as no signal); `valueText` (the printed value; by default the value rounded down, as the model writes it, and the unit) |
| `meterState` | `@ui/metric-meter` | `(value, { warn, crit })`: `ok`, `warn`, `crit`, or `unknown` without a reading; "at or above" is the status model's comparison, on its grid of hundredths (`atOrOver`) |
| `Sparkline` | `@ui/sparkline` | `label` (its name; required unless `decorative`); `points` (numbers, or `{ time, value }`); `domain` (`[0, 100]`, or `auto`); `width`, `height` (96 × 24); `area`; `unit`, `formatValue`, `formatTime` (HH:MM); `decorative` |
| `UptimeBar` | `@ui/uptime-bar` | `beats` (a state or null per check, oldest first); `count`; `size` (`sm`, `md`, `lg`); `label` (`Heartbeats`) |
| `beatSummary` | `@ui/uptime-bar` | `(beats)`: the strip in words, "2 failures in the last 30 checks" |
| `EntityRow` | `@ui/entity-row` | `state`, `word`, `name`, `where` (a node's name, after the name), `detail`, `meta`, `trailing`, `muted` (quiets a healthy row); `onOpen` or `href` |
| `FactList` | `@ui/fact-list` | `facts` (`[{ key, label, value }]`) |
| `Table` | `@ui/table` | `caption` (or `aria-label`, or `aria-labelledby`), `columns` (`[{ key, header, numeric, cell, className }]`), `rows`, `rowKey` (`id`), `onRowOpen`, `empty`, `minWidth` |

Each also takes `className`, and passes other props to its root.

Spec §5.4's **StatStrip is FactList**. The mock draws an entity's figures
(a UPS's charge, runtime, load and input; a service's monitor, latency and
host) as the detail drawer's two-column list on both its Overview and Phone
boards, and has no strip of figures; the drawer's integration stats (#310) go
there too.

### How the data components look

From the mock's Overview board (node cards, the Services list, the
Infrastructure table), its Phone board, its Tokens board's Pieces and its
Chart colours board:

- **MetricMeter.** The node card's meter: an overline label and the value
  (13px bold, the mock's 20px line) over a 6px round `track` with `tick`
  marks at a quarter, a half and three quarters. Below its threshold the fill
  is `meter`, the accent's; at or above `warn` it is `warn-solid`, at or above
  `crit` `crit-solid`, and the value takes the state's word colour (rule 3).
  The threshold where it leaves the accent (`warn`, or `crit` without one) is
  cut into the track in `lamp-cut`, 2px wide, so a reading past it shows
  without colour. The fill clamps to the track and grows over 150ms; the value
  prints as read ("130%"), by the status model's one rule for a reading
  (`shownReading`, #450): rounded down, so 94.6 by a 95 line prints "94%",
  never at a line it is under, and beside a line with a fraction (87.5) to
  that line's decimals ("87.6%"); under 0, "0%". No reading: an empty track and a dash in the
  no-signal word colour. A reading with no current level (`state` `unknown`:
  the status it was judged by is stale, #495) is no signal too, with its
  number: the fill `unknown-solid` (steel) and the value in `text-2`, never a
  level's colour and never judged against its lines. Ported from the Android app's UsageBar, whose fixed
  75/90 steps become `warn` and `crit`. A node reading's lines are the ones
  `/api/status` serves, the model's (`readingLines(status.thresholds, reading)`
  in `server/status/readings.js`, #451): a screen keeps none of its own.
- **Sparkline.** One series in slot 1, `series-1` ([Chart colours](#chart-colours)).
  The plain line is the node card's: 96 × 24, a 1.5px line. `area` is the
  Chart colours board's: a 2px line over a 14 % fill, the latest reading a
  3.5px dot ringed in `surface-1`. It plots against 0–100 unless
  `domain="auto"`; a missing reading breaks the line; fewer than two readings
  draw nothing. Under the pointer, or with the keyboard on it, the nearest
  point gets the same dot and a tooltip above the chart (the Tooltip's frame,
  #286): the value in bold and the time in `text-2`. In a wider root
  (`className="w-full"`) it fills the root's width at its own height, drawn at
  that size, so the line stays 1.5 or 2px and the dots round.
- **UptimeBar.** Kuma's heartbeat strip, oldest on the left. Only failures
  light up: `crit` beats are `crit-solid`, `warn` beats (Kuma's pending)
  `warn-solid`; every other check, maintenance included, is the quiet
  `beat-ok`, and a beat with no check is a hollow `border-strong` outline.
  Beats are 2px round (`rounded-xs`) and 2px apart: `sm` 4 × 16 (rows), `md`
  6 × 22 (the drawer), `lg` 8 × 26 (the phone's detail screen, spread with
  `justify-between`). `count` pads the oldest end with empty beats, so strips
  in a list line up.
- **EntityRow.** The Services row. From 672px of its own container: the lamp
  (at the start of a 16px column), the name (semibold), the detail (13px), the meta (12px `text-3`,
  right-aligned in 64px), the trailing figure and a chevron, `h-row` tall
  (40px, 32 compact) and padded by `p-panel`, with the name keeping at least
  the mock's name column (3/7 of the name and detail) so details line up down
  a list. Narrower, the Phone board's row: the lamp in a 12px column, the name
  over the detail and the meta on one 12px line ("24,499 assets · 138 ms":
  the detail gives way, the meta is never cut, and a meta alone, not a dash,
  has the line to itself), and the trailing figure, 12px taller than `h-row`; a
  heartbeat strip there shows its newest 12 beats, as the Phone board's, so
  the detail keeps its room. Both keep the mock's 20px
  lines. The detail is `text-1` when healthy and the state's word colour
  otherwise; a critical row is tinted `crit-tint` from 672px, as the Overview
  board's (the Phone board's list leaves it plain). `row-hover` under the
  pointer, over the tint. `muted` (#300, the Overview's Services list) quiets
  a healthy row: its detail in `text-2`, so a failing row stands out; any
  other state keeps its colours. `where` (#300) follows the name in its
  column, in 12px mono `text-3`, and gives way (an ellipsis) before the name
  does.
- **FactList.** The detail drawer's facts: a label column in `text-3` and a
  value column, semibold in `text-1`, 10px between rows and 12px between the
  columns. From 384px of its own container it is the Overview drawer's (a
  130px label column, 13px on the mock's 20px line); narrower, the Phone
  board's detail screen (120px, 14px). Labels wrap in their column, values in
  theirs, and a value with no break in it (a URL, a SHA, a hostname) breaks
  anywhere (`wrap-anywhere`) rather than run past its column or a drawer's
  edge (#289). Without facts it draws nothing.
- **Table.** The Infrastructure table: `surface-1` in a subtle edge, 12px
  round, overline headers (`text-3`, the mock's 20px line, 10px above and
  below), rows `h-row` tall with a subtle rule between them, 13px text,
  12px between columns and 16px at both ends of the first and last, as the
  mock pads them. The first column is
  bold. Numeric columns are right-aligned, header too, in tabular figures.
  Cells keep to one line, so a row stays one `h-row` tall (a column's
  `className` can set `whitespace-normal`), and a table wider than its frame
  scrolls inside it (`minWidth`; the mock's is 720px). The frame holds what
  its cells position (words for screen readers, `sr-only`), so a column
  scrolled out of view never widens the page (#299).

### Rules for the data components

- **The name is never truncated before anything else** (spec §8, the card).
  An EntityRow's name column starts at the name's own width; the meta and the
  trailing figure start from nothing and grow into the room it leaves, up to
  their own width (a strip short of room loses its oldest beats from the
  left; on a phone-width row a heartbeat strip shows only its newest 12); the
  detail fills what is left after them, ending in an ellipsis. Only a name
  wider than the whole row ends in one. Pass every row in a list the same
  parts (`meta="—"` where there is none, which stays out of the row's
  description; an UptimeBar with the same `count`), so they line up.
- **Beside a meter, slot 1 only.** A strip, row or card that holds a
  MetricMeter draws its chart as a Sparkline ([Chart colours](#chart-colours)).
- **Never on `surface-3`.** Meters and sparklines sit on the page, a panel,
  `surface-2` or a hovered row; a sparkline may also sit on a status tint or
  in a selected row (slot 1 alone, [Chart colours](#chart-colours)).
- **Severity is the server's** (spec §6). A meter's `warn` and `crit` come
  from the server's threshold config, and its `state`, when the server sends
  one, wins: its hysteresis holds a warning until the reading drops 5 points.
- **Inside something that opens** (an EntityRow with `onOpen`, a node card
  once it opens its drawer, #309), a Sparkline is `decorative`: a focusable
  chart inside a button is a control inside a control, and the row's name
  says what matters. The node card opens nothing yet, so its Sparkline is
  not.

### Accessibility of the data components

- **MetricMeter** is a `meter` named by its label, with `aria-valuenow`, its
  min and max, and its value in words, with any threshold it passed: "92%,
  warning above 90%". With no current level, "94%, no signal". Without a
  reading it is no meter: its label and "No data".
- **Sparkline** is an image named by `label` and described by its latest,
  lowest and highest readings, so nothing lives only in the tooltip, which
  never opens on touch. Tab reaches it, and focus opens the tooltip at the
  latest point; the arrows, Home and End move it, and a polite live region
  says each point they reach ("30% at 08:38"), so the tooltip itself is hidden
  from assistive tech (#289). Escape closes the tooltip. Its
  focus ring goes around the chart, never on the line. `decorative` hides it
  from assistive tech and the tab order; the pointer still gets the tooltip.
- **UptimeBar** is an image named by its summary, "Heartbeats: 5 failures in
  the last 30 checks, including the latest", counting only checks with data
  (with none, "No data in the last 30 checks"; with no checks, "No checks
  yet"). On a phone-width row it shows 12 beats and still sums up them all.
  The name is hidden text inside it, so an EntityRow holding it is described
  by it.
- **EntityRow** is a button (`onOpen`) or a link (`href`) named "name, word"
  and described by its where, detail, meta (not a dash alone) and trailing
  figure, with a decorative
  lamp; with nothing to open it is plain content and its lamp is named by the
  word. A lamp drawn as no signal beside another word (a stale status's last
  known "Up", #480) is named "No signal" (`lampName`), and so is the row. The
  focus ring is drawn inset.
- **FactList** is a description list: each label a term, its value the
  definition.
- **Table** is a `<table>` named by its `caption` (hidden: the panel's heading
  shows it), an `aria-label`, or its section's heading (`aria-labelledby`, as
  the mock names its sections), with `scope`d column headers and each row
  named by its first cell, a row header; without a name it throws in
  development and logs in production. With `onRowOpen`, that first cell is a
  button, so Tab reaches each row and Enter or Space opens it, and a click
  anywhere on the row opens it too, except on a link or control a cell holds.
  While it scrolls, its frame is a region named as the table that Tab
  reaches, so the keyboard can scroll it.

### Where the data components differ from the mock

- **The sparkline is azure, slot 1**, where the mock's node cards and drawer
  draw it in the accent's `meter`: the Chart colours sign-off (#386) gives a
  single series slot 1 and keeps the accent out of plots.
- **The threshold tick** is not in the mock, whose meters have only the
  quarter ticks: it shows where the meter leaves the accent, so a reading past
  its threshold shows by more than colour. Jag's call (#288); taking it out is
  one element in `metric-meter.jsx`.
- **No reading keeps the track.** UsageBar hid its bar; the empty track keeps a
  grid of meters in line.
- **The table's headers are on the type scale's 20px line**, as the mock's
  inherit; the first column is bold as a whole, where the mock bolds the name
  and sets the host beside it in 12px mono `text-3` (a `cell` can do that).
- **A row's detail ends in an ellipsis**, where the mock's wraps to a second
  line ("No heartbeat yet · monitor added 2 min ago"), and the phone row's
  beats are 16px tall (the mock's 18): one `sm` size for both rows.
- **Not in the mock, derived from it:** the Sparkline's tooltip, its keyboard
  and its active dot; UptimeBar's `warn` beats, maintenance kept quiet, and
  its `md` and `lg` sizes (the drawers' beats); FactList's switch between the
  drawer's and the phone's sizes at 384px of its container (the boards show
  the two, not where one becomes the other); the meta and trailing figure
  giving way to the name; the table's row header, its open button and its
  scrolling region; the empty-table line.

## Shell

The frame every page lives in (spec §5.4, §7; #296), one file each in
`src/ui/`, built on the components above. `src/shell/` wires them to the
router, the config and the status poll ([ARCHITECTURE.md](ARCHITECTURE.md),
"Shell and routing"); the [gallery](GALLERY.md) shows each in every state, and
`e2e/shell.spec.mjs` runs the whole shell in a browser.

| Component | Import | Props |
| --- | --- | --- |
| `AppShell` | `@ui/app-shell` | `switches` (the roots' theme, accent, density, typeface), `header`, `sidebar`, `tabs`, and the page as `children` |
| `ShellPage` | `@ui/app-shell` | `title` (the page's h1), `description`, `actions`; a page of the new UI inside the shell |
| `ShellSection` | `@ui/app-shell` | its `children`: a part of a page in the new UI beside today's views (the Overview's status and strip, #297, #298; the utilities rail, #301) |
| `ShellApps` | `@ui/app-shell` | `label` (names the open app's region), `bar` (the open app's AppBar); holds the embedded apps' frames |
| `AppHeader` | `@ui/app-header` | `name`, `logoUrl`, `status` (`{ reach, state, word, sentence, href, current, lastKnown }`), `updated` (an element, `UpdatedAgo`), `onOpenPalette`, `shortcut`, `onThemeChange` (the toggle, given `'light'` or `'dark'`), `settingsHref`, `settingsCurrent`, `onLogout`, `onNavigate` |
| `UpdatedAgo` | `@ui/app-header` | `at` (ms since the epoch) |
| `SideNav` | `@ui/side-nav` | `groups` (`[{ id, label, items }]`), `collapsed`, `onCollapsedChange`, `onNavigate`, `label` |
| `NavGroups` | `@ui/side-nav` | `groups`, `collapsed`, `onNavigate`: the list alone, as the phone's More sheet uses it |
| `BottomTabs` | `@ui/bottom-tabs` | `tabs` (`[{ id, label, icon, href or onClick, current, badge, expanded }]`), `onNavigate`, `label` |
| `AppBar` | `@ui/app-bar` | `name`, `monogram`, `url`, `href` (Open in new tab; none, no link), `onReload` (none, no button) |

A nav entry is `{ id, label, href, icon or monogram, current, badge, loaded,
onUnload, minor }`; a badge is `{ count, state, label }`, its `label` the count
in words ("4 issues"). `onNavigate(event, href)` handles a link's click: the
router's `followLink`, which leaves a modified or middle click to the browser.

### How the shell looks

From the mock's Main and Phone boards:

- **AppShell.** The header runs the full width at the top, sticky (`z-header`).
  From 768px the sidebar sits under it, sticky, the window's height, scrolling
  on its own; below 768px the bottom tabs are fixed to the bottom edge, and the
  page keeps 64px clear above them. That width is `PHONE_WIDTH` (`@ui/app-shell`,
  `(width < 48rem)`, Tailwind's `md`), the one value for a part that changes
  its markup there, such as the Overview's split (#484). Each piece of chrome is a `UiRoot`; the
  page, `<main>`, is not, so today's views inside it keep their look
  ([ARCHITECTURE.md](ARCHITECTURE.md), "UI stack"). A `ShellPage` is its own
  root: the page gutter (16, 24, 32px by width), at most 1024px wide, its
  title in `text-title`, its description in `text-2`. A `ShellSection` is a
  root too, with no gutter or background of its own: its children stacked
  24px apart, as a ShellPage stacks them, in a page that is still today's
  (the Overview's status and subsystem strip over today's board, #297,
  #298), which shows between them.
- **AppHeader.** 48px on `bg`, a subtle bottom edge, 16px (24px from 768px) at
  the sides. The brand: JagHelm's shield (`public/logo.svg`, the favicon's
  artwork, #530), 28px, or the instance's own logo; the name in 15px
  extra-bold, for screen readers only below 768px. The status: a 14px lamp,
  the word in `text-title-xs` in its state's `fg`, then the model's sentence
  in `text-2` (`text-1` under the pointer), cut short with an ellipsis rather
  than wrapped. Healthy (ok, or only maintenance) says "All systems normal" in
  `text-1`: no green word (rule 3). An empty board (nothing set up, #449) is
  the model's "Nothing monitored yet" in `text-1`, with no lamp: neither "All
  systems normal" nor "No signal". No signal is the steel ring and "No
  signal" in `unknown-fg`, then, in `text-2`, what was last known when the
  shell has a status (`lastKnown`: "last known 3 min ago: All systems
  normal", #480), else why, by `reach` (`down`: "Can't reach JagHelm";
  `waiting`; `expired`: "JagHelm's status is out of date"). Before the first answer a
  14px skeleton disc and a 160px bar stand in. "Updated 12 s ago" in
  `caption` `text-3`, from 640px. From 1024px the search button is the mock's:
  `surface-1` in a subtle edge, `text-3`, the shortcut in a mono `kbd`, 240px
  (280px from 1280px); narrower, a ghost IconButton. Then the mock's theme
  toggle (#304), a ghost IconButton at every width: a sun, "Switch to light
  theme", in dark, a moon, "Switch to dark theme", in light, read from the
  root it is drawn in. Settings and Log out are ghost IconButtons; Settings,
  when open, takes `accent-tint` and `accent-text`, as a selected nav entry
  does.
- **SideNav.** `bg-sidebar` with a subtle right edge, 232px, 16px by 12px of
  padding, 20px between groups. Each group's label is the mock's overline
  (`text-overline`, upper case, `text-3`). An entry is 36px (`minor`: 32px and
  13px), `rounded-lg`, 10px of padding, a 16px icon or a 20px app chip, then
  the label; `text-2` and `font-medium`, `surface-2` and `text-1` under the
  pointer. The open page's entry is `accent-tint` with `text-1` semibold and
  its icon in `accent-text`; an app's chip turns `accent` with `on-accent`
  letters (`surface-3` and `text-1` otherwise). Alerts' count is a pill on the
  worst state's tint in its `fg`. A loaded app's dot is 6px `text-3`. Unload
  is a 28px ghost IconButton over the entry's right end, on `bg-sidebar`,
  shown under the pointer, on keyboard focus, and always on a touch screen
  (`pointer-coarse`). Collapsed: 64px, icons and chips centred, the count and
  the dot at the icon's corner, the toggle (`PanelLeftClose` /
  `PanelLeftOpen`) at the bottom.
- **AppBar.** The mock's strip over an open app: 44px on `surface-1` above a
  subtle edge, 16px (24px from 768px) at the left. The app's chip, its name
  in bold, its address in 12px mono `text-3`, cut short (from 768px), "Stays
  loaded when you switch away" in `caption` `text-3` (from 1024px), a 30px
  ghost Reload (`RotateCw`) and a secondary sm "Open in new tab" with the
  external-link icon. It sits in its own root above the frames, which fill
  the rest of the window; the loading, slow and blocked notices show under it.
- **BottomTabs.** 64px (plus the home-indicator inset) on `surface-1` above a
  subtle edge, one cell per tab: a 20px icon over a 12px label, `text-3`;
  the open tab's icon sits on a 48 × 28 `accent-tint` pill and its label is
  `accent-text`, bold. A count sits at the icon's top right in the state's
  `solid` with its `on-solid` figure, as the mock's.

### Accessibility of the shell

- **Landmarks.** The header is the page's `banner`; the sidebar is the
  navigation "Main" and the phone's tabs the navigation "Tabs" (only one shows
  at a width); the page is `main`; an open app's frames are a region named
  "<app>, open inside JagHelm". The sidebar's groups are `group`s named by
  their labels.
- **Names.** A nav entry's name is its label, then its count and whether it is
  loaded ("Alerts, 4 issues", "Grafana, still loaded"); collapsed, the same
  name shows as a tooltip. The header's status is one link, "Critical: 1
  service down · …". Beside it, a polite live region (`sr-only`) announces a
  change of state, never a tick of an age: the link's words while there is a
  signal, else "No signal" and why ("No signal: Can't reach JagHelm"),
  without the "last known 3 min ago" line, whose age moves each second
  (#480). It is the same element from the placeholder ("Checking status") to
  the first status, so that is announced as a change. The
  open page's entry and link are `aria-current="page"`. The theme toggle is
  named by what it does ("Switch to light theme"). Reload is named
  "Reload <app>"; "Open in new tab" opens with `rel="noopener noreferrer"`,
  so the app gets no handle on JagHelm. More is a button with
  `aria-haspopup="dialog"` and `aria-expanded`; its sheet is a Drawer named
  "More". The search button carries `aria-keyshortcuts`.
- **Focus.** Unload sends focus back to its entry. Every control keeps the
  base focus ring; a phone tab's is inset, clear of its neighbours.

### Where the shell differs from the mock

- **The header runs the full width**, above the sidebar, with the logo and the
  instance name in it (spec §7); the mock puts the brand at the top of the
  sidebar and the header beside it. It is 48px, the mock's is 56px.
- **The theme toggle sits between the search and Settings**, as the mock's
  sits beside the search (the mock has no Settings link in the header). It
  switches dark and light; system is Settings → Appearance's (#304).
- **No account card at the sidebar's foot**, and no Launch entry yet (#301);
  Settings is in the Tools group rather than pinned to the bottom.
- **Phone tabs: Overview, Alerts and More**, until the Services and
  Infrastructure pages exist (#313); the mock has all five.
- **Labels are 12px, not 11px** (the type floor), and the phone's count is the
  mock's solid; the sidebar's is the mock's tint.
- **JagHelm's shield, not the mock's wheel** (#530): the mock drew a wheel on
  an accent square as the brand mark; the header shows JagHelm's own logo, as
  the favicon and the Android icon do.

## Overview sections

The Overview's sections in the new UI, one file each in `src/ui/`, built on
the components above; `src/shell/` feeds them the status model
([ARCHITECTURE.md](ARCHITECTURE.md), "The Infrastructure section", "The
Services section"). The [gallery](GALLERY.md) shows each in its states (group
Overview), and `e2e/infrastructure.spec.mjs` and `e2e/services.spec.mjs` run
them in a browser.

| Component | Import | Props |
| --- | --- | --- |
| `InfrastructureSection` | `@ui/infrastructure-section` | `nodes` (each `{ id, anchor, name, host, subtitle, colour, state, word, reason, readings, services, uptime, trend }`), `count` ("3 nodes · 1 warning"), `view` (`cards` or `table`), `onViewChange` (none, no toggle), `loading`, `banner`, `title` (`Infrastructure`) |
| `NodeCard` | `@ui/node-card` | `name`, `host`, `subtitle`, `colour` (the user's, a swatch), `state`, `word`, `reason`, `readings` (MetricMeter's props each, with `key`), `services` and `uptime` (the footer's lines), `trend` (`{ points, label, formatValue }`) |
| `NodeSwatch` | `@ui/node-card` | `colour` |
| `ServicesSection` | `@ui/services-section` | `groups` (each `{ key, title, host, count, rows }`, each row `{ id, anchor, name, where, state, word, detail, meta, muted }`), `count` ("12 monitored · 1 down"), `grouping` (`node` or `group`), `groupings` (the control's options, `disabled` on one with nothing yet), `onGroupingChange` (none, no control), `groupingHint` (a caption under the control), `loading`, `banner`, `title` (`Services`) |

A reading in `nodes` also carries `shown`, its value as the table prints it
(by the model's rule, as the meter does), or null for no reading.

### How the Overview sections look

From the mock's Main board, its Infrastructure section:

- **InfrastructureSection.** A heading row: the section's icon (Lucide
  `Server`) in a 32px accent chip, the title in `text-title-sm`, the count in
  13px `text-3`, and at the end the Cards / Table SegmentedControl, named
  "Node view". When the row runs out of room the count goes under the title
  and the toggle to a line of its own, at the right. Cards are in columns at
  least 260px wide, 12px apart (one to a row on a phone), the cards of a row as
  tall as the tallest. The table is the Table component, its hidden caption
  "Nodes": node (swatch, name, host in mono `text-3`), role, CPU, memory, disk,
  temperature, services and state (the lamp and the model's word, `text-1`
  when healthy); a reading in its state's word colour, semibold, only at or
  over its line, a dash for none. The table needs 720px: in a narrower
  section (a phone) the section draws the cards and no toggle, so the state
  and every reading stay in view; the table returns when it fits. While
  loading, three 192px placeholder cards and no count.
- **NodeCard.** The mock's node card: `surface-1` in a subtle edge, 12px
  round, 16px of padding, 14px between its parts. The name in `text-title-xs`
  after the swatch; the host (mono) and subtitle in 12px `text-3` under it; at
  the right the lamp alone when healthy, else the word (12px bold, its
  state's `fg`) beside the lamp. The meters two to a row, 12px by 16px apart;
  the model's reason in 12px semibold in its state's `fg` when not healthy;
  under a subtle rule the services and uptime in 12px (`text-2`, `text-3`) and
  the trend, a 96 × 24 Sparkline.
- **NodeSwatch.** 10 × 10, 2px round, the user's colour for the node, hidden
  from assistive tech: the node's only colour of its own (spec §5.2).
- **ServicesSection** (#300). The heading row is Infrastructure's: the icon
  (Lucide `Activity`, the mock's) in a 32px accent chip, the title, the count
  in 13px `text-3`, and at the end the grouping, a SegmentedControl named
  "Group services by" (Node, Group). Group is disabled until Settings has a
  custom group, and a caption under the control (`groupingHint`, 12px
  `text-3`, its link `accent-text`) says where to add one, describing the
  control. Then one panel: `surface-1` in a subtle edge, 12px round, the groups
  in it. A group's heading is the mock's: on `surface-2` above a subtle rule,
  10px over 8px of padding, its title an overline in `text-2`, the node's key
  in 12px mono `text-3` beside it (when it differs from the title), its count
  ("7 / 8 up") in 12px `text-3` at the end. Its rows are EntityRows, a subtle
  rule between them: lamp, name, `where` (the node, when the group isn't
  one), the detail (the headline metric, or the model's reason) and the
  latency as the meta; healthy rows `muted`, a critical one tinted. Narrower
  than 672px, the rows are the Phone board's. While loading, four placeholder
  rows and no count.

### Rules for the Overview sections

- **The model's, never the section's.** A node's state, word and reason are
  its entity's; a meter's state is the model's level for that reading and its
  lines are the ones `/api/status` serves. Below its line a meter is the
  accent's (`bg-meter`); it takes `warn-solid` or `crit-solid` only at or over
  its line, or while the model holds that level inside its hysteresis band, so
  the meter and the word never disagree.
- **No old number as current.** A reading the model didn't judge this cycle
  is no reading: a dash, with no trend or uptime beside it.
- **No stale level as current** (#495). With a stale status (no signal), the
  shell gives every node and every reading `unknown`: the steel ring, the
  word and reason in `unknown-fg`, each meter steel with its number from
  `/api/services` in `text-2`, and the count "3 nodes · No signal · last
  known 3 min ago". A meter never mixes a stale level with a fresh number.
- **One reading, one number, one unit.** A meter prints what the model's
  reason prints: the number by `shownReading`, a temperature in °C.
- **The user's colour is a swatch.** Never a card's edge, tint or a meter.
- **Healthy rows are quiet** (#300). A Services row the model says is up is
  muted, its detail `text-2`; only a failing row takes a status colour, and
  only a critical one the tint. A row prints its latency and app metric only
  while up: a failing one says the model's reason and a dash, never an old
  number.
- **No stale level in a row.** With a stale status every Services row is no
  signal, its lamp named "No signal", its words and numbers kept as last
  known, and the count says how old ("12 monitored · No signal · last known
  3 min ago").

### Accessibility of the Overview sections

- The section is a region named by its heading; the toggle a radio group,
  "Node view"; each card an article named by the node's name, its lamp named
  by the word when healthy (decorative beside the word otherwise; "No
  signal" beside a stale status's last known word, #480), each meter
  a `meter` ("94%, warning above 90%"), its Sparkline an image named "CPU,
  last hour" that Tab reaches. The table's row header is the node's name; a
  coloured reading adds its state for screen readers (", warning").
- A page links to a node by the card's `id` (or its name's in the table); the
  card takes focus when a link lands on it.
- The Services section is a region named by its heading; the grouping a
  radio group, "Group services by"; each group a list named by its heading
  (an `h3`); each row plain content (it opens nothing yet, #310), its lamp
  named by the word, or "No signal" under a stale status. A page links to a
  service by its row's `id`, and the row takes focus when a link lands on it.

### Where the Overview sections differ from the mock

- **The sparkline is azure, slot 1** (the data components' rule), and is the
  card's last hour of CPU; the mock's footer drew it in the meter's violet.
- **The footer has two lines**, the services ("3 / 3 services up · 1 down")
  over the uptime, where the mock has one ("42 / 42 containers · up 6 d"):
  the model counts services, not containers, and the card is narrow on a
  phone.
- **The card opens nothing yet** (the mock's is a button to the drawer, #309).
- **No table on a phone.** The mock draws the table on its desktop board
  only; below 720px of section the cards stand in and the toggle goes.
- **The table's Services column** is the mock's Workload (the hosted
  services' counts), and its Role is services.yaml's `subtitle` for the node.
- **Services: no heartbeat strip, no chevron, no filter box, no "Show all".**
  The server keeps no per-monitor history yet (#312), the rows open nothing
  until the drawer (#310), and the Services page with its search is #313's.
- **Services: healthy rows are muted**, their detail `text-2` where the
  mock's is `text-1` (spec §8: "Healthy rows are muted").
- **Services: a segmented control** (Node, Group) where the mock has a
  "Group: Node" menu button, as the Infrastructure toggle; there is no
  grouping by tag, since services.yaml has no tags.
- **Services on a phone keep their groups**, from the same components; the
  Phone board's list is flat.

## Sign-in

The sign-in page (spec §8 "Login", #305), in `src/ui/login-form.jsx`, built
on the components above; `src/components/LoginPage.jsx` wires it to
`POST /api/auth/login`, and App gives it the shell's theme and the
instance's name and logo. The [gallery](GALLERY.md) shows it blank, busy, with a
wrong password and with the server not answering, and `e2e/login.spec.mjs`
runs it in a browser.

| Component | Import | Props |
| --- | --- | --- |
| `LoginForm` | `@ui/login-form` | `name`, `logoUrl`, `username`, `password`, `onUsernameChange`, `onPasswordChange`, `errors` (`{ username, password, form }`), `busy`, `onSubmit`, `autoFocus` |
| `LoginScreen` | `@ui/login-form` | `theme`, and LoginForm's props: the page, a `UiRoot` filling the window |

### How the sign-in page looks

JagHelm's logo, 156px tall, as before 3.0 (#530): the lockup, the shield over
the JAGHELM wordmark and "Infrastructure Dashboard" (`public/logo-login.svg`),
or the instance's own logo. It is the page's h1, the instance's name its text
alternative, with no title or subtitle beside it. The lockup was drawn for
dark; in the light theme the page shows `public/logo-login-light.svg`, the
same artwork with only its text darker (JAG and the tagline indigo `#4f46e5`,
HELM amber `#b45309`), which keeps 4.5:1 on `bg`, where the dark version's
text falls to 1.8–2.8:1. Never change the shield or the wheel. Under the logo,
24px down, a Panel titled "Sign in" holding a Field per control, Username and
Password, 16px apart, and the primary button, "Sign in", the card's width. The
column is at most 360px wide, centred in the window on `bg`, with a 16px
gutter on a phone, and the page fits a 390 × 667 phone without scrolling.

### Accessibility of the sign-in page

- **Labels.** Each field is a Field: its label names the input (`<label
  for>`), and `autocomplete` is `username` and `current-password`, so a
  password manager fills both.
- **Errors.** A field's error sits under it, in its `aria-describedby`, and
  sets `aria-invalid`, until that field is edited. A refused sign-in is one error on the password field,
  "Wrong username or password.": the server doesn't say which was wrong, so
  usernames can't be guessed from it. An empty field says so on that field,
  and nothing is sent. A failure no field caused (the server didn't answer,
  or refused for another reason, such as too many attempts) is a crit Banner
  over the fields, `role="alert"`.
- **Focus.** Each new error moves focus to the first invalid field and
  selects its text, so typing replaces it; the page opens with focus on
  Username. Enter in either field submits.
- **Busy.** While a sign-in is out the button says "Signing in…" and is
  disabled but keeps its focus (`aria-disabled`), and a second submit sends
  nothing.

### Where the sign-in page differs from the mock

- **The mock has no sign-in board.** The page follows its tokens and its
  Settings fields (13px semibold labels over 34px inputs).
- **JagHelm's own logo, not the mock's wheel** (#530). The mock drew a wheel on
  an accent square as the brand mark; JagHelm keeps its shield in the header
  and its lockup on the sign-in page, as the favicon and the Android icon do.

## Utilities

Quick Launch, Pipeline and the Checklist (spec §8 item 5, #301), one file in
`src/ui/` (`utilities.jsx`), built on Panel, EmptyState, Input, Button,
IconButton, Checkbox, Skeleton and the sidebar's AppChip. Each is one
component, drawn the same in the Overview's rail (from 1440px, `RAIL_WIDTH`
in `@ui/app-shell`) and on the Launch page; `src/shell/` feeds both
([ARCHITECTURE.md](ARCHITECTURE.md), "Utilities: the rail and the Launch
page"). The [gallery](GALLERY.md) shows them in the rail, on the Launch page,
empty and failing (group Utilities), and `e2e/utilities.spec.mjs` runs them
in a browser.

| Component | Import | Props |
| --- | --- | --- |
| `QuickLaunch` | `@ui/utilities` | `groups` (each `{ key, title, links }`, each link `{ id, name, href, monogram }`), `target` (`_blank`), `hint` ("in Ctrl K too"), `empty` (shown with no group) |
| `Pipeline` | `@ui/utilities` | `items` (each `{ id, title, repo, sha, at }`, `at` in ms or null), `banner` (over the rows), `now` |
| `Checklist` | `@ui/utilities` | `todos` (each `{ id, text, done, dueLabel, overdue }`; null while loading), `onAdd({ text, due })`, `onToggle(id)`, `onRemove(id)`, `banner` |
| `UtilitiesRail` | `@ui/utilities` | the panels, as `children` |
| `LaunchLayout` | `@ui/utilities` | `quickLaunch`, `pipeline`, `checklist` (elements; none, left out) |

`shortAgo(ms)` (`@ui/utilities`) says an age as Pipeline does: "now", "12 m",
"3 h", "4 d".

### How the utilities look

From the mock's Main board, its right-hand column:

- **The panels.** Each is a Panel: its icon in the 28px accent chip (Lucide
  `Rocket`, `GitBranch`, `ListChecks`), its title, and at the end of the
  header Quick Launch's hint (12px mono `text-3`) or the Checklist's count
  ("2 open", 12px `text-3`).
- **QuickLaunch.** Each group an overline (`text-3`) over its links, 6px
  apart; the links in columns at least 7.5rem wide (two in the rail), 10rem
  once the group has 32rem of its own. A link is 13px medium `text-1` in a
  subtle edge, 8px round, 6 by 8px of padding: the app's monogram in the
  sidebar's 20px chip, then the name, cut with an ellipsis (the full name in
  its tooltip and its accessible name). `row-hover` under the pointer.
- **Pipeline.** A row per commit, 10px apart: the message in 13px semibold
  `text-1` (two lines at most) over "repo · sha" in 12px `text-3`, the SHA in
  mono, and the age at the end in 12px `text-3`. With none, "No recent
  commits" (EmptyState sm).
- **Checklist.** A row to add a task: the task (an Input, "Add a task"),
  its due day (a date Input, 9rem) and Add (secondary, `Plus`), in one row
  from 24rem of the form's own width (the Launch page); narrower (the rail, a
  phone), the task across the top and the day beside Add under it. Each
  task a row: its Checkbox inside a label with its words, 13px `text-1`; a
  done one struck through in `text-3`; its due day in 12px `text-3`, or once
  it has passed, "Oct 18 · overdue" semibold in `warn-fg`; Delete, a ghost sm
  IconButton (`X`). With none, "Nothing on the list". While loading, three
  placeholder lines and no form.
- **UtilitiesRail.** The panels in a column, 16px apart. The Overview gives
  it the mock's widths (`flex: 1 1 300px`, 280 to 340px), 24px from its
  sections.
- **LaunchLayout.** Quick Launch across the top, Pipeline and the Checklist
  under it, side by side from 672px of its own width, 24px apart.

### Accessibility of the utilities

- Each panel is a region named by its title (an `h2`); the rail a region
  named "Utilities". A group of links is a list named by its overline (an
  `h3`); each link is named by the app's name, its chip hidden from
  assistive tech, and opens in the target Settings gives it, with no opener.
- A commit's age is a `time` with its instant, read as "12 m ago".
- Each task's box is named by its words (an enclosing label); Delete is
  named "Delete “Patch the NAS”". The task and due fields are named "New
  task" and "Due day (optional)". Overdue is said in words, never by colour
  alone.
- A failed read is a Banner (tone unknown) naming its cause: Pipeline's over
  the last rows ("Gitea didn't answer JagHelm"), the Checklist's with Retry.

### Where the utilities differ from the mock

- **A region, not an `<aside>`.** The page is the shell's `<main>`, and a
  complementary landmark inside it is nested in another (axe's
  `landmark-complementary-is-top-level`).
- **Pipeline has no lamp, no word and no branch.** `/api/gitea/activity`
  carries commits on each repo's main branch (message, SHA, date, author),
  not CI runs, merges or deploys, so a row is the commit's message over
  "repo · sha", where the mock's is a lamp, "JagHelm · CI passed" and
  "branch · sha".
- **The monogram chip is the sidebar's** (20px, 12px extrabold), where the
  mock's Quick Launch chip is 22px with 10px letters: 12px is the type
  floor. The hint is 12px for the same reason (the mock's is 11px), and says
  the platform's shortcut ("Ctrl K" off a Mac).
- **The Checklist adds, dates and deletes.** The mock's checklist only ticks;
  today's panel adds a task with an optional due day and deletes one, so
  this one does too.
- **No weather and clock card.** It joins the rail with #307.

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
- A new typeface goes into `src/ui/typefaces.js`, its latin and latin-ext woff2
  files from Google Fonts into `src/fonts/` (each pinned by its sha256 in
  `scripts/fonts.test.mjs`) with its licence in `src/fonts/licences/`, two
  `@font-face` rules into `src/ui/fonts.css` (latin-ext, then latin, with
  Google's `unicode-range`), a `data-typeface` block into `tokens.css` (and its
  id in that file's header), and a row in the switches and typefaces tables
  above. `scripts/fonts.test.mjs` fails until all of them agree with each other
  and with the files (their family, weights, style and characters), and if the
  default face and the mono go over 60 KB.
- A new colour role needs a utility in `tailwind.css`'s `@theme` block, and its
  pairings in `PAIRINGS` in `scripts/ui-contrast.mjs`. A plausible pairing
  that fails and that the mock never draws goes in `FORBIDDEN` instead, and in
  rule 5 above. A new switch needs teaching to that script's reader, which
  refuses selectors it doesn't know.
- A chart colour change is checked like any colour: 3:1 where charts are
  drawn, the ramp's steps, and the gates that hold the slots
  ([Chart colours](#chart-colours)). `scripts/chart-palette.test.mjs` pins the
  signed-off values and the tables there, so a change fails until the test
  and the tables agree with it.
- `node scripts/ui-contrast.mjs` must report nothing below its floor on either
  screen, no hover too close to its rest state, no accent too close to a
  status, and no chart gate failing.

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
  (the mock's brand square, which JagHelm doesn't draw, #530) to `rounded-lg`
  8; 10px (phone touch targets and inputs) to `rounded-lg` 8, as every
  control.
- **Tokens the mock didn't draw** are derived from it: `text-disabled`; `tint`
  for ok, maintenance and info (10 %); every status `border` (solid at 38 % dark,
  32 % light, as the accent's); every `on-solid`; `info`, which shares
  maintenance's blue.
