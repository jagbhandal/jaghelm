# JagHelm UI/UX analysis — improvement opportunities

A comprehensive UI/UX audit run as two deep, independent passes — a **product/visual
design** lens and a **senior-frontend engineering / a11y** lens — over the real
code, then synthesized. This is a recommendations backlog, not a change set.

## Headline

The bones are genuinely strong: 10 curated themes via a real CSS-var token layer, a
font-size token system wired to live sliders, WCAG-conscious focus rings +
reduced-motion + redundant non-color status glyphs, code-split settings, and
per-panel error boundaries. JagHelm already clears the "competent homelab
dashboard" bar. The gaps cluster in four areas:

1. **Systematize what's ad-hoc** — ~420 inline `style={{}}` blocks, 162 hardcoded
   font sizes, no spacing scale, duplicated `Card`/`Toggle` across 13 tabs.
2. **Close the first-run + feedback loop** — blank-then-pop first paint, silent
   save failures, indistinguishable data-source errors, no toast.
3. **Mobile** — a genuine navigation dead-zone, no mobile reorder, sub-44px targets.
4. **Next-tier a11y** — the drag/resize grid is fully keyboard-inaccessible, zero
   `aria-live`, no focus traps in popovers, no field-level validation messaging.

## Real bugs found (fix first — small, visible)

- **`--teal` / `--blue` CSS vars are used but never defined.** `Widgets.jsx` styles
  CronJobs with `var(--teal)` (border/headers/dots) and QuickLaunch borders default
  to `var(--blue)` — neither exists in any theme, so they render **colorless**.
  Define them per-theme or use `--accent`/`--green`. *(S)*
- **Config import can silently nuke the dashboard.** `BackupTab.jsx` calls
  `setConfig(parsed)` after only a `typeof === 'object'` check — no schema
  validation, no confirm, no backup-of-current, then auto-saves to the server 2s
  later. Validate-before-apply + confirm + a one-level undo snapshot. *(M)*
- **Silent save failures.** `App.jsx` POSTs display-config with `.catch(() => {})` —
  a server-save failure is invisible to the user (looks saved). *(S)*
- **Nav bar background is a hardcoded dark-indigo** (`rgba(15,17,35,0.75)`) that
  ignores the theme — wrong on all 4 light themes. Use `--glass-bg`. *(S)*
- **IframeView blocked-detection reads a stale `status`** in an 8s timeout closure
  (not in deps) → a slow-but-fine iframe can show "Embedding Blocked". Use a ref. *(S)*

## Unified prioritized recommendations

Effort S/M/L · impact. Merged from both lenses (overlap = high confidence).

| # | Improvement | Area | Effort | Impact |
|---|-------------|------|--------|--------|
| 1 | **Per-data-source error + stale-data + retry states** — today Prometheus-down, Kuma-down, and an integration-down all look identical (every fetch `catch` just `console.warn`s). Distinguish them per-panel via the existing inline `ErrorBoundary` card; show "as of Nm ago" when stale. | Data UX | M | **High** |
| 2 | **Kill the render-blocking 11-family font `@import`** in `global.css:1` (only 3 are used by default; `index.html` already `<link>`s those 3). Lazy-load alternate families when picked in Typography. Fastest FCP win. | Perf | S | **High** |
| 3 | **Dashboard skeletons + drop the `return null` blank auth gate.** The `.skeleton` shimmer already exists but is unused on the main grid; first paint is blank-then-pop. Render skeleton node cards for the first `/api/services` cycle. | Perceived perf | S/M | **High** |
| 4 | **`aria-live` for health/metric status + a text equivalent for the status dot.** Zero live regions today — a screen-reader user gets no notice when a service goes down. Wrap the NavBar health label in `role="status" aria-live="polite"`. | A11y | S | **High** |
| 5 | **Global toast system + surface save state** ("Saving…/Saved ✓/Failed — retry"); flush the debounced save on `visibilitychange`/`beforeunload`. Stop swallowing save/upload errors. | Feedback | M | **High** |
| 6 | **Shared styled confirm modal + validate-before-apply on import.** Replace the 2 native `confirm()` calls and guard the ~6 unconfirmed destructive actions (Reset Grid, Remove All Overrides, Delete group/tab, config import). | Forms | M | **High** |
| 7 | **Status-driven card escalation** — make "this node has a down service / a metric >90%" pre-attentive (red-tinted border + halo) instead of requiring a scan of every chip; tint the metric *value*, not just the 4px bar. | Visual hierarchy | M | **High** |
| 8 | **Extract settings primitives** (`SettingsCard`, `Toggle`, `ChoiceGroup`, `EmptyState`, `Overline`) — the same `Card`/`Chk` are copy-pasted across 13 tabs; kills the biggest duplication + inline-style debt. | Consistency | M | **High** |
| 9 | **Mobile nav dead-zone** — `.nav-tabs { display:none }` <600px with no replacement means you can't switch tabs on a phone. Add a drawer/bottom-bar; a mobile reorder path; 44px tap targets. | Mobile | M | **High** |
| 10 | **Config selector hook / context split** — the whole `config` object identity changes on every settings keystroke, so *every* `useConfig()` consumer (NavBar, all Widgets, every NodeCard) re-renders. Add `useConfigSelector(c => slice)` or split display/layout/sections contexts. *(Note: this is the remaining perf footgun on the just-landed ConfigContext refactor.)* | Architecture/perf | M | **Med-High** |
| 11 | **Keyboard access for drag/resize** — the grid is pointer-only (hand-rolled HelmGrid + dnd-kit `PointerSensor` only). Add dnd-kit `KeyboardSensor` + announcements to the service-card drag (S); an arrow-key "move mode" on HelmGrid panels (L). | A11y | L | **Med-High** |
| 12 | **Spacing + type scale tokens** (`--space-1..6`, `--text-xs..xl`) and migrate the 162 hardcoded `fontSize` + 420 inline styles incrementally — lift repeated card/stat/badge patterns to CSS classes (also restores reduced-motion/theming coverage that inline styles bypass). | System | L | **Med-High** |
| 13 | **Collapsible settings live-preview** — the permanent 50/50 split makes the form cramped <1100px and unusable on tablets; the preview also mounts a *second* full DashboardView (its own fetches/observers). Toggle + reclaim width; hide below ~1100px. | Settings UX | S | **Med** |
| 14 | **Theme picker popover** replacing the blind 🎨 cycle (8 clicks One-Dark→Solarized, each a full repaint); reuse the Appearance-tab grid. Group-label the 13-tab sidebar ("DISPLAY/INFRASTRUCTURE/SYSTEM"). | Polish | S | **Med** |
| 15 | **Field-level validation** — extend `Field.jsx` to take an `error` prop → `aria-invalid` + `aria-describedby`. Weather lat/lon, integration/tab/link URLs accept garbage silently today. | Forms/a11y | M | **Med** |
| 16 | **Focus management in popovers** — IconPicker/search/color-pickers have no focus trap, no Escape, no focus-restore, and aren't `role="dialog"`. A shared `Popover`/`Dialog` primitive. | A11y | M | **Med** |
| 17 | **Demo/sample-data on the dashboard** — pair the backend `DEMO_MODE` with a frontend "try with sample data" so first paint is impressive without Prometheus (adoption). | Onboarding | M | **Med** |
| 18 | **PWA offline is broken on reload** — `sw.js` precaches only `/` + 2 svgs, not the hashed JS/CSS bundles, and `APP_VERSION` is a hardcoded `'1.1.0'`. Precache the build manifest; single-source the version. | PWA | M | **Med** |
| 19 | **Lazy-load `vendor-dnd` (52KB eager, disabled on mobile)** and confirm `react-colorful` rides the lazy SettingsView chunk (not `index`). Reserve width/height for CDN icons to stop layout shift. | Bundle | S/M | **Med** |
| 20 | **Iconography consistency** — nav/settings use per-OS emoji (⚙️🎨🚪🏠) against an otherwise-sleek glass aesthetic; move to one SVG set (keep the geometric status glyphs — those are intentional a11y cues). Single default-brand string (App says `JAGHELM`, NavBar/Login say `JAG-NET`). | Polish | M | **Low-Med** |

## Best first PRs (small effort, high/visible impact, independent)

1. The **real bugs** above (`--teal`/`--blue`, silent save, nav bg) — a few S fixes.
2. **#2 fonts** — drop the 11-family `@import`; biggest perf win, near-zero risk.
3. **#3 skeletons** + **#4 aria-live** — both reuse existing primitives.
4. **#13 collapsible preview** + **#14 theme popover** — quick, visible polish.

## Method note

Two independent senior auditors (visual-design lens + frontend-engineering/a11y
lens) read the actual components, CSS tokens, build output, and data hooks; their
top-10s overlapped heavily (high confidence) and were merged here. Findings are
analysis-only — no code was changed. The refactors already shipped this cycle
(Vitest+RTL net, ConfigContext, setIn, apiFetch, code-splitting, per-panel error
boundaries, the earlier a11y pass) were excluded as already-done; #10 is the one
genuine follow-up they surfaced on the new ConfigContext work.
