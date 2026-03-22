# JagHelm v8.0 — Architecture Specification

**Project:** JagHelm — Real-time infrastructure dashboard for homelabs  
**Repo:** `jaghelm` (Gitea, future GitHub)  
**Date:** March 22, 2026 (Updated)  
**Status:** Phase 2 Complete, Phase 3 In Planning  
**Version:** 2.0  

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
- 6 VS Code-inspired themes
- Typography system (5 font presets, 8 size controls)
- Server-side display config persistence
- Auth upgrade (SHA-256 hashing, password change API)
- Professional README

### ✅ Bug Fixes (March 22, 2026)
- Layout persistence (server-side save, mount guard, no more reload)
- Grid resize from all sides (SE, SW, E, W)
- Auto-scroll during drag near viewport edges
- Font contrast improvements
- Docker stats refresh fix (timestamp cache bust)
- Quick Launch proper service icons (35+ mappings)
- Service card badges pinned top-right
- Default logo in header and login page (120px)
- Pi service monitor mappings

### 🔧 Phase 3: Integration Engine (In Progress — March 22, 2026)
- Integration engine core: registry.js + handler.js
- Generic fetch/auth/transform/cache pipeline
- 6 auth types: none, basic, bearer, header, query, session
- 7 field formats: number, decimal, percent, ms, bytes, duration, string
- 3 compute types: percent_of, subtract, sum
- 42 presets across 10 categories (DNS, proxy, media, arr stack, downloads, infra, files, security, dev, home automation)
- API routes: GET/POST /api/integrations, test, save, delete, presets
- Credential flow: UI form → encrypted secrets.json → $secret:ref in services.yaml
- DashboardView wired to consume GET /api/integrations for Tier 3 data
- TODO: IntegrationsTab in Settings UI (preset gallery + custom builder)
- TODO: Test on staging against live services

### 📋 Phase 4: Polish
- Docker label discovery
- Icon vendoring
- Responsive mobile layout
- Open-source preparation

---

## 3. File Layout

```
jaghelm/
├── .env                          # Bootstrap: DASH_SECRET, PROMETHEUS_URL, KUMA_URL
├── compose.yaml / Dockerfile
├── README.md                     # Professional README
├── package.json / vite.config.js / index.html
├── public/
│   ├── logo.svg                  # Default logo (Viking helm with ᚺ rune)
│   └── favicon.svg
├── server/
│   ├── index.js                  # Express app, all API routes, auth, cache
│   ├── config.js                 # Config manager (services.yaml)
│   ├── secrets.js                # AES-256-GCM encryption
│   ├── discovery.js              # Prometheus node + container discovery
│   ├── monitors.js               # Uptime Kuma monitor matching
│   └── integrations/             # Phase 3: Integration Engine
│       ├── registry.js           # Loads presets, exposes getPreset/listPresets
│       ├── handler.js            # Generic fetch/auth/transform/cache pipeline
│       └── presets/              # 42 declarative preset definitions
│           ├── adguard.js / npm.js / pihole.js
│           ├── plex.js / jellyfin.js / sonarr.js / radarr.js / ...
│           └── (one .js file per integration, ~15 lines each)
├── data/                         # Docker volume — persists across rebuilds
│   ├── services.yaml             # Infrastructure config
│   ├── display-config.json       # UI config (theme, layout, fonts, links)
│   ├── secrets.json              # Encrypted API credentials
│   ├── auth.json                 # Password hash override
│   └── todos.json                # Checklist data
├── src/
│   ├── App.jsx                   # Root: routing, config persistence, font/theme application
│   ├── views/
│   │   ├── DashboardView.jsx     # RGL grid, auto-scroll drag, layout persistence
│   │   ├── SettingsView.jsx      # Full-page settings with sidebar
│   │   └── IframeView.jsx        # Embedded tabs
│   ├── components/
│   │   ├── NavBar.jsx / NodeCard.jsx / ServiceCard.jsx
│   │   ├── TodoCard.jsx / Widgets.jsx / LoginPage.jsx
│   │   └── settings/             # 12 settings tab components
│   │       ├── GeneralTab.jsx / AppearanceTab.jsx / TypographyTab.jsx
│   │       ├── LayoutTab.jsx / SectionsTab.jsx
│   │       ├── NodesTab.jsx / ServicesTab.jsx
│   │       ├── LinksTab.jsx / WidgetsTab.jsx / TabsTab.jsx
│   │       ├── SecurityTab.jsx / BackupTab.jsx
│   ├── hooks/useData.js          # API calls, 35+ SERVICE_ICONS, constants
│   └── styles/global.css         # All styles, 6 themes, settings layout
└── uploads/                      # User uploads (bg, logo)
```

---

## 4. Themes

| Theme | ID | Background | Accent |
|-------|-----|-----------|--------|
| One Dark Pro | `dark` | `#0f1123` | `#6366f1` |
| Dracula | `dracula` | `#282a36` | `#bd93f9` |
| Night Owl | `night-owl` | `#011627` | `#82aaff` |
| GitHub Dark | `github-dark` | `#0d1117` | `#58a6ff` |
| Catppuccin Mocha | `catppuccin` | `#1e1e2e` | `#89b4fa` |
| Material Ocean | `material` | `#0f111a` | `#84ffff` |

---

## 5. API Endpoints

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

## 6. Config Persistence

**Two stores, two data flows:**

| Store | File | Managed By | Frontend Save |
|-------|------|-----------|---------------|
| Infrastructure | `data/services.yaml` | Config Manager + hot-reload | Debounced POST to `/api/services/config` |
| Display | `data/display-config.json` | Display Config API | localStorage (instant) + debounced POST (2s) |

**Boot sequence:** localStorage → render immediately → fetch `/api/display-config` → override if server has data → mark `configLoadedFromServer = true` → future changes save to server.

**Priority:** `.env` > `auth.json` > `secrets.json` > `display-config.json` > `services.yaml`

---

## 7. Carry-Over Notes for Next Session

### What to bring:
1. This spec (`docs/ARCHITECTURE.md`)
2. `README.md`
3. Fresh dashboard screenshot with new themes
4. Any bugs found during testing

### Phase 3 planning:
- Study Homepage `widgets/` and Homarr `integrations/` on GitHub
- Adopt their declarative preset patterns — don't reinvent the wheel
- Design the integration engine server-side first, then UI tab

### Key IPs:
- Proxmox: 192.168.68.10 · VM 103 (prod): 192.168.68.11 · VM 101 (staging): 192.168.68.12
- Pi: 192.168.68.13 · NAS: 192.168.68.55

---

*JagHelm v8 Architecture Specification v2.0 — Phase 2 Complete*
