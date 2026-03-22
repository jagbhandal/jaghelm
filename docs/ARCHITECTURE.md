# JagHelm v8.0 — Architecture Specification

**Project:** JagHelm — Real-time infrastructure dashboard for homelabs  
**Repo:** `jaghelm` (Gitea, future GitHub)  
**Date:** March 22, 2026 (Updated)  
**Status:** Phase 3 Complete, Phase 4 In Progress  
**Version:** 3.0  

---

## 1. Design Philosophy

**UI-first. Zero-config by default. Power-user escape hatch via files.**

A new user deploys the container, points it at Prometheus and Uptime Kuma via `.env`, and gets a working infrastructure dashboard with auto-discovered nodes, services, and health status. No YAML editing. No code changes. No rebuilds.

Everything the YAML can do, the Settings UI can do. Everything the Settings UI does is persisted server-side. Both paths are equivalent — the UI is the friendly face, the files are the power-user escape hatch.

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
- Auth upgrade (SHA-256 hashing, password change API)
- Live preview panel in Settings (scaled DashboardView, refreshable)
- Professional README

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

### ✅ Bug Fixes & Infrastructure (March 22, 2026)

#### Layout Persistence (4-phase fix)
1. **Compactor removal** — Removed `verticalCompactor` from RGL; panels stay exactly where users place them
2. **localStorage-first merge** — Server config merge preserves local `gridLayout`; server is authoritative for everything else (theme, sections, links) but layout is local-first
3. **User interaction gate** — `userInteractedRef` flag ensures only real drag/resize actions trigger layout saves; compactor and mount fires are ignored
4. **Async placeholders** — Render placeholder `<div>` elements for node keys in saved layout before `serviceData` loads; prevents RGL from losing saved positions when children appear after API response

#### Responsive Service Columns
- `ServiceGrid` component with `ResizeObserver` measures actual container width
- `serviceColumns` setting is now a MAX, not absolute — columns dynamically adjust 4→3→2→1 as panel shrinks
- Extracted from NodeCard into dedicated component for clean separation

#### Other Fixes
- Grid resize from all sides (SE, SW, E, W)
- Auto-scroll during drag near viewport edges
- Font contrast improvements
- Docker stats refresh fix (timestamp cache bust)
- Quick Launch proper service icons (35+ mappings via CDN)
- Service card badges pinned top-right
- Default logo in header and login page (120px)
- Pi service monitor mappings

#### Infrastructure Additions
- **Proxmox host monitoring** — `node_exporter` installed on PVE host (192.168.68.10), added to Prometheus as `node="pve"`, configured in services.yaml
- **UGREEN NAS monitoring** — `node_exporter` installed on DH4300 Plus (192.168.68.55), added to Prometheus as `node="nas"`, configured in services.yaml
- **Smart disk fallback** — `discovery.js` tries `mountpoint="/"` first; if no data (e.g. NAS), queries all non-tmpfs filesystems and picks the largest by total size
- **Auto-PR workflow** — `.gitea/workflows/auto-pr.yml` creates PR from staging→main on push (checks for existing open PR to avoid duplicates)

### 📋 Phase 4: Polish (In Progress)
- Dashboard UI beautification
- Docker label discovery
- Icon vendoring
- Responsive mobile layout
- Proxmox API integration (VM list, storage pools, cluster health)
- Open-source preparation

---

## 3. Monitored Infrastructure

| Node | Label | IP | Exporters | Type |
|------|-------|----|-----------|------|
| Production VM | `vm103` | 192.168.68.11 | node-exporter, cAdvisor | Docker host (Minisforum u870) |
| Staging VM | `vm101` | 192.168.68.12 | node-exporter, cAdvisor | Docker host (Minisforum u870) |
| Gateway | `pi` | 192.168.68.13 | node-exporter, cAdvisor | Docker host (Raspberry Pi 5) |
| Proxmox Hypervisor | `pve` | 192.168.68.10 | node-exporter | Bare-metal hypervisor |
| UGREEN NAS | `nas` | 192.168.68.55 | node-exporter | NAS (DH4300 Plus, 3x8TB RAID5) |

---

## 4. File Layout

```
jaghelm/
├── .env                          # Bootstrap: DASH_SECRET, PROMETHEUS_URL, KUMA_URL
├── .gitea/workflows/
│   ├── deploy.yml                # Push to main → SSH deploy to production
│   └── auto-pr.yml               # Push to staging → auto-create PR to main
├── compose.yaml / Dockerfile
├── README.md                     # Professional README
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
│           ├── adguard.js / npm.js / pihole.js / proxmox.js
│           ├── plex.js / jellyfin.js / sonarr.js / radarr.js / ...
│           └── (one .js file per integration, ~15 lines each)
├── data/                         # Docker volume — persists across rebuilds
│   ├── services.yaml             # Infrastructure config (5 nodes, service overrides)
│   ├── display-config.json       # UI config (theme, layout, fonts, links)
│   ├── secrets.json              # Encrypted API credentials
│   ├── auth.json                 # Password hash override
│   └── todos.json                # Checklist data
├── src/
│   ├── App.jsx                   # Root: routing, localStorage-first config, font/theme
│   ├── views/
│   │   ├── DashboardView.jsx     # RGL grid, interaction-gated layout save, async placeholders
│   │   ├── SettingsView.jsx      # Full-page settings with sidebar + live preview
│   │   └── IframeView.jsx        # Embedded tabs
│   ├── components/
│   │   ├── NavBar.jsx / NodeCard.jsx / ServiceCard.jsx
│   │   ├── TodoCard.jsx / Widgets.jsx / LoginPage.jsx
│   │   ├── IconPicker.jsx        # Icon search (Dashboard Icons + Selfh.st CDN)
│   │   └── settings/             # 13 settings tab components
│   │       ├── GeneralTab.jsx / AppearanceTab.jsx / TypographyTab.jsx
│   │       ├── LayoutTab.jsx / SectionsTab.jsx
│   │       ├── NodesTab.jsx / ServicesTab.jsx / IntegrationsTab.jsx
│   │       ├── LinksTab.jsx / WidgetsTab.jsx / TabsTab.jsx
│   │       ├── SecurityTab.jsx / BackupTab.jsx
│   ├── hooks/useData.js          # API calls, 35+ SERVICE_ICONS, constants
│   └── styles/global.css         # All styles, 6 themes, settings layout
└── uploads/                      # User uploads (bg, logo)
```

---

## 5. Themes

| Theme | ID | Background | Accent |
|-------|-----|-----------|--------|
| One Dark Pro | `dark` | `#0f1123` | `#6366f1` |
| Dracula | `dracula` | `#282a36` | `#bd93f9` |
| Night Owl | `night-owl` | `#011627` | `#82aaff` |
| GitHub Dark | `github-dark` | `#0d1117` | `#58a6ff` |
| Catppuccin Mocha | `catppuccin` | `#1e1e2e` | `#89b4fa` |
| Material Ocean | `material` | `#0f111a` | `#84ffff` |

---

## 6. API Endpoints

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
- `GET /api/integrations/presets` — List all available presets (for Settings UI gallery)
- `GET /api/integrations` — Fetch all configured integrations' data (dashboard refresh)
- `GET /api/integrations/:type` — Fetch one integration's data
- `POST /api/integrations/test` — Test connection (URL + creds from form, not saved)
- `POST /api/integrations/save` — Encrypt creds → secrets.json, config → services.yaml
- `DELETE /api/integrations/:type` — Remove integration config

### Legacy (backward compat)
- `/api/uptime/monitors` · `/api/prometheus/query` · `/api/adguard/stats`
- `/api/npm/stats` · `/api/ups` · `/api/gitea/activity` · `/api/docker/containers`
- `/api/weather` · `/api/todos` · `/api/upload` · `/api/health`

---

## 7. Config Persistence

**Two stores, two data flows:**

| Store | File | Managed By | Frontend Save |
|-------|------|-----------|---------------|
| Infrastructure | `data/services.yaml` | Config Manager + hot-reload | Debounced POST to `/api/services/config` |
| Display | `data/display-config.json` | Display Config API | localStorage (instant) + debounced POST (2s) |

**Boot sequence:** localStorage → render immediately → fetch `/api/display-config` → merge server config but **preserve local gridLayout** → mark `configLoadedFromServer = true` → future changes save to server.

**Layout persistence:** localStorage is authoritative for `gridLayout`. Server is authoritative for everything else (theme, sections, links). Layout saves only trigger on user drag/resize (`userInteractedRef` gate). Async node placeholders ensure RGL maintains saved positions before API data loads.

**Priority:** `.env` > `auth.json` > `secrets.json` > `display-config.json` > `services.yaml`

---

## 8. CI/CD Pipeline

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

## 9. Carry-Over Notes for Next Session

### What to bring:
1. This spec (`docs/ARCHITECTURE.md`)
2. Fresh repo tar from Gitea
3. Dashboard screenshots showing all 5 nodes

### Phase 4 priorities:
- Dashboard UI beautification and polish
- Proxmox API integration preset (VM list, storage pools, cluster health)
- Responsive mobile layout
- Open-source preparation (sanitize IPs, generic defaults)

### Known issues:
- NAS shows 7.3TB — correct for the logical volume, but RAID5 pool has ~14.5TB raw; half is unallocated in UGREEN firmware
- Proxmox preset (`presets/proxmox.js`) is a skeleton — only fetches node count; needs multi-endpoint support for full VM/storage data

### Key IPs:
- Proxmox: 192.168.68.10 · VM 103 (prod): 192.168.68.11 · VM 101 (staging): 192.168.68.12
- Pi: 192.168.68.13 · NAS: 192.168.68.55

---

*JagHelm v8 Architecture Specification v3.0 — Phase 3 Complete*
