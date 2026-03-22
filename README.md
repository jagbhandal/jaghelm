<p align="center">
  <img src="public/logo.svg" height="120" alt="JagHelm">
</p>

<h1 align="center">JagHelm</h1>

<p align="center">
  <strong>A real-time multi-node infrastructure monitoring dashboard for homelabs.</strong><br>
  Not just a link launcher — a live operations center for your self-hosted stack.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-8.0-6366f1?style=flat-square" alt="Version">
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License">
  <img src="https://img.shields.io/badge/node-20+-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node">
  <img src="https://img.shields.io/badge/react-19-61dafb?style=flat-square&logo=react&logoColor=white" alt="React">
  <img src="https://img.shields.io/badge/docker-ready-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker">
</p>

---

## What Makes JagHelm Different

Homepage and Homarr are link launchers with widget sidecars. **JagHelm is a real-time multi-node infrastructure monitoring dashboard** that also happens to have service cards, bookmarks, and app integrations.

| Feature | Homepage | Homarr | JagHelm |
|---------|----------|--------|---------|
| Multi-node monitoring (CPU/RAM/Disk/Temp) | ❌ | ❌ | ✅ Per-node from Prometheus |
| Per-container resource stats (CPU/MEM/RX/TX) | ❌ | ❌ | ✅ Via cAdvisor |
| UPS power monitoring | Widget only | ❌ | ✅ Dedicated section via NUT |
| Uptime Kuma deep integration | Widget only | Widget only | ✅ Per-service health, ping, uptime bars |
| Three-tier service cards | ❌ | ❌ | ✅ Health → Container stats → App API |
| Drag-and-drop grid layout | ❌ | ✅ | ✅ React Grid Layout v2 |
| UI-first configuration | ❌ (YAML only) | ✅ | ✅ Full settings page + YAML escape hatch |
| Server-side config persistence | ❌ | ✅ | ✅ Survives container rebuilds |
| Built-in authentication | ❌ | ✅ | ✅ With password change from UI |
| Encrypted secrets management | ❌ | ✅ | ✅ AES-256-GCM |
| VS Code-inspired themes | ❌ | ❌ | ✅ 6 themes |

---

## Features

### 🖥 Multi-Node Infrastructure Monitoring
Real-time metrics from Prometheus for every node in your homelab. CPU, RAM, disk usage, temperature, and uptime — all at a glance. Nodes are auto-discovered from Prometheus labels on first boot.

### 📦 Per-Container Resource Stats
CPU, memory, network RX/TX for every Docker container via cAdvisor. See exactly which containers are consuming resources across all your nodes.

### ⚡ UPS Power Monitoring
Dedicated UPS section showing battery status, charge level, runtime, and load via NUT/Prometheus. Automated graceful shutdown support.

### 🟢 Uptime Kuma Deep Integration
Every service card shows live health status, ping latency, and 24-hour uptime percentage directly from Uptime Kuma. Auto-matched to containers or manually mapped.

### 📊 Three-Tier Service Cards
- **Tier 1 — Health:** Status dot + ping + running/down badge from Uptime Kuma
- **Tier 2 — Container Stats:** CPU, MEM, RX, TX per container from cAdvisor
- **Tier 3 — App API Data:** Integration-specific metrics (queries blocked, hosts proxied, etc.)

Service card detail level is configurable: minimal, stats, or full.

### 🎨 6 VS Code-Inspired Themes
Choose from the most popular developer themes, adapted for dashboard use:

| Theme | Description |
|-------|-------------|
| **One Dark Pro** | Atom's iconic dark theme (default) |
| **Dracula** | Dark with vibrant purple accents |
| **Night Owl** | Deep blue, optimized for low-light |
| **GitHub Dark** | Clean and minimal |
| **Catppuccin Mocha** | Warm, soothing pastels |
| **Material Ocean** | Google Material's darkest variant |

### 🔤 Full Typography System
- **5 font family presets:** Default (Outfit), Clean (Inter), Rounded (Nunito), Sharp (Rajdhani), System
- **8 targeted font size controls:** Section headers, metric values, metric labels, service names, stat values, stat labels — each independently adjustable
- Contrast-optimized defaults for readability on dark backgrounds

### ⚙️ Full-Page Settings UI
Professional settings experience — no cramped drawers. Full-page layout with sidebar navigation across 12 sections:

- **General** — Title, subtitle, logo upload/restore
- **Appearance** — Theme picker, accent color, background image, opacity
- **Typography** — Font family presets, per-element size sliders
- **Layout** — Grid columns, refresh interval, card detail level
- **Sections** — Per-section visibility, colors, titles for UPS/Pipeline/Quick Launch/Todos
- **Nodes** — Per-node display name, subtitle, icon, border color, auto-discover, hide list
- **Services** — Per-container display name, icon, Kuma monitor dropdown, visibility
- **Links** — Full CRUD for Quick Launch bookmarks with drag reordering
- **Widgets** — Search engine, weather, feature toggles
- **Tabs** — Iframe tab management (embed Grafana, Kuma, etc.)
- **Security** — Password change from UI (SHA-256 hashed, persisted server-side)
- **Backup** — Export/import config JSON

### 🔐 Security
- Optional password authentication with SHA-256 hashing
- Password changeable from the Settings UI (no SSH required)
- AES-256-GCM encrypted secrets for API credentials
- Session management with 24-hour expiry
- All API requests proxied through the backend — no credentials exposed to the browser

### 🚀 Quick Launch
Organized bookmark groups with proper service icons (auto-matched from 35+ self-hosted app icons). Full CRUD — add, edit, delete, reorder links and groups from the Settings UI.

### 📐 Drag-and-Drop Grid Layout
Powered by React Grid Layout v2 with vertical compaction. Resize panels from all sides (SE, SW, E, W handles). Layout persists server-side across sessions and devices. Auto-scroll during drag near viewport edges.

### 🔄 Real-Time Updates
Configurable refresh interval (10s–120s). All data sources refresh in parallel. Server-side caching with proper cache busting. Live health indicator in the navigation bar.

### 💾 Server-Side Config Persistence
All display settings (theme, layout, sections, links, etc.) save to `data/display-config.json` server-side with 2-second debounced writes. Survives container rebuilds via Docker volume. Infrastructure config (nodes, services, integrations) stored in `data/services.yaml` with hot-reload on file change.

---

## Quick Start

### Docker Compose (Recommended)

```yaml
services:
  jaghelm:
    build: .
    container_name: jaghelm
    restart: unless-stopped
    ports:
      - 3099:3099
    environment:
      PROMETHEUS_URL: http://your-prometheus-host:9090
      KUMA_URL: http://your-kuma-host:3001
      DASH_SECRET: your-random-secret-here  # openssl rand -hex 32
      DASH_USER: admin
      DASH_PASS: your-password
    volumes:
      - ./data:/app/data        # Config + secrets persist here
      - ./uploads:/app/uploads  # Logo + background images
```

```bash
docker compose up -d
```

Open `http://your-server:3099` — JagHelm will auto-discover your Prometheus nodes and start monitoring immediately.

### Requirements

- **Prometheus** with node_exporter on each node you want to monitor
- **cAdvisor** on each node for container-level stats
- **Uptime Kuma** (optional) for service health monitoring
- **NUT exporter** (optional) for UPS monitoring

---

## Configuration

### Zero-Config by Default

JagHelm auto-discovers nodes and containers from Prometheus on first boot. No YAML editing required. Everything is configurable from the Settings UI.

### Power-User Escape Hatch

For those who prefer files over UI, all config is stored in standard YAML/JSON:

```
data/
├── services.yaml          # Nodes, services, integrations (server config)
├── display-config.json    # Theme, layout, sections, links (UI config)
├── secrets.json           # Encrypted API credentials
├── auth.json              # Password hash (if changed via UI)
└── todos.json             # Checklist data
```

### Environment Variables

```env
# Required
PROMETHEUS_URL=http://your-prometheus:9090
KUMA_URL=http://your-kuma:3001

# Required for encrypted secrets
DASH_SECRET=your-random-secret-here

# Optional authentication
DASH_USER=admin
DASH_PASS=your-password
PORT=3099

# Optional integration overrides (these take priority over UI-managed config)
ADGUARD_URL=http://your-adguard-host:8085
ADGUARD_USER=admin
ADGUARD_PASS=secret
GITEA_URL=http://localhost:3060
GITEA_TOKEN=your-token
NPM_URL=http://your-npm-host:81
NPM_USER=admin@example.com
NPM_PASS=secret
```

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Full-Page Settings UI               │
│  General │ Appearance │ Typography │ Layout │ ...    │
└────────────────────────┬────────────────────────────┘
                         │ reads/writes via API
┌────────────────────────▼────────────────────────────┐
│                   Express Server                     │
│                                                      │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────┐  │
│  │ Config   │  │ Discovery │  │ Integration      │  │
│  │ Manager  │  │ Engine    │  │ Engine (Phase 3) │  │
│  │          │  │           │  │                  │  │
│  │services. │  │Prometheus │  │Loads presets +   │  │
│  │yaml      │  │cAdvisor   │  │custom configs    │  │
│  │(r/w)     │  │Docker     │  │Calls APIs with   │  │
│  │          │  │Kuma       │  │encrypted creds   │  │
│  └──────────┘  └───────────┘  └──────────────────┘  │
│                                                      │
│  ┌──────────────────────────────────────────────┐    │
│  │              Secrets Manager                  │    │
│  │  AES-256-GCM with DASH_SECRET                │    │
│  └──────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────┘
         │              │              │
   ┌──────────┐  ┌───────────┐  ┌──────────┐
   │Prometheus│  │Uptime Kuma│  │App APIs  │
   │  +nodes  │  │ monitors  │  │AdGuard   │
   │  +cAdv.  │  │           │  │NPM, etc. │
   │  +NUT    │  │           │  │          │
   └──────────┘  └───────────┘  └──────────┘
```

### Tech Stack

- **Frontend:** React 19, Vite 8 (Rolldown), React Grid Layout v2, react-colorful
- **Backend:** Express.js, js-yaml, node-fetch
- **Monitoring:** Prometheus, cAdvisor, node_exporter, NUT exporter
- **Health:** Uptime Kuma API integration
- **Security:** AES-256-GCM (PBKDF2 key derivation), SHA-256 password hashing
- **Icons:** Dashboard Icons (walkxcode) — 500+ self-hosted app SVGs

---

## Roadmap

### ✅ Phase 1: Foundation (Complete)
Config manager, secrets manager, discovery engine, monitor matching, unified `/api/services`.

### ✅ Phase 2: Settings UI (Complete)
Full-page settings with sidebar navigation. Nodes tab, Services tab, Links CRUD, Security tab, Typography system. Server-side display config persistence.

### 🔧 Phase 3: Integration Engine (In Progress)
Declarative integration presets for common self-hosted apps. Custom integration builder. Test-before-save for connections.

### 📋 Phase 4: Polish
Docker label discovery, vendored icon sets, config export/import wizard, responsive mobile layout, open-source preparation.

---

## Contributing

Contributions are welcome. Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Development Setup

```bash
git clone https://github.com/your-org/jaghelm.git
cd jaghelm
npm install
npm run dev     # Vite dev server with HMR
```

The Express server runs on port 3099. The Vite dev server proxies API requests.

---

## License

MIT License. See [LICENSE](LICENSE) for details.

---

<p align="center">
  <sub>Built with ☕ and late nights for the self-hosted community.</sub>
</p>
