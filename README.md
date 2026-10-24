<p align="center">
  <img src="public/logo-login.svg" height="140" alt="JagHelm">
</p>
<h1 align="center">JagHelm</h1>
 
<p align="center">
  <b>Live data, not just links.</b><br>
  A self-hosted homelab dashboard that reads real Prometheus &amp; cAdvisor metrics,
  service health, and<br>35+ app integrations that call your services — problems first, then everything else.
</p>
<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License">
  <img src="https://img.shields.io/badge/node-26-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node">
  <img src="https://img.shields.io/badge/react-19-61dafb?style=flat-square&logo=react&logoColor=white" alt="React">
  <img src="https://img.shields.io/badge/docker-ready-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker">
  <img src="https://img.shields.io/badge/ghcr.io-jagbhandal%2Fjaghelm-blue?style=flat-square&logo=github" alt="GHCR">
</p>
<p align="center">
  <img src="docs/images/dashboard.jpg" alt="JagHelm's Overview on the demo: a service down and a failed backup first, then the subsystem strip, the nodes and the UPS, beside Quick Launch and Pipeline with its CI results">
</p>

## Try it in 10 seconds — no Prometheus needed

JagHelm ships a **self-contained read-only demo**: a made-up three-node
homelab with one service down, every write refused, no backend, no config, and
no request out from the server (your browser loads the board's icons from the
icon CDN). Kick the tyres before wiring up your stack:

```bash
docker run --rm -e DEMO_MODE=true -p 3099:3099 ghcr.io/jagbhandal/jaghelm:latest
```

Then open **http://localhost:3099**, click a tile of the strip to filter, open a node, flip a theme. Add
`-e DEMO_SCENARIO=healthy` for the same board with nothing down
([more](docs/DEMO.md)). Like it? **⭐ Star the repo** and
[point it at your real stack](#quick-start).

> Built in the open · MIT · signed container images · 1,000+ automated tests · 0 direct-dependency vulnerabilities.

## Why JagHelm

Most self-hosted dashboards are **link launchers** — a grid of bookmarks with a
status dot. JagHelm starts from the other end: it pulls **live numbers** off your
existing monitoring stack and the apps themselves, and leads with what is wrong.

- **Real metrics, not pings.** CPU, RAM, disk, temperature and uptime per node
  come straight from Prometheus + node_exporter; per-container CPU/MEM/network
  comes from cAdvisor. These are the same time-series your Grafana reads — not a
  reachability check.
- **35+ integrations that call your services.** AdGuard queries blocked, Sonarr
  queue, Proxmox node load, NPM proxy count, and dozens more — each preset knows the
  endpoint, auth shape, and formatting, so a card shows the actual number, not a
  link to go find it.
- **Problems first.** The Overview says in one look whether anything is wrong,
  what and where, then lists the nodes, the UPS, the jobs and the services; it
  reflows with its content at any width, nothing clipped. Arranging it
  yourself comes back as an Edit layout mode.

### JagHelm vs Homepage vs Dashy

A rough comparison of where JagHelm sits. Homepage and Dashy are excellent, more
mature projects with bigger communities — if JagHelm doesn't fit, one of them
probably will. The point of this table is *positioning*, not a scoreboard.

| | **JagHelm** | **Homepage** | **Dashy** |
|---|---|---|---|
| Primary model | Live infra **metrics** + integrations | Links + widgets | Links + status |
| Node metrics (CPU/RAM/disk/temp) | ✅ via Prometheus + node_exporter | Partial (widgets) | ❌ |
| Per-container stats (cAdvisor) | ✅ | ❌ | ❌ |
| App integrations | 35+ presets + custom builder | Many widgets | Status checks + some widgets |
| Layout | Problems first, reflowing sections | Config-defined columns | Config-defined sections |
| Config | UI **and** YAML/JSON on disk | YAML files | YAML / UI editor |
| Auth | Single-user (built-in or proxy) | Proxy-oriented | Multiple options |
| Maturity | Single-maintainer hobby project | Large, mature | Large, mature |

JagHelm's trade-off is explicit: it leans on a **Prometheus** stack you already
run (a real dependency, see [`KNOWN-ISSUES.md`](KNOWN-ISSUES.md)) in exchange for
genuinely live data rather than bookmarks.

## What it is
 
JagHelm is a single-page dashboard you point at your homelab. It reads metrics from Prometheus, container stats from cAdvisor, and health checks from Uptime Kuma, then shows them problems first: what is wrong, then the nodes, the UPS, the jobs and the services. Settings live in the UI — themes, sections, integrations, secrets — backed by YAML on disk so nothing gets lost on a container rebuild.
 
It started as a personal project and is shared in the hope that other homelab folks will find it useful. The core flow: install once, point at your existing monitoring stack, glance at it when something might be wrong, walk away.

There's also a **native Android app** (Capacitor): the same board on your phone over your tailnet, plus push notifications the moment a service, host, UPS, or cron job changes state — so you hear about an outage without a tab open.
 
## What it isn't
 
- **Not a bookmark launcher.** There is a Quick Launch section, but the focus is live data, not links.
- **Not a monitoring backend.** Prometheus and Uptime Kuma do that work; JagHelm visualises what they collect.
- **Not multi-tenant.** Single-user authentication, single-user config. Designed for an individual homelab, not a team.
## Quick start
 
For a longer walkthrough — including standing up Prometheus and cAdvisor if you don't already run them — see [`docs/GET-STARTED.md`](docs/GET-STARTED.md).
 
### Requirements
 
- Docker + docker compose
- Prometheus reachable on the network, with `node_exporter` on each node you want to monitor. JagHelm calls its query API (`/api/v1/query`), its health check (`/-/healthy`, for `/api/readyz`) and, when a node has no `up` series or its `up` is 0, its target list (`/api/v1/targets`); a proxy in front of Prometheus must allow all three. It also asks when Prometheus started (`/api/v1/status/runtimeinfo`) before a target that never got its first scrape counts as stuck; that one is optional
  - **Direct scrape** (supported, recommended): Prometheus, or VictoriaMetrics/vmagent scraping with `promscrape`, scrapes each node's `node_exporter` (and cAdvisor) with a `node` label on the target, and lists those targets. JagHelm reads the target list to tell a node not scraped yet ("No signal") from one that's down ("Host unreachable"). A target still waiting for its first scrape after 3 of its scrape intervals shows as Prometheus failing, naming the target, with one "Monitoring source down" alert.
  - **Federation or remote write** (Thanos, Mimir, a federating Prometheus, or VictoriaMetrics fed only by remote write; supported): the series need the same `node` label. These backends list no scrape target per node, so when a node's `up` series is missing JagHelm can't tell the host from the pipeline: that reads as Prometheus failing (one "Monitoring source down" alert), never as each host unreachable. A host whose `up` reads 0 still alerts as unreachable.
- (Optional but recommended) `cAdvisor` for container-level CPU/RAM/network stats
- (Optional) Uptime Kuma for service health
- (Optional) NUT exporter if you want the UPS on the Overview
### 1. Create `.env`
 
```bash
mkdir -p /opt/stacks/jaghelm && cd /opt/stacks/jaghelm
```
 
```env
# ── JagHelm Configuration ──
# Required: where to read metrics from
PROMETHEUS_URL=http://your-prometheus:9090
KUMA_URL=http://your-kuma:3001

# Optional: Uptime Kuma API key — reads all monitors + uptime from Kuma's
# authenticated /metrics endpoint (needs Kuma >= 2.1.0). Blank = public status page.
KUMA_API_KEY=
 
# Required: encryption key for stored credentials
# Generate once: openssl rand -hex 32
DASH_SECRET=replace-with-output-of-openssl-rand-hex-32
 
# Optional: leave DASH_PASS empty to disable login entirely
DASH_USER=admin
DASH_PASS=
 
# Optional: reverse proxy IPs to trust X-Forwarded-For from
# Comma-separated. Leave blank if exposing JagHelm directly.
TRUST_PROXY=

# Optional: networks that never wait on the shared sign-in budget during an
# attack, such as your LAN and tailnet: 192.168.68.0/22,100.64.0.0/10
LOGIN_TRUSTED_NETS=
 
# Optional: shared secret for cron-job report endpoint
# Generate once: openssl rand -hex 32
JAGHELM_CRON_SECRET=
```

Replace the `DASH_SECRET` example with the output of `openssl rand -hex 32` before the first start. JagHelm refuses every example value in these docs as a key: it stores no credential and logs what to do until it has a real one.

Keep user names, passwords and keys out of `PROMETHEUS_URL`, `KUMA_URL`, `JAGHELM_GITEA_URL` and every integration's URL variable (`JAGHELM_NTFY_URL`, `JAGHELM_ADGUARD_URL` and the rest). One that carries a credential (`http://user:pass@host`, however written) is refused: JagHelm never requests or logs it, and the board, `/api/health` or the integration's error name the variable, never its value. Kuma's key goes in `KUMA_API_KEY` and Gitea's token in `JAGHELM_GITEA_TOKEN`; JagHelm can't log in to Prometheus. Node refused such a URL already, so no working setup changes, unless a path held a raw `@` after a port (write it `%40`).

### 2. Create `compose.yaml`
 
```yaml
services:
  jaghelm:
    image: ghcr.io/jagbhandal/jaghelm:latest
    container_name: jaghelm
    restart: unless-stopped
    ports:
      - "3099:3099"
    env_file:
      - .env
    environment:
      - NODE_ENV=production
    volumes:
      - ./data:/app/data        # config + encrypted secrets
      - ./uploads:/app/uploads  # logo + background images
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
 
### 3. Pull and start
 
```bash
docker compose up -d
```
 
Open `http://your-host:3099`. On first boot JagHelm discovers the nodes Prometheus has, saves them to `services.yaml` and shows them on the Overview; until it has one, the Overview says it is waiting for your first node. If Prometheus isn't reachable yet, or hasn't scraped a node yet, it saves nothing and asks again every refresh: the nodes appear as soon as Prometheus has them, with no restart. Once `services.yaml` is there (a save in Settings writes it too), its nodes are yours and discovery doesn't run again. Settings → Integrations to wire up app-specific cards.
 
## Configuration
 
Most things are configurable from the Settings UI: an index of seven sections (Sources, Nodes & Services, Integrations, Apps & links, Notifications, Appearance and System), each a card saying what it holds, with a search that finds a setting by name ("font" finds Appearance, and opens it at its fonts), or by the name of a tab Settings had before ("widgets", "security"). The command palette finds them the same way. For people who prefer files, everything is on disk too, in `data/` (or the directory `JAGHELM_DATA_DIR` names). Set `JAGHELM_DATA_DIR` like any other variable: in Docker, `environment:` or `env_file`; running `npm start`, the `.env` in its working directory, which it reads before anything else, or the process environment, which wins over `.env`.
 
```
data/
├── services.yaml          # nodes, services, integrations
├── display-config.json    # theme, layout, sections, links, backup jobs
├── secrets.json           # AES-256-GCM encrypted credentials
├── config-version.key     # key for the versions of services.yaml and display-config.json, which a save checks (made on first start; if lost, a new one is made)
├── auth.json              # password hash (if changed via UI)
├── sessions.json          # signed-in sessions: a SHA-256 of each session token, never the token
├── known-addresses.json   # the 16 addresses signed in from last, which skip the sign-in budget during an attack
├── cron-jobs.json         # cron job execution history
├── todos.json             # checklist data
├── icon-index.json        # icon picker's names-only index (a cache; safe to delete)
└── icon-cache/            # CDN icons served locally after the first load (a cache, at most 50 MB; safe to delete)
```

A sign-in survives restarts and updates. It ends after 30 days without use, and 90 days after sign-in in any case. Logging out ends that session; changing the password in Settings ends every other one. Changing `DASH_PASS`, `DASH_USER` or `DASH_SECRET`, or removing `auth.json`, signs every device out at the next start. To sign every device out without changing the password, stop JagHelm, delete `data/sessions.json` and start it again.

Failed sign-ins slow down the address they come from: after 5 in a row it waits 30 s, doubling with each further failure up to 15 minutes, and a sign-in clears it. Guesses from many addresses at once share one budget, at most 130 an hour, and during such an attack a brand-new address can be kept waiting for as long as it lasts. The 16 addresses you signed in from most recently (kept across restarts) and those in `LOGIN_TRUSTED_NETS` skip that budget, so list your LAN and tailnet there. The sign-in form says how long to wait. A restart clears your own address's wait, not an attack: it refills the budget for the attackers. Behind a reverse proxy, set `TRUST_PROXY`, or every client shares the proxy's address and anyone can claim a trusted one. Details in [KNOWN-ISSUES.md](KNOWN-ISSUES.md).
 
`services.yaml` is hot-reloaded — edit it on disk and JagHelm picks up the change without restarting. A save that leaves it unreadable or empty for a moment keeps the last good config, and JagHelm never overwrites a file it can't read: until it is fixed, Settings says which line doesn't parse and refuses every save. A save in Settings changes only the lines of what it changed: the file's comments, blank lines and quoting stay, with the spacing evened out (two-space indents, one space before a comment at the end of a line, `[a, b]` for a flow list), and a list it changes is written anew, without the comments between its items. A key it removes takes the comment right above it; a heading a blank line above stays. A file with YAML anchors, aliases or merge keys (`&`, `*`, `<<`), or a value JagHelm's two YAML readers read differently (an unquoted date), is still rewritten whole in JagHelm's own layout, without its comments, and the log says so. The credentials in it never reach the browser: Settings reads a password or token (plain text or a `$secret:` reference), a value under another credential's name (`apikey`, `secret`, `cookie` and the like), a header value under `extraHeaders`, a session's `loginBody`, an endpoint with a key in its query string, and a value an endpoint fills in through a `{name}` placeholder only as `{ "$stored": true }`, and a save in Settings keeps each stored one. So is an integration's URL that carries a key or password (see the integrations section below).
 
### Environment variables
 
The `.env` example above covers the required + commonly used vars. JagHelm checks the whole environment once at start: a value that doesn't fit its variable (`LOG_LEVEL=loud`, `CSP_REPORT_ONLY=yes`) is warned once in the log, naming the variable and the default used instead, never its value. The defaults are the safe side (the CSP enforced, the secrets API closed, no demo). Only a `PORT` that isn't a port number or a `JAGHELM_BLOCK_PRIVATE_NETWORKS` that isn't true or false stops the start. An empty `NAME=` line counts as unset.

There's also a power-user escape hatch — every preset integration can be configured via env vars instead of the UI ([`env.example`](env.example) lists each preset's):
 
```env
# Prefixed with JAGHELM_ to avoid colliding with service env vars in
# shared Docker networks. UI/yaml config is overridden when set.
JAGHELM_ADGUARD_URL=http://192.168.x.x:8085
JAGHELM_ADGUARD_USER=admin
JAGHELM_ADGUARD_PASS=secret
 
JAGHELM_NPM_URL=http://192.168.x.x:81
```

The Pipeline panel shows recent Gitea commits. For a repo with Gitea Actions, each row is a commit its latest push runs ran on, with the CI result ("CI Passed", "CI Failed", "CI Running" and so on), the branch and the short SHA; pull-request and scheduled runs don't show. A repo without Actions, or with Actions on but no runs yet, shows the latest commits on its default branch, with no CI result. Gitea is read every 5 minutes: one request for the list of repos, then one per repo. A repo with Actions on but no runs takes one more request an hour, when JagHelm checks it for runs again (and once more at the first read after a restart). A failed read is tried again after 30 seconds, then less often, and the panel keeps the last commits for up to 10 minutes after Gitea last answered. The panel reads `JAGHELM_GITEA_URL` and `JAGHELM_GITEA_TOKEN`, which the Gitea preset reads too. With `JAGHELM_GITEA_URL` unset, JagHelm polls no Gitea and the dashboard has no Pipeline panel.

```env
JAGHELM_GITEA_URL=http://192.168.x.x:3000
JAGHELM_GITEA_TOKEN=...
```

Up to 3.0 most of these variables had no prefix (`GITEA_URL`, `GITEA_TOKEN`, `NPM_URL`, `SONARR_API_KEY` and the rest). The old names still work for now; a later release reads only the `JAGHELM_` names. The log warns once at start for each old name set, and when both names are set with different values the `JAGHELM_` one is used. The server's own settings (`PROMETHEUS_URL`, `KUMA_URL`, `DASH_*`, `PORT`, `TRUST_PROXY`, `ARCANE_*` and the rest) keep their names.
 
The server listens on every IPv4 interface (`0.0.0.0`) on `PORT` (default 3099). Set `JAGHELM_HOST` to listen on one address instead, such as `127.0.0.1` for a reverse proxy on the same host with `network_mode: host`. In a bridge-network container keep the default (see `env.example`).

See [`env.example`](env.example) for the full list.
 
### Cron job reporting

Jobs report with `POST /api/cron/report`. `secret` must match `JAGHELM_CRON_SECRET`; `node`, `job` and `status` (`success` or `failure`) are required; `duration_seconds`, `schedule` and `error` are optional. `expected_every_seconds` is also optional: an integer from 60 to 2678400, or a digit string. Anything else returns 400 and the report is rejected.

```json
{ "secret": "...", "node": "nas", "job": "backup", "status": "success", "expected_every_seconds": 86400 }
```

The Overview's Jobs section shows `schedule` in words: words as sent ("every 15 min"), a common cron expression put in words (`30 6 * * *` is "daily at 06:30"; six fields with seconds first too), or, without one, "every 24 h" from `expected_every_seconds`. A job opens its last three runs and Remove. A schedule is in the reporter's clock and run times in the viewer's: when they can differ, put the zone in brackets after the schedule (`0 3 * * * (America/Toronto)`), which is shown as sent ("daily at 03:00 (America/Toronto)"). A `job` or `node` of `.` or `..` is refused (400): a browser can't address it to remove it.

`GET /api/cron/status` reports `overdue` and `seconds_since_report` for every job (`seconds_since_report` is null if a run has no timestamp), and `expected_every_seconds` only for jobs that declared one. A job is overdue when it has not reported within the interval plus `max(25% of the interval, 10 minutes)`. `DELETE /api/cron/jobs/:node/:job` (session auth, URL-encode both segments) removes a job and its history.

#### Marking jobs as backups

A job is a backup only when `backupJobs` in `data/display-config.json` names it, as `"node:job"` (the node and job its reports send):

```json
{ "backupJobs": ["pve:proxmox-backup", "nas:b2-sync"] }
```

A backup shows under Backups instead of Jobs in `/api/status`, and is judged more strictly than a job: a failed last run is critical, overdue a warning (a job is a warning either way). Its push notifications are the job's, except that a failed backup pages as critical (high priority) where a failed job is a warning. Proxmox backup results reported by a PVE notification webhook arrive as a job like any other, so name that job here too. Edit the file (JagHelm reads it again on the next refresh) or save the whole config with `POST /api/display-config`, sending the `ETag` that `GET /api/display-config` answered in an `If-Match` header (a save without it is refused, and one over a changed file is a 409: read again); a Settings page for the list comes later. An entry that isn't a `"node:job"` string is ignored, with one warning in the log.

## Features
 
### Multi-node infrastructure monitoring
 
Real-time CPU, RAM, disk, temperature, and uptime per node, pulled from Prometheus. Nodes auto-discovered from labels on first boot, as soon as Prometheus has some — no manual config for the hosts it already scrapes. A node's card opens its detail: its readings, uptime, memory and disk, and for a Proxmox host with the Proxmox integration set up, its virtual machines, storage pools (coloured by the disk thresholds) and last backup.

The Infrastructure page (`/infrastructure`, in the sidebar) lists every node as cards or a table, with a search (name, key or role) and filters for state and role, and each Proxmox host's virtual machines and storage pools under them. The filters are in the address: Back undoes one, and a link opens the page filtered.
 
### Per-container resource stats
 
CPU, memory, network RX/TX for every Docker container via cAdvisor. The Overview's Services section lists every service in one line each, grouped by node or by your own groups: its state (from Uptime Kuma, or the container), its ping latency, one number from its app integration and, with a Kuma monitor, its last 30 checks as a heartbeat strip (each check's time and latency under the pointer; the detail shows the last 50). The per-container numbers are left off the Overview: a service's row opens its detail, with its container's CPU, memory and network rates and all of its integration's numbers. A detail links to the service, Grafana and Uptime Kuma through your own apps and Quick Launch links of those names.

The Services page (`/services`, in the sidebar) lists every service as that list or as a table, with a search (name, node, custom group or container) and filters for state and node, in the address as on the Infrastructure page. On a phone the same addresses are the Services and Infrastructure tabs, so turning the phone keeps the page and its search.
 
### 35+ integration presets + a custom builder
 
Connect AdGuard, Plex, Sonarr, Proxmox, Cloudflare, Vaultwarden, and dozens more through the Settings → Integrations gallery. Each preset has known endpoints, auth shape, and field formatting baked in. Test Connection checks the form as it would be saved, before anything is: it makes the requests the next refresh would make, with the stored entry's endpoint and fields and a typed password or token in place of the stored one, and shows the error the integration's card would show. A custom integration covers anything not in the gallery: its form takes the URL and a token, and its JSON endpoint, auth mode and the paths to extract are written in its entry in `services.yaml`.
 
Credentials are encrypted with AES-256-GCM (PBKDF2-derived key from `DASH_SECRET`) before being written to `secrets.json`.

A stored password or token goes only to the address it was entered for: the host, port and http or https of the integration's URL. Moving an integration to a new address means typing its credential again; Save and Test refuse a new address with the password or token left blank, and so does a save of the whole config in Settings. An integration whose stored credential isn't for its address (its URL edited in `services.yaml`, or another integration's `$secret:` named in its entry) sends nothing, and its card says to re-enter the credential for this address. At the first start after updating, each stored credential is bound to the addresses of the integrations that use it. Credentials in `.env`, or typed into `services.yaml` by hand, are not bound: they go wherever the URL points. Every request an integration makes stays on its URL's host and port: an endpoint in `services.yaml` that leads elsewhere is not requested, and its card says so.

Credentials go in their own fields, never in the URL, and a field never names a stored secret (a `$secret:` reference is refused unless it is the one already stored there): a user name and password in the Username and Password fields, a key or token in the API Key or API Token field (a custom integration's other credentials go in its entry in `services.yaml`). A URL with a user name or password before the host (`https://user:pass@host`) or a key in its query (`?key=`, `?apikey=`, `?token=` and the like) never worked, and Save and Test refuse one, with a message beside the URL field that says where the credential goes. An integration whose URL in `services.yaml` already carries one is not requested: its card says where to move the credential, and Settings shows the URL empty, to be entered again without it.

Write a password, token or user name in `services.yaml` as it is, not URL-encoded: JagHelm encodes one it fills into a custom endpoint's `{token}`, `{password}` or `{username}`, so a `&`, `#`, `/`, `?`, space or `@` in it arrives intact, and one already encoded by hand would be encoded twice. A stored password or token that can't be read (its secret is gone from `secrets.json`, or won't decrypt after `DASH_SECRET` changed) is never sent empty: the integration sends nothing, and its card says the stored credential couldn't be read and where to enter it again. It backs off like any failed fetch, not as a refused login, and is tried again at the next refresh once the secret is back or the credential is saved again in Settings.

An integration that fails is retried after 30 seconds, then 1, 2, 4 and 8 minutes, then every 10 minutes until it answers, and its card shows the failure meanwhile. One whose login is refused twice in a row (HTTP 401 or 403) is not retried until its settings change, so an app that bans an address after failed logins doesn't ban JagHelm's. Saving it in Settings, changed or not, retries it at the next refresh. So does editing its entry in `services.yaml` (any change counts), and a restart retries every integration.

Saving an integration in Settings changes only what its form shows: the URL, username, target container, password or token (a blank one keeps the stored credential), the preset's URL parameters, the instance name and Enabled. Anything else in its `services.yaml` entry stays as written, such as a custom integration's endpoint, auth and fields, and a save that changes nothing leaves the file untouched. A changed instance name moves the integration to its new name, with its stored password and token. An instance name another integration already uses is refused, with a message beside the Instance Name field that names it, and nothing is changed; so is a new integration added under a name in use. The Enable and Disable buttons change only `enabled`, and a Settings form left open doesn't undo them unless its own Enabled box was changed.
 
### Embedded apps
 
Add your existing monitoring tools as embedded apps — Grafana, Uptime Kuma, Portainer, Proxmox, anything web-accessible. Each has its own entry in the sidebar's Apps group (under More on a phone), its own address, and an "Open" command in the command palette, and opens inside JagHelm under the status header rather than in a new browser tab. Configurable per app from Settings → Apps & links. An app you have opened stays loaded when you switch away, so it is where you left it when you come back; a dot marks it, and Unload frees it. At most five stay loaded at once, the least recently used unloading first. A bar over the open app shows its address, with Reload (that app only) and "Open in new tab". An app that is slow to start says so, with a Retry; one whose server refuses to be shown inside another site says that instead, with "Open in new tab" and how to allow embedding.
 
### The Overview
 
The Overview leads with what is wrong: the issues, worst first, or one quiet line when all is well, and a strip of subsystems (Services, Nodes, Power, Jobs, Backups, Integrations) whose tiles filter the page. Under them, the nodes as cards or a table, the UPS, every scheduled job and backup, and every service in one list, by node or by custom group. Each row, card and issue opens its detail in a panel at the side (a full-screen sheet on a phone): its state, why and since when, its readings, and a link to where it is set up in Settings. Everything JagHelm watches has its own address (`/?entity=services/apps:jellyfin`), so a link, a bookmark or a reload opens the same detail. From 1440px wide, Quick Launch, Pipeline and the Checklist sit beside them; narrower, they are on the Launch page. The sections grow with their content and never clip it, from a phone to a 4K screen; Settings → Appearance can hide any of them. The old drag-and-resize grid went with the redesign, and arranging comes back as an Edit layout mode. A fresh install with no node yet says so where the nodes will be, and how to add one. Below 768px the browser shows the Android app's screens instead, with tabs for Overview, Services, Infrastructure, Alerts and More.

The Alerts page lists what needs attention now, worst first. JagHelm also keeps a history of its alerts for 30 days (up to 1000), with phone notifications set up or not, each with when, what, why and whether it went to your phones; `GET /api/events` serves it, newest first, a page at a time, and the Alerts pages will show it in a later release.
 
### Themes and typography
 
Dark and light themes, or System to follow your device as it switches, with one violet accent; the header's sun and moon button flips between dark and light. Five font family presets for Settings, Manrope and JetBrains Mono by default; one text-size setting for the whole app is coming with the new Settings.
 
### PWA installable
 
`manifest.json` and a service worker make JagHelm installable to a phone or tablet home screen. Useful if you have a wall-mounted dashboard or just want it as a "real app" on mobile.
 
### UPS power monitoring
 
If you run [NUT](https://networkupstools.org/) with the Prometheus exporter, JagHelm shows the UPS in the Overview's Power section: on mains or on battery, its charge, and on battery the minutes left; its row opens the battery percentage, runtime, load and model. It shows the UPS the exporter reports, whatever its name; with several, the first by name that has a reading, unless `JAGHELM_UPS_NAME` names one (its name in NUT's `ups.conf`). The UPS shows once Prometheus has it, and stays, with no signal, while its exporter has been quiet for up to 7 days; without one the Overview has no Power section. The Pipeline panel (recent Gitea commits and their CI results) shows when `JAGHELM_GITEA_URL` is set (see [Environment variables](#environment-variables)), with a banner while Gitea is unreachable.
 
### UI configuration with file escape hatch
 
Settings UI handles the day-to-day work: Sources (whether Prometheus, Uptime Kuma, NUT, Gitea and the cron reporters are answering, why one isn't, and the `.env` variable that sets each; read-only), Nodes & Services (names, monitors, custom groups), Integrations, Apps & links (embedded apps, Quick Launch links, the web search), Notifications (the warning and critical thresholds, what pages your phones, the registered phones and a test push), Appearance (theme, accent, density, font, branding, Overview sections, weather and clock) and System (password, backup, data refresh). An old Settings address, such as a bookmark of `/settings/links`, opens the section that holds it now, at the part that does. For the things you'd rather automate or template, everything lives in YAML/JSON on disk.
 
## Android app

The Android app is a signed APK attached to each Android release. On first launch it asks for your JagHelm server's address (a LAN address, a Tailscale address, or an `https://` domain) and your JagHelm login, and stores them on the device; it is not tied to any particular server.

Push notifications are tied to the Firebase project an APK is built with. The published APK receives notifications only from servers that hold that project's credentials, so against your own server it works as a dashboard without notifications. To get notifications from your own server, build the APK with your own Firebase project: fork the repository, add the signing and Firebase secrets, and tag a release (see [docs/mobile/PUSH-SETUP.md](docs/mobile/PUSH-SETUP.md) and [docs/mobile/KEYSTORE.md](docs/mobile/KEYSTORE.md)). Settings → Notifications lists each phone that registered, with when it last got a push and why its last one failed, and sends a test push to one phone or all of them to prove the whole chain works. The server sends notifications over HTTPS to `oauth2.googleapis.com` and `fcm.googleapis.com`, so a firewall in front of it has to let those two through.

## Architecture
 
```
┌─────────────────────────────────────────────────────┐
│                  Settings UI / Dashboard             │
│   General · Appearance · Layout · Integrations · …   │
└────────────────────────┬────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────┐
│                   Express Server                     │
│                                                      │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────┐  │
│  │ Config   │  │ Discovery │  │ Integration      │  │
│  │ services.│  │ Prometheus│  │ 35+ presets +    │  │
│  │ yaml     │  │ cAdvisor  │  │ custom builder   │  │
│  └──────────┘  │ Kuma      │  │                  │  │
│                └───────────┘  └──────────────────┘  │
│  ┌──────────────────────────────────────────────┐    │
│  │   Secrets (AES-256-GCM via DASH_SECRET)      │    │
│  └──────────────────────────────────────────────┘    │
└────────┬─────────────┬──────────────┬───────────────┘
         │             │              │
   ┌──────────┐  ┌───────────┐  ┌──────────────┐
   │Prometheus│  │Uptime Kuma│  │ App APIs     │
   │+exporters│  │ monitors  │  │ AdGuard, NPM,│
   │          │  │           │  │ Sonarr, …    │
   └──────────┘  └───────────┘  └──────────────┘
```
 
### Stack
 
- **Frontend:** React 19, Vite 8 (Rolldown), react-colorful; for the redesign, Tailwind CSS v4, shadcn/ui on Base UI and Lucide icons in `src/ui/`, shared with the Android app; self-hosted fonts (Manrope by default)
- **Backend:** Express, undici, helmet, multer, js-yaml, yaml, dotenv
- **Container:** Node 26 Alpine, runs as non-root, healthcheck via native fetch
- **Encryption:** AES-256-GCM with PBKDF2 (100k iterations); scrypt for password hashing
- **Monitoring sources:** Prometheus, cAdvisor, node_exporter, NUT exporter, Uptime Kuma
For deeper architecture detail (server module structure, refresh pipeline, integration lifecycle), see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
 
## Releases

Server releases are published as signed container images (`ghcr.io/jagbhandal/jaghelm:<version>`) and Android releases as signed APKs, both on the [GitHub Releases](https://github.com/jagbhandal/jaghelm/releases) page. Release notes come from [CHANGELOG.md](CHANGELOG.md) and [mobile/CHANGELOG.md](mobile/CHANGELOG.md). How releases are cut is described in [docs/RELEASING.md](docs/RELEASING.md).

## Status
 
This is a single-maintainer hobby project, used daily for my own homelab. No SLA, no roadmap commitments. Issues and PRs are welcome but I respond when I have time. Known gaps and intentional deferrals are tracked in [`KNOWN-ISSUES.md`](KNOWN-ISSUES.md).
 
If you're considering using JagHelm in a production-adjacent context — sharing a dashboard with non-technical users, exposing it on the public internet, etc. — read KNOWN-ISSUES first.
 
## Acknowledgments
 
JagHelm leans on a number of well-maintained open-source projects.
 
### Core dependencies
 
| Package | Author(s) | Used for | License |
|---------|-----------|----------|---------|
| [React](https://react.dev) | Meta | UI framework | MIT |
| [Vite](https://vitejs.dev) | Evan You & contributors | Build tool & dev server | MIT |
| [Express](https://expressjs.com) | TJ Holowaychuk & community | API server | MIT |
| [undici](https://github.com/nodejs/undici) | Node.js team | HTTP client + per-request TLS dispatch | MIT |
| [helmet](https://helmetjs.github.io/) | Adam Baldwin et al. | HTTP security headers | MIT |
| [react-colorful](https://github.com/omgovich/react-colorful) | Vlad Shilov | Color picker in settings | MIT |
| [js-yaml](https://github.com/nodeca/js-yaml) | Nodeca | YAML config parsing | MIT |
| [yaml](https://github.com/eemeli/yaml) | Eemeli Aro | Settings saves that keep `services.yaml`'s comments | ISC |
| [multer](https://github.com/expressjs/multer) | Express community | File upload handling | MIT |
| [dotenv](https://github.com/motdotla/dotenv) | Scott Motte | `.env` loading | BSD-2-Clause |
 
### Icons
 
The icon picker searches two community-maintained collections. JagHelm keeps only the icon names; the icons themselves are served unchanged from the jsDelivr CDN (through JagHelm's local icon cache).
 
| Collection | Maintainers | License |
|------------|-------------|---------|
| [Dashboard Icons](https://github.com/homarr-labs/dashboard-icons) | Bjorn Lammers, Meier Lukas, Thomas Camlong and Homarr Labs | [Apache-2.0](https://github.com/homarr-labs/dashboard-icons/blob/main/LICENSE) |
| [selfh.st icons](https://github.com/selfhst/icons) | selfh.st | [CC BY 4.0](https://github.com/selfhst/icons/blob/main/LICENSE) |
 
The selfh.st icons are from [selfh.st/icons](https://selfh.st/icons) by selfh.st, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), and are shown without modification.
 
### Inspiration
 
The self-hosted dashboard space has a lot of good options — [Homepage](https://gethomepage.dev/), [Homarr](https://homarr.dev/), [Glance](https://github.com/glanceapp/glance), [Heimdall](https://heimdall.site/), [Dashy](https://dashy.to/) — and JagHelm took ideas from several of them. If JagHelm doesn't fit your needs, one of those probably will.
 
## License
 
[MIT](LICENSE).

The fonts JagHelm ships are not covered by the MIT licence: each is under the
[SIL Open Font License 1.1](https://openfontlicense.org), and its licence text is
in [`src/fonts/licences/`](src/fonts/licences/), or for the Android app's copies
of Outfit, DM Sans and JetBrains Mono in [`mobile/src/fonts/`](mobile/src/fonts/),
in [`mobile/src/fonts/licences/`](mobile/src/fonts/licences/). They are Manrope,
Plus Jakarta Sans, Montserrat and JetBrains Mono for the redesign, and Inter,
Fira Code, Nunito, Source Code Pro, Rajdhani, Roboto and Roboto Mono for
Settings → Appearance's font presets. All are served by JagHelm itself; nothing is fetched from Google Fonts.
 