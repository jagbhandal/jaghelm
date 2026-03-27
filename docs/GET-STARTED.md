# JagHelm — Getting Started Guide

A complete walkthrough for setting up JagHelm to monitor your homelab infrastructure. By the end of this guide, you'll have a live dashboard showing real-time metrics for all your nodes and containers.

---

## Table of Contents

1. [What You Need](#1-what-you-need)
2. [Step 1: Set Up Prometheus and Node Exporter](#2-step-1-set-up-prometheus-and-node-exporter)
3. [Step 2: Set Up cAdvisor for Container Metrics](#3-step-2-set-up-cadvisor-for-container-metrics)
4. [Step 3: Deploy JagHelm](#4-step-3-deploy-jaghelm)
5. [Step 4: First Boot — What to Expect](#5-step-4-first-boot--what-to-expect)
6. [Step 5: Add Uptime Kuma (Optional)](#6-step-5-add-uptime-kuma-optional)
7. [Step 6: Add UPS Monitoring (Optional)](#7-step-6-add-ups-monitoring-optional)
8. [Step 7: Configure Integrations](#8-step-7-configure-integrations)
9. [Step 8: Embed Services as Tabs](#9-step-8-embed-services-as-tabs)
10. [Step 9: Customize Your Dashboard](#10-step-9-customize-your-dashboard)
11. [Troubleshooting](#11-troubleshooting)
12. [Architecture Overview](#12-architecture-overview)

---

## 1. What You Need

**Required:**
- At least one Linux machine running Docker (this is the machine you want to monitor)
- Docker and Docker Compose installed
- 5 minutes for a basic setup, 30 minutes for the full experience

**Optional (but recommended):**
- [Uptime Kuma](https://github.com/louislam/uptime-kuma) — adds health monitoring, ping latency, and uptime tracking to each service card
- A UPS with NUT (Network UPS Tools) — for power monitoring on the dashboard

**JagHelm gets its data from Prometheus.** If you don't already have Prometheus running, this guide will help you set it up. If you already have Prometheus with node_exporter and cAdvisor, skip to [Step 3: Deploy JagHelm](#4-step-3-deploy-jaghelm).

---

## 2. Step 1: Set Up Prometheus and Node Exporter

JagHelm reads all node metrics (CPU, RAM, disk, temperature, uptime) from Prometheus. You need two things on each machine you want to monitor:

- **node_exporter** — exposes system metrics (CPU, RAM, disk, etc.)
- **Prometheus** — scrapes and stores those metrics (runs on one machine only)

### Install node_exporter on each machine

node_exporter runs as a lightweight process and exposes metrics on port 9100.

```bash
# On each machine you want to monitor
docker run -d \
  --name node-exporter \
  --restart unless-stopped \
  --net host \
  --pid host \
  -v /:/host:ro,rslave \
  quay.io/prometheus/node-exporter:latest \
  --path.rootfs=/host
```

Verify it's running: `curl http://localhost:9100/metrics` — you should see a wall of metric text.

### Install Prometheus (on one machine)

Prometheus collects metrics from all your node_exporters. It only needs to run on one machine.

Create a directory for Prometheus:

```bash
mkdir -p /opt/stacks/prometheus
cd /opt/stacks/prometheus
```

Create `prometheus.yml` — this tells Prometheus where to find your exporters:

```yaml
global:
  scrape_interval: 15s

scrape_configs:
  # Monitor the machine Prometheus runs on
  - job_name: 'node'
    static_configs:
      - targets: ['localhost:9100']
        labels:
          node: 'myserver'    # This label appears in JagHelm as the node name

  # Add more machines here:
  # - targets: ['192.168.1.50:9100']
  #   labels:
  #     node: 'nas'
  #
  # - targets: ['192.168.1.51:9100']
  #   labels:
  #     node: 'pihole'
```

**Important:** The `node` label is what JagHelm uses to identify each machine. Choose short, descriptive names.

Create `compose.yaml`:

```yaml
services:
  prometheus:
    image: prom/prometheus:latest
    container_name: prometheus
    restart: unless-stopped
    ports:
      - 9090:9090
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus_data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.retention.time=30d'

volumes:
  prometheus_data:
```

Start it:

```bash
docker compose up -d
```

Verify: Open `http://your-server:9090` in a browser. Go to Status > Targets — you should see your node_exporter targets listed as "UP".

### Monitoring multiple machines

For each additional machine you want in JagHelm:

1. Install node_exporter on that machine (same Docker command as above)
2. Add it to `prometheus.yml` under `static_configs` with a unique `node` label
3. Restart Prometheus: `docker compose restart prometheus`

JagHelm will auto-discover all nodes that have a `node` label in Prometheus on first boot.

---

## 3. Step 2: Set Up cAdvisor for Container Metrics

cAdvisor gives JagHelm per-container stats: CPU usage, memory, network RX/TX for every Docker container. Install it on each machine that runs Docker containers you want to monitor.

```bash
docker run -d \
  --name cadvisor \
  --restart unless-stopped \
  --privileged \
  --device /dev/kmsg \
  -p 8080:8080 \
  -v /:/rootfs:ro \
  -v /var/run:/var/run:ro \
  -v /sys:/sys:ro \
  -v /var/lib/docker/:/var/lib/docker:ro \
  -v /dev/disk/:/dev/disk:ro \
  gcr.io/cadvisor/cadvisor:latest
```

Then add cAdvisor as a scrape target in your `prometheus.yml`:

```yaml
  - job_name: 'cadvisor'
    static_configs:
      - targets: ['localhost:8080']
        labels:
          node: 'myserver'    # Same node label as the node_exporter for this machine

      # For remote machines:
      # - targets: ['192.168.1.50:8080']
      #   labels:
      #     node: 'nas'
```

**The `node` label must match** between node_exporter and cAdvisor for the same machine. This is how JagHelm knows which containers belong to which node.

Restart Prometheus after editing:

```bash
docker compose restart prometheus
```

---

## 4. Step 3: Deploy JagHelm

JagHelm is distributed as a pre-built Docker image on GitHub Container Registry. No build step required — just pull and run.

Create a directory:

```bash
mkdir -p /opt/stacks/jaghelm
cd /opt/stacks/jaghelm
```

Create `.env`:

```env
# Required: Point to your Prometheus instance
PROMETHEUS_URL=http://your-prometheus-host:9090

# Optional: Point to Uptime Kuma (if you have it)
KUMA_URL=http://your-kuma-host:3001

# Required: Random secret for encrypting stored API credentials
# Generate one with: openssl rand -hex 32
DASH_SECRET=paste-your-random-secret-here

# Optional: Enable password protection
DASH_USER=admin
DASH_PASS=choose-a-strong-password
```

**Replace the placeholder values above with your actual IPs/hostnames and a real secret.**

Create `compose.yaml`:

```yaml
services:
  jaghelm:
    image: ghcr.io/jagbhandal/jaghelm:latest
    container_name: jaghelm
    restart: unless-stopped
    ports:
      - 3099:3099
    env_file:
      - .env
    volumes:
      - ./data:/app/data
      - ./uploads:/app/uploads
    environment:
      - NODE_ENV=production
```

Pull and start:

```bash
docker compose up -d
```

Docker will pull the image from GHCR automatically on first run. No cloning or building required.

To pin to a specific version instead of always getting the latest:

```yaml
    image: ghcr.io/jagbhandal/jaghelm:1.0.0
```

Available versions are listed on the [GitHub Releases](https://github.com/jagbhandal/jaghelm/releases) page.

---

## 5. Step 4: First Boot — What to Expect

Open `http://your-server:3099` in a browser.

**If you set a password:** You'll see a login page. Enter the username and password from your `.env` file.

**On first load, JagHelm will:**

1. Connect to Prometheus and discover all nodes with a `node` label
2. Auto-generate a `data/services.yaml` config with your discovered nodes
3. Query cAdvisor for containers on each node
4. Display everything in the dashboard

You should see a panel for each node showing CPU, RAM, disk, and uptime metrics, plus a card for each Docker container.

**If panels are empty or show "Loading...":**
- Check that Prometheus is reachable from the JagHelm container
- Verify Prometheus targets are "UP" at `http://your-prometheus:9090/targets`
- Check JagHelm logs: `docker logs jaghelm`

---

## 6. Step 5: Add Uptime Kuma (Optional)

Uptime Kuma adds health status (up/down), ping latency, and 24-hour uptime percentage to each service card. Without it, JagHelm still works — cards just show container stats without health monitoring.

If you don't already have Uptime Kuma:

```yaml
services:
  uptime-kuma:
    image: louislam/uptime-kuma:latest
    container_name: uptime-kuma
    restart: unless-stopped
    ports:
      - 3001:3001
    volumes:
      - uptime-kuma_data:/app/data

volumes:
  uptime-kuma_data:
```

```bash
docker compose up -d
```

Then set up monitors in Uptime Kuma for each service you want to track. JagHelm auto-matches Kuma monitors to containers by name — if your container is called `gitea` and your Kuma monitor is called "Gitea", they'll match automatically.

Make sure `KUMA_URL` in your JagHelm `.env` file points to your Uptime Kuma instance, then restart JagHelm:

```bash
docker compose restart jaghelm
```

---

## 7. Step 6: Add UPS Monitoring (Optional)

If you have a UPS connected to one of your machines via USB, JagHelm can display battery status, charge level, runtime, and load.

You'll need:
1. **NUT (Network UPS Tools)** installed on the machine the UPS is connected to
2. **nut_exporter** — a Prometheus exporter for NUT metrics

Install nut_exporter:

```bash
docker run -d \
  --name nut-exporter \
  --restart unless-stopped \
  -p 9199:9199 \
  -e NUT_EXPORTER_SERVER=your-nut-server-ip \
  hon95/prometheus-nut-exporter:latest
```

Add it to `prometheus.yml`:

```yaml
  - job_name: 'nut'
    static_configs:
      - targets: ['localhost:9199']
```

Restart Prometheus, and the UPS panel will appear in JagHelm automatically.

---

## 8. Step 7: Configure Integrations

JagHelm can pull data from your self-hosted apps and display it on service cards. For example, AdGuard Home shows queries blocked, NPM shows proxy hosts count, Gitea shows recent commits.

**From the Settings UI:**

1. Click the gear icon to open Settings
2. Go to **Integrations**
3. Browse the preset gallery — 42 presets available including AdGuard, Pi-hole, Plex, Jellyfin, Sonarr, Radarr, Grafana, Portainer, and more
4. Click a preset, enter the URL and credentials for your instance
5. Click **Test** to verify the connection works
6. Click **Save** — credentials are encrypted with AES-256-GCM and stored securely

The integration data will appear on the matching service card in the dashboard as Tier 3 metrics.

---

## 9. Step 8: Embed Services as Tabs

One of JagHelm's standout features is the ability to embed your web-based tools as tabs in the navigation bar. Instead of opening Uptime Kuma in a new browser tab, it loads inside JagHelm.

**To add a tab:**

1. Open Settings > **Tabs**
2. Click **Add Tab**
3. Enter a name (e.g. "Uptime Kuma") and the URL (e.g. `http://your-kuma-host:3001`)
4. Save

The new tab appears in the top navigation bar. Click it to load the service inline. Click "Dashboard" to go back.

**Tips for embedded tabs:**

- **Uptime Kuma:** If embedding is blocked, set the environment variable `UPTIME_KUMA_DISABLE_FRAME_SAMEORIGIN=true` on your Kuma container, or add your JagHelm domain to the allowed iframe origins in Kuma's settings.
- **Grafana:** Set `allow_embedding = true` in `grafana.ini` under `[security]`, and set `cookie_samesite = none` if accessing across different hostnames.
- **Proxmox:** Proxmox blocks iframe embedding by default. Use the tab for LAN access where same-origin policies are relaxed, or use Tailscale for consistent access.

---

## 10. Step 9: Customize Your Dashboard

JagHelm is designed to be customized entirely from the UI. Here's what you can do:

### Rearrange panels
Drag panels by their header to reposition them. Resize from the bottom-right or bottom-left corners. Panels snap to the grid and auto-save their positions.

### Change the theme
Settings > Appearance — choose from 10 developer-inspired themes (6 dark, 4 light).

### Adjust the grid
Settings > Layout > Grid Columns — slide from 6 (compact, fewer wider panels) to 24 (fine grid, more panel placement options).

### Customize service cards
Settings > Layout > Service Cards — toggle Docker metrics (CPU/MEM/RX/TX) and app integration data on or off. Choose between dot, badge, or minimal status indicators.

### Rename nodes and services
Settings > Nodes — change display names, subtitles, icons, and colors for each node.
Settings > Services — rename individual containers and assign custom icons.

### Set up Quick Launch bookmarks
Settings > Links — add bookmarks to your most-used services, organized into groups.

### Password protection
Settings > Security — change your dashboard password. Your original `.env` password is overridden by the new one, which is stored with strong scrypt hashing.

---

## 11. Troubleshooting

### Dashboard shows no nodes

**Check Prometheus connectivity:**
```bash
# From the machine running JagHelm
curl http://your-prometheus:9090/api/v1/query?query=up
```
If this fails, Prometheus isn't reachable. Check firewall rules and the `PROMETHEUS_URL` in your `.env`.

**Check Prometheus has node labels:**
```bash
curl 'http://your-prometheus:9090/api/v1/query?query=count%20by%20(node)(up{node!=""})'
```
This should return your node labels. If it returns empty, your `prometheus.yml` scrape configs don't have `node` labels.

### Container stats show 0 or are missing

**Check cAdvisor is running and scraped:**
```bash
curl http://your-server:8080/metrics | head -20
```
If this works but JagHelm doesn't show stats, verify cAdvisor has the same `node` label in `prometheus.yml` as the corresponding node_exporter.

### Uptime Kuma monitors not matching

JagHelm matches Kuma monitors to containers by checking if the monitor name contains the container name (case-insensitive). If your container is named `gateway-npm` and your Kuma monitor is named "NPM Proxy", they won't auto-match.

**Fix:** Go to Settings > Services, find the container, and select the correct Kuma monitor from the dropdown.

### Embedded tab shows "Embedding Blocked"

The service is sending `X-Frame-Options` or `Content-Security-Policy` headers that prevent iframe embedding. Each service has its own setting to allow this — see the tips in [Step 8](#9-step-8-embed-services-as-tabs).

### JagHelm container won't start

Check logs:
```bash
docker logs jaghelm
```

Common issues:
- `DASH_SECRET` not set — required for the secrets manager. Generate one with `openssl rand -hex 32`.
- Prometheus URL wrong — JagHelm logs the URL it's trying to connect to on startup.

### Updating JagHelm

To pull the latest image:

```bash
# Run on the machine hosting JagHelm
cd /opt/stacks/jaghelm
docker compose pull
docker compose up -d
```

To pin to a specific version, update the `image:` tag in your `compose.yaml` to a version from the [GitHub Releases](https://github.com/jagbhandal/jaghelm/releases) page and re-run `docker compose up -d`.

---

## 12. Architecture Overview

```
┌──────────────────────────────────────────────┐
│               Your Browser                    │
│                                              │
│  Dashboard  │  Uptime Kuma  │  Grafana  │ ...│
│  (HelmGrid) │  (iframe tab) │(iframe tab)│   │
└──────────────────────┬───────────────────────┘
                       │
            ┌──────────▼──────────┐
            │   JagHelm Server    │
            │   (Express + API)   │
            │                     │
            │  Discovery Engine   │
            │  Integration Engine │
            │  Secrets Manager    │
            └──┬──────┬──────┬───┘
               │      │      │
         ┌─────▼┐ ┌───▼───┐ ┌▼─────────┐
         │Prom. │ │ Kuma  │ │ App APIs  │
         │+node │ │       │ │ AdGuard   │
         │+cAdv.│ │       │ │ NPM, etc. │
         │+NUT  │ │       │ │           │
         └──────┘ └───────┘ └───────────┘
```

For detailed architecture documentation, see [ARCHITECTURE.md](ARCHITECTURE.md).

---

<p align="center">
  <sub>Built with ☕ and late nights for the self-hosted community.</sub>
</p>
