# Component gallery

One page with every state of every component in `src/ui/`, as
[design-system.md](design-system.md) lists them (#289), each in both themes and
both densities, and in all three accents where its colour follows the accent.
CI screenshots every one against a committed baseline and runs axe on it.

The gallery is for development and CI only. It is its own Vite entry
(`gallery/index.html`, built by `vite.gallery.config.js`); the production build
has `index.html` as its only entry, and `scripts/gallery-build.test.mjs` (in
`npm test`) fails if a production build carries any gallery page, code or
route.

## View it

```bash
npm run gallery          # Vite's dev server, opening http://localhost:5173/gallery/
```

The app's own dev server (`npm run dev`) serves it at the same address.

- `/gallery/` shows every state, grouped as the design system lists them. A
  state that needs the page to itself (an open dialog, drawer, popover, select
  or tooltip, a focus ring, toasts) shows in a frame. The infotip
  (`popover-hover`) opens when you point at its icon, as the tests do.
- `/gallery/?state=<variant>` shows one variant alone, as the tests shoot it,
  such as `?state=dialog-md--light-compact` or
  `?state=button--dark-comfortable-cyan`. Each variant's name on the full page
  links there.
- `?theme=light`, `?density=compact`, `?accent=cyan` and `?group=Data` narrow
  the full page.

A variant's name is the state's, then its switches: `<state>--<theme>-<density>`,
and `-<accent>` for Fuchsia and Cyan. Every state is drawn in dark and light,
comfortable and compact, with Violet; a state whose colour follows the accent
(buttons, switches, checkboxes, tabs, focus rings, the panel's icon chip,
meters, a selected strip tile, the select's tick) is also drawn in Fuchsia and
Cyan, in both themes, at comfortable density, since density never changes a
colour.

The page loads the app's stylesheets unchanged (`src/styles/legacy.css`, then
`src/ui/tailwind.css`, as `src/main.jsx` does), so a component looks here as it
will on a screen. The gallery lays itself out with inline styles that read the
role tokens; the few classes it writes are ones `src/ui/` already uses
(`npm test` checks).

## Files

| File | What it holds |
| --- | --- |
| `gallery/catalog.js` | every state as data: its id, group, title, and whether it follows the accent, needs the page to itself, takes focus or waits for something |
| `gallery/states.jsx` | what each state draws, under the same id |
| `gallery/main.jsx` | the page: the full gallery, or one variant alone |
| `gallery/baselines/` | the committed screenshots, one PNG per variant |
| `gallery/gallery.spec.mjs` | the tests |
| `gallery/container.mjs` | the pinned Playwright version and container image |
| `playwright.config.mjs` | how the tests run (below) |
| `vite.gallery.config.js` | the gallery's build: the app's Vite config with the gallery as its entry |
| `scripts/gallery.mjs` | runs the tests in the container (`npm run gallery:test`, `npm run gallery:update`) |

To add a state, add it to `catalog.js` and draw it in `states.jsx`, then
regenerate the baselines (below). A state with an id in one file and not the
other fails every test.

## What CI checks

The `gallery` job in [check.yml](../.gitea/workflows/check.yml) runs on every
PR, beside the `check` job, in the pinned Playwright container. For each
variant, alone on its page:

- **Its screenshot is its baseline, pixel for pixel**: the state's own element,
  or the whole viewport for a state that needs the page to itself, whose popups
  sit outside it. No tolerance: a threshold of 0 and no pixels allowed to
  differ.
- **axe finds no violation**, with every rule axe runs by default, on the whole
  document, the portal roots at the end of `<body>` included, with the two
  exceptions below and no other.
- **Nothing is logged as an error** (a component missing its required name
  logs one in a production build), and **nothing is fetched from another
  origin**: fonts and everything else are JagHelm's own.

And, once per run: the baselines are exactly the variants (no stale file, none
missing), and the full gallery page shows every variant. The job fails on any
of these.

### The two axe exceptions

Both come from Base UI's own markup around an open Select, not from
JagHelm's components, and each is scoped to that markup alone
(`gallery/axe.mjs`). **Revisit both when Base UI is upgraded**: a test fails
once axe passes the open Select without them, so a fixed Base UI shows itself.

- **`aria-hidden-focus` skips only Base UI's focus guards around an open
  Select**: the element axe names must itself be a guard
  (`[data-base-ui-focus-guard]`) sitting beside the Select's trigger or its
  list. Base UI's focus manager puts these spans there, `aria-hidden` with
  `tabindex="0"` by design (floating-ui's pattern): a guard hands focus on the
  moment it gets it, so nobody rests on it, and Base UI makes it a button for
  VoiceOver, whose virtual cursor would skip it otherwise. JagHelm's Select
  can't change them. A guard anywhere else (a dialog's, a popover's) is still
  checked.
- **`region` counts the Select's list as a region**
  (`[data-slot="select-popup"]`, added to axe's own `regionMatcher`). Base UI
  portals the list to the end of `<body>`, outside every landmark. Other
  popups already pass: a dialog, drawer, confirm or popover is a `dialog`, the
  toasts are a region, and the tooltips are hidden from assistive tech (they
  only repeat the trigger's name or description). Other portals are not
  exempt.

A test plants the same findings outside those elements (a focusable
`aria-hidden` element that isn't a guard, a Base UI guard that isn't beside a
Select, text outside every landmark, and text in another portal root), plus a
low-contrast line, and checks that each still fails. Another checks that axe
ran every rule it runs by default, so no rule can be left out quietly (by
`disableRules` or a narrower set of tags). A third checks that the region
list starts from axe's own default, so an axe upgrade that changes it shows.

## Change a component's look

An approved screenshot change is the regenerated baselines committed in the
same PR as the change:

```bash
npm ci                   # once: the container uses this checkout's node_modules
npm run gallery:update   # rewrite the baselines that changed, add new ones, drop stale ones
git status gallery/baselines
```

Review what changed before committing: `npm run gallery:test` beforehand
writes, for each failing variant, the expected, actual and diff images under
`test-results/gallery/`, and an HTML report
(`npx playwright show-report test-results/gallery-report`). In the PR the
changed PNGs show side by side.

The same container runs the app shell's browser tests, `npm run test:e2e`
(`e2e/`, `playwright.e2e.config.mjs`; [ARCHITECTURE.md](ARCHITECTURE.md) §8),
in CI's `gallery` job after the gallery's own.

`npm run gallery:test` runs the checks locally, as CI does (`CI=1 npm run
gallery:test` also stops it writing a missing baseline). Arguments after `--`
go to Playwright: `npm run gallery:test -- -g dialog`.

Both scripts need Docker on a Linux x64 machine, as CI's runner: they run
`docker run` with the pinned image, this checkout mounted, as the calling user,
sharing nothing else with the host (no host IPC or network; Chromium doesn't
need `/dev/shm`). Run anywhere else (`npx playwright test` on the host), the
config refuses, because the screenshots would not match. The gallery's
server takes a free port for each run, so runs side by side never meet; two
runs at once need two checkouts, as CI's jobs have, since they build into
the checkout's `dist-gallery/`.

The image ships Node 24 while `package.json` asks for Node 26, so `npm ci` in
it warns `EBADENGINE`. That is expected and harmless: the gallery only builds
the page with Vite and runs Playwright, both of which support Node 24, and
`engine-strict` is off. Don't "fix" it by loosening `engines`; it goes away
when a Playwright image ships Node 26.

## Why a baseline is exact

The screenshots are deterministic by construction, so a diff is a real change:

- **One container**: `mcr.microsoft.com/playwright`, the exact tag of the
  `@playwright/test` version in `package.json`, pinned by digest
  (`gallery/container.mjs`). CI and the local scripts run the same image, so
  the same Chromium, system libraries and fonts. `npm test` fails when
  `package.json`, the lockfile, `check.yml` and `gallery/container.mjs`
  disagree. To upgrade Playwright, change all of them and regenerate the
  baselines in the same PR.
- **Meant to draw the same pixels on any CPU**: Skia's CPU-specific code
  paths are off (`--disable-skia-runtime-opts`), with sRGB colour, no LCD
  text and no font hinting. So far this is checked on MS-S1 only, where CI
  and every local run have been; vm-103, CI's fallback runner, hasn't run it
  yet, and a difference there would fail loudly (a false red, never a false
  green).
- **Self-hosted fonts only**, loaded before the shot (`document.fonts`).
- **No motion**: reduced motion (the base style cuts every transition and
  animation in a `.jh-ui` root), animations off for the shot, the caret
  hidden; the test waits until no animation runs.
- **A frozen clock** (every `Date` is 2026-10-20 09:00 UTC), a fixed time zone
  and locale, fixed data, a 960 × 600 viewport at a device scale of 1, and no
  retries.

Shots are of a state's own element, not the page, which keeps the PNGs small.
Two variants that draw the same pixels (a control in either density) are
byte-identical files, which git stores once.
