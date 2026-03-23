# JagHelm v8.0 — Architecture Specification

**Project:** JagHelm — Real-time infrastructure dashboard for homelabs  
**Repo:** `jaghelm` (Gitea, future GitHub)  
**Date:** March 23, 2026 (Updated)  
**Status:** Phase 4 In Progress  
**Version:** 4.0  

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
- API routes: GET/POST /api/integrations, test, save, delete, presets
- Credential flow: UI form → encrypted secrets.json → $secret:ref in services.yaml
- DashboardView wired to consume GET /api/integrations for Tier 3 data
- IntegrationsTab in Settings UI (preset gallery + custom builder)

### ✅ Phase 4a: HelmGrid + Bug Fixes + Security (March 23, 2026)

#### HelmGrid — Custom Layout Engine (replaces react-grid-layout)
- **Full RGL replacement** — `react-grid-layout` removed from dependencies entirely
- `src/components/HelmGrid.jsx` — purpose-built grid layout engine (~500 lines)
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
- **Auth token injection fix** — `/api/auth/change-password` now receives auth token (was being skipped by the global fetch interceptor)
- **Upload limit reduced** — 50MB → 5MB (logo and background images don't need more)
- **Frontend fetch timeouts** — all API calls timeout after 12 seconds (server outbound timeout is 8s)

#### Performance
- **Removed unused dependencies** — `react-grid-layout` and `@dnd-kit/sortable` removed from package.json
- **UPS queries parallelized** — 4 Prometheus queries now run via `Promise.all` instead of sequential loop (4x faster)
- **Refresh interval debounced** — changing the Settings slider no longer creates/destroys dozens of intervals; 500ms debounce waits for slider to settle

#### Other Fixes
- Gear icon toggles settings on/off (was one-way only)
- Service card overflow fixed (`overflow: hidden`, `minWidth: 0`)
- Panel content fills wrapper correctly via flex layout (fixes resize handle positioning)
- Grid columns slider clamps panels with overlap resolution
- Layout sync uses position-only comparison (ignores minW/minH additions from effectiveLayouts)

### 📋 Phase 4b: Polish (In Progress)
- Dashboard UI beautification
- Docker label discovery
- Icon vendoring
- Responsive mobile layout
- Proxmox API integration (VM list, storage pools, cluster health)
- Open-source preparation (sanitize IPs, generic defaults, setup guide)

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
│   └── PHASE3-INTEGRATIONS.md    # Integration engine design notes
├── public/
│   ├── logo.svg                  # Default logo (Viking helm with ᚺ rune)
│   └── favicon.svg
├── server/
│   ├── index.js                  # Express app, all API routes, auth, cache
│   ├── config.js                 # Config manager (services.yaml)
│   ├── secrets.js                # AES-256-GCM encryption
│   ├── discovery.js              # Prometheus node + container discovery + smart disk fallback
│   ├── monitors.js               # Uptime Kuma monitor matching
│   ├── icons.js                  # Icon search index (Dashboard Icons + Selfh.st)
│   └── integrations/             # Phase 3: Integration Engine
│       ├── registry.js           # Loads presets, exposes getPreset/listPresets
│       ├── handler.js            # Generic fetch/auth/transform/cache pipeline
│       └── presets/              # 42 declarative preset definitions
├── data/                         # Docker volume — persists across rebuilds
│   ├── services.yaml             # Infrastructure config (5 nodes, service overrides)
│   ├── display-config.json       # UI config (theme, layout, fonts, links)
│   ├── secrets.json              # Encrypted API credentials
│   ├── auth.json                 # Password hash (scrypt format)
│   └── todos.json                # Checklist data
├── src/
│   ├── App.jsx                   # Root: routing, localStorage-first config, font/theme
│   ├── views/
│   │   ├── DashboardView.jsx     # HelmGrid layout, service data, drag-and-drop
│   │   ├── SettingsView.jsx      # Full-page settings with sidebar + live preview
│   │   └── IframeView.jsx        # Embedded service tabs (Uptime Kuma, Grafana, etc.)
│   ├── components/
│   │   ├── HelmGrid.jsx          # Custom grid layout engine (replaced react-grid-layout)
│   │   ├── NavBar.jsx / NodeCard.jsx / ServiceCard.jsx
│   │   ├── DraggableServiceCard.jsx / DroppablePanel.jsx / ServiceDragOverlay.jsx
│   │   ├── TodoCard.jsx / Widgets.jsx / LoginPage.jsx
│   │   ├── IconPicker.jsx        # Icon search (Dashboard Icons + Selfh.st CDN)
│   │   └── settings/             # 13 settings tab components
│   ├── hooks/useData.js          # API calls (with 12s timeout), SERVICE_ICONS, constants
│   └── styles/global.css         # All styles, 6 themes, HelmGrid layout
└── uploads/                      # User uploads (bg, logo)
```

---

## 5. HelmGrid — Custom Layout Engine

HelmGrid is JagHelm's purpose-built panel layout engine, replacing `react-grid-layout`. Built from scratch in a single session after 5 sessions of fighting RGL's resize bugs.

### Why we built it
- RGL's height resize had a fundamental bug — panels snapped to huge heights mid-resize due to internal layout recalculation during interaction
- RGL's `transition: all 200ms` on grid items created feedback loops during resize
- RGL's compactor, layout change callbacks, and state management were a black box that fought our save/restore logic
- Every fix for one RGL issue created another

### What HelmGrid does
- Grid-based positioning: converts `{ x, y, w, h }` to pixel positions using configurable `cols`, `rowHeight`, and `margin`
- **Content-aware heights**: panels auto-expand to fit their content via ResizeObserver measurement. User can make panels taller but never shorter than content.
- **Snap-to-grid**: drag and resize snap to grid units on release
- **Auto-fit on drop**: dragging a wide panel to a narrow spot auto-shrinks its width
- **Column clamping**: changing the grid columns slider auto-repositions and resizes panels with overlap resolution
- **No mid-interaction saves**: layout only persists to config after mouse release. Zero feedback loops.
- **Pointer-event driven**: uses native `pointerdown`/`pointermove`/`pointerup` with refs for fresh state

### Architecture
- Single file: `src/components/HelmGrid.jsx` (~500 lines)
- Grid math functions: `gridToPixel`, `pixelToGrid`, `pixelSizeToGrid`, `pxToRows`, `calcCellWidth`
- `GridItem` sub-component: measures content height via ResizeObserver, renders resize handles
- `resolveOverlaps`: sort-based collision resolver that pushes panels down
- `layoutsEqual`: position-only comparison (ignores constraint fields)
- Zero external dependencies — pure React + DOM APIs

---

## 6. Themes

| Theme | ID | Background | Accent |
|-------|-----|-----------|--------|
| One Dark Pro | `dark` | `#0f1123` | `#6366f1` |
| Dracula | `dracula` | `#282a36` | `#bd93f9` |
| Night Owl | `night-owl` | `#011627` | `#82aaff` |
| GitHub Dark | `github-dark` | `#0d1117` | `#58a6ff` |
| Catppuccin Mocha | `catppuccin` | `#1e1e2e` | `#89b4fa` |
| Material Ocean | `material` | `#0f111a` | `#84ffff` |

---

## 7. API Endpoints

### Auth
- `POST /api/auth/login` · `GET /api/auth/check` · `POST /api/auth/change-password`

### Phase 1 — Unified Services
- `GET /api/services` — Complete merged node + service + monitor data
- `GET /api/services/config` — Raw services.yaml as JSON
- `POST /api/services/config` — Save services.yaml
- `GET /api/services/monitors` — Kuma monitor name list

### Phase 2 — Display Config
- `GET /api/display-config` — UI config (theme, layout, fonts, links)
- `POST /api/display-config` — Save UI config

### Icons
- `GET /api/icons?q=search&limit=60` — Search icon index

### Secrets
- `GET /api/secrets/keys` · `PUT /api/secrets/:key` · `DELETE /api/secrets/:key`

### Phase 3 — Integration Engine
- `GET /api/integrations/presets` — List all available presets
- `GET /api/integrations` — Fetch all configured integrations' data
- `GET /api/integrations/:type` — Fetch one integration's data
- `POST /api/integrations/test` — Test connection
- `POST /api/integrations/save` — Encrypt creds → secrets.json, config → services.yaml
- `DELETE /api/integrations/:type` — Remove integration config

### Legacy (backward compat)
- `/api/uptime/monitors` · `/api/prometheus/query` · `/api/adguard/stats`
- `/api/npm/stats` · `/api/ups` · `/api/gitea/activity` · `/api/docker/containers`
- `/api/weather` · `/api/todos` · `/api/upload` · `/api/health`

---

## 8. Config Persistence

**Two stores, two data flows:**

| Store | File | Managed By | Frontend Save |
|-------|------|-----------|---------------|
| Infrastructure | `data/services.yaml` | Config Manager + hot-reload | Debounced POST to `/api/services/config` |
| Display | `data/display-config.json` | Display Config API | localStorage (instant) + debounced POST (2s) |

**Boot sequence:** localStorage → render immediately → fetch `/api/display-config` → merge server config but **preserve local gridLayout** → mark `configLoadedFromServer = true` → future changes save to server.

**Layout persistence:** localStorage is authoritative for `gridLayout`. Server is authoritative for everything else (theme, sections, links). HelmGrid only saves layout after drag/resize completes (no mid-interaction saves). Async node placeholders ensure saved positions are maintained before API data loads.

**Priority:** `.env` > `auth.json` > `secrets.json` > `display-config.json` > `services.yaml`

---

## 9. Security Model

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

## 10. CI/CD Pipeline

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

## 11. Carry-Over Notes

### Phase 4b priorities:
- Dashboard UI beautification and polish
- Proxmox API integration preset (VM list, storage pools, cluster health)
- Responsive mobile layout
- Open-source preparation (sanitize IPs, generic defaults, setup guide)
- Error boundaries in React (prevent white-screen crashes)
- Split server/index.js into route modules
- Remove dead code (unused legacy fetch functions in useData.js)
- Remove hardcoded IPs from server fallback defaults

### Known issues:
- NAS shows 7.3TB — correct for logical volume, RAID5 pool has ~14.5TB raw; half unallocated in UGREEN firmware
- Proxmox preset is a skeleton — only fetches node count; needs multi-endpoint support
- `SERVICE_ICONS` constant has 35+ hardcoded CDN URLs in useData.js — should move to config
- Legacy `/api/docker/containers` endpoint duplicates discovery.js logic — candidate for removal

---

*JagHelm v8 Architecture Specification v4.0 — Phase 4a Complete*
