# JagHelm v8.0 — Architecture Specification

**Project:** JagHelm — Real-time infrastructure dashboard for homelabs  
**Repo:** `jaghelm` (Gitea, future GitHub)  
**Date:** March 24, 2026 (Updated)  
**Status:** Phase 4 In Progress  
**Version:** 5.0  

---

## 1. Design Philosophy

**UI-first. Zero-config by default. Power-user escape hatch via files.**

A new user deploys the container, points it at Prometheus and Uptime Kuma via `.env`, and gets a working infrastructure dashboard with auto-discovered nodes, services, and health status. No YAML editing. No code changes. No rebuilds.

Everything the YAML can do, the Settings UI can do. Everything the Settings UI does is persisted server-side. Both paths are equivalent — the UI is the friendly face, the files are the power-user escape hatch.

**Smooth UX before anything.** JagHelm is purpose-built for ease of use and a polished user experience. Every design decision prioritizes how things feel to the user.

---

## 2. Implementation Status

### ✅ Phase 1: Foundation (Complete — March 21, 2026)
- Config manager with YAML hot-reload
- AES-256-GCM secrets manager
- Node + container discovery from Prometheus
- Kuma monitor auto-matching
- Unified `GET /api/services` endpoint
- DashboardView refactor to consume unified API
- CI/CD pipeline: staging → Gitea → production via Actions runner

### ✅ Phase 2: Settings UI (Complete — March 22, 2026)
- Full-page SettingsView with sidebar navigation (13 sections)
- NodesTab, ServicesTab, LinksTab (full CRUD), SecurityTab, TypographyTab
- IntegrationsTab with preset gallery, custom builder, test/save/delete flow
- 6 VS Code-inspired themes
- Typography system (5 font presets, 8 size controls)
- Server-side display config persistence
- Auth with scrypt password hashing + password change API
- Live preview panel in Settings (scaled DashboardView, refreshable)
- Gear icon toggles between dashboard and settings

### ✅ Phase 3: Integration Engine (Complete — March 22, 2026)
- Integration engine core: registry.js + handler.js
- Generic fetch/auth/transform/cache pipeline
- 6 auth types: none, basic, bearer, header, query, session
- 7 field formats: number, decimal, percent, ms, bytes, duration, string
- 3 compute types: percent_of, subtract, sum
- 42 presets across 10 categories (DNS, proxy, media, arr stack, downloads, infra, files, security, dev, home automation)
- Multi-endpoint support: presets can define `extraEndpoints` (static array or function of primary response)
- URL params support: presets can define `urlParams` for dynamic endpoint segments (e.g. Cloudflare account_id)
- API routes: GET/POST /api/integrations, test, save, delete, presets
- Credential flow: UI form → encrypted secrets.json → $secret:ref in services.yaml
- DashboardView wired to consume GET /api/integrations for Tier 3 data
- IntegrationsTab in Settings UI (preset gallery + custom builder)

### ✅ Phase 4a: HelmGrid + Bug Fixes + Security (March 23, 2026)

#### HelmGrid — Custom Layout Engine (replaces react-grid-layout)
- **Full RGL replacement** — `react-grid-layout` removed from dependencies entirely
- `src/components/HelmGrid.jsx` — purpose-built grid layout engine (~550 lines)
- Grid-based panel positioning with snap-to-grid drag and resize
- Content-aware panel heights — panels auto-grow to fit content, can't shrink below content edge
- Auto-fit on drop — dragging a wide panel to a narrow spot shrinks it to fit
- Column clamping — reducing grid columns via Settings slider auto-shrinks and repositions panels
- Overlap resolution — panels push down when colliding, never overlap
- Responsive breakpoints (lg/md/sm) with layout switching
- SE/SW resize handles with visual affordance (purple tint, hover state)
- Backward-compatible layout format (`{ i, x, y, w, h, minW, minH }`)
- No mid-interaction state saves — layout only persists after drag/resize completes

#### Service Card Drag — Node-Scoped UIDs
- Service cards now identified by `nodeKey:containerName` (e.g. `vm103:tailscale`)
- Fixes ghost drag bug when duplicate container names exist across nodes
- Custom groups store and reference UIDs instead of bare container names
- React keys on service cards use UIDs for correct reconciliation

#### Security Hardening
- **Password hashing upgraded to scrypt** — `crypto.scryptSync` with random 16-byte salt, 64-byte hash
- Automatic migration: existing SHA-256 hashes seamlessly upgrade to scrypt on next successful login
- Hash format: `scrypt:salt:hash` (hex encoded), easily distinguishable from legacy 64-char SHA-256
- Timing-safe comparison via `crypto.timingSafeEqual` prevents timing attacks
- **Auth token injection fix** — `/api/auth/change-password` now receives auth token
- **Upload limit reduced** — 50MB → 5MB (logo and background images don't need more)
- **Frontend fetch timeouts** — all API calls timeout after 12 seconds (server outbound timeout is 8s)

#### Other Fixes
- Gear icon toggles settings on/off (was one-way only)
- Service card overflow fixed (`overflow: hidden`, `minWidth: 0`)
- Panel content fills wrapper correctly via flex layout
- Grid columns slider clamps panels with overlap resolution
- Layout sync uses position-only comparison

### ✅ Phase 4b: Proxmox Integration + Icon Cache + CSS (March 23, 2026)

#### Proxmox Full Integration
- Multi-endpoint preset: VMs + storage pools + backup tasks in parallel
- Dynamic endpoint resolution: extracts node name from VM data to build backup tasks URL
- VM cards with status, vCPU, VMID, and RAM usage bars
- Storage pool cards with name, type, usage bar, percentage
- Backup status card with last backup time, OK/FAILED badge, VM count
- Structured transform for rich data extraction from Proxmox API responses

#### Icon Cache System
- `server/icon-cache.js` — local disk cache for CDN icon URLs
- Icons fetched from CDN once, saved to `data/icon-cache/`, served locally on all subsequent loads
- Eliminates 20-30 cross-origin CDN round-trips on every cold page load
- `cachedIconUrl()` helper in useData.js transparently rewrites CDN URLs to local cache endpoint
- Icon sources: Dashboard Icons (homarr-labs) + selfh.st Icons (curated, full-color SVGs only)

#### CSS Cleanup
- Inline styles in ServiceCard consolidated
- Removed simple-icons and material-icons from icon index (monochrome, poor fit for dark dashboard themes)

### ✅ Phase 4c: Performance Overhaul (March 24, 2026)

Dashboard load time reduced from ~4 seconds to <300ms.

#### Server-Side Background Refresh
- **`startBackgroundRefresh()`** — proactive data refresh loop runs at boot
- Four standalone refresh functions: `refreshServices()`, `refreshUPS()`, `refreshGitea()`, `refreshIntegrations()`
- All fire in parallel via `Promise.allSettled` every N seconds
- API endpoints become pure cache reads — zero external calls on request
- Cold-start fallback: if cache is empty (first request before loop completes), on-demand fetch fires
- **Refresh interval synced to user setting** — reads `refreshInterval` from `display-config.json`
- Changing the interval in Settings UI restarts the server loop automatically
- Cache TTL increased to 120 seconds (safety net, data kept warm by loop)

#### ETag / 304 Not Modified
- `jsonWithEtag()` helper computes MD5 hash of JSON response, sends as `ETag` header
- Frontend sends `If-None-Match` on subsequent requests
- Server returns `304 Not Modified` (empty body) when data unchanged
- Frontend `fetchJson()` returns `null` on 304 — `setState` is skipped entirely
- **Per-instance first-load bypass**: `hasLoadedRef` tracks whether a DashboardView instance has loaded data; first fetch always skips ETags to avoid 304 on empty state
- Express built-in ETag disabled (`app.disable('etag')`) to prevent conflicts with manual ETag system

#### Independent Frontend Fetches
- `Promise.allSettled` barrier in `fetchAll()` replaced with 3 independent fetch calls
- `fetchServices()`, `fetchSections()`, `fetchIntegrations()` each update state immediately on resolve
- Fast data (services, UPS) renders instantly; slow data (integrations) fills in when ready
- On 304 (null return), corresponding `setState` is skipped — zero React work

#### DashboardView Stays Mounted
- DashboardView wrapped in a persistent div — uses `visibility: hidden` + `position: absolute` when not active tab
- Eliminates unmount/remount cycle on tab switching (Dashboard → Settings → Dashboard)
- HelmGrid width measurement stays accurate (container has real width even when hidden)
- Data and layout preserved across tab switches — instant return to dashboard

#### Interactive Endpoints Isolated from ETag System
- `getTodos()` and `getWeather()` use plain `fetch()` instead of ETag-aware `fetchJson()`
- Prevents 304 from Express auto-ETag on user-interactive endpoints
- `TodoCard` null guard added: `Array.isArray(d)` check before `setTodos()`

### 📋 Phase 4d: Polish (In Progress)
- Dashboard UI beautification
- Docker label discovery
- Responsive mobile layout
- Per-node render boundaries (only re-render panels whose data actually changed)
- Open-source preparation (sanitize IPs, generic defaults, setup guide)
- Error boundaries in React (prevent white-screen crashes)
- Split server/index.js into route modules

---

## 3. Monitored Infrastructure

| Node | Label | Exporters | Type |
|------|-------|-----------|------|
| Production VM | `vm103` | node-exporter, cAdvisor | Docker host (Minisforum u870) |
| Staging VM | `vm101` | node-exporter, cAdvisor | Docker host (Minisforum u870) |
| Gateway | `pi` | node-exporter, cAdvisor | Docker host (Raspberry Pi 5) |
| Proxmox Hypervisor | `pve` | node-exporter | Bare-metal hypervisor |
| UGREEN NAS | `nas` | node-exporter | NAS (DH4300 Plus, 3x8TB RAID5) |

---

## 4. File Layout

```
jaghelm/
├── .env                          # Bootstrap: DASH_SECRET, PROMETHEUS_URL, KUMA_URL
├── .gitea/workflows/
│   ├── deploy.yml                # Push to main → SSH deploy to production
│   └── auto-pr.yml               # Push to staging → auto-create PR to main
├── compose.yaml / Dockerfile
├── README.md
├── package.json / vite.config.js / index.html
├── docs/
│   ├── ARCHITECTURE.md           # This file
│   ├── PHASE3-INTEGRATIONS.md    # Integration engine design notes
│   └── PERFORMANCE-OVERHAUL.md   # Performance redesign document
├── public/
│   ├── logo.svg                  # Default logo (Viking helm with ᚺ rune)
│   └── favicon.svg
├── server/
│   ├── index.js                  # Express app, API routes, auth, background refresh, ETag cache
│   ├── config.js                 # Config manager (services.yaml)
│   ├── secrets.js                # AES-256-GCM encryption
│   ├── discovery.js              # Prometheus node + container discovery + smart disk fallback
│   ├── monitors.js               # Uptime Kuma monitor matching
│   ├── icons.js                  # Icon search index (Dashboard Icons + Selfh.st)
│   ├── icon-cache.js             # Local disk cache for CDN icons
│   └── integrations/             # Phase 3: Integration Engine
│       ├── registry.js           # Loads presets, exposes getPreset/listPresets
│       ├── handler.js            # Generic fetch/auth/transform/cache pipeline + multi-endpoint
│       └── presets/              # 42 declarative preset definitions
│           ├── proxmox.js        # Multi-endpoint: VMs + storage + backups
│           └── ...               # One .js file per integration
├── data/                         # Docker volume — persists across rebuilds
│   ├── services.yaml             # Infrastructure config (5 nodes, service overrides)
│   ├── display-config.json       # UI config (theme, layout, fonts, links, refresh interval)
│   ├── secrets.json              # Encrypted API credentials
│   ├── auth.json                 # Password hash (scrypt format)
│   ├── todos.json                # Checklist data
│   └── icon-cache/               # Locally cached CDN icons (populated on first access)
├── src/
│   ├── App.jsx                   # Root: routing, auth, config, persistent DashboardView mount
│   ├── views/
│   │   ├── DashboardView.jsx     # HelmGrid layout, independent fetches, ETag-aware refresh
│   │   ├── SettingsView.jsx      # Full-page settings with sidebar + live preview
│   │   └── IframeView.jsx        # Embedded service tabs (Uptime Kuma, Grafana, etc.)
│   ├── components/
│   │   ├── HelmGrid.jsx          # Custom grid layout engine (replaced react-grid-layout)
│   │   ├── NavBar.jsx / NodeCard.jsx / ServiceCard.jsx
│   │   ├── DraggableServiceCard.jsx / DroppablePanel.jsx / ServiceDragOverlay.jsx
│   │   ├── TodoCard.jsx / Widgets.jsx / LoginPage.jsx
│   │   ├── IconPicker.jsx        # Icon search (Dashboard Icons + Selfh.st CDN)
│   │   └── settings/             # 13 settings tab components
│   ├── hooks/useData.js          # API calls, ETag tracking, skipEtag support, SERVICE_ICONS
│   └── styles/global.css         # All styles, 6 themes, HelmGrid layout
└── uploads/                      # User uploads (bg, logo)
```

---

## 5. HelmGrid — Custom Layout Engine

HelmGrid is JagHelm's purpose-built panel layout engine, replacing `react-grid-layout`. Built from scratch in a single session after 5 sessions of fighting RGL's resize bugs.

### Why we built it
- RGL's height resize had a fundamental bug — panels snapped to huge heights mid-resize
- RGL's `transition: all 200ms` created feedback loops during resize
- RGL's compactor and state management were a black box that fought our save/restore logic
- Every fix for one RGL issue created another

### What HelmGrid does
- Grid-based positioning: converts `{ x, y, w, h }` to pixel positions using configurable `cols`, `rowHeight`, and `margin`
- **Content-aware heights**: panels auto-expand to fit their content via ResizeObserver measurement
- **Snap-to-grid**: drag and resize snap to grid units on release
- **Auto-fit on drop**: dragging a wide panel to a narrow spot auto-shrinks its width
- **Column clamping**: changing the grid columns slider auto-repositions and resizes panels with overlap resolution
- **No mid-interaction saves**: layout only persists to config after mouse release
- **Pointer-event driven**: uses native `pointerdown`/`pointermove`/`pointerup` with refs for fresh state

### Architecture
- Single file: `src/components/HelmGrid.jsx` (~550 lines)
- Grid math functions: `gridToPixel`, `pixelToGrid`, `pixelSizeToGrid`, `pxToRows`, `calcCellWidth`
- `GridItem` sub-component: measures content height via ResizeObserver, renders resize handles
- `resolveOverlaps`: sort-based collision resolver that pushes panels down
- `layoutsEqual`: position-only comparison (ignores constraint fields)
- Zero external dependencies — pure React + DOM APIs

---

## 6. Performance Architecture

### Data Flow — Server-Side Background Refresh

```
Server boot
    ↓
startBackgroundRefresh() fires immediately
    ↓
Every N seconds (matches user's refresh interval setting):
    refreshServices()      → Prometheus (5 nodes × 12 queries) + Kuma (2 calls)
    refreshUPS()           → Prometheus (4 NUT queries)
    refreshGitea()         → Gitea API (repo discovery + commit fetch)
    refreshIntegrations()  → 16 integrations × 1-3 HTTP calls each
    ↓
Results cached in memory (120s TTL safety net)
    ↓
API endpoints are pure cache reads (~1ms response)
```

### Data Flow — Frontend Rendering

```
DashboardView mounts once (stays mounted across tab switches)
    ↓
First fetch: skipEtag=true → always gets full data from warm cache
    ↓
Every 30s refresh cycle (refreshKey bumps from App.jsx):
    fetchServices()      → sends If-None-Match → 304 if unchanged → skip setState
    fetchSections()      → sends If-None-Match → 304 if unchanged → skip setState
    fetchIntegrations()  → sends If-None-Match → 304 if unchanged → skip setState
    ↓
No 304 = data changed → setState fires → React re-renders only what changed
304 = data unchanged → null returned → no setState → zero React work
```

### Tab Switching — Persistent Mount

```
Dashboard active:   <div style={undefined}> → normal rendering
Settings active:    <div style={position:absolute, visibility:hidden}> → hidden but mounted
Iframe tab active:  <div style={position:absolute, visibility:hidden}> → hidden but mounted
    ↓
Switching back to Dashboard: style removed → instant appearance, data intact
```

---

## 7. Themes

| Theme | ID | Background | Accent |
|-------|-----|-----------|--------|
| One Dark Pro | `dark` | `#0f1123` | `#6366f1` |
| Dracula | `dracula` | `#282a36` | `#bd93f9` |
| Night Owl | `night-owl` | `#011627` | `#82aaff` |
| GitHub Dark | `github-dark` | `#0d1117` | `#58a6ff` |
| Catppuccin Mocha | `catppuccin` | `#1e1e2e` | `#89b4fa` |
| Material Ocean | `material` | `#0f111a` | `#84ffff` |

---

## 8. API Endpoints

### Auth
- `POST /api/auth/login` · `GET /api/auth/check` · `POST /api/auth/change-password`

### Phase 1 — Unified Services (background-refreshed, ETag-enabled)
- `GET /api/services` — Complete merged node + service + monitor data
- `GET /api/services/config` — Raw services.yaml as JSON
- `POST /api/services/config` — Save services.yaml
- `GET /api/services/monitors` — Kuma monitor name list

### Phase 2 — Display Config
- `GET /api/display-config` — UI config (theme, layout, fonts, links, refresh interval)
- `POST /api/display-config` — Save UI config (restarts background refresh if interval changed)

### Icons
- `GET /api/icons?q=search&limit=60` — Search icon index
- `GET /api/icons/cached?url=...` — Local cache proxy for CDN icon URLs

### Secrets
- `GET /api/secrets/keys` · `PUT /api/secrets/:key` · `DELETE /api/secrets/:key`

### Phase 3 — Integration Engine (background-refreshed, ETag-enabled)
- `GET /api/integrations/presets` — List all available presets
- `GET /api/integrations` — Fetch all configured integrations' data
- `GET /api/integrations/:type` — Fetch one integration's data
- `POST /api/integrations/test` — Test connection
- `POST /api/integrations/save` — Encrypt creds → secrets.json, config → services.yaml
- `DELETE /api/integrations/:type` — Remove integration config

### Dedicated Sections (background-refreshed, ETag-enabled)
- `GET /api/ups` — UPS power data from NUT via Prometheus
- `GET /api/gitea/activity` — Recent commits across all repos

### Legacy (backward compat, cache-only reads)
- `/api/uptime/monitors` · `/api/prometheus/query` · `/api/adguard/stats`
- `/api/npm/stats` · `/api/docker/containers`

### Utility (not background-refreshed)
- `/api/weather` · `/api/todos` · `/api/upload` · `/api/health`

---

## 9. Config Persistence

**Two stores, two data flows:**

| Store | File | Managed By | Frontend Save |
|-------|------|-----------|---------------|
| Infrastructure | `data/services.yaml` | Config Manager + hot-reload | Debounced POST to `/api/services/config` |
| Display | `data/display-config.json` | Display Config API | localStorage (instant) + debounced POST (2s) |

**Boot sequence:** localStorage → render immediately → fetch `/api/display-config` → merge server config but **preserve local gridLayout** → mark `configLoadedFromServer = true` → future changes save to server.

**Layout persistence:** localStorage is authoritative for `gridLayout`. Server is authoritative for everything else (theme, sections, links). HelmGrid only saves layout after drag/resize completes. Async node placeholders ensure saved positions are maintained before API data loads.

**Refresh interval persistence:** Stored in `display-config.json` as `refreshInterval` (seconds). Read by both the frontend (poll interval) and server (background refresh loop interval). Changing via Settings UI triggers server loop restart.

**Priority:** `.env` > `auth.json` > `secrets.json` > `display-config.json` > `services.yaml`

---

## 10. Security Model

### Password Hashing
- **scrypt** via Node.js `crypto.scryptSync` — 16-byte random salt, 64-byte derived key
- Hash format: `scrypt:<salt_hex>:<hash_hex>`
- Timing-safe comparison via `crypto.timingSafeEqual`
- Automatic migration from legacy SHA-256 hashes on next successful login

### Session Management
- 32-byte random tokens via `crypto.randomBytes`
- 24-hour expiry, stored in-memory `Map`
- Password change invalidates all sessions except current

### Secrets Encryption
- AES-256-GCM with PBKDF2-derived key (100,000 iterations) from `DASH_SECRET`
- Random 12-byte IV per encryption
- Stored in `data/secrets.json`, never in YAML or env files

### Known Tradeoffs
- `NODE_TLS_REJECT_UNAUTHORIZED=0` in compose.yaml — disables TLS cert validation for all outbound requests. Required for self-signed certs on internal services (Proxmox). Scoped bypass planned.
- No login rate limiting yet — planned
- CORS allows all origins — acceptable for homelab behind Tailscale/Cloudflare

---

## 11. CI/CD Pipeline

```
Developer pushes to staging
        ↓
auto-pr.yml: Creates PR from staging → main (if none open)
        ↓
Developer reviews & merges PR in Gitea
        ↓
deploy.yml: SSH into production → git pull → docker compose build → up -d
        ↓
Verify: docker ps + curl health endpoint
```

---

## 12. Carry-Over Notes

### Phase 4d priorities:
- Dashboard UI beautification and polish
- Per-node render boundaries (only re-render panels whose data actually changed)
- Responsive mobile layout
- Open-source preparation (sanitize IPs, generic defaults, setup guide)
- Error boundaries in React (prevent white-screen crashes)
- Split server/index.js into route modules

### Known issues:
- NAS shows 7.3TB — correct for logical volume, RAID5 pool has ~14.5TB raw; half unallocated in UGREEN firmware
- `SERVICE_ICONS` constant has 35+ hardcoded CDN URLs in useData.js — should move to config
- Legacy `/api/docker/containers` endpoint duplicates discovery.js logic — candidate for removal
- Settings live preview DashboardView creates a second instance with its own state and fetch cycle

---

*JagHelm v8 Architecture Specification v5.0 — Phase 4c Complete*
