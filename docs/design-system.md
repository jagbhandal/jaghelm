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
  [Utilities](#utilities)).
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
   Healthy stays quiet: at most a small lamp. The one exception is the
   heartbeat strip, whose healthy checks are green as Uptime Kuma's are (Jag,
   #629). A meter changes colour only above
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
| custom theme colours | `themeVars` as custom properties in `style` (below) | none |

Roots can nest, in any theme: each carries its own tokens, so a light root
inside a dark one is light. The `dark:` variant applies inside any root
without `data-theme="light"`, so it can't tell such a root from its dark
parent; `src/ui/` doesn't use it, and `scripts/ui-stack.test.mjs` fails if a
class does. "System" (follow the device) is the app's job, not a switch's: it
sets `data-theme` from `prefers-color-scheme` (below).

**Themes** (#304, spec §2). JagHelm has two, dark and light, and a third
choice, system, which shows whichever the device asks for and changes with it,
live. Accents are a curated set of three, violet (default), fuchsia and cyan,
chosen in Settings → Appearance (#321) along with the density, comfortable or
compact; both apply at once, app-wide, and are saved with the display config.
A custom hex saved before #304 maps once to the nearest accent by OKLCH hue
(greys and the old indigo default to violet), and the section says so until
it is dismissed or another accent is picked. [`src/shell/theme.js`](../src/shell/theme.js) holds the choice
(`useTheme`) and gives the shell's roots the theme shown; today's stylesheet
draws its views in the same two (`src/styles/global.css`, on these tokens'
values), so the page and the chrome match. The header's toggle switches dark
and light; Settings → Appearance offers all three (the command palette no
longer lists them, #315). The
ten themes before #304 are gone: a browser that saved one opens in dark or
light by what it drew ([ARCHITECTURE.md](ARCHITECTURE.md), "Design system").
`scripts/themes.test.mjs` fails if a third theme block or `#6366f1`, the old
indigo, comes back.

**Custom themes** (#331). Extra themes are possible, but only ones that stay
readable. A theme is **data, never CSS**: a name, a base (`dark` or `light`,
the built-in theme it starts from) and colours for known token names. Where
they come from: Settings → Appearance → Custom themes, where a theme is pasted
as JSON or read from a `.json` file and stored in the display config's
`themes` (up to 8), so every device has it. That is the one source: a
self-hosted single-user app already has one config that syncs, backs up and
edits by hand, and a `themes/` directory would add a second place to keep in
step and a file read at the server. The choice of which theme to wear stays
per browser, saved as `custom:<base>:<id>`, as dark, light and system are.

```json
{
  "id": "midnight",
  "name": "Midnight",
  "base": "dark",
  "tokens": {
    "bg": "oklch(0.15 0.02 255)",
    "sidebar": "oklch(0.168 0.022 255)",
    "surface-1": "oklch(0.195 0.024 255)",
    "surface-2": "oklch(0.235 0.026 255)",
    "surface-3": "oklch(0.285 0.028 255)",
    "text-1": "oklch(0.975 0.006 255)",
    "text-2": "oklch(0.78 0.02 255)",
    "text-3": "oklch(0.68 0.02 255)"
  }
}
```

That example ([`docs/examples/midnight-theme.json`](examples/midnight-theme.json))
passes; it is not shipped as a default. A theme sets any of the colour roles in
[Tokens](#tokens) (surfaces, borders, text, the accent roles, each status's
`fg`, `tint`, `border`, `solid` and `on-solid`, the chart slots `series-1` to
`-6`, the component colours), and only those: palette steps and the sequential
ramp (`seq-*`) are not settable. What it leaves out is its base's.
Colours are `#rgb`, `#rrggbb`, `oklch(L C H)` or `oklch(L C H / A)`; surfaces
and words must be opaque, tints may be translucent.

*Validation* (`server/themes.js`, one function): the theme is laid over its
base and every pairing in [Contrast floors](#contrast-floors) is scored on
sRGB and Display P3 screens by the same code as `scripts/ui-contrast.mjs`
(`server/uiContrast.js`; the script re-exports it). A theme that leaves the
accent to Settings is scored with each of the three. Each accent's hover must
differ from its rest state and no accent may read as a status colour. The status colours must also tell
states apart: each pair of ok, warn, crit, unknown and maintenance (lamps and
words) must sit at least ΔE OK 0.05 apart, the accent's own floor, so a theme
cannot paint crit in ok's colour and show a critical lamp as healthy
(`ok-solid and crit-solid are too close: ΔE 0.00, needs 0.05`); the built-in
themes keep them 0.11 or more apart. A theme that fails is **rejected** with each failing pairing named, such as
`text-2 on surface-1: 3.10:1, needs 4.5:1`. A theme that sets an accent role
brings its own accent; the Accent choice in Settings is then off, and says so. The chart
palette's gates (separation, colour-blind distance, lightness bands) are not
run on a custom theme: its series only meet the 3:1 floor.

*Where it runs.* In the browser when the display config loads (the validator is
loaded only when a custom theme is chosen, and by Settings, so the first load
carries none of it) and in the server when a save adds or changes a theme: a
failing one is a 400 naming the pairing. A theme already in the file is kept as
it is, so a config with a hand-edited bad theme still saves (to remove it).
`server/themeBases.js` holds the built-in themes' colours as data, generated
from `tokens.css` (`npm run theme-bases`; a test fails when it is stale).
Both live in `server/` because the runtime image holds `server/` but not
`src/` or `scripts/`.

*Two devices.* `themes` is saved whole, like the Overview's layout: when two
devices change it, the server's copy stands and the device that lost is told
("Your themes changed on another device..."). Import and Remove read the
server's copy first, so they start from what it holds. A save the server
refuses as invalid (a 400, such as a theme failing the contrast rules) shows the
server's reason in the toast and is not sent again until the config changes.
Choosing a theme the config no longer has falls back to Dark with a notice;
a failed read of the config changes nothing.

*Security.* Nothing of the input reaches a style as text. A colour is accepted
only if a strict parser reads it, and what is applied is the colour written
again from the numbers it read: no `url()`, `;`, `}`, comment or `var()` can
pass. Keys are checked against the known token names (unknown keys, `__proto__`
and the like are rejected), every string is length-bounded, and a theme
carries at most 120 colours. The colours are set as custom properties on each
root's `style` (React's `setProperty`, never a stylesheet or `cssText`).

*Applying.* A custom theme is not an attribute: the shell hands its colours to
every `.jh-ui` root as `themeVars` (`UiRoot`), keeps `data-theme` at the
theme's base, and portal roots copy them like the switches (`portal.js`). An
inline custom property beats the token blocks, so the theme wins over its
base and the accent blocks. A theme that fails, is missing or hasn't loaded
yet draws as its base, a built-in theme, never half-applied. Settings lists
the themes that loaded as cards (previewed in their own colours) and the
rejected ones apart, with why and a Remove button; nothing is dropped
silently. Not covered: the old stylesheet's pages outside `.jh-ui` keep the
base's colours.

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
healthy heartbeat bar: the `ok-solid` green, as in Kuma, #629), `beat-quiet` (a
maintenance bar: faint, planned work is not an issue), `lamp-cut` (the slash and bar
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
`src/fonts/`. `data-typeface` picks the sans face: Settings → Appearance → Font family lists
the registry's faces in its order, each drawn in its own, and saves the
choice as the display config's `typeface` (#660), so every device draws the
same; an unknown id reads as Manrope. Montserrat is Arcane's face: offered,
never the default. There is one monospace face.

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
| `badge` | 10/16 | 800 | the phone tab bar's count (#303) |
| `overline` | 11/16, 0.07em | 700 | uppercase labels; text-3 or stronger |
| `caption` | 12/16 | | timestamps, hints |
| `body-sm` | 13/18 | | rows, controls |
| `body` | 14/20 | | the default (the root sets it) |
| `title-xs` | 15/20 | 700 | panel and card titles, node names, the healthy overview's line |
| `title-sm` | 16/22 | 700 | entity names |
| `title` | 20/26 | 700 | section titles, drawer titles |
| `title-lg` | 22/28, -0.015em | 800 | the phone's status word and sheet titles (#303) |
| `headline` | 24/30, -0.015em | 700 | the overview's status sentence |
| `display` | 28/32, -0.02em | 800 | page titles |
| `metric` | 24/28 | 700 | values |
| `metric-lg` | 32/36 | 700 | headline values |

Nothing is smaller than 12px except the 11px uppercase overline and the phone
tab bar's 10px count, a number in a solid pill. The Large text size (#321) is a
setting on the root, not a step.

**Sizes the mock draws off the scale** map onto it (#284). The mock uses 15px
titles in two dozen places, so they got a step (`title-xs`); the others are
one-offs:

| Mock | Where | Step |
| --- | --- | --- |
| 10px, 800 | app chip initials (20 and 22px chips) | `overline` (11/16), `font-extrabold` |
| 10.5px | overline labels on meters, palette result kinds, the phone's subsystem labels | `overline` |
| 14/18, 700 | the phone's subsystem values | `body` (14/20), `font-bold` |
| 15px, 700 | panel and card titles in Settings, node names, the healthy overview's line, the header's status word | `title-xs` |
| 15px | the command palette's search field | `title-xs`, `font-normal` |
| 15.5/22 | body text at the Large text size (the mock's `ts-large`) | not a step: the text-size setting (#321) |
| 17px, 800 | the phone header's wordmark | `title-sm` (16/22), `font-extrabold` |
| 18/24, 700 | subsystem strip values | `title-sm` (16/22) |
| 18/24, 700 | the "won't open inside JagHelm" dialog's title | `title` (20/26) |
| 22/28, 800 | the phone drawer's title | `title` (20/26), as the desktop drawer's |
| 26/30, 700 | the typeface picker's "Aa" samples | `headline` (24/30) |
| 26/32, 700 | the settings map's page title | `display` (28/32) |

### Shape, space, elevation, layering, motion

- **Radius**, one token (`--radius`, 8px) mapped: `rounded-xs` 2 (focus rings on small strips, links, node swatches),
  `rounded-sm` 4 (badges), `rounded-md` 6 (segments inside a control),
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
Sparkline (#288, [Data components](#data-components)) draws slot 1 (a node
card's hour of CPU), and the Chart (#311) draws the rest (the detail drawer's
history).

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
- **How many.** A stacked chart, where only neighbouring slots touch, can
  show all six. A line chart can show six too, though any two of its lines
  can cross: past three, slots 4 to 6 are dashed (below). A scatter, a map or
  a small multiple, where any two can meet, shows at most three, slots 1 to
  3, which stay apart in every pair, and folds the rest into one Other
  series. A line chart of more than six folds the rest the same way (the
  Chart refuses a seventh). Other is drawn in a neutral, never a slot or a
  status colour; it has no token yet.
- **Past three lines, slots 4 to 6 are dashed** (Jag, #311). In a line chart
  any two lines can cross, and with all six on screen three pairs that never
  neighbour nearly merge for red-green colour blindness (ΔE ×100, Machado
  2009): lime and orange (1.4 dark, 3.3 light), plum and teal (3.8 light),
  rose and teal (4.6 dark), azure and plum (4.9 light); with normal vision
  every pair stays 11.7 or more apart. No six hues avoid it. So a line chart
  of four, five or six series draws slot 4 in long dashes (`6 6`), slot 5 in
  dots (`0.5 5`) and slot 6 in dash and dot (`10 5 0.5 5`), 2px with round
  caps, and every line carries its name at its right end. The legend, the
  end labels and the tooltip show each slot's dash in its key. Each of the
  near pairs is then a solid line beside a dashed one, or two different
  dashes (plum and teal). Three or fewer series are solid, as signed off.
  The gallery's `chart-series` state draws six (CPU by node).
- **Status is never a series, and a series never means a state.** Ok, warn,
  crit, no signal, maintenance and info never draw a series. A series keeps
  its slot when its value crosses a threshold: the state shows in the status
  components, never by recolouring the series. Every slot sits at least ΔE 8.5
  from every status lamp, bar and word (the gates below).
- **Legend and labels.** Two or more series always get a legend, and each
  line its name at its right end (on a bar, up to four), so the eye needn't
  go back and forth; past three lines that is every line (#311). Where lines
  end close together the names move apart, with a hairline leader back to
  each line's end. Labels and legend entries are words in `text-text-1` or
  `text-text-2` beside the series' swatch or line key, never in the series
  colour: the slots are checked at 3:1 for a graphic, not 4.5:1 for text
  (rule 5). One series has no legend: the chart's title names it.
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
| `SegmentedControl` | `@ui/segmented-control` | RadioGroup, Radio | `options` (`[{ value, label, icon?, disabled? }]`), `value` or `defaultValue`, `onValueChange`, `name`, `size` (`md`, or `touch`: 44px segments, #602) | Tab enters at the chosen segment; the arrows move and choose |
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
  the control is 34px, as an Input or Button beside it. `size="touch"`
  (#602, a phone's sheet): each segment 44px tall and at least as wide, a
  thumb's target, so the control is 48px; the look is the same.
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
key, where the empty-class check reads them (rule 4). There is no exception: a
name that compiles to nothing fails the check, so a misspelt utility or a
legacy class name in `src/ui/` or the phone screens is caught.

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
Confirm, the Sparkline's readout, and the UptimeBar's tooltip and keys,
#312) are one chunk,
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

The status components (spec §5.4, #287), grown to the mock's, one file each in `src/ui/`, imported as `@ui/<file>`.
Each takes a `state` from the status model (`ok`, `warn`, `crit`, `unknown`,
`maintenance`, spec §6) or one of the old severities (`healthy`,
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
| `IssueRow` | `@ui/issue-row` | `issue` (`{ state, word, title, where, reason, age }`); `onOpen` or `href`, or both: a link the page opens itself, its `onOpen` called on a plain click or Enter instead of the browser loading it (an entity's URL, #309), a modified or middle click being the browser's (`lib/link.js`) |
| `SubsystemStrip` | `@ui/subsystem-strip` | `cells` (`[{ key, label, state, word, value, sub }]`); `selected`, `onSelect` |
| `AttentionPanel` | `@ui/attention-panel` | `state`, `word`, `counts`, `subline`, `action`, `issues` (IssueRow's, each with an `id` and its `onOpen` or `href`, and optionally an `action` `{ label, href, onOpen? }`: a link under the row, #752), `filter` and `onClearFilter`, `noMatch` (#314: what the rows say when filtering leaves none), `meta`, `titleAs` (`h1` by default), `between` (an element after the header: the Overview's strip) and `split` (#484) |
| `EventRow` | `@ui/alert-history` | `event` (`{ state, name, where, change, reason, at, time, delivery, gone }`, a row of the alert history, `src/shell/alertsView.js` `historyRow`); `href` and `onOpen` as IssueRow's (#314) |
| `AlertHistory` | `@ui/alert-history` | `state` (`loading`, `ok`, `old`, `error`), `days` (`[{ day, label, rows }]`, each row an EventRow's `event` with its `href` or `onOpen`), `failed`, `onRetry`, `onMore`, `loadingMore`, `empty`, `old`, `titleAs` (`h2`), `heading` (`title` or `overline`) (#314) |
| `AlertFilters` | `@ui/alert-filters` | `severity`, `kind`, `search`, `severities` and `kinds` (`[{ value, label }]`), `onSeverity`, `onKind`, `onSearch`, `onClear` (#314): ListFilters configured (#313) |

Each also takes `className`. A state's word, when none is given, is the
mock's: OK, Warning, Critical, No signal, Maintenance.

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
  an overline label, over the value (`title-sm`, bold `text-1`) and `sub`
  (12px `text-3`), the model's own two lines (#541): a short value ("31 /
  32", "On battery") over the line that says what is wrong ("1 down · 1 no
  signal", "1 overdue"), or with nothing wrong what it counts ("up · 1 in
  maintenance", "64 % charge"). The mock draws the value at 18/24; it maps
  to `title-sm` (16/22), as the type table above has it.
  The tint is laid over the tile's `surface-1` (a one-colour gradient over the
  background colour), never over the frame's `border-subtle` that shows in the
  gaps: there the `text-3` label and line fell to 3.85:1 in light, which the
  gallery's axe check found (#289); over `surface-1` they keep the 4.5:1 the
  contrast check holds. Under the pointer a tile is `surface-2`, tinted or not.
  The label ends in an ellipsis when it doesn't fit, after using 4px of the
  tile's padding. The value and `sub` wrap only between words
  (`overflow-wrap: normal`): no word or number is ever cut in two or ends in
  an ellipsis, and every status fixture's value keeps to one line at 1024,
  1280, 1440 and 1460px in each typeface (`e2e/reflow.spec.mjs`). From 672px
  a tile is the wide one above; six sit in a row from 816px of strip, and
  from 672px in two rows of three, never 5 + 1: narrower, a six-to-a-row
  tile has no room for "Low battery" on one line in Montserrat (100px at
  16px bold; 94 in Plus Jakarta Sans, 91 in Manrope), which the sweep
  measures in all three (#541). Four and five sit in a row from 672px, three from 320px and
  two below that, where a tile is the Phone board's: a 14px value and no
  `sub`. A strip
  holds one to six tiles and never leaves an empty slot, which would show the
  frame's `border-subtle`: four sit two by two when narrow, and five as 3 + 2
  or 2 + 2 + 1, the last tile spanning the rest of its row. With `onSelect` the
  tiles are toggles, `surface-2` under the pointer, the selected one inside a
  1.5px accent edge. With a stale status (#480) the shell gives every tile
  `unknown`, its word, value and sub-line kept as they read fresh (the header
  and the attention panel say how old, once, #541): the steel tint and ring,
  never a level's colour.
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
  tile under it says what is in maintenance ("up · 1 in maintenance"). An empty
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
  `between` right under it either way. The split changes the frame and the
  header's type: the header card is the Phone board's status card, 16px in,
  a 16px lamp 10px from the heading at `title-lg` (22/28, 800), the word at
  800; the same rows, colours and stale rule, plus that label.
- **EventRow** (#314). One event of the alert history, built on IssueRow's
  row so the Alerts page's two lists read as one. From 672px of its own
  container, the attention panel's columns: the lamp (the alert's severity:
  crit, warn, or ok for an info event such as a recovery), the time (12px
  `text-3`, tabular), the name (semibold) over where (12px `text-3`), the
  change bold in its state's word colour then " · " and the reason in
  `text-2`, what the phones got (12px `text-3`, right-aligned in a 184px
  column, so the columns line up from row to row) and a chevron (18, 44,
  1.1fr, 2fr, 184 and 16px), at least 48px tall. Narrower, the Phone board's:
  the lamp, "name · change" over the reason (13px), over where and what the
  phones got (12px `text-3`), and the time; at least 56px tall. An ok change
  ("Down → Up") stays `text-1`: healthy stays quiet, no green word. An entity
  the model no longer has adds "No longer monitored" to where. The name is
  never cut short (EntityRow's rule): a long one wraps anywhere, and narrow,
  the change goes to the next line when it doesn't fit beside it. A reason
  that only says the change again ("On mains" after "On battery → On mains")
  is left out.
- **AlertHistory** (#314). Its heading, "History" at `title-sm` with "Last
  30 days" at the right in 12px `text-3` (or, `heading="overline"`, the phone
  screens' section label, "HISTORY · LAST 30 DAYS"), then one card
  (`surface-1`, 1px border, 12px radius) holding each day: an overline label
  in `text-3` ("TODAY", "YESTERDAY", "OCT 17"), 12px over its rows, the days
  divided by the border. "Show older" is a small secondary button centred
  under the card. Loading is the card with three skeletons; nothing in 30
  days, one line in `text-2` in the card; a server without a history, the
  same line saying so; a failed read, a Banner in no signal's tone ("History
  unavailable", with Retry), never the empty line; a refresh that failed, a
  `text-2` line above the rows with Retry.
- **AlertFilters** (#314). ListFilters (#313, "Overview sections" below)
  configured: one row that wraps, 12px apart, the severity as a
  SegmentedControl (All, Critical, Warning, Info), the kind as a 192px Select
  (Everything, Services, Nodes…), the search as an Input filling the rest
  (192px at least), and, while any is set, a ghost accent "Clear filters"
  with its X.

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
- **The alert history** (#314). An EventRow that opens something is a link
  (or a button), named "name, severity, change, where, time" ("Jellyfin,
  Critical, Down, Service · apps, 11:45") and described by its reason and
  what the phones got; its lamp is named by the severity, and its time is a
  `<time>` with the event's ISO date. AlertHistory is a region named
  "History", busy while it loads (said once, "Loading the history"); each
  day's label is a heading a level under its own (an h3 under the page's
  h2). AlertFilters names each control: the radio group "Severity", the
  combobox "Kind", the search box "Search alerts".
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
  wider); the line a filter with nothing in it shows; the tiles' names. The
  mock has no Alerts screen: EventRow, AlertHistory and AlertFilters (#314)
  are built from the attention panel's row, its panel and the controls.

## Data components

The data components (spec §5.4, #288), one file each in `src/ui/`, imported as
`@ui/<file>`: what the Overview and the detail drawer show about each entity.
They are plain elements on the role tokens, the Sparkline's tooltip excepted
(Base UI's). The Overview's node cards and Services list, the detail drawer
and the phone's screens draw them; the [gallery](GALLERY.md) (#289) shows
every state.

| Component | Import | Props |
| --- | --- | --- |
| `MetricMeter` | `@ui/metric-meter` | `label`; `value` (a number, or null for no reading); `max` (100); `unit` (`%`); `warn`, `crit` (thresholds, in the reading's unit; for a node reading, `readingLines(status.thresholds, reading)`); `band` (the hysteresis, in the same unit: only sets how many decimals print); `state` (the server's, which wins over the thresholds; `unknown` with a value is a reading with no current level, drawn as no signal); `valueText` (the printed value; by default the value rounded down, as the model writes it, and the unit) |
| `meterState` | `@ui/metric-meter` | `(value, { warn, crit })`: `ok`, `warn`, `crit`, or `unknown` without a reading; "at or above" is the status model's comparison, on its grid of hundredths (`atOrOver`) |
| `Sparkline` | `@ui/sparkline` | `label` (its name; required unless `decorative`); `points` (numbers, or `{ time, value }`); `domain` (`[0, 100]`, or `auto`); `width`, `height` (96 × 24); `area`; `unit`, `formatValue`, `formatTime` (HH:MM); `decorative` |
| `Chart` | `@ui/chart` | `label` (its name, required); `series` (`[{ key, name, points, dashed? }]` in slot order, at most six; `dashed` (#754) draws a projection in long dashes in its slot; every series a point per time, `{ time, value }`, null for a gap); `domain` (`[0, 100]`, `auto` fitted to the readings, or `zero` from 0); `height` (the plot's, 112); `formatValue`; `tickEvery` (ms, 15 minutes), `formatTick`, `formatTime` (HH:MM); `state` (`ready`, `loading`, `failed`); `detail` (why it failed), `failedText` ("No data from Prometheus"); `busy` (the last lines dimmed while the next are read); `thresholds` (reference lines the caller passes, #746); `band` (a max band behind a series, #746); `hideEndLabelsWhenNarrow` (#759, opt-in, default off): under 360px wide the names at the lines' right ends are left out, the legend names them |
| `ChartGroup` | `@ui/chart` | charts and the rows between them (each `col-span-full`, a subgrid), on one time axis |
| `RankedBars` | `@ui/ranked-bars` | `label` (its name, required); `rows` (`[{ key, name, value, valueText, state, stateLabel, points }]`, in the order to draw: the caller sorts); `max` (the bars' end, the largest value by default); `formatValue`; `state` (`ready`, `loading`, `failed`); `detail`, `failedText` ("No data from Prometheus"), `emptyText` |
| `DailyBars` | `@ui/daily-bars` | `label` (required); `days` (`[{ key, time, value, note }]`, oldest first, `time` a local midnight, null `value` for no data, `note` an extra tooltip line); `partial` (the last day isn't over); `partialWord` ("so far"); `formatValue`, `formatTick` (the axis), `formatDay` (tooltip and readings); `height` (112); `state`, `detail`, `failedText`, `emptyText` |
| `StatTile` | `@ui/stat-tile` | `label`; `value` (the printed figure, or null for no reading); `note` (under the figure: "so far"); `emptyText` ("No reading") |
| `DrillCharts`, `DrillChart` | `@ui/drill-chart` | `DrillChart`: `name` (the chart's key, kept as `data-chart`); `title`; `empty` (the words that stand in for a plot with no series); the Chart's props (`series`, `domain`, `thresholds`, `band`, `state`, `failedText`). `DrillCharts` is a ChartGroup |
| `DriveNode`, `DriveTable`, `RaidTable`, `DriveList`, `RaidList` | `@ui/drive-tables` | `name`; `DriveTable`'s and `DriveList`'s `drives` (`[{ key, device, model, type, state, word, reason, temperature }]`, the status model's words passed through); `RaidTable`'s and `RaidList`'s `arrays` (`[{ device, active, required, failed, spare, state, word, reason }]`); `DriveList` and `RaidList` are the phone's list rows (#763) |
| `AreaChart` | `@ui/area-chart` | `label` (its name, required); `series` (`[{ key, name, points }]` as the Chart's: one series, or exactly two with `mirrored`: in, then out); `mirrored` (in above the zero line, out below, one symmetric axis); `domain` (plain only: `zero`, `auto` or `[lo, hi]`); `height` (112); `formatValue` (prints a value and each tick's magnitude, with its unit); `tickEvery`, `formatTick`, `formatTime`; `state`, `detail`, `failedText`, `busy` (as the Chart's) |
| `DetailCharts` | `@ui/detail-charts` | `title` (`History`); `range`, `ranges` (`[{ value, label }]`), `onRangeChange`; `charts` (each the Chart's props with a `key`, a `title` and an optional `note`); `busy`; `tickEvery`, `formatTick`, `formatTime` (the range's); `size` (`md`, or `touch` on a phone's sheet: the range switch's, #602) |
| `UptimeBar` | `@ui/uptime-bar` | `beats` (a state or null per check, or a check `{ state, time, ping }` and an optional `word`, oldest first); `count`; `size` (`sm`, `md`, `lg`); `label` (`Heartbeats`); `focusable` (its checks by keyboard, #312); `stale` (no level colour); `fit` (narrower than its beats: the oldest go first, down to the newest 12) |
| `beatSummary` | `@ui/uptime-bar` | `(beats)`: the strip in words, "2 failures in the last 30 checks" |
| `beatCadence` | `@ui/entity-detail` | `(beats)`: how often the checks come, "every 30 s", from their times |
| `BeatSpace` | `@ui/uptime-bar` | `count`, `size`: a strip's room, empty and hidden, for a row with no monitor in a list with strips |
| `EntityRow` | `@ui/entity-row` | `state`, `word`, `name`, `where` (a node's name, after the name), `stack` (a Compose stack's `{ count, chip, bad }`: the +N chip after the name, #642), `detail`, `meta`, `trailing`, `muted` (quiets a healthy row); `onOpen` or `href`, or both, as IssueRow's |
| `DetailStack` | `@ui/stack-panel` | `stack` (`{ name, count, members }`, each member `{ id, name, state, word, reason, lead?, image?, where? }`); `onDetails(member)`, `onSetLead(member)`, `onUngroup()`, `onSplit(member)` (without the three edits, no controls); `busy`, `error` |
| `FactList` | `@ui/fact-list` | `facts` (`[{ key, label, value }]`); `muted` (values in `text-2`: last known) |
| `DetailSection` | `@ui/entity-detail` | `title` (its overline heading, which names it), `aside` (a short note at its end) |
| `DetailHeartbeats` | `@ui/entity-detail` | `beats` (UptimeBar's checks; nothing when not an array); `count` (50, 30 on a phone's sheet); `size` (`md`, `lg`); `stale` |
| `DetailDrives` | `@ui/detail-drives` | `view` (`{ count, summary, tone, standby, note, cadence, rows }`, src/shell/detail/driveView.js; `note` is the footnote under the block: each row `{ key, device, name, state, word, said, temperature, line, details }`); `highlight` (a drive's device: its row opens and is marked); `title` (`Drives`) |
| `DriveHealthSetting` | `@ui/drive-health` | `state` (`on` or `off`); `title`: Settings' read-only Drive health switch and where `JAGHELM_DRIVES` is set |
| `DetailMeters` | `@ui/entity-detail` | `meters` (MetricMeter's props each, with a `key` and an optional `caption`) |
| `DetailVms` | `@ui/entity-detail` | `vms` (`[{ key, name, status, running, detail }]`) |
| `DetailFacts` | `@ui/entity-detail` | `facts`; `lastKnown` (with a stale status, "Last known 3 min ago": the facts greyed, that line under them) |
| `DetailSections` | `@ui/entity-detail` | `sections` (`[{ key, kind, title, aside, … }]`: `facts` and a `note`, `meters`, `vms`, or `runs` (DetailRuns' props), by `kind`); `muted` (their facts greyed) |
| `DetailRuns` | `@ui/entity-detail` | `runs` (`[{ key, state, word, time, duration, error }]`, newest first), `note` (a line above them) in `noteState`'s colour (`warn`), `loading`, `empty` ("No runs on record"; null for nothing), `muted` |
| `DetailRemove` | `@ui/entity-detail` | `title`, `name`, `detail`, `description` (the Confirm's), `label` (`Remove`), `busy` (while it is sent), `error` (`{ title, cause }`: why the last one failed), `onConfirm` |
| `DetailUnread` | `@ui/entity-detail` | `unread` (`[{ key, what, error }]`: the reads that failed) |
| `DetailLinks` | `@ui/entity-detail` | `primary`, `links`, `settings` (each `{ key, label, href, app }`), `target` (where a link out opens), `onOpen` (opens an `app` link in the page) |
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
  level's colour and never judged against its lines. Ported from the Android app's UsageBar (retired), whose fixed
  75/90 steps became `warn` and `crit`. A node reading's lines are the ones
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
  that size, so the line stays 1.5 or 2px and the dots round. It is the
  Chart's sparkline variant (#311): both draw from one geometry
  (`src/ui/lib/chart.js`: a reading, a gap, a line's runs), and the Sparkline
  stays light enough for the first screen while the Chart rides in the detail
  drawer's chunk.
- **Chart** (#311). A line chart of readings over time: 2px lines with round
  joins in the slots' order, values on the left in 12px `text-3` with a
  hairline at each tick (`border` at the bottom, `border-subtle` above), at
  a step coarse enough that no two ticks print the same (#602: whole °C
  rounded down at half-degree ticks would read "47, 47, 48"; the labels stay
  rounded down, the step moves up), times under the plot on the local clock, centred on their ticks, at one
  even stride (every tick, or every second or third, as the width allows,
  counted on the clock: every other day is the same days, a half hour the
  hour and the half), a label that would run past the plot left out. One
  axis per chart: readings of different units are two charts. In a
  `ChartGroup` stacked charts share one time axis: the value labels, the
  plot and the line names are three columns every chart takes as a subgrid,
  so every plot starts at the same x and is as wide (a one-line chart keeps
  the names' column empty), the same times line up, and the same range draws
  the same ticks. One series draws no legend; two or more
  have a legend over the plot and each line's name at its right end, and past
  three the dashes of [Chart colours](#chart-colours). Under the pointer, or
  with the keyboard on it, the nearest time gets a `border-strong` hairline,
  a 4px dot on each line ringed 2px in `surface-1`, and a tooltip (the
  Sparkline's frame) listing every series there: the time in `text-2`, then
  each value in bold with its line key and name. By touch (#602) a finger
  down on the plot shows the crosshair at it, a sideways drag moves it and
  lifting the finger hides it; the plot takes only sideways drags
  (`touch-pan-y`), so an up-and-down one still scrolls the page, and the
  focus a tap leaves opens nothing. "No data from Prometheus"
  (and why, in 12px `text-3`: the server's sentence for the cause, the one a
  failed Prometheus says everywhere, such as "Prometheus refused the
  connection" or "Prometheus answered with an error (HTTP 503)", never
  Prometheus's own words) or "No readings in this range", centred in
  `text-2` over the plot's baseline, never an empty line; a `surface-3`
  placeholder while loading; `busy` dims the plot to 60 %.
- **Chart: reference lines and the max band** (#746). Two opt-in props on
  the Chart; with neither, nothing changes.
  - `thresholds`, `[{ level, value, label?, direction?, mark? }]`: a line
    across the plot at `value`. The caller passes the value, from the one
    severity table (`status/thresholds.js`, ADR 0006); the chart holds no
    threshold of its own. `level` is `warn` or `crit`: a 1.5px line in the
    status `fg` (4.5:1 on every surface, so clear of 3:1 as a graphic), warn
    dashed (`4 4`) and crit solid, so the two differ by more than colour. It is
    a reference, never a series: the series keep their slots, and a status
    colour still never draws one. Its words ("Warn 80 %", "Critical 90 %", or
    `label`) sit at the right end in 12px `text-2` on `surface-1`, above the
    line (below it for `direction: 'below'`, a floor readings fall under), so
    the level is never in the colour alone; labels that would collide move
    apart. `mark` thickens the line to 5px along the breached span (a series
    reads at or past `value`), and the tooltip, the live region and the text
    summary say "over Warn 80 %", "Warn 80 %: reached from 08:15 to 08:30".
    A fitted (`auto`, `zero`) axis grows to hold the lines; on a fixed
    `domain` a line outside it is not drawn, and the summary says "(off this
    axis)".
  - `band`, `{ name?, of?, points }`: the highest reading at each time,
    shaded in the slot of the series `of` (its key, the first by default) at
    20 % between that line and the peak, behind it. A gap breaks the band as
    it breaks the line. It adds a legend entry (the chart shows a legend with
    one series too), a row in the tooltip ("100 % Peak") and a sentence in the
    summary ("Peak (the band behind the line): highest 100 % at 09:00"). The
    band is supplementary: the line carries the 3:1.
  - Gallery: `chart-thresholds` (healthy, flagged with a breach and a band, a
    floor, loading, failed).
- **AreaChart** (#747). A filled area of readings over time, for traffic
  (spec §5.4). `mirrored` draws two series either side of a zero line, the
  first (in) above it and the second (out) below, on one symmetric axis: the
  same extent up and down, so the two compare by eye. Both are magnitudes,
  and the value labels print each tick's magnitude through the caller's
  `formatValue` (so "2 MB/s" below the line as above it); a negative reading
  (a counter reset) is a gap. Without `mirrored` it is one series filled down
  to the axis' floor (0 for a magnitude, as the Chart's `zero`). The fill is
  a 20 % wash of the series' slot under a 2px edge of it, slots 1 and 2 in
  order (or the `slot` a series names), never the accent or a status colour;
  the zero line is the `border` hairline. Two series get a legend over the
  plot ("In above", "Out below") in `text-2`, so the position and the name,
  never the colour alone, say which is which. **A missing reading breaks the
  area**: it stops at the last reading and starts at the next, never bridged
  and never dropped to zero, so a node that is off does not look like one
  that sent nothing (a lone reading between gaps draws no shape). Axes,
  crosshair, touch, keyboard (the plot is an image named by `label`, with a
  summary of each series' latest, lowest and highest and which side it is
  on), loading, failed ("No data from Prometheus") and empty states are the
  Chart's, and in a `ChartGroup` it takes the group's columns, so its times
  line up with the Chart's. Its edge geometry comes from `src/ui/lib/chart.js`
  (`linePath`, `areaPath`, `mirroredAxis`). More series than the mode takes
  is refused; the stacked area is a separate chart.
- **DetailCharts** (#311). The detail's history, under its status box as the
  mock's drawer: "History" as the drawer's overline headings, the range
  switch (a SegmentedControl named "Range": 1 h, 24 h, 7 d) at its right, and
  each chart under its title in 12px semibold `text-2`, a note under one in
  12px `text-3`; its charts are one `ChartGroup`. A node draws "Usage" (CPU, memory and disk, slots 1 to 3 on
  one 0–100 % axis, the same slots on every node) and, with a sensor,
  "Temperature"; containers "CPU" and "Memory", each one series. On a
  phone's sheet (#602, 390px) it is the same, one chart a row as in the
  drawer, in the sheet's section style (an overline heading, 16px from the
  blocks around it); only the range switch is `size="touch"`, its segments 44px tall and
  at least as wide, a thumb's target, so the control is 48px.
- **UptimeBar.** Kuma's heartbeat strip, oldest on the left. Healthy
  checks are green (`beat-ok`, the `ok-solid`, as in Kuma, #629), `crit` beats
  are `crit-solid`, `warn` beats (Kuma's pending) `warn-solid`; maintenance
  stays the quiet `beat-quiet`, and a beat with no check is a hollow `border-strong` outline.
  Beats are pills (`rounded-full`, as Kuma's) 2px apart: `sm` 4 × 16 (rows), `md`
  6 × 22 (the drawer), `lg` 8 × 26 (the phone's detail screen, spread with
  `justify-between`). `count` pads the oldest end with empty beats, so strips
  in a list line up; a row with no monitor in such a list keeps a strip's
  room with `BeatSpace` (invisible, hidden from assistive tech), so its meta
  lines up too. A check from the server (#312) has a tooltip, the
  Sparkline's readout: its word in bold (Kuma's, from its state), its time
  to the second and its response time in `text-2` ("Down 14:32:10", "Up
  14:32:40 138 ms"), above the beat, which takes a 1px `text-3` outline
  while it is shown. The tooltip and the keys are the floating layer's
  (`floating/uptime-bar-tips.jsx`), asked for the first time a pointer (not
  a finger) comes over a strip or one takes focus: the first screen draws
  the static strip only, and the part, once in, adds nothing to its box.
  `fit` (the Services table's cell) lays the beats newest first from the
  right and wraps the oldest onto lines it doesn't show, so its column asks
  for its 30 beats at most and its newest 12 at least. With a
  stale status (`stale`), a failing or pending check is `unknown-solid`, as
  a stale meter's fill, and a healthy one the faint `beat-quiet` bar: the
  strip keeps its shape and where the failures were, with no level colour.
  `DetailHeartbeats` is the drawer's "Heartbeats · last 50" section (the
  phone sheet's "· last 30", `lg`), how often the checks come at its end in
  12px `text-3`, as the mock's "every 30 s"; its beats give up width, to
  4px, before the strip would overflow a narrow screen.
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
  lines. A detail in words that is cut short keeps its whole line, with the
  meta after it, in its `title`, only while it is cut (#578: a failed job's
  error; `lib/cut.js` measures it as the row resizes). The detail is `text-1` when healthy and the state's word colour
  otherwise; a critical row is tinted `crit-tint` from 672px, as the Overview
  board's (the Phone board's list leaves it plain). `row-hover` under the
  pointer, over the tint. `muted` (#300, the Overview's Services list) quiets
  a healthy row: its detail in `text-2`, so a failing row stands out; any
  other state keeps its colours. `where` (#300) follows the name in its
  column, in 12px mono `text-3`, and gives way (an ellipsis) before the name
  does.
  A Compose stack (#642) is one EntityRow with `stack`: a pill after the name
  (`border-border` on `surface-2` in `text-2`, a 12px stack glyph and "+3"),
  which with a failing member reads "+3 · 1 down" in that level's tint and
  word colour (`crit-tint`, `warn-tint`), beside the node's name when there is
  one. The row's lamp, word and detail are the rollup's: Degraded, the failing
  member named in the detail ("Immich Redis is down"), the row on `crit-tint`
  from 672px when it is critical.
- **DetailStack** (the stack panel, #642). Under the detail's status box (the
  rollup: the word "Degraded" and the failing member named, and "3 of 4
  containers running" under it), the lead's heartbeat strip and response time
  (the drawer's own), then the overline "Containers · 4" with, at its end, a
  Select ("Set lead…") and a secondary "Ungroup"; then a divided list, one
  line per member: its lamp, its name semibold with LEAD (accent tint) on the
  lead, its state under it ("Running", or the model's reason in its state's
  word colour), its image and node in 12px mono (wrapping anywhere), and, at
  the end, a small secondary Details and, for a member that doesn't lead, a
  ghost "Split out". Primary "Open <stack>" is the detail's own link row. On a
  phone it is the same list inside the sheet (390px: the mono line wraps, the
  buttons stay a column at the end).
- **FactList.** The detail drawer's facts: a label column in `text-3` and a
  value column, semibold in `text-1`, 10px between rows and 12px between the
  columns. From 384px of its own container it is the Overview drawer's (a
  130px label column, 13px on the mock's 20px line); narrower, the Phone
  board's detail screen (120px, 14px). Labels wrap in their column, values in
  theirs, and a value with no break in it (a URL, a SHA, a hostname) breaks
  anywhere (`wrap-anywhere`) rather than run past its column or a drawer's
  edge (#289). Without facts it draws nothing.
- **The detail's parts** (`entity-detail.jsx`, #310). What the detail drawer
  and the phone's sheet (web look) draw under the status box, the mock's
  drawer order: a node's meters (`DetailMeters`, two to a row, as the
  phone's Node detail; a pool's caption, "851.2 / 900.0 GB · lvmthin", in
  12px `text-3` under its meter), the facts (`DetailFacts`: with a stale
  status their values in `text-2` and "Last known 3 min ago" under them in
  12px `text-3`, #480), then `DetailSections`, each
  under an overline heading in `text-3` with a short `aside` at its end
  ("2 / 3 running"), 8px under it, sections 20px apart as the drawer's body
  sets them. A Proxmox node's machines (`DetailVms`) are a framed list on
  `surface-1` (the Services list's frame): the name semibold, its size under
  it in 12px `text-3`, and what Proxmox says it is doing at the end in words,
  `text-2` running and `text-3` otherwise, never a status colour: the model
  judges no VM. `DetailUnread` is a Banner in no signal's tone. `DetailLinks`
  is the mock's row of links: the primary button (the thing's own, "Open
  Jellyfin"), secondary buttons (Netdata, Uptime Kuma), and a ghost
  settings link at the end ("Node settings", the header's settings icon); a
  link out has the mock's external-link icon. A job's last runs
  (`DetailRuns`, #578) are the same framed list: each run's lamp (10px,
  named by its word), its time in 12px mono `text-1`, its word in its state's
  `fg` beside it when it didn't succeed, how long it took in 12px `text-3` at
  the end, and a failed run's error under it in 12px mono in its state's
  `fg`. A note above the list (an overdue job's "Last report 31 h ago ·
  expected every 24 h") is 13px in its state's `fg`. `DetailRemove` is the
  `danger` button "Remove…" behind a `Confirm` (the thing's name, where it
  is, what removing does; Cancel first); a Remove that failed is a critical
  Banner over the button, saying why.
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

### EventStrip (chart kit, #750)

A timeline of discrete events, one row per entity, on a time axis: what
restarted or was OOM-killed, and when (the Monitoring section's chart 7).
`@ui/event-strip`, hand-rolled SVG, no dependency.

| Prop | |
| --- | --- |
| `label` | its name; required |
| `rows` | `[{ key, name, slot?, events }]`, each event `{ key?, time, kind, detail? }`; a row with no event between `from` and `to` is not drawn |
| `kinds` | `[{ key, word, shape }]`, `shape` one of `circle`, `diamond`, `triangle`, `square`, `cross`; by default `restart` (a circle) and `oom` (a cross) |
| `from`, `to` | the axis (ms); without them it fits the events. Give a `ChartGroup`'s charts' own |
| `tickEvery`, `formatTick`, `formatTime` | as the Chart's (15 minutes, HH:MM) |
| `rowHeight`, `height` | a row's (28) and the not-drawn states' (64) |
| `state`, `detail`, `failedText` | `ready`, `loading` or `failed`, as the Chart's |
| `emptyText` | the caller's words when no event is in range ("No restarts or OOM kills in the last 24 hours"), never an empty plot |

- **Marks.** A kind is told by its **shape** and its word, never by colour
  alone: 5px-radius filled shapes ringed 1.5px in `surface-1`, a cross two
  2.5px strokes. The colour is the **row's chart slot** ([Chart
  colours](#chart-colours)): its `slot`, or its place in the list, so an entity
  has the colour it has in the line charts. A seventh row is drawn in `text-2`.
  Status colour never draws a mark, an OOM kill included.
- **Axis.** Rows are named at the left in 12px `text-2` (cut at 160px), marks
  sit on the row's centre, a `border` hairline under each row and a
  `border-subtle` one at each time tick. The ticks come from the Chart's
  helpers (`timeTicks`, `evenTicks`, `lib/chart.js`). Inside a `ChartGroup` it
  takes the group's three columns as a subgrid like a Chart, so its plot
  starts at the same x and is as wide as the charts' above it. A legend over
  the plot names each kind drawn, in its shape (in `text-2`, not a slot).
- **Under the pointer, or with the keyboard on it**, the event gets a ring
  (2px `text-1`), a `border-strong` hairline through the plot and a tooltip
  (the Chart's frame): the time in `text-2`, the kind in bold with its shape
  and the entity's name, then the detail. A pointer finds the nearest mark
  within 14px; a finger shows it too and lifting hides it.
- **Accessibility.** The plot is an image named by `label` and described by a
  count ("3 events in 2 rows, latest 08:40. The arrow keys step through
  them."). Beside it a text list (`sr-only`, one item per event, in time
  order: "worker: Restart at 08:25, exit 1") holds every event, so nothing
  lives only in the marks or the tooltip. Tab reaches the plot and focus marks
  the latest event; the arrows step through the events in time order, Home and
  End jump, Escape hides the marker, and a polite live region says each event
  the keys reach. The tooltip is hidden from assistive tech. Not drawn, it is
  an image named by `label` and what it says ("Restarts and OOM kills, last
  hour: No restarts or OOM kills in the last hour"). Without a `label` it
  throws in development and logs in production.
- **Gallery** (`event-strip`, `event-strip-crosshair`): flagged (three
  containers and a fourth with no events, not drawn, under a Chart on the
  same axis), healthy (nothing in range), loading, failed, and the keyboard
  on the latest event.

### SmallMultiples (chart kit, #749)

One small line chart per entity on a shared scale: which node's CPU is off,
which node's memory is under strain (the Monitoring section's charts 4 and 5).
On a phone the same cells are list rows with a sparkline. `@ui/small-multiples`,
built on the Chart and the Sparkline, no dependency.

| Prop | |
| --- | --- |
| `label` | its name, such as "CPU by node, last hour"; required |
| `cells` | `[{ key, name, points, slot?, thresholds?, band?, also?, seriesName?, highlighted? }]`, `points` as the Chart's; `band` (#756) is the max band `{ name?, points }`; `also` (#757) is more lines in the same cell, `[{ key, name, slot, points }]`; `seriesName` names the main line in the legend; `aside` (#759, a string) is a second line of words under a phone row's reading, said in its name too |
| `scale`, `domain`, `zero` | `shared` (default): one axis from every cell's lowest to highest reading and every threshold line; `zero` starts it at 0. `domain` `[lo, hi]` fixes it. `scale="own"` fits each cell to itself, only when the caller says they are not comparable |
| `thresholds` | the Chart's (#746), the caller's from `status/thresholds.js`; a cell may bring its own |
| `variant` | `grid` (default) or `phone` |
| `onOpen(key)` | a grid cell's name and a phone row are buttons that open the cell's full chart (the CPU drill-down, #756). Each cell carries `data-key` (its `key`), so a caller finds the row to return focus to when the chart closes (#833) |
| `state`, `detail`, `failedText` | `ready`, `loading` or `failed`, as the Chart's |
| `formatValue`, `formatTime`, `formatTick`, `tickEvery`, `height` | the Chart's; `height` is a cell's plot (96) |

- **Grid cell.** A `surface-1` card: the entity's name (bold, cut with an
  ellipsis) and its latest reading at the right, over a Chart of one series.
  The line takes the entity's chart slot (`slot`, else its place in the list;
  a seventh onwards slot 1), never a status colour. Columns follow the
  component's own width: one, two from `sm`, three from `3xl`.
- **Latest and flagged.** A reading at or past a threshold gets its word
  ("Warn", "Critical", bold in the status `fg`) before the figure; the lines
  and their words are the Chart's, and the worst line wins. The colour never
  carries it alone.
- **No data.** A cell with no reading says "No data" in place of its plot, and
  a newest point that is a gap says "No reading": a node that is off is a gap,
  never zero. It does not move the shared axis.
- **Highlighted** (`highlighted: true`, or a string for the tag's words, such
  as "Critical · 96 % busy"): the selected ring (`accent`, 1.5px inset: violet
  means selected, never status) and a tag in the header ("Selected" by
  default); on a phone row the tag sits on its own line under the name and may wrap (#806). The caller scrolls to and focuses the cell; the ring clears when it
  stops passing `highlighted`.
- **Phone rows.** A list, each row at least 44px tall: name and latest over a
  96 x 24 sparkline (slot 1, decorative, on the shared axis). With `onOpen` the
  whole row is a button named "Media, Critical, 95 %. Open the chart"; a row
  without data has no sparkline. A highlighted row has the ring and the tag, on its own line under the name. A cell's `aside` (#759) is a second
  line of words under the reading, such as "Swap 12 %", for a figure the sparkline does not draw;
  the grid's Chart ignores it.
- **Loading and failed** are one placeholder or message for the whole set (the
  Chart's words), never cells that look healthy.
- **Accessibility.** The list is named by `label`; each grid cell's Chart is an
  image named "<entity>, <label>" with the Chart's text summary and keyboard
  crosshair (one tab stop per cell). A no-data cell is an image whose name ends
  "No data".
- **Gallery** (`small-multiples`, `small-multiples-phone`): healthy, flagged,
  a no-data cell, highlighted, loading and failed; the phone list in the same
  states.

### MonitoringSection (Monitoring page, #751)

A part of the Monitoring page, named by a plain-language heading that says
what its charts answer. `@ui/monitoring-section`: `MonitoringSection`
(`title`, `question`, `loading`; children are the charts) and `MonitoringNote`
(a polite one-line notice over the sections).

- **Look.** The title is an h2 at `title-xs` in `text-1`, the question under
  it in 12px `text-3`; the section is a region named by the title, its charts
  (Panels with an h3 each) 12px apart under it. The note is 12px `text-2` on
  `surface-1` in a subtle edge, `rounded-lg`.
- **Loading.** One still Skeleton block where the charts will be, the section
  `aria-busy`, and "Loading Resources" for screen readers, once.
- **A failed chart is its own Chart's** (`state="failed"`, the server's fixed
  sentence as `failedText`), never this note; the note is for a read that
  failed as a whole.
- **Gallery** (`monitoring-section`): a section with a chart and a failed
  chart, a loading one, and the note.

### Monitoring banner and chart focus (#752)

The top of the Monitoring page is `ShellAttention` kept (`only`) to the
status model's issues that a drawn chart answers, each row with a **View
graph** link (`AttentionPanel`'s issue `action`) to
`/monitoring?focus=<chart-id>`; "N other issues" with a link to Alerts counts
the rest. Healthy, nothing is drawn: the page is just the charts.

- **Parts.** `@ui/monitoring-section` also exports `MonitoringBannerFrame`,
  `MonitoringOther` (the "N other issues" line), `ChartFocusTag` (lamp and
  words) and `chartFocus(focused, tag)`, the Panel props of a focusable chart.
- **Which chart.** `server/monitoringFocus.js` is the one table (`FOCUS`,
  `chartOfIssue`). A card that builds a chart gives it the id written there.
- **Focus.** The chart scrolls under the header (`scroll-mt`), takes keyboard
  focus, and has a 2px `accent` ring (violet is selected, never status) and
  a header tag of the issue's lamp, word and reason, so it is not colour alone.
  A polite live region says it. The next press or Escape clears it and takes
  `focus` off the address. Reduced motion scrolls at once. A chart not drawn
  gets nothing, quietly.

### Bar charts

`RankedBars` and `DailyBars` (Monitoring, #748), hand-rolled SVG with no new
dependency. Both are one series by design, so every bar is slot 1, azure
([Chart colours](#chart-colours)); a bar is never a status colour and is not
recoloured when its row is flagged, and neither draws the accent. Neither
puts a bar on `surface-3` (their loading placeholder is the one `surface-3`
block, and it is not a series).

- **RankedBars** draws horizontal bars in the order given (the caller sorts:
  days left soonest first, growth biggest first), 10px tall, from 0 to `max`,
  against a `border-strong` hairline. Every row prints its value as text in
  `text-1` semibold, right-aligned; a missing one says "No data" and draws no
  bar. A row with `state` gets a status lamp before its name (shape and word,
  rule 3); rows without one keep the name column aligned. A row with `points`
  gets a Sparkline at its right (slot 1, 72 × 20, `decorative`, auto domain).
  The chart is one image, named by `label` and described by every row in
  words (rank, name, value, status word), so the lamp and sparkline never
  carry anything alone. Focus starts at the first row; the arrows, Home and
  End move a `row-hover` highlight, Escape clears it, and a polite live
  region says each row.
- **DailyBars** draws one bar a day from 0, 64 % of its slot wide and at most
  28px, on a value axis stepped so no two ticks print alike, with day labels
  every few bars counting back from the newest. The pointer's day (never a
  finger's) gets a hairline and a tooltip: the day, the value in bold, and
  the extra line the caller passes in that day's `note` (the electricity rate
  in force). Same keyboard reading as the Chart: focus starts at the latest
  day, the arrows, Home and End move, Escape hides the tooltip.
- **A partial last day** (`partial`) is drawn lighter, a 40 % slot-1 fill
  inside a dashed 1.5px slot-1 outline (the outline keeps the 3:1 a graphic
  needs; the fill alone would not). Its tooltip, its reading and a line under
  the plot say "so far" after its value, so a short day is not read as a
  cheap one.
- **States** for both: `loading` is a placeholder, `failed` says
  "No data from Prometheus" (or `failedText`, with `detail`), never an empty
  chart that reads as healthy, and an empty `rows` or `days` says `emptyText`.
  The gallery's `ranked-bars`, `ranked-bars-keyboard`, `daily-bars` and
  `daily-bars-tooltip` show them.

### StatTile and the power charts (Monitoring, #753)

`StatTile` (`@ui/stat-tile`) is one figure a chart doesn't draw: a 12px
`text-2` label, the figure at `title-sm` in `text-1` with tabular numerals, an
optional 12px `text-2` note ("so far", "since the 2nd", "at the current
load"), on `surface-2` in a `border` edge, `rounded-lg`. It carries no status
colour (a figure is not a verdict) and no chart slot. It is a group named
"label: value, note"; with no value it says `emptyText` ("No reading",
"Not enough days yet"), never 0.

`@ui/chart-body` holds the parts around a plot that the shell screens would
otherwise need utility classes for: `ChartBody` (a Panel's content, 12px
apart), `ChartNote` (a 12px `text-2` line under the plot), `ChartLink` (accent
text, underlined on hover and focus); `StatTiles` lays tiles two to a row. `ChartToolbar` is the row above a plot for a control and its label (the disk runway's node picker, #754).

The two power charts (`monitoringDrawings.jsx`) put their tiles over the plot:
*Power draw* the UPS runtime and the range's average, then the line (slot 1,
fitted axis, the max band on 7 d and 30 d), a line of lowest and highest, and
the footnote; *Monthly cost* month to date and projected month, then daily
bars in the configured currency symbol (the rate in force and the hours read in
each day's tooltip), today lighter and "so far", and the same footnote. Their
words for the states that have no plot: **No UPS data** (an empty state, no
line at 0 W), **No electricity rate set** (kWh in the tiles, an empty state
with a link to Settings → System → Energy cost), the server's fixed sentence
when Prometheus failed. Gallery: `stat-tile`, `monitoring-power-draw`,
`monitoring-monthly-cost`.

### DrillChart (chart kit, #756)

`DrillCharts` and `DrillChart` (`@ui/drill-chart`) are the charts in a
drill-down sheet. `DrillCharts` is a ChartGroup, so its charts share one time
axis and one value-label width, and every plot starts at the same x. Each
`DrillChart` is a 12px `text-2` title (an h3) over a Chart, with the Chart's
props passed through. With `empty` and no series in the ready state, the
caller's words stand in for the plot, never an empty plot that looks healthy.
A failed chart is the Chart's own failed state with its `failedText`. Its
`name` is the chart's key, kept as `data-chart`.

### CPU by node and the drill-down (Monitoring, #756)

`cpu-overview` is small multiples: one cell per visible node on one 0 to
100 % axis, with the warn line from the threshold table, and on 7 d and 30 d
the max band behind each line (an average hides a spike). A node that is off
keeps its cell, says "No data" and is named in a note under the cells; a step
it missed is a gap, never 0. A cell's name opens a drawer with the node's I/O
wait and its temperature, each with its warn and critical lines and the max
band on long ranges. The drawer asks for nothing: its parts come with the
cells. A part that failed says its own sentence and leaves the cells alone; a
node with no sensor says so in words. From the banner, View graph marks the
node's cell (the selected ring and its tag), and a temperature issue opens the
drawer. On a phone the drill-down is not a Drawer but a `PhoneSheet`
(`src/shell/drillSheet.js`, #833), like a row's detail sheet: a history entry
of its own (kept in `history.state`, the address unchanged), so the browser's
Back closes it, and focus returns to the row of its node, the ringed one after
a View graph. A View graph marks its own entry (`jaghelmDrilled`) before
pushing the sheet's, so Back to it, however the sheet was closed, leaves the
sheet closed. While the sheet is open a press in it does not clear the ring of
the chart under it, so closing the sheet rings and scrolls nothing again: focus
is on the row, the ring stays until the next press on the page.

### Memory and swap by node (Monitoring, #757)

`memory` is small multiples like the CPU chart: a cell per visible node with
two lines on one 0 to 100 % axis, memory in use and swap in use, and the
memory warn line. A node that is off says "No data". A node with no swap keeps
its memory line and a note names it; there is no flat swap line at 0 %. A
failed swap read says its own sentence under the cells and leaves the memory
lines as they are. The banner's memory issues open this chart, and the node's
cell takes the selected ring. On a phone it is rows, with swap in words under
memory's figure and a sheet with both lines ([Monitoring on a phone](#monitoring-on-a-phone-755-759-763)).

### Network (Monitoring, #758)

`network` draws one node at a time. A Select (shown with two or more nodes,
starting on the first) picks it, and its traffic is a mirrored AreaChart: in
above the zero line, out below, on one symmetric axis. The axis and tooltip
print B/s, KB/s, MB/s or GB/s. A missing step is a gap. With no readings for
any node the chart says "No network readings" in words; a failed read says the
server's sentence. Loopback, bridges, veths, VPN tunnels and VLAN
subinterfaces are left out of the sums, as discovery leaves them out of a
container's.

### Disk runway (Monitoring, #754)

`disk-runway` is ranked bars, one row per node (its fullest mount), soonest
full first, each with the Settings warn and critical lamps. A row with no date
says why in words and draws no bar and no number: "No signal" (the node is off
or not scraped), "Too irregular to forecast", "Not enough history", "Not
filling", or "Over a year" while it still grows. Picking a node in the
drill-in (a Select in a ChartToolbar) draws the disk's fitted trend over the
last week, and a dashed projection (a Chart series with `dashed`) from now to
the disk's size, with a sentence giving the date. The client forecasts
nothing: the line is the server's fitted slope from the disk forecast.

### Container restarts and OOM kills (Monitoring, #761)

The `restarts` chart is the EventStrip above, one row per container that had
events. The busiest twelve are drawn (`MAX_STRIP_ROWS`), in name order; the
rest are counted in a note. A container name shared by two nodes is shown with
its node. Under the strip, notes say in words what the source cannot show: a
node with no container readings, no OOM counter, containers left out, and a
list cut short. State `no-containers` is its own empty state, never "no
restarts". The chart's footnote says what the source cannot see.

### Container memory growers (Monitoring, #760)

`container-growth` is ranked bars: the ten containers whose working set grew
most over the last 7 days, always 7 days whatever the page's range, each with
its week of working set as a row sparkline. Growth is written as "+1.0 GB" or
"+240 MB". Without the rule's series the chart says "Not available" with the
cause (`GROWERS_UNAVAILABLE`: no rule, or no containers at all). No container
grew is "No container grew over the last 7 days", not an empty list.

### Drive health (Monitoring, #762)

`drives` lists each node's drives as a table (`DriveTable`: the lamp and word,
the drive and its model, its kind, its temperature, and the reason when it is
not healthy) and its RAID arrays (`RaidTable`: members active against those
needed). Temperature gets a chart per kind, NVMe and SATA, with that kind's
warn line (dashed) and critical line (solid). Nothing is judged here: the
lamps, words and reasons are the status model's, passed through. A node that
can no longer be seen says "No signal" and keeps its last known state, with a
note. The states in words are drive monitoring off, no smartctl exporter, not
read yet, and Prometheus failing. The chart is titled "Drive health" because
the section is "Drives", and two landmarks with one name fail axe.

### Monitoring on a phone (#755, #759, #763)

Below 768px the Monitoring page is the phone's own page at the same address,
reached from the More sheet, where it is the first entry (the five tabs stay).
It has the title, a 44px range switch (1 h, 24 h, 7 d, 30 d), the banner, then
the sections as one column of Panels. The read, the banner, the focus ring and
its tag are the wide page's (`src/phone/views/Monitoring.jsx`, its own chunk).
So is the chosen range (`useMonitoringRange.js`), so crossing 768px keeps it.
It is kept for the life of the tab: leaving Monitoring and coming back shows
the range last chosen, not 1 h. A
chart without a phone body is not focusable: `?focus=` of it is quiet, as on the
wide page for a chart not drawn. A memory issue's View graph opens the node's
sheet, as a temperature issue opens CPU's drill-down. Both are PhoneSheets
with a history entry of their own (#833): Back closes them and focus returns to
the node's row.

- **Each chart's phone body** is `PHONE_DRAWINGS[id].Body`
  (`src/shell/monitoringPhone.jsx`), the same shape as the wide page's
  `DRAWINGS` entry. Where the wide page draws small multiples (CPU, memory) the
  phone draws list rows: a row per node with its latest figure over a
  sparkline, and a tap opens the chart (CPU's drill-down; memory's sheet with
  memory and swap). Swap is said in words under memory's figure ("Swap 12 %",
  "No swap", "Swap could not be read"), since a sparkline draws one line.
- **Fluid charts** (power draw, monthly cost, disk runway, network, container
  memory growers, restarts) are the wide page's body in one column.
  `hideEndLabelsWhenNarrow` is opt-in: only the disk runway's projection sets
  it, so its legend names the lines at a phone's width.
- **Drives** are list rows, not tables: `DriveList` and `RaidList` (see Data
  components). Each drive row is its lamp and word, device, model, kind,
  temperature, and the reason in full when it is not healthy. The words are
  the table's, and nothing is judged on the phone.
- **The banner** offers "View graph" only for a chart with a phone body. An
  issue whose chart has none counts under "N other issues". Every chart has
  one today. `PhoneNotYet` is the fallback for a chart added without one: a row
  of words, "This chart is not on the phone yet. Open Monitoring on a larger
  screen to see it.", never a blank Panel.
- **Gallery** (`monitoring-phone`, `monitoring-phone-states`,
  `monitoring-phone-resources`, `monitoring-phone-containers-drives`,
  `monitoring-phone-containers-drives-states`).

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
- **Chart** (#311): its plot is an image named by `label` ("Usage, last
  hour") and described by each series' latest, lowest and highest readings,
  so nothing lives only in the tooltip. Tab reaches it, and focus puts the
  crosshair on the latest time; the arrows, Page Up and Page Down (ten),
  Home and End move it, and a polite live region says each time they reach
  with every series' value ("08:45: CPU 30 %, Memory 35 %"), so the tooltip
  is hidden from assistive tech. Escape hides it. The axes, legend and end
  labels are hidden too: the name and description say what they show. Its
  focus ring goes around the plot, never on a line. Not drawn, it is an
  image named by its label and what it says ("Usage, last hour: No data from
  Prometheus"). Identity never rests on colour alone: names in the legend and
  at the lines' ends, and past three lines a dash per slot. Without a
  `label` it throws in development and logs in production.
- **DetailCharts** is a `section` named by its heading ("History"); the
  range switch is a radio group named "Range", each chart's title an `h4`.
- **UptimeBar** is an image named by its summary, "Heartbeats: 5 failures in
  the last 30 checks, including the latest", counting only checks with data
  (with none, "No data in the last 30 checks"; with no checks, "No checks
  yet"). On a phone-width row it shows 12 beats and still sums up them all.
  The name is hidden text inside it, so an EntityRow holding it is described
  by it. Its checks' tooltip opens under the pointer, never on touch, and is
  hidden from assistive tech. Inside a row that opens it is no tab stop (a
  control inside a control); `focusable` (the drawer's and the sheet's) puts
  it in the tab order, described as "The arrow keys read each check": focus
  starts at the newest check, the arrows, Home and End move, Escape closes,
  and a polite live region says each one ("Down at 14:32:10").
- **EntityRow** is a button (`onOpen`) or a link (`href`) named "name, word" (a stack's, "Immich, stack of 4 containers, degraded: Immich Redis is down": the chip is decorative inside the row, never a tab stop of its own, and focus returns to the row when the panel closes)
  and described by its where, detail, meta (not a dash alone) and trailing
  figure, with a decorative
  lamp; with nothing to open it is plain content and its lamp is named by the
  word. A lamp drawn as no signal beside another word (a stale status's last
  known "Up", #480) is named "No signal" (`lampName`), and so is the row. The
  focus ring is drawn inset.
- **FactList** is a description list: each label a term, its value the
  definition.
- **The detail's parts**: each `DetailSection` is a `section` named by its
  heading (an `h3`, under the drawer's or sheet's title), so a screen reader
  lists "Virtual machines", "Storage pools", "Last backup"; the machines are a
  list; a pool's meter is a `meter` named by the pool. `DetailLinks` are
  links, not buttons: one inside JagHelm opens in the page on a plain click
  and a modified or middle click is the browser's; one opening a new tab
  says so to a screen reader.
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
- **The detail's parts** (#310): the mock's drawer has a node's readings as
  facts ("CPU 9 %") under its chart; the drawer draws them as meters, as the
  phone's Node detail and the node card do, so a reading over its line shows
  its level. The mock has no Proxmox lists, container figures, integration
  stats or settings link: they follow its drawer's sections (an overline
  heading, a FactList) and its row of links.
- **The history charts** (#311): the mock's drawer has one chart ("CPU ·
  last hour", a 1.75px line in the accent's `meter`, no axes) with a small
  1 h / 24 h / 7 d switch. The drawer draws "History" with the switch as a
  SegmentedControl, then a node's "Usage" (CPU, memory and disk, three lines
  in slots 1 to 3 on one 0–100 % axis) and "Temperature", or the CPU and the
  memory of containers, each with value and time axes and a crosshair, in
  the chart slots, never the accent. The mock's chart has no legend, axes,
  tooltip or failure state; they follow the Chart colours board and the
  Sparkline's tooltip.
- **Not in the mock, derived from it:** the Sparkline's tooltip, its keyboard
  and its active dot; UptimeBar's `warn` beats, maintenance kept quiet, and
  its `md` and `lg` sizes (the drawers' beats); its checks' tooltip, their
  keyboard and a stale strip's steel (#312); FactList's switch between the
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
| `AppHeader` | `@ui/app-header` | `name`, `logoUrl`, `status` (`{ reach, state, word, sentence, href, current, lastKnown }`), `updated` (an element, `UpdatedAgo`), `onOpenPalette`, `shortcut`, `onThemeChange` (the toggle, given `'light'` or `'dark'`), `onEditLayout` (the Overview's Edit layout toggle, #330) and `editingLayout` (whether it is on), `settingsHref`, `settingsCurrent`, `onLogout`, `onNavigate` |
| `PhoneHeader` | `@ui/app-header` | `name`, `logoUrl`, `homeHref`, `status` (AppHeader's, for its live region alone), `onThemeChange`, `onNavigate` |
| `UpdatedAgo` | `@ui/app-header` | `at` (ms since the epoch) |
| `SideNav` | `@ui/side-nav` | `groups` (`[{ id, label, items }]`), `collapsed`, `onCollapsedChange`, `onNavigate`, `label` |
| `NavGroups` | `@ui/side-nav` | `groups`, `collapsed`, `onNavigate`: the list alone, as the phone's More sheet uses it |
| `BottomTabs` | `@ui/bottom-tabs` | `tabs` (`[{ id, label, short, icon, href or onClick, current, badge, expanded }]`; `short` the word drawn when `label` won't fit a fifth of a phone), `onNavigate`, `label` |
| `AppBar` | `@ui/app-bar` | `name`, `monogram`, `url`, `href` (Open in new tab; none, no link), `onReload` (none, no button) |

A nav entry is `{ id, label, href, icon or monogram, current, badge, loaded,
onUnload, minor }`, or an action, `onClick` in place of `href` (More's Log
out, #569), a button drawn as the links are; a badge is `{ count, state, label }`, its `label` the count
in words ("4 issues"). `onNavigate(event, href)` handles a link's click: the
router's `followLink`, which leaves a modified or middle click to the browser.

### How the shell looks

From the mock's Main and Phone boards:

- **AppShell.** The header runs the full width at the top, sticky (`z-header`).
  From 768px the sidebar sits under it, sticky, the window's height, scrolling
  on its own; below 768px the bottom tabs are fixed to the bottom edge, and the
  page keeps 64px clear above them. That width is `PHONE_WIDTH` (`@ui/app-shell`,
  `(width < 48rem)`, Tailwind's `md`), the one value for a part that changes
  its markup there, such as the phone screens (#303). Each piece of chrome is a `UiRoot`; the
  page, `<main>`, is not, so today's views inside it keep their look
  ([ARCHITECTURE.md](ARCHITECTURE.md), "UI stack"). A `ShellPage` is its own
  root: the page gutter (16, 24, 32px by width), at most 1024px wide, its
  title in `text-title`, its description in `text-2`. A `ShellSection` is a
  root too, with no gutter or background of its own: its children stacked
  24px apart, as a ShellPage stacks them, in a page that is still today's
  (the Overview's status and subsystem strip, #297, #298, and each of its
  sections), which shows between them.
- **AppHeader.** From 768px (below, PhoneHeader) (with `onEditLayout`, on the Overview only, an Edit layout toggle before the theme toggle: an IconButton with the panel-top icon, `aria-pressed`, in the accent tint while the mode is on; the panel it opens is `LayoutEditor`, below, under "Overview sections"): 48px on `bg`, a subtle
  bottom edge, 24px at the sides, 16px between its parts. The brand: JagHelm's
  shield (`public/logo.svg`, the favicon's artwork, #530), 28px, or the
  instance's own logo; the name in 15px extra-bold. The status: a 14px lamp,
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
  `caption` `text-3`. From 1024px the search button is the mock's:
  `surface-1` in a subtle edge, `text-3`, the shortcut in a mono `kbd`, 240px
  (280px from 1280px); narrower, a ghost IconButton. Then the mock's theme
  toggle (#304), a ghost IconButton: a sun, "Switch to light
  theme", in dark, a moon, "Switch to dark theme", in light, read from the
  root it is drawn in. Settings and Log out are ghost IconButtons; Settings,
  when open, takes `accent-tint` and `accent-text`, as a selected nav entry
  does.
- **PhoneHeader** (#569). Below 768px the shell draws the Phone board's
  header instead: 56px on `bg`, a subtle bottom edge, 16px at the sides,
  10px between its parts. JagHelm's shield (or the instance's own logo,
  `rounded-lg`) at the mock's 30px, on its own: the mock's mark sits in a
  30px accent tile, but the shield's indigo on the violet tile reads muddy
  at 18px. Then the name, the wordmark, in `title-sm` extra-bold with
  -0.01em tracking, cut short before the toggle; mark and name are one link
  to the Overview. Last, the theme toggle at the mock's 44px, a 20px icon,
  `text-2`. No status, search or Settings: the Overview's card says the
  status, Services has its own search, More holds Settings and Log out.
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
  `solid` with its `on-solid` figure, as the mock's. A label too long for a
  fifth of a 360px phone draws its `short` word ("Infra"), the tab keeping
  its whole name.

### Accessibility of the shell

- **Landmarks.** The header is the page's `banner`; the sidebar is the
  navigation "Main" and the phone's tabs the navigation "Tabs" (only one shows
  at a width); the page is `main`; an open app's frames are a region named
  "<app>, open inside JagHelm". The sidebar's groups are `group`s named by
  their labels.
- **Names.** A nav entry's name is its label, then its count and whether it is
  loaded ("Alerts, 4 issues", "Netdata, still loaded"); collapsed, the same
  name shows as a tooltip. The header's status is one link, "Critical: 1
  service down · …". Beside it, a polite live region (`sr-only`) announces a
  change of state, never a tick of an age: the link's words while there is a
  signal, else "No signal" and why ("No signal: Can't reach JagHelm"),
  without the "last known 3 min ago" line, whose age moves each second
  (#480). It is the same element from the placeholder ("Checking status") to
  the first status, so that is announced as a change. PhoneHeader keeps
  the same live region, with the same words, and nothing else of the
  status. The
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
- **The phone's header is the Phone board's** (#569) but for its mark,
  JagHelm's shield on its own rather than the mock's wheel in an accent tile
  (#530), the wordmark at 16px rather than 17 (the type scale's step, above),
  the toggle's corners at 8px rather than 10 (shown only under the pointer
  and on focus), and the toggle's tooltip.
- **The theme toggle sits between the search and Settings**, as the mock's
  sits beside the search (the mock has no Settings link in the header). It
  switches dark and light; system is Settings → Appearance's (#304).
- **No account card at the sidebar's foot**, and no Launch entry yet (#301);
  Settings is in the Tools group rather than pinned to the bottom.
- **Phone tabs: Overview, Services, Infrastructure, Alerts and More**, as the
  mock's (#303); the sidebar's Monitor group is the mock's too, Overview,
  Services, Infrastructure and Alerts, each tab and entry at the same
  address (#313).
- **Labels are 12px, not 11px** (the type floor), and the phone's count is the
  mock's solid; the sidebar's is the mock's tint.
- **JagHelm's shield, not the mock's wheel** (#530): the mock drew a wheel on
  an accent square as the brand mark; the header shows JagHelm's own logo, as
  the favicon does.

## Overview sections

The Overview's sections in the new UI, one file each in `src/ui/`, built on
the components above; `src/shell/` feeds them the status model
([ARCHITECTURE.md](ARCHITECTURE.md), "The Infrastructure section", "The
Services section", "The Jobs section"). The [gallery](GALLERY.md) shows each in its states (group
Overview), and `e2e/infrastructure.spec.mjs` and `e2e/services.spec.mjs` run
them in a browser. The Services and Infrastructure pages (#313) are the same
two sections with a row of filters, `ListFilters` (gallery group Pages,
`e2e/pages.spec.mjs`).

| Component | Import | Props |
| --- | --- | --- |
| `InfrastructureSection` | `@ui/infrastructure-section` | `nodes` (each `{ id, anchor, name, host, subtitle, colour, state, word, reason, readings, services, uptime, trend }`), `count` ("3 nodes · 1 warning"), `view` (`cards` or `table`), `onViewChange` (none, no toggle), `loading`, `banner`, `toolbar` (a page's filters, under the heading), `empty` (in place of the nodes when there are none), `title` (`Infrastructure`) |
| `NodeCard` | `@ui/node-card` | `name`, `host`, `subtitle`, `colour` (the user's, a swatch), `state`, `word`, `reason`, `readings` (MetricMeter's props each, with `key`), `services` and `uptime` (the footer's lines), `trend` (`{ points, label, formatValue }`); `onOpen` (its name a button over the card) or `href` (a link; with `onOpen` too, as IssueRow's, #309) |
| `NodeSwatch` | `@ui/node-card` | `colour` |
| `ServicesSection` | `@ui/services-section` | `groups` (each `{ key, title, host, count, rows }`, each row `{ id, anchor, name, where, state, word, detail, meta, muted }`), `count` ("12 monitored · 1 down"), `grouping` (`node` or `group`), `groupings` (the control's options, `disabled` on one with nothing yet), `onGroupingChange` (none, no control), `groupingHint` (a caption under the control), `showAll` (`{ href, label, onOpen? }`, the panel's last line), `view` (`list` or `table`), `onViewChange` and `table` (a ServicesTable; without both, no toggle: the Overview's), `loading`, `banner`, `toolbar` (a page's filters, under the heading), `empty` (in place of the panel when no group has a row), `title` (`Services`) |
| `ServicesTable` | `@ui/services-table` | `groups` (the section's, each row also `nodeName` and `containerName`), `grouping`; a module of its own, which only the Services page's chunk loads |
| `ListFilters` | `@ui/list-filters` | `filters` (its controls, in order, each `{ kind, id, label, value, onValueChange, items?, width? }`, `kind` one of `search`, `select` (the default) and `segmented`, a Select's `width` `normal` (176px) or `wide` (192px), the first item "every one"), `onClear` (none, no Clear filters) |
| `JobsSection` | `@ui/jobs-section` | `groups` (each `{ key, title, count, rows }`, each row `{ id, name, where, state, word, detail, meta, muted, href?, onOpen? }`), `count` ("7 scheduled · all OK"), `loading`, `banner`, `title` (`Jobs`) |
| `JobsList` | `@ui/jobs-section` | `groups`: the section's panel of groups alone, for a page with its own heading (the phone's Infrastructure) |
| `LayoutEditor` | `@ui/layout-editor` | `sections` (each `{ id, label, hint?, shown, locked?, movable? }`, in order), `onSectionShown(id, on)`, `onSectionMove(id, delta)`, `onSectionReorder(id, index)`; `pinned` and `services` (each `{ id, name, where?, group, groupDisabled? }`), `groups` (a Select's items, `GROUP_NONE` for "No group"), `onPin`, `onUnpin`, `onPinnedMove`, `onPinnedReorder`, `onGroup(id, value)`; `groupName`, `onGroupName`, `onAddGroup`; `query`, `onQuery`, `servicesEmpty`, `servicesNote`; `message` (the live region), `onReset`, `resetDisabled`, `onDone` |

`LayoutEditor` (#330) is Edit layout's panel, above the Overview's sections
while the mode is on (`OverviewEditor` in `src/shell/` holds the
arrangement and loads it as a chunk of its own, so no first load carries it).
It is a Panel titled "Edit layout" (its icon in the accent chip) with a row
of "Reset order and pins" and "Done", the Sections list, and the Services
block: a new group's name, the pinned services, and the rest with a search.
A row is a grip, its name, Move up and Move down (IconButtons, disabled at
the ends), and a Switch or a group Select, so nothing is pointer-only; the
grip is decorative to assistive technology and drags the row with the
pointer. After a move, a pin or an unpin, focus stays on that row's own
button; one polite live region says each change. A row that can't move
(Needs attention, the strip, the rail) has its hint under its name and no
grip or buttons. At a tablet column's width the rows wrap, a Select under
its service's name; nothing scrolls sideways. Gallery: `layout-editor` and
`layout-editor-narrow` (group Overview), `e2e/layout.spec.mjs`.

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
  rows and no count. On the Overview the panel ends, under a subtle rule,
  with the mock's "Show all 12 services →" (13px semibold `accent-text`,
  12px over the panel's padding), to the Services page. On the Services page
  (#313) a second SegmentedControl after the grouping, "Service view" (List,
  Table, Lucide `List` and `Rows3`), and the table in the panel's place.
- **ServicesTable** (#313). The Table component, its hidden caption
  "Services", the rows in the groups' order: service (semibold, a link that
  opens it), node in `text-2`, the custom group while grouped by one, the
  Docker name (`containerName`) in 12px mono `text-3`, the detail (`text-2`
  while up, else its state's word colour, ending in an ellipsis past 288px,
  whole in its title), latency, right-aligned, the heartbeat strip (#312, 30
  checks, `fit`: narrowed before the table would scroll, losing its oldest
  beats down to the newest 12; a dash with no monitor), and state (the lamp and the
  word, as the Infrastructure table's). It needs 800px (Infrastructure's
  720 and the strip's newest 12, #312): in a narrower section, the list and
  no toggle.
- **ListFilters** (#313). A page's filters in one row that wraps, under the
  section's heading row and over its panel, 12px apart, its controls in the
  order given: a search, an Input filling the row (at least 192px), its
  placeholder its name ("Search services"); a Select, 176px (192px wide),
  showing its choice ("All states", "Problems"); a
  SegmentedControl, every option in view; and while any is set, "Clear
  filters", a ghost accent Button with Lucide `X`. The Alerts page's
  AlertFilters is one configuration of it. A filter that leaves nothing shows, in the
  section's place for its rows, an EmptyState in a Panel ("No services match
  these filters", how many there are, and Clear filters).
- **JobsSection** (#578). The mock draws no jobs list, so it is drawn in
  its sections' style, the Services section's: the heading row with the
  icon (Lucide `CalendarClock`) in a 32px accent chip, "Jobs" and the count
  ("6 scheduled · 2 failed · 1 overdue · 1 no signal"); then one panel, two
  groups, Jobs then Backups, each heading an overline with the model's count
  ("3 / 3 OK") at its end. A row: the lamp, the name, the node in 12px mono
  `text-3` beside it, the schedule in words while it is well, else the
  model's reason, and how long ago it last reported as the meta ("3 h ago").
  Healthy rows are muted; a failed backup is critical and tinted, a failed or
  overdue job a warning. Narrower than 672px the rows are the Phone board's,
  the name over "detail · last report". While loading, three placeholder
  rows and no count. With every job it listed removed (the model not yet
  told), "None left to list" in 13px `text-3` under the heading, which takes
  focus from a script: where focus lands when the last row is removed. The
  Overview's Power section (#306) is the same section with its own `title`
  ("Power") and `icon` (Lucide `Zap`): the UPS's row in one group, "UPS",
  its charge as the detail while it is well, else the model's reason, and on
  battery the minutes left as the meta; the heading counts it as the strip's
  Power tile does ("On mains").

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
  3 min ago"). Jobs rows the same.
- **A job's state is the model's** (#578). Its lamp, word and reason are
  its entity's, so a failed backup is critical and a failed or overdue job
  a warning (one severity table, ADR 0006); the section never colours a row
  by its schedule or its age.

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
- ListFilters is a group named "Filters": the search a searchbox named by
  its placeholder's words, each Select a combobox named by its filter
  ("State", "Node"), a segmented one a radio group ("Severity"). On the
  Services page the view is a radio group,
  "Service view", and the table's row header is the service's name, a link
  to its detail.
- The Services section is a region named by its heading; the grouping a
  radio group, "Group services by"; each group a list named by its heading
  (an `h3`); each row a link that opens its detail (#309, #310), its lamp
  named by the word, or "No signal" under a stale status. A page links to a
  service by its row's `id`, and the row takes focus when a link lands on it.
- The Jobs section is a region named "Jobs"; Jobs and Backups lists named
  by their headings; each row a link named "name, word" ("db-dump, Failed")
  and described by its node, detail and last report. When a Remove closes a
  job's detail, focus lands on the row after it (or before it), its own row
  having gone.

### Where the Overview sections differ from the mock

- **The sparkline is azure, slot 1** (the data components' rule), and is the
  card's last hour of CPU; the mock's footer drew it in the meter's violet.
- **The footer has two lines**, the services ("3 / 3 services up · 1 down")
  over the uptime, where the mock has one ("42 / 42 containers · up 6 d"):
  the model counts services, not containers, and the card is narrow on a
  phone.
- **No table on a phone.** The mock draws the table on its desktop board
  only; below 720px of section the cards stand in and the toggle goes.
- **The table's Services column** is the mock's Workload (the hosted
  services' counts), and its Role is services.yaml's `subtitle` for the node.
- **Services: no heartbeat strip, no chevron, no filter box.** The server
  keeps no per-monitor history yet (#312), a row's detail is its drawer
  (#310), and the search is the Services page's (#313), a row of its own
  under the heading with the other filters, where the mock's "Filter
  services" box sits in the Overview section's heading row. "Show all"
  opens that page.
- **The pages have no mock of their own** (#313). Each is its Overview
  section, every row, with ListFilters under the heading; the section's
  heading is the page's (an `h1` for screen readers names the page, as the
  Overview's does). Services' toggle reads List / Table, not Cards / Table:
  the Overview's service row is a list row, and a card per service would be
  a second look for it. The Infrastructure page's Proxmox lists are the
  detail drawer's parts (DetailSections), each named by its node, in one
  Panel ("Virtual machines and storage", Lucide `Boxes`).
- **Services: healthy rows are muted**, their detail `text-2` where the
  mock's is `text-1` (spec §8: "Healthy rows are muted").
- **Services: a segmented control** (Node, Group) where the mock has a
  "Group: Node" menu button, as the Infrastructure toggle; there is no
  grouping by tag, since services.yaml has no tags.
- **Services on a phone keep their groups**, from the same components; the
  Phone board's list is flat.
- **Jobs has no mock of its own.** It follows the Services section's look;
  the mock's backup drawer ("NAS → B2 backup") gave its facts (Schedule, Last
  success) and the overdue words. Its "Last success" is the last report
  here: the cron store keeps the last three runs, not the last success.

## Phone screens

Below 768px the web draws the phone screens (#303, spec §8 "Phone width"),
from the files in `src/phone/`, built here from the shared parts. `src/shell/PhoneView.jsx` frames
them ([ARCHITECTURE.md](ARCHITECTURE.md), "The phone screens on the web").
The [gallery](GALLERY.md) shows them on the mock's Phone board (group Phone),
and `e2e/phone.spec.mjs` runs them in a browser.

### How the phone screens look

From the mock's Phone board, in a 16px gutter 12px under the header:

- **Overview.** The status card is the AttentionPanel split around the strip:
  a card with the 16px lamp and the word alone in `title-lg` (22/28, 800),
  the model's sentence in `text-2` and "Updated 12 s ago" in
  `caption` `text-3`; healthy, the same card says "All systems normal" with
  the sentence under it (an empty board, its sentence alone, no lamp). Then
  the SubsystemStrip, three tiles to a row, then "Needs attention · 5" in
  `overline` `text-3` over a card of IssueRows (title · word over the reason,
  the age at the end). Then Services and Infrastructure as lists: an overline
  heading with the subsystem's count at the right ("4 / 6 up"), and a card of
  EntityRows, `divide-y`, worst first (a service's name, its node in mono,
  the model's reason or its latency; a node's name over its reason or its
  hosted services). Sections sit 24px apart, the card, strip and rows 16px.
- **Services.** The page's title in `text-title`, a 44px search Input, the
  chips wrapping under it (36px pills; the pressed one `accent-tint` with its
  `accent-border` and `accent-text`, never a status colour), then the rows in
  one card.
- **Infrastructure.** The title, "Nodes" with the count, and the NodeCards one
  under another, each opening its node (NodeCard `onOpen`).
- **Alerts.** The title, the severity chips, then the search with the kind
  beside it as a 144px Select ("Everything" first), 44px tall as the search,
  so the filters take two lines at 390px; then "Active" (or "Last known 3 min ago")
  over a card of IssueRows, then History (#314: AlertHistory with the
  overline heading, its rows the narrow EventRow); healthy, a quiet card
  ("All clear — nothing is on fire."); filtered to none, a card saying "No
  active …"; no signal, a Banner in the no-signal tone.
- **A detail** is the Phone board's sheet, over everything: a 56px bar with a
  44px Back (`ChevronLeft`) and the kind ("Service", "Node", "Backup") in
  `overline` `text-3`, staying at the top as the sheet scrolls; the title in
  `title-lg` and where it is in 13px `text-3`; the status box (the 16px
  lamp, the word in its `fg` at 800, the reason in `text-2`, how long it has
  been so in `caption` `text-3`, "for 4 min · since 08:38", then any
  caption) on `surface-1`, tinted as a tile is when not healthy; a FactList;
  a node's meters two to a row and its services as rows; Open as a 48px
  primary Button the full width. Opened before its sources have answered (a
  reload with it open), the sheet's title is "Loading…" in `text-3` over
  Skeletons where the box and facts go.
- **The tab bar's count** is `badge` (10px, 800) in an 18 × 16 pill, the
  state's solid with its on-solid figure.

### Accessibility of the phone screens

- **Headings.** Each tab's screen has its h1 (the Overview's for screen
  readers only); the status card, Services and Infrastructure are h2s, the
  rows' "Needs attention" an h3. Each list is a region named by its heading.
- **A detail** is a modal dialog (the browser's own, `showModal`) named by its
  title: the page under it is inert, focus starts on Back, Escape closes it,
  and focus returns to the row that opened it. The browser's Back closes it
  too: each detail is a history entry.
- **Words.** A row is named "name, word" and described by its reason; an
  issue row's name says where it is ("Service · vm-103"), which a phone's row
  draws as its age instead. A tile that isn't a button keeps its sub-line,
  and, drawn as no signal, its last word, for a screen reader. The cross-client
  suite holds the words to the model (`src/phone/crossClient.test.jsx`).

### Where the phone screens differ from the mock

- **No heartbeats on the rows or the detail**: /api/services carries no
  heartbeat history yet (§8's ring is a later card), so a row's right is
  empty and the detail has no strip. No headline integration metric either:
  the phone reads the cards and the UPS only.
- **A service row names its node** in mono, as the desktop's Services rows
  grouped by custom group do; the mock's phone list doesn't.
- **No demo switch and no theme toggle in the screen**: the header has the
  toggle; the demo's scenario is the server's.
- **The status card's word stands alone**; the stale line ("last known 3 min
  ago: Critical · 2 critical") is the header's.
- **A sheet's "since" line** says "for 3 d" alone past a day, with no clock,
  and says nothing while the status is stale.

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
  or refused for another reason) is a crit Banner over the fields,
  `role="alert"`. Too many attempts (429) says how long to wait, from the
  answer's `Retry-After`: "Too many attempts. Try again in 30 s." (#257).
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
  and its lockup on the sign-in page, as the favicon does.

## Utilities

Quick Launch, Pipeline and the Checklist (spec §8 item 5, #301), and the
weather-and-clock card and the web search (#307), one file in `src/ui/`
(`utilities.jsx`), built on Panel, EmptyState, Input, Button, IconButton,
Checkbox, Skeleton and the sidebar's AppChip. Each is one component, drawn
the same in the Overview's rail (from 1440px, `RAIL_WIDTH` in
`@ui/app-shell`) and on the Launch page; `src/shell/` feeds both
([ARCHITECTURE.md](ARCHITECTURE.md), "Utilities: the rail and the Launch
page", "Today's extras and the Overview's sections"). The
[gallery](GALLERY.md) shows them in the rail, on the Launch page, empty,
failing, and the weather card's states (group Utilities), and
`e2e/utilities.spec.mjs` and `e2e/extras.spec.mjs` run them in a browser.

| Component | Import | Props |
| --- | --- | --- |
| `QuickLaunch` | `@ui/utilities` | `groups` (each `{ key, title, links }`, each link `{ id, name, href, monogram }`), `target` (`_blank`), `hint` ("in Ctrl K too"), `empty` (shown with no group) |
| `Pipeline` | `@ui/utilities` | `items` (each `{ id, title, repo, ref, sha, ci, at }`: `ref` the branch or null, `ci` the CI result `{ state, word }` or null, `at` in ms or null), `banner` (over the rows), `now` |
| `Checklist` | `@ui/utilities` | `todos` (each `{ id, text, done, dueLabel, overdue }`; null while loading), `onAdd({ text, due })`, `onToggle(id)`, `onRemove(id)`, `banner` |
| `WeatherClock` | `@ui/utilities` | `weather` (`{ temperature, condition, code, place }`, `{ loading, place }` or `{ failed, place }`; null, none), `now` (ms; null, no clock) |
| `WebSearch` | `@ui/utilities` | `engine` (its name, "Google"), `onSearch(words)` |
| `UtilitiesRail` | `@ui/utilities` | the panels, as `children` |
| `LaunchLayout` | `@ui/utilities` | `extras`, `search`, `quickLaunch`, `pipeline`, `checklist` (elements; none, left out) |

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
- **Pipeline.** A row per commit, 10px apart, the mock's (#532): its CI
  result's lamp (the 10px StatusLamp on the title's line: a failed run's red
  bar, a passed one's green disc, a running, queued, cancelled or skipped
  one's no-signal ring), then "repo · CI Failed" in 13px semibold `text-1`,
  one line cut with an ellipsis, over "branch · sha" in 12px `text-3`, the
  SHA in mono and never cut (a long branch is), and the age at the end in
  12px `text-3`. A commit with no CI result has no lamp and reads "repo ·
  message", its title still in line with the others; with no lamp on any
  row there is no lamp column. The row's tooltip is the whole of it: the
  title line, the commit's message and "branch · sha". With none, "No
  recent commits" (EmptyState sm).
- **Checklist.** A row to add a task: the task (an Input, "Add a task"),
  its due day (a date Input, 9rem) and Add (secondary, `Plus`), in one row
  from 24rem of the form's own width (the Launch page); narrower (the rail, a
  phone), the task across the top and the day beside Add under it. Each
  task a row: its Checkbox inside a label with its words, 13px `text-1`; a
  done one struck through in `text-3`; its due day in 12px `text-3`, or once
  it has passed, "Oct 18 · overdue" semibold in `warn-fg`; Delete, a ghost sm
  IconButton (`X`). With none, "Nothing on the list". While loading, three
  placeholder lines and no form.
- **WeatherClock.** The mock's "Weather and time" card: a Panel with 14 by
  16px of padding, one row. The condition's Lucide icon (20px, `text-2`;
  `Sun`, `CloudSun`, `Cloud`, `CloudFog`, `CloudDrizzle`, `CloudRain`,
  `CloudSnow`, `Snowflake`, `CloudLightning` by WMO code, else
  `Thermometer`), then "9°C · Overcast" in 14px bold over the city in 12px
  `text-3`; at the row's end the time (16px bold, tabular figures) over the
  day ("Tue 20 Oct", 12px `text-3`), both in the browser's locale. Either
  half alone takes the row; with neither, nothing. Before the first reading,
  two placeholder lines; without one, "No weather reading" by a thermometer.
- **WebSearch.** A row: the shared Input (a search field, a 16px `Search`
  icon inside its start in `text-3`, "Search Google") and a secondary
  Search button.
- **UtilitiesRail.** The panels in a column, 16px apart. The Overview gives
  it the mock's widths (`flex: 1 1 300px`, 280 to 340px), 24px from its
  sections. WeatherClock is its first panel.
- **LaunchLayout.** WeatherClock and WebSearch across the top, side by side
  when the row has room (16rem and 20rem at least, the search taking twice
  the share), else one over the other; Quick Launch under them, then
  Pipeline and the Checklist, side by side from 672px of its own width, 24px
  apart.

### Accessibility of the utilities

- Each panel is a region named by its title (an `h2`); the rail a region
  named "Utilities". A group of links is a list named by its overline (an
  `h3`); each link is named by the app's name, its chip hidden from
  assistive tech, and opens in the target Settings gives it, with no opener.
- A commit's age is a `time` with its instant, read as "12 m ago". Its CI
  result is a shape, a word and a colour: the word is printed ("CI Failed"),
  so the lamp is `decorative`. The commit's message, which a CI row's title
  doesn't print, follows the title for screen readers (`sr-only`).
- Each task's box is named by its words (an enclosing label); Delete is
  named "Delete “Patch the NAS”". The task and due fields are named "New
  task" and "Due day (optional)". Overdue is said in words, never by colour
  alone.
- A failed read is a Banner (tone unknown) naming its cause: Pipeline's over
  the last rows ("Gitea didn't answer JagHelm"), the Checklist's with Retry.
- WeatherClock is a region named by what it holds: "Weather and time",
  "Weather" or "Time". The icon is hidden; the words say the condition. The
  time is a `time` with its instant. While loading it is busy, with "Loading
  the weather" for screen readers.
- WebSearch is a search landmark named "Web search"; its field is named
  "Search the web with Google" (the placeholder says "Search Google"), and
  its button is a real submit, so Enter searches.

### Where the utilities differ from the mock

- **A region, not an `<aside>`.** The page is the shell's `<main>`, and a
  complementary landmark inside it is nested in another (axe's
  `landmark-complementary-is-top-level`).
- **Pipeline's rows are CI runs only** (#532). `/api/gitea/activity`
  carries each repo's latest push runs (or, without Actions, its commits),
  not merges, deploys or scheduled jobs as events, so a row's title is
  "repo · CI Passed" (the mock's "JagHelm · CI passed", its word as the
  status words are written), never "#880 merged" or "deployed". The mock's
  lamp is an image named by its word; here the word is printed, so the lamp
  is decorative. A row with no CI result ("repo · message", no lamp) is one
  the mock has no case for.
- **The monogram chip is the sidebar's** (20px, 12px extrabold), where the
  mock's Quick Launch chip is 22px with 10px letters: 12px is the type
  floor. The hint is 12px for the same reason (the mock's is 11px), and says
  the platform's shortcut ("Ctrl K" off a Mac).
- **The Checklist adds, dates and deletes.** The mock's checklist only ticks;
  today's panel adds a task with an optional due day and deletes one, so
  this one does too.
- **The weather and clock card is the rail's first panel,** where the mock
  has it last: chosen for #307, so the time and weather sit
  at the top, where the old header had them. It says no day's high (the
  mock's "high 12°"): `/api/weather` carries the current reading only, and
  #307 adds no weather data.
- **A web search on the Launch page.** The mock has none (its Launch page
  isn't drawn); the old header's search box moves there (spec §8).

## Command palette

⌘K's "Search or jump to" (#315, UX audit m8): one component in `src/ui/`
(`command-palette.jsx`) that draws the mock's palette and runs its keys;
what it lists and what each row opens is the shell's
([ARCHITECTURE.md](ARCHITECTURE.md), "The command palette"). The
[gallery](GALLERY.md) shows it with a row in every group and on a search
(group Command palette), and `e2e/palette.spec.mjs` runs it in a browser.

| Component | Import | Props |
| --- | --- | --- |
| `CommandPalette` | `@ui/command-palette` | `open`, `onClose`, `query` and `onQueryChange(words)`, `groups` (each `{ id, heading, rows }`, each row `{ id, label, kind, where, detail, state, word, href, onOpen, target }`), `loading` (the list says "Loading…" while there are no rows, #611), `error` (it says that instead), `label` ("Search or jump to"), `placeholder` |

`rowName(row)` (`@ui/command-palette`) is what a row is named.

### How the palette looks

From the mock's Main board, its palette:

- **The frame** is the Dialog's: `surface-1` in a `border-strong` edge, 12px
  radius, `shadow-pop` over `bg-scrim`, 96px from the top, centred, 600px or
  the screen less 16px a side.
- **The field** is the whole 52px row at the top, under a subtle rule:
  transparent, no edge of its own, `title-xs` regular (placeholder
  `text-3`), with the 16px `Search` icon in `text-3` over its start and the
  mock's "Esc" button (12px `text-3`, `row-hover` under the pointer) over its
  end.
- **The results** scroll inside 380px, 6px in. Each group has its heading,
  an overline in `text-3`. A row is the mock's: 8 by 10px of padding, 8px
  radius, three columns 12px apart: the 10px StatusLamp in a 14px column
  (empty for a row with no state: a page, an app, a Settings section, a
  link, Log out), the name in semibold `text-1` over a 12px `text-3` line
  ("where · detail": "apps · Down", "Service · apps · Kuma: down",
  "Personal · cloud.example.com"), each cut with an ellipsis, and the kind
  as an overline in `text-3` ("ISSUE", "SERVICE", "LINK"). The highlighted
  row, by the keys or under the pointer, is tinted `row-hover`.
- **Nothing found** is EmptyState's sm line: "Nothing matches “gra”." in 13px
  `text-3`.
- **The footer**, under a subtle rule, 12px `text-3`: "↑↓ move" and "↵ open"
  (the keys in mono), and the mock's note at the end.

### Accessibility of the palette

- A modal dialog named "Search or jump to", portalled to the end of the
  page as a root of its own (lib/portal.js), so it opens over any open
  layer, the detail drawer too, and the drawer doesn't hide it from
  assistive tech. Focus moves to the field, named "Search", and stays there:
  Tab doesn't leave it. Escape (the palette's alone, never the drawer's
  under it), the Esc button ("Esc to close") or a click on the scrim ("Close
  search") closes it, and
  focus goes back to what had it: the header's search button, the page, or
  the drawer.
- The combobox and listbox pattern: the arrows move the highlighted row
  (`aria-activedescendant`, `aria-selected`), Enter opens it, typing starts
  again from the first row. The results are a listbox of groups, each named
  by its heading; "Nothing matches" is a status, outside it.
- Each row is an option named by its name, kind, state word, where and
  detail, each once ("Immich, Issue, Down, Service · vm-103, Kuma: HTTP
  502"; "Netdata, Service, Up, vm-103"), so its lamp is decorative. A lamp
  drawn as no signal under a stale status is named "No signal", whatever
  word was last known.
- A row with an address is a link: a Ctrl, ⌘ or Shift click, or the middle
  button, opens it in a new tab and leaves the palette open, as the page's
  rows do (`lib/link.js`). A Quick Launch link opens with its target and no
  opener; Enter clicks it.

### Where the palette differs from the mock

- **Headings over groups.** The mock lists one pool of rows, cut to 9 (14
  with a query); here every row is listed, in groups under headings, and the
  list scrolls.
- **The field shows a focus ring**, where the mock has none: every control
  keeps it (the base style; `scripts/ui-stack.test.mjs` fails on one taken
  away). Moved in (`-outline-offset-2`), it traces the edge of the field's
  row, the whole row at the top, rather than boxing a field inside it.
- **Issues read as the issue rows do.** The mock's issue row is "Immich ·
  Down" over its reason; here the name, with "where · reason" under it, and
  the word is the lamp's name.

## Settings

Settings' index and a section's frame (#317, spec §7): one file in
`src/ui/` (`settings.jsx`), built on Input, the Panel's look and the
sidebar's entries, Sources' list (`source-list.jsx`, #318) and Notifications' parts
(`threshold-table.jsx`, `push-devices.jsx`, #320) and Integrations' (`integrations.jsx`, #323). What each section holds is
its own module ([ARCHITECTURE.md](ARCHITECTURE.md), "Settings"), today's
Settings markup until its card rebuilds it. The [gallery](GALLERY.md) shows
the index, a search, a section's frame, Sources (all answering, and at a
phone's width with one failed) and Notifications (push on with two phones, and
push off at a phone's width) and Integrations (the list and the presets, none set
up at a phone's width, and the configure form) (group Settings).

| Component | Import | Props |
| --- | --- | --- |
| `SettingsIndex` | `@ui/settings` | `query` and `onQueryChange(words)`, `sections` (each `{ id, label, description, icon, href, hits }`: `hits` the names of its settings the query found), `onNavigate(event, href)` |
| `SettingsSectionPage` | `@ui/settings` | `title`, `description`, `indexHref` (`/settings`), `onNavigate`, `nav` (a SettingsNav), the section as `children` |
| `SettingsNav` | `@ui/settings` | `sections` (each `{ id, label, icon, href }`), `current` (an id), `onNavigate` |
| `SourceList` | `@ui/source-list` | `title`, `description`, `note` (a stale status's "No signal · last known …"), `rows` (each `{ id, name, setting, state, word, since, error, detail, link }`: `setting` `{ label, variable, after }` or null, `state` null for a source not set up, `detail` a line or a list of them, `link` `{ href, label }`), `onNavigate(event, href)` |
| `ServiceMap` | `@ui/service-mapping` | `title`, `description`, `nodes` (each `{ key, name, icon, color, count, open, services }`; a service `{ id, sub, name, state, stateWord, hidden, overridden, tag, editing, editor }`, `tag` `{ kind: 'monitored' \| 'paused' \| 'none' \| 'opted-out', monitor }`, `editor` `{ name, namePlaceholder, icon, monitor, monitorItems, hint, suggestion: { monitor, why }, candidates (each `{ name, kind, heldBy }`, `heldBy` `{ container, node }` for a monitor another mapping holds: no button, it says who holds it), readOnly }`), `onToggleNode(key)`, `onHide(id)`, `onEdit(id)`, `onName(id, text)`, `onIcon(id, text)`, `onMonitor(id, choice)`, `onRemoveOverrides(id)` (after a Confirm), `loading`, `saving` |
| `BackupJobList` | `@ui/service-mapping` | `title`, `description`, `rows` (each `{ key, node, job, backup, reporting }`), `onToggle(key, backup)`, `loading`, `unread` |
| `ThresholdTable` | `@ui/threshold-table` | `title`, `description`, `rows` (each `{ metric, label, hint, unit, warn, crit, defaults, custom, error, notice }`: `warn` and `crit` the fields' text, `crit` null for a metric with none), `onChange(metric, field, text)`, `onReset(metric)`, `onRowBlur(metric)` (focus left a row), `dirty`, `saving`, `status` (`{ tone, text }`), `onSave`, `onDiscard`, `readOnly`, `unread` (`{ loading, error, onRetry }`) |
| `PushCategories` | `@ui/push-devices` | `title`, `defaults` (the prefs a new phone starts with) |
| `IntegrationList` | `@ui/integrations` | `title`, `description`, `note`, `rows` (each `{ id, name, kind, url, urlHidden, target, state, word, error, notes, enabled, iconSrc }`: `name` the display name, `urlHidden` for an address that carries a credential), `onToggle(id)`, `onEdit(id)`, `onRemove(id)` (after a Confirm), `onAdd()`, `loading`, `unread` (`{ error, onRetry }`) |
| `PresetGallery` | `@ui/integrations` | `presets` (each `{ type, name, description, auth, iconSrc, configured }`), `total`, `search` and `onSearch`, `category`, `categories` and `onCategory`, `onPick(type)`, `onCustom()` |
| `IntegrationForm` | `@ui/integrations` | `title`, `description`, `backLabel`, `onBack`, `fields` (each `{ id, kind: 'text' \| 'secret' \| 'select' \| 'check', label, description, value, onChange, error, items, wide }`), `notes` (Banners), `dataFields`, `test` (`{ state, sentence }`), `saveState`, `saveError`, `canSubmit`, `onTest`, `onSave`, `remove` (`{ name, detail, value, onRemove }`) |
| `PushDevices` | `@ui/push-devices` | `enabled`, `stalled` (a sentence), `devices` (GET /api/push/devices' phones), `test` (the last test push), `now`, `busy`, `notice` (`{ tone, text }`), `onTest(id \| null)`, `onRemove(id)`, `readOnly`, `unread` |

### How Settings looks

From the mock's Settings board:

- **The index** is a page of the new UI (`ShellPage`, "Settings" and its
  line), then the search: an Input 384px at most, with the 16px `Search`
  icon in `text-3` over its start ("Search settings: font, password,
  links…"). Under it a card per section, three across from 1024px, two from
  640px, one on a phone, 16px apart. A card is the Panel's look (`surface-1`
  in a `border-border` edge, 12px radius, flat, `p-panel`) and a link: its
  icon in the Panel's accent chip at 32px (`accent-tint`, `accent-text`, an
  `accent-border` ring; spec §15: violet tints section icon chips), its name
  in `title-xs`, its line in 13px `text-2`, and, when the query found its
  settings, "Matches: Font family, Logo" in 12px semibold `accent-text`;
  such a card links to the section at the first of them
  (`/settings/appearance#font`), which its page scrolls to, under the header.
  Under the pointer the edge is `border-strong` and the fill `surface-2`.
  Nothing found: "No setting matches “…”." in `text-3`. Last, in 12px
  `text-3`, that every change applies at once (no preview, spec M10).
- **A section's page** keeps the page's gutter and 1024px column: the
  breadcrumb ("Settings" in semibold `accent-text`, a slash and the name in
  `text-2`, 13px), the name as the page's h1 (`title`) and its line in
  `text-2`; then, from 768px, the list of sections (208px, sticky under the
  header) beside the section, which takes the rest, 768px at most. On a
  phone the list goes: the index is the way between sections.
- **The list of sections** draws its entries as the sidebar does: 36px,
  8px radius, the 16px icon and the name in 13px; the open one
  `accent-tint`, semibold, its icon `accent-text`; the others `text-2`,
  `surface-2` under the pointer.
- **Sources** (#318, `SourceList`) is one Panel, flush, as the mock's Data
  sources list: a row each under a subtle rule, `p-panel` across and 12px
  down. The lamp, then the source's name (14px semibold, an h3) and, from a
  row 576px wide (`@xl`), at its end where it is set ("Set in .env as" in
  12px `text-3`, the variable in mono `text-2`); narrower, that line goes
  under the name. Under them the word in its state's colour with "· for
  3 h" in `text-3`; on failure the model's error, whole and wrapping, in
  `warn-fg`; its lines of detail in 13px `text-2`; a link in semibold
  `accent-text`. A source not set up has no lamp, no setting line, and its
  word in semibold `text-3`. A stale status's note sits at the end of the
  panel's header in 12px semibold `unknown-fg`.
- **Nodes & Services** (#319, `ServiceMap`, `BackupJobList`) are two flush
  Panels. The services: a disclosure per node (its icon, name and count, a
  chevron), then a row each under a subtle rule: the lamp, the name (14px
  semibold) over the container in mono `text-3`, the monitor tag, Hide and
  Edit. The tag is a 12px chip: "monitored" in semibold with the monitor's name
  in mono, or "no monitor" / "opted out" in `text-3`, each with a tick or a dash
  so it never rests on colour. Edit opens the display name and icon (two
  columns from the row's `@xl`), the monitor Select, and the suggestion in a
  `surface-2` box: "Auto-match would pick <monitor> · matched by name" with a
  "Use <monitor>" button, or "finds no monitor · no match", then the similar
  names as ghost chips. Backup jobs: a row per job (name in mono, its node under
  it) with a Switch. The node rows (Settings → Nodes & Services → Nodes,
  #667) carry a Move up and a Move down button, ghost `sm` icon buttons
  (chevrons, decorative) before Edit and named for the node ("Move Proxmox
  up"). The first row's Move up and the last row's Move down are off, so a
  button that does nothing is never offered; after a move the focus stays on
  the node's button, or on its other one when the node reached an end. Each
  move is said in a visually hidden polite status ("Proxmox moved to
  position 1 of 6"). The order is the display config's `nodeOrder`.
- **Alert rules** (#669) is a fourth Panel in Notifications, built from the
  Appearance rows (`SettingRows`, `SettingRow`, `ToggleRow`): the burst window
  is a Select, quiet hours a switch that reveals two time Inputs, a
  two-way segmented control and a time zone Select with a ghost "Use this
  device's zone" button (and says in its description whether it is quiet
  now, and the time in that zone), the known causes a row of two Inputs and a ghost Delete each with
  an "Add a known cause" secondary button, and the snoozed and acknowledged
  alerts a row each with a ghost Lift. It is in Settings' own lazy chunk. It
  paints nothing new, so the gallery's baselines are unchanged.
- **Notifications** (#320) is three flush Panels, 24px apart, as the mock's
  Notifications board. Thresholds: a row per metric under a subtle rule,
  `p-panel` across and 12px down; its name (14px semibold, an h3) and what
  it covers (12px `text-3`), and from a row 576px wide (`@xl`) beside them,
  narrower under them, the "Warning at" and "Critical at" fields, 128px each so the rows line up (12px
  semibold `text-2` labels; an 80px Input, its number right-aligned in
  tabular figures, the unit after it in `text-3`), or "None: warns only" in
  `text-3`; the defaults under them in 12px `text-3`, with "Reset to
  default" (a small accent ghost button) while the row is away from them; a
  row's error under it in 13px `crit-fg`, its fields `aria-invalid`. A
  footer under a rule: Save thresholds (primary, the page's one), Discard
  changes (ghost) while there are changes, and a line saying what happened
  (`text-2`; an error `crit-fg`). What pages the phones: a row per category,
  its name (13px semibold) over what it covers (12px `text-3`), and at the
  end what a new phone starts with in 12px `text-2`; a closing note in
  `text-3`. Devices: "Send test push" (a small secondary button) at the end
  of the header; a row per phone: its name (14px semibold, an h3), its
  OS and app versions (12px `text-3`), its times and what it gets in
  13px `text-2` (`text-3` with push off in its app), its last failure in
  `warn-fg`, the test push's outcome in `text-1` after a semibold "Test
  push:"; Send test (accent ghost) and Remove (ghost) at the end from 576px,
  under it narrower. With push off a note under the header says so and how
  to turn it on; Google out of reach is a `warn-fg` line there.

### Accessibility of Settings

- The search is a search landmark ("Settings") around a searchbox named
  "Search settings"; the cards narrow as you type, and "No setting matches"
  is a status.
- Each card is a link named by the section's name and described by its line
  and its matches ("Appearance", "Theme, font, branding…, Matches: Font
  Family"), so the icon is decorative.
- A section's page has a breadcrumb navigation ("Breadcrumb", the section
  `aria-current="page"`) and the list is a navigation named "Settings
  sections", the open one `aria-current="page"`. The page is the h1, its
  parts h2 and a card in a part h3.
- A link calls `onNavigate`, the router's `followLink`, so a modified or
  middle click opens a new tab.
- Sources' rows are content, not controls: each lamp is decorative beside
  the word that names it, and named "No signal" when a stale status draws it
  so beside the word last known. A source's name is an h3, in the row its
  anchor names, so a search match opens the page at it.
- A button of the design system inside today's Settings markup is in a root
  of its own that draws no box (`UiButton`, `display: contents`), so it has
  the tokens and the focus ring and the row around it is unchanged.
- Nodes: Move up / Move down are real buttons (Tab, Enter or Space), named for
  their node, disabled at the ends, and the result is announced politely.
- Notifications: each threshold field is labelled with its metric ("Warning
  at for CPU"; the metric is visually hidden) and a row's error is text beside
  fields marked invalid, tied to them by `aria-describedby`, not an alert: it
  shows once focus leaves the row, or on Save. Lines loaded already wrong
  (set by hand on the host) show a notice instead, until edited. Reset and
  Send test are named for their metric or phone. What the Save did is a
  status. Remove opens a Confirm that names the phone by its
  display name, never its id; each Remove button is named for its phone
  ("Remove Pixel 8"). The categories are a description list, not controls:
  each phone chooses its own in the app.

### Where Settings differs from the mock

- **No live line on a card.** The mock's cards end with each section's state
  ("5 of 5 answering", a lamp); here a card has its name, icon and line, and
  each section's card (#318–#323) can add its own. Sources' doesn't yet: the
  index draws no status.
- **Seven sections.** Sources and Notifications are both built, so the
  index lists seven.
- **Sources has no Test button.** The mock's rows have one; here the
  board's own poll is the test, and each row moves with it.
- **Notifications' categories are read-only.** The mock switches each kind
  of push on the web; the categories are each phone's own, chosen in the
  retired Android app (#539), so the page lists them and each phone's choice, with
  one place to change them. The mock's thresholds table becomes a row per
  metric, so its fields fit a phone; and a device's chip goes, its name
  says which it is.
- **The search is on the index only.** The mock draws the field over a
  section too, where it narrows nothing; here a section's page has the list
  of sections and the breadcrumb back to the index, which keeps the words.
- **Lucide's icons.** The mock draws its own paths; here Database, Server,
  Plug, LayoutGrid, Bell, Palette and ShieldCheck.

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
- A token change needs `npm run theme-bases` too: custom themes are validated
  against `server/themeBases.js`, generated from this file.
- A new colour role needs a utility in `tailwind.css`'s `@theme` block, and its
  pairings in `PAIRINGS` in `server/uiContrast.js`. A plausible pairing
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
