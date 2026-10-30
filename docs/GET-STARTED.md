# JagHelm — Getting Started Guide

A complete walkthrough for setting up JagHelm to monitor your homelab infrastructure. By the end of this guide, you'll have a live dashboard showing real-time metrics for all your nodes and containers.

**Just one machine, and new to this?** The [README's 5-step install](../README.md#install-in-5-steps) starts JagHelm, Prometheus, node_exporter and cAdvisor together from one file, with no `localhost` pitfalls. This guide is for the longer road: several machines, a Prometheus you already run, Uptime Kuma, a UPS and embedded apps.

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
- At least one Linux machine running Docker (this is the machine you want to monitor). On Windows or macOS, node_exporter and cAdvisor would report Docker's hidden virtual machine, not your computer
- Docker and Docker Compose installed
- 5 minutes for a basic setup, 30 minutes for the full experience

**Optional (but recommended):**
- [Uptime Kuma](https://github.com/louislam/uptime-kuma) — adds health monitoring and ping latency to each service on the Overview
- A UPS with NUT (Network UPS Tools) — for power monitoring on the dashboard

**Every Prometheus scrape target needs a `node: <name>` label.** JagHelm finds your machines by it; without it the Overview stays on "Waiting for your first node".

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
    network_mode: host   # so 'localhost:9100' below is this machine; serves port 9090 on it
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus_data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.retention.time=30d'

volumes:
  prometheus_data:
```

`network_mode: host` matters. On Docker's default bridge network, `localhost` inside the Prometheus container is the container itself, so every target below would show as DOWN. With host mode Prometheus shares the machine's network, which is where node_exporter (also `--net host`), cAdvisor and the NUT exporter publish their ports. Prometheus then answers on port 9090 of the machine without a `ports:` line.

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

**Replace the placeholder values above with your actual IPs/hostnames and a real secret.** JagHelm refuses the example `DASH_SECRET` (and every other example in these docs) as a key: it stores no credential until it has one from `openssl rand -hex 32`.

Create `compose.yaml`:

```yaml
services:
  jaghelm:
    image: ghcr.io/jagbhandal/jaghelm:1.2.0
    container_name: jaghelm
    restart: unless-stopped
    ports:
      - "3099:3099"
    env_file:
      - .env
    environment:
      - NODE_ENV=production
    volumes:
      - ./data:/app/data
      - ./uploads:/app/uploads
    # Hardening: a read-only image, an unprivileged user, no capabilities.
    read_only: true
    tmpfs:
      - /tmp:rw,noexec,nosuid,size=64m
    user: "1000:1000"
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    mem_limit: 512m
    pids_limit: 256
```

This matches the `compose.yaml` in the repo: a bridge network that publishes
port 3099, so the container stays off the host's network. JagHelm runs as UID
1000 on a read-only image, so `data/` and `uploads/` are the only places it
writes, and they must be writable by that user. Create them before the first
start (Docker would otherwise create them owned by root):

```bash
mkdir -p data uploads && sudo chown 1000:1000 data uploads
```

**Switch to host networking** only if JagHelm can't reach something from the
bridge: an exporter bound to a host-only interface, or anything found by mDNS.
Replace the `ports:` block with `network_mode: host`. Host mode drops the
network isolation and ignores `ports:`; JagHelm then binds 3099 on the host
directly.

Pull and start:

```bash
docker compose up -d
```

Docker will pull the image from GHCR automatically on first run. No cloning or building required.

The `:1.2.0` above is a release: it never changes. `:latest` follows the most recent build of `main`, which is a build, not a release. To move to a newer release, change the tag:

```yaml
    image: ghcr.io/jagbhandal/jaghelm:X.Y.Z   # a version from the Releases page
```

Releases and their notes are listed on the [GitHub Releases](https://github.com/jagbhandal/jaghelm/releases) page, and the history is in [`CHANGELOG.md`](../CHANGELOG.md), with the pre-1.0 numbering archived in [`docs/history`](history/CHANGELOG-pre-1.0.md). A version tag points to the exact image built from `main` for that release and never moves. Every build of `main` is also published as `:sha-<short>` (the first seven characters of the commit); sha tags are per-build and normally stable.

---

## 5. Step 4: First Boot — What to Expect

Open `http://your-server:3099` in a browser.

**If you set a password:** You'll see a login page. Enter the username and password from your `.env` file.

**A guided setup opens first.** On a new install the Overview's address
shows a short setup instead: it checks that Prometheus answers, lists the
nodes JagHelm found so you can name them or switch some off, shows whether
Uptime Kuma and your UPS are connected, and offers Integrations. Each step is
Settings' own page, every step can be passed over, and **Skip setup** ends it.
It shows once per install, for every device; to do any of it later, use
Settings. The addresses of Prometheus, Kuma and the UPS are the `.env` values
from the steps above, which the app can't change: a step that can't reach one
tells you which variable to set. Nothing in JagHelm is pre-filled with
anyone's names, places or hosts; a new install's temperatures start in °C (an upgraded one keeps its unit) and dates in your
browser's format (Settings → Appearance → Units and Dates and times).

**On first load, JagHelm will:**

1. Connect to Prometheus and discover all nodes with a `node` label
2. Auto-generate a `data/services.yaml` config with your discovered nodes. If
   Prometheus isn't reachable yet, or hasn't scraped a node yet, it saves
   nothing and asks again every refresh: the nodes appear on their own once
   Prometheus has them
3. Query cAdvisor for containers on each node
4. Display everything in the dashboard

You should see a card for each node in the Overview's Infrastructure section, with its CPU, memory, disk and uptime, and a row for each Docker container in its Services section.

**If the Overview has no nodes, or they have no readings:**
- "Waiting for your first node" means discovery is still asking Prometheus.
  Save nothing in Settings → Integrations until the nodes appear: a save
  writes `data/services.yaml`, and discovery doesn't run once that file exists
- Check that Prometheus is reachable from the JagHelm container
- Verify Prometheus targets are "UP" at `http://your-prometheus:9090/targets`
- Check JagHelm logs: `docker logs jaghelm`

---

## 6. Step 5: Add Uptime Kuma (Optional)

Uptime Kuma adds health status (up/down) and ping latency to each service in the Overview's Services section. Without it, JagHelm still works: the section lists each running container, without health monitoring.

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

Then set up monitors in Uptime Kuma for each service you want to track. JagHelm auto-matches Kuma monitors to containers by name — if your container is called `gitea` and your Kuma monitor is called "Gitea", they'll match automatically. Each monitor goes to one container, the best match: "Gitea" goes to `gitea`, not to `gitea-runner` as well.

When a name doesn't match, or the same container runs on two machines, map the monitor yourself under `services:` in `data/services.yaml`, keyed by container name:

```yaml
services:
  immich-server:
    monitor: Immich              # this monitor, on every machine the container runs on
  gateway-npm:
    monitor_per_node:            # a different monitor on each machine
      pi1: NPM Pi Primary        # keys are the node keys under `nodes:`
      pi2: NPM Pi Secondary
  vaultwarden:
    monitor_per_node:
      vm103: Vaultwarden         # only vm103's copy gets the monitor; the replica gets none
  gateway-tunnel:
    monitor: false               # no monitor, and no matching by name
```

- `monitor` is the monitor's name as Uptime Kuma shows it (any case). Settings > Nodes & Services > Services sets it from a dropdown.
- `monitor_per_node` maps a node key to a monitor name, and wins over `monitor` on that node. A node with no entry there uses `monitor`, or matching by name when `monitor` isn't set either. Edit it in the file; Settings keeps it when it saves.
- `false` (in either) means no monitor at all: the card shows its Docker status, and no monitor is matched to it by name.
- A monitor named in any mapping goes only to the containers mapped to it, even while they're stopped, so a container with a similar name never takes it.

A Kuma monitor that no container carries (a `cadvisor-pi1` monitor whose container the board hides) is shown on the node its address or name points to, else on the first node. Pick the node in Settings > Nodes & Services (the row says "monitor only"), or in the file:

```yaml
monitor_nodes:
  cadvisor-pi1: pi1              # monitor name (any case) to a node key under `nodes:`
nodes:
  pi1:
    address: 192.168.68.13       # optional: a monitor that checks this host is shown here
```

The entry is keyed by the monitor's name: rename the monitor in Uptime Kuma and its entry stops applying (JagHelm's log warns once); change the key to match. Its display name and icon are kept under the same name in `services:`, wherever the monitor is shown.

Make sure `KUMA_URL` in your JagHelm `.env` file points to your Uptime Kuma instance, then recreate JagHelm so it reads the file again (`docker compose restart` does not):

```bash
docker compose up -d
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

Restart Prometheus, and the UPS will appear in the Overview's Power section automatically, whatever the UPS is called in NUT (`ups.conf`). With several UPSes it shows the first by name that has a reading; set `JAGHELM_UPS_NAME` in JagHelm's `.env` to the name of the one you want.

---

## 8. Step 7: Configure Integrations

JagHelm can pull data from your self-hosted apps and show it beside each service on the Overview. For example, AdGuard Home's DNS queries, NPM's proxy hosts, Gitea's recent commits.

**From the Settings UI:**

1. Click the gear icon to open Settings
2. Go to **Integrations**
3. Browse the preset gallery — AdGuard, Pi-hole, Plex, Jellyfin, Sonarr, Radarr, Grafana, Portainer, and dozens more
4. Click a preset, enter the URL and credentials for your instance
5. Click **Test** to verify the connection works
6. Click **Save** — credentials are encrypted with AES-256-GCM and stored securely

The integration's first number appears beside the matching service in the Overview's Services section, while the service is up.

---

## 9. Step 8: Embed Services as Tabs

One of JagHelm's standout features is the ability to embed your web-based tools as apps inside JagHelm. Instead of opening Uptime Kuma in a new browser tab, it loads inside JagHelm, under the status header.

**To add a tab:**

1. Open Settings > **Apps & links** (or **Add app** in the sidebar)
2. Click **Add app**
3. Enter a name (e.g. "Uptime Kuma") and the URL (e.g. `http://your-kuma-host:3001`), and an icon if you like
4. Click **Check embedding and add**. JagHelm says whether the app lets itself be shown inside another site before it saves; if it doesn't, add it to open in a new browser tab instead

Drag an app by its grip, or use its up and down buttons, to set its order in the sidebar.

The new app appears in the sidebar's **Apps** group (under **More** on a phone) and in the command palette ("Open Uptime Kuma"), and has its own address (`/apps/<id>`). Click it to load the service inline; click **Overview** to go back. The app stays loaded while you are elsewhere, so it is where you left it when you come back: a dot beside it says so, and **Unload** (on the entry, under the pointer) frees it. At most five stay loaded at once; opening a sixth unloads the one you used least recently. The bar over an open app shows its address, with **Reload** (that app only) and **Open in new tab**.

If the service hasn't loaded after 8 seconds, the tab says it is slow to load and offers Retry; the service keeps loading and shows as soon as it is ready. If its server refuses to be shown inside another site, the tab says it won't open inside JagHelm and offers "Open in new tab" and "How to allow embedding". JagHelm's server finds that out by reading the service's headers, so it has to be able to reach the service's URL; when it can't, the tab shows whatever the browser shows.

**Tips for embedded tabs:**

- **Uptime Kuma:** If embedding is blocked, set the environment variable `UPTIME_KUMA_DISABLE_FRAME_SAMEORIGIN=true` on your Kuma container, or add your JagHelm domain to the allowed iframe origins in Kuma's settings.
- **Grafana:** Set `allow_embedding = true` in `grafana.ini` under `[security]`, and set `cookie_samesite = none` if accessing across different hostnames.
- **Proxmox:** Proxmox VE's web UI sends no `X-Frame-Options` or `frame-ancestors` header (checked on Proxmox VE 9.2), so its headers don't stop it opening inside JagHelm, and being on the LAN or on Tailscale makes no difference to that. Two other things can: its own certificate on `https://your-proxmox:8006`, which a browser won't let you accept inside a frame (use an address behind your reverse proxy with a trusted certificate, or open the address in a normal tab and accept the certificate there first), and its sign-in cookie, which a browser that blocks third-party cookies drops when Proxmox and JagHelm are on different sites (give both addresses under the same domain, such as `proxmox.example.com` and `jaghelm.example.com`). If your reverse proxy adds `X-Frame-Options`, the tab says so.

---

## 10. Step 9: Customize Your Dashboard

JagHelm is designed to be customized entirely from the UI. Here's what you can do:

### Show or hide the Overview's sections
Settings > Appearance > Overview sections: the subsystem strip, Infrastructure, Power, Jobs, Services and the utilities rail each have a switch. The Overview reflows with its content. To reorder the sections, pin services or make custom groups, use **Edit layout** in the header.

### Change the theme
Settings > Appearance — dark, light, or System to follow your device as it switches; the header's sun and moon button flips between dark and light.

### Group your services
The Overview's Services section groups services by node. Its Node / Group switch groups them by your custom groups instead (add one in Settings > Nodes & Services > Custom groups; until then Group is greyed out); JagHelm remembers the choice in this browser. A group lists each service by name and node, so the same container on two nodes (AdGuard Home on two Pis) is two services you group apart, and a Kuma monitor with no container can be grouped too.

### Rename nodes and services
Settings > Nodes & Services > Nodes — change each node's display name, subtitle (its role) and colour.
Settings > Nodes & Services > Services — rename individual containers and assign custom icons.

### Set up Quick Launch bookmarks
Settings > Apps & links > Quick Launch links — add bookmarks to your most-used services, organized into groups.

### Alerts on your phone (Web Push)
JagHelm can send its alerts to the installed dashboard itself, with the screen off. The server makes its own key pair the first time it starts (kept in `data/vapid-keys.json`, readable by JagHelm only: back it up with the rest of `data/`), so there is nothing to install or paste; it takes one tap per phone.

1. On the phone, open JagHelm at its **https** address (on iPhone or iPad, first Share, then Add to Home Screen, and open it from there; iOS 16.4 or later; on Android install it from the browser menu).
2. Settings > Notifications > **Enable alerts on this device**, allow notifications when the browser asks, then **Send test alert**.

Optional: to use a key pair you made yourself (for example one shared with another install), run `node scripts/vapid-keys.mjs mailto:you@example.com` from a checkout of the repository (the Docker image does not carry it), paste its `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` lines into `.env` and run `docker compose up -d` again. Keys in `.env` always win over the stored pair, and one without the other leaves Web Push off. The private key is a secret: never in chat, a ticket or git.

Settings says what is missing if a step is not done (the server's key pair unusable, notifications blocked in the browser, not installed, not https). A different key pair later (or deleting `vapid-keys.json`) means every phone turns alerts on again. If `vapid-keys.json` gets damaged while phones are registered, JagHelm leaves alerts off and says so in Settings rather than make a new pair: restore the file from a backup, or remove it and turn alerts on again on each phone.

If JagHelm is behind Cloudflare Access and its session ends, the page says "Sign in again" with a Reload instead of staying blank.

### Password protection
Settings > System > Password and sessions — change your dashboard password. Your original `.env` password is overridden by the new one, which is stored with strong scrypt hashing.

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

JagHelm matches Kuma monitors to containers by name, ignoring case and punctuation: the same name first, then a monitor named after a hostname whose first part is the container name (`grafana.example.com`), then one name containing the other, then a shared word of 4 letters or more. Each monitor goes to one container, the best match; when the same container runs on two machines, or a stack's containers all contain the monitor's name (`immich-server`, `immich-redis`, …), only one of them gets it. If your container is named `gateway-npm` and your Kuma monitor is named "NPM Proxy", they won't auto-match.

**Fix:** Go to Settings > Nodes & Services > Services, find the container, and select the correct Kuma monitor from the dropdown. That sets `monitor:`, which applies on every machine the container runs on; for a different monitor on each machine, use `monitor_per_node:` in `services.yaml`, and to keep a container off monitors altogether, `monitor: false` (see [Step 5](#6-step-5-add-uptime-kuma-optional)). A monitor you map goes only to the containers mapped to it. If the mapped monitor is renamed, deleted or paused in Kuma, the container shows no monitor and JagHelm's log warns about the mapping once; pick the monitor again, or resume it.

### Embedded tab says the service "won't open inside JagHelm"

The service is sending `X-Frame-Options` or `Content-Security-Policy` headers that prevent iframe embedding; "How to allow embedding" names the one it sends. Allow JagHelm's address with `Content-Security-Policy: frame-ancestors 'self' https://your-jaghelm-address` in the service or in the reverse proxy in front of it (browsers then ignore `X-Frame-Options`), or add the address to the service's own `frame-ancestors` list if it sends one. Each service has its own setting for this — see the tips in [Step 8](#9-step-8-embed-services-as-tabs). Then click "Check again".

### Embedded tab says the service "is slow to load"

The service hasn't finished loading after 8 seconds. That is not a block: it keeps loading and shows when it is ready. Retry reloads that tab only.

### JagHelm container won't start

Check logs:
```bash
docker logs jaghelm
```

Common issues:
- `DASH_SECRET` not set, or still an example from these docs — required for the secrets manager. Generate one with `openssl rand -hex 32`, set it in `.env` and restart; if JagHelm ran on an example before, enter each stored credential again in Settings → Integrations, as the log line says.
- "JagHelm cannot start: a folder it needs to write to is not usable" — the `data` or `uploads` folder is missing or owned by root. The message gives the fix; see [DATA-DIR.md](DATA-DIR.md).
- Prometheus URL wrong — JagHelm logs the URL it's trying to connect to on startup, or that Prometheus is not set when `PROMETHEUS_URL` is missing. Inside a container `localhost` is the container itself: use the machine's LAN address or a service name.

### Updating JagHelm

To pull the latest image:

```bash
# Run on the machine hosting JagHelm
cd /opt/stacks/jaghelm
docker compose pull
docker compose up -d
```

To pin to a specific version, update the `image:` tag in your `compose.yaml` to a version from the [GitHub Releases](https://github.com/jagbhandal/jaghelm/releases) page and re-run `docker compose up -d`. Read the release notes before upgrading: a "Breaking changes" section lists the steps an upgrade needs.

---

## 12. Architecture Overview

```
┌──────────────────────────────────────────────┐
│               Your Browser                    │
│                                              │
│  Overview   │  Uptime Kuma  │  Grafana  │ ...│
│             │  (iframe tab) │(iframe tab)│   │
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
