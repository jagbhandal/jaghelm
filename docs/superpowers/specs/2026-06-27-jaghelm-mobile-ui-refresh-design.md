# JagHelm Mobile — "Toned-Down Cockpit" UI/UX Refresh — Design Spec

- **Date:** 2026-06-27
- **Status:** Approved (visual direction locked with Jag via mocks) — pending spec review
- **Branch:** `feat/mobile-ui-refresh` (already checked out)
- **Author:** Tej (with Jag)
- **Scope:** `mobile/src/**` only. The web/desktop app (`src/**`, `src/styles/global.css`) is **untouched** except where a token layer is *explicitly shared* (see §9 Login). Every new style is scoped to `#mobile-root` (or the auth shell) so the web app renders identically.
- **Locked mocks (this spec reproduces them exactly):**
  - `scratchpad/mocks/hybrid-v2.html` — outage state
  - `scratchpad/mocks/hybrid-v2-clear.html` — healthy state

---

## 1. Goals / Non-goals

**Goals**
1. Reproduce the locked "toned-down cockpit" hybrid: avionics-style **worst-of annunciator hero** + **2×2 subsystem cells** + **prioritized issues list** + a **monospace data plane**, rendered in JagHelm's dark/indigo identity on a **carbon-black** background with **calm** status colors.
2. Fix all 14 confirmed defects (§10).
3. Make status **triple-coded** (word + color + shape) and severity **strict worst-of** so an outage can never read as amber/green and unreachable can never read as green.
4. Cut "monospace overload" with a **three-role type system** (§4).
5. Keep `derive.js` the single, pure, table-tested source of severity/dedup logic.

**Non-goals**
- No new server endpoints, no new data. We render the existing snapshot (`/api/services`, `/api/ups`, `/api/cron/status`, `/api/display-config`). No fabricated time-series.
- No breathing-red glow, **no CRT scanlines**, no WebGL (explicitly rejected by Jag).
- No new tab structure, nav model, or routing changes. No push/pipeline work.
- No light-theme / theme-switcher on mobile (mobile is dark-first, single identity).

---

## 2. Design principles

1. **Chrome ≠ status.** Indigo (`--accent`) is used **only** for chrome: active tab, links, the refresh progress line, the "next Xs" countdown. **Status meaning is carried only by green/amber/red/steel.** The eye learns the split.
2. **Triple-coded status, always.** Every status shows the **WORD** + the **color** + a distinct **shape** (colorblind-safe). The word "down" is always visible; never a bare triangle.
3. **Strict worst-of.** Overall and each subsystem compute **MAX** severity, never average. A single down service turns the whole hero red.
4. **Calm, not theatrical.** Soft web-palette status tints (9% bg fills, ~24% borders). Motion is minimal: a progress line + gentle transitions. Full `prefers-reduced-motion` path.
5. **Glanceable < 2s.** The hero answers "is anything wrong?" before you read anything. Density up, card size down.
6. **A sentence is never mono.** Prose in DM Sans, data in JetBrains Mono, display/titles in Outfit (§4).

---

## 3. Visual system — tokens

All tokens below are added to **`mobile/src/MobileApp.css`** inside a `#mobile-root { … }` block (and mirrored to the auth shell selector for Login, §9). They **shadow** the inherited One-Dark web tokens for mobile only. The web `global.css` is not edited.

| Token | Value | Role |
|---|---|---|
| `--bg` | `#0A0D0C` | carbon-black base |
| `--bg2` | `#0E1211` | tab bar / secondary surface |
| (root bg) | `radial-gradient(120% 80% at 50% -12%, #14191B, transparent 58%), var(--bg)` | subtle top lift on `#mobile-root` |
| `--card` | `rgba(255,255,255,0.04)` | glass card |
| `--card-inner` | `rgba(255,255,255,0.025)` | nested glass |
| `--border` | `rgba(99,102,241,0.12)` | default border |
| `--border2` | `rgba(99,102,241,0.22)` | emphasized border |
| `--accent` | `#6366f1` | **chrome only** (indigo) |
| `--accent-light` | `#818cf8` | chrome hover / countdown |
| `--green` | `#34d399` | up/ok |
| `--green-bg` / `--green-bd` | `rgba(52,211,153,0.09)` / `…,0.24` | up tint |
| `--red` | `#f87171` | down/critical |
| `--red-bg` / `--red-bd` | `rgba(248,113,113,0.09)` / `…,0.24` | down tint |
| `--amber` | `#fbbf24` | caution |
| `--amber-bg` / `--amber-bd` | `rgba(251,191,36,0.09)` / `…,0.24` | caution tint |
| `--muted` / `--steel` | `#848b98` | unknown / no-signal |
| `--text` | `#e6e9ef` | primary text (daylight-bright) |
| `--label` | `#9aa3b5` | silkscreen labels / sublines |
| `--disp` | `'Outfit', sans-serif` | display |
| `--mono` | `'JetBrains Mono', monospace` | data plane |
| `--body` | `'DM Sans', sans-serif` | prose |
| radius | `20px` hero/cards, `16px` cells | — |
| blur | `backdrop-filter: blur(12–18px)` | glass (18 hero, 12 cells) |

**Mapping to existing mobile tokens:** the mobile block in `MobileApp.css` already redefines `--text-primary/-secondary/-muted` and the `--text-*` size scale. We keep that pattern and **add** the carbon tokens above. Reused components still reference the **legacy** One-Dark token names, so the `#mobile-root` block (and the shared `.mobile-shell` auth selector, §7.10) must **alias every legacy name still in use** to the carbon palette, or reused CSS silently falls back to the inherited One-Dark `#282c34` surfaces. Required aliases (legacy ← carbon):

| Legacy token (used by reused CSS) | Aliased to |
|---|---|
| `--bg-primary` | `radial-gradient(... #14191B ...), var(--bg)` (root); `var(--bg)` flat |
| `--bg-secondary` | `var(--bg2)` |
| `--bg-card` | `var(--card)` |
| `--bg-card-inner` | `var(--card-inner)` |
| `--bg-card-hover` | `rgba(255,255,255,0.06)` |
| `--glass-bg` | `var(--bg2)` (tab bar / status bar) |
| `--glass-blur` | `14px` |
| `--border-color` | `var(--border)` |
| `--border-glow` / `--glass-border` | `var(--border2)` |
| `--accent` / `--accent-light` / `--accent-glow` | unchanged `#6366f1` / `#818cf8` / `rgba(99,102,241,0.12)` |
| `--text-primary` / `--text-secondary` / `--text-muted` | `var(--text)` / `var(--label)` / `var(--muted)` |
| `--font-display` / `--font-body` / `--font-mono` | `var(--disp)` / `var(--body)` / `var(--mono)` |
| `--green` / `--green-bg` / `--green-border` | `#34d399` / `var(--green-bg)` / `var(--green-bd)` |
| `--red` / `--red-bg` / `--red-border` | `#f87171` / `var(--red-bg)` / `var(--red-bd)` |
| `--amber` / `--amber-bg` / `--amber-border` | `#fbbf24` / `var(--amber-bg)` / `var(--amber-bd)` |
| `--card-radius` / `--card-radius-sm` | `20px` / `16px` |
| `--accent-glow` (chip active bg) | `rgba(99,102,241,0.12)` |

(The carbon names `--green-bd/--red-bd/--amber-bd` are new; the legacy `*-border` names alias onto them. Spacing `--space-*` is inherited unchanged.)

**Reduced motion:** progress line freezes at `scaleX(1)` (opacity 0.3); all transitions neutralized. (The global `@media (prefers-reduced-motion)` in `global.css` already covers descendants; we add an explicit mobile rule for the progress line.)

---

## 4. Typography — three locked roles

This is the fix for "monospace overload." Three roles, no overlap:

| Font | Token | Used for | Never used for |
|---|---|---|---|
| **Outfit** (display) | `--disp` | hero status sentence, screen titles (`h1`), section headings, login wordmark | data values, prose |
| **JetBrains Mono** (data plane) | `--mono` | status WORDS, counts, %, ms, uptime, node tags, readout footers, silkscreen `lab` labels, tables | full sentences |
| **DM Sans** (prose) | `--body` | incident cause sentences, empty-state copy, helper/login text, service names | numeric data |

**Hard rule:** a sentence is **never** set in mono. Service/incident *names* are DM Sans; their *metrics* are mono. The "system status" silkscreen label, counts footer, and cell words are mono; the hero headline and the cause subline are not.

**Self-hosted font weights (CSP `font-src 'self'` — verified against `mobile/src/styles/fonts.css`):**
- **Outfit** ships `300–800` → display headings at **700** are valid. ✓
- **DM Sans** ships `300–600` → prose at **500** is valid. ✓
- **JetBrains Mono** ships **`400` and `500` ONLY** → the data plane uses **weight 400/500 only**. There is **no self-hosted mono 700**; requesting `font-weight:700` would clamp to 500 and look inconsistent. **Emphasis in the data plane = weight 500 + `text-transform:uppercase` + color + size — never 700.** Status WORDS and cell words are mono **500**, uppercased, colored by severity.
- *If a heavier mono is ever wanted, ship a self-hosted JetBrains Mono 700 `woff2` first — out of scope here.*

---

## 5. Severity model (strict worst-of)

Lives in **`mobile/src/data/derive.js`** (pure, table-tested). Four levels:

```
unknown (-1) | healthy (0) | caution (1) | critical (2)
```

**`overallSeverity({ services, ups, cron, unreachable })`:**
- `unreachable === true` **or** `services == null` → **`unknown`** (steel / NO SIGNAL). Never green. (Bug #4)
  - **`unreachable` source:** `useDashboard` returns `error` (the last fetch's rejection) but **keeps the last `servicesBody`** on error, so `services == null` only happens on *cold start*. A mid-session backend outage leaves a **stale non-null** body. Therefore callers pass **`unreachable = (data.error != null)`** (from `useDashboard.error`) into **both** `overallSeverity` **and** `deriveSubsystems`. With a live error, severity is forced to `unknown`/NO-SIGNAL even though stale data is still in hand — so an active outage never renders as stale green.
- else **`critical`** if any service `status === 'down'`.
- else **`caution`** if **any** of: UPS on battery (`ups.status === 0`) · cron newest-run failure · a node is "hot" (resource) · a "lone unknown" service exists.
- else **`healthy`**.

**Node "hot" (resource only)** — `nodeSeverity(node)`: `caution` if `cpu >= CPU_HOT` **or** `temp >= TEMP_HOT`; else `healthy` (`unknown` when the node reports no metrics). Constants: `CPU_HOT = 90`, `TEMP_HOT = 75` (°C). (Mirrors the existing `UsageBar` 75/90 ramp and the web NodeCard warn/critical halo intent.) **A down service does NOT make the node "down":** it drives the **Services** cell + the overall hero **red** — never the **Nodes** cell. This matches `hybrid-v2.html`, where the hero is red "Two services down" **while the Nodes cell is amber "DEGRADED · 1 hot · 94%"** (resource pressure), not red. Down-service counts still surface on the node via the up/down count text (red) in Infra/NodeDetail.

**Lone unknown service** — `hasUnknownService(services)`: any service with `status === 'unknown'` **and** `source !== 'presence'` (presence breadcrumbs stay steel/no-signal, never amber — they are not claiming a break).

**Worst-of, never average:** `overallSeverity` = `max(servicesSev, nodesResourceSev, upsSev, cronSev)`. Each subsystem severity is computed the same MAX way. A real outage (critical) can never be diluted to caution/healthy by healthy peers — and a hot node can never *mask* a down service, because they live in different cells.

**Per-subsystem severity + word** — `subsystemSeverity(key, ctx)` returns `{ severity, word, detail }`:

| Cell | critical (red) | caution (amber) | healthy (green) | unknown (steel) |
|---|---|---|---|---|
| Services | `DOWN` · `N / total` | `DEGRADED` · `N unknown` | `OK` · `total / total` | `NO SIGNAL` · `—` |
| Nodes | *(n/a — never red)* | `DEGRADED` · `1 hot · 94%` | `OK` · `N online` | `NO SIGNAL` · `—` |
| UPS | *(n/a — never red)* | `ON BATTERY` · `47% · 8m` | `MAINS` · `100%` | `NO SIGNAL` · `—` |
| Cron | *(n/a — never red)* | `FAILED` · `1 job` | `OK` · `0 fail` | `NO SIGNAL` · `—` |

Only the **Services** cell has a critical (red) level; Nodes/UPS/Cron top out at caution (amber). The **Nodes** cell reflects **node resource health only** (cpu≥90 or temp≥75 → amber) — a down service never reddens it (it reddens Services + the hero). The UPS readout `47% · 8m` = `{charge}% · {runtime}` where `runtime` is real (`ups.runtime`, `nut_battery_runtime_seconds`, formatted seconds→minutes); if `runtime` is absent it shows `47%` only.

---

## 6. Status language (triple-coded)

`statusToShape(status, source)` → one of four colorblind-safe shapes, rendered as **inline SVG** by a new `StatusLamp` component:

| Meaning | Word(s) | Color | Shape (inline SVG) |
|---|---|---|---|
| up / ok | `UP` / `OK` | green | **filled disc** (`<circle>` fill) |
| down / critical | `DOWN` | red | **disc with slash** (filled circle + diagonal cut) |
| unknown / no-signal | `UNKNOWN` / `NO SIGNAL` | steel | **hollow ring** (`<circle>` stroke only) |
| UPS on battery | `ON BATTERY` / `BATT` | amber | **bolt** (lightning `<path>`) |

`StatusWord` renders the word in `--mono` at **weight 500, UPPERCASE**, colored by severity (no 700 — see §4 self-hosted weights). **The word is mandatory everywhere a lamp appears** — the lamp never stands alone (kills the "tiny triangle" problem). This retires the glyph triangles (`▲▼◆`) in the current `StatusDot.jsx`.

**Note — mocks were simplified.** `hybrid-v2*.html` drew status as plain colored discs only. The **shipped** design keeps the full **four-shape** triple-coding above as canonical: it is a stated principle (colorblind safety / "never rely on color alone"), and the small extra effort buys WCAG-grade redundancy. The mocks lock the *palette, layout, and motion*; the shapes are the one deliberate elaboration over them.

---

## 7. Per-screen specs

Each screen lists layout, components, and the 7 states: **loading / healthy / degraded / down / unknown / empty / error**.

### 7.1 Pinned chrome (all tabs) — `RefreshStatus.jsx` → annunciator strip

The mock's top `.bar` = today's `RefreshStatus`, upgraded to a **worst-of annunciator** that persists across all four tabs.

- **Left:** `StatusLamp` dot (color = `overallSeverity`) + status sentence in `--mono` (`"2 services down"` / `"All systems operational"`).
- **Right:** `HH:MM · next Xs` — clock in `--muted`, **`next Xs` in `--accent-light`** (chrome). Tap = refresh now.
- **Bottom:** indigo progress line (`--accent`) filling over exactly one `intervalMs`; `key={lastUpdated}` restarts it. `prefers-reduced-motion` → static.
- **MobileApp.jsx** computes `overallSeverity` from `data` (via derive) and passes `{ severity, summary }` into `RefreshStatus`.

States:
- *loading* (no data yet): steel dot, `"Connecting…"`, no countdown.
- *healthy*: green dot, `"All systems operational"`, `next Xs`.
- *degraded/down*: amber/red dot, worst-of sentence, `next Xs`.
- *error/unreachable*: **steel** dot (NOT red, NOT green — unreachable is unknown), `"Can't reach JagHelm"`, `"Retrying…"`, progress line frozen steel. *(Intentional change from today's red-stale styling; see §9 bug #4 and §13 decision #2.)*

### 7.2 Overview — `views/Overview.jsx`

Matches `hybrid-v2.html` (outage) and `hybrid-v2-clear.html` (healthy). Layout top→bottom: **hero → 2×2 cells → Active issues**. The current per-node CPU/MEM list is **removed** (Bug #10 — it duplicates Infra).

1. **`SystemStatusCard` (new)** — glass hero, radius 20, blur 18, border tinted to overall severity, soft `::before` radial tint (`--{sev}-bg`), **no pulse**.
   - silkscreen `System status` (mono `lab`)
   - Outfit headline with the **status word colored** (`Two services <span class=red>down</span>` / `Everything's <span class=grn>healthy</span>`)
   - DM Sans subline (prose): `jellyfin · vaultwarden — plus UPS on battery` / `17 services up across 3 nodes — UPS on mains`
   - mono footer counts: `14 up · 2 down · 1 unknown · 3 nodes`

   **Headline wording rule (deterministic, no ambiguity):**
   - *healthy:* headline `Everything's healthy`; subline `{N} services up across {M} nodes — UPS on {mains|battery}`.
   - *down (critical):* count **1→"One", 2→"Two", ≥3→digit** (`One service down` / `Two services down` / `5 services down`); subline lists **up to 2 service names** joined by ` · `, then `+{N} more` when >2 (`jellyfin · vaultwarden` / `jellyfin · vaultwarden +3 more`); append ` — plus UPS on battery` / ` — plus {K} cron failures` when other caution conditions co-exist.
   - *caution (no down):* headline names the single worst caution — `UPS on battery` / `{K} cron job(s) failed` / `{K} node(s) running hot`; if several, headline the first by the same down→ups→cron→node-hot→unknown precedence and summarize the rest in the subline.
   - *unknown/unreachable:* headline `No signal`; subline `Can't reach JagHelm`.
2. **2×2 `SubsystemCell` grid (new)** — Services / Nodes / UPS / Cron. Each: mono `lab` label, `StatusLamp` top-right, big mono **WORD**, mono detail line. Border + tint by cell severity. Driven by `deriveSubsystems` (§5).
3. **Active issues** — `IssueRow` list (lamp + `StatusWord` + name (DM Sans) + **mono readout**), with an optional **prose cause** line under a down row. **Honest numbers (no fabricated time):** the snapshot has **no down-since / detection time** for derived incidents — there is no `downSince`, services carry no reliable freshness field, and `ping` is latency, not age. So **IssueRows never show an invented age/duration**. The readout is **node + a real datum only**:
   - *down service:* `{node}` (name only — no "12m"); the prose cause line is shown **only if a real cause exists** (e.g. a presence breadcrumb's `lastSeenAt` → "last seen X ago"); otherwise just `Service is down`.
   - *UPS on battery:* `{charge}% · {runtime}` (both real, §5).
   - *cron failure:* `{node}` + the real `run.error` as the cause line.
   - *unknown service:* `{node} · no signal`.
   - **Data source for the unknown rows:** `deriveIncidents` is extended to also emit **tracked-unknown services** (`status === 'unknown' && source !== 'presence'`) as steel `UNKN` rows (presence breadcrumbs excluded). **Issue sort order: down → UPS/battery → cron → unknown** (deterministic, stable within a kind by id).

States:
- *loading*: hero + cells render as skeletons (steel), issues area shows `Loading…`.
- *healthy*: green hero, all cells OK, issues area = **empty/clear state**: 🌙 + `Nothing on fire.` (DM Sans) + `last incident · 3 days ago` (mono).
- *degraded*: amber hero + amber cells (no down service), issues list shows battery/cron/unknown rows.
- *down*: red hero + Services cell DOWN, down rows pinned top with cause.
- *unknown/error*: steel hero `No signal — can't reach JagHelm`, cells all `NO SIGNAL` (steel), issues area shows the reused error banner.

### 7.3 Services — `views/Services.jsx` + `components/ServiceRow.jsx`

- **Search** (`SearchBar`, reskinned) + **fixed filter chips** + redesigned rows.
- **`ServiceRow`**: `StatusLamp` (shape) + **`StatusWord`** (`UP`/`DOWN`/`UNKNOWN`) + icon + name (DM Sans, ellipsis) + node tag (mono) + ping (mono). Whole row → `serviceDetail`. Compact (≤48px), worst-first sort retained.
- **`FilterChips` fixes (Bug #11):** symmetric padding + `min-width` so the active "All" is a **pill, never a lone circle**; consistent height via padding (not a forced square); **right-edge scroll fade** (CSS `mask-image` gradient on `.filter-chips`); **counts** per chip (`All 17`, `Down 2`, `node-03 6`). Active chip = `--accent-glow` bg + `--accent` text/border (chrome).

States: *loading* → skeleton rows; *healthy* → all UP green; *down* → DOWN rows pinned top, red lamp+word; *unknown* → steel ring + `UNKNOWN`; *empty* → `No services match.`; *error* → reused error banner above list, last-known rows dimmed.

### 7.4 Infra — `views/Infra.jsx` + `components/NodeCard.jsx` (keep, re-skin)

Strongest screen — **keep the structure**, re-skin to carbon tokens. This is the **only** place per-node metric bars live (Bug #10).

- **`NodeCard`**: header (name Outfit + subtitle mono) + `StatusLamp` for **node resource severity** (hot cpu≥90 / temp≥75 → amber; else OK; no metrics → steel) + up/down count (mono; **down count in red**) + **CPU / MEM / (TEMP|DISK)** `UsageBar`s. TEMP shown when the node reports temperature (the Pi), else DISK (existing `thirdMetric`). A node hosting a down service shows the **red down-count**, but its lamp stays resource-colored — "down" lives in the Services cell + hero, not in the node lamp (§5).
- **`UsageBar`** re-skinned: track `--border`, fill colored by worst-of threshold (`>=90` red, `>=75` amber, else green; `null` → steel `—`, bar hidden).

States: *loading* → skeleton cards; *healthy* → all bars green, lamp OK; *degraded* → hot node amber lamp + amber bar; *has-down-service* → amber/OK lamp (by resources) + **red down-count**; *unknown* → steel lamp + `—` bars; *empty* → `No nodes reported.`; *error* → error banner + dimmed last-known.

### 7.5 Alerts — `views/Alerts.jsx`

- **Active** (live-derived) pinned top in soft red, **compact `IssueRow`/alert cards that show the cause** (Bug #8 — active cards were less informative than history).
- **History de-dup (Bug #3):** the Phase-3 "stamp every incident `now`" duplication is removed. History renders **only incidents not in the active set** (`activeIncidentIds`). Since all currently-derived incidents are active, the history section is **empty by design** in snapshot-only mode → show `No earlier alerts this session.` (Real persisted history is a future server feed; the day-grouping stays wired for when it lands.)
- **Gear → NotificationSettings:** always enabled + indigo (chrome). Remove the `opacity:0.5/cursor:default` disabled styling.

States: *loading* → `Loading…`; *healthy/empty* → `All clear — nothing is on fire.`; *active/down* → red cards with cause; *unknown* → steel `UNKNOWN` rows; *error* → error banner.

### 7.6 ServiceDetail — `views/ServiceDetail.jsx` (Bug #7, #9, #12)

Fill the ~70%-empty screen within snapshot data:
- **Status header:** `BackHeader` (name) + `StatusLamp` + **`StatusWord`** (the WORD) + node tag + ping.
- **`UptimeRing` (new):** the `uptime24` scalar as a **radial gauge** (inline SVG arc, color by `uptimeColor` ramp, % centered in mono) — **not** a fake time-series sparkline (server has no series). `null` → omit.
- **"Last seen" line (real timestamps only):** shown **only** for a presence breadcrumb that carries `lastSeenAt` → `last seen {X} ago` (mono, via the existing `lastSeenLabel`). No `lastSeenAt` → **omit** the line entirely. `ping` is latency, not freshness, so it is shown in the header as `{ping}ms`, never reinterpreted as an age.
- **DOWN service:** show **cause / where** (`Service is down · {node}`) in DM Sans; **hide docker CPU/MEM** (Bug #12 — no `CPU 0% MEM 0 MB` for a stopped container). Docker metrics shown **only when up**.
- **`Open` demoted (Bug #9):** secondary ghost button (`--card-inner` bg, `--border`), not the loud indigo fill. Primary affordance is the row/card → detail, already satisfied by navigation.

States: *down* (cause + ring + no docker), *up* (ring + docker + ping), *unknown* (steel, ring omitted), *missing* (`This service is no longer reported.`), *error* (reused banner).

### 7.7 NodeDetail — `views/NodeDetail.jsx` (Bug #7)

- **Status header:** `BackHeader` + `StatusLamp`/`StatusWord` for **node resource** severity (§5) + up/down count (down count in red).
- **3 metric bars:** **CPU / MEM / (TEMP|DISK)** via `UsageBar` with worst-of thresholds — the third bar follows the existing `thirdMetric` (TEMP when the node reports temperature, else DISK), exactly like Infra's `NodeCard`. A non-Pi node thus shows **DISK**, not a steel `TEMP —`. (Not a fixed 4-bar layout.)
- **Service list:** worst-first `ServiceRow`s (lamp + word).

States mirror Infra per-node; *missing* → `This node is no longer reported.`

### 7.8 IncidentDetail — `views/IncidentDetail.jsx` (Bug #2, #7, #9, #14)

- **Header:** `BackHeader` + `StatusLamp`/`StatusWord` + node tag.
- **Cause** (DM Sans prose) + **`UptimeRing`**.
- **Timeline (Bug #2, #14) — honest numbers:** **remove** the `"Pending — push pipeline lands in Phase 5"` dev string. A **derived** incident has **no real detection/event time** in the snapshot, so it gets **no fabricated timeline** (no `Detected · 06:30` — that clock would be invented). For a derived incident, render a single mono **status line with no clock** (`Active — {node}`) plus the cause; that's all the snapshot honestly supports.
  - A **push-event deep-link** (the `params.type` fallback path) *does* carry a real timestamp from the push record → render `{event} · {HH:MM}` from that real value. **Timestamps appear only where the data genuinely exists** (push records, or a presence `lastSeenAt`); never synthesized.
- **`Open` demoted (Bug #9):** secondary ghost button.

States: *active/down* (status line, cause, ring — no fabricated time), *resolved* (`This incident has resolved.`), *push-event fallback* (real timestamp + severity + "may have resolved" note, no dev string).

### 7.9 NotificationSettings — `views/NotificationSettings.jsx` (Bug #13 partial — indigo controls)

Re-skin to carbon tokens; **indigo switches** (`accent-color: var(--accent)`). Keep structure: Categories (Services/Hosts/UPS/Cron) · Recovery toggle · Push master toggle · "Turn off push on this device" (destructive red) · Session controls (Log out / Forget device). Headings Outfit, labels DM Sans, any IDs mono.

States: *loading*, *ready*, *unavailable* (not-registered / no-creds / turned-off copy in DM Sans).

### 7.10 Login — `Login.jsx` + `Login.css` (Bug #13)

Login renders **outside** `#mobile-root`, so the brighter mobile tokens don't reach it today (the "thin low-contrast title"). Fix:
- **Share the token layer:** extract the carbon `--bg/--bg2/--card/--border*/--text/--label` + font aliases into a selector applied to **both** `#mobile-root` **and** the auth shell (`.firstrun`). Cleanest: define the token block on a shared class `.mobile-shell` and add it to both roots, OR duplicate the `:root`-style block under `.firstrun` in `Login.css`. (Recommended: `.mobile-shell` to avoid drift.)
- **Carbon bg + radial lift** on the login root.
- **Wordmark:** add a `JagHelm` wordmark in **Outfit** (the login title becomes branded display type, bright `--text`), with a DM Sans subtitle (`Connect to JagHelm` / `Sign in`).
- **Indigo checkbox:** the "Keep me signed in" checkbox gets `accent-color: var(--accent)` (kills the browser-blue).
- **Indigo button** (already `--accent`); inputs use carbon `--card-inner` + `--border`, focus ring indigo.

States: *first-run* (URL + creds), *re-auth* (creds only, shows known URL), *validating/busy* (`Signing in…`), *field errors* (red), *server error* (red).

---

## 8. Component architecture

**New primitives (`mobile/src/components/`):**

| Component | Purpose |
|---|---|
| `StatusLamp.jsx` | inline-SVG shape (disc / slash-disc / ring / bolt) colored by severity; `statusToShape` maps status→shape. **Replaces** the glyph logic in `StatusDot.jsx`. |
| `StatusWord.jsx` | the colored status WORD (`UP`/`DOWN`/`UNKNOWN`/`OK`/`DEGRADED`/`ON BATTERY`/`FAILED`/`MAINS`/`NO SIGNAL`) — mono **weight 500, UPPERCASE** (no 700; §4). |
| `SystemStatusCard.jsx` | Overview hero annunciator (label + colored headline + prose subline + mono counts). |
| `SubsystemCell.jsx` | one 2×2 cell (label + lamp + word + detail). Renders the array from `deriveSubsystems`. |
| `IssueRow.jsx` | one Active-issues row (lamp + word + name + readout) + optional prose cause. |
| `UptimeRing.jsx` | inline-SVG radial gauge of the `uptime24` scalar (color ramp + centered % ). **Supersedes** `UptimeLine.jsx` in detail screens. |

**Changed:**

| File | Change |
|---|---|
| `MobileApp.css` | add the `#mobile-root` carbon token layer + all new component styles (cells, hero, issue rows, lamp, ring, chips fade, reskins). Largest diff. |
| `MobileApp.jsx` | compute `overallSeverity` from `data`; pass severity+summary to `RefreshStatus`. |
| `RefreshStatus.jsx` | become the worst-of annunciator strip (lamp + sentence + clock + indigo countdown); steel (not red) error state. |
| `components/SubsystemStrip.jsx` | render `SubsystemCell`s with severity/word/shape (was degraded-bool + dot). |
| `components/IncidentCard.jsx` | compact card, cause always shown, `UptimeRing`, demoted Open. |
| `components/ServiceRow.jsx` | `StatusLamp` + `StatusWord`; reskin. |
| `components/NodeCard.jsx` / `views/Infra.jsx` | reskin + node-severity lamp. |
| `components/UsageBar.jsx` | reskin (carbon track, same thresholds). |
| `components/FilterChips.jsx` | pill sizing + counts + scroll fade. |
| `components/StatusDot.jsx` | retire glyphs → delegate to `StatusLamp` (or remove if fully replaced). |
| `views/Overview.jsx` | hero + cells + issues; **remove** per-node bar list. |
| `views/Services.jsx` | chip counts wiring. |
| `views/Alerts.jsx` | de-dup history (`activeIncidentIds`); enable gear. |
| `views/ServiceDetail.jsx` / `NodeDetail.jsx` / `IncidentDetail.jsx` | fill per §7.6–7.8; demote Open; hide docker-when-down; timeline timestamps; remove Phase-5 string. |
| `views/NotificationSettings.jsx` | reskin + indigo switches. |
| `Login.jsx` / `Login.css` | shared token layer + wordmark + indigo checkbox. |
| `data/derive.js` | add `SEVERITY`, `severityRank`, `overallSeverity`, `nodeSeverity` (resource-only), `hasUnknownService`, `subsystemSeverity`, `statusToShape`, `activeIncidentIds`, `CPU_HOT`/`TEMP_HOT`, `formatRuntime` (UPS seconds→`Xm`); extend `deriveSubsystems` + `overallSeverity` to take **`unreachable`** (→ NO-SIGNAL/unknown) and emit severity+word; surface `ups.runtime`; **extend `deriveIncidents`** to also emit tracked-unknown services as steel `UNKN` issues and apply the down→ups→cron→unknown sort; **drop fabricated incident timestamps** (no synthesized `_at`/age). |

**Design-token layer placement:** all tokens go in `MobileApp.css` scoped to `#mobile-root` (+ the shared auth selector). **`src/styles/global.css` is not modified.** `derive.js` stays pure (no React, no I/O) and remains the source of truth for severity + dedup.

---

## 9. Bug-fix table

| # | Bug | Root cause | Fix | File(s) |
|---|---|---|---|---|
| 1 | `24H uptime42.0%` jam (label/value) | **Shared** defect: `.detail-uptime { display:flex; justify-content:space-between }` (`MobileApp.css` ~L148) collapses the `{' '}` whitespace text node between `<span>` and `<strong>` in `components/UptimeLine.jsx` — hits **ServiceDetail + IncidentDetail + IncidentCard**, not IncidentCard-only | add `gap` to `.detail-uptime` (or restructure so the space isn't a flex-discarded text node). The `UptimeRing` rewrite structurally removes the text-node flex jam entirely | `components/UptimeLine.jsx`→`UptimeRing.jsx`, `MobileApp.css` |
| 2 | Dev string `Pending — push pipeline lands in Phase 5` | hard-coded Phase-5 placeholder in timeline | Remove; render only real timestamped events | `views/IncidentDetail.jsx` |
| 3 | Alerts duplicates active incidents under "Today" | Phase-3 stamps every incident `now` → history == active | History excludes `activeIncidentIds`; empty-state copy | `views/Alerts.jsx`, `data/derive.js` |
| 4 | Green-on-failure when backend unreachable | cold-start `deriveSubsystems(null)` → green; **and** mid-session: `useDashboard` keeps the last `servicesBody` on error → **stale non-null** body still renders green | thread **`unreachable = (data.error != null)`** from `useDashboard.error` into **both** `overallSeverity` **and** `deriveSubsystems`; a live error forces **unknown/NO SIGNAL** (steel) even with stale data in hand; annunciator steel, not red | `data/derive.js`, `RefreshStatus.jsx`, `MobileApp.jsx`, `views/Overview.jsx` |
| 5 | Monospace overload | one font for everything | Three-role type system (§4) | all views + `MobileApp.css` |
| 6 | Severity under-signaled | `degraded` boolean, averaged feel | Strict worst-of `overallSeverity` (§5) | `data/derive.js` |
| 7 | Detail screens ~70% empty | minimal layout | Status header + WORD + `UptimeRing` + cause + (real `last seen` only); per-screen layouts §7.6–7.8 | 3 detail views, `UptimeRing.jsx` |
| 8 | Oversized cards; active < history info | low density, missing cause on active | Compact cards; active cards show cause | `IncidentCard.jsx`, `views/Alerts.jsx`, `MobileApp.css` |
| 9 | `Open` is loudest CTA on DOWN | primary indigo fill | Demote Open to secondary ghost; row→detail is primary | `IncidentCard.jsx`, `ServiceDetail.jsx`, `IncidentDetail.jsx`, `MobileApp.css` |
| 10 | Overview duplicates Infra | per-node bars on Overview | Remove Overview node list; bars only in Infra | `views/Overview.jsx` |
| 11 | Filter chips: lone-circle "All", clip, no counts | 999px + forced height, no fade, no counts | Pill min-width + symmetric padding; scroll fade mask; counts | `FilterChips.jsx`, `views/Services.jsx`, `MobileApp.css` |
| 12 | `CPU 0% MEM 0 MB` on down service | docker block always rendered | Render docker only when service is up | `views/ServiceDetail.jsx` |
| 13 | Login thin title / browser-blue checkbox / no branding | login outside `#mobile-root` token scope | Shared token layer; Outfit wordmark; indigo checkbox | `Login.jsx`, `Login.css` |
| 14 | Timeline has no timestamps | events carried no time — **but** the snapshot has no real detection time for derived incidents (no `downSince`; `ping`≠age) | **timestamps only where the data genuinely exists** (push-event records, presence `lastSeenAt`); derived incidents show a clock-less status line, never a synthesized time (honest-numbers doctrine) | `views/IncidentDetail.jsx` |

---

## 10. Constraints

- **CSP:** `script-src 'self'`, `font-src 'self'`. Fonts are already self-hosted (`mobile/src/styles/fonts.css` → `outfit-latin.woff2`, `dmsans-latin.woff2`, `jetbrainsmono-latin.woff2`). **Add nothing external at runtime** — the mocks' Google-Fonts `<link>` is mock-only; the app keeps `fonts.css`.
- **Rendering:** CSS + inline SVG (`StatusLamp`, `UptimeRing`) + the existing tiny CSS/RAF progress line. **No WebGL.** Must hit 60fps on mid Android (no per-frame JS in steady state; backdrop-blur kept to hero + cells).
- **Shell:** preserve `100dvh` pinned shell, `overflow:hidden` root + scroll containment on `.mobile-content`, and `env(safe-area-inset-*)` handling already in `MobileApp.css`.
- **Glanceable < 2s, dark-first.** Bright `--text #e6e9ef` for phone-in-daylight.
- **Reduced motion:** full `prefers-reduced-motion` path (progress line static, no transitions).
- **Scope guard:** no edits to `src/styles/global.css` beyond the *shared* font/token reuse already present; web app must render unchanged.

---

## 11. Testing approach (TDD)

`derive.js` is pure → **vitest unit tables**; components → **@testing-library/react** render tests (the harness the repo already uses for mobile).

**derive.js unit tables:**
- `overallSeverity` worst-of table: down→critical; battery-only→caution; cron-fail-only→caution; node-hot-only→caution; lone-unknown→caution; all-healthy→healthy; `services:null`→**unknown**; **`unreachable:true` with a stale non-null body →unknown** (mid-session outage ≠ green); mixed (down + battery)→critical (not averaged).
- `nodeSeverity` (**resource-only**): cpu 90 / temp 75 boundaries → caution; no metrics → unknown; **a down service does NOT make it critical** (down lives in the Services cell + hero).
- `subsystemSeverity` Nodes cell: a node with a down service but healthy resources → **OK/green** (not red); hot node → DEGRADED amber. Services cell carries the red.
- `hasUnknownService`: `presence` source excluded; tracked unknown included.
- `subsystemSeverity`: word/detail per cell per level incl. `NO SIGNAL`; Nodes/UPS/Cron never emit a red/critical word.
- `statusToShape`: up→disc, down→slash, unknown→ring, ups-battery→bolt; presence→ring(steel).
- `deriveIncidents`: emits tracked-unknown (`status==='unknown' && source!=='presence'`) as steel UNKN; presence excluded; sort = down→ups→cron→unknown; **no `_at`/age field is synthesized** (honest numbers).
- `formatRuntime`: `ups.runtime` seconds→`Xm`; null runtime → charge-only readout.
- `activeIncidentIds` / dedup: history excludes active ids; all-active → empty history.
- uptime ramp unchanged (`uptimePct`, `uptimeColor`).

**Component render tests (key cases):**
- `RefreshStatus`: steel (not red) on error; indigo countdown; healthy green sentence.
- `SubsystemCell`: **unreachable ≠ green** (renders `NO SIGNAL` steel).
- `ServiceDetail`: **docker hidden when status down**; shown when up.
- `StatusLamp`+`StatusWord`: the word "DOWN" is present in the DOM (not a bare shape); shape mapping.
- `IncidentCard`/`UptimeLine`: no `24H uptime42.0%` jam (label/value separated by `gap`, not a whitespace node) — assert across ServiceDetail + IncidentDetail too.
- `IncidentDetail`: no `Phase 5` string; **no fabricated clock** on a derived incident; a push-event deep-link renders its real timestamp.
- `IssueRow`: a down-service row shows **no invented age** (node only); UPS row shows `{charge}% · {runtime}`.
- `Alerts`: active incident not repeated in history.
- `FilterChips`: counts render; active chip not a circle (snapshot/class assertion).
- Existing mobile tests stay green (already 246/247; the 1 pre-existing env fail is unrelated).

---

## 12. Rollout

- **One PR, full refresh**, on `feat/mobile-ui-refresh` (already checked out).
- **TDD:** write/extend the `derive.js` tables + component tests first (red), implement to green.
- **Post-implementation gate (HARD RULE):** run **`/simplify`** then **`/security-review`** before calling it done.
- **Review:** Jag reviews + merges the PR (never self-merge / never push to main). Recommend `/clear` after merge.
- **No deploy/runtime config changes** — pure mobile UI; ships in the next signed-APK build via the existing pipeline.

---

## 13. Resolved decisions

1. **UPS runtime — RESOLVED (it exists).** `server/refresh.js` sources `ups.runtime` (`nut_battery_runtime_seconds`) alongside `ups.charge`, `ups.load`, `ups.status`. The readout `{charge}% · {runtime→Xm}` is valid; `derive.js` (which today reads only `status`/`charge`) is extended to surface + format `runtime` (`formatRuntime`, seconds→minutes). Charge-only fallback when `runtime` is absent.
2. **Annunciator error/unreachable color — DECIDED: STEEL (unknown), not red.** Follows directly from "red = real outage" + "unreachable ≠ green." (Supersedes today's red stale-bar styling.)
3. **Alerts history — DECIDED: empty-by-design** until a real persisted history feed exists, with a clear empty state (`No earlier alerts this session.`). Day-grouping stays wired for the future feed.
4. **Login token sharing — DECIDED: a shared `.mobile-shell` class** carrying the same token block, applied to both `#mobile-root` and the auth shell (no drift; preferred over duplicating the block in `Login.css`).
5. **`StatusDot.jsx` — DECIDED: remove.** All call sites move to `StatusLamp` (+ `StatusWord`); one status renderer, no shim.

*No outstanding open questions.*
