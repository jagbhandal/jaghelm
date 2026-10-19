# JagHelm — Architecture

JagHelm is a self-hosted homelab dashboard whose differentiator is **live data,
not just links**: it renders real Prometheus / cAdvisor metrics and pulls live
state from 35+ service integrations, laid out on a custom drag-and-resize grid.
It is **single-user, single-instance, and file-backed** (no database), and ships
as a Docker image to a homelab.

> Reflects `main` as of v1.2.0. For *why* specific decisions were made, see the
> ADRs in [`docs/adr/`](adr/). For limitations and scope, see
> [`KNOWN-ISSUES.md`](../KNOWN-ISSUES.md). For the change history, see
> [`CHANGELOG.md`](../CHANGELOG.md).

## 1. Design philosophy

- **Live data over static links.** The point of difference vs Homepage/Dashy is
  that panels show *current* numbers (CPU, RAM, queue depth, block-rate) fetched
  server-side, not just bookmarks.
- **Single instance, in-memory, file-backed.** Sessions live in a `Map`, the
  refresh loop runs in-process, and all user state is a handful of files under a
  data dir. Simple to run; deliberately not horizontally scalable
  ([ADR 0002](adr/0002-in-memory-single-instance.md)).
- **Server does the talking.** The browser only ever calls JagHelm's own API; the
  server fans out to Prometheus, cAdvisor, Uptime Kuma, a NUT exporter, and the
  integration upstreams. Credentials never reach the client.
- **Safe by construction.** Outbound requests pass a single SSRF-guarded fetch
  chokepoint; secrets are encrypted at rest; writes are atomic; config is
  copy-on-read.

## 2. System topology

```mermaid
flowchart LR
  subgraph Client["Browser / PWA"]
    UI["React SPA<br/>(Vite build)"]
    SW["Service worker<br/>(offline shell)"]
  end

  subgraph Server["JagHelm container (Express, single instance)"]
    API["REST API /api/*"]
    REFRESH["Background refresh loop<br/>(every ~30s)"]
    CACHE["In-memory cache<br/>(ETag-tagged)"]
    STORE["File state<br/>(config, secrets, cron, auth)"]
  end

  subgraph Upstreams["Homelab data sources"]
    PROM["Prometheus"]
    CADV["cAdvisor"]
    KUMA["Uptime Kuma"]
    NUT["NUT / UPS"]
    INT["35+ integration<br/>upstreams"]
  end

  UI -->|"fetch + token header"| API
  SW -. precache .- UI
  API --> CACHE
  REFRESH --> CACHE
  REFRESH --> PROM
  REFRESH --> CADV
  REFRESH --> KUMA
  REFRESH --> NUT
  REFRESH --> INT
  API --> STORE
```

The browser talks **only** to `/api/*`. A background loop refreshes upstream data
on an interval into an in-memory cache, so API reads are fast and ETag-enabled
(304s on unchanged data). The deploy chain is separate — see §7.

## 3. Repository layout

```
server/                     Express API (Node 26, ESM)
  index.js                  app wiring: middleware chain + route mounts + SPA fallback
  refresh.js                background refresh loop (start/stop)
  cache.js                  bounded in-memory cache (evicts least recently written, ETags)
  discovery.js              Prometheus/cAdvisor -> nodes + services, one query per reading
                            across all nodes (see 4.2) (ignores containers labelled as Arcane
                            internal helpers, so short-lived helpers never become cards or
                            presence breadcrumbs)
  monitors.js               Uptime Kuma monitor matching
  icons.js                  icon picker search index: names only, persisted in the data dir,
                            refreshed from GitHub by the first search when a day old (see 6)
  icon-cache.js             public /api/icons/cached: icon-repository icons on disk, size-capped
                            with LRU eviction (see 6)
  icon-sources.js           the icon repositories it may fetch from; the web client imports it too
  config.js                 services.yaml: load, hot-reload watch, copy-on-read + atomic save
  secrets.js                AES-256-GCM secret store (per-install KDF salt)
  cron-store.js             cron history (bounded)
  errors.js                 apiError + global JSON error handler
  version.js                single source of version (reads package.json)
  metrics.js                prom-client registry + middleware + /metrics handler
  accessLog.js              one JSON log line per request (full path, no query string)
  demo.js                   DEMO_MODE read-only sample dashboard
  auth/                     scrypt passwords, in-memory sessions, login rate limit, middleware
  routes/                   one router per resource (see 4.1)
  arcane/                   Arcane poller: read-only API client, state derivation, push builders,
                            persisted state, dry-run module (see 4.2)
  integrations/             the integration engine (presets + handler + lib, see 4.3)
  util/                     logger, ssrf, redact, rateLimiter, atomicWrite,
                            configSchema (zod), dataDir, asyncHandler, dedupe
  testing/                  test-only helpers: a mock Prometheus that evaluates JagHelm's
                            PromQL over homelab-shaped series, and the pre-#234 node reader

src/                        React 19 SPA (Vite 8)
  main.jsx, App.jsx         providers (Config, Overlay) + ErrorBoundary + view switch
  api/client.js             apiFetch -- explicit auth-injecting fetch wrapper
  context/                  ConfigContext (config + update via setIn), OverlayContext (toast/confirm)
  hooks/useData.js          fetchJson (304-aware), weather, search engines
  utils/setIn.js            immutable structural-sharing deep-set
  components/HelmGrid/       custom grid engine (gridMath, GridItem, HelmGrid)
  components/settings/       shared primitives + 13 settings tabs (+ IntegrationsTab module)
  components/                NodeCard, ServiceCard, Widgets, NavBar, overlays, etc.
  views/DashboardView/       grid + panels + useDashboardData (304-stable) + per-source health
  views/SettingsView.jsx     13-tab settings shell + collapsible live preview
  styles/global.css          today's themes (10) + their tokens + component styles
  styles/legacy.css          imports global.css into the `legacy` cascade layer (see 5.1)
  ui/                        the redesign's component library, shared with Android (see 5.1):
                             tailwind.css (the stack's stylesheet), tokens.css (the design
                             tokens, docs/design-system.md), preflight.css (generated),
                             shadcn/ui components (button.jsx, a stock placeholder until #285),
                             lib/utils.js

public/sw.js                service worker (precache injected at build)
components.json             shadcn/ui CLI settings (JSX, Base UI, `@ui` -> src/ui/)
scripts/                    inject-sw-precache.mjs, check-assets.mjs, changelog-lint.mjs,
                            changelog-fold.mjs, release-notes.mjs (build/CI/release helpers),
                            ui-preflight.mjs (writes src/ui/preflight.css),
                            ui-contrast.mjs (the design tokens' contrast check)
changes/                    CHANGELOG fragments, one per PR (mobile/changes/ for Android);
                            the release PR folds them into the CHANGELOG (RELEASING.md)
.github/workflows/          build-push.yml (test -> build -> sign -> GHCR), release.yml (tag ->
                            promote by digest -> GitHub Release), build-apk.yml (signed APK)
.gitea/workflows/           check.yml (PR gate), deploy.yml (pin -> health-gate -> rollback)
docs/adr/                   architecture decision records (0001-0005)
```

## 4. Backend architecture

### 4.1 Express server & middleware chain

`server/index.js` wires the app in order: Prometheus metrics middleware -> request
logger -> Helmet security headers + **Content-Security-Policy (report-only)** ->
CORS -> `express.json({ limit: '1mb' })` -> `/uploads` static -> `/metrics` ->
(optional `DEMO_MODE` middleware) -> the API routers -> hashed-asset static
(`immutable, 1y`; a missing file is a 404, never the SPA fallback) -> SPA fallback
(`index.html`) -> the global JSON error handler.
It listens on `JAGHELM_HOST` (default `0.0.0.0`, every IPv4 interface) and `PORT`
(default 3099); if it can't (an address the machine doesn't have, a port in use),
it logs `cannot listen` and exits 1.

Routers (each `server/routes/*.js`), mounted under `/api`:

| Mount | Auth | Purpose |
|-------|------|---------|
| `/api/auth` | public | login, logout, auth-status |
| `/api/health`, `/api/readyz` | public | liveness / readiness probes |
| `/metrics` | public | Prometheus exposition |
| `/api/services` | token | discovered nodes + services (background-refreshed, ETag) |
| `/api/integrations` | token | per-integration live data (background-refreshed, ETag) |
| `/api/display-config` | token | the display config blob |
| `/api/secrets` | token + **auth-required** | encrypted credential store (fail-closed) |
| `/api/cron`, `/api/todos`, `/api/upload`, `/api/icons` | token | widgets + asset upload |
| `/api/icons/cached` | public | icon-repository icons from the local icon cache (an `<img>` can't send the token; see 6) |
| `/api/...` (infrastructure) | token | UPS, Gitea activity, etc., read from the refresh loop |

Auth is a **header token**, not a cookie (so permissive CORS is not a CSRF
vector). `/api/secrets` additionally goes through `requireAuthEnabled` -- it
returns 403 when no password is set, so an open instance can't enumerate
credentials ([KNOWN-ISSUES](../KNOWN-ISSUES.md) covers the open-by-default model).

### 4.2 Background refresh & cache

`refresh.js` runs a single in-process interval that re-fetches node/service
metrics and every configured integration into the bounded `cache.js`
(it evicts the least recently written key at max entries, so user-influenced
keys can't exhaust memory). API reads serve from the cache and attach an ETag;
an unchanged poll returns `304`.
Each cached value is serialized and hashed once, on its first request, and kept
with it, so later requests (`200` or `304`) only send what is already in memory
until the next refresh replaces the value.
`If-None-Match` is matched per RFC 9110: weak comparison, a list of tags, or `*`.
Two reads served outside the cache have their own reuse rules: `/api/history`
(the sparkline series, which changes every cycle) carries an ETag of its
response, and `/api/cron/status` (whose `seconds_since_report` changes every
second, so an ETag would never match) sends `Cache-Control: private, max-age=60`.
The loop is cancelled cleanly on shutdown (no leaking timer).

Node data comes from Prometheus in one batch per cycle (`getNodesData` in
`discovery.js`, #234): one instant query per reading, each matching every
visible node at once (`node=~"a|b|…"`, labels regex-escaped) and split by the
`node` label in JS. That is 13 queries a cycle (`NODE_QUERIES`) whatever the
number of nodes, plus one for the UPS (its four NUT series in one
`{__name__=~…}` selector); it was 14 per node, 2 more every cycle for a node
with no `/` filesystem, and 4 for the UPS (90 a cycle with the homelab's six
nodes). The queries: `up` (max by node), CPU, memory (MemTotal, MemAvailable
and MemFree in one selector), uptime, temperature, disk (size and free in one
selector), and the containers' last-seen, CPU, memory, RX and TX rates, and RX
and TX counters (the four network ones per interface). What they read:

- **Temperature** is the hottest sensor, `max by (node)` over
  `node_hwmon_temp_celsius` (a node has 0 to 14 such series; the VMs have
  none). On pve at idle that is the r8169 NIC, not the CPU.
- **Container memory** (`docker.memMB`) is `container_memory_working_set_bytes`,
  which leaves out page cache the kernel can reclaim.
- **Container RX/TX** comes `sum by (node, name, interface)`, and `discovery.js`
  sums each container's interfaces, leaving out `VIRTUAL_INTERFACES`: lo,
  veth\*, docker\*, br-\*, virbr\*, VPN tunnels (tailscale\*, wg\*, tun\*,
  tap\*) and VLAN subinterfaces (`eth0.10`), which carry traffic another
  interface already counts. What remains is the container's own eth0, eth1, ….
  `docker.rxBytesPerSec` / `txBytesPerSec` are the 5-minute rate in bytes per
  second; for up to 5 minutes after a container is recreated, the rate also
  counts the replaced container's series and reads high. `docker.rxMB` / `txMB`
  keep their meaning, the cumulative counter in MiB (now summed over those
  interfaces, where it used to be the alphabetically last interface), until the
  old endpoints are removed (overhaul P4-4); their two queries go with them.
- **Host-network containers** have no traffic counters of their own: cAdvisor
  reports the host's interfaces for them, so each would show the host's
  traffic. One is told by an interface outside `OWN_NAMESPACE_INTERFACES`
  (eth\<N\>, and the tunnels tun\*, tap\*, wg\* and tailscale\* a container can
  bring up itself): a physical interface not named eth\<N\> (ens18), a Docker
  bridge (br-\*) or a VLAN (eth0.10). It gets `docker.networkMode: 'host'`
  (null for every other container), and all four RX/TX fields are null, which
  the web card shows as "—". Live on 2026-10-19 that is jaghelm,
  omada-controller and tailscale on vm103 (ens18, ens18.10, tailscale0, 15
  br-\*) and adguard-secondary and tailscale on pi2 (eth0, eth0.10, tailscale0,
  9 br-\*); every other container reports only eth0 to eth2. The limit: on a
  host whose only interfaces are eth\<N\>, with no VLAN and no Docker network
  but the default bridge, a host-network container looks like a bridged one.
- **Disk** is `/`, or for a node without one (the NAS) its largest filesystem.
  Which a node has is decided from the first answer that lists its
  filesystems: after that, the disk query asks a node with `/` for `/` alone and
  lists every filesystem only for the nodes without one (or not decided yet),
  so no node is asked for a `/` it lacks. Decisions are kept per node label,
  so a new node starts undecided and a changed node set needs no
  invalidation; a node whose `/` stops answering is decided again, and
  `initDiscovery` forgets them all.

A failed upstream poll is never read as an empty answer. A Prometheus query
that errors, times out or returns no query result rejects (`promQuery` in
`discovery.js`), and Kuma's `fetchMonitors` returns `ok: false` when it loaded
no monitors. The `/api/services` payload says which answered this cycle,
`sources: { prometheus: { ok }, kuma: { ok } }`, and `/api/ups` carries its own
`ok`. Each node also carries `reachable`, from Prometheus' `up` series for that
node: true when any of its targets answered the last scrape, false when none
did, null when no `up` series has the node's label. It carries `failedReads`
too: the parts of the node whose queries failed this cycle (`NODE_READS`:
`reachable` for the `up` query, `cpu`, `mem`, `disk`, `uptime`, `temp`,
`containers`). Each query covers every node, so a failed one is that reading's
failure on every node: the `up` query failing leaves every node's reachability
unread, and a metric query failing that metric. A node missing from an answer
that succeeded has no data for that reading, which is not a failure.
Prometheus counts as failed for the cycle when any node query fails, and also
when every query answers but no node has an `up` series after an earlier answer
had some: a Prometheus that has just started and not scraped yet, whose empty
answers mark every node's reads failed. While Prometheus fails, no presence
breadcrumbs are drawn, since a container missing from the list may still be
running. The push snapshot keeps its last state for what a failed source feeds,
and only that: for a host, only the readings whose queries failed, so a metric
query that keeps failing holds that metric on every host (and, for a host with
no `up` series, its reachability), and a host's `up` at 0 still pages. A missing payload (a cold cache after a restart, or one past its TTL)
counts as failed, and no baseline is taken while the UPS read fails or
Prometheus fails with no host read. So an outage of Prometheus or Kuma sends no alerts about the
hosts and services they watch ([mobile/DESIGN.md](mobile/DESIGN.md),
"Deterministic state-change detection").

```mermaid
flowchart TD
  subgraph Loop["refresh loop (~30s)"]
    D["discovery.js<br/>Prometheus + cAdvisor"]
    M["monitors.js<br/>Uptime Kuma match"]
    IE["integration engine<br/>(35+ presets)"]
  end
  Loop --> C["cache.js (ETag-tagged)"]
  REQ["GET /api/services<br/>or /api/integrations"] --> C
  C -->|"unchanged → 304"| REQ
  C -->|"changed → 200 + ETag"| REQ
```

`server/arcane/` adds a second, independent loop when `ARCANE_URL` and `ARCANE_API_KEY` are
set (never in demo mode): `startArcane()` runs from `boot()` and polls the Arcane manager
every `ARCANE_POLL_SECONDS` (default 300) plus a release check every
`ARCANE_RELEASE_CHECK_HOURS` (default 6). With FCM credentials configured, the first poll and
release check wait up to 30 s for push to be ready. It diffs against persisted state and emits
push events through `dispatchEvents`, and records Arcane's scheduler-started update and prune
runs, and its image watcher's checks, into the cron store. On its own weekly timer it also
reads Arcane's stored vulnerability scan results for the environments in
`ARCANE_VULN_DIGEST_ENVS` and pushes a digest per environment when something is new
(`arcane_vulns`), recording each digest as the `arcane-vuln-digest` cron job. Its `arcane_*` push types map to the `watchtower` preference category (labelled Updates
in the app). Setup: [arcane/SETUP.md](arcane/SETUP.md).

### 4.3 Integration engine

The differentiator. A declarative **preset** (`integrations/presets/*.js`, one
file per app) describes how to talk to one app: endpoints, auth mode, and which
JSON paths map to which display fields. The registry loads every `.js` file in
`presets/` except `*.test.js`, so helpers the presets share live in `lib/`
(e.g. `lib/createArrPreset.js`). A preset flagged `unsupported` still loads, so
an existing config that names it resolves, but `listPresets()` leaves it out of
the gallery and it can't be added; the docs count only the 35+ a user can add.
The flow:

```mermaid
flowchart LR
  CFG["user integration config<br/>(+ encrypted secret)"] --> REG["registry.js<br/>resolves preset"]
  REG --> H["handler.js<br/>orchestrates a fetch"]
  H --> AUTH["lib/auth + lib/session<br/>(api-key / basic / session)"]
  H --> HTTP["lib/http.js<br/>SSRF-guarded safeFetch"]
  HTTP -->|"vetted request"| UP["upstream app API"]
  UP --> EX["lib/extract + lib/format<br/>JSON paths → fields"]
  EX --> OUT["{ fields } or { error } (redacted)"]
```

Key properties:

- **One guarded chokepoint.** Every outbound request goes through
  `lib/http.js` `safeFetch`, which calls `assertSafeUrl` (`util/ssrf.js`) by
  construction -- blocking cloud-metadata IPs, decimal/hex/octal IPv4, and
  IPv4-mapped IPv6, with a `trusted` flag exempting operator infra (Prometheus/
  Kuma) from the strict private-network block.
- **Credential headers stay on their origin.** Redirects are followed in code
  (`util/safeFetchCore.js`), and a hop to a different origin (scheme, host or
  port) forwards only `Accept`, `Accept-Encoding`, `Content-Type` and
  `User-Agent`. Every other header, so every preset's auth header, is dropped
  and stays dropped for the rest of the chain. The one exception is an
  `http://` to `https://` upgrade on the same host and port (a reverse proxy's
  force-SSL), which keeps them because they were just sent to that host. Both
  cases are logged once per origin pair, with header names and no values.
- **Credentials in the URL stay on their origin too.** A key in the query
  string (SABnzbd, Tautulli, Emby) or a credential filled into a custom
  endpoint's `{token}`, `{password}` or `{username}` can't be stripped from a
  redirect, so the code that builds such a URL (`applyQueryAuth` in
  `handler.js`, `resolveEndpoint` in `lib/extract.js`) passes
  `credentialInUrl`, and the request refuses any redirect to another origin
  with an error telling the user to configure the final URL. The same-host
  `http://` to `https://` upgrade is still followed, and logged once per
  origin pair like a header-carrying one, since the key went out in clear
  text first. `httpClient.js` `safeFetch` accepts the same option.
- **Request bodies stay on their origin.** A `307` or `308` keeps the method
  and body, so a session login is re-sent, but only to the same origin or
  through the same-host upgrade; a request with a body redirected to another
  origin is refused, so a username and password never reach a host the user
  didn't configure. Refusals, and an upgrade that re-sends a body, are logged
  once per origin pair without values. A streamed body can't be re-sent and is
  refused too. A
  `303`, and a `301`/`302` on any method but `GET`/`HEAD`, becomes a `GET`
  without a body.
- **Credentials are redacted** (`util/redact.js`) before any error is logged *or*
  returned to the browser -- query-auth presets put the key in the URL, which
  fetch errors would otherwise echo.
- **Only the computed result is kept.** A poll returns what the preset
  computes (its fields, plus structured data such as Proxmox's VMs, storage
  pools and last backup), and drops the upstream response once the preset has
  read it. No route returns an integration's upstream response.
- **Session-auth presets** (Nginx Proxy Manager, Portainer, PhotoPrism) get a
  managed login session via `lib/session.js`; the same SSRF guard still applies.

### 4.4 Config, secrets, and persistence

- **Display config** (`config.js`) is **copy-on-read** (`getConfig()` returns a
  `structuredClone`) and saved via a synchronous **atomic** write
  (temp -> fsync -> rename), so a route can't mutate shared state and a crash
  can't truncate the file ([ADR 0001](adr/0001-atomic-file-writes.md),
  [ADR 0004](adr/0004-config-copy-on-read.md)). It is validated against a Zod
  schema (`util/configSchema.js`) on read, so a malformed file fails loudly.
- **Secrets** (`secrets.js`) are AES-256-GCM encrypted with a **per-install
  random KDF salt** (`data/.secrets-salt`, legacy-static-salt fallback). All
  credential stores write `0600`.
- **Data dir** is single-sourced via `util/dataDir.js` (`JAGHELM_DATA_DIR`) so
  secrets/auth/config/cron and the icon cache never split across locations.

### 4.5 Auth & rate limiting

scrypt password hashing (`auth/passwords.js`), in-memory sessions
(`auth/sessions.js`), and a brute-force **login rate limiter** (`auth/rateLimit.js`).
A reusable `util/rateLimiter.js` additionally throttles the abuse-prone
integration connection-test endpoint.

### 4.6 Observability

- **Structured logging** (`util/logger.js`) with redaction -- no secrets in logs.
  `LOG_LEVEL` (`debug|info|warn|error|silent`, default `info`) filters it.
  Success lines every refresh cycle would repeat are debug, while a refresh
  that keeps failing still logs its own error each cycle. At info: a cycle that
  took 5 s or more; a change in the cycle's set of failed refreshes (a refresh
  that returned null, or an integration with an `_error`); a Kuma load whose
  monitor count or source changed; and one line per boot for containers no
  monitor matches. Prometheus failing (any node query of the cycle, or an
  answer with no `up` series after one with some) and Kuma failing (no
  monitors loaded: unreachable, non-2xx, or a status page with none) each warn
  once, with the error, and their recovery logs once at info with how long it
  was down; the failed cycles in between log at debug
  (`util/sourceHealthLog.js`).
- **Access log** (`accessLog.js`): one line per request with its full path and no
  query string or fragment; 5xx at `error`, 4xx and requests of 300 ms or more at
  `info`, the rest at `debug`. `/metrics`, `/api/health` and `/api/readyz` are not
  logged unless they fail (5xx).
- **Prometheus metrics** at `/metrics` via `prom-client` (`metrics.js`): request
  rate, latency histograms, refresh-loop health.
- **Two probes**: `/api/health` (liveness; reflects refresh-loop liveness -- 503
  when wedged) and `/api/readyz` (readiness; distinguishes "not ready yet" from
  "down"), backing the Docker `HEALTHCHECK` and the deploy gate.

## 5. Frontend architecture

```mermaid
flowchart TD
  MAIN["main.jsx"] --> EB["ErrorBoundary (root)"]
  EB --> CP["ConfigProvider"]
  CP --> OP["OverlayProvider<br/>(toast + confirm)"]
  OP --> APP["App.jsx (view switch)"]
  APP --> NAV["NavBar<br/>(search, weather, theme picker, mobile menu)"]
  APP --> DV["DashboardView"]
  APP --> SV["SettingsView (13 tabs)"]
  APP --> IV["IframeView"]
  DV --> HG["HelmGrid engine"]
  HG --> GI["GridItem (+ keyboard handle)"]
  DV --> NP["NodePanel / NodeCard / ServiceCard / Widgets"]
  DV --> UDD["useDashboardData<br/>(304-stable, per-source health)"]
  SV --> PRIM["settings primitives<br/>Card/Toggle/ChoiceGroup/EmptyState"]
  SV --> ITAB["IntegrationsTab module"]
```

- **State.** `ConfigContext` exposes `config`, the stable `setConfig`, and a
  memoised `update(path, value)` built on `setIn` (immutable structural-sharing
  deep-set) -- so leaf cards memoise and don't re-render on unrelated edits.
  `OverlayContext` provides `useToast` / `useConfirm` (focus-trapped, Escape,
  focus-restore, reduced-motion). `api/client.js` `apiFetch` injects the auth
  token explicitly (replacing an old `window.fetch` monkey-patch).
- **HelmGrid** is a custom, dependency-light layout engine: pure math in
  `gridMath.js` (snap, overlap-resolve, content-fit), per-item measurement +
  rendering in `GridItem.jsx`, and lifecycle (breakpoints, drag/resize, commit)
  in `HelmGrid.jsx`. Panels auto-grow to fit content; pointer **and keyboard**
  (arrow move / Shift+arrow resize, with a live region) reposition them.
- **Data fetching.** `useDashboardData` holds a **304-stable identity contract**:
  on an unchanged poll `fetchJson` returns the same reference and `setState`
  bails via `Object.is`, so an all-304 tick triggers zero re-renders. Per-source
  health (error / stale / retry) is derived at render without per-tick state.
- **Polling.** `App.jsx` drives one tick per refresh interval (30 s by default),
  and only while the dashboard is on screen: a hidden browser tab, Settings or an
  iframe tab pauses it, and returning refreshes every source at once. The board
  loads every source once on mount; a tick then fetches the live sources
  (`/api/services`, `/api/ups`, `/api/integrations`) plus one slow source in turn
  (`/api/history`, `/api/cron/status`, `/api/gitea/activity`), so four requests
  per tick. A panel shows its "updated ... ago" stale note after 2 missed polls
  of its own source (`pollPeriodMs` in `useDashboardData`): 1 minute for a live
  source and 3 minutes for a slow one at 30 s. The navbar health dot reads
  `overallHealth` from the board's own `/api/services` result, so it holds its
  last value while polling is paused (the "Updated" clock keeps counting) and
  catches up on return. The navbar refetches weather at most every 10 minutes.
  The Settings preview loads once when shown and refreshes only on its button.
- **Design system.** 10 themes (`themes.js` + `[data-theme]` token blocks),
  generic `--space-*` / `--text-*` scales plus semantic `--fs-*` card tokens,
  and a global `:focus-visible` ring + reduced-motion handling.
- **PWA.** `public/sw.js` precaches the app shell **and** the hashed first-paint
  bundles (the precache list, the build's full `dist/assets` list + version are
  injected at build by `scripts/inject-sw-precache.mjs`); immutable `/assets/`
  are served cache-first, and other same-origin GETs outside `/api/`
  network-first with a cached copy for offline. Both runtime paths store into
  the same versioned cache; an `/assets/` response is stored only when it is ok
  and not HTML. On activate the worker deletes every other cache and trims
  `/assets/` entries not in the current build's asset list, so a redeploy at the
  same version doesn't leave its old bundles behind. The current build's lazy
  chunks, the shell, `/uploads/` and public files stay cached for offline use.

### 5.1 UI stack (Tailwind CSS v4, shadcn/ui, Lucide)

The overhaul (spec `docs/superpowers/specs/2026-10-18-jaghelm-overhaul-design.md`,
§5) rebuilds the screens on one component library in `src/ui/`, used by the web
app and, from Phase 4, the Android app. Until the last old screen goes, the new
stack sits beside today's CSS and must not restyle it.

- **Toolchain.** Tailwind CSS v4 compiles at build time through `@tailwindcss/vite`
  in `vite.config.js` and `mobile/vite.config.mobile.js`, into each app's one
  hashed stylesheet. Nothing is injected at runtime or loaded from a CDN, so the
  CSP is unchanged. shadcn/ui is set up in `components.json`: JSX (no
  TypeScript), the Base UI primitives (style `base-nova`), and the `@ui` alias for
  `src/ui/` (`tsconfig.json` `paths`, so `npx shadcn add <name>` writes
  `src/ui/<name>.jsx`). Components import `cn` from the `cn` package, as the shadcn
  registry now generates them. Icons come from `lucide-react` by name
  (`import { Check } from 'lucide-react'`), so a bundle carries only the icons it
  uses. `src/ui/button.jsx` is the only component so far and no screen uses it.
- **Both apps import `@ui/...`.** The Android build maps `@ui` to `../src/ui` and
  lists React and every package `src/ui/` imports in `resolve.dedupe`, so shared
  code uses the Android app's own copies: the APK build installs `mobile/` only,
  and a second React breaks hooks. A package added to `src/ui/` goes in both
  `package.json` files and that list; `scripts/ui-stack.test.mjs` checks it.
- **Cascade layers.** The order is `legacy, properties, theme, base, components,
  utilities`, declared at the top of every entry stylesheet. Each app's
  `styles/legacy.css` imports today's stylesheets into `legacy`, the lowest layer
  (web: `global.css`; Android: `MobileApp.css`, `Login.css`, `global.css` and
  `fonts.css`, in the order the bundle had them). The new stack's rules therefore
  win wherever both style an element: without this, `global.css`'s unlayered
  `* { margin: 0; padding: 0 }` would beat every spacing utility. Components do not
  import stylesheets themselves, since an unlayered sheet would outrank both.
- **Preflight is scoped.** Tailwind's reset would restyle every element on the
  page (margins, lists, headings, `svg` display). `src/ui/preflight.css` is
  Tailwind's preflight wrapped in `@scope (.jh-ui)`, generated by
  `node scripts/ui-preflight.mjs`; rerun it after a Tailwind upgrade (a test fails
  until you do). Give `jh-ui` to the root of each new screen and to portalled
  content (dialogs, popovers, menus render outside their parent). `@scope` needs
  Chrome or Edge 118, Safari 17.4 or Firefox 146; the Android WebView is current
  Chromium. In an older browser new components lose the reset, and today's
  screens are unaffected either way.
- **Only `src/ui/` is scanned** for class names (`source(none)` plus `@source`,
  tests excluded), and every class found there ships whether a screen uses it or
  not. Add an `@source` line for each new folder of screens. Utilities are global
  classes in a layer above `legacy`, so a legacy class name that is also a utility
  (under this theme, not just Tailwind's defaults) would be restyled on today's
  screens as soon as any file in `src/ui/` mentions it, even in a comment.
  `scripts/ui-stack.test.mjs` compiles every legacy class name (selectors in the
  legacy stylesheets, `className` strings outside `src/ui/`) and fails on any
  utility except `flex-1` and `sr-only`. That is why `.text-muted` and
  `.text-secondary` became `.muted-text` and `.secondary-text`: shadcn's `muted`
  and `secondary` roles make `text-muted` and `text-secondary` colour utilities.
  When the test fires, rename the legacy class or pick another role name. Of the
  two shared names, `flex-1` sets the same `flex: 1`. Legacy `.sr-only` sets
  `position: absolute !important`, which also beats a new component's
  `not-sr-only` (for `!important` the lowest layer wins): drop that `!important`
  when a component first needs `not-sr-only`.
- **Tokens.** JagHelm's design tokens are in `src/ui/tokens.css`, from the
  signed-off mock: a palette of OKLCH ramps, the roles components use, and a few
  component tokens, in dark and light, with five accents and two densities
  switched by `data-theme`, `data-accent` and `data-density` on the `.jh-ui`
  root. [design-system.md](design-system.md) lists them with the rules for using
  them, and `scripts/ui-contrast.mjs` checks every text/background pairing in
  every theme and accent against the spec's floors, as sRGB and Display P3
  screens paint them, and that each accent's hover is visibly different from
  its rest state (`ui-contrast.test.mjs`).
  They are custom properties on `.jh-ui`, prefixed `--jh-`, never on `:root`:
  today's CSS owns `--bg`, `--accent`, `--border`, `--card`, `--muted`,
  `--text-*`, `--font-mono`, `--font-body` and `--font-display` there and in the
  Android shell, and the prefix keeps an old widget inside a new screen on its
  own values. `tailwind.css` offers the roles as utilities (`bg-surface-1`,
  `text-text-2`, `text-crit-fg`), plus shadcn's role names mapped onto them so a
  generated component compiles, and clears Tailwind's default palette, type
  sizes, font families, radii, shadows, text shadows and blurs
  (`ui-tokens.test.mjs`, which also fails on gradient text and on shadcn's
  `accent-foreground`). The theme is inline
  and reference-only (`theme(inline reference)`, `@theme inline reference`):
  utilities carry their values, and Tailwind writes no variable to `:root`,
  where anything it wrote would land in the `theme` layer, above `legacy`. The
  `dark` variant applies inside a `.jh-ui` root without `data-theme="light"`.
  Every variable a class reads with `var()` must be declared under `.jh-ui`: a
  role reads its token (`bg-surface-1` reads `--jh-surface-1`), and a class that
  reads a variable itself (the Button's `rounded-[min(var(--radius-md),10px)]`)
  needs that variable there too, which is why the radius scale is in both
  `tokens.css` and `tailwind.css`. Never add a `:root`, `html` or `body` rule or
  a `@theme` block without `reference`. `scripts/ui-stack.test.mjs` compiles the
  stack and fails on an unlayered rule, a root selector, a base rule outside
  `@scope (.jh-ui)`, a `var()` read that `.jh-ui` doesn't declare, or the two
  radius scales drifting apart.
- **When the old CSS is gone,** drop the `legacy` layer and the scoping: import
  Tailwind's own preflight, move the tokens to `:root` and drop `reference`.

## 6. Data model

All state is files under the data dir (no DB):

- **services.yaml** -- nodes, per-service overrides and integration configs
  (each secret value stored separately, encrypted). Hot-reloaded on an
  external edit; read copy-on-read; `POST /api/services/config` validated by Zod.
- **display config** -- title, theme, layout (`{lg,md,sm}` grid item arrays),
  sections (per-panel visibility/order/colour), nav/search/weather flags,
  links, tabs, fonts. Read copy-on-read; validated by Zod.
- **secrets** -- AES-256-GCM blob, keyed by integration storage key.
- **Arcane state** -- `arcane-state.json` (baselined environments, agent down counters,
  seen activity ids, each environment's pending updates, runs waiting on their job run,
  last notified release),
  `arcane-held-back.json` (held-back containers per environment) and
  `arcane-vuln-state.json` (each environment's critical/high finding keys, KEV count and
  stale or failed images at the last vulnerability digest, and when it last ran); atomic writes, tolerant load.
- **cron history**, **todos**, **auth** (password hash + salt) -- small files,
  atomic writes.
- **icon index** -- `icon-index.json`: the SVG names of the two icon repositories
  (homarr-labs/dashboard-icons, selfhst/icons) with each listing's ETag and when
  it was last checked; about 170 KB, atomic writes, tolerant load. A cache, so
  deleting it is safe. Boot only reads it and never calls GitHub; the first icon
  search after it is missing or a day old lists each repository's `svg/`
  directory on its default branch (conditional on the ETag, 8 MB body cap). A
  failed or truncated refresh keeps the index it has and is retried after an
  hour, or after 5 minutes while there is no index to serve.
- **icon cache** -- `icon-cache/`: each icon `/api/icons/cached` has served, one
  file named by the SHA-256 of its canonical URL. The route is public, so it
  fetches only icons of the two icon repositories (Dashboard Icons, selfh.st) as
  SVG, PNG or WebP at a moving ref, on jsDelivr or raw.githubusercontent.com
  (`icon-sources.js`); it rebuilds the URL from that allowlist, so a query string
  or another spelling of one icon is the same file, and follows a redirect only to
  another such URL. An icon must be the image type its extension names and at
  most 512 KB; a larger one is not cached and the browser is redirected to the
  CDN for it. The whole cache is capped at `JAGHELM_ICON_CACHE_MAX_MB` (50 MB)
  and drops the least recently used icon to stay under it; the files on disk
  are counted at boot, oldest written first, and the count is kept in memory.
  At most 8 fetches from the CDN run at once (a browser opens 6 connections to an
  HTTP/1.1 origin, so one page load never waits) and 256 more wait; past that a
  miss is a 503 with `Retry-After`. Concurrent requests for one icon share one
  fetch. A body is held only until it is written; every response, a miss's
  too, streams from the file, and one that wasn't stored is a 302 to the CDN,
  so icon bodies in memory stay under 4 MB.
  Served with `Content-Security-Policy: default-src 'none'; style-src
  'unsafe-inline'; sandbox` and `nosniff`. The web client sends only these URLs
  through it and loads any other icon URL directly. A cache, so deleting it is
  safe; icons are fetched again as they are shown.

## 7. CI/CD pipeline

```mermaid
flowchart LR
  CHK["Gitea check.yml on the PR<br/>lint + typecheck + tests + CHANGELOG format"] --> PR
  PR["PR merged on Gitea<br/>(source of truth)"] --> MIRROR["mirror -> GitHub"]
  MIRROR --> GH["GitHub Actions: build-push.yml"]
  subgraph GH2["build-push.yml"]
    T["test gate<br/>node:test + Vitest + typecheck + audit"] --> B["build image<br/>:latest, :sha-short"]
    B --> S["cosign keyless sign (by digest)"]
  end
  GH --> GHCR["GHCR"]
  TAG["vX.Y.Z tag pushed on Gitea"] --> REL["GitHub Actions: release.yml<br/>add :X.Y.Z to the :sha-short digest<br/>+ GitHub Release"]
  REL --> GHCR
  GH -.->|"event-driven dispatch (opt-in, ADR 0005)"| DEP
  PR -->|"push trigger (fallback)"| DEP["Gitea deploy.yml (self-hosted)"]
  subgraph DEP2["deploy.yml"]
    PIN["pull + pin :sha-short"] --> GATE["health gate<br/>(Docker health + /api/health)"]
    GATE -->|"fail"| RB["auto-rollback to prev image"]
    GATE -->|"pass"| LIVE["live on prod"]
  end
```

- **PR gate** ([check.yml](../.gitea/workflows/check.yml)) runs on the
  self-hosted Gitea runner for every PR to `main`: secret scan, CHANGELOG
  format (both CHANGELOGs and their `changes/` fragments), lint, typecheck,
  server, web and mobile tests, and the asset check.
- **Build** ([build-push.yml](../.github/workflows/build-push.yml)) runs on
  GitHub for every push to `main`: a test gate (so a red `main` can't ship),
  then build and push `:latest` and the immutable `:sha-<short>` with OCI
  labels, then **keyless cosign signing**.
- **Server release** ([release.yml](../.github/workflows/release.yml)) runs on
  GitHub when a `vX.Y.Z` tag arrives from Gitea. It does not rebuild: it checks
  the tag (on `main`, matching `package.json` and a CHANGELOG section), waits for
  that commit's `:sha-<short>`, verifies its signature, adds `:X.Y.Z` to the same
  digest, and creates the GitHub Release from the CHANGELOG. Published image tags
  never move and release pages are never rewritten. Procedure:
  [RELEASING.md](RELEASING.md).
- **Android release** ([build-apk.yml](../.github/workflows/build-apk.yml)) runs
  on GitHub for a `mobile-vX.Y.Z` tag: it builds and signs the APK, then a
  release job attaches it to a GitHub Release with notes from
  `mobile/CHANGELOG.md`. A manual run is a
  test build and creates no release.
- **Deploy** ([deploy.yml](../.gitea/workflows/deploy.yml)) runs on the
  self-hosted Gitea runner labelled `vm103` (no other workflow may use that
  label): pull and **pin this commit's `:sha-<short>`** image,
  recreate behind a **health gate** that auto-rolls-back to the previous image on
  failure.
- **Event-driven trigger** ([ADR 0005](adr/0005-event-driven-deploy.md)): the
  build dispatches the deploy when the image is ready, replacing a GHCR poll. It
  is opt-in and fallback-preserving -- the push trigger remains until verified.

## 8. Testing

Automated tests gate every PR to `main` (`check.yml`) and every build of `main`
(`build-push.yml`):

- **Backend** (`node --test`, `npm run test:ci`): the AES-GCM secrets round-trip +
  tamper, the SSRF guard vectors, credential redaction, the upload allowlist,
  config schema/copy-on-read (incl. a `SIGKILL`-mid-write chaos test), route
  contracts, rate limiting, `/health` + `/readyz`, and the pure HelmGrid
  `gridMath`, the service-worker precache injector, and the worker's install,
  activate and fetch handlers run against a fake cache (`scripts/sw.test.mjs`).
  Node reads run against a mock Prometheus (`server/testing/mockPrometheus.js`)
  that evaluates the PromQL JagHelm sends over series shaped like the homelab's
  and counts the queries: the per-cycle budget, and the batched reads against
  the per-node reader they replaced (`server/testing/legacyNodeData.js`).
- **Client** (`npm run test:client`, Vitest + jsdom + React Testing Library):
  NavBar/config-driven rendering, settings primitives, the keyboard grid handle,
  per-source health banners, overlay/confirm semantics, the 304-stable data
  hook, and the `src/ui/` components.
- **Mobile** (`npm run test:mobile`, Vitest): the Android app's views, login,
  push routing, on-device storage, and the shared `src/ui/` components through
  the Android build's `@ui` alias.
- **Repo guards** (`node --test`, `scripts/*.test.mjs`): the deploy runner pin,
  the secret floor (`.gitignore`, tracked templates, the scanner catching a
  planted key) and its wiring in `check.yml`, the docs' preset and test
  counts (`doc-counts.test.mjs`), and the UI stack's separation from today's
  CSS and its reach into the Android build (`ui-stack.test.mjs`,
  `ui-preflight.test.mjs`), and the design tokens' shape and contrast
  (`ui-tokens.test.mjs`, `ui-contrast.test.mjs`). Write new repo checks this way, not as shell
  scripts: `npm test` only collects `*.test.{js,mjs,cjs}`.

`npm test` preloads `scripts/test-data-dir.mjs`, which gives every test process
its own temp `JAGHELM_DATA_DIR`, so the suite never reads or writes the
checkout's `data/` (`scripts/test-data-dir.test.mjs` guards the wiring).

It also preloads `scripts/test-exit-guard.mjs`. From Node 26, `--test-timeout`
bounds each test but no longer a test file's process, so a file that leaves a
server, interval or socket open would keep `npm test` running forever. The
guard fails such a file once it is still running `--test-timeout` ms after its
last test, its after hooks included (`scripts/test-exit-guard.test.mjs`). It
only bounds files that register a test: one that hangs before registering any
still hangs.

The Vitest configs (`vite.config.js`, `mobile/vite.config.mobile.js`) start
their workers with `--no-experimental-webstorage`: Node 25 and later ship a
`localStorage` global of their own, which hides jsdom's.

`npm run test:ci` also fails a run that passes fewer backend tests than the
floor in `scripts/test-floor.mjs`, so a silently dropped test is caught. The
docs give no exact test or preset count, since one goes stale with the next
change; `doc-counts.test.mjs` fails on one.

## 9. Key decisions (ADRs)

| ADR | Decision |
|-----|----------|
| [0001](adr/0001-atomic-file-writes.md) | Atomic temp->fsync->rename writes for all user state |
| [0002](adr/0002-in-memory-single-instance.md) | Single-instance, in-memory state (no DB) |
| [0003](adr/0003-scoped-tls-bypass.md) | Per-request, opt-in TLS-verify bypass for self-signed infra |
| [0004](adr/0004-config-copy-on-read.md) | Config is copy-on-read + synchronous atomic writes |
| [0005](adr/0005-event-driven-deploy.md) | Event-driven build->deploy trigger (opt-in, fallback-preserving) |

## 10. Known tradeoffs

Single-instance / in-memory (no clustering), single-user / single-tenant, and a
hard Prometheus dependency for node metrics are **deliberate scope choices**, not
bugs. The full list -- security defaults (open-by-default, host networking),
integration drift, and roadmap items -- lives in
[`KNOWN-ISSUES.md`](../KNOWN-ISSUES.md).
