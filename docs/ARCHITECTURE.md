# JagHelm v8.0 — Architecture Specification

**Project:** JagHelm — Real-time infrastructure dashboard for homelabs  
**Repo:** `jaghelm` (Gitea, future GitHub)  
**Date:** March 21, 2026  
**Status:** Approved — ready for Phase 1 implementation  
**Version:** 1.0  

---

## 1. Design Philosophy

**UI-first. Zero-config by default. Power-user escape hatch via files.**

A new user deploys the container, points it at Prometheus and Uptime Kuma via `.env`, and gets a working infrastructure dashboard with auto-discovered nodes, services, and health status. No YAML editing. No code changes. No rebuilds.

Everything the YAML can do, the Settings UI can do. Everything the Settings UI does is persisted to YAML. Both paths are equivalent — the UI is the friendly face, the files are the power-user escape hatch.

Secrets are encrypted at rest. The UI manages them with masked fields. No credentials in YAML, no credentials in plain text anywhere except the initial `.env` bootstrap.

---

## 2. What Makes This Different

Homepage and Homarr are link launchers with widget sidecars. JagHelm is a **real-time multi-node infrastructure monitoring dashboard** that also happens to have service cards, bookmarks, and app integrations.

**Core differentiators (keep and strengthen):**
- Multi-node Prometheus monitoring (CPU, RAM, disk, temp, uptime per node)
- Per-container resource stats (CPU/MEM/RX/TX) from cAdvisor
- UPS power monitoring via NUT/Prometheus
- Uptime Kuma deep integration with per-service health, ping, uptime bars
- Three-tier service cards: health status → container stats → app API stats
- Drag-and-drop grid layout with per-section theming

**Borrowed from Homepage:**
- `customapi` pattern as universal integration mechanism
- Hot-reload on config file change
- Docker label discovery as an option

**Borrowed from Homarr:**
- UI-first configuration — no YAML required for normal use
- Test-before-save for integration connections
- Encrypted secrets management

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                    Settings UI                       │
│   Nodes │ Services │ Integrations │ Appearance │ ... │
└────────────────────────┬────────────────────────────┘
                         │ reads/writes via API
┌────────────────────────▼────────────────────────────┐
│                   Express Server                     │
│                                                      │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────┐  │
│  │ Config   │  │ Discovery │  │ Integration      │  │
│  │ Manager  │  │ Engine    │  │ Engine           │  │
│  │          │  │           │  │                  │  │
│  │services. │  │Prometheus │  │Loads presets +   │  │
│  │yaml      │  │cAdvisor   │  │custom configs    │  │
│  │(r/w)     │  │Docker     │  │Calls APIs with   │  │
│  │          │  │Kuma       │  │encrypted creds   │  │
│  └──────────┘  └───────────┘  └──────────────────┘  │
│                                                      │
│  ┌──────────────────────────────────────────────┐    │
│  │              Secrets Manager                  │    │
│  │  Encrypts/decrypts with DASH_SECRET          │    │
│  │  Stores in data/secrets.json                  │    │
│  │  Falls back to .env variables                 │    │
│  └──────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────┘
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
    ┌──────────┐  ┌───────────┐  ┌──────────┐
    │Prometheus│  │Uptime Kuma│  │App APIs  │
    │  +nodes  │  │ monitors  │  │PhotoPrism│
    │  +cAdv.  │  │           │  │Nextcloud │
    │  +NUT    │  │           │  │etc.      │
    └──────────┘  └───────────┘  └──────────┘
```

---

## 4. File Layout

```
jaghelm/
├── .env                          # Bootstrap only: DASH_SECRET, PROMETHEUS_URL, KUMA_URL, PORT
├── compose.yaml
├── Dockerfile
├── package.json
├── server/
│   ├── index.js                  # Express app, API routes
│   ├── config.js                 # Config manager (load/save/watch services.yaml)
│   ├── secrets.js                # Encrypt/decrypt secrets with DASH_SECRET
│   ├── discovery.js              # Node + container auto-discovery from Prometheus
│   ├── integrations.js           # Integration engine (load presets, execute API calls)
│   └── monitors.js               # Uptime Kuma monitor fetching + matching
├── data/                         # Persisted via Docker volume
│   ├── services.yaml             # All config: nodes, services, integrations, display
│   ├── secrets.json              # Encrypted credentials (managed by secrets.js)
│   └── todos.json                # Existing todo data
├── integrations/                 # Declarative integration presets
│   ├── photoprism.yaml
│   ├── nextcloud.yaml
│   ├── vaultwarden.yaml
│   ├── gitea.yaml
│   ├── adguard.yaml
│   ├── npm.yaml
│   ├── pihole.yaml
│   ├── plex.yaml
│   ├── jellyfin.yaml
│   └── _template.yaml            # Template for users to create their own
├── src/                          # React frontend (unchanged structure)
│   ├── App.jsx
│   ├── views/
│   │   └── DashboardView.jsx     # Consumes /api/services, no hardcoded service lists
│   ├── components/
│   │   ├── ServiceCard.jsx
│   │   ├── NodeCard.jsx
│   │   ├── SettingsPanel.jsx     # New: Services tab, Integrations tab, Nodes tab
│   │   └── ...
│   └── hooks/
│       └── useData.js
└── uploads/                      # User uploads (bg, logo)
```

---

## 5. Configuration Layers (Priority Order)

When resolving a value, the system checks in this order:

1. **`.env` variables** — highest priority, immutable at runtime
2. **`data/secrets.json`** — encrypted credentials, managed via UI or API  
3. **`data/services.yaml`** — all structural config, managed via UI or file edit

This means: if `PHOTOPRISM_URL` is set in `.env`, it overrides whatever the UI saved. Power users who prefer `.env` for everything can do so. UI users never touch `.env` after initial setup.

---

## 6. The .env File (Bootstrap Only)

Minimal. A new user needs only this:

```env
# Required
PROMETHEUS_URL=http://192.168.68.11:9090
KUMA_URL=http://192.168.68.11:3001

# Required for encrypted secrets (generate once: openssl rand -hex 32)
DASH_SECRET=your-random-secret-here

# Optional
PORT=3099
DASH_USER=admin
DASH_PASS=your-dashboard-password
```

Everything else — node names, service lists, integrations, display settings — is either auto-discovered or configured via the UI.

**Power-user .env overrides** (all optional, override UI-managed config):
```env
# If set, these override the equivalent UI/yaml config
PHOTOPRISM_URL=http://photoprism:2342
PHOTOPRISM_USER=admin
PHOTOPRISM_PASS=secret
ADGUARD_URL=http://192.168.68.13:8085
ADGUARD_USER=admin
ADGUARD_PASS=secret
GITEA_URL=http://localhost:3060
GITEA_TOKEN=your-token
NPM_URL=http://192.168.68.13:81
NPM_USER=admin@example.com
NPM_PASS=secret
```

---

## 7. The services.yaml File

Auto-generated on first boot from discovery results. Editable via Settings UI or directly. Hot-reloads on file change (5s poll).

```yaml
# JagHelm Configuration
# This file is managed by the dashboard. Edit here or in Settings UI — both are equivalent.

# ── Node Definitions ──
# Auto-discovered from Prometheus node labels on first boot.
# Customize names, icons, display order, and which containers to show/hide.
nodes:
  gateway:
    prometheus_node: pi               # Prometheus node label
    display_name: Gateway Services
    subtitle: Raspberry Pi 5
    icon: "🛡"
    border_color: "#a78bfa"
    visible: true
    auto_discover: true               # Auto-show new containers from this node
    hide:                             # Container names to hide (infra stuff)
      - prometheus
      - node-exporter

  production:
    prometheus_node: vm103
    display_name: Production
    subtitle: VM 103
    icon: "🚀"
    border_color: "#6366f1"
    visible: true
    auto_discover: true
    hide:
      - prometheus
      - node-exporter
      - cadvisor
      - grafana

  staging:
    prometheus_node: vm101
    display_name: Staging
    subtitle: VM 101
    icon: "🔬"
    border_color: "#fbbf24"
    visible: true
    auto_discover: true
    hide:
      - prometheus
      - node-exporter
      - cadvisor

# ── Service Overrides ──
# Optional. Override auto-discovered services with custom names, icons, or monitor mappings.
# Only needed when auto-matching gets something wrong.
services:
  nginx-proxy-manager:                # Key = exact Docker container name
    display_name: NPM
    monitor: "Nginx Proxy Manager"    # Exact Uptime Kuma monitor name
    node: gateway                     # Override node assignment (rare)
    icon: npm                         # Icon key from built-in icon set
    
  adguardhome:
    display_name: AdGuard Primary
    monitor: "AdGuard Home"

# ── Active Integrations ──
# Enable app-specific API stats on service cards.
# Credentials are stored encrypted in secrets.json (managed via UI).
# .env variables override if present.
integrations:
  photoprism:
    enabled: true
    container: photoprism             # Which container card to attach stats to
    # url + credentials resolved from secrets.json or .env
    
  adguard:
    enabled: true
    container: adguardhome

  npm:
    enabled: true
    container: nginx-proxy-manager

  gitea:
    enabled: true
    container: gitea
    repo: jagdeep.bhandal/homelab-infra   # Integration-specific config

# ── Custom Integrations ──
# For apps without a built-in preset. Same customapi pattern.
custom_integrations:
  my-custom-app:
    container: myapp
    url_secret: myapp_url             # References encrypted secret
    auth:
      method: bearer                  # none | basic | bearer | session | header
      token_secret: myapp_token       # References encrypted secret
    fields:
      - key: active_users
        label: Users
      - key: storage_used_gb
        label: Storage
        suffix: GB

# ── Display Settings ──
# Theme, layout, background, etc. (existing config migrated here)
display:
  title: JAGHELM
  subtitle: Infrastructure Dashboard
  theme: dark                         # dark | dracula | light
  accent_color: "#6366f1"
  bg_image: ""
  bg_opacity: 0.3
  overlay_opacity: 0.75
  show_dots: true
  show_search: true
  search_engine: google
  show_weather: true
  weather_lat: "39.88"
  weather_lon: "-83.09"
  weather_city: Grove City
  temp_unit: F
  service_detail_level: stats         # minimal | stats | full
  refresh_interval: 30
  show_todos: true

# ── Quick Launch Links ──
links:
  personal:
    - name: Photos
      icon: "📷"
      url: https://photos.jagbhandal.com
    - name: Vault
      icon: "🔐"
      url: https://vault.jagbhandal.com
    - name: Cloud
      icon: "☁️"
      url: https://cloud.jagbhandal.com
  management:
    - name: NPM
      icon: "🔧"
      url: https://npmpi.jagbhandal.com
    # ... etc

# ── Tabs ──
tabs:
  - id: uptime
    label: Uptime Kuma
    type: iframe
    url: https://kuma.jagbhandal.com
  - id: grafana
    label: Grafana
    type: iframe
    url: https://grafana.jagbhandal.com

# ── Grid Layout ──
# Auto-saved when user drags/resizes sections. Don't edit manually.
grid_layout: null
grid_columns: 12
```

---

## 8. Integration Preset Format

Each file in `integrations/` defines how to talk to a specific app. These are declarative — no JavaScript.

```yaml
# integrations/photoprism.yaml
name: PhotoPrism
description: Photo management
icon: photoprism
detect: photoprism                    # If a container name contains this, suggest this integration

# How to connect
connection:
  default_port: 2342
  url_env: PHOTOPRISM_URL             # Check .env first
  url_secret: photoprism_url          # Then check encrypted secrets

# How to authenticate
auth:
  method: session                     # none | basic | bearer | session | header
  login_endpoint: /api/v1/session
  username_env: PHOTOPRISM_USER
  username_secret: photoprism_user
  password_env: PHOTOPRISM_PASS
  password_secret: photoprism_pass
  token_field: id                     # Field in login response containing the session token
  token_header: X-Session-ID          # Header to send token in

# What to fetch
endpoints:
  - path: /api/v1/stats
    fields:
      - key: photos
        label: Photos
        format: number
      - key: videos
        label: Videos
        format: number
      - key: albums
        label: Albums
        format: number

# Test connection (used by "Test" button in Settings UI)
test:
  endpoint: /api/v1/stats
  expect: photos                      # Response should contain this key
```

```yaml
# integrations/adguard.yaml
name: AdGuard Home
description: DNS ad blocker
icon: adguard
detect: adguard

connection:
  default_port: 8085
  url_env: ADGUARD_URL
  url_secret: adguard_url

auth:
  method: basic
  username_env: ADGUARD_USER
  username_secret: adguard_user
  password_env: ADGUARD_PASS
  password_secret: adguard_pass

endpoints:
  - path: /control/stats
    fields:
      - key: num_dns_queries
        label: Queries
        format: number
      - key: num_blocked_filtering
        label: Blocked
        format: number
      - key: avg_processing_time
        label: Latency
        format: duration_ms

test:
  endpoint: /control/status
  expect: version
```

```yaml
# integrations/_template.yaml
# Copy this file and customize for your app.
name: My App
description: What this app does
icon: default                         # Icon key or URL
detect: myapp                         # Container name substring to auto-detect

connection:
  default_port: 8080
  url_env: MYAPP_URL                  # Optional .env override
  url_secret: myapp_url               # Name in encrypted secrets store

auth:
  method: none                        # none | basic | bearer | session | header
  # For basic: username_secret, password_secret
  # For bearer: token_secret
  # For session: login_endpoint, username_secret, password_secret, token_field, token_header
  # For header: header_name, token_secret

endpoints:
  - path: /api/stats
    fields:
      - key: some_metric
        label: Display Name
        format: number                # number | bytes | duration_ms | percent | string

test:
  endpoint: /api/health
  expect: status                      # Key that should exist in response
```

---

## 9. Secrets Manager

**Encryption:** AES-256-GCM using a key derived from `DASH_SECRET` via PBKDF2.

**`data/secrets.json` format:**
```json
{
  "photoprism_url": { "iv": "...", "data": "...", "tag": "..." },
  "photoprism_user": { "iv": "...", "data": "...", "tag": "..." },
  "photoprism_pass": { "iv": "...", "data": "...", "tag": "..." }
}
```

**Resolution order for a credential:**
1. Check `.env` for the `_env` key (e.g., `PHOTOPRISM_URL`)
2. Check `secrets.json` for the `_secret` key (e.g., `photoprism_url`)
3. If neither exists, the integration is disabled

**API:**
- `GET /api/secrets/keys` — returns list of secret names (not values)
- `PUT /api/secrets/:key` — encrypt and store a secret
- `DELETE /api/secrets/:key` — remove a secret
- Values are **never** returned via API. The UI shows `••••••••` and a "has value" indicator.

---

## 10. Discovery Engine

### Node Discovery
On first boot (no `services.yaml` exists):
1. Query Prometheus: `count by (node)(up{job="node"})`
2. Extract unique `node` labels → create a node entry for each
3. Auto-name them (can be customized later via UI)

On subsequent boots:
- Load nodes from `services.yaml`
- If a new Prometheus node label appears that isn't in config, add it as a new node

### Container Discovery
Every refresh cycle (default 30s):
1. For each node, query Prometheus cAdvisor: `container_last_seen{node="<label>", name!=""}`
2. Also query CPU, MEM, RX, TX stats for each container
3. Merge with `services.yaml` overrides (display name, icon, etc.)
4. Filter out containers in the node's `hide` list
5. Auto-match each container to a Kuma monitor (see below)
6. Check if any integration preset matches (via `detect` field)
7. Return the complete service list to the frontend

### Monitor Auto-Matching
For each discovered container, try to find a matching Uptime Kuma monitor:
1. **Exact match:** `services.yaml` has an explicit `monitor:` mapping → use it
2. **Name match:** Normalize both container name and monitor name (lowercase, strip non-alphanumeric), check if one contains the other
3. **No match:** Show the service with Docker status only (running/stopped), no Kuma health data

The Settings UI shows unmatched services with a "Link monitor" dropdown.

---

## 11. Settings UI Additions

### New Tab: "Nodes"
- List of discovered + configured nodes
- Per node: edit display name, subtitle, icon, border color, visibility toggle
- Toggle `auto_discover` on/off
- Manage `hide` list (checkboxes of discovered containers)
- "Add Node" button for manual node definition

### New Tab: "Services"  
- Per node: list of all discovered + configured services
- For each service: 
  - Display name (editable)
  - Icon (picker from built-in set + custom URL)
  - Uptime Kuma monitor (dropdown of all monitors, with "auto" default)
  - Visibility toggle (hide/show)
  - Node assignment (dropdown, for moving a service between sections)
- Visual indicator: auto-discovered vs manually added
- Visual indicator: matched vs unmatched monitor

### New Tab: "Integrations"
- List of available presets (from `integrations/` folder)
- For each: enabled/disabled toggle, status indicator (connected/error/no credentials)
- When enabling: form with URL + credential fields (masked), "Test Connection" button
- Test button calls the preset's `test.endpoint`, shows success/failure
- "Add Custom Integration" button → form matching `_template.yaml` structure
- Each enabled integration shows which service card it's attached to

### Existing Tabs (migrated)
- "Appearance" → Theme, backgrounds, accent color (unchanged)
- "Layout" → Grid settings (unchanged)  
- "Widgets" → Search, weather, temp unit, service detail level, todos (unchanged)
- "Links" → Quick launch link management (unchanged, eventually get full CRUD UI)
- "Tabs" → Iframe tab management (unchanged)

---

## 12. API Endpoints

### Existing (unchanged)
- `GET /api/prometheus/query` — proxy Prometheus queries
- `GET /api/weather` — weather data
- `GET /api/todos` / `POST /api/todos` — todo CRUD
- `POST /api/upload` — file uploads
- `GET /api/health` — server health
- `POST /api/auth/login` / `GET /api/auth/check` — authentication

### Removed (replaced by /api/services)
- `GET /api/uptime/monitors` → merged into services response
- `GET /api/docker/containers` → merged into services response
- `GET /api/adguard/stats` → handled by integration engine
- `GET /api/npm/stats` → handled by integration engine
- `GET /api/gitea/activity` → remains but may move to integration engine later

### New
- `GET /api/services` — the big one. Returns complete merged service data:
  ```json
  {
    "nodes": {
      "gateway": {
        "display_name": "Gateway Services",
        "subtitle": "Raspberry Pi 5",
        "icon": "🛡",
        "border_color": "#a78bfa",
        "metrics": { "cpu": "1.6", "memPercent": "44.7", "temp": "47.3", "uptime": "16h 27m" },
        "services": [
          {
            "container": "nginx-proxy-manager",
            "display_name": "NPM",
            "icon": "npm",
            "status": "up",
            "ping": 12,
            "uptime24": 0.999,
            "docker": { "cpu": 0.3, "memMB": 45.2, "rxMB": 120.5, "txMB": 89.3 },
            "integration": {
              "type": "npm",
              "data": { "Hosts": 19, "Online": 19, "Certs": 19 }
            }
          }
        ]
      }
    }
  }
  ```
- `GET /api/services/config` — returns the raw services.yaml as JSON (for Settings UI)
- `POST /api/services/config` — saves updated config (from Settings UI), writes services.yaml
- `GET /api/services/monitors` — returns list of all Kuma monitor names (for dropdowns)
- `GET /api/services/integrations` — returns available presets + their status
- `POST /api/services/integrations/test` — test an integration connection
- `GET /api/secrets/keys` — list secret names (not values)
- `PUT /api/secrets/:key` — store encrypted secret
- `DELETE /api/secrets/:key` — remove secret

---

## 13. Frontend Changes

### DashboardView.jsx
- Fetches `GET /api/services` instead of making 11 separate API calls
- No hardcoded service names anywhere
- Iterates over `nodes` from the API response, renders a `NodeCard` for each
- Each `NodeCard` receives its services array from the API

### NodeCard.jsx
- Receives `node` object with metrics + services array
- No changes to rendering logic, just cleaner data flow

### ServiceCard.jsx  
- Receives `service` object that already has docker stats, monitor status, and integration data merged
- No more fuzzy matching on the frontend — server handles all matching

### SettingsPanel.jsx
- New tabs: Nodes, Services, Integrations
- Loads/saves via `/api/services/config` and `/api/secrets`

---

## 14. Migration Path (v7.5 → v8.0)

1. Existing `localStorage` config (display settings, links, tabs, grid layout) migrates into `services.yaml` under the `display`, `links`, `tabs`, and `grid_layout` keys
2. First boot with no `services.yaml` triggers auto-discovery and generates the file
3. Existing `.env` variables continue to work — they take priority over UI-managed config
4. Existing hardcoded service lists in DashboardView are replaced by API-driven rendering
5. No data loss — all existing features continue to work, they just become configurable

---

## 15. Implementation Phases

### Phase 1: Foundation
- `server/config.js` — YAML loader with hot-reload
- `server/secrets.js` — AES-256-GCM encrypt/decrypt with DASH_SECRET
- `server/discovery.js` — node + container discovery from Prometheus
- `server/monitors.js` — Kuma monitor fetching + auto-matching
- `GET /api/services` endpoint — merges everything into one response
- `DashboardView.jsx` refactor — consume `/api/services` instead of 11 separate calls
- **Result:** Dashboard works with zero config, services auto-discovered

### Phase 2: Settings UI
- New Nodes tab — manage discovered nodes
- New Services tab — override names, icons, monitors, visibility
- `GET/POST /api/services/config` — read/write services.yaml from UI
- Secrets API + masked credential fields in UI
- **Result:** Full UI management of nodes and services without touching files

### Phase 3: Integration Engine
- `server/integrations.js` — load preset YAML files, execute API calls
- Integration presets for: AdGuard, NPM, PhotoPrism, Nextcloud, Vaultwarden, Gitea
- New Integrations tab in Settings UI — enable/disable, configure, test
- Custom integration builder in UI
- **Result:** App-specific API stats on service cards, fully UI-configurable

### Phase 4: Polish
- Docker label discovery as alternative to Prometheus discovery
- `_template.yaml` + contributor documentation
- Config export/import (full backup of services.yaml + secrets)
- Migration wizard for existing localStorage config
- README and open-source preparation

---

## 16. Resolved Design Decisions

### Gitea Pipeline Activity → Both
The Gitea service card gets basic integration stats (repos, issues, stars) via the Gitea integration preset. Pipeline Activity (recent commits/PRs for a configured repo) **stays as its own dedicated section** on the grid — same as today. These are independent: one is about the Gitea instance, the other is about your CI/CD workflow. The Pipeline Activity section becomes configurable (which repo to watch) via Settings UI.

### UPS Monitoring → Dedicated Section
UPS Power stays as its own dedicated section on the grid. It's infrastructure-level (protects the whole stack), not tied to any single container or node. The NUT/Prometheus queries stay as-is, but become configurable (metric names, exporter URL) via Settings UI instead of hardcoded guessing.

### Icon Sets → Vendored, Three Sources
Icons are bundled into the Docker image and served locally. No CDN dependency. Three sources, matching Homepage's approach:

| Source | Prefix | Count | Use Case |
|---|---|---|---|
| Dashboard Icons (homarr-labs/dashboard-icons) | `photoprism.svg` | ~500 | Self-hosted app logos |
| Simple Icons (simpleicons.org) | `si-docker` | ~3000 | Brand/company logos |
| Material Design Icons (pictogrammers.com/mdi) | `mdi-server` | Subset ~200 | General purpose UI icons |

Only the homelab-relevant subset of MDI is vendored (not all 7000). Dashboard Icons and Simple Icons are vendored in full (SVG only, no PNG — keeps image size small). Icons are served from `/icons/` static path. Custom icons can be added by mounting a volume to `/app/public/icons/`.

The Settings UI icon picker shows a searchable grid of all available icons, grouped by source.

### Multi-User → Single User (Future Consideration)
Single user for now. Multi-user with per-user boards is a potential future feature but very low priority. The auth system stays as-is (optional password gate). No per-user config separation in v8.

---

## 17. Carry-Over Notes for Next Session

### What to bring to the new chat:
1. This spec document (`jaghelm-v8-architecture-spec.md`)
2. The v7.5.1 tarball (`jagnet-dashboard-v7_5_1.tar.gz`) — this is the current codebase
3. The infrastructure doc (`Homelab-Infrastructure-Documentation-v2_4.html`)
4. A fresh screenshot of the running dashboard

### First actions in the new session:
1. Create the `jaghelm` repo on Gitea (VM 101)
2. Rename the project directory from `jagnet-dashboard` to `jaghelm`
3. Update `package.json` name field from `jagnet-dashboard` to `jaghelm`
4. Initial commit with v7.5.1 code + this spec as `docs/ARCHITECTURE.md`
5. Begin Phase 1 implementation

---

## 18. Outstanding Issues — Full Inventory

### Category A: Infrastructure bugs (need SSH + Phase 1 to fully resolve)

These are visible on the dashboard today. Phase 1's service discovery system replaces the broken fuzzy matcher, but the underlying infrastructure issues still need SSH debugging.

1. **UNKNOWN status on all service cards** — The fuzzy monitor name matcher in DashboardView doesn't align with what Uptime Kuma actually returns. Phase 1 replaces this with auto-matching + explicit mapping. But you still need to verify Kuma monitor names match container names.
   - **SSH needed:** `curl -s http://localhost:3001/api/status-page/default | jq '.publicGroupList[].monitorList[].name'` (on the node running Kuma)

2. **UPS Power showing "Unknown" / all dashes** — NUT exporter metric names don't match any of the three conventions the server tries. Need to find what Prometheus actually has.
   - **SSH needed:** `curl -s 'http://localhost:9090/api/v1/label/__name__/values' | jq '.data[]' | grep -i nut` (on Proxmox or wherever Prometheus runs)

3. **Docker container stats showing dashes for RX/TX** — The v7.4 server never queries network metrics. Phase 1's discovery engine adds `container_network_receive_bytes_total` and `container_network_transmit_bytes_total` queries.

4. **AdGuard API on Pi port 8085 not reachable from VM 101** — Network/firewall issue between Pi and staging VM.
   - **SSH needed:** `curl -s http://192.168.68.13:8085/control/status` from VM 101

5. **NUT exporter port mismatch** — Listening on 9995, not 9199 as mapped. Check prometheus.yml scrape config.
   - **SSH needed:** Check `/etc/prometheus/prometheus.yml` on both VMs

6. **NUT server not listening on Proxmox LAN IP** — upsd.conf may only bind to localhost.
   - **SSH needed:** Check `/etc/nut/upsd.conf` LISTEN directives on Proxmox

7. **prometheus.yml on VM 101 staging needs sync with VM 103** — Staging may be missing scrape targets that production has.

### Category B: UI/UX bugs (code fixes, no SSH needed)

8. **Cards below viewport hard to drag** — overflow:hidden restored content clipping but dragging near the bottom of the page is difficult. The drag handle (section-header) works but the grid container doesn't scroll during drag. Consider `scrollable: true` in RGL v2 dragConfig or a persistent drag handle icon.

9. **Section content overflows when cards are resized small** — Partially addressed in v7.5.1 with responsive auto-fill grids. May need further tuning after testing with real data.

10. **Font contrast on headers/labels** — Brightened from text-muted to text-secondary in v7.4 but needs verification against background images.

11. **Weather widget may not load on first page load** — Retry logic added via refreshKey but needs verification after deploy.

### Category C: Architecture work (Phase 1-4 of this spec)

12. **Phase 1: Foundation** — Config manager, secrets manager, discovery engine, monitor matching, unified `/api/services` endpoint, DashboardView refactor to consume it. This is the big one — eliminates hardcoded service lists, enables zero-config operation.

13. **Phase 2: Settings UI** — Nodes tab, Services tab, secrets management with masked fields, full YAML parity from the browser.

14. **Phase 3: Integration Engine** — Declarative plugin presets for common apps, custom integration builder in UI, test-before-save. Presets for: AdGuard, NPM, PhotoPrism, Nextcloud, Vaultwarden, Gitea, PiHole, Plex, Jellyfin.

15. **Phase 4: Polish** — Docker label discovery, icon vendoring (Dashboard Icons + Simple Icons + MDI subset), `_template.yaml` for contributors, config export/import, migration wizard, README, open-source prep.

### Category D: Feature requests (post-v8, low priority)

16. **Phase B service integrations** — PhotoPrism photo count, Nextcloud storage, Vaultwarden vault items, Dockge running/stopped stacks. These become integration presets in Phase 3.

17. **Service mini-card design refinement** — Reference Homarr/Homepage screenshot (rich cards with icon, name, status badge, latency, expandable stats). Revisit after Phase 1 when the data layer is clean.

18. **Dashboard responsiveness on smaller screens** — Partially addressed in v7.5.1. Needs testing on tablets and phones.

19. **Notification system for service state changes** — Browser notifications when a service goes down/comes back.

20. **Historical metric sparklines** — Tiny inline charts in metric blocks showing last-hour trends. Requires Prometheus range queries.

21. **Quick actions from service cards** — Restart container, etc. Requires Docker socket access.

22. **CI/CD runner improvements** — Doesn't handle deleted stacks, doesn't fix Prometheus/Grafana permissions.

23. **Multi-user support** — Per-user boards. Very low priority.

---

## 19. What's Done (Don't Redo)

### v7.5.0 — Dependency Upgrades (completed this session)
- React 18.2 → 19.0.0
- react-grid-layout 1.4.4 → 2.2.2 (full v2 hooks API rewrite)
- Vite 5.1 → 8.0.1 (Rolldown migration)
- @vitejs/plugin-react 4.2.1 → 6.0.1
- react-colorful stays at 5.6.1 (already latest)
- DashboardView.jsx fully rewritten: useContainerWidth hook, verticalCompactor, gridConfig/dragConfig/resizeConfig props

### v7.5.1 — Responsive Inner Grids (completed this session)
- `.quick-launch-grid`: `repeat(3,1fr)` → `repeat(auto-fill, minmax(140px, 1fr))`
- `.ups-grid`: `repeat(4,1fr)` → `repeat(auto-fill, minmax(120px, 1fr))`
- ServiceCard stats grid: `repeat(4,1fr)` → `repeat(auto-fill, minmax(60px, 1fr))`
- ServiceCard app data grid: `repeat(N,1fr)` → `repeat(auto-fill, minmax(70px, 1fr))`
- NodeCard service grid: minmax reduced from 180/220px to 150/200px
- Media query @900px: removed redundant grid overrides

### Files changed in v7.5.1 (relative to v7.4):
- `package.json` — all dependency upgrades + js-yaml added, version 7.5.1
- `src/views/DashboardView.jsx` — complete RGL v2 hooks API rewrite
- `src/styles/global.css` — responsive auto-fill grids, media query cleanup
- `src/components/ServiceCard.jsx` — responsive auto-fill for stat grids
- `src/components/NodeCard.jsx` — reduced service grid minmax values

### Session rules (always apply):
LAYER CHECK, THREE STRIKE RULE, RADIOACTIVE COMMANDS, SCOPE CHECK, BLAST RADIUS, 4AM RULE — all from user preferences.

---

*This is the approved JagHelm v8 architecture specification. Implementation begins next session with Phase 1.*
