# JagHelm overhaul — design

- **Date:** 2026-10-18
- **Status:** Approved by Jag, 2026-10-18 ("lock and finalize"). Amended 2026-10-19 after Jag signed off the clickable mock (#295); the changes are listed in §15. The work is split into story cards on the JagHelm "Overhaul" board, ordered in epic #333.
- **Inputs:** the independent UX and design audit (private doc https://claude.ai/artifact/2DzwZHtNaShc8vobePMXuZ) and the independent performance, functionality and bloat audit (private doc https://claude.ai/artifact/Mbzzvib9uyY8o4mCWK3dks), both run against `main` @ 2587fce. The performance findings are already filed as issues #232–#269, tracked in #270.
- **Supersedes:** the visual parts of `docs/UI-UX-ANALYSIS.md` and the indigo identity in `2026-06-27-jaghelm-mobile-ui-refresh-design.md`. That spec's annunciator language (worst-of lamp, word + colour + shape, calm status colours) is kept and becomes the shared system.

## 1. Intent

JagHelm's job is to tell its owner, in about three seconds, whether anything in the homelab is wrong, what, and where; and then get them to the detail. The Android app already does this well. The web dashboard does not: during an incident its first screen shows a motto and a small grey label, its grid clips and overlaps panels, and it disagrees with Android about the same facts. Jag finds the web app unpolished next to Arcane, whose UI he loves, and purple is his favourite colour.

The overhaul makes JagHelm read as one designed product on both screens: Arcane's design system and its purple, with JagHelm's own problems-first layout. It also fixes the performance and correctness findings so the product is honest and light underneath.

## 2. Decisions already made

Jag, 2026-10-18: agreed to every recommendation in both audits, and chose Arcane's purple as the accent. The audits' open questions are resolved as follows. Where an answer is my reading of "agree with all" rather than Jag's own words, it says so.

| Question | Answer |
| --- | --- |
| Audience: personal board or public adoption? | Both. Jag's homelab is the primary user, and first run and the demo are fixed (UX C3), so a stranger's first impression works. (My reading: the audit's plan fixes C3.) |
| Free-form drag-and-resize grid? | The Overview becomes an opinionated reflowing layout. Arranging comes back as an explicit "Edit layout" mode (Phase 5). |
| Themes? | Dark and light (plus "follow system"), one accent. The ten current themes are removed. Further themes only as data that passes the contrast checks (Phase 5). |
| Phone web? | Phone-width web renders the same screens as the Android app, from shared code. |
| Per-container RX/TX and Docker CPU/MEM? | Drill-down only. |
| Quick Launch, todos, pipeline? | Utilities: a right rail at ≥ 1440px, otherwise a Launch tab. |
| Embedded app tabs? | First-class: an **Apps** group in the sidebar, one entry per app, opened inside JagHelm under the header and kept loaded. (Jag, 2026-10-19: one of the best things about JagHelm today.) |
| Many-to-one Kuma monitor matching (#240)? | Not intended. One container per monitor unless explicitly mapped. |
| Layout per device or shared (#233)? | Shared through the server, versioned. |
| Sessions across restarts (#250)? | They survive restarts; ADR 0002 is amended. |
| Demo mode (#248)? | Fixed, not deleted (follows from "both" above). |
| Gitea widget every 5 minutes (#249)? | Yes. (My reading of the audit's recommendation.) |
| JagHelm's `/metrics` (#259)? | Scrape it from the homelab Prometheus and keep the SLOs (a homelab-infra change). (My call; the audit offered both.) |

## 3. Goals, non-goals, anti-goals

**Goals**

1. The 3-second test passes on desktop, tablet and phone: during an incident the first screen states how many problems there are and lists them, ranked; when healthy it says so in one quiet line.
2. One truth: web, Android and push notifications show the same state, reason and counts for every entity, because the server computes them once.
3. Nothing hides: no clipped panels, collapsed names or sideways scroll at any width from 360 to 2560px.
4. One design system across web and Android: Arcane's token architecture and purple, one component library, one icon set, two densities.
5. WCAG 2.2 AA throughout, enforced in CI.
6. Every performance and correctness issue in #270 is closed, either by its own fix or by the phase that absorbs it (§10).

**Non-goals**

- No new data sources. Everything shown comes from what JagHelm already reads (Prometheus, Kuma, NUT, cron reporters, Gitea, integrations); history charts use Prometheus `query_range`.
- No actions on infrastructure (restart, update, prune). JagHelm stays read-only; Arcane is where actions happen.
- No database (ADR 0002 stays, amended only for sessions).
- No new platforms beyond web and the existing Android app.

**Anti-goals: it fails, even if it works, if…**

- it becomes Arcane: a sidebar of resource tables you browse. JagHelm's first screen is the annunciator and the issue list;
- purple or any decorative colour carries status, or status colours decorate. Red, amber and green mean only status;
- a monitoring blip pages Jag or paints the board red (that is #232's bug, and the new status model must make it impossible);
- the two clients drift apart again because each computes its own severity;
- healthy reads as loud: a wall of green is a failure.

## 4. Constraints

- **Stack today.** Web: React 19 + Vite 8, plain CSS (`src/styles/global.css`, 427 inline style objects). Android: Capacitor + React in `mobile/`, importing web code through the `@shared` → `src` alias. Server: Node/Express, file-backed config (ADR 0001), single instance (ADR 0002).
- **Tests.** `npm run test:ci` with the floor in `scripts/test-floor.mjs` (raise it as tests are added; never lower it). Node 26 for local runs (`.nvmrc`).
- **Releases.** Each phase ships as a release through `docs/RELEASING.md`. Each phase must leave `main` releasable; no long-lived branch.
- **Self-hosted.** No runtime calls to third parties for the UI: fonts and icons ship in the bundle (#244), and the CSP stays strict.
- **Android.** The app is distributed as an APK; push stays on FCM (transport changes are #235/#194, not this design).
- **Budgets** (checked in CI from Phase 1): first load ≤ 200 KB transferred (today 261 KB, 103 KB of it Google Fonts); CLS ≤ 0.1 at 390px (today 1.15); ≤ 4 requests per 30 s tick per tab and zero while hidden (today 7–8); axe: zero contrast violations in both themes.

## 5. Design system

### 5.1 Stack (my call — check this one)

Adopt **shadcn/ui on Tailwind CSS v4** for web and Android. Arcane is shadcn-svelte on Tailwind v4, so this gives Arcane's look by construction: the same token names, radius, component anatomy and focus behaviour, plus accessible primitives (dialogs, menus, popovers, tooltips) instead of hand-rolled ones. Components are copied into the repo (`src/ui/`), not consumed as a black-box library, so they can be shaped to JagHelm. Icons: `lucide-react`, tree-shaken.

The alternative is keeping plain CSS and hand-building the component set on new tokens. It adds no dependencies but repeats how the current inconsistency arose (14 button styles). I recommend shadcn/ui.

### 5.2 Colour

Three layers: a raw palette (OKLCH ramps), semantic roles (what components consume), and component tokens only where needed. Dark and light map the palette to roles; every text/background pairing is contrast-checked in CI.

**Accent: Arcane's violet.** Arcane 2.16.1 uses `oklch(0.606 0.25 292.717)` (light) and `oklch(0.541 0.281 293.009)` (dark) for `--primary`, with `oklch(0.969 0.016 293.756)` text on it. JagHelm uses the same hues, with one adjustment: Arcane's light-theme value carries near-white text at about 4.2:1, below AA, so JagHelm uses the deeper value for filled controls in both themes.

| Role | Dark | Light | Use |
| --- | --- | --- | --- |
| `accent` | `oklch(0.541 0.281 293.009)` (≈ #7c3aed) | same | primary buttons, selected nav item, active tab indicator, toggles on |
| `on-accent` | `oklch(0.969 0.016 293.756)` (≈ #f5f3ff), ≈ 5.3:1 | same | text and icons on `accent` |
| `accent-text` | violet ≈ #a78bfa (≈ 7:1 on the dark background) | violet ≈ #6d28d9 | links, active tab label, accent icons on surfaces |
| `accent-tint` | accent at ~12–16 % | accent at ~8–10 % | selected row, hover on accent items |
| `focus-ring` | `oklch(0.606 0.25 292.717)` (≈ #8b5cf6) | same | 2px ring + 2px offset, ≥ 3:1 against the surface |

Purple means "interactive or selected", and it also tints section icon chips and fills meters below their threshold (signed off in the mock, 2026-10-19). It never appears in status or charts' threshold colours. Settings → Appearance offers two other accents, Fuchsia and Cyan, and no accent may read as a status colour (§15).

**Surfaces and text.** Dark: graphite tinted toward the accent hue (background `oklch(0.155 0.006 286)`, `surface-1/2/3` at L 0.198 / 0.238 / 0.285, chroma ≤ 0.01), which keeps Arcane's dark-neutral feel without copying its pure greys; light: near-white with the same faint tint. The values are the mock's Tokens board. Borders `border-subtle` and `border-strong`. Text `text-1` (≥ 7:1), `text-2` (≥ 4.5:1), `text-3` (≥ 4.5:1, sparing), `text-disabled`.

**Status roles**, each with `fg`, `bg-tint`, `border`, `solid` and `on-solid`:

| Role | Hue | Shape | Meaning |
| --- | --- | --- | --- |
| `ok` | green | filled disc | healthy |
| `warn` | amber | slashed disc | degraded, caution |
| `crit` | red | disc with a bar (as the mock) | down, critical |
| `unknown` | steel grey | hollow ring | no signal: the source failed or has no data |
| `maintenance` | blue | wrench | planned work (Kuma maintenance) |
| `info` | blue | — | neutral information, not a state |

The UX audit proposed violet for maintenance; with purple now the accent, maintenance moves to blue. Healthy uses `ok` at most as a small lamp. Node colours chosen by the user show as a 10px swatch only. The chart palette is six categorical colours that avoid red, amber, green and the accent hue, plus one sequential ramp; meters change colour only above thresholds, using the status roles.

### 5.3 Type, spacing, shape, motion

- **Type.** Manrope, self-hosted, with tabular figures (signed off in the mock, 2026-10-19). Settings → Appearance also offers Plus Jakarta Sans and Montserrat; all three ship with JagHelm and only the chosen one is downloaded. Monospace (JetBrains Mono, self-hosted) only for hostnames, SHAs, paths and code. One text-size setting (Default or Large) replaces today's nine per-element font sizes. The display face goes. Scale: caption 12/16 · body-sm 13/18 · body 14/20 · title-sm 16/22 · title 20/26 · display 28/32 · metric 24/28 tabular · metric-lg 32/36 tabular. Minimum 12px; 11px uppercase overlines only at ≥ 4.5:1.
- **Spacing.** 4, 8, 12, 16, 24, 32, 48. Panel padding 16 (compact) or 20 (comfortable). Page gutter 16 / 24 / 32 by breakpoint.
- **Radius.** Arcane's single radius token, mapped: 4 badges, 8 controls and rows, 12 panels and dialogs, full for pills and lamps.
- **Elevation.** Flat panels with a 1px border; popovers and dialogs get a shadow and a scrim. No blur, mesh, dot grid or gradient text.
- **Z-index.** 0 / sticky 20 / header 40 / overlay 50 / dialog 60 / toast 80.
- **Motion.** 150ms for drawers and popovers; animate bars only; respect reduced motion.
- **Density.** Compact (32px rows) and Comfortable (40px). These replace the font sliders and the nine card-style combinations.

### 5.4 Components (one library, `src/ui/`, used by web and Android)

| Group | Components |
| --- | --- |
| Shell | AppHeader with annunciator, Nav (sidebar on desktop, bottom tabs on phones), CommandPalette |
| Status | StatusLamp, StatusWord/Badge, AttentionPanel, IssueRow, SubsystemStrip |
| Data | EntityRow (density variants), MetricMeter, Sparkline (with tooltip), FactList (an entity's facts as label and value, the mock's drawer list; this table first called it StatStrip), Table, UptimeBar (Kuma-style heartbeat strip), Chart |
| Containers | Panel, Drawer, Dialog/Confirm, Popover, Tooltip, Toast, Banner (cause-naming), EmptyState, Skeleton |
| Controls | Button (primary, secondary, ghost, danger × sm, md), IconButton, Input, Select, Switch, Checkbox, Field, SegmentedControl, Tabs |

The Android components that already work (StatusLamp, StatusWord, IssueRow, SubsystemStrip, SystemStatusCard, UsageBar) are the starting point and move into `src/ui/`. Emoji appear only in user content.

## 6. The status model (server)

Severity is computed once, on the server, and every consumer renders it: the web Overview, the Android app, and push notifications. Neither client computes severity.

- **Per entity** (service, container, node, UPS, job, backup, integration): `{ id, kind, state, reason, metric?, since? }`, where `state` is one of `ok | warn | crit | unknown | maintenance` and `reason` is a short human sentence ("Disk 94 % (warning above 90 %)", "Kuma: HTTP 502", "No data: Prometheus unreachable").
- **Per subsystem** (Services, Nodes, Power, Jobs, Backups, Integrations): worst-of state plus counts ("31 / 32 up").
- **Overall:** worst-of state, a one-line sentence ("2 services down · UPS on battery"), and a ranked issue list (crit before warn before unknown; within a level, by subsystem order, then age). When nothing is set up and every read that ran answered (a first run), the overall state is `empty` and the sentence "Nothing monitored yet" (#449).
- **Sources:** `{ prometheus, kuma, nut, gitea, … }`, each `ok | failed` with the error, from the per-source flag introduced by #232. **When a source fails, the entities it feeds become `unknown` with a reason naming the source; they never become `crit`.** The overall sentence names the failed source, and push sends a single "monitoring source down" event instead of one per entity.
- **Thresholds** (CPU, memory, disk, temperature, UPS) live in one server config with today's defaults, editable in Settings → Notifications.
- **Transport:** one endpoint (e.g. `/api/status`) with an ETag, polled by both clients; push's differ consumes the same model.
- **Proof:** a cross-client fixture test. The same fixture JSON (healthy, incident, source-down, first run) must produce the same headline, counts and per-entity states on web, Android and push.

### 6.1 Severity rules (my call — the one to check first)

Today three sets disagree: web turns amber at 70 % and red at 90 % on any usage; Android flags only CPU ≥ 90 or temperature ≥ 75, as amber, and ignores memory and disk; push fires at CPU, memory or disk ≥ 90 % with 5-point hysteresis and ignores temperature. The model replaces all three with one table. It keeps push's 90 % line (so paging behaviour barely changes) and keeps the board calm (no amber at 70 %).

| Entity / condition | warn | crit |
| --- | --- | --- |
| Node CPU | ≥ 90 % for 2 consecutive cycles | — |
| Node memory | ≥ 90 % | — |
| Node disk, storage pool | ≥ 90 % | ≥ 95 % |
| Node temperature (hottest sensor) | ≥ 75 °C | ≥ 85 °C |
| Node: no metrics while Prometheus is healthy | — | unreachable |
| Service (Kuma) | pending for more than one cycle | down |
| Container that backs a monitored service, missing | missing (it follows its Kuma monitor: unknown while that is pending, maintenance while it is in maintenance) | — (while the monitor is down, its own card is the crit, #438) |
| Other container, missing | missing | — |
| UPS | — | on battery, or low battery |
| Job (cron) | failed last run, or overdue | — |
| Backup | overdue | failed last run |
| Integration | unreachable or auth failed | — |
| Arcane agent | offline | — |
| Monitoring source (Prometheus, Kuma, NUT) failed | the source itself: warn | — (its entities become `unknown`) |

- Recovery uses hysteresis: 5 points for percentages, 5 °C for temperature.
- Worst-of order: `crit` > `warn` > `unknown` > `maintenance` > `ok`. `unknown` entities appear in the issue list (steel) and break the quiet line ("31 up · 1 no signal"). `maintenance` does not: it shows in the subsystem detail ("1 in maintenance").
- An empty board (nothing set up, and every read that ran answered) is neither `ok` (nobody checked) nor `unknown` (nothing went silent): its overall state is `empty`, the board's alone, never an entity's. It is no issue, pages nothing, and the screens show it as the quiet line, "Nothing monitored yet", until first run's guided setup takes that slot. A board with nothing on it for any other reason (Kuma or Gitea set up with no nodes, a refresh that left nothing) stays `unknown`, and a Prometheus that doesn't answer is a failed source (#449, ADR 0006).
- Push sends a notification when an entity enters `warn` or `crit` and when it recovers, subject to the category toggles in Settings → Notifications.
- All numbers are defaults in the server threshold config.

### 6.2 What feeds the model

- **Kuma heartbeat history.** Kuma's `/metrics` carries only the current state, and the homelab Prometheus doesn't scrape Kuma. JagHelm records each monitor's state every cycle into a bounded in-memory ring (the last 50 per monitor; ADR 0002). This doesn't conflict with #266: that removes JagHelm's copy of data Prometheus already holds, and Kuma's history isn't there. The ring refills within about 25 minutes after a restart. The strip ships in Phase 2 (P2-4), not Phase 1.
- **Backups** are the Proxmox vzdump results JagHelm already receives, plus any cron job marked as a backup in JagHelm's config (Settings → Nodes & Services from Phase 3; the config file before that). There is no reporter contract change in homelab-infra.
- **Arcane.** An offline Arcane agent is an entity (Integrations subsystem, `warn`). Pending updates, held-back updates, new releases and vulnerability digests are events, not states: they keep their push notifications and are recorded in Alerts history (#267), but don't appear as Overview issues.

### 6.3 Compatibility with older Android apps

Phones may run a sideloaded 1.2.x for months. `/api/status` sits beside the existing endpoints; it doesn't replace them. `/api/services`, `/api/ups` and `/api/cron/status` keep their shape and meaning, guarded by contract tests, until one release after Phase 4, and are then removed (P4-4). New states (`maintenance`, `pending`) appear only in `/api/status`; the old endpoints keep today's values. A field whose meaning changes (for example #234's RX/TX moving from a cumulative counter to a rate) gets a new name, and the old field stays until that removal. The five routes #264 deletes have no web or Android caller.

## 7. Information architecture

**Navigation:** Overview · Services · Infrastructure · Alerts · **Apps** (one entry per embedded app) · Launch · Settings. Desktop: a slim grouped sidebar (collapsible to icons) plus the 48px header. Phones: a bottom tab bar (Overview, Services, Infrastructure, Alerts, More). Every service and node has its own URL, so a push notification and a palette result open the right place.

**Header (annunciator),** full width, 48px: logo and instance name; lamp and the overall sentence; "updated 12s ago"; command palette (⌘K); settings; account. A "No signal" steel state when the backend is unreachable — the same word and colour on both clients.

**Settings,** seven sections behind a searchable card index (Arcane's pattern). Search also finds individual settings inside sections ("font" finds Appearance → Typeface and Text size):

| Section | Contents |
| --- | --- |
| Sources | Prometheus, Kuma, NUT, Gitea, cron reporters, each with live health |
| Nodes & Services | names, URLs, monitor mapping (with match suggestions, #240), groups |
| Integrations | gallery, configure, test, live status per integration |
| Apps & links | embedded apps (name, URL, icon, order, open in a new tab instead, an embedding check on add) and Quick Launch links; link target; the Launch page's search engine |
| Notifications | push categories, thresholds, registered devices and "Send test push" (#268) |
| Appearance | theme (dark / light / system), accent (violet by default, Fuchsia, Cyan; §15), typeface (three), text size, density, Overview sections (show/hide), branding, temperature unit |
| System | auth and sessions, backup, about |

The live preview goes (M10): changes apply to the real board.

## 8. Screens

**Overview (desktop, ≥ 1024px), top to bottom.**

1. **Attention panel**, only when something is wrong: a 24px headline with the status word coloured, a subline naming the items, and the ranked issue list (lamp, word, entity, where, reason, age). Each row opens its entity's detail drawer. Healthy: the panel collapses to one quiet line ("All 32 services up · 6 nodes healthy").
2. **Subsystem strip:** Services, Nodes, Power, Jobs, Backups, Integrations; lamp, word, detail ("31 / 32 up"). Clicking one filters the sections below.
3. **Infrastructure:** node cards, or a table (toggle, remembered). Each node: CPU, memory, disk and temperature meters, coloured only above thresholds; a 1h sparkline; up/down counts.
4. **Services:** one dense list grouped by node (or by tag or custom group). Each row: lamp, name (never truncated before anything else), node, one headline integration metric, latency, Kuma heartbeat strip. Healthy rows are muted.
5. **Utilities rail** (≥ 1440px): Quick Launch, Pipeline, Checklist (todos). Below 1440px they move to the Launch tab.

The layout reflows with content: sections grow to fit, never clip. Unconfigured sources render no panel (no "Unknown" placeholders).

Today's extras keep a home: weather and the clock move from the header to the utilities rail (shown when configured); the web-search box moves to the Launch tab; the Proxmox VM list and storage pools move to the node's detail drawer and the Infrastructure page (pools feed the disk rule in §6.1). Hiding a section stays possible from Phase 1 as a simple show/hide setting; reordering waits for Edit layout in Phase 5.

**Phone width (< 768px), web and Android:** the Android screens, rendered from shared code: system status card, subsystem strip, issue list, then Services and Infrastructure as lists; detail as a full-screen sheet. Tablet (768–1023px): the desktop Overview in one column with the subsystem strip wrapping.

**Detail drawer** (desktop) / detail screen (phone), from any service or node: state and reason; Kuma heartbeat history (JagHelm samples each monitor's state every cycle into a bounded in-memory ring, the last 50 per monitor; Kuma's metrics carry no history); CPU / memory / disk charts for 1h / 24h / 7d from Prometheus `query_range`; integration stats; per-container CPU, memory and RX/TX (drill-down only); links (Open, Grafana, Kuma); config shortcuts.

**Services** and **Infrastructure** pages: the full lists with search, filters and the cards/table toggle.

**Alerts:** active issues (the model's issue list) and history (persisted events from #267), filterable by entity and severity; the same view on Android.

**Apps:** each embedded app opens in the content area under the header, so status stays in view; it stays loaded when you switch away (a dot in the sidebar marks the loaded ones) and tells a slow load from a blocked one, offering "Open in new tab" when the site forbids embedding (#269, #296). Apps are in the command palette. On phones they sit under More.

**Launch:** Quick Launch link groups (every group renders) and the web search.

**First run:** a guided setup — connect Prometheus, pick nodes, optionally add Kuma, NUT and integrations — ending on a populated Overview. No author-specific defaults anywhere (node names, UPS model, weather location).

**Demo mode:** contract-true fixtures (healthy and incident, switchable), no outbound calls, downloads or writes, auto-save off. A render test keeps it working.

**Edit layout mode (Phase 5):** pin, reorder, group and hide sections and services on top of the reflowing layout. The layout stored on the server is this arrangement, versioned (#233), not pixel positions.

**Login:** the shared component set; labelled fields; the forced first-login password change stays.

## 9. Android

Android switches to the server status model in Phase 1, not Phase 4, because phone-width web renders the same screens and must not compute its own severity; the Phase 1 release therefore ships an APK and includes a check on the phone. Phase 4 then rebuilds Android's screens on `src/ui/`. Along the way Android stops computing severity in `mobile/src/data/derive.js`, gains tab-bar icons and an account entry for session controls, its issue rows open their detail screen, and its accent turns violet. Push payloads carry the status model's `reason` so notifications read the same as the screens.

## 10. Performance and correctness work

Server-side fixes from #270 are independent of the visual work and go first, in the tracker's order. Some are prerequisites:

| Issue | Needed before | Why |
| --- | --- | --- |
| #232 source-aware alerting | Phase 0 | The status model's `sources` and `unknown`-on-failure build on its per-source flag |
| #234 batched Prometheus queries + correct temperature, RX/TX, memory | Phase 1 | The board must show correct numbers |
| #233 versioned shared config | Phase 5 | Edit layout stores its arrangement through it |
| #267 persisted alert events | Phase 2 | Alerts history renders it |
| #237 / #238 polling | Phase 1 / Phase 4 | The request budget |

These are absorbed by a phase and close when it lands, rather than being fixed separately in today's UI: #258 Kuma maintenance and pending (Phase 0, as the `maintenance` state), #243 grid layout shift and #252 render cost (Phase 1), #266 the history ring buffer (Phase 2, replaced by `query_range` charts), #260 locale, units and personal defaults and #268 test push and devices (Phase 3), #262 mobile CSS (Phase 4). #244 self-hosted fonts and #248 the demo fix are quick wins; Phase 0 picks the final faces on top of #244, and Phase 3 keeps the demo working.

## 11. Phases

Each phase is a release and ends with Jag's hands-on check on staging (a ~10-item visual checklist), then the release.

| Phase | Scope | Exit criteria |
| --- | --- | --- |
| **Quick wins** | UX quick wins 1–11 and the perf quick wins in #270 that don't touch the web UI being replaced | Merged; the issues closed |
| **0 — Foundations** | Tailwind v4 + shadcn/ui set-up; tokens (§5) with CI contrast checks; self-hosted fonts and Lucide; `src/ui/` with the components in §5.4; the server status model (§6) and its cross-client fixture test | Fixture test green; axe contrast checks green on a component gallery page in both themes; Android still renders correctly on the old screens |
| **1 — Web Overview** | Header, attention panel, subsystem strip, reflowing Infrastructure and Services, utilities rail; phone web renders the Android screens; Android moves to the status model (APK); section show/hide; the ten old themes retired (saved choices map to dark or light) | 3-second test passes on the incident fixture at 390 / 1024 / 1440 / 2560; no clipping or sideways scroll at any width; budgets in §4 met; the cross-client fixture test covers Android |
| **2 — Drill-down** | Entity URLs; detail drawer with charts and heartbeat history; Services, Infrastructure and Alerts pages; command palette over services, nodes and issues | Every issue row and push notification opens its entity |
| **3 — Settings and first run** | Seven-section searchable Settings; guided first run; demo mode fixed; density presets; no live preview | A fresh install reaches a populated Overview without editing files; demo render test green |
| **4 — Android parity** | Android screens rebuilt on `src/ui/`; account entry; copy fixes; violet; the old endpoints retired one release later (§6.3) | Jag's check on the phone |
| **5 — Customisation** | Edit layout mode; themes as validated data | Arrangement round-trips across two devices without loss |

Before Phase 1 is built, a clickable static mock of the Overview (healthy and incident; dark and light; desktop and phone) is shown to Jag to lock the visual direction, as the 2026-06-27 mobile refresh did. Done: signed off 2026-10-19 (#295, §15).

## 12. Verification

- Playwright screenshots of every screen against fixtures (healthy, incident, source-down, first run, demo, backend unreachable) at 390, 1024, 1440 and 2560px, in both themes, kept as visual-regression baselines.
- axe on every screenshot state: zero violations.
- Lighthouse mobile CLS and transfer size, and a request counter per tick, against the §4 budgets.
- The cross-client status fixture test (§6).
- Jag's UAT checklist per phase.

## 13. Left to the builder

File and folder structure inside `src/ui/` and the shared screens; the headless primitive library under shadcn/ui (Radix or Base UI); the exact OKLCH ramps for surfaces, text and status hues, within the contrast rules; the status endpoint's exact name and JSON shape; how phone-width web shares the Android screens (move them under `src/`, keep platform adapters such as native HTTP, push and storage in `mobile/`); chart library (must fit the budget, or hand-rolled SVG); migration of old saved settings; the order of work inside a phase.

## 14. Calls made for Jag to check

1. shadcn/ui on Tailwind v4 as the component stack (§5.1).
2. The accent uses Arcane's deeper violet for filled controls in both themes, because Arcane's light value fails AA with white text (§5.2).
3. Maintenance moves from violet to blue, so purple only ever means "interactive" (§5.2).
4. The ten current themes are removed; saved choices map to dark or light (§2, Phase 1).
5. JagHelm's `/metrics` gets scraped rather than the SLO code removed (#259), and the Gitea widget drops to every 5 minutes (#249).
6. Audience is "both", so the demo is fixed rather than deleted (#248).
7. The severity table (§6.1): one set of rules replacing three, keeping push's 90 % line.
8. Android moves to the server model in Phase 1, so the Phase 1 release includes an APK (§9).
9. Kuma heartbeat history is recorded by JagHelm in memory (§6.2).
10. Backups = Proxmox vzdump results plus cron jobs marked as backups in JagHelm's config; Arcane agent-offline is a state, Arcane updates and vulnerabilities are events (§6.2).
11. Weather and clock move to the utilities rail, web search to Launch, Proxmox VMs and pools to drill-down; show/hide sections from Phase 1 (§8).
12. The old endpoints stay unchanged until one release after Phase 4 (§6.3).

## 15. Amendments after the mock sign-off (2026-10-19)

Jag reviewed the clickable mock (private: https://claude.ai/artifact/Dv7EGVXZLe4ocsssZrwmkf, version 8: Overview desktop and phone, Tokens, Settings, and where today's settings go) and signed it off: "I'm good to build the new design. It's a great first step and we can improve the nitty gritty details as we go along." Earlier the same day he said it is "mature, easy to understand and gives me relevant information right away".

| Change | Why | Sections | Cards |
| --- | --- | --- | --- |
| Embedded apps become a sidebar group, open under the header, stay loaded | Jag: the embedded tabs are one of the best things about JagHelm today; this spec had moved them into Launch and the first mock had none | §2, §7, §8 | #296, #269, #301, #362 |
| Settings has seven sections, adding Apps & links | Today's Tabs and Links tabs need a home; the map of all 13 current tabs is in the mock | §7, §11 | #317, #362 |
| Manrope is the typeface; Plus Jakarta Sans and Montserrat are options; one text-size setting | Chosen in the mock (Montserrat is Arcane's face, offered but not the default) | §5.3 | #244, #284, #321 |
| Violet also tints section icon chips and below-threshold meters | As the mock shows; status hues stay reserved for status | §5.2 | #283, #321 |
| Accents: Violet (default), Fuchsia, Cyan; Blue, Indigo and Graphite dropped because they read as status colours (Jag, 2026-10-19) | The mock offered five. Blue sat on maintenance's blue, Indigo nearly did in light, and Graphite's meter was the "no signal" grey. Cyan (hue 215) is new. An accent's colours stay at least ΔE OK 0.05 from every status colour in both themes, and a test enforces it | §5.2, §7 | #283, #321 |
| Dark neutrals are graphite tinted toward hue 286 | JagHelm's own identity next to Arcane's pure greys; with flat 12px panels, the shaped lamps and JagHelm's own shield (not the mock's wheel mark, #530), it keeps JagHelm from reading as an Arcane clone | §5.2 | #283 |
| Removed from Settings: the welcome message, background image and dot grid, the nine per-element font sizes, per-section titles, icons and colours | Proposed in the settings map; accepted with the sign-off; any can come back | §7 | #317, #321 |

The open calls were taken as the mock shows them; Jag can revisit any of them as the phases land.

