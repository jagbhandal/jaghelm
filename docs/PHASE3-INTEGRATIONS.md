# JagHelm Phase 3 — Integration Engine Preset Plan

**Date:** March 22, 2026
**Target:** 40+ presets at launch + Custom Builder for anything else

---

## Auth Types Supported

| Type | How it works | Example apps |
|------|-------------|--------------|
| `none` | No auth needed | Speedtest Tracker, some Prometheus endpoints |
| `basic` | Base64 username:password in Authorization header | AdGuard Home, Nextcloud |
| `bearer` | API key/token in `Authorization: Bearer {token}` | Sonarr, Radarr, Plex, Gitea |
| `header` | API key in custom header (e.g. `X-API-Key`) | Prowlarr, Pi-hole v6 |
| `query` | API key as URL query parameter | Pi-hole v5, some services |
| `session` | Login endpoint → get token → use token | Nginx Proxy Manager, Portainer |

---

## Format Types for Fields

| Format | What it does | Example |
|--------|-------------|---------|
| `number` | Locale-formatted integer | 3,508 |
| `decimal` | One decimal place | 42.7 |
| `percent` | Append % | 95.2% |
| `ms` | Multiply by 1000, append ms | 76ms |
| `bytes` | Auto-scale to KB/MB/GB | 1.2 GB |
| `duration` | Seconds → human readable | 2h 14m |
| `string` | Raw string passthrough | Running |

## Compute Types for Derived Fields

| Compute | Formula | Use case |
|---------|---------|----------|
| `percent_of` | `(numerator / denominator) * 100` | AdGuard block %, cache hit rate |
| `subtract` | `a - b` | Free space from total - used |
| `sum` | `a + b + ...` | Total across categories |

---

## Preset List (43 integrations)

### DNS & Ad Blocking (3)

| # | App | Auth | Endpoint | Key fields |
|---|-----|------|----------|------------|
| 1 | **AdGuard Home** | basic | `/control/stats` | Queries, Blocked, Block %, Latency |
| 2 | **Pi-hole v6** | header (app_password) | `/api/stats/summary` | Queries, Blocked, Block %, Clients |
| 3 | **NextDNS** | bearer | `https://api.nextdns.io/profiles/{profile}/analytics/status` | Queries, Blocked, Devices |

### Reverse Proxy & Networking (5)

| # | App | Auth | Endpoint | Key fields |
|---|-----|------|----------|------------|
| 4 | **Nginx Proxy Manager** | session | `/api/nginx/proxy-hosts` | Hosts, Online, Certs |
| 5 | **Traefik** | none | `/api/overview` | Routers, Services, Middlewares |
| 6 | **Cloudflare Tunnels** | bearer | `https://api.cloudflare.com/client/v4/accounts/{id}/tunnels` | Tunnels, Active, Inactive |
| 7 | **Tailscale** | bearer | `https://api.tailscale.com/api/v2/tailnet/-/devices` | Devices, Online |
| 8 | **Caddy** | none | `/config/` | Servers, Routes |

### Media — Servers (4)

| # | App | Auth | Endpoint | Key fields |
|---|-----|------|----------|------------|
| 9 | **Plex** | bearer (X-Plex-Token) | `/status/sessions` | Streams, Transcoding, Libraries |
| 10 | **Jellyfin** | bearer | `/System/Info` | Active, Version, Libraries |
| 11 | **Emby** | bearer | `/emby/System/Info` | Active, Version, Libraries |
| 12 | **Tautulli** | query (apikey) | `/api/v2?cmd=get_activity` | Streams, Transcoding, Bandwidth |

### Media — Management (Arr Stack) (7)

| # | App | Auth | Endpoint | Key fields |
|---|-----|------|----------|------------|
| 13 | **Sonarr** | bearer | `/api/v3/queue` + `/api/v3/wanted/missing` | Queue, Missing, Series |
| 14 | **Radarr** | bearer | `/api/v3/queue` + `/api/v3/wanted/missing` | Queue, Missing, Movies |
| 15 | **Lidarr** | bearer | `/api/v1/queue` | Queue, Missing, Artists |
| 16 | **Readarr** | bearer | `/api/v1/queue` | Queue, Missing, Books |
| 17 | **Prowlarr** | bearer | `/api/v1/indexer` | Indexers, Active, Failed |
| 18 | **Bazarr** | bearer | `/api/system/status` | Missing, Wanted, Episodes |
| 19 | **Overseerr / Jellyseerr** | bearer | `/api/v1/request/count` | Pending, Approved, Available |

### Downloads (5)

| # | App | Auth | Endpoint | Key fields |
|---|-----|------|----------|------------|
| 20 | **qBittorrent** | session | `/api/v2/transfer/info` | DL Speed, UL Speed, Active |
| 21 | **Transmission** | basic (RPC) | `/transmission/rpc` | Active, Paused, DL Speed |
| 22 | **SABnzbd** | query (apikey) | `/api?mode=queue&output=json` | Remaining, Speed, Queue |
| 23 | **NZBGet** | basic | `/jsonrpc/status` | Remaining, Speed, Queue |
| 24 | **Deluge** | session | `/json` | Active, DL Speed, UL Speed |

### Infrastructure Monitoring (5)

| # | App | Auth | Endpoint | Key fields |
|---|-----|------|----------|------------|
| 25 | **Uptime Kuma** | none (push) | Already integrated via monitors.js | Status, Ping, Uptime |
| 26 | **Grafana** | bearer | `/api/health` + `/api/search` | Dashboards, Datasources, Alerts |
| 27 | **Portainer** | session | `/api/endpoints` | Environments, Stacks, Containers |
| 28 | **Proxmox** | bearer (PVEAPIToken) | `/api2/json/nodes` | Nodes, VMs, CPU, Memory |
| 29 | **Speedtest Tracker** | none | `/api/speedtest/latest` | Download, Upload, Ping |

### File & Document Management (4)

| # | App | Auth | Endpoint | Key fields |
|---|-----|------|----------|------------|
| 30 | **Nextcloud** | basic | `/ocs/v2.php/apps/serverinfo/api/v1/info?format=json` | Users, Files, Storage |
| 31 | **PhotoPrism** | bearer (session) | `/api/v1/status` | Photos, Videos, Albums |
| 32 | **Immich** | bearer | `/api/server/statistics` | Photos, Videos, Users, Usage |
| 33 | **Paperless-ngx** | bearer | `/api/documents/?page_size=1` | Documents, Tags, Correspondents |

### Security & Auth (2)

| # | App | Auth | Endpoint | Key fields |
|---|-----|------|----------|------------|
| 34 | **Vaultwarden** | none (admin token) | `/admin/diagnostics` | Users, Orgs, Version |
| 35 | **Authentik** | bearer | `/api/v3/core/users/?page_size=1` | Users, Groups, Flows |

### Dev & Code (2)

| # | App | Auth | Endpoint | Key fields |
|---|-----|------|----------|------------|
| 36 | **Gitea** | bearer | `/api/v1/repos/search?limit=1` | Repos, Users, Issues |
| 37 | **GitLab** | bearer (Private-Token) | `/api/v4/projects?statistics=true&per_page=1` | Projects, Pipelines, Issues |

### Home Automation & IoT (2)

| # | App | Auth | Endpoint | Key fields |
|---|-----|------|----------|------------|
| 38 | **Home Assistant** | bearer | `/api/` | Entities, Automations, Version |
| 39 | **Frigate** | none | `/api/stats` | Cameras, Detection FPS, Events |

### Notifications & Misc (4)

| # | App | Auth | Endpoint | Key fields |
|---|-----|------|----------|------------|
| 40 | **Gotify** | bearer | `/application` | Apps, Messages |
| 41 | **Ntfy** | none/bearer | `/v1/stats` | Topics, Messages |
| 42 | **Watchtower** | none (metrics) | Prometheus metrics endpoint | Scanned, Updated, Failed |
| 43 | **Mealie** | bearer | `/api/recipes?page=1&perPage=1` | Recipes, Categories, Tags |

---

## What's NOT a preset (use Custom Builder)

Niche apps, game servers, IoT devices, internal company tools — anything with a JSON API
can be integrated via the Custom Builder without writing code.

---

## Implementation Order

1. **Engine** — registry.js, handler.js, credential flow, test-connection endpoint
2. **Migrate existing** — AdGuard (#1), NPM (#4), Gitea (#36) from hardcoded routes to presets
3. **Core infra** — Pi-hole, Traefik, Portainer, Proxmox, Grafana (#2, 5, 27, 28, 26)
4. **Media stack** — Plex, Jellyfin, Sonarr, Radarr, Tautulli (#9, 10, 13, 14, 12)
5. **Remaining batch** — All others, ~5 per session
6. **Settings UI** — IntegrationsTab with preset gallery + Custom Builder
7. **Custom Builder** — Full UI for user-defined integrations

---

*JagHelm Phase 3 Integration Plan v1.0*
