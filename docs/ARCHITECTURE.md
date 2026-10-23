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
- **Single instance, in-memory, file-backed.** Sessions live in a `Map` kept
  in a file of token hashes so they survive a restart, the refresh loop runs
  in-process, and all user state is a handful of files under a data dir. Simple to run; deliberately not horizontally scalable
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
                            internal helpers, and CI job containers named GITEA-ACTIONS-TASK-…,
                            so short-lived helpers and jobs never become cards or presence
                            breadcrumbs, or take a monitor)
  monitors.js               Uptime Kuma: loads the monitors and assigns them to containers,
                            one container per monitor unless mapped (see 4.2)
  icons.js                  icon picker search index: names only, persisted in the data dir,
                            refreshed from GitHub by the first search when a day old (see 6)
  icon-cache.js             public /api/icons/cached: icon-repository icons on disk, size-capped
                            with LRU eviction (see 6)
  icon-sources.js           the icon repositories it may fetch from; the web client imports it too
  config.js                 services.yaml: load, hot-reload watch (and its 30 s retry while
                            broken), copy-on-read, its version, and the one atomic writer,
                            over the version read (see 6)
  firstBoot.js              first boot with no services.yaml: discovery, and the refresh
                            asking again until Prometheus has nodes, then one save (see 6)
  secrets.js                AES-256-GCM secret store (per-install KDF salt), the origins
                            each secret may go to (#556), and the snapshot a failed
                            integration save is undone to (see 4.4)
  cron-store.js             cron history (bounded)
  errors.js                 apiError + global JSON error handler
  version.js                single source of version (reads package.json)
  metrics.js                prom-client registry + middleware + /metrics handler
  accessLog.js              one JSON log line per request (full path, no query string)
  demo.js                   DEMO_MODE guard: owns /api, refuses writes, answers reads from
                            demoFixtures.js and any other path with a 404; boot() starts no
                            subsystem in demo mode
  demoFixtures.js           the demo's board, shaped by the live code (assembleServices,
                            decorateStatuses, the status model); incident and healthy scenarios
  embedCheck.js             reads an app tab's X-Frame-Options / CSP frame-ancestors and says
                            whether the browser will frame it (see 5, "App tabs")
  auth/                     scrypt passwords, sessions (token hashes on disk), login rate limit,
                            middleware
  routes/                   one router per resource (see 4.1)
  arcane/                   Arcane poller: read-only API client, state derivation, push builders,
                            persisted state, dry-run module (see 4.2), and the agents the
                            status model reads from it (agents.js, see 4.7)
  integrations/             the integration engine (presets + handler + lib, see 4.3)
  status/                   the status model: every entity's state, reason and since, the
                            subsystems, the overall sentence and the ranked issues, the
                            one threshold config, and which cron jobs are backups
                            (backupJobs.js); built once a cycle, served at /api/status,
                            and what push sends from (see 4.7); readings.js, a reading's
                            lines as the screens draw them, which the web imports too
  util/                     logger, ssrf, redact, rateLimiter, atomicWrite,
                            configSchema (zod), configMask (the config read's
                            credential markers, see 6), dataDir, asyncHandler, dedupe,
                            parseError (a parse error's reason and position, see 4.6)
  testing/                  test-only helpers: a mock Prometheus that evaluates JagHelm's
                            PromQL over homelab-shaped series, the pre-#234 node reader, the
                            status model's input builders (statusFixtures.js), the
                            loop's status-and-push step as refresh.js runs it (pushPipeline.js),
                            the named status fixtures the cross-client suite runs on
                            (statusScenarios.js, see 4.7), and the live loop's side of the
                            demo's /api/status drift test (demoLiveStatus.js, see 4.7)

src/                        React 19 SPA (Vite 8)
  main.jsx, App.jsx         providers (Config, Overlay) + ErrorBoundary + the shell and its
                            pages, by route (see 5, "Shell and routing")
  lazyViews.js              the loaders of the views loaded on first use (Settings, the app
                            frames, Alerts, the More sheet, the phone screens), every
                            React.lazy() takes one;
                            the client tests load them all up front (see 8)
  router/                   routes.js (the route table: paths, params, the routes hidden until
                            their page exists, and those a phone has already), useRoute.js
                            (the History API router, and a query parameter, useSearchParam)
  shell/                    the shell wired: ShellChrome.jsx (header, sidebar, phone tabs and
                            More sheet, fed from the route, the config and the status poll),
                            nav.js (the nav as data), AlertsPage.jsx, OverviewStatus.jsx (the
                            Overview's top from 768px: its status and subsystem strip),
                            PhoneView.jsx, phoneData.js and phoneNav.js (below 768px the
                            phone screens, their data from the web's parts, their details
                            a history entry each, #303), ShellAttention.jsx
                            (the attention panel both draw), statusView.js (how the status
                            model's issues are counted and worded, and its subsystems made
                            the strip's cells), overviewFilter.js (the strip's filter, in the
                            URL), entityAnchors.js (where an Overview issue row leads),
                            OverviewInfrastructure.jsx and infrastructureView.js (the
                            Overview's Infrastructure section, its nodes from the model),
                            OverviewServices.jsx and servicesView.js (the Overview's
                            Services section, its rows from the model, #300),
                            Utilities.jsx, utilities.js and LaunchPage.jsx (Quick Launch,
                            Pipeline and the Checklist: the Overview's rail from 1440px
                            and the Launch page, #301), extras.js (weather, the clock
                            and the web search, #307), overviewSections.js (the
                            Overview's show/hide switches, #307), customGroups.js (the
                            custom groups, by service uid, #517), useMediaQuery.js (a
                            width the markup changes at),
                            statusFreshness.js (the one rule for a stale status: whether
                            the poll's status is current, and how each place draws one
                            that isn't), theme.js (dark, light or system, and the old
                            themes' migration; see 5, "Design system")
  api/client.js             apiFetch -- explicit auth-injecting fetch wrapper
  context/                  ConfigContext (config + update via setIn), OverlayContext (toast/confirm)
  hooks/useData.js          fetchJson (304-aware), weather, search engines
  hooks/useStatus.js        the header's /api/status poll (see 5, "Status in the header")
  hooks/useAppFrames.js,    app tabs: which frames are mounted (at most five, least recently
  hooks/useEmbedStatus.js   used out first), and each frame's load state (logic only; see 5,
                            "App tabs")
  utils/setIn.js            immutable structural-sharing deep-set
  components/HelmGrid/       custom grid engine (gridMath, GridItem, HelmGrid)
  components/settings/       shared primitives + 13 settings tabs (+ IntegrationsTab module)
  components/                NodeCard, Widgets, CommandPalette, overlays, etc.
  views/DashboardView/       grid + panels + useDashboardData (304-stable) + per-source health
  views/SettingsView.jsx     13-tab settings shell + collapsible live preview
  views/AppFrames.jsx,       app tabs as they look today: the host keeping visited frames, and
  views/IframeView.jsx       one frame with its loading, slow and blocked notices
  styles/global.css          today's two themes (dark, light) on the new tokens' values +
                             component styles
  styles/fonts.css           today's fonts, self-hosted: the files Google Fonts served (see 5.1)
  styles/legacy.css          imports global.css and fonts.css into the `legacy` cascade layer
  fonts/                     every woff2 the web app ships (latin subsets; latin-ext too for the
                             new UI's faces) and their OFL licences
  ui/                        the redesign's component library, shared with Android (see 5.1):
                             tailwind.css (the stack's stylesheet), tokens.css (the design
                             tokens, docs/design-system.md), accents.js (the accents offered),
                             typefaces.js (the faces offered), fonts.css (their @font-face),
                             preflight.css (generated),
                             the controls (#285: button, icon-button, input, select, switch,
                             checkbox, field, segmented-control, tabs; design-system.md),
                             the containers (#286: root, panel, dialog, drawer, confirm,
                             popover, tooltip, toast, banner, empty-state, skeleton),
                             the status components (#287: status-lamp, status-word,
                             issue-row, subsystem-strip, attention-panel; the Android app
                             uses them too), the data components (#288: metric-meter,
                             sparkline, uptime-bar, entity-row, fact-list, table),
                             the sign-in screen (#305: login-form),
                             the shell (#296: app-shell, app-header, side-nav,
                             bottom-tabs, app-bar), the Overview's sections (#299:
                             node-card, infrastructure-section; #300: services-section),
                             the utilities (#301: utilities, Quick Launch, Pipeline,
                             the Checklist, the rail and the Launch page's layout;
                             #307: WeatherClock, WebSearch),
                             lib/status.js (the five states, their words,
                             the two looks, and why there is no signal),
                             lib/ago.js ("12 s ago", and the one clock every age on
                             screen ticks on), lib/utils.js (cn, taught the theme),
                             lib/portal.js (portal roots and the switches they copy),
                             lib/floating.jsx (the floating layer's loader and the
                             triggers drawn until it is in), floating/ (the popups'
                             Base UI parts, one chunk loaded on first use; see 5.1),
                             lib/field-context.js (how a Field labels its control),
                             lib/tone.jsx (a tone's icon), lib/name.js (an overlay's
                             required name)
  phone/                     the phone screens, shared (#303; see 5.1, "The phone screens
                             are shared"): views/ (Overview, Services, Infra, Alerts and the
                             service, node and incident details), components/ (the rows,
                             cards, bars and headers they draw), data/ (board.js, what each
                             screen shows of the status model; derive.js and groupByDay.js,
                             display helpers), nav/ (useNavStack.js, a tab's detail stack;
                             issueRoute.js, where an issue row leads), platform.js (what a
                             screen needs of the app drawing it), sheet.js (a detail's title
                             naming the web's sheet); both apps draw them, each in its own
                             look; the web look's tests are here, the Android look's in
                             mobile/src/

gallery/                    the component gallery (development and CI only, docs/GALLERY.md):
                            catalog.js (every state), states.jsx (what each draws),
                            main.jsx (the page), gallery.spec.mjs (screenshots and axe),
                            baselines/ (the committed PNGs), container.mjs (the pinned
                            Playwright image and the Chromium flags every browser test
                            starts with); built by vite.gallery.config.js, tested by
                            playwright.config.mjs, never part of the production build
e2e/                        the app shell's browser tests (shell.spec.mjs, overview.spec.mjs,
                            infrastructure.spec.mjs, services.spec.mjs, no-signal.spec.mjs,
                            phone.spec.mjs, login.spec.mjs, utilities.spec.mjs,
                            reflow.spec.mjs, first-load.spec.mjs, extras.spec.mjs, what
                            they share in app.mjs; see 8): the
                            production build served
                            by `vite preview`, every /api request answered in the test; run
                            by playwright.e2e.config.mjs in the gallery's container
mobile/visual/              the Android screens' baselines (see 8; mobile/DESIGN.md):
                            android.spec.mjs (the states), baselines/ (the committed PNGs),
                            native.js (the phone's plugins, stubbed), fixtures.js (the
                            boards), vite.config.visual.js (the APK's page with those
                            stubs); run by playwright.android.config.mjs in the gallery's
                            container

public/sw.js                service worker (precache injected at build)
components.json             shadcn/ui CLI settings (JSX, Base UI, `@ui` -> src/ui/)
scripts/                    inject-sw-precache.mjs, check-assets.mjs, changelog-lint.mjs,
                            changelog-fold.mjs, release-notes.mjs (build/CI/release helpers),
                            ui-preflight.mjs (writes src/ui/preflight.css),
                            ui-contrast.mjs (the design tokens' contrast check, and the
                            chart colours' gates), gallery.mjs (runs the gallery's tests in
                            their container), deploy/deploy.sh (the production deploy both
                            Gitea deploy workflows run, one command per step)
changes/                    CHANGELOG fragments, one per PR (mobile/changes/ for Android);
                            the release PR folds them into the CHANGELOG (RELEASING.md)
.github/workflows/          build-push.yml (test -> build -> sign -> GHCR), release.yml (tag ->
                            promote by digest -> GitHub Release), build-apk.yml (signed APK)
.gitea/workflows/           check.yml (PR gate), deploy.yml (on a push to main: stage image +
                            compose.yaml -> recreate -> health-gate -> rollback),
                            reconcile.yml (every 5 min: the same deploy for main's head)
docs/adr/                   architecture decision records (0001-0007)
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
it logs `cannot listen` and exits 1. The `listening` line logs the port bound.
In demo mode `boot()` only loads the integration preset gallery: it starts no
discovery, refresh loop, Kuma, push, Arcane, icon index or cache, reads no
`services.yaml` and makes no directory. The demo guard answers every `/api`
request itself, so the server makes no outbound request and writes no file;
the browser still loads the board's icons from the icon CDN (docs/DEMO.md).
It answers each read the web and Android apps send from the demo's fixtures
(a test walks both apps' source for them, `server/demo.reads.test.js`), and
any other `/api` path with the live server's 404 (`Endpoint not found`), so an
endpoint the demo doesn't know can't pass for an empty one (#437).
`/api/status` is the status model (4.7) of the demo's board.

Routers (each `server/routes/*.js`), mounted under `/api`:

| Mount | Auth | Purpose |
|-------|------|---------|
| `/api/auth` | public | login, logout, auth-status |
| `/api/health`, `/api/readyz` | public | liveness / readiness probes |
| `/metrics` | public | Prometheus exposition |
| `/api/services` | token | discovered nodes + services (background-refreshed, ETag); `services.yaml` for Settings, without its credentials, and its save over the version read (`/config`, ETag and If-Match, see 6) |
| `/api/status` | token | the status model (4.7), built once a background cycle (ETag, and its build time as Last-Modified; 503 before the first cycle) |
| `/api/integrations` | token | per-integration live data (background-refreshed, ETag); the Settings save and enable toggle (see 6); the connection test (`/test`, see 4.3) |
| `/api/display-config` | token | the display config blob, and its save over the version read (ETag and If-Match, see 6) |
| `/api/embed-check/:tabId` | token | whether a saved app tab's headers let the browser frame it (see 5, "App tabs") |
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
metrics and every configured integration that is due (see 4.3) into the bounded `cache.js`
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
`sources: { prometheus: { ok }, kuma: { ok } }`. With no nodes in
services.yaml there is nothing to read, so the refresh asks Prometheus one
probe query (`vector(1)`) and the payload carries only
`sources: { prometheus: { ok } }` (`noNodesCacheEntry`, #449): a first run with
a wrong `PROMETHEUS_URL` is a failed source, not an empty board. While the
first boot waits for nodes (6, #566) its discovery query takes the probe's
place, and the payload adds `discovery: 'waiting'`, which Settings → Nodes
reads to say the nodes will come by themselves. `/api/ups` carries its own
`ok` (and `configured: null`, since a failed query can't say whether there is a
UPS). Each node also carries `reachable`, from Prometheus' `up` series for that
node: true when any of its targets answered the last scrape, false when none
did, null when no `up` series has the node's label. It carries `failedReads`
too: the parts of the node whose queries failed this cycle (`NODE_READS`:
`reachable` for the `up` query, `cpu`, `mem`, `disk`, `uptime`, `temp`,
`containers`). Each query covers every node, so a failed one is that reading's
failure on every node: the `up` query failing leaves every node's reachability
unread, and a metric query failing that metric. A node missing from an answer
that succeeded has no data for that reading, which is not a failure.
A node `up` alone would leave unreachable is checked against Prometheus's own
state, not against what the process has seen (#470): a Prometheus that has
just started (a reboot that brings it up with JagHelm, or one back after an
outage longer than its lookback) answers every query with no series until it
scrapes. When the `up` query answered and a node has `up` 0, or no `up` series
and no CPU, memory or disk reading, discovery reads Prometheus's target list
(`GET /api/v1/targets?state=active`, `promTargets`), once for the cycle,
through the same client as the queries; a node's targets are those with its
`node` label. Prometheus writes an `up` sample on every scrape, 0 included, so
a target with no `up` series is never the host's fault. Why a node's `up` is
missing is decided in one place, `whyUpMissing` in `status/upMissing.js`
(#476, #477): discovery marks the node as its verdict's row of `UP_MISSING`
says and stamps it with the verdict (`whyNoUp`), the status model words the
node from the same row (4.7), and push pages from the model, so the three
can't disagree:

In the last column, "failing" means the Prometheus source fails with the
node's `problem` as its error while it still answers (`ok` stays true): only
that node is held, nothing else Prometheus feeds (#476).

| Verdict | When | The node | Prometheus |
|---|---|---|---|
| `scraped-and-down` | `up` 0, every target of the node scraped and down, or none of its own, or the list unread | unreachable, pages `host_unreachable` | answering |
| `no-target` | no `up` series, no target of its own, while the list names other nodes | unreachable, pages `host_unreachable` | answering |
| `no-targets-at-all` | no `up` series, and the list names none of the nodes (#477) | unread | failing |
| `not-scraped-yet` | a target of the node waiting for its first scrape, inside its wait | unread | answering |
| `not-scraped-too-long` | a target waiting past its wait (#476) | unread | failing, naming the targets |
| `answered-since` | `up` 0 and a target answered a scrape since the query | unread | answering |
| `stored-nothing` | no `up` series though a target of the node was scraped | unread | failing |
| `targets-unread` | no `up` series, and the targets read failed | unread | failing, with its error |

- A target waits for its first scrape (`health` "unknown", or no last scrape)
  for 3 of its own scrape intervals (`scrapeInterval` in the list; 1 m, the
  Prometheus default, when it gives none). Its wait counts from its last scrape
  when the list gives one, else from the first list that showed it waiting,
  kept per target in `data/prometheus-target-waits.json` (`targetWaits.js`):
  every waiting target of the nodes read is recorded whenever the list is
  read, and a wait is kept through cycles that read no list (its node reading
  `up` 1 from a healthy sibling target) and across a restart, so it neither
  restarts nor sends a false recovery and a second page. A list that no longer
  shows the target waiting forgets it. Before a wait old enough to make the
  target overdue counts, Prometheus is asked when it started
  (`GET /api/v1/status/runtimeinfo`, the later of `startTime` and
  `lastConfigTime`): started after the wait began, its targets may be new, and
  the wait starts again. When it can't say (a proxy, another backend), a gap
  of more than 5 minutes (or the target's own wait) since the last sighting
  starts it again. The homelab scrapes every 30 s, so a target never scraped is a problem 90 s
  after the first cycle that saw it, and pages once on the cycle after (a
  source's 2 failed cycles): "Prometheus hasn't scraped vm103:9100 (vm103) in
  3 scrape intervals".
- A target list that names none of the nodes JagHelm reads (empty, or only a
  federation or remote-write backend's own targets) can't tell a host from a
  series that never arrived, so a node with no `up` series there is
  Prometheus failing, "Prometheus lists no target for any node, and has no up
  series for <nodes>": one `source_down`, never a `host_unreachable` per node.
  `up` 0 still pages the host. A list that names some of the nodes is read per
  node: a node it doesn't name is `no-target`.
- `stored-nothing`: a first scrape that ended between the `up` query and the
  targets read looks the same, so `up` is asked again for those nodes. A node
  with its `up` series by then is `answered-since`; for one still without,
  Prometheus is failing for it, "Prometheus scraped <nodes> but stored no up
  series", as when a full disk fails its writes. Should that query fail, the
  node is unread with its error, as for any failed query.
- `up` 0 while a target of the node is not scraped yet, or has answered since:
  on a reboot Prometheus can scrape cAdvisor before it listens while
  node-exporter is still unscraped, which makes the node's `up` 0. A host
  really down has every target scraped and down within one scrape interval,
  so this delays its page by at most that.

A cycle in which every node has `up` 1 (or no `up` series but metrics) reads
no targets, so a Prometheus proxy that allows only queries costs nothing until
a node reads 0 or loses its `up` series. Prometheus counts as failed for the
cycle when any node query fails (`ok` false: everything it feeds is held), and
fails while answering when a node's verdict says so (only that node is held).
While a query
fails, or a node waits inside its first-scrape wait (`not-scraped-yet`,
`answered-since`: it passes within a scrape or so), no presence breadcrumbs are
drawn, since a container missing from the list may still be running. A node
unread for a verdict that lasts (Prometheus failing for it) holds back only its
own breadcrumbs, so a stuck target on one node doesn't hide a container gone
from another (#476). The status model makes what a failed source feeds unknown (4.7), and
only that: for a host, only the readings whose queries failed. Push holds an
unknown at its last known state, so a metric query that keeps failing holds
that reading's level on every host (and, for a host with no `up` series, its
reachability), and a host's `up` at 0 still pages. A missing payload (a cold
cache after a restart, or one past its TTL) counts as failed. So an outage of
Prometheus, Kuma or the NUT exporter sends no alert about what it watches, only
its own "monitoring source down" push, also when JagHelm starts into the outage
with no push snapshot (#461; 4.7, "Push"; and
[mobile/DESIGN.md](mobile/DESIGN.md), "Deterministic state-change detection").

#### Kuma monitors and containers

A Kuma monitor is one service, so it marks one container (#240): a down monitor
paints one card red, unless `services.yaml` maps it to several containers. It
sends one push either way (#407). Each cycle `assembleServices` (`refresh.js`) hands
`assignMonitors` (`monitors.js`) every shown, running container (the same name
on two nodes is two containers), plus the containers that stopped in the last
24 hours (the container registry's missing ones, kept for
`JAGHELM_PRESENCE_TTL_MS`, 24 hours by default), and the monitors are assigned
to them all at once. CI job containers take no part: discovery drops them, and
records of them the container registry already holds are skipped too.

1. **Explicit mapping.** A container's entry under `services:` in
   `services.yaml` can name its monitor, as a Kuma monitor's name (compared
   case-insensitively; with two of one name, the lower id), however unlike the
   names are:

   ```yaml
   services:
     immich-server:
       monitor: Immich              # on every node the container runs on
     gateway-npm:
       monitor_per_node:            # keyed by the node keys under `nodes:`
         pi1: NPM Pi Primary
         pi2: NPM Pi Secondary
     vaultwarden:
       monitor_per_node:
         vm103: Vaultwarden         # the pi2 replica gets no monitor
     gateway-tunnel:
       monitor: false               # no monitor, and no name matching
   ```

   `monitor_per_node[<node>]` comes first, then `monitor`; a node with no entry
   in `monitor_per_node` falls back to `monitor`, and to name matching when
   there is none. `false`, in either place, gives the container no monitor and
   keeps it out of name matching and out of the "no matching monitor" log line;
   `null` or an empty name is no mapping. Every monitor named anywhere in these
   mappings goes only to the containers mapped to it, whether or not they are
   on the board this cycle: while they are all absent, nobody has it, and an
   outage is drawn on its last-seen node. When a mapping names a monitor Kuma
   does not have, or a paused one (the `/metrics` source leaves paused monitors
   out), the container gets no monitor and is left out of name matching, so it
   takes nothing another container would have had. (It used to fall back to a
   name match: on 2026-10-19 the four gateway containers on the Pis, mapped to
   monitors Kuma lacks, all took "Pi Gateway (Ping)" that way.) That warns once
   per mapping per boot, and not while Kuma has given no monitors at all; a
   `monitor_per_node` key that is no node, or a value that is neither a name nor
   `false`, warns once too. `POST /api/services/config` refuses a mapping of
   the wrong type (`util/configSchema.js`). The Settings UI edits `monitor`
   only, and keeps `monitor_per_node` when it saves.
2. **By name, one container per monitor.** Every pair of a container and a
   monitor whose names match is ranked, and pairs are taken best first, each
   only while its container and its monitor are both free. Names compare
   lowercased with everything but letters and digits removed. A pair ranks by
   the kind of match: exact; then URL, a monitor named as a URL or hostname
   whose first label is the container name (`grafana.example.com`); then
   contains, one name inside the other (scored by the shorter one's length);
   then a shared word of 4 letters or more (scored by the total length of the
   shared words of 3 or more). Between equally good matches: a container that
   is not a stack's helper (its own words include none of `redis`, `db`,
   `postgres`, `cron`, `runner`, `proxy` and the like, so "Immich" goes to
   `immich-server`); then the board's node order; then the container name;
   then the monitor id. That is a total order, so the result does not depend on
   the order discovery or Kuma listed things in.

   A monitor goes only to a container with the best kind of match any container
   has with it. When that container holds a better monitor, the monitor is left
   unassigned rather than taken by a weaker lookalike: with monitors "Gitea" and
   "Gitea SSH", `gitea` takes "Gitea", and "Gitea SSH" goes to nobody, not to
   `gitea-runner` by the shared word.

Ties between nodes go by the board's node order, so the assignment depends only
on the current cycle's inputs and corrects itself after a container misses a
cycle. No memory of the last node is kept: one that only broke ties drifted to
a replica for good after one missed cycle (vaultwarden runs on vm103 and pi2).
Pin a replica's monitor to its node with `monitor_per_node` instead.

A stopped container competes only for a monitor that is down: that outage then
stays with the container that stopped (a red card under its name, the uid its
running card had) rather than passing to a running lookalike. Once the monitor
is up, or the container has been gone longer than `JAGHELM_PRESENCE_TTL_MS`, it
holds nothing: a running container can have the monitor (`nextcloud` renamed to
`nextcloud-app`), and the stopped one leaves a grey presence breadcrumb like any
container with no monitor. So does one whose down monitor is paused (a stale
heartbeat, or `active: false`, on the status-page path; `isFreshMonitor` in
`monitors.js`): a paused monitor draws no red card, so the container keeping
its grey card is what keeps it on the board (#438). A down monitor no running
container got is drawn on the stopped container's node, else its last-seen
node. When that stopped
container is the one the monitor last ran as, the monitor's last-seen node
comes first while it is on the board: the container registry keeps one record
per name, with the last node in the pass, so when both copies of an unpinned
replica stop (vaultwarden on vm103 and pi2), the red card is drawn on vm103,
where the monitor ran, not on pi2. Its card never takes the uid of a card
already on that node (its last container still running there, matched to
nothing or to something else now), and then goes under the monitor's name.
A grey breadcrumb is not drawn on a red card's uid either: when the stopped
container the monitor last ran as doesn't get it by name (a mapping that has
since gone), the red card is placed under that container, and is its one
card (#438). The model then reads that uid as the service, so the outage
pages; before #438 the grey card took the uid as a container, which push
doesn't read, and the outage sent nothing.

Such a card, of a monitor no container has ("Pi Gateway (Ping)", "NAS (Ping)"),
exists only while the monitor is down: up, it draws nothing on the board. The
push snapshot still has it (#390). Every active monitor no running container
got, up or down, is placed in one pass by `placeMonitor` (`refresh.js`), in id
order, so its uid does not depend on its status while its last container isn't
in the stopped list, nor on the order Kuma listed the monitors in. A down one
is the red card. The uid of an up one goes in
`upWithoutCard`, which the services refresh keeps beside the cached
`/api/services` payload, not in it: it is not served and does not change the
ETag. The status model reads each as an up service (4.7), and push reads it as
`up` unless a service card on the board has that uid (`buildServices` in
`push/snapshot.js`). A grey presence breadcrumb does not count (the model judges
it as a missing container): placement skips every other card's uid, so only a
breadcrumb can share it, normally the one the monitor's own stopped container leaves while the
monitor is up, and a recovery within `JAGHELM_PRESENCE_TTL_MS` of that
container stopping is sent rather than lost. So the monitor sends
`service_down`, then `service_recovered` on the same id. A paused monitor
(stale heartbeat, or `active: false`) and one Kuma no longer has are in
neither, so they send nothing. The entries come from Kuma, so the source
failure rules above apply to them: while Kuma fails, the whole services map is
held. While Prometheus fails with the container list missing, a monitored
container's monitor is unclaimed too, so up it is an entry under its card's
uid, and a recovery during the outage is sent when Kuma reports it. Only when
no node could be read at all is nothing placed; the recovery then waits for
the container to be seen again.

A monitor feeds one key of the push snapshot a cycle: the card of the running
container that has it, else its own uid. That key can move. A container takes
the monitor (one appears whose name matches); a stopped container holds it only
while it is down, so a down placement and an up one can differ (the down
monitor goes to an older `nextcloud` that stopped, the better match, and comes
back up on `nextcloud-app`, the container it last ran as); another container
takes it in the cycle it recovers (nextcloud stops, the monitor goes down,
nextcloud-app comes up healthy); or two monitors remember the same container
(left by the old matcher), and when the one earlier in id order drops out (a
Kuma Pending retry, a pause, a container claiming it) the other moves onto the
container's uid, and back when it returns.

So the push snapshot keeps the monitor's identity (#395). The services refresh
keeps `monitorOf` beside the cached payload, like `upWithoutCard` and for push
only: the id of the monitor each monitored uid carries, for running cards, red
cards, up entries, and the pending or in-maintenance monitors no card is drawn
for (`kumaWithoutCard`), which push holds at their last state (4.7). The snapshot stores it as `monitorOf`, next to
`services`, and the differ diffs a key against the monitor's last state rather
than the key's alone (`serviceHistory` in `push/differ.js`):

- A monitor that fed keys last cycle brings its state with it, wherever its
  keys moved. Each outage is one `service_down` and one `service_recovered`,
  each on the card the monitor has at the time: the recovery can come on a
  different card than the down push.
- A monitor that an explicit mapping gives several cards (tailscale on pi2 and
  vm103) is one event, on the first of its cards by key, naming every node
  (#407). One of its cards leaving or coming back during an outage changes
  nothing: the outage is still one `service_down` and one `service_recovered`.
- A key whose monitor last cycle feeds another key now starts with no
  previous status, whatever feeds it now: its state went with the monitor, so
  the key sends no false recovery and no repeat `service_down`.
- A key whose monitor has gone from the snapshot (paused or deleted: the
  `/metrics` source leaves a paused monitor out) and that no monitor feeds now
  starts with no previous status too: its state was the monitor's, so a
  running card whose monitor is paused or deleted while down sends no false
  recovery, as a monitor with no container sends nothing then. Unpaused while
  still down, it pages again, as one with no container does.
- Every other key keeps its own previous state, as before: a card that had no
  monitor last cycle, and a key that a monitor new to the snapshot feeds now
  (one deleted from Kuma and added again, under a new id). Taking a monitor
  that was already up sends nothing.

`monitorOf` is part of `alertStateKey`, so the file is rewritten when only the
monitor of a key changes, and a restart keeps it. While a source fails, a key
kept from the previous snapshot keeps its monitor with it. A snapshot written
before #395 has no `monitorOf` and diffs as one where no key had a monitor,
which is how every key was diffed before, so the deploy sends nothing; its
first cycle writes the new format.

Beside `upWithoutCard` and `monitorOf`, the services refresh keeps four more
things for the status model only (4.7), so `/api/services` keeps its shape and
meaning (spec §6.3): which running cards' monitors Kuma reports pending or in
maintenance (`kumaStatusOf`; their `status` stays `unknown`), the monitors no
running container got that are pending or in maintenance (`kumaWithoutCard`,
placed after the up and down ones so they take none of their uids), which grey
presence cards were a Kuma monitor's last container, with Kuma's status for
that monitor (`backedBy`, which the model judges them by, #438), and why
Prometheus or Kuma failed (`sourceErrors`). Kuma's own status (`up`, `down`,
`pending`, `maintenance`) comes from `kumaStatus` on each monitor
(`kumaMetrics.js`, both the `/metrics` and the status-page paths).

The service registry's `seen` list has one record per monitor, the last node in
the pass for one mapped explicitly to a container on several nodes. A record is
written only when a monitor's node or container changes, so cycles that match
the same way write nothing, whatever order discovery returns containers in.

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
`ARCANE_RELEASE_CHECK_HOURS` (default 6). Push is ready before the first poll and release
check run (#235). It diffs against persisted state and emits
push events through `dispatchEvents`, and records Arcane's scheduler-started update and prune
runs, and its image watcher's checks, into the cron store. On its own weekly timer it also
reads Arcane's stored vulnerability scan results for the environments in
`ARCANE_VULN_DIGEST_ENVS` and pushes a digest per environment when something is new
(`arcane_vulns`), recording each digest as the `arcane-vuln-digest` cron job. Its `arcane_*` push types map to the `watchtower` preference category (labelled Updates
in the app). Those pushes are events, not states (spec §6.2): only an agent is a status model
entity (4.7). The poller keeps each environment's agent health from the last environment list
it read (`agents()`), and `arcane/agents.js` hands it to the model, which makes no Arcane
request of its own. Setup: [arcane/SETUP.md](arcane/SETUP.md).

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
  IPv4-mapped IPv6 (an IPv6 literal carrying an IPv4 address is checked as that
  address, in every mode), with a `trusted` flag exempting operator infra
  (Prometheus/Kuma) from the strict private-network block.
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
- **A request carries the resolved credential, never a `$secret:`
  reference, and nothing when a stored one can't be read** (#425, #428).
  `resolveIntegrationConfig` (`lib/config.js`) keeps the entry's own
  `token`, `password` and `username` (a Settings save writes `$secret:`
  references for the password and token; any of the three can be one written
  by hand) and puts the resolved values in `_token`, `_password` and
  `_username`. Every request builder reads a credential by one rule,
  `credentialToSend` in `lib/extract.js`: the auth header (`buildAuthHeaders`
  in `lib/auth.js`: basic, bearer, header), the query-auth key
  (`applyQueryAuth`), each session login body (`lib/session.js`) and an
  endpoint's `{token}`, `{password}` or `{username}` (`resolveEndpoint`). A
  credential whose `_` value is or looks like a `$secret:` reference, or is
  empty while the entry's own value is one (its secret is missing or won't
  decrypt) or while a secret stored for it by name, such as a preset's keyed
  `integration_<key>_password`, won't decrypt (`_unreadableCredentials`),
  throws `UnresolvedSecretError` before the request is built, so nothing is
  sent. The integration's error names where the credential goes
  ("the password in the login", "{token} in the endpoint") and says the
  stored credential couldn't be read, never the reference. It says to enter
  it again in Settings when the form has that field (the token, and a
  preset's username and password), and to check the integration's entry in
  `services.yaml` otherwise. It is not `authRejected`: the refresh loop backs
  off as from a failed fetch and never parks it as a refused login (#239),
  and the config fingerprint changes once the secret reads again, so it is
  attempted at the next refresh, as after a save. A session integration
  builds its login bodies and fills in its endpoint before it logs in or
  uses a cached token, and refuses only a credential its login body fills
  in. An endpoint's credential placeholder takes the `_`
  value whenever the config has one, so a preset's `.env` value wins there
  too, and the raw value only when there is no `_` key. It goes into the URL
  encoded with `encodeURIComponent` (#429), so a `&`, `#`, `/`, `?`, space
  or `@` in it can't cut it short or move it into another part of the URL;
  the origin checks (#556) run on the URL as sent. Any other placeholder
  (Cloudflare's `{account_id}`, NextDNS's `{profile_id}`) goes in as written,
  and one whose value looks like a reference, in a field that is never
  resolved, is refused the same way. A `$secret:` typed as a password or
  token is refused by the save and the connection test (400, see 6), so it
  never reaches a request either.
- **An integration's URL carries no credential** (#422). A user name or
  password before the host (`https://user:pass@host`) or a key in the query
  (`SECRET_PARAMS` in `util/redact.js`: `key`, `apikey`, `token` and the
  rest) never worked: fetch refuses userinfo, and the endpoint is appended
  after the URL, so the query never reaches the API as one.
  `urlCredential` (`util/redact.js`) tells such a URL, and
  `lib/urlCredential.js` words the error, which names the form field the
  credential goes in for the preset's auth mode (Username and Password, API
  Key, API Token) and never the value. It reads userinfo from the text as
  well as the parser (#419): a password of digits then a raw `/`, `#` or `?`
  makes `http://jag:1234/x@host` parse as host `jag`, port 1234, so
  `scheme://word:digits`, then `/`, `#` or `?`, then an `@` anywhere after,
  counts; so do an unparseable URL with an `@` after `://` and one with no
  `://` holding an `@` (the scheme left out). It is the one test: the source
  URLs (4.4), ARCANE_URL, this save and test, the resolve below and the
  config read all ask it. The Settings save and the connection
  test refuse one (400 `{ error, field: "url" }`, before anything is read or
  stored), and the form shows it beside the URL field and focuses it. The URL
  a refresh resolves (`resolveIntegrationConfig` in `lib/config.js`), from the
  entry, its preset's `.env` variable (`GITEA_URL`, `NTFY_URL` and the rest)
  or the keyed `integration_<key>_url` secret, is checked there, the one place
  every refresh, connection test and origin reads it (#419): a refused one
  resolves to no URL and `_urlProblem`, so nothing is requested and the
  refresh fails with it. It names where the URL came from ("GITEA_URL
  carries…", "The stored url (secret integration_gitea_url) carries…", or
  "Its URL carries…" for the entry), never the value, and is warned once per
  integration until it changes. The config read masks one in `services.yaml`
  (see 6), so the form shows it empty with a note to enter it without the
  credential.
- **The connection test is a refresh of the unsaved form** (#427).
  `POST /api/integrations/test` takes what the save takes and merges it into
  the stored entry by the save's own merge (`mergeForm` in
  `routes/integrations.js`), refusing what the save would refuse (a URL with
  a credential, an edit whose entry is gone, a taken key). The merged entry
  goes to the handler as the refresh loop hands it an entry
  (`integrationInput` in `lib/config.js`: the entry's preset, else its key),
  and through `resolveIntegrationConfig` and `fetchIntegration`, so a custom
  integration is tested at its stored endpoint, with its extra endpoints,
  auth mode and fields, and the test makes exactly the requests the next
  refresh would. Credentials resolve as the save would leave the secret
  store: the merge lists what the save would store, move and drop, and the
  test resolves through that overlay (`resolveIntegrationConfig`'s
  `secrets`), so a typed password wins over the stored one as it will once
  saved, a blank one is the stored one, and a moved or dropped keyed secret
  reads as it will. Nothing is written: not `services.yaml`, not
  `secrets.json`, not the backoff state; a session preset logs in afresh and
  keeps no token, so a cached token can't pass a wrong password and an
  unsaved password's token can't serve the refresh. The answer is
  `{ ok: true }` or `{ ok: false, error }` with the error the refresh would
  show, never the fields read: a session login's error carries the last
  login's reason (redacted), and a reply that is not JSON says "The reply is
  not JSON (text/html)", never a word of the body (`readJson` in
  `lib/http.js`, for every read and login). Presets have no `testEndpoint`
  any more. A custom integration with no endpoint (the form has no field
  for one) is answered without a request. A URL moved to another origin
  with the stored credential left blank is refused before anything is sent,
  as the save refuses it (#556, below).
- **Every request stays on its integration's URL's origin** (#556). The
  data read, each extra endpoint, every session login and the read after it
  (a cached token's too) are checked before they are sent
  (`assertRequestOrigin` in `lib/origin.js`): the request URL is the URL
  with the endpoint appended, so an endpoint, or a name an upstream answer
  fills in (Proxmox's node), could lead onto another host
  (`http://npm.lan` + `.evil.example/x`); one on another origin than the
  URL's is not requested, with or without a credential, and the
  integration says its endpoint leads away from its URL. No preset needs a
  second origin. A session token is cached per entry (its storage key, its
  URL's origin and the login endpoint), so another entry on the same URL
  never reads with it.
- **A stored credential goes only to the address it was entered for**
  (#556). Each secret in `secrets.json` carries the origins it may go to
  (`scheme://host:port`, the default port written out: `originOf` in
  `lib/origin.js`). `resolveIntegrationConfig` puts on the config the
  origins every credential it read from the store allows, intersected
  (`_credentialOrigins`); a credential from `.env` or typed into
  `services.yaml` by hand adds none, as both are trusted as access to the
  host and its files. Every request such a config makes checks its own URL
  first, after the endpoint is joined in (`assertCredentialOrigin`, the
  second wall of `assertRequestOrigin`): the data read and each extra
  endpoint (`handler.js`), and every session login and the read after it,
  all before the first login (`lib/session.js`). One on another origin is
  not sent, and the integration's error says to
  re-enter the credential for this address, never the secret's name or an
  origin; it is a failed fetch that backs off, not a refused login. A URL
  that doesn't parse is left to the fetch, which never sends it. The
  check runs at the request, so it holds whatever put the URL or the
  `$secret:` reference there: the form, the whole-config save, a hand edit.
  A redirect off the origin carries no credential (above), except the
  same-host `http://` to `https://` upgrade. A password or token typed into
  the form is stored for the origin of the entry's URL as a refresh
  resolves it; the value the name already held, typed again, adds that
  origin instead (`originsOnEntry` in `secrets.js`), so two entries sharing
  one password keep working once it is entered for the second. The form and
  the whole-config save run one check (`integrations/movedCredential.js`):
  any credential the config read masks on the entry (a password or token,
  plaintext or `$secret:`, a header under `extraHeaders`, a login body, an
  endpoint's key, a placeholder's value), the keyed password or token, or a
  username that is a reference, that the edit keeps while the entry's URL
  moves to another origin is a 400 naming its place (see 6). A secret stored through
  `PUT /api/secrets/:key` goes to the origin of the `url` sent with it, or
  nowhere. The origins never leave the store.
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
  fetch errors would otherwise echo. A credential filled into an endpoint's
  path (`/api/{token}/status`) is one redaction can't recognise, so every
  call that sets `credentialInUrl` also passes `shownUrl`, the URL with each
  credential back as its placeholder (`resolveEndpoint`'s `shownPath`,
  `applyQueryAuth`'s `?apikey={token}`). `lib/http.js` `safeFetch` swaps the
  request URL in an error for it before redacting, in the form it was passed
  and parsed and on a same-origin redirect hop; without one it withholds all
  but the origin (#425).
- **Only the computed result is kept.** A poll returns what the preset
  computes (its fields, plus structured data such as Proxmox's VMs, storage
  pools and last backup), and drops the upstream response once the preset has
  read it. No route returns an integration's upstream response.
- **Session-auth presets** (Nginx Proxy Manager, Portainer, PhotoPrism) get a
  managed login session via `lib/session.js`; the same SSRF guard still applies.
- **A failing integration backs off; a login refused twice waits for a
  config change** (`integrations/backoff.js`, #239). The refresh loop fetches
  only the integrations that are due, through at most 6 at a time. After a
  failure the next attempt waits 30 s, then 1, 2, 4 and 8 min, then 10 min
  each time; a success resets it. Whether an attempt is due is worked out on a
  monotonic clock (`performance.now()`), so a wall-clock step doesn't move it.
  A refused login (`authRejected` from `fetchIntegration`) is a 401 or 403
  from the request's own origin to the session login (to every one of them
  with an `authFallback`) or to a data request that carried the integration's
  credentials (basic, bearer, header or query). A 401 or 403 to a request
  without credentials, one from another origin after a redirect (which
  dropped the credentials, see above), a data read after a good session login,
  and every other failure back off instead.
  - **Two refusals in a row park it.** A first refused login backs off like
    any failure, so a proxy, a WAF challenge or an app answering 403 while it
    rate-limits recovers on the next attempt. A second refusal in a row, under
    the same config, parks the integration in `auth_failed`: it is not
    attempted again until its config changes. Any other outcome in between
    starts the count again. A wrong password so costs two attempts per config,
    well under the five failed logins that qBittorrent and fail2ban allow by
    default before they ban.
  - **What counts as a config change.** Its config is a fingerprint
    (`configFingerprint` in `lib/config.js`, a SHA-256) of its entry in
    `services.yaml` with its URL and credentials resolved, so a hand edit
    picked up by the config watcher, a save in Settings, and a new value for
    the same `$secret:` each count. Each integration is resolved once a cycle
    and the fetch reuses that config. A save in Settings retries it at the next
    refresh even when nothing changed (`retryIntegrationNow`), and a save made
    while its fetch is in flight holds for the refresh after that. The state
    is in memory, so a restart attempts every integration. Removing an
    integration, or disabling it, drops its state only when a refresh runs
    without it: a hand edit that removes and re-adds it, or disables and
    re-enables it, between two refreshes leaves it parked, since its config
    is the same.
  - **How it is served.** An integration that is not due is not queued, so it
    holds no fetch slot and spends no timeout: its entry is the one its last
    attempt left, served again, `_error` included, as the failure was served
    when it happened (no last good data). A parked integration's `_error` ends
    with a fixed hint, "(login refused twice; not retried until it is saved in
    Settings)", the same for every integration: a save in Settings keeps an
    entry however it was written (see 6, #402), so it is a retry for any of
    them.
  - **`_status`.** Every entry in `/api/integrations` carries
    `_status: { state, since, failures, nextAttemptAt }`, with `state` one of
    `ok`, `backing_off` and `auth_failed`, `since` when that state began,
    `failures` the failed attempts in a row under the current config, and
    `nextAttemptAt` the next attempt (null when ok, as it is fetched every
    cycle, or auth failed, as it waits for a config change). Both times are
    wall-clock ms since the epoch, set once per attempt, so none of the values
    change between attempts and the payload's ETag holds. The payload lists
    the integrations in config order. The web app does not read `_status` yet
    (#290 builds the status model on it). It shows `_error` as the note on
    the service card the integration is matched to, so the hint is on screen.

### 4.4 Config, secrets, and persistence

- **Display config** (`config.js`) is **copy-on-read** (`getConfig()` returns a
  `structuredClone`) and saved via a synchronous **atomic** write
  (temp -> fsync -> rename), only over the version of `services.yaml` its
  caller read (`writeConfig`, #423, see 6), so a route can't mutate shared
  state, a stale Settings tab can't save over a newer file, and a crash
  can't truncate the file ([ADR 0001](adr/0001-atomic-file-writes.md),
  [ADR 0004](adr/0004-config-copy-on-read.md)). It is validated against a Zod
  schema (`util/configSchema.js`) on read, so a malformed file fails loudly.
- **Secrets** (`secrets.js`) are AES-256-GCM encrypted with a **per-install
  random KDF salt** (`data/.secrets-salt`, legacy-static-salt fallback). A
  `DASH_SECRET` that is an example the docs print, or a generic placeholder
  (`util/exampleSecrets.js`, any case, spaces or one pair of quotes around
  ignored; the session stamp refuses the same list, 4.5), is no key: the
  store reads and stores nothing, as with none. One error line (with how
  many `secrets.json` holds), logged once rather than at every read as a
  missing one's warning is, says to generate a real one, restart, and enter
  again any credential stored under the example: it stays in `secrets.json`
  as it is and won't decrypt under the new key (#576). A save of a
  credential meanwhile answers 500 with the same steps (`NO_KEY_ERROR`).
  `util/exampleSecrets.test.js` reads every `DASH_SECRET` the docs git
  tracks print (an `.env` line, a YAML key or block, the default of a
  compose interpolation) and fails, naming the file and line, when one
  isn't in the list. All credential stores write `0600`. A change `secrets.json` can't take throws
  and leaves the store as it was, so a secret is never held only in memory.
  An integration's secrets (the `integration_*` names a Settings save
  writes) live and die with its entry in `services.yaml`, which is the
  record (#415, #502). A save stores what it needs before writing the file;
  when that write fails or is refused, or a secret can't be written, the
  store goes back to its snapshot from before the save (`snapshotSecrets` /
  `restoreSecrets`), so `secrets.json` ends byte-for-byte as it was. A save
  that creates an entry first clears what an older delete left under its
  key. A delete, or a rename's old names, drops the secrets no remaining
  entry uses once the file is written. A secret is in use while an entry's
  key makes it that entry's keyed secret, or a `$secret:` reference anywhere
  in the config names it (`integrations/unusedSecrets.js`); other names are
  the user's. At boot one log line counts the unused integration secrets,
  never naming them, and nothing is deleted: a hand edit (an entry commented
  out, a typo, a rename) makes a secret look unused that is still wanted.
  Each secret is stored with the origins it may be sent to, in clear beside
  its encrypted value (`{ iv, data, tag, origins }`, #556, see 4.3); a copy
  (a rename) keeps them. A secret stored before #556 has none and goes
  nowhere until the boot binds it (`integrations/secretBinding.js`): once,
  at boot when `services.yaml` is there and can be used, else at its first
  good load from disk (the file put back or fixed by hand, never the
  default one the first boot writes), each such secret is bound to the
  origin of every entry that uses it (its keyed name or a `$secret:`
  reference; a disabled entry counts), and one no entry uses to none, in one
  write and one info line with the counts. A bound secret is never bound
  again, so a reference added later can't take it to a new address at the
  next restart; a whole-config save made while the binding waits binds each
  waiting secret it names to nowhere before it is written.
- **Source URLs** (`sourceUrls.js`, #419): the monitoring sources read
  `PROMETHEUS_URL`, `KUMA_URL` and `GITEA_URL` there (`sourceUrl`,
  `sourceUrlSet`) and nowhere else; the Gitea integration preset reads
  `GITEA_URL` as its URL too, through the integrations' check (4.3). One that
  carries a credential (`urlCredential`, 4.3: `user:pass@` or a user alone,
  as the parser reads it or not, a password with a raw `#`, `/` or `?`,
  whitespace or a quote, a second URL glued on, the scheme left out, or a key
  in the query) is refused: it is never requested or logged, and its source
  is off. None is needed: Kuma's key goes in
  `KUMA_API_KEY`, Gitea's token in `GITEA_TOKEN`, and JagHelm has no
  Prometheus login. Node's fetch refused a URL with userinfo anyway, so no
  working setup is lost unless a path held a raw `@` after a port (write it
  `%40`). The
  problem names the variable and where the credential goes instead, never
  the value: the boot warns it once (`warnRefusedSourceUrls`), discovery and
  the Kuma reads fail every cycle with it and ask nothing, logging nothing
  more; a first boot saves no `services.yaml` and doesn't wait for nodes,
  with one line (6, #566); Gitea's panel is off as without a URL; the status model makes the
  source off (4.7); `/api/health` lists it (4.6), and `/api/readyz` reads it
  as not ready without asking. `ARCANE_URL` is refused by the same
  `urlCredential` (`arcane/config.js`): the integration is off, with one
  warning, and nothing is requested.
- **Data dir** is single-sourced via `util/dataDir.js` (`JAGHELM_DATA_DIR`) so
  secrets/auth/sessions/config/cron and the icon cache never split across
  locations.

### 4.5 Auth & rate limiting

scrypt password hashing (`auth/passwords.js`), sessions that survive a restart
(`auth/sessions.js`), and a brute-force **login rate limiter** (`auth/rateLimit.js`).
A reusable `util/rateLimiter.js` additionally throttles the abuse-prone
integration connection-test endpoint.

Sessions (#250, ADR 0002) are kept in memory and in `sessions.json` in the
data dir (atomic, `0600`), keyed by the SHA-256 of each token, never the token;
a lookup hashes the presented token. A session ends after 30 days without use
(`SESSION_IDLE_MS`; every request it authenticates is a use) and 90 days after
sign-in in any case (`SESSION_MAX_AGE_MS`). A sign-in, a sign-out and a
password change are written before the route answers; a use is written once it
is an hour past the one on disk, so a crash loses at most an hour of the idle
window. At most 50 sessions are kept (`MAX_SESSIONS`): a sign-in past that ends
the least recently used. The file is read on first use. One that can't be read
is no sessions and one warning that never quotes it; a write that fails is
logged and the sessions in memory carry on, except that a sign-out or password
change whose write fails removes the file, so a restart can't bring a revoked
session back. If the file can be neither written nor removed, `POST
/api/auth/logout` answers 503 (`revocationSaved()`): the session has ended in
memory, the client sends the sign-out again, and each retry writes again. The
file carries a stamp of the user and password (`credentialStamp()`,
`auth/passwords.js`): SHA-256 of `auth.json`'s hash when a password was set in
Settings, else an HMAC under a key derived from `DASH_SECRET` (one of at
least 16 characters that is not an example from 4.4's list), else scrypt. A
restart after `DASH_PASS`, `DASH_USER`, `auth.json` or `DASH_SECRET` changed
starts with no sessions. A sign-in with a user name or password that isn't a
string is refused with 400.

Once a session has ended, every protected request with its token gets a 401.
`apiFetch` (`src/api/client.js`)
hands a 401 from any `/api` call outside `/api/auth/` to the shell's
auth-expired handler, with the token the request was sent with (none counts
too: a tab loaded while the server had no password). It does so once per
token: other 401s wait while the handler runs, a rejected handler is logged
and retried once on the next 401, and a late 401 for a token since replaced is
ignored. A 401 from `/api/auth/` (a wrong password) is about the password sent.
The web app (`App.jsx`) first reads the stored token: if another tab signed in
since, it takes that session and carries on. Otherwise it signs out like the
button, as the Android app does: the sign-in screen replaces the app, every
poll stops, no header keeps the last status's colours, and signing in starts
the polls again (#492). Before, an open web tab kept polling with the dead
token, a 401 each time.

Signing out ends the session on the server too (#507). `POST /api/auth/logout`
deletes the presented token's session from the store and from
`sessions.json` before it answers, and only that one: the token gets a 401 on every protected route from then on, and the
user's other sessions (another browser, the phone) keep working. Deletion is
the revocation; there is no deny list (ADR 0002). It answers 204 for any
token, unknown, expired, already revoked or none (503 only while a sign-out
can't be saved, above), so a second sign-out or
another tab never meets a 401 and the answer says nothing about a token. A
real sign-out logs `signed out` at info with the user, never the token. Both
apps send it through `revokeSession()` (`src/api/client.js`) and clear the
session locally at once, without waiting for the answer, so a network error, a
hang or a 5xx can't keep anyone signed in, and closing the tab or the app
meanwhile leaves no token stored. The call never rejects and gives up after
5 s (`SIGN_OUT_TIMEOUT_MS`). The web app's Log out button sends it for the
tab's token, and for the stored one too when another tab signed in since, so
it signs the browser out (that tab follows on its next 401). The 401 path
above doesn't send it (that session is already dead), nor does a tab that
learns of another tab's sign-out from its 401. The Android app sends it on Log out and
Forget this device, not on its 401 path, and not on the connection screen's
Change server, which shows only when the server can't be reached. Just before
it, those two send `DELETE /api/push/register`, so the phone stops getting
pushes, and delete the phone's FCM token (#531, see docs/mobile/DESIGN.md). What
the phone can't finish (offline, a hang) it keeps with the session it ended
and sends again to that server at the next app start, connection or sign-in
(#539): `revokeSession()` answers whether it reached the server,
and takes the server's address for that retry. A server
older than the route answers 404 (or 401), which changes nothing: the client
signs out locally as before.

### 4.6 Observability

- **Structured logging** (`util/logger.js`) with redaction -- no URL credentials
  or secret query values in logs. Every string a line carries goes through
  `util/redact.js` as the logger writes it: the message, each field at any
  depth, object keys, an Error's message and properties, and a URL object
  (written as its address). A URL loses its password (`user:[redacted]@`, any
  scheme; a user with no password, often a token, is redacted whole), secret
  query values and, for http(s), its query string, and keeps its scheme, user
  and host. A URL the parser refuses, such as one with a raw `#` or `/` in its
  password, loses everything between `://` and its last `@`. So does one that
  parses only as `host:port` because the password is digits before a raw `#`,
  `/` or `?` (#419: `http://jag:1234#x@host` reads as host `jag`, port 1234):
  `://word:digits`, then `#` or `?` and text up to an `@`, or `/` and a first
  path segment, not empty, running to an `@` with no `?` or `#` before it,
  loses everything up to that `@`. Any URL of that shape does, so
  `http://host:9/x@y` loses its host too; `/@babel/core`, `/?e=a@b` and an
  `@` further along a path (`/users/@me`) stay. Not caught by text: a
  password holding whitespace or a quote (the token ends there), one with a
  second `/` (`http://jag:1234/x/y@host`), and a second URL glued to the
  first. The URLs likeliest to carry these (the source URLs, every
  integration URL, ARCANE_URL) are refused by `urlCredential` instead, which
  catches all of them (4.3, 4.4), so they are never used or logged. Redaction is by
  text, not by field name: a header map or an `apiKey` field would be written
  as it is (no line logs one). So a parser's error is not logged or answered
  as it is (#504): js-yaml's message shows the lines around the bad one and
  V8's JSON error quotes the text near it, credentials and all. The reads of
  services.yaml, secrets.json, auth.json and display-config.json log only the
  reason and the position (`util/parseError.js`), and a reason loses
  any text of the file it quotes (an unquoted value read as a YAML alias or
  tag). A log call never throws: a circular reference is written as
  `"[Circular]"`, a BigInt as a string, and a line that still can't be
  written keeps its module and message with a `logError` saying why. The
  running server writes to stdout/stderr only through the logger.
  `LOG_LEVEL` (`debug|info|warn|error|silent`, default `info`) filters it.
  Success lines every refresh cycle would repeat are debug, while a refresh
  that keeps failing still logs its own error each cycle. At info: a cycle that
  took 5 s or more; a change in the cycle's set of failed refreshes (a refresh
  that returned null, or an integration with an `_error`, which a backed-off
  one keeps until it answers); a Kuma load whose
  monitor count or source changed; and one line per boot for containers no
  monitor went to. A `services.yaml` mapping to a monitor Kuma does not have
  (or a paused one), a `monitor_per_node` key that is no node, and a mapping of
  the wrong type each warn once per boot. Prometheus failing (any node query of the cycle,
  or a node whose missing `up` is Prometheus's problem: the targets read
  failed, no `up` series stored for a node it scraped, a target waiting too
  long for its first scrape, no target for any node; 4.2) and Kuma failing (no
  monitors loaded: unreachable, non-2xx, or a status page with none) each warn
  once, with the error, and their recovery logs once at info with how long it
  was down; the failed cycles in between log at debug
  (`util/sourceHealthLog.js`). A failed integration attempt logs its error;
  one parked by a second refused login in a row also warns that it waits for
  a config change, and the first success after failures logs at info
  (`integrations/backoff.js`).
- **Access log** (`accessLog.js`): one line per request with its full path and no
  query string or fragment. `accessLevel()` picks the level (#492): 5xx at
  `error`; at `info`, every 4xx (a 401 or 403 included, so a signed-out tab or an
  unauthenticated poller still shows), every request of 300 ms or more
  (`SLOW_REQUEST_MS`, the feed-latency SLO line), and every request with a method
  other than GET, HEAD or OPTIONS (config saves, cron reports, sign-ins and failed
  sign-ins); a fast successful read, such as a dashboard poll's 200 or 304, at
  `debug`, so `LOG_LEVEL=debug` shows every request. A sign-out is a POST, so
  its line is at info too, and a real one adds `signed out` with the user
  (4.5); one with a dead token or none logs only its request line. `/metrics`,
  `/api/health` and `/api/readyz` are not logged unless they fail (5xx).
- **Prometheus metrics** at `/metrics` via `prom-client` (`metrics.js`): request
  rate, latency histograms, refresh-loop health.
- **Two probes**: `/api/health` (liveness; reflects refresh-loop liveness -- 503
  when wedged) and `/api/readyz` (readiness; distinguishes "not ready yet" from
  "down"), backing the Docker `HEALTHCHECK` and the deploy gate. `/api/health`
  also has `statusModel` (#440): `{ state: 'starting' }` before the loop's
  first cycle, `{ state: 'ok' }` while the status model builds, and
  `{ state: 'degraded', error, since, failedCycles }` while it throws: the
  error's class only ("TypeError", never its message, which can quote the
  input), when this process saw the run begin (ISO) and how many cycles in a
  row. It doesn't change `status` or the HTTP code: the loop is alive, a
  restart can't mend the input, and the deploy gate's `"status":"ok"` would
  roll a deploy back over it. It is the process's memory, so after a restart
  it counts from that restart's first cycle (push keeps its own count in the
  snapshot, 4.7). Beside it, `config` (#505): `{ state: 'ok' }`,
  `{ state: 'discovering' }` while the first boot waits for nodes with no
  `services.yaml` yet (#566, 6; nothing is wrong with a file that isn't there
  yet, and a refused `PROMETHEUS_URL` never waits, so it says `ok`),
  `{ state: 'unparseable', line }` while `services.yaml` is no usable config
  (`line` null for an empty file, one that isn't a mapping, or an error with
  no position), or `{ state: 'unreadable', code }` while it is there but
  can't be read (#536: `code` the read error's, `EACCES`, `EISDIR`, `EIO`…,
  or null), as of the file's last read (`configHealth` in `config.js`,
  `configHealthNow` in `firstBoot.js`).
  Never its text or its path, and it doesn't change `status` either: a
  restart can't fix the file. And `sourceUrls` (#419): each source URL
  refused for holding a user or password (4.4), by source,
  `{ state: 'refused', variable, problem }` (`{}` with none, so the public
  probe doesn't say what is set up); the variable and the problem, never the
  value, and `status` stays as it is. And `push` (#579): `{ queued,
  oldestAgeS }`, how many pushes wait in the outbox and the oldest one's age
  in seconds (`{ queued: 0, oldestAgeS: null }` with none, or with push off),
  so a key Google refuses or a long outage shows; `status` stays as it is. `/api/readyz` reads a refused
  Prometheus or Kuma as not ready, asking nothing.

### 4.7 Status model

`server/status/` judges every entity JagHelm watches, once, on the server (spec
§6, #290), so no client and no push path judges one for itself. The background
loop builds it once a cycle, after the refreshes (`updateStatus` in
`refresh.js`, #292): `/api/status` serves the result and push sends from it
(see "Push" below). Built from the homelab-shaped fixture (4 nodes, 63
entities), one build takes about 0.04 ms; its inputs are the cycle's cached
payloads and one read of `cron-jobs.json`, which push no longer reads itself.

**`buildStatus({ inputs, thresholds, memory, now })`** (`model.js`) is a pure,
deterministic function: the same inputs, memory and clock give the same JSON,
whatever order the payloads list things in. It returns `{ status, memory }`;
`memory` is for the next call only (levels, "for N cycles" runs and each
entity's `since`) and is never served. `createStatusTracker({ seed })`
(`index.js`) keeps the memory from one cycle to the next. The memory lives in
the process, so the loop seeds it, before its first build, with the level of
each host reading that the push snapshot file holds (`memoryFromLevels`, push's
`heldLevels`), and with when each held reading's hold began (`heldSinceOf`,
#469, below), when push is set up (#361), for the nodes `services.yaml` still
has. A reading inside its hysteresis band after a restart is still over its
line: push sends neither a second alert nor a false "back to normal". The
snapshot is rewritten whenever a level changes, or a hold begins or ends, so
the file is never behind the last push. A snapshot written before #292 holds readings, not levels: it is read
as the levels they give (`upgradeSnapshot`; a reading at or over its line is at
that line's level), so the first cycle after the deploy compares levels like
any other.

**The loop's status step never fails** (`runStatusAndPush` in `refresh.js`). If
the model throws on an input it can't read, the error is logged once (again
only when it changes, and one info line when the model builds again, with how
many cycles it failed), `/api/status` keeps serving the last status, and push
diffs, sends and advances nothing the model judges, so the next cycle the
model builds diffs against the last good snapshot and a change made meanwhile
is still sent. The failure is a source of its own (#440): its second failed
cycle in a row sends one "JagHelm status check failing" and the cycle it
builds again one recovery (see "Push" below), and `/api/health` reports it in
`statusModel` (4.6).

**Inputs** (`readStatusInputs(caches)`, the same cache seam as the push
snapshot): the cached `/api/services`, `/api/ups` and `/api/integrations`
payloads, what the services refresh keeps beside its payload (4.2), the cron
store's statuses, whether `KUMA_URL` and `GITEA_URL` are set, which source
URLs are refused for holding a user or password (`refusedSources`, by source,
its problem: `sourceUrlProblems`, #419), and the cycle's error set
(`runCycleRefreshes`, for Gitea). Three more come from elsewhere
(#291, #505), with no read of their own:

- **`backupJobs`**, which cron jobs are backups: `display-config.json`'s
  `backupJobs`, a list of `"node:job"` keys (`"pve:proxmox-backup"` for the
  Proxmox vzdump results, which the PVE notification webhook reports as a cron
  job), read from the display config the loop already holds for the thresholds
  (`status/backupJobs.js`). A job is a backup only when the list names it,
  never by its name. An entry that isn't a `"node:job"` string is dropped, with
  one warning until the list changes; the save itself
  (`POST /api/display-config`) keeps what it is sent, since a web save sends
  back the whole config it read. Settings edits the list from Phase 3 (P3-3).
- **`arcaneAgents`**: each Arcane environment's agent, `{ env, state }`, with
  `state` the poller's `envHealth` from the environment list it last read
  (4.2, `arcane/agents.js`): `null` when Arcane isn't set up and before its
  first list, so no agents rather than unknown ones; every agent `unknown`
  while the list fails.
- **`configProblem`** (#505): why `services.yaml` is no usable config, from
  its last read (`configProblem` in `config.js`): "services.yaml doesn't parse
  (line 4)", "services.yaml doesn't parse" with no position, "services.yaml is
  empty", "services.yaml isn't a mapping", or "services.yaml can't be read
  (permission denied)" for one that is there but can't be read (#536, the
  read error's code in plain words, or the code); `null` while it loads.
  Fixed words and a line, never the file's text (#504) or its path.

**The status:**

```js
{
  overall: { state, sentence },     // "2 services down · UPS on battery"; state may be 'empty'
  issues: [entity, …],              // ranked, see below
  subsystems: [{ id, name, state, counts: { total, ok, warn, crit, unknown, maintenance }, detail, value, sub }],
  entities: [{ id, kind, subsystem, name, node?, state, word, reason, metric?, conditions?, heldSince?,
               runtimeMinutes?, since }],
  sources: { prometheus: { state: 'ok' | 'failed', error?, since }, kuma, nut, gitea, config },
  thresholds: { cpu: { warn, cycles }, mem: { warn }, disk: { warn, crit },   // the lines it judged by
                temp: { warn, crit }, hysteresis: { fraction, celsius }, pending: { cycles } },
}
```

- **States** are `ok | warn | crit | unknown | maintenance`, the names
  `src/ui/lib/status.js` uses (a test keeps them in step). Worst-of order:
  `crit` > `warn` > `unknown` > `maintenance` > `ok`.
- **An empty board** (#449): when nothing is set up and every read that ran
  answered, `overall.state` is `empty` (`EMPTY` in `summary.js` and in
  `src/ui/lib/status.js`, kept in step by a test) and the sentence is "Nothing
  monitored yet". The model decides it (`isEmptyBoard` in `model.js`): no
  entity; no source listed but Prometheus, and Prometheus answered (a `KUMA_URL`
  or `GITEA_URL` that is set is something set up, whatever it answers); and the
  services and integrations refreshes each left their payload. A failed UPS
  read fails Prometheus, so it is covered too. A board with nothing on it for
  any other reason is `unknown` with the same sentence, and one whose
  Prometheus doesn't answer is a failed source ("Prometheus unreachable"),
  never calm (`server/status/emptyBoard.test.js`, through the live
  refreshes). It is the board's state only, never an
  entity's or a subsystem's (an empty subsystem stays `ok` with `total: 0`):
  not `ok`, since nobody checked anything, and not `unknown`, since nothing
  went silent. It is no issue, and push sends nothing on it (there is nothing
  to page about; `server/push/firstRun.test.js`). The web's attention panel
  and header draw it as their quiet line, without a lamp; a client that
  doesn't know it reads it as no signal, as it reads any state it doesn't
  know. Only the overall can be `empty`, and only in `/api/status`; the old
  endpoints keep theirs (`/api/services`' `overallHealth` is still `unknown`).
- **Entities**, with their ids: a card of `/api/services` is a `service` when a
  Kuma monitor gives its state and a `container` otherwise
  (`services/<uid>`); an up, pending or in-maintenance monitor no card is drawn
  for is a service too, so the count holds when one goes down. Then `node`
  (`nodes/<key>`), `ups` (`power/ups`, only when a UPS is set up), `job` and
  `backup` (`jobs/<node>:<job>`, `backups/<node>:<job>`, a backup being a job
  `backupJobs` names), `integration`
  (`integrations/<key>`) and `agent`, an Arcane agent
  (`integrations/arcane:<env>`). `word` is the short status word an issue row
  shows ("Down", "On battery"); `reason` a short sentence ("Disk 94 % (warning
  above 90 %)", "No data: Prometheus unreachable"). Reasons hold no times, so a
  steady board gives the same status every cycle and an ETag holds: `since`
  (ms since the epoch) is when the entity entered its state, from the
  readings where they say (a job's run, when it became overdue, a container
  last seen, an integration's `_status.since`), else the first cycle that saw
  it. A node's `conditions` gives each reading its state (`disk`, `mem`,
  `cpu`, `temp`, `pool:<name>`), so a meter is coloured by the server's rule.
  `metric` is the reading behind a node's state, and the UPS's charge, on
  mains as on battery (#541). The UPS's `runtimeMinutes` (#549) is the
  runtime NUT says is left on battery, in whole minutes, rounded as the
  Android app has always shown it ("8 min left"), from the same read; it is
  null on mains (there the runtime drifts with the load, and carried it would
  move a steady board's ETag), with no runtime reading, and with no signal, so
  no screen draws a runtime the cycle's read didn't give. Every UPS entity
  has the key, so a client tells "no reading now" from a server older than
  #549, whose UPS has none.
- **Severity** is spec §6.1's table (`rules.js`, one function per kind), its
  numbers in `thresholds.js`. Kuma down is crit; pending is a warning only
  once it has lasted `pending.cycles` (2) cycles in a row, and on its first
  pending cycle a service stays as it was (#258); maintenance is
  `maintenance`, which is not an issue and doesn't break the quiet line. A
  missing container is a warning. One that was the last container of a Kuma
  monitor (`backedBy`) follows the monitor, and is never crit, since the
  service is an entity of its own (#438): the monitor up, a warning whose
  reason says so ("Missing: the container is gone; Kuma monitor Immich is
  up"); pending, unknown; in maintenance, `maintenance`. While the monitor is
  down, its red card is the one crit: the services refresh draws no grey card
  for a container that holds its down monitor or whose uid the monitor's red
  card has (4.2), and one the monitor has moved off (a new container took it)
  is a warning. A paused monitor (`isFreshMonitor`) vouches for nothing: its
  container is a plain missing one, "Missing: no longer running". A node is
  crit when Prometheus can't scrape it (`up` is 0, or no `up` series and no
  metric) while Prometheus answers.
  Proxmox storage pools feed their node's disk rule (the node `_target` names,
  else `pve`). A pool listed with no size (storage Proxmox lists but can't
  read, which the preset gives 0 %) has no reading, not 0 % (#468).
- **Failed sources** (#232's flags, read by `sourcesOk` in `model.js`, which
  push reads too): an entity a failed source feeds is `unknown`, with a reason
  naming it, never crit. A node
  whose `up` read failed is unknown; one whose metric read failed has that
  condition unknown, so it is unknown unless a reading that was read is worse.
  A node discovery left unread for its missing `up` (4.2, #470) is unknown
  with the reason of its verdict's row (`UP_MISSING` in `status/upMissing.js`,
  kept beside the payload as `whyNoUp`), and so are the containers it ran,
  kept from last cycle: "No data: not scraped by Prometheus yet" while a
  target waits for its first scrape (or, with `up` 0, answered since); "No
  data: still not scraped by Prometheus" once it has waited too long (#476);
  "No data: no up series, and no target in Prometheus" where the list names no
  node (#477); "No data: Prometheus stored no up series"; "No data:
  Prometheus's target list unreadable". For the last four Prometheus fails
  while it answers: its source is `failed`, with the problem as its error
  (naming the targets, or the nodes), and its issue's word is "Failing", so
  the sentence says "Prometheus failing", not "unreachable". Only those nodes
  and what they ran are held; a node or service removed elsewhere goes as
  usual (#476).
  What the failed source fed last cycle and no longer reports (the container
  list, the nodes, the UPS while Prometheus fails) is kept, as unknown, until
  it answers. Prometheus counts as failed when the services refresh says so or
  the UPS query failed; NUT when Prometheus answers but the exporter has no
  `nut_status`. Each failed monitoring source (Prometheus, Kuma, NUT) is one
  `warn` issue, `sources/<name>`, ranked first in its level. Gitea is listed in
  `sources` but is no issue: nothing on the board depends on it. Kuma is
  listed once `KUMA_URL` is set or a service is on the board.
- **A source URL refused** for carrying a credential (#419,
  `refusedSources`, 4.4) is that source off, whatever its refresh left: listed
  as `failed` with the problem as its error ("KUMA_URL carries a user name or
  password, so it is not used: put the API key in KUMA_API_KEY"), and
  one `warn` issue whose word is "Off", Gitea's too, so the sentence says
  "Kuma off". Push pages it as any failed monitoring source (Gitea has no
  push).
- **`services.yaml` is a source too** (#505), `config`, listed only while the
  file is no usable config or can't be read (#536) (`configProblem`), as
  `failed` with that reason, so
  a good file changes nothing. JagHelm then runs on the last good config, or
  on none at boot (5, #463), and an empty board would read as calm: its issue,
  `sources/config` ("JagHelm config", `warn`, "Failed"), has the reason, and
  the sentence says it, "services.yaml doesn't parse (line 4)", where an empty
  board said "Nothing monitored yet". The web shows it as any source issue,
  with "Configuration" where a monitoring source says "Monitoring source"
  (`whereOf` in `src/shell/statusView.js`; the `config-broken` cross-client
  fixture), and so does the Android app since it reads the model (#325).
- **A reading with no value** this cycle (#462: a sensor or exporter that
  didn't answer, `null` in `/api/services`) keeps the level the model held for
  it, and CPU's run of cycles over its line, as a failed read does, so 78 °C,
  no reading, 73 °C, 76 °C is one warning with one `since`. Held at warn or
  crit, the node stays at that level, with a reason that gives no number
  ("Temperature: no reading (warning held until below 70 °C)") and no
  `metric`; its condition is `unknown`, since a meter has no value to draw.
  Held at ok, it is left out, as a reading that was never read is (a VM has no
  temperature sensor). It holds until the reading is read again, the node
  leaves `services.yaml`, or the hold has lasted 24 h (below). Push's snapshot
  holds such a reading the same way, so the screen and push agree on whether
  its episode is open.
- **A hold of a reading with no value lasts 24 h** (#469). Such a reading (a
  sensor or collector gone, a pool Proxmox lists with no size) is held from
  its first cycle with none. After `HOLD_LIMIT_MS` (24 h, `rules.js`
  `holdSince`) it is forgotten, its level and CPU's run with it: it leaves the
  node's reason and conditions, so a sensor removed while over its line no
  longer keeps its node at warn. Nothing is sent, as nothing was read; read
  again later, it is a new reading (#448), so over its line it pages once and
  inside its old band it is ok. A reading read again before then ends its
  hold, and its next gap starts a new 24 h.
  - **The model alone times it.** `judgeNode` keeps each start in the node's
    memo (`memo.held`) and the node entity serves it, `heldSince: { <reading>:
    <ms> }`, only while the node has such a hold. Push's snapshot copies it
    (`buildHosts`), never working one out for itself, and drops a reading on
    the cycle the model stops holding it. At boot the model is seeded with the
    starts the file keeps (`heldSinceOf`). So a cycle push sits out (a
    dispatch that throws) can't put the two out of step,
    and a restart doesn't start the 24 h again. A snapshot written before
    #469 has no start: its holds start on the first cycle that reads them.
  - **A reading whose read failed is frozen, never timed**: one whose
    Prometheus query fails while the node's `up` answers, and a pool its
    node's Proxmox read couldn't read. It keeps its level, its run and any
    start as they are, however long, as a node with no data or an unreachable
    one keeps all of its readings. The failure is on the board as its own
    issue meanwhile, and once the read answers normal the phone gets its
    "back to normal". A hold's 24 h count from its start throughout, so a
    reading quiet again after such a spell, past its 24 h, is forgotten on
    that cycle.
- **A storage pool whose read failed** (#468) is a reading with no value: while
  a node's pools are not read, each pool the model held a level for and that
  isn't listed keeps it, as above, with the same reason ("Storage pool
  local-lvm: no reading (warning held until below 85 %)"). `proxmoxPools` in
  `model.js` says which nodes' pools were read. A node with Proxmox entries
  has its pools read when each one fetched its pool list; a fetch that failed
  (`_error`) or whose storage read failed (the preset then gives no list, not
  an empty one) is not a read. The integrations refresh stamps `_preset` and
  `_target` on an entry whose fetch threw too, so a Proxmox integration that is
  still set up always has an entry for its node. A node no Proxmox entry names
  has none set up any more (the integration was removed, disabled or pointed
  at another node): its pools were read, as an empty list. With no
  integrations payload (the refresh failed, or its cache is cold or past its
  TTL), no node's pools were read. A pool's episode ends only when the node's
  pools were read without it: push's snapshot drops it on that cycle, and over
  its line it sends one `host_threshold_cleared`, since the node on the screen
  no longer shows it. While unread it is frozen, not timed (#469, above); a
  pool listed with no size has no value, and is timed.
- **Thresholds** (#451) are the lines the model judged this status by, as it
  was given them (`thresholds.js`' shape, below: usage lines as fractions of
  1, temperature in °C): the defaults, or `display-config.json`'s
  `pushThresholds` over them. A screen reads a meter's lines from them, never
  from a copy of its own: `readingLines(thresholds, reading)`
  (`status/readings.js`, dependency-free so the web imports it) gives a node
  reading's `{ warn, crit, band }` in its unit, percent or °C (`band` is the
  hysteresis), a storage pool taking the disk's. They change only when the
  config does, so they don't move a steady board's ETag.
- **A reading as shown** (#450): one rule, `shownReading(value, lines)` in
  `status/readings.js`, writes every reading in a reason (and a node's or the
  UPS's `metric.value`), and every meter on the web prints by it, so a meter
  and a reason never show one reading as two numbers. It rounds down, so a
  reading never shows at or over a line it hasn't crossed: 94.6 % by the 95 %
  line is "94", 95.0 is "95". Whole, unless one of the reading's lines, or
  where a level on it clears (the line less the hysteresis), has a fraction
  (a hand-edited `pushThresholds`, 0.875): then to that line's decimals, at
  most two, so 87.6 % by an 87.5 % line is "87.6", never "87", and a reading
  over a line never reads under it either. Lines are written to a hundredth
  (`pct`, `lineNumber`). A reading under 0 shows 0, as the model reads usage
  clamped at 0 (CPU, 100 less the idle rate, can come out at −0.3). Rounding
  down also keeps a reason, and the ETag, steady while a reading moves inside
  its whole number.
- **One comparison with a line** (#450): the model's levels (`levelOf`, its
  hysteresis clear, CPU's run, the "above" or "until below" of a reason) and a
  meter's state (`meterState`) all ask `atOrOver` in `status/readings.js`,
  which compares on one grid, whole hundredths of the display unit
  (`toHundredths`, rounded once on each side). The model reads usage as
  fractions and the meter as percents, and a reading parsed from "91.3" and
  divided by 100 is 0.9129999999999999 while the line 0.913 is not, so compared
  as they were, a reading exactly on one in eight one-decimal lines was judged
  under it while the meter drew it on it. Push has no comparison of its own:
  its differ diffs the model's levels, and a pre-#292 snapshot is read through
  `levelOf` too.
- **Issues** are the entities in `crit`, `warn` or `unknown`, plus the failed
  sources: crit before warn before unknown; within a level by subsystem order
  (sources, Services, Nodes, Power, Jobs, Backups, Integrations), then oldest
  first, then by id.
- **Subsystems**, in strip order: Services, Nodes, Power, Jobs, Backups,
  Integrations. Each is the worst of its entities, with counts by state and a
  detail ("31 / 32 up · 1 in maintenance", "On mains"). One with no entities
  has `total: 0`, and a client shows no panel for it. Its tile's two lines
  are the model's too (`tileOf`, #541), from the counts that build the
  detail: a short `value` and the `sub` under it. A count's value is
  "31 / 32". Its sub names what is wrong, each status word with its count,
  worst first, in the sentence's words ("1 down", "1 overdue", "1 in
  warning", "1 with a refused login"), or with nothing wrong the OK word
  ("up"); then "N in maintenance" and "N no signal" ("1 down · 1 no signal",
  "up · 1 in maintenance"). The OK word never sits beside a problem. The
  UPS's value is its word ("On mains", "On battery") and its sub its charge
  ("64 % charge"), else its reason when that says more ("No data: Prometheus
  unreachable"), else empty; an empty subsystem is "None" with an empty sub.
  `detail` keeps its words: the value, the OK word, then maintenance and no
  signal ("11 / 12 up · 1 no signal"; the UPS on its own, its reason, "On
  battery (64 % charge)"), for the header sentence, push and an Android app
  older than #541; Power with several entities counts its no signal ones
  there too. No client splits a string.
- **The sentence**: with warnings or worse, each kind of problem with its count
  in issue order ("2 services down · Prometheus unreachable · 1 job failed"),
  then "N no signal"; with only unknowns, "31 up · 1 no signal"; healthy, the
  quiet line ("All 32 services up · 6 nodes healthy"). With nothing on the
  board, "Nothing monitored yet", with `empty` or `unknown` (above).

**The threshold config** (`thresholds.js`, [ADR 0006](adr/0006-one-severity-table.md)):
`DEFAULT_THRESHOLDS` holds every number, usage lines as fractions of 1 as push
has always compared them. `resolveThresholds()` lays `display-config.json`'s
`pushThresholds` (`cpu`, `mem`, `disk`, `hysteresis`) over the defaults, and
`refresh.js`'s `getThresholds()` returns the result. Push has no lines of its
own: it sends what the model judges, so the two can't disagree about a line.
`/api/status` serves the set each status was judged by (`thresholds`, above),
so the screens' meters draw the same lines.

**`GET /api/status`** (`routes/status.js`, token auth like every `/api/*`
read) serves the status the loop cached this cycle under `status`, with the
cache's ETag (4.2: computed once per value). Reasons hold no times and the
lines change only with the config, so a steady board serves the same bytes
every cycle and a poll with the last ETag gets a 304 (`server/routes/status.test.js`). The status stays fresh for two refresh intervals (at least the cache's 2
minutes), so a long interval leaves no gap between cycles. Before the first
cycle, or once the loop has built none for that long, it answers 503. The
200 and the 304 both say when the status served was built, as `Last-Modified`
(#499): the cache entry's time, set as the loop stores each cycle's status
(`jsonWithEtag`'s `lastModified`, `cache.js`). It moves every cycle while an
equal status keeps its ETag, since it is a header, never in the body, and the
ETag stays the only validator: an `If-Modified-Since` alone never gets a 304.
An HTTP date counts whole seconds, so it reads up to a second early. A client
counts the status's age from it, however long ago its own last answer came,
as the response's `Date` less it, by the server's clock (5, "No signal: a
stale status"; CORS exposes `Date` beside `ETag`); a 503 sends none.
`Cache-Control: no-cache`, so a
browser never reuses an answer unasked on the strength of that date (a
Last-Modified alone allows a heuristic tenth of its age). It sits beside `/api/services`, `/api/ups` and
`/api/cron/status`, which keep their shape and meaning for Android apps already
installed (spec §6.3; frozen by `server/routes/contract.test.js`): the new
states (maintenance, pending, unknown because a source failed) appear only
here.

**Both clients draw it, and judge nothing.** The web reads it in `useStatus`
(5, "Status in the header"). The Android app reads it since #325, in
`useDashboard` (`mobile/src/data/useDashboard.js`): one round of the app's
poll scheduler asks `/api/status` and `/api/services` (the cards' names,
links and readings), each with its ETag: two requests, and the app no longer
reads `/api/cron/status` or `/api/ups`, since the model carries the UPS's
charge (#541) and its runtime on battery (#549). Only a server older than
#549, whose UPS entity has no `runtimeMinutes` key (`needsUpsRead` in
`board.js`, read off the status the round brought, so finding out costs no
request), is asked `/api/ups` too, after its status lands, for that runtime
and, before #541, the charge on mains; that read goes with `/api/ups` in
Phase 4's endpoint cleanup. A 404 from
`/api/status` is a server older than 3.0.0, which the app says in words. It
keeps `status`, `reach` and the answer's clock as `useStatus` does, and
`MobileApp` feeds them to the web's rule for a stale status
(`useStatusFreshness`, 5, "No signal: a stale status"). What each screen
shows comes from `src/phone/data/board.js`, through the web's own helpers
(`headlineOf`, `subsystemCells`, `whereOf` and `lastKnownLine` in
`src/shell/statusView.js`, `drawnState`, and `infrastructureNodes` in
`src/shell/infrastructureView.js`): the status bar's lamp and sentence, the
Overview's card (the board's word and the issues' counts, the quiet line, or
an empty board's "Nothing monitored yet" alone), a strip cell per subsystem
with anything (the model's value over its sub-line, as the web's tile, #541;
the Power cell adds the model's UPS runtime on battery, "21 min left", none
while the status is stale, since it is a countdown, and from a server older
than #541, which gives no sub-line, its charge on mains), the ranked issues with where they are and their reasons, each
service row's state and word, and each node card's state, word, hosted
counts ("4 / 5 services up · 1 down", or "No services") and bars, each bar
coloured by its condition and printed by `shownReading`, and a service's 24 h
uptime ring in its state's colour. `derive.js` keeps display helpers only,
and `mobile/src/data/noSeverity.test.js` fails on a line or a severity of the
app's own anywhere in `mobile/src/` or in the screens it draws from `src/phone/`.

**In demo mode** the demo guard answers `/api/status` (#437) with the model
built from the payloads the demo serves (`demoStatus` in `demoFixtures.js`):
`readStatusInputs` with the demo's board as the caches, the demo display
config's thresholds and backup jobs (it marks the nightly backup as one, so the
`incident` headline reads "1 service down · 1 backup failed"; the demo has no
Arcane). It answers as a board that has been running a while (#442): a new
tracker on every request (nothing is kept between requests, and there is no
push to seed it from) runs over the same board twice, at a warm-up clock 15
minutes before the request and then at the request's (`demoStatusCycles`). So
every `since` is the warm-up clock (its down service has been down 15 minutes,
not "since now"), except a job's, which is its last run's, and a "for 2
cycles" rule has had its two. Both cycles read the board as it is at the
request; that is also the board at the warm-up clock, since every time the
model reads in it (the cron runs, the newest an hour old) is before the
warm-up, which a test checks. `server/demoStatus.test.js` (`incident`) and
`server/demoStatus.healthy.test.js` put the same payloads in the live caches
and cron store, run the loop's own `updateStatus` at the same two clocks, and
check that it gives the same status (`server/testing/demoLiveStatus.js`; one
file per scenario, so each loop starts from a fresh boot's tracker).

**Push** (`push/snapshot.js`, `push/differ.js`, #292) is built on the model, so
a notification says what the screens say. The snapshot records, per entity push
pages for, what the model decided: a Kuma-fed service's up or down, each host's
reachability and the level of each reading (its `conditions`: CPU, memory,
disk, temperature, each Proxmox storage pool), with the model's start for
each reading held with no value (`heldSince`, #469), the UPS (on battery or
online) and each job and backup (success, failure, overdue). The differ only
sees where that changed:

- A level that rises (ok to warn, warn to crit) sends `host_threshold`,
  `critical` for crit; one back to ok sends `host_threshold_cleared`; crit
  falling to warn sends nothing. The model holds a level through its hysteresis
  band and waits CPU's 2 cycles, so push does too (#361). A storage pool at
  warn or crit that a Proxmox read that succeeded no longer lists, or whose
  node has no Proxmox integration any more, leaves the snapshot with its
  `host_threshold_cleared` (#468); one at ok leaves quietly.
- What the model can't call up or down holds its last known state and sends
  nothing: a service pending or in maintenance, an entity a failed source made
  unknown, a reading whose query failed or that has no value this cycle (the
  model holds its level too, so a sensor that skips a cycle mid-episode sends
  no "back to normal" and no second alert, #462), a storage pool whose Proxmox
  read failed (#468, the same hold), the UPS while NUT is quiet or
  its read fails. A reading held with no value holds for 24 h at most (#469):
  then it leaves the snapshot on the cycle it leaves the model, and the
  differ sends nothing for it. A reading that leaves with a start in the
  previous snapshot was held with no value, so it never sends a clear; one
  that leaves without one (a pool a read no longer lists) sends its clear
  over its line. Push reads no clock for this: the starts are the model's. So down, pending, up still sends the recovery, and down, pending, down
  sends no second `service_down`; on battery, unknown, on battery sends no
  second `ups_on_battery`, and online, unknown, online sends nothing.
- An entity with no previous state (#448) is diffed from "no previous state":
  it pages once if it appears in trouble, at the model's level, and sends
  nothing if it appears ok. That is an entity new to the snapshot (a node added
  to `services.yaml`, a reading that starts answering, a new service or job, a
  UPS never read, whose snapshot state is `unknown`), and every entity when
  there is no snapshot (a first run, or a missing or unreadable file): each
  open problem then pages once, on that cycle, and the snapshot written holds
  it. A new node sends no "Host recovered"; one unreachable sends
  `host_unreachable`, and each reading over its line `host_threshold`. An
  entity first seen while its source fails is unknown, so it sends nothing
  until the source answers, and is new then. A restart with a valid snapshot
  is not a first sight: it sends nothing again and clears nothing.
- With no snapshot, the first cycle is diffed whatever the sources say
  (#461): there is no baseline to wait for. A source failing then is in the
  snapshot written, so it sends its `source_down` after its 2 cycles and one
  `source_recovered` when it answers; what it feeds sends nothing until then,
  and what is in trouble pages once it is read. A Kuma service going down or
  a job failing pages as on any cycle. (Before, the first snapshot waited for
  the UPS read and Prometheus, which silenced every push meanwhile, for as
  long as the UPS query kept failing.)
- A Prometheus that hasn't scraped yet (#470; 4.2), all of a node or part of
  it, sends nothing for its nodes: each is unknown until scraped, so with a
  snapshot it holds as it was and sends no `host_unreachable` and no
  `host_recovered`, and with none it is new once read and pages then only if
  in trouble. That holds whichever of JagHelm and Prometheus started first,
  since the rule reads Prometheus's targets each time; the guard it replaced
  (#232's `upSeriesSeen`) lived in the process's memory, and a restart lost
  it. A Prometheus that scrapes and stores nothing (a full disk) is a failed
  source: one `source_down` after two cycles and one `source_recovered`, no
  host push. So is a target that waits for its first scrape past 3 of its
  scrape intervals (#476; its wait is in the data dir, so a restart sends no
  false recovery and no second page), and a backend whose target list names
  no node losing its `up` series (#477, federation or remote write).
- A monitoring source (Prometheus, Kuma, NUT) the model lists as failed for two
  cycles in a row (about a minute) sends one `source_down`, and one
  `source_recovered` when it answers. The snapshot keeps each source as `ok`,
  `failing` (its first failed cycle) or `down`. Its category is what it watches
  (`SOURCE_CATEGORY` in `push/dispatch.js`: Prometheus is Hosts, Kuma Services,
  NUT UPS), since the installed app has five category keys.
- The status model itself is a source (#440). A cycle whose model threw has no
  status, so push keeps its snapshot as it was (`modelFailedSnapshot` in
  `push/snapshot.js`) but for the status check's own entry, `sources.status`,
  which steps `failing` and `down` as a source does. Its second failed cycle in
  a row sends one `source_down` with the id and node `status`: "JagHelm status
  check failing", `critical`, since no other push is sent while it lasts. The
  cycle it builds again sends one `source_recovered` ("JagHelm status check
  recovered") and whatever changed meanwhile. Their words are fixed in
  `push/differ.js`, never the model's. The entry is in the file, so a restart
  mid-failure sends no second push, and one failed cycle on each side of a
  restart is two in a row. It is in no category: no category switch turns it
  off, only push off (and *Notify recoveries* for the recovery). While the
  model builds, `sources` has no `status` entry, but for the cycle after it
  paged, when it is `ok`.
- `services.yaml` is a source too (#505), `sources.config`, stepping
  `failing` and `down` while the model lists it (the file is no usable config)
  and kept as the status check's is otherwise: `ok` for the cycle after it
  paged, else no entry. So its second cycle sends one `source_down` with the
  id and node `config`, "JagHelm config broken", body "JagHelm config ·
  services.yaml doesn't parse (line 4)" (or "can't be read (permission
  denied)", #536), `warning`, and the cycle after the fix (the watcher's
  reload, its 30 s retry, or any read) or the file's removal one
  `source_recovered`, "JagHelm config fixed", "services.yaml is no longer
  broken", words true of each of those. It is in no category: a file that
  doesn't parse is every category's problem.
- Each event's `reason` is the model's reason for the entity, and its body the
  entity's name (and node) and that reason: "Gitea on vm103 · Kuma: down",
  "pve · Disk 94 % (warning above 90 %)". The FCM `data` block the Android app
  reads is unchanged: `type`, `id`, `node`, `severity`, with each id namespace
  as before (`server/push/androidPayload.test.js`). A tap opens the model's
  issue for it (#325): the app maps the data to the entity's id
  (`mobile/src/push/fcmIdToIncidentId.js`: `services/<id>`, `nodes/<node>`,
  `power/ups`, `jobs/<id>`, `sources/<id>`), and Incident detail finds the
  issue by it (`issueFor` in `src/phone/nav/issueRoute.js`, which finds a
  job the model files as a backup by its job id too); one that is no issue
  any more shows the push's own fields.
- A backup pages as the job did: `cron_failed`, `cron_overdue` and
  `cron_recovered`, with the same id and node, so an installed app routes it
  as before; its reason is the backup's ("Last backup failed: …"). One
  difference (#478): a failed backup's `cron_failed` is `critical` (high
  priority), because the model judges it `crit`; a failed job stays
  `warning`, and an overdue backup stays `warning` as the model's `warn`. Marking or unmarking a job sends nothing: the snapshot keys a job by
  `node:job` either way.
- A container with no monitor, an integration and an Arcane agent send nothing,
  as before: the Arcane poller pages for its agents itself
  (`arcane_agent_offline` after 2 polls down, `arcane_agent_recovered`), so an
  agent outage is one push. Arcane's updates, held-back updates, releases and
  digests are pushes only, never model issues; #267 records them in Alerts
  history.
- Delivery (#235): `push/fcm.js` sends each event to each phone through
  `push/fcmHttp.js`, a small FCM HTTP v1 client in place of firebase-admin
  (201 of the server's 290 production packages). It signs a JWT with the
  service account's key (`node:crypto`), trades it at
  `oauth2.googleapis.com` for an access token scoped to sending
  notifications, cached until 5 minutes before it expires and fetched once
  for sends that need it together, and posts to `fcm.googleapis.com`. Those
  two URLs are fixed in the code, not taken from config, so the client does
  not go through `safeFetch`: every request times out after 15 s and follows
  no redirect. It keeps what firebase-admin did, pinned by what it was
  captured sending and throwing (`push/fixtures/fcm-wire-golden.json`): each
  message's exact body, the error codes `fcm.js` prunes a token on, and the
  retries of a 503 or a dropped or stalled connection. Push is enabled as
  `initPush()` returns, so nothing at boot waits for it. The key, the JWT and the access
  token are never logged or quoted in an error (docs/mobile/DESIGN.md, "FCM
  HTTP v1 send").
- Sending (#579): the refresh loop never waits on Google. With Google out
  of reach a send can take ~145 s, and before #579 the cycle awaited every
  send, so `/api/health` went 503 past 90 s and the board froze. Now the
  cycle diffs and hands its events to an outbox, and returns:
  `advance(snapshot, events)` (`push/dispatch.js`) moves the snapshot and
  queues the events in one atomic write of `push-snapshot.json`, which
  holds the snapshot's fields and, while any are queued, `outbox` (each
  event with `queuedAt`, and `sent` once a phone took it; an older JagHelm
  reads a file with none as its own). One sender (`push/outbox.js`) sends
  one at a time, oldest event first, to each phone its prefs let through,
  so each phone gets its events in order. A failure every phone would share
  (no answer from Google, the key refused: `allPhones` in
  `fcm.sendToToken`'s result) stops the round, and the next waits 10 s,
  30 s, 1 and 2 minutes, then every 5. One for this phone only (`retry`: a
  5xx, a 429, the quota) makes that phone wait the same way while the
  others go on; given up for it after 16 tries (about an hour) on an event
  another phone took, with one warn line, never on one no phone took. Any
  other failure (a dead token, pruned; a payload FCM refuses) is done with
  that phone, logged as before. An event every phone is done with leaves
  the outbox in another write. So a crash before the cycle's write re-diffs
  the change and pages once, one after it sends the queued events from the
  file and re-diffs nothing, and only one between a send and its write can
  page twice. A page no phone has taken and its recovery both leave the
  outbox, unsent. Past 100 events (`OUTBOX_CAP`) the oldest pages not being
  sent are dropped, with one warn line naming them; a recovery never is
  (its page went out). `/api/health` shows the outbox (4.6). Shutdown needs
  nothing more: the outbox is on disk with each change
  (docs/mobile/DESIGN.md, "The cycle never waits on Google").

**The cross-client suite** (#293, spec §6's proof) holds the screens and push
to the model: the same input can't give one answer on a screen and another in
a push. Its fixtures (`server/testing/statusScenarios.js`) are named boards,
each a list of cycles built as the loop builds them (`readStatusInputs` over
the caches a refresh would leave, through one tracker), never status JSON
written by hand: `healthy` and `incident` are the demo's boards
(`demoStatusCycles` in `demoFixtures.js`, the same warm-up and request cycles
`demoStatus` serves);
`source-down` is the healthy board and then two cycles of Prometheus failing;
`first-run` has nothing set up; `thresholds` puts node readings on, over, just
under and held inside the lines of the threshold table; `every-state` has one
of every other state (a node unreachable, the UPS on battery, a job failed, a
job and a backup overdue, a service pending and one in maintenance, a container
missing, an integration failing, an Arcane agent offline); `low-battery` has
the UPS on low battery. They are Node-only; an e2e or gallery run can import
them on its Node side and hand a page the JSON.

- **Push** (`server/status/crossClient.test.js`, `npm run test:ci`): each
  fixture's status goes through the real push cycle, from an empty snapshot and
  from the healthy board's, until it settles. Each push is matched to its
  entity by the FCM `data` keys the Android app reads, and must carry the
  entity's state (by its severity: critical, warning, info), the word its type
  stands for ("Service down" is the model's Down), and the model's reason; the
  app must route it to that entity. Every issue the model pages for must have
  its push.
- **Screen** (`src/ui/crossClient.test.jsx`, `npm run test:client`): each
  fixture's status is drawn with the `src/ui` status components as a screen
  draws the model (the attention panel, a tile per subsystem that has
  anything, a row per entity, and the Overview's Infrastructure section, a
  meter per node reading coloured by its condition, drawn through the page's
  own `infrastructureNodes` and `InfrastructureSection`), and read back: the
  headline's word (the model's word for the board's state) and sentence, each tile's state, word, value and sub-line (#541; and each fixture's strip again stale, every tile no signal with the same value and sub-line), each row's
  state, word and reason, each meter's state and the number and line the
  model's reason gives. A meter reads its lines from the status it draws
  (`thresholds`, #451), and readings just below, on and just above each line,
  with the default lines and with `pushThresholds` moving them, colour each
  meter as the model judged it.
- **Android** (`mobile/src/crossClient.test.jsx`, `npm --prefix mobile test`,
  #325): each fixture's status and cards are handed to the app's own
  screens through `MobileApp`, as its poll hands them over, and read back:
  the status bar's lamp (none on an empty board) and sentence, the Overview
  card's headline, coloured word and sentence (the web panel's words), each
  strip cell's state, word, value and sub-line (#541; stale, the same as
  fresh), each issue row's state, word, name,
  where and reason, and each node card's state, word, hosted counts and
  bars (level and number). Then every fixture again with the status stale
  (the server out of reach), and the incident past its TTL and with no
  answer for too long: every lamp, cell, row, card and bar is no signal,
  the words kept as last known, and the card says why and what it last
  knew.

A disagreement fails it unless a named exception (`KNOWN` in each file) covers
it, where it says. An exception that stops happening fails too, so settling
one is deleting its entry. There are none today: #478 settled the failed
backup's push severity and #450 the meter's number. Android's old
derivation (`mobile/src/data/derive.js`'s severity table) went in #325; the
web's, `src/utils/thresholds.js`, went with the node cards' old readings
(#299).

## 5. Frontend architecture

```mermaid
flowchart TD
  MAIN["main.jsx"] --> EB["ErrorBoundary (root)"]
  EB --> CP["ConfigProvider"]
  CP --> OP["OverlayProvider<br/>(toast + confirm)"]
  OP --> APP["App.jsx (useRoute: the page)"]
  APP --> SH["AppShell (src/ui)"]
  SH --> HD["AppHeader, or PhoneHeader below 768px<br/>(useStatus: /api/status)"]
  SH --> SN["SideNav (≥ 768px) /<br/>BottomTabs + More sheet (< 768px)"]
  APP --> CPAL["CommandPalette<br/>(pages, apps, themes, links)"]
  SH --> OL["/ : OverviewLayout<br/>(the utilities rail from 1440px)"]
  OL --> OS["OverviewStatus<br/>(the poll's status: ShellAttention,<br/>SubsystemStrip, the ?subsystem= filter)"]
  OL --> DV["DashboardView"]
  OL --> UR["UtilitiesRail: weather and the clock,<br/>Quick Launch, Pipeline, Checklist<br/>(utilities.js, extras.js)"]
  SH --> LP["/launch : LaunchPage<br/>(the same panels and the web search)"]
  DV --> OI["OverviewInfrastructure<br/>(the poll's status + the board's readings:<br/>InfrastructureSection, cards or table)"]
  DV --> OSV["OverviewServices<br/>(the poll's status + the board's latency and<br/>app metrics: ServicesSection, by node or group)"]
  SH --> AP["/alerts : AlertsPage<br/>(ShellAttention)"]
  SH --> SV["/settings/:section? : SettingsView (13 tabs)"]
  SH --> AF["/apps/:id : AppFrames<br/>(useAppFrames)"]
  AF --> IV["IframeView per app<br/>(useEmbedStatus)"]
  DV --> HG["HelmGrid engine"]
  HG --> GI["GridItem (+ keyboard handle)"]
  DV --> NP["NodePanel / NodeCard / Widgets"]
  DV --> UDD["useDashboardData<br/>(304-stable, per-source health)"]
  SV --> PRIM["settings primitives<br/>Card/Toggle/ChoiceGroup/EmptyState"]
  SV --> ITAB["IntegrationsTab module"]
```

- **Shell and routing** (#296). Every page lives in `AppShell`
  (`src/ui/app-shell.jsx`): the 48px header across the top (below 768px the
  Phone board's own, 56px, #569: "The phone screens on the web"), the grouped
  sidebar from 768px (Monitor: Overview and Alerts; Apps: one entry per
  embedded app, then "Add app"; Tools: Launch and Settings), and below 768px
  the bottom tabs (Overview, Services, Infrastructure, Alerts, More, whose
  sheet holds the apps, Launch and Settings, and Log out when signing in is
  asked for; #303, #569). The
  sidebar folds to icons; the choice is kept per browser (`prefs` in
  `src/storage`, which works without storage). Each piece of chrome is its own
  `.jh-ui` root; the page area, `<main>`, is not one, so today's views inside it
  keep their look, and a page of the new UI (Alerts) brings its own root
  (`ShellPage`), as does a part of a page beside today's views (the Overview's
  status, `ShellSection`). The chrome draws the theme shown (#304, "Design
  system" below). The URL is the page: `src/router` is a small router on the
  History API (no dependency) over one route table (`routes.js`): `/`
  Overview, `/alerts`, `/launch` (#301), `/apps/:id`, `/settings/:section?`,
  and `/services` and `/infrastructure`, which are in the table but hidden
  until their pages exist (#313): a hidden route, or a path no route matches,
  shows the Overview and replaces the URL with `/`. Below 768px those two are
  the phone's Services and Infrastructure tabs (`phone` routes, #303): the
  router reads the window's width (`useRoute({ phone })`, `PHONE_WIDTH`), so
  a resize to a desktop on one of them lands on the Overview. An `:id` the config has no
  app for does too, once the server's config has loaded (it may only be missing
  from this browser's copy). A plain click on a nav link navigates in the page
  (`followLink`); a modified or middle click opens a browser tab. The server's
  SPA fallback serves `index.html` for every path, so a deep link, Back,
  Forward and a reload all land where the URL says. Each page names the
  browser tab ("Alerts — JagHelm"). The command palette (⌘K or Ctrl K, or the
  header's search button) lists the pages in the nav, "Open <app>" for each
  app, the three themes and the links.
- **Status in the header** (#296, #275). `useStatus` polls `/api/status`
  (4.7) once a refresh interval with the last ETag, so a steady board costs a
  304, and asks nothing while the browser tab is hidden; on return it asks at
  once. The header shows the model's overall state as its lamp and word, and
  its sentence, which carries the counts ("1 service down · UPS on battery · 1
  no signal"); healthy reads "All systems normal" in text-1, never green. An
  empty board (nothing set up, #449) reads the model's "Nothing monitored yet"
  in text-1, with no lamp, and the Alerts page and the Overview show the same
  quiet line. The whole of it links to Alerts. Beside it, a polite live
  region (screen readers only) announces a change of state, never a tick of
  an age: the link's words while there is a signal, else "No signal" and why
  ("No signal: Can't reach JagHelm"), never the ticking "last known" line.
  When the server can't be reached the header says steel "No signal", as
  the Android app does. The last status is kept, but never drawn as current (#480, "No
  signal: a stale status", below): the header says what it last knew and how
  long ago, "No signal · last known 3 min ago: Critical · 2 critical", the
  lamp the steel ring. With nothing known, it says why: "Can't reach
  JagHelm", or, for a 503 before the first cycle (or an answer with no
  status), "Waiting for the first check". "Updated 12 s ago" is its own
  component (`UpdatedAgo`, fed from `useStatus`'s `updated` store, by the
  status's build time when the server sends one, #499): its tick
  each second and each poll's answer re-render it alone, never the header,
  which ticks only while it shows a stale status's age. The
  sidebar's Alerts entry carries the issue count, in the worst issue's colour,
  and none while the status is stale (`useStatusStale`).
  This replaced the dashboard's health dot, read off `/api/services`.
  Below 768px the header draws no status (#569): the phone's Overview card
  says it, and the header keeps only the live region, which announces a
  change as the desktop header's does, on any tab.
- **The Overview's status** (#297, spec §8 item 1). The top of the Overview
  says whether anything is wrong, what and where, before today's board
  (`OverviewStatus`, a `ShellSection` root). It reads the header's poll
  (`useStatus`), so no second `/api/status`, and draws it as the Alerts page
  does, through one component both use (`ShellAttention`): with issues, the
  attention panel (the status word coloured and the counts, "Critical · 2
  critical"; the model's sentence under them; the ranked rows: lamp, word,
  entity, where, reason, age) and "All alerts"; with none, the quiet line
  with the model's sentence ("All systems normal · All 12 services up · 3
  nodes healthy"); on an empty board, "Nothing monitored yet" with no lamp
  (#449). Without a signal the last status is kept, so a blip doesn't blank
  the panel, but drawn by the rule for a stale status (below): the panel's
  heading says "No signal · last known 20 min ago: Critical · 2 critical",
  the words the header says, with why under it ("Can't reach JagHelm"), and
  its rows keep their words, reasons and ages, each lamp the steel ring. With
  no status to show, a Banner says "No signal" and why. The first load is a
  placeholder. It renders only while the Overview is open (its
  state is the poll's), and is memoised on the poll, so the board's tick
  doesn't re-render it. Each row is a link to an in-page anchor on today's board
  until entities have URLs (#309, `entityAnchors.js`): a place on the board
  carries the anchor of the entity it draws, by the model's id. A service or
  container leads to its row in the Services section (#300), else its node's
  card (while a filter hides the section); a node to its card in the
  Infrastructure section (#299); the UPS
  to its panel (`UPSCard`); a job to its row in Scheduled Jobs (`CronJobs`),
  and a backup to its job's row, since the board lists backups as jobs. An
  integration, an Arcane agent and a monitoring source have no place on the
  board, so their rows are plain content. Whether the board draws a place is
  the board's own say: each place puts its anchor on a list while it is
  mounted (`usePlace`, `usePlaces`) and the rows read that list
  (`useRowLink`), so they follow every rule that hides one (a section
  switched off, no UPS, Scheduled Jobs off, a section a filter hides, a node
  hidden in Settings) without restating any; a row whose places are all off the
  board is plain content too (#279). A click or Enter focuses the place
  (`tabindex="-1"` unless it has one) and scrolls its top into view, clear of
  the sticky header (`scroll-padding-top` on the page, `global.css`); a click
  with a modifier key or the middle button is the browser's (a new tab or
  window), and this tab stays where it was. A
  wrapper (`.overview-status`, `global.css`) lines the status up with the
  board's cards: the board's padding plus HelmGrid's margin. Later cards
  rebuild the board under it (#300) and take over the gutter.
- **The subsystem strip and its filter** (#298, spec §8 item 2). Under the
  status, in the same `ShellSection`, `SubsystemStrip` has a tile per
  subsystem the model has anything in (`counts.total` above 0), in the
  model's order: its state's lamp, its name, and the model's `value` over its
  `sub` ("11 / 12" over "up", #541), as they are (`subsystemCells`,
  `statusView.js`; from a server older than #541, the `detail` as the value
  and no sub). The lamp is named
  by the model's word for the subsystem's worst entity ("Down", "Failed"),
  the first of its ranked issues in that state; the client judges nothing. A
  subsystem that isn't set up has no tile, and an empty board has no strip.
  Each tile is a toggle button (`aria-pressed`) that filters the page to its
  subsystem, one at a time; pressing the pressed one, or Clear, shows
  everything. The filter is the URL's `?subsystem=` (`overviewFilter.js`,
  `useSearchParam`): a press pushes a history entry without scrolling, so
  Back undoes it and a link or a reload opens the page filtered. A value the
  strip doesn't show is no filter, and once the status has said so it leaves
  the URL (replaced, not a new entry), so it can't filter the page again when
  that subsystem is set up later. Filtered, the attention panel's rows are
  that subsystem's alone and it says "Showing Nodes only" with Clear (the
  quiet line says it too); its heading and sentence stay the whole board's.
  Today's board keeps that subsystem's panels (`boardFilter.js`): Services
  the Services section (#300) and no panel, Nodes the Infrastructure
  section (#299) and the node panels, Power
  the UPS panel, Jobs and Backups Scheduled Jobs; Pipeline, Checklist and
  Quick Launch belong to none. The panels kept rise into the space left
  (`compactUp`, `gridMath.js`), and can't be dragged or resized while
  filtered: a drag saves the layout it sees, which would drop the hidden
  panels. When the filter keeps no panel, the board says why in their place
  (`emptyBoardReason`), and never that the subsystem isn't set up, since the
  model says it is: while the panel's source hasn't answered (`/api/ups`,
  `/api/services`), a placeholder; a panel switched off ("Scheduled Jobs is
  switched off"); a source that answered with nothing to draw ("No UPS
  reading on the board", with the model's detail for it); or no panel on
  today's board at all (Integrations, whose numbers show on their services'
  rows). Nodes and Services, whose sections are above the board, get no note. Each note offers "Show the whole board". The rows' links follow: a
  panel the filter hides takes its anchor off the list of places drawn. With
  a stale status, each tile keeps its value and sub-line, as last known, its
  lamp the steel ring (#480); how old they are is said once, by the header
  and the attention panel, never on a tile (#541).
- **The Overview on a phone** (#484, #303, spec §8 "Phone width"). Below
  768px (`PHONE_WIDTH` in `@ui/app-shell`, `(width < 48rem)`: the shell's own
  `md`, where the bottom tabs replace the sidebar, one value for both) the web
  draws the phone screens, not the desktop Overview or today's board ("The
  phone screens on the web", 5.1). Their Overview is the Phone board's, in the
  Android app's order: the status card, the strip, then the issue list, so a
  real incident's rows (six at 360px) can't push the strip below the fold,
  then Services and Infrastructure as lists. The strip is the attention
  panel's `between` and the panel draws it (AttentionPanel `split`, #484), so
  there is one panel and one region, and the page reads and takes the focus
  header, rows, as it looks. The split is the frame, plus one label: the
  header in one card, the Phone board's status card (a 16px lamp and the
  status word alone at 22/28, 800, `title-lg`; the model's sentence under it;
  "Updated 12 s ago"), the strip
  under it, then the Phone board's "Needs attention · 6" (an h3, so heading
  navigation reaches the rows after the strip) over a card with the rows;
  with no rows, no second card. Quiet, the header card is the Phone board's
  healthy card ("All systems normal" over the sentence). Under No signal it
  says "No signal", why, and what it last knew, as the Android card does.
  From 768px the Overview is the desktop's: one panel with the strip under it,
  as before. A resize across 768px swaps the two.
- **The Overview at every width** (#302, spec §3 goal 3, §8). Nothing hides
  from 360 to 2560px: no sideways scroll, nothing clipped, every name whole
  (`e2e/reflow.spec.mjs`). The widths come from the shell's two media
  queries, `PHONE_WIDTH` (768px) and `RAIL_WIDTH` (1440px), and no third: a
  tablet (768–1023px) is the desktop Overview in one column, which it is by
  flow (the status, the strip, Infrastructure, Services and today's board
  stack at every width without the rail), and its strip wraps by its own
  container queries (six tiles to a row from 816px of strip, where the
  widest value, "Low battery", fits in every typeface, #541; two rows of
  three under it), as the node cards fill their section's width. Sections
  grow with their content and never clip it; a strip tile's value and
  sub-line wrap only between words, never cutting one. On the first load the page fills in from the top (#243):
  `DashboardView` draws nothing until the header's poll has its first answer
  (`reach` past `loading`), while its data loads, so the status, a
  placeholder of unknown height until then, can't push down sections already
  drawn under it (CLS 0.50 at 390px before, 0.0001 after).
- **The Infrastructure section** (#299, spec §8 item 3). At the top of
  today's board (`DashboardView` draws it, lined up with the board's cards by
  HelmGrid's margin), the nodes as cards or a table (`OverviewInfrastructure`
  in `src/shell`, drawing `InfrastructureSection` and `NodeCard` from
  `src/ui`). It reads the header's poll for the model and the board's own
  `/api/services` and `/api/history`, so it adds no request, and judges
  nothing (`infrastructureView.js`): one card per node entity the model has,
  in services.yaml's order, a node hidden in Settings left out; its lamp,
  word and reason the entity's (healthy is the lamp alone); a meter each for
  CPU, memory, disk and temperature (the last only for a node with a sensor),
  valued from `/api/services`, its state the model's level for that reading
  (the entity's `conditions`, so a reading held in its hysteresis band, or a
  CPU spike before its second cycle, reads as the model judged it) and its
  lines the ones `/api/status` serves (`readingLines`), printed by
  `shownReading` (#450). A meter is the accent's below its line and takes a
  status colour only at or over it. A reading the model didn't judge this
  cycle (the node unreachable or with no signal, its query failed, no value)
  has no value, a dash, so an old number never shows as current; the trend
  and uptime go with it. Temperatures are in the model's °C, the unit its
  reason gives, so the meter and the reason print one number in one unit;
  Settings' `tempUnit` stays the weather's (one setting for both is #494).
  Under the meters: the hosted services' up and
  down counts (the model's service and container entities on the node), the
  uptime and the last hour of CPU (a Sparkline, its tooltip printed by
  `shownReading`). The user's colour for a node shows only as a 10px swatch.
  The table has the same readings, coloured the same way; it needs 720px, so
  in a narrower section (a phone, a tablet) the section draws the cards and
  offers no toggle, rather than scroll the state and the readings off to the
  side, and the table comes back when it fits. Cards or table is kept per
  browser (`prefs`, `jaghelm-infrastructure-view`), cards by default; with
  storage blocked the choice lasts the visit. Each node drawn
  puts its anchor on the list of places (the card, or its name in the table),
  so an issue row for a node leads there; the node panels below carry none
  while the section is drawn. It shows unfiltered and under the Nodes filter,
  and another filter hides it. Before the first status or `/api/services`
  answer, three placeholder cards; with no node, nothing; when
  `/api/services` stops answering, a Banner over the last readings says so,
  with Retry. With a stale status (#495), no level from it is drawn: every
  node and meter is no signal (the steel ring; a meter's fill steel and its
  number, still `/api/services`', in text-2, said "94%, no signal"), the
  words and reasons kept, and the count says "3 nodes · No signal · last
  known 3 min ago". Today's node panels below keep only the node's Proxmox
  lists (its services are the Services section's, #300); their readings, and
  with them the
  web's old 70 % / 90 % colours (`src/utils/thresholds.js`, the card halo and
  the old Sparkline) and the used / total GB, are gone. A node panel starts at
  its minimum height and grows to its content ("Panels and first run").
- **The Services section** (#300, spec §8 item 4). Under the
  Infrastructure section (`DashboardView` draws it, lined up the same way),
  every service in one list (`OverviewServices` in `src/shell`, drawing
  `ServicesSection` and its `EntityRow`s from `src/ui`). It replaces the
  board's service cards: the node panels draw none, the custom groups are its
  grouping rather than panels of their own (a saved layout's `group-` slots
  are dropped), and no card is dragged between panels any more, so a custom
  group's services are chosen in Settings → Sections (see "Custom groups"
  below). It reads the header's
  poll for the model, and the board's own `/api/services` (the latency, Kuma's
  last response time) and `/api/integrations` (one headline metric, matched
  by `useAppDataMatching` and keyed by the service's uid, so a container of
  one name on two nodes is two services with their own numbers), so it adds
  no request, and
  judges nothing (`servicesView.js`): a row per entity of the Services
  subsystem (a Kuma monitor, or a container with none), a node hidden in
  Settings left out; its lamp, word and reason the entity's. Only while the
  model says a service is up does its row print the latency and the headline
  metric ("24,499 photos": an integration's first field, an amount before its
  label); otherwise the model's reason ("Kuma: down") in its state's colour,
  and a dash for the latency, so an old number never sits beside a failure.
  Healthy rows are muted (the detail in text-2); a critical row is tinted.
  Grouped by node (services.yaml's order, the node's key beside its name, "7
  / 8 up") or, once Settings has a custom group, by custom group (until then
  Group is disabled, with a link to Settings → Sections; Settings'
  order, the rest under "Not in a group", each row with its node beside the
  name); within a group the worst
  first, then by name. services.yaml has no tags, so there is no grouping by
  tag. The choice is kept per browser (`prefs`,
  `jaghelm-services-grouping`), by node by default. The heading counts what
  it lists, the mock's "12 monitored · 1 down · 1 no signal" (each failing
  kind by the model's word), "· all up" when nothing fails. The name is never
  cut short before anything else (`EntityRow`); narrower than 672px the row is
  the Phone board's, the name over "metric · latency". Settings → Layout has
  no service-card options any more. Each row puts its anchor on
  the list of places, so a service's issue row leads to its row. It shows
  unfiltered and under the Services filter, which keeps it alone; another
  filter hides it. Before the first status or `/api/services` answer,
  placeholder rows; with no service in the model, nothing; when
  `/api/services` or `/api/integrations` stops answering, a Banner over the
  last numbers says so, with Retry. With a stale status, every row is no
  signal (the steel ring named "No signal", the detail in steel), its words
  and numbers kept, and the count says "12 monitored · No signal · last known
  3 min ago". Kuma's heartbeat strip isn't drawn: the server keeps no
  per-monitor history yet (#312).
- **Custom groups** (#517, `src/shell/customGroups.js`). Settings →
  Sections makes them; the Services section groups by them. A group is
  `{ id, title, containers }` in the display config's `customGroups`, and
  `containers` holds service uids (`pi-1:adguard-home`), the model's key: so
  `adguard-home` on two Pis is two services, and a Kuma monitor with no
  container (`pi-1:Home Assistant`) can be grouped too. Settings lists every
  service of `/api/status` (with `/api/services`' cards the model lacks), by
  name and node; a service is in one group. The key keeps its old name, so a
  tab still on an older build reads the groups. An entry that is no
  service's uid is a bare container name, as Settings saved before #517: it
  holds every service of that name, as it always did. Settings writes the
  groups back as uids at its next change of one (`migrateGroups`): a name as
  the uids it holds then, a name that holds none dropped, an entry on a node
  the server knows kept while no service has it. That needs the whole list
  (`complete`: the status, `/api/services` and services.yaml read, Prometheus
  and Kuma up, no node unread, unreachable or hidden): until then a name is
  kept beside the uids it holds, an entry that holds nothing is kept, and a
  service a name holds can't be taken out, so no save loses a service it
  can't see. With the services not read, a change keeps the entries as they
  are. Other saves leave a name as it is. A group has no icon, colour or
  hidden flag any more: the icon and colour drew nothing since #295, and a
  hidden group could hide a down service (the Overview's show/hide is
  Settings → Appearance's, #307). `useConfigPersistence` reads every copy
  without them and the old board's `sections['group-<id>']`
  (`dropDeadGroupKeys`), so dropping them is never an edit of the device's
  own: a load alone sends nothing, a rebase can't undo another device's
  group edit, and the next save goes without them. The server stores either
  shape as it is and warns about neither. A tab still on the old build reads
  uids in its Services section (#300); its Settings shows a uid as it is,
  and a click there saves a bare name, which holds the service on every
  node.
  Settings → Sections' titles and icons for the old board's sections (UPS,
  Pipeline, Quick Launch, the Checklist) go with that board (#306).
- **Utilities: the rail and the Launch page** (#301, spec §8 item 5). Quick
  Launch, Pipeline and the Checklist are one component each in `src/ui`
  (`utilities.jsx`), fed by `src/shell/utilities.js` and wired in
  `src/shell/Utilities.jsx`, and drawn in two places. The Launch page
  (`/launch`, `LaunchPage.jsx`, its own chunk) holds all three at every width:
  Quick Launch across the top, Pipeline and the Checklist side by side from
  672px of page. From 1440px (`RAIL_WIDTH` in `@ui/app-shell`, `(width >=
  90rem)`, beside `PHONE_WIDTH`) the Overview's frame (`OverviewLayout`)
  draws the same panels in a rail beside its sections, the mock's widths
  (`flex: 1 1 300px`, 280 to 340px). Narrower, the rail is not rendered at
  all, so nothing is drawn twice or polled off screen; the sections keep their
  place in the tree either way (only the wrapper's class changes), so crossing
  1440px never remounts today's board. While the rail shows, the page's 5%
  gutter moves out to the split (`.overview-split`, `global.css`) so the
  board's cards and the rail line up 24px apart. The rail keeps Settings →
  Sections' switches for the three panels; the Launch page draws everything
  set up, whatever they say. No new server data: Quick Launch is the config's
  `links`, every group with a link in the config's order (today's board drew
  only the first three), a link opening in Settings → Layout's target, one the
  browser can't open (`safeUrl`) left out; Pipeline is `/api/gitea/activity`,
  the newest six commits across the repos (message, repo, short SHA, age), no
  panel when Gitea isn't set up (`giteaConfigured`, `configuredPanels.js`),
  and a Banner over the last rows when the read fails; the Checklist is
  `/api/todos` (`useTodos`): each add, tick and delete saves the whole list
  (the endpoint replaces it), a new task's id is `uuidV4` (plain HTTP too,
  #236), a failed save is a toast and a re-read, and nothing can be added
  until the first read lands, so a failed read can't be saved over. The list
  is one for the whole page (`todoStore` in `utilities.js`, read through
  `useSyncExternalStore`): the rail, the Launch page and today's board's
  card (`TodoCard`, which stays mounted out of sight on every other page)
  all show and save it, so none saves a stale copy over another's change.
  Each view reads on mount; a read is dropped when the tab changed the list
  since it went out, or a save was still out then; the list is forgotten
  when the last view goes (a sign-out). From 1440px today's board leaves its
  own Quick Launch, Pipeline and Checklist panels out (`DashboardView`, the
  same `RAIL_WIDTH`), so each shows once; #306 removes them.
- **Today's extras and the Overview's sections** (#307, spec §8 "Today's
  extras keep a home"). The weather, the clock and the web search, which the
  old header drew, are back (`src/shell/extras.js`, wired in `Utilities.jsx`):
  weather and the clock are one card (`WeatherClock`) at the top of the
  rail from 1440px and at the top of the Launch page at every width; the web
  search (`WebSearch`) is on the Launch page beside them. They read
  Settings → Widgets as before: the weather shows when it is on and a place
  is set (`showWeather`, `weatherLat`, `weatherLon`, the city, `tempUnit`
  over `/api/weather`'s Fahrenheit), the clock until `showClock` is false
  (the old header always drew it), the search until `showSearch` is false;
  the search sends the words to `searchEngine`'s results page in a new tab,
  with no opener. A card shows only what is configured, and nothing with
  neither; the rail is drawn when it has any panel. Settings → Appearance →
  Overview sections has a show/hide switch for the subsystem strip,
  Infrastructure, Services and the whole rail (`overviewSections` in the
  display config, `sectionShown`), which the server holds, so a section
  hidden on one device is hidden on the next load on another. The attention
  panel's switch is on and locked: it shows only when something is wrong,
  so it is never hidden, whatever the config says. With Infrastructure off
  the node panels carry the nodes' anchors again; with the strip off a phone
  draws the attention panel as one card. The Launch page keeps every
  utility whatever the rail's switch says. Reordering waits for Edit layout
  (Phase 5).
- **No signal: a stale status** (#480, #495). The poll's status is stale
  when `reach` isn't `ok` once the first answer is in: a failed poll
  (`down`), or a 503 (`waiting`), which the server answers once its status
  is past the cache's TTL (`/api/status`, 4.7); or when its last answer is
  older than `updated.staleAfter`, two poll intervals and the request
  timeout (`staleAfterMs` in `useStatus.js`, from the interval and
  `REQUEST_TIMEOUT_MS` in `useData.js`: 72 s at the default 30 s, 252 s at
  120 s). That second rule is for a hidden tab or a sleeping laptop, which
  ask nothing and leave `reach` at `ok`: the first render after the tab is
  shown again is grey, before the poll's answer comes. While fresh, one
  timer, shared by every place, waits for that boundary, re-armed on each
  answer, and a `visibilitychange` to visible checks at once; no clock
  ticks. `useStatus` keeps the last
  status, and one hook decides what a page does with it,
  `useStatusFreshness` (`src/shell/statusFreshness.js`): the header
  (`ShellHeader`), the attention panel (`ShellAttention`, on the Overview and
  the Alerts page), the subsystem strip (`OverviewStatus`), the
  Infrastructure section (`OverviewInfrastructure`) and the Services section
  (`OverviewServices`) each call it, and none reads `reach` for itself. Stale, every state drawn from the status is no
  signal (`drawnState`): the steel ring and word, never green, amber or red.
  Its words, counts, reasons and readings stay, as what was last known, and
  each place says how old it is ("No signal · last known 3 min ago"; the
  header and the panel the same sentence, `lastKnownLine` in
  `statusView.js`), with why: "Can't reach JagHelm", or "JagHelm's status is
  out of date" for a 503 after a status or an answer too old. The age counts
  from when the server built the status, not from the poll's last answer
  (#499): `useStatus` keeps the build time beside the answer's time, as
  `updated.builtAt()`: the answer's time less the server's own age for the
  status, its `Date` less its `Last-Modified` (on a 200 or a 304,
  `builtAtOf`), so a server clock ahead of or behind the browser's can't
  skew it. Without a `Date` it takes the `Last-Modified` as it is, no later
  than the answer. The header's "Updated 12 s ago" reads the same time
  (`statusBuiltAt`), so it and "last known" never disagree. After a 503 past the server's TTL the status is older
  than the last answer, and says so. From a server that sends no
  Last-Modified (an older one, or the demo), the age counts from the answer.
  Two times, two rules: stale goes by the answer's time (is the poll getting
  answers?), the age by the build time (how old is what is shown?), both in
  `statusFreshness.js`. Every age on
  screen ticks on one clock (`useAgo`, `src/ui/lib/ago.js`), so the header
  and the panel never read a second apart; it ticks at once as the tab is
  shown again, and the hook runs no clock while the status is fresh. The
  header's live region says "No signal" and why, never the moving age. A
  lamp drawn as no signal beside a last known word ("Healthy", "Down") is
  named "No signal", not by that word (`lampName`, `src/ui/lib/status.js`),
  and a tile's or a row's name says it before the word.
  The answer that brings a status back restores every colour in its render.
  The panels left on today's board below the Services section (the UPS
  panel, Scheduled Jobs) draw their own sources, not the status model, so
  they keep their own colours and their own stale notes.
- **State.** `ConfigContext` exposes `config`, the stable `setConfig`, and a
  memoised `update(path, value)` built on `setIn` (immutable structural-sharing
  deep-set) -- so leaf cards memoise and don't re-render on unrelated edits.
  `OverlayContext` provides `useToast` / `useConfirm` (focus-trapped, Escape,
  focus-restore, reduced-motion). `api/client.js` `apiFetch` injects the auth
  token explicitly (replacing an old `window.fetch` monkey-patch).
- **HelmGrid** is a custom, dependency-light layout engine: pure math in
  `gridMath.js` (snap, overlap-resolve, content-fit, and `compactUp` for the
  board filtered to a subsystem, #298), per-item measurement +
  rendering in `GridItem.jsx`, and lifecycle (breakpoints, drag/resize, commit)
  in `HelmGrid.jsx`. It measures its width and picks its breakpoint's layout
  in layout effects, so the first frame painted is at the real width (#243).
  At `sm` (narrower than 768px of board) on a board that can't be dragged or
  resized (a phone, which `DashboardView` fixes, or a filtered board) the
  panels are in the page's flow, one column in the layout's order, each at
  its own height: nothing to measure, nothing drawn at a saved height then
  grown. A one-column board that can be dragged (a desktop window up to about
  1080px, or 1440px and up beside the rail) stays the stacked grid it was,
  and crossing between the two keeps every panel mounted (the same
  `GridItem`s, `measuring` off in the flow). Otherwise, until every source
  of the board has answered or failed once (`settled`, `useDashboardData`,
  passed as `reserve`), each panel keeps the height it last measured at its
  width (`jaghelm-grid-heights`, per browser), however long that takes, so a
  reload doesn't draw the board at its saved rows and then grow it; then each
  takes its own height in one step. Only heights measured once the data is in
  are kept, never a placeholder's. Panels auto-grow to fit content: `GridItem` re-measures
  a panel's natural height (the item at `height: auto`) after any change to
  its content or width. One placed on the grid (a phone turned tablet leaves
  the flow at 768px), drawn at a new width, or let go after a resize is
  measured in that commit, in a layout effect, and HelmGrid takes the height
  before the paint, so no frame draws it at its saved rows or at a height
  from another width, cutting its content off (#561). A panel glides to a new
  place (left, top over 150 ms) but takes a new size at once: an animated
  width was still the old one when it was measured. A change to its
  content is measured a frame later, at most once a frame. The panel's own box is stretched
  to its grid height, so it doesn't change when only the content does (the
  web fonts arriving late left a panel a row too tall, #498): a
  ResizeObserver watches every element in the panel and measures when one
  changes height (not on a width-only animation, such as a meter's fill), a
  MutationObserver keeps that set current as elements come and go. Pointer
  **and keyboard** (arrow move / Shift+arrow resize, with a live region)
  reposition them.
- **Panels and first run.** The board has a panel per discovered node (its
  Proxmox lists), plus the Checklist, Scheduled Jobs and Quick Launch panels
  (the Checklist, Quick Launch and Pipeline only below 1440px, where the
  Overview has no utilities rail, #301);
  the custom groups are the Services section's grouping, not panels (#300). Without a
  saved layout the board is laid out by `defaultLayouts(nodes)` (`layouts.js`)
  from the nodes `/api/services` has and the panels on show. The nodes come
  first, in their order, at most three to a row (two at the md breakpoint,
  fewer on a narrow grid), spread evenly over the rows, each row filling the
  width: three to a row leaves no node alone in a row, two to a row leaves the
  last node of an odd count alone, the whole width. Then the panels, paired by
  height: HelmGrid grows a panel to its content and only pushes panels down, so
  a panel under two of different heights leaves a hole under the shorter one.
  Pipeline sits beside Scheduled Jobs, then UPS beside the Checklist, each half
  and half, so each panel of the second pair sits under one of the first; then
  Quick Launch. When one of a pair isn't shown, the two left over share a row,
  the tall one 2/3 (on a fresh install, Scheduled Jobs beside the Checklist); a
  panel left alone takes the whole row. A node panel starts at its minimum
  height (3 rows), as it holds only its Proxmox lists, and
  HelmGrid grows it to them: a taller start would stay empty, since HelmGrid
  grows a panel but never shrinks one. It is regenerated as nodes
  and panels come and go, until the first drag or resize saves a layout; a
  saved layout is never replaced by it. A saved layout carries its version
  beside its breakpoints (`{ version, lg, md, sm }`, `LAYOUT_VERSION` in
  `layouts.js`; none is version 1), and `migrateLayouts` brings an older one
  up to date before it is drawn: version 2 (#299) puts each node panel back
  to its minimum height and moves every panel up into the space that leaves
  (`compactUp`), since a layout saved before kept each node panel as tall as
  the reading tiles it no longer has. DashboardView saves the result with its
  version once, and every drag or resize saves the version with the layout,
  so the step never runs again on a layout and a height the user sets after
  it stays. A panel not on show (switched off in
  Settings, or a source not known to be set up) is not added to a layout, so
  it holds no empty slot. A fresh install with no node shows the "Connect your
  first node" empty state; while the first boot waits for nodes
  (`discovery: 'waiting'`, 6, #566) it is "Waiting for your first node",
  which says they appear on their own and offers no way to Settings, where
  a save would end the wait. The demo (`DEMO_MODE`) gets the same default
  from its own nodes. The UPS and Pipeline panels show only when the server
  says their source is set up (`configuredPanels.js`). `/api/ups` carries `configured`:
  true when Prometheus has the UPS's readings or saw its `nut_ups_info` series
  in the last 7 days (one query, with `last_over_time`), false when neither,
  null when the query failed. `/api/gitea/activity` answers
  `{ configured: false }` when `GITEA_URL` is not set, or refused for holding
  a user or password (#419, 4.4), and then polls nothing; its 502 means a
  set-up Gitea failed. True shows the panel, with its down state
  when its source is down. False hides it, even when the saved layout names it,
  and drops it from the layout. Null (no answer yet, or a failure that says
  nothing) keeps the last answer this session, and hides the panel before
  there is one. Settings → Sections can hide either panel, not force it on.
  The page-level live region leaves out the outages of sources whose panel is
  hidden.
- **Data fetching.** `useDashboardData` holds a **304-stable identity contract**:
  on an unchanged poll `fetchJson` returns the same reference and `setState`
  bails via `Object.is`, so an all-304 tick triggers zero re-renders. It stores
  a response's ETag and body together, only once the body has parsed, so the
  `If-None-Match` it sends always describes the body a 304 hands back; a 200
  with an empty, malformed or cut-off body fails and keeps the last good pair.
  Per-source health (error / stale / retry) is derived at render without
  per-tick state.
- **Polling.** `App.jsx` drives one tick per refresh interval (30 s by default),
  and only while the Overview is on screen: a hidden browser tab, or any other
  page, pauses it, and returning refreshes every source at once. The board
  loads every source once on mount; a tick then fetches the live sources
  (`/api/services`, `/api/ups`, `/api/integrations`) plus one slow source in turn
  (`/api/history`, `/api/cron/status`, `/api/gitea/activity`), so four requests
  per tick. The header's `/api/status` is one more per tick, on every page
  (paused only while the browser tab is hidden), so the Overview makes five
  until the old board's sources go with it (#306 enforces spec §4's four). A
  panel shows its "updated ... ago" stale note after 2 missed polls of its own
  source (`pollPeriodMs` in `useDashboardData`): 1 minute for a live source and
  3 minutes for a slow one at 30 s. It is judged at the hook's `healthNow`,
  which steps every half interval, on the same clock the hook reads each
  source's last answer on, so a source that answers every poll never shows
  one, and a note clears as soon as its source answers again, a 304 too
  (#545). The utilities (#301) poll on their own,
  only while drawn and the browser tab shows: Pipeline `/api/gitea/activity`
  every third interval (90 s at 30 s), with the board's ETag, so the rail's
  read beside the board's is a 304; the Checklist reads `/api/todos` once when
  it is drawn; the weather (#307) `/api/weather` when it is drawn (unless
  the page read it in the last 10 minutes), then every 10 minutes, a failed
  read again a minute later, and nothing while it is configured off. The
  Settings preview loads once when shown and refreshes only on its button.
- **App tabs.** An `iframe` tab in the config is an app, opened at `/apps/<id>`.
  Its frame mounts on the first visit and stays mounted while another page is
  open (`useAppFrames`), so coming back finds the app where it was left: its
  page, scroll and sign-in. At most `MAX_LOADED_APPS` (5) stay mounted: opening
  one more unmounts the least recently opened, never the open one, since each
  is a whole web app running in the page. The sidebar dots each app that is
  loaded but not open, and its Unload button (under the pointer, on keyboard
  focus, always on a touch screen) unmounts it. Over the open app sits its
  bar (`AppBar`): its name and address, "Stays loaded when you switch away",
  Reload and "Open in new tab" (`noopener noreferrer`). Reload counts a reload
  on that app alone (`useAppFrames`' `reload(id)`), which `useEmbedStatus`
  takes as a Retry: that frame gets a new iframe element and the server is
  asked afresh, and no other frame reloads or moves. The frames fill the
  window under the header and the bar (`ShellApps`, which also names the open
  app's region).
  `AppFrames` hides the other frames with `visibility: hidden` at full size, not
  `display: none`, so an app laid out to its window isn't redrawn at zero size
  on every switch; each hidden slot is clipped, so it adds no scroll height.
  Frames are kept in first-visit order, not config order, because moving an
  iframe in the DOM reloads it. A tab removed from the config unmounts its
  frame. A hidden frame keeps the URL it last showed: the URL field in Settings
  changes the config on every key, so an edited URL loads when its tab is next
  opened, never a partial one while typing. The logic (the hooks) is apart
  from today's look (`AppFrames`, `IframeView`); the sidebar's Apps group
  reads which are loaded from it.
  - **Load state** (`useEmbedStatus`): loading; slow, when the frame hasn't
    loaded after 8 s (it keeps loading behind a "slow to load" notice with
    Retry, and shows as soon as it loads); shown; or blocked. Retry gives that
    frame a new iframe element, so only it reloads, and asks the server afresh.
  - **Blocked** means the app's own headers refuse framing. The page can't see
    that: a cross-origin frame's headers can't be read, and Chromium fires
    `load` for a refused frame too. So the server reads them.
    `GET /api/embed-check/:tabId?origin=<page origin>` looks the URL up in the
    saved display config by tab id (never a URL from the request), sends one
    GET with no cookie or credential, follows redirects only on the same host
    (hostname and port; `http://app` to `https://app` is followed), each hop
    through `assertSafeUrl`, gives up after 3 s, and reads `X-Frame-Options`
    and `Content-Security-Policy` from a 2xx answer without reading the body
    (`server/embedCheck.js`). A 401, 403 or 5xx answers a request without the
    user's cookie (a proxy's login, an app starting up), so its headers say
    nothing about the app: that is unknown, not blocked. `frameVerdict` applies them as a browser does
    (the HTML spec's X-Frame-Options check, CSP3 frame-ancestors matching; a
    frame-ancestors list replaces X-Frame-Options) against the page's origin,
    and names the header that blocks. Answers are cached per tab for 5 minutes,
    1 minute for a failure; Retry reads again once the answer is 5 s old; past
    the cache, 30 reads a minute at most.
  - **Asked about the saved URL only.** The server checks the URL it has saved
    for the tab, and the config is saved 2 s after the last edit. So the page
    asks only when the frame shows the URL the server has: `useConfigPersistence`
    returns the saved config (the mount load's, then each save once the server
    takes it), and `useEmbedStatus` asks when its frame's URL is that tab's
    saved URL. An edited URL is checked when its save lands, never per key, and
    an answer names the URL it is about, which the page checks again.
  - **Unknown.** When the server can't read the app (it can't reach it, doesn't
    trust its certificate, gets a non-2xx answer or is redirected to another
    host; the demo has no saved app tab, so it answers that it has none), or
    before the URL is saved, the frame
    shows whatever the browser puts in it.
- **Design system.** Two themes, dark and light, plus system, which follows
  the device (#304, spec §2): `src/shell/theme.js`'s `useTheme`, held by `App`
  so the login screen has it too. It puts the theme shown on `<html>` as
  `data-theme`, where `global.css` reads it (`:root` dark, `:root[data-theme=
  "light"]` light, both on the token values: graphite, violet the one accent),
  and the shell gives it to its `.jh-ui` roots. The header's toggle switches
  dark and light; Settings → Appearance and the command palette offer all
  three. The choice is kept per browser (`prefs`, `jaghelm-theme`). **Settings
  migration:** a saved value is read through `migrateTheme` once: each of the
  ten old themes becomes dark or light by what it drew (One Dark Pro, Dracula,
  Night Owl, GitHub Dark, Catppuccin Mocha and Material Ocean dark; GitHub
  Light, Catppuccin Latte, Solarized Light and Atom One Light light), and the
  new value is saved back; a value it doesn't know becomes system; nothing
  saved is dark. A display config's `theme` (seeding a browser with none
  saved) goes through the same mapping. The accent is violet: the config's
  old free `accentColor` is no longer read (`useThemeVars` sets no accent),
  and Fuchsia and Cyan come with #321. Also generic `--space-*` / `--text-*`
  scales plus semantic `--fs-*` card tokens, and a global `:focus-visible`
  ring + reduced-motion handling.
- **PWA.** `public/sw.js` precaches the app shell **and** the hashed first-paint
  bundles (the precache list, the build's full `dist/assets` list + version are
  injected at build by `scripts/inject-sw-precache.mjs`); immutable `/assets/`
  are served cache-first, and other same-origin GETs outside `/api/`
  network-first with a cached copy for offline. A page load (`mode:
  'navigate'`) offline with no copy of its own, such as `/alerts` never
  visited, gets the precached shell (`/`): every route is the same
  `index.html`, and the router opens the page its URL names (#296). Both runtime paths store into
  the same versioned cache; an `/assets/` response is stored only when it is ok
  and not HTML. On activate the worker deletes every other cache and trims
  `/assets/` entries not in the current build's asset list, so a redeploy at the
  same version doesn't leave its old bundles behind. The current build's lazy
  chunks, the shell, `/uploads/` and public files stay cached for offline use.
- **Old tab after a deploy.** A tab still on an older build that opens
  Settings, Alerts or an app asks for a chunk the deploy removed, and gets a
  404. `src/chunkReload.js`, installed by `main.jsx`, listens for Vite's
  `vite:preloadError` (fired for every failed lazy import in a build), cancels
  it and reloads the page once, onto the new build. The reload keeps the URL,
  which names the page (#296), so the page that was open comes back. The guard
  is the build: `main.jsx` passes the entry chunk's URL, whose hash changes
  whenever any lazy chunk's name does, and the reload stores it in
  sessionStorage. A chunk failure on a build that already reloaded once
  goes through to the root `ErrorBoundary`'s error screen, whenever it happens,
  so a chunk broken in the current build can't loop. Each later deploy is a new
  build and gets its own reload. Blocked sessionStorage means no reload. While
  the reload is under way, `ErrorBoundary` renders nothing, because the
  cancelled import resolves empty and the lazy view throws. If `reload()` throws,
  the error shows at once; if the page is still there 10 s after asking (the
  navigation was cancelled), the error screen shows then.
  - **Also covered, one reload then the error screen.** The same event fires
    for a chunk that is served but throws while it evaluates, and for a fetch
    that fails because the browser is offline. Each gets the one reload. A chunk
    that throws on the new build too shows the error screen straight after it.
    Offline, the service worker answers the reload with the cached shell of the
    same build, so the retry fails on a build that already reloaded and the
    error screen shows, with its Reload button for when the network is back.
  - **Android.** The Android app doesn't need this: its only lazy chunks are
    Capacitor's browser fallbacks for its plugins, bundled in the APK, which
    can't change while the app runs.

### 5.1 UI stack (Tailwind CSS v4, shadcn/ui, Lucide)

The overhaul (spec `docs/superpowers/specs/2026-10-18-jaghelm-overhaul-design.md`,
§5) rebuilds the screens on one component library in `src/ui/`, used by the web
app and, from Phase 4, the Android app. Until the last old screen goes, the new
stack sits beside today's CSS and must not restyle it.

- **Toolchain.** Tailwind CSS v4 compiles at build time through `@tailwindcss/vite`
  in `vite.config.js` and `mobile/vite.config.mobile.js`, into each app's one
  hashed stylesheet. Nothing is injected at runtime or loaded from a CDN.
  shadcn/ui is set up in `components.json`: JSX (no
  TypeScript), the Base UI primitives (style `base-nova`), and the `@ui` alias for
  `src/ui/` (`tsconfig.json` `paths`, so `npx shadcn add <name>` writes
  `src/ui/<name>.jsx`). Components import `cn` from `src/ui/lib/utils.js`:
  clsx's join and tailwind-merge's merge, taught the theme's type steps, named
  spacing, shadows, layers and motion, which it would otherwise misread (the
  `cn` package until #444; tailwind-merge with the same lists merges every pair
  of `src/ui/`'s classes the same, in half the bytes). A generated component's
  `import { cn } from 'cn'` is switched to it, and a test fails on any other
  `cn` in `src/ui/`. Icons come from
  `lucide-react` by name (`import { Check } from 'lucide-react'`), so a bundle
  carries only the icons it uses. The components so far are the controls
  (#285), the containers (#286), the data components (#288), the status
  components (#287), which the Android app's screens use (next point), and the
  shell (#296), the first screen built on them. The component gallery shows each in every state
  ([GALLERY.md](GALLERY.md), #289). The
  interactive controls and containers are built on Base UI primitives. A
  screen's root is a `UiRoot` (`src/ui/root.jsx`), which carries its switches
  to every portal; roots can nest, and a page has one toast viewport. Screens
  import the components, never `@base-ui/react` itself
  (`scripts/ui-stack.test.mjs`).
- **Both apps import `@ui/...`.** The Android build maps `@ui` to `../src/ui` and
  lists React and every package `src/ui/` imports in `resolve.dedupe`, so shared
  code uses the Android app's own copies: the APK build installs `mobile/` only,
  and a second React breaks hooks. A package added to `src/ui/` goes in both
  `package.json` files and that list; `scripts/ui-stack.test.mjs` checks it.
- **The floating layer loads on first use** (#444). The popups (Tooltip,
  Popover, Select, Dialog, Drawer, Confirm, the Sparkline's readout) are Base
  UI and floating-ui, and none draws the first screen. Their Base UI parts
  live in `src/ui/floating/`, one chunk (about 45 KB gzipped) that
  `src/ui/lib/floating.jsx` loads once for all of them: on the page's first
  pointer or keyboard input, or at once when a popup is opened from code or a
  Select mounts. Until then each component draws its trigger itself (the
  caller's element, or the Select's trigger as Base UI draws it) with the
  closed popup's ARIA; the tooltips' shared timing (Base UI's provider) stays
  in `UiRoot`. When the layer arrives, Base UI draws each trigger anew, but
  not one that has focus or is being pressed: that one waits until focus
  leaves it or its click is done, so focus never moves under a screen reader
  (a tooltip focused before then shows on its next focus). One activated
  meanwhile (a click, Enter or Space, a Select's arrow) opens its popup
  through Base UI. Once loaded it answers at once, so later popups never
  wait. The client tests and the gallery load it before they draw. It is the
  one `import()` in `src/` outside `src/lazyViews.js`, because the Android
  app shares `src/ui/` (`lazy-views.test.mjs`).
- **First paint is four scripts** (#444): the entry, Rolldown's runtime,
  `vendor-react`, and `shared`, every module first paint loads that a lazy
  chunk (Settings, the floating layer) also needs (`vite.config.js`), rather
  than a small chunk per set of chunks sharing them. `scripts/first-load.mjs`
  builds and adds up the first screen's download against spec §4's two
  budgets: 200 KB for the scripts, styles and page (the logo with them) and
  60 KB for the faces, over until today's board goes (#306).
  `e2e/first-load.spec.mjs` checks it counts what a browser fetches; #306
  makes it a CI check. It reports a phone's first screen too (#303): the same
  page, plus the phone screens' chunk and what it imports, and none of today's
  board's faces (`--phone`), which the same spec checks at 390px.
- **The Android app's status components are the shared ones** (#287): its
  StatusLamp, StatusWord, IssueRow, SubsystemStrip and SystemStatusCard moved
  from `mobile/src/components/` into `src/ui/` (SystemStatusCard became
  AttentionPanel), and its screens import them as `@ui/...`. As a stopgap
  until Phase 4 rebuilds those screens (#326, which removes it), each status
  component also draws the Android app's own look, its old markup and the
  class names `MobileApp.css` styles in the `legacy` layer. The
  `__ANDROID_LOOK__` define picks the look per build: true in the Android
  build, false in the web's (`src/ui/lib/status.js`). Each component reads it
  directly, so the bundler sees a literal and each bundle leaves the other
  look out: the APK carries neither tailwind-merge, Lucide nor the web look's code, bar
  the lamp marks its own lamp borrows
  ([design-system.md](design-system.md#two-looks)).
- **The phone screens are shared** (#303, spec §8 "Phone width"): the
  Android app's screens (Overview, Services, Infra, Alerts, and the service,
  node and incident details), the components they draw and the logic they
  need (`board.js`, `derive.js`, `groupByDay.js`, `useNavStack.js`,
  `issueRoute.js`) are in `src/phone/`, so the web below 768px draws them
  too. `mobile/` keeps what is the phone's own: native HTTP, storage, push,
  sign-in and boot, `Root.jsx`, the shell (`MobileApp.jsx`, its status bar
  `RefreshStatus.jsx` and its tab bar), the data loop (`useDashboard`,
  `pollScheduler`), Login, ConnectionScreen, NotificationSettings, fonts and
  stylesheets. A screen imports no platform. It gets the app's poll, its
  navigation stack and the entry's params as props (`data`, `nav`,
  `params`), and the rest from the `PhonePlatform` around it
  (`src/phone/platform.js`): today only `openTarget`, what Open does. The
  Android app's is `mobile/src/open.js` (http and https only, in a new
  window, which the WebView hands to the phone's browser), given in
  `MobileApp.jsx`. A screen drawn outside a `PhonePlatform` throws, and so
  does a `PhonePlatform` whose value has no `openTarget` function, as it
  mounts. On Android, Alerts' gear opens Notification settings, an Android
  screen, by name through `nav`; the web look draws no gear, Settings having
  no Notifications section yet (spec §7). `scripts/phone-imports.test.mjs` fails on an import in
  `src/phone/` (`import`, `export … from`, `import()` or
  `import.meta.glob()`) of a Capacitor plugin (`@capacitor*/`,
  `@capawesome*/`, `@capgo/`, `capacitor-`, `cordova-plugin-`), of
  `mobile/`, or of `@shared/` (mobile's alias for `src/`, which the web's
  build doesn't have: files there import relatively, and `@ui/` as both
  apps do), and on a glob that is root-relative (each app's build reads it
  from its own root) or not written out. Each screen and part draws two
  looks under `__ANDROID_LOOK__`, as the status components do: the Android
  app's, today's markup with the class names `MobileApp.css` styles in the
  Android build's `legacy` layer, unchanged (its 22 screenshots, `npm run
  test:android-shots`); and the web's, from `src/ui/` (design-system.md,
  "Phone screens"). `src/ui/tailwind.css` scans `src/phone/**/*.jsx` for
  classes, bar the two parts only the Android look draws (UptimeRing,
  UsageBar). The Android look's tests are in `mobile/src/`, in the Android
  build's Vitest; `mobile/src/testing/render.js` draws a screen inside the
  Android app's `PhonePlatform`. The web look's are beside the screens
  (`src/phone/*.test.jsx`), in the web's.
- **The phone screens on the web** (#303, spec §7, §8 "Phone width"). Below
  768px `App.jsx` draws `src/shell/PhoneView.jsx` (its own chunk, loaded only
  there: `loadPhoneView`) in the page, under the header and above the tabs,
  in place of the desktop Overview, today's board and the Alerts page:
  Overview on `/`, Services on `/services`, Infrastructure on
  `/infrastructure`, Alerts on `/alerts`. It gives the screens what
  `MobileApp.jsx` gives them on Android, from the web's own parts
  (`phoneData.js`): the header's poll (`useStatus`: the status, its reach and
  clock), judged fresh or stale by the one rule (`useStatusFreshness`), and
  the cards, read by `useDashboardData` with `only: ['services']` (a tick
  costs that and the status, nothing of today's board; the model carries the
  UPS's runtime, #549, and the web's own server always does, so its phone
  needs no `/api/ups`),
  on the tick the Overview's interval runs while a phone tab is on screen.
  The screens judge nothing: they draw the model through `board.js`, as on
  Android, and the cross-client suite holds the web's words to the model
  (`src/phone/crossClient.test.jsx`) as `mobile/src/crossClient.test.jsx`
  holds the Android look's. The navigation is the shared nav stack
  (`useNavStack`) with the browser's history (`phoneNav.js`): a pushed detail
  is a history entry on the same URL, its details kept in `history.state`, so
  Back closes it, Forward opens it again and a reload draws it again (entity
  URLs are Phase 2's, #309); a detail's own Back goes back in the history. Each
  detail is a full-screen sheet over the tab (`PhoneSheet`): the browser's
  modal `<dialog>` (`showModal`, so the header, the tabs and the page are
  inert under it), named by the screen's title (`SheetContext`), Escape asking
  the stack to close it. A detail opened from a detail stacks over it, and
  focus returns to the row that opened each. A sheet's title is `title-lg`,
  as the status word, and its status box gives the word, the reason and how
  long it has been so ("for 4 min · since 08:38", the model's `since` against
  the status's time; none while stale). A sheet drawn before its sources
  have answered (a reload with it open, or Forward to it) says "Loading…"
  until the status and the cards are in; only then is a thing they don't
  have "no longer reported", and with nothing to read it says why ("No
  signal", or the cards' read failing). `PhonePlatform`'s `openTarget`
  on the web opens a service's address (`safeUrl`: http, https, mailto) as
  the web's links open, a new tab or this one (Settings → Layout,
  `linkTarget`). Over the screens the header is the Phone board's own
  (`PhoneHeader` in `@ui/app-header`, #569; `ShellHeader` draws it when
  `App` says the window is a phone's): 56px, JagHelm's shield (or the
  instance's logo) and its name, a link to the Overview, and the 44px theme
  toggle. What the desktop header has besides moved: the status to the
  Overview's card (the header keeps only its sr-only live region), Settings
  and Log out to More, the search to the Services tab's own (the command
  palette still opens with ⌘K or Ctrl K). An open app's frame fills the
  window between its bar, under that header, and the tabs.
- **Cascade layers.** The order is `legacy, properties, theme, base, components,
  utilities`, declared at the top of every entry stylesheet. Each app's
  `styles/legacy.css` imports today's stylesheets into `legacy`, the lowest layer
  (web: `global.css` and `fonts.css`; Android: `MobileApp.css`, `Login.css`, `global.css` and
  `fonts.css`, in the order the bundle had them). The new stack's rules therefore
  win wherever both style an element: without this, `global.css`'s unlayered
  `* { margin: 0; padding: 0 }` would beat every spacing utility. Components do not
  import stylesheets themselves, since an unlayered sheet would outrank both.
- **Preflight is scoped.** Tailwind's reset would restyle every element on the
  page (margins, lists, headings, `svg` display). `src/ui/preflight.css` is
  Tailwind's preflight wrapped in `@scope (.jh-ui)`, generated by
  `node scripts/ui-preflight.mjs`; rerun it after a Tailwind upgrade (a test fails
  until you do). Give `jh-ui` to the root of each new screen (a `UiRoot`
  renders one) and to portalled content (dialogs, popovers, menus render
  outside their parent; `src/ui/lib/portal.js` does it for every overlay). `@scope` needs
  Chrome or Edge 118, Safari 17.4 or Firefox 146; the Android WebView is current
  Chromium. In an older browser new components lose the reset, and today's
  screens are unaffected either way.
- **Only `src/ui/` and the phone screens are scanned** for class names
  (`source(none)` plus `@source`, tests excluded; `src/phone/**/*.jsx` since
  #303), and every class found there ships whether a screen uses it or not.
  Add an `@source` line for each new folder of screens. Utilities are global
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
  A word in a comment ships too: Tailwind reads each scanned script as text,
  comments included, and v4 has no option to skip them (`@source` picks files;
  `@source not inline()` would refuse the word as a class as well). So the same
  test builds the stylesheet and fails on any utility it generates from `src/ui/`
  that no `className`, `cn()` or `cva()` there writes (a variable a class
  position reads counts), naming the file and the word (#424): reword it
  ("its own width" for "its container", "on screen" for "visible"). A few utilities
  are names the code writes as data under another contract, so they ship
  unused and prose may name them: `ring` (a StatusLamp shape), `overline` and
  `sticky` (theme names `cn` is taught), `table` (Table's `data-slot`); the
  test fails when one is no longer data. The stack's own stylesheets are
  scanned only for the variables they read, so their comments generate nothing.
- **Tokens.** JagHelm's design tokens are in `src/ui/tokens.css`, from the
  signed-off mock: a palette of OKLCH ramps, the roles components use, and a few
  component tokens, in dark and light, with three accents (Violet, Fuchsia,
  Cyan; `src/ui/accents.js` is the one list), two densities and three
  typefaces (`src/ui/typefaces.js`) switched by `data-theme`, `data-accent`,
  `data-density` and `data-typeface` on the `.jh-ui` root. [design-system.md](design-system.md) lists them with the rules for using
  them, and `scripts/ui-contrast.mjs` checks every text/background pairing in
  every theme and accent against the spec's floors, as sRGB and Display P3
  screens paint them, that each accent's hover is visibly different from
  its rest state, and that no accent colour sits within ΔE OK 0.05 of a status
  colour (`ui-contrast.test.mjs`). The chart colours (#386), six categorical
  slots and a sequential ramp, are roles there too: the same script checks
  them at 3:1 where charts are drawn, the ramp's steps, and the slots' separation
  under protanopia, deuteranopia and normal vision and from the status colours
  and the violet accent, their chroma and their lightness band
  (`chart-palette.test.mjs`).
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
  reads a variable itself (such as `rounded-[var(--radius-md)]`) needs that
  variable there too, which is why the radius scale is in both `tokens.css` and
  `tailwind.css`. The one exception is the two variables Base UI sets inline on
  a popup's positioner (`--anchor-width`, `--available-height`), which the
  test allows by name and checks that today's CSS never defines. Never add a
  `:root`, `html` or `body` rule or a `@theme` block without `reference`.
  `scripts/ui-stack.test.mjs` compiles the stack and fails on an unlayered
  rule, a root selector, a base rule outside `@scope (.jh-ui)`, a `var()` read
  that `.jh-ui` doesn't declare, the two radius scales drifting apart, a class
  in `src/ui/` that compiles to nothing (with Tailwind's sizes cleared,
  `text-sm` would silently do so) or that removes the focus ring, `cn`'s lists
  drifting from the theme, or a file in `src/ui/` importing another `cn`.
- **Fonts are self-hosted** (#244, #284): no font or stylesheet comes from
  another origin, and the server CSP allows fonts and styles from `'self'` only
  (`server/index.test.js`). Every woff2 lives in `src/fonts/` with its OFL
  licence, and Vite emits each as a hashed asset. Today's screens use
  `src/styles/fonts.css`: the exact latin files Google Fonts served the default
  Typography preset (Outfit, DM Sans, JetBrains Mono) and the Clean, Rounded and
  Sharp presets, with Google's descriptors, so they render pixel for pixel as
  before; `useThemeVars` no longer injects a Google stylesheet when a preset is
  picked. The new UI's faces are in `src/ui/fonts.css` (Manrope by default, Plus
  Jakarta Sans or Montserrat by `data-typeface`, JetBrains Mono), under family
  names ending in "Variable" so they never join today's families; JetBrains
  Mono's latin file is shared, so it downloads once. Each new face is a latin
  and a latin-ext file with Google's `unicode-range`, so the latin-ext file
  downloads only for text that needs it, such as "Łódź" (#394); today's faces
  are latin only. A browser downloads a face only when text renders in it, and
  nothing is preloaded. Today's board still draws DM Sans and Outfit on the
  Overview, below the new sections, so the first load fetches them until the
  last legacy panel goes (`scripts/first-load.mjs` counts them). `scripts/fonts.test.mjs` checks that every `@font-face`
  matches its file and licence and each file its pinned sha256, that nothing
  names Google Fonts or loads a font or stylesheet from elsewhere, that "Łódź"
  draws in each new face from its latin-ext file while latin text never needs
  it, and the new UI's 60 KB budget;
  [design-system.md](design-system.md#type) has the faces and the scale. The
  Android app keeps its own copies (`mobile/src/fonts/`) for today's screens.
- **When the old CSS is gone,** drop the `legacy` layer and the scoping: import
  Tailwind's own preflight, move the tokens to `:root` and drop `reference`.
  Delete `src/styles/fonts.css` and every file in `src/fonts/` but the new UI's
  four faces (eight files: latin and latin-ext).

## 6. Data model

All state is files under the data dir (no DB):

- **services.yaml** -- nodes, per-service overrides (display name, icon, and
  the Kuma monitor mapping `monitor` / `monitor_per_node`, see 4.2) and
  integration configs (each secret value stored separately, encrypted). Hot-reloaded on an
  external edit (the 5 s watcher compares the file's mtime, ctime, size and
  inode, so a chmod or chown shows too, #536); read copy-on-read;
  `POST /api/services/config` validated by Zod.
  `writeConfig` edits the file's own document, so a save keeps its comments
  and layout (#416, "A save keeps the file's comments" below).
  - **A read that yields no usable config is a failed read** (#463): an
    unparseable file, or one that is empty, comments only or not a mapping
    (an editor's truncate-then-write), keeps the previous config until the
    file changes again, with one warning. At boot, with nothing to keep, the
    board starts empty and the file is left as it is: only a missing file
    runs first-boot discovery (below). `nodes: {}` written on purpose is a
    real config and empties the board. Either way the board,
    a push and `/api/health` say the file is broken (#505, 4.6, 4.7): the
    config is a failed source until the file loads.
  - **A file that is there but can't be read is a failed read too** (#536):
    EACCES, EISDIR, EIO or any error but ENOENT. The config source is down
    with "services.yaml can't be read (permission denied)", `/api/health` has
    `unreadable`, the board keeps the last good config (empty at boot, no
    discovery), and every writer refuses it (below). Before, it gave the calm
    empty board at boot and a 500 on a save.
  - **While the config is a failed source, a retry reads it again** (#536)
    every 30 s, beside the watcher's 5 s poll, and reloads it when what it
    reads differs from the last read. The poll sees a chmod or chown of the
    file itself (its ctime), at once, both ways; the retry is for a fix the
    file's own stat doesn't show, such as its folder's permissions or a
    network share's cached attributes. The same failure again is quiet. One timer at most, started when the source
    goes down (or the watcher starts with it down), stopped when it is up
    again and on shutdown (`stopConfigWatcher`). A broken or unreadable file
    deleted is reloaded at the next poll and is broken no more, with one
    recovery push: a missing file then means what it means while JagHelm
    runs, the config in memory stays (empty after a broken boot), a read
    answers it as `CONFIG_ABSENT` and the next save writes a new file.
    First-boot discovery runs only for a boot with no file, as when a good
    file is deleted.
  - **First boot writes nothing until discovery finds a node** (#566,
    `firstBoot.js`). With no `services.yaml` at boot, discovery asks
    Prometheus for its node labels. Nodes found: the default config with
    them is saved before the server listens, as before. None found, because
    Prometheus doesn't answer (down, a typo) or hasn't scraped a node yet
    (the #470 start order): nothing is saved, JagHelm runs on the default
    config in memory, and the services refresh asks again each cycle (no
    timer of its own) until there are nodes, then saves the default with
    them, once, and reads them in the same cycle. One log line when the wait
    starts, one when it ends. Before, the boot saved a file with no nodes,
    and since the file was there discovery never ran again. Any file on disk
    is the user's: one saved in Settings meanwhile (a save that changes
    nothing writes nothing and doesn't end the wait), one put there by hand,
    one that doesn't parse, ends the wait and is never discovered over. The
    default is written over `CONFIG_ABSENT`, so only where there is no file
    (One writer, below), and a file that lands while discovery asks stands.
    While waiting, the config is no failed source: `configProblem()` is
    null, the watcher and the retry see nothing, and `/api/health` has
    `config: { state: 'discovering' }` (4.6). A refused `PROMETHEUS_URL`
    (#419) can't be asked until it is fixed, which takes a restart: the boot
    says so in one line, saves nothing and doesn't wait, so neither health
    nor Settings says discovery is under way. The wait is the first boot's
    only: a file deleted later is not discovered again.
  - **Nothing writes over a file that doesn't parse** (#423). The config
    kept for the board is not the file's, so `readConfig()` answers no config
    for it, only why (`services.yaml doesn't parse (<reason> at line N,
    column C)`, `is empty` or
    `isn't a mapping`, never a quote of the file, which can hold
    credentials). `GET /api/services/config` and every writer (the config
    save, the integration save, toggle and delete) answer that as a 503
    `{ error, code: "config_unparseable" }` with no version, the integration
    save before it stores a credential, and `writeConfig` parses the bytes it
    would replace and refuses them itself, whatever version its caller
    passes, so no writer can skip it. A file that can't be read (#536) is
    refused the same way, as a 503 `{ error, code: "config_unreadable" }`
    ("services.yaml can't be read (permission denied): fix it on the host;
    …"), before any version is compared, since it has none. Settings' read
    shows its reason in place of the tabs, as for `config_unparseable`; a
    save refused with it says so in the failed-save toast and shows the
    reason at once, without reading again, as for `config_unparseable`
    (#550). Before, one indentation slip and an
    integration added from the gallery rewrote the file to that one
    integration (the last good config at boot is `{}`). Fixed by hand, the
    next read or the watcher's reload loads it and saves work again. Settings
    shows the reason in place of the Nodes, Services and Integrations tabs,
    with Try again, and a save refused for it in the failed-save toast,
    without reading again.
  - **The config read never carries a credential** (#413).
    `GET /api/services/config` answers with each credential that is set as
    the marker `{ "$stored": true }`, never its value or its `$secret:`
    reference (`util/configMask.js`). A credential, at any depth:
    - the value of a key with a credential's name, in any case: `password` and
      `token` (plaintext, a number, or a `$secret:` reference, which the
      resolver reads from these two only), `apikey`, `api_key`, `api-key`,
      `secret`, `client_secret`, `pass`, `passwd`, `passphrase`,
      `access_token`, `auth_token`, `bearer` and `cookie`;
    - each value of an `extraHeaders` map, and any `loginBody` (a session's or
      a fallback session's);
    - a value under a key ending in `endpoint` (`endpoint`, `testEndpoint`,
      `extraEndpoints[].endpoint`, `loginEndpoint`) whose query carries a key
      (`SECRET_PARAMS` in `util/redact.js`, now with `X-Plex-Token`) or which
      has a password in it (`//user:pass@`), masked whole. A `{token}`
      placeholder is no credential in the endpoint itself.

    And directly on an integration entry: `key`, and every key the entry's
    endpoints or its preset's fill in through a `{name}` placeholder
    (`resolveEndpoint` in `lib/extract.js`), whatever its name (nextdns's
    `profile_id`). Never masked: a map's own keys (an integration, node,
    service or `monitor_per_node` named `secret` is a name), `key` anywhere
    else (in `fields` and `extraEndpoints` it names a field), and what the
    integration form shows and saves back on an entry (a url with no
    credential, username, target, instance, enabled, preset and every
    preset's URL parameters, such as
    Cloudflare's `account_id`): a marker there would be posted back through
    the form and written. One that is null or empty is sent as it is, so the
    marker always means a value is stored. `authHeader` names a header and is
    sent; its value is the `token`. No preset declares any other field secret.
    The URL is masked only when it carries a credential (a user name or
    password before the host, however written, or a key in its query,
    `urlCredential`, #422, #419), whole; the form
    then shows it empty and says to enter it without the credential, and a
    whole-config save of the read puts the stored URL back in its place.
  - **`POST /api/services/config` replaces the file, keeping what is stored.**
    The Nodes and Services tabs read the config, change it and post all of it
    back, markers included. Each marker is replaced by the value stored in its
    place before the write: the same keys, and in an array the element with
    the same `name`, `id` or `key` (the first it has), never the one at the
    same position. A marker is accepted only where the read would put one now:
    one in place of a credential where none is stored is a 409. The version
    is checked first (#423), so the file is the one Settings read: the edit
    put the marker where the read put none (a new entry, or one renamed or
    copied with its marker). One
    anywhere else, in an array element with no name, id or key (or one two
    elements share), or an object with `$stored` that is not exactly the
    marker, is a 400, and nothing is written. So a marker is never written,
    and a credential can't move to another key or another array element. A
    credential sent as a value replaces the stored one, as before. A stored
    credential kept on an integration entry (its marker, or the stored value
    sent again) whose URL the save moves to another origin is a 400 naming
    its place and saying to re-enter it for the new address (#556), whether
    the credential is in the secret store or typed into `services.yaml` by
    hand. The answer
    is `{ ok: true }` or an error naming the place, never a value. A save
    whose result equals the stored config writes nothing, so the file stays
    byte-for-byte as it was; a value JSON can't carry (a YAML date) reads back
    as text, so such a file is still rewritten. Settings shows a refused or
    failed save in a toast with the server's reason and reads the stored
    config again, so the screen matches what is saved.
  - **A save needs the version it read** (#423). A tab left open from before a
    change used to post its old copy, without what was added since, and the
    save deleted it. `services.yaml`'s version is an HMAC-SHA256 of its
    bytes on disk (`util/fileVersion.js`, which the display config's version
    shares, #547), so it survives a restart and changes with
    any edit, by hand or by JagHelm, a credential's too (the masked read
    can't show that, so a version of the answer would miss it). The key is
    32 random bytes in `config-version.key` in the data dir (below): a plain
    hash, kept in a HAR file or a screenshot, would let anyone rebuild a file
    JagHelm wrote from the masked read and test guesses at a weak plaintext
    credential in it offline. Not `DASH_SECRET`: the installs without one
    are the ones that still keep plaintext credentials.
    `GET /api/services/config` answers it as a strong ETag, and
    `POST /api/services/config` must send it back in `If-Match`. None is a
    428, and one that is no longer the file's is a 409
    `{ error, stale: true }`; nothing is written either way. A `W/` prefix is
    ignored (a compressing proxy weakens the ETag on the way); `*` is no
    version. A save answers with the new version as its ETag (one that
    changes nothing, the same), so the tab saves again without reading. The
    read loads a hand edit the 5 s watcher hasn't yet, so the config it
    answers always matches its version. `secrets.json` is not part of it: a
    config save never writes it, and a marker becomes the `$secret:`
    reference stored in its place, which names whatever is stored under it
    now; adding, moving or removing a reference changes `services.yaml`.
  - **One writer.** Every write of `services.yaml` (this route, and the
    integration save, toggle and delete below) reads it with `readConfig()`
    and writes it with `writeConfig(config, ifVersion)` in the same
    synchronous handler. `writeConfig` reads and hashes the file, compares it
    with the version its caller read and replaces it, with no `await` in
    between, so no other request can write after the check, and a write from
    outside the process (a hand edit in that instant) leaves it a conflict:
    the integration routes answer that with a 409 to try again. A write over
    `CONFIG_ABSENT` (no file was read) creates the file only if there still
    is none, atomically (`createExclusiveFileSync`: a temp file linked into
    place, which fails when a file is there), so a file put there from
    outside the process after the check is never replaced: that write is a
    conflict too (#566). A path that refuses the link yet reads as no file
    (a symlink to a file that doesn't exist) is an error, not a conflict: one
    error log line naming the symlink, and a 500 from Settings' save, never a
    409 that a reload can't settle. The first boot's save is one; when it
    fails, JagHelm runs on the nodes it found, in memory. `saveConfig` writes
    through `writeConfig` over whatever is there, for tests.
  - **A save keeps the file's comments and layout** (#416). `writeConfig`
    parses the bytes it is about to replace with the `yaml` package (pinned,
    server only), edits the difference between what the file holds and the
    new config into that document, and writes it back. A changed text, number
    or boolean is set in place, keeping its quoting and its comment. A new key
    goes at the end of its mapping (an empty `{}` that gets one becomes a
    block, as js-yaml writes it). A removed key goes with its own comment,
    the lines right above it. A comment a blank line above it (a section's
    heading, the file's header) stays, above the next key or last in the
    mapping, and a comment on the line of a key whose value is a block
    mapping or list stays on that line. A changed list, or a value of another
    type, is written anew in its place: the comments around it and its flow
    style stay, the comments inside a changed list go. Keys keep the file's
    order. Nothing is folded or padded anew: a long text stays on its line
    and a flow list stays `[a, b]`, but for a `>` folded text, folded at 120
    columns as js-yaml folds it. So a file JagHelm wrote comes back byte for
    byte apart from the change. A hand-written file has its spacing evened
    out: two-space indents, one space before an end-of-line comment, `\n`
    line ends, `[ a, b ]` written `[a, b]`. Some other layout changes on any
    save, the values staying right: a number or tag is written as `yaml`
    writes it (`012` as `12`, `1e3` as `1e+3`, `0x1F` as `0x1f`, `!!str 123`
    as `!!str '123'`); a hand-folded `>` text is folded anew at 120 columns;
    a comment at column 0 between a nested mapping's keys is indented to
    them, one indented deeper than the key below it moves to the end of the
    line above, and one that ends the file gets a blank line above it; and a
    blank line above a comment that ends a mapping goes. The read
    side stays js-yaml, so the edit is used only when it can be trusted: the
    `yaml` package parses the file with no error or warning; the file has no
    anchor, alias or merge key (an edit through one would change every place
    that uses it); the two parsers read it the same (an unquoted date is a
    `Date` to js-yaml and text to `yaml`); and js-yaml reads the edited text
    back deep-equal to the config being saved. Otherwise the save writes the
    whole file with js-yaml, as before, and logs one warn line that the
    comments were not kept and why (`reason`: `aliases`, `parsers` or
    `roundTrip`), never a value or the parser's error, which quotes the file.
    JagHelm's header (`# JagHelm Configuration`) is written only with a whole
    file (first boot, the fallback); an edit keeps the file's own top comment
    and adds none. The version check, the refusals, the atomic write, the
    reentrancy guard and the version of the bytes written are as before, and
    a save that changes nothing still writes nothing.
  - **Settings sends the version.** The Nodes and Services tabs send each
    save with the version their config was read at, one save at a time, so
    each sends the version the last one answered. A 409 for the version shows
    "Settings changed elsewhere; reloaded"; any other refusal (a 428 too)
    shows the server's reason. Either way Settings reads the config again,
    and the edits made on the screen it replaces are dropped, not sent: one
    that would have gone out from it says "Not saved: an earlier change on
    this screen was refused". A read that fails shows why in place of the
    tab, never the old or edited config. The version and the save queue
    are the app's, not a tab's or a Settings view's (#501): switching tabs
    or leaving Settings sends the pending save at once, and reads go out in
    the same queue as saves, so a read never answers a version a save has
    already replaced. A read that answers after an edit it didn't see
    leaves the screen and its version alone; a change made elsewhere then
    refuses that edit's save (409). A save or read with no answer in 15 s
    fails (`AbortSignal.timeout`), so a hung one can't hold up the queue; a
    timed-out save may have landed, so the config is read again before the
    next save. While a save is waiting or on its way, closing the browser
    tab asks first (`beforeunload`). The integration form doesn't post the
    config, and the Android app doesn't either.
  - **An integration's save in Settings merges** (`POST /api/integrations/save`,
    #402). The form's values go into the stored entry, and only what the form
    owns changes: the URL (required; one that carries a credential is a 400,
    see 4.3), the username and target (sent empty to
    remove them), the preset's URL params (allow-listed; empty removes), and a
    typed password or token (text only, else 400), stored under the
    integration's keyed secret name, `integration_<key>_password|token`
    (`keyedSecretName` in `lib/config.js`). A blank password or token keeps
    what is stored: a plaintext value or a `$secret:` under any name. Every
    other key stays (a custom integration's `endpoint`, `auth`, `authHeader`,
    `fields`, or anything written by hand), and an existing entry's `preset`
    is never changed. A save that changes nothing writes nothing, so the file
    stays byte-for-byte as it was; it still asks for a retry (4.3).
    The form never names a stored secret: a value it sends that is, or
    holds, a `$secret:` reference (the username, which the resolver reads,
    and the URL, target, URL params and fields) is a 400 naming the field
    unless it is the value already stored in that field of this entry, so
    an untouched reference written by hand round-trips; a typed password or
    token never is one. The connection test refuses the same. Before, a
    username `$secret:<another integration's secret>` with the URL pointed
    elsewhere sent that secret there. A typed password or token is stored
    for the origin of the entry's URL (4.3, #556). A URL moved to another
    origin (host, port or scheme, as a refresh resolves it) with a stored
    password or token left blank, a username that is a `$secret:`
    reference, or any other credential the entry keeps (a header written by
    hand), is a 400 `{ error, field? }` saying to re-enter it for the new
    address, before anything is stored or sent; the save and the test alike.
    The form shows a password's or token's beside that field.
  - **`enabled` belongs to the toggle once an entry exists.** A save that
    creates an entry sets it, and so does one without an `editingKey` (the
    toggle of web apps before #402 went through the save). An edit
    (`editingKey` sent) leaves it alone: the form sends a changed Enabled box
    to the toggle route after the save, so a form left open can't undo a toggle
    made since. An edit whose entry is gone (deleted in another tab) is refused
    with a 409 rather than merged into whatever is under the key it derives.
  - **The key.** The instance name is part of it: a changed one moves the
    entry to its new key, and an unchanged one keeps it where it is, even
    under a key Settings would not derive (`my_npm`). A move takes the entry's
    keyed secrets (`KEYED_SECRET_FIELDS`: url, username, password, token) with
    it: each one under the old key is copied, still encrypted, to the new
    key's name, replacing anything left there; one the old key doesn't have is
    removed under the new key too, since a preset resolves those names ahead
    of the entry's `$secret:` reference. A reference to an old name is pointed
    at the new one, and the old names are removed once the move is written,
    unless another entry still uses one (4.4).
  - **A taken key is refused** (#414). A save never lands on a key another
    integration holds: a rename onto one, or a new integration from the form
    (which sends `create: true`) under one, is refused with a 409
    `{ error, field: "instance" }` that names that integration as the
    Settings list does, before any secret is stored, so `services.yaml` and
    `secrets.json` are unchanged. The form shows it beside its Instance Name
    field and focuses that field, and clears it once the field is edited; the
    custom builder, which has no such field and always derives `_custom`,
    shows it as a save error. A save with neither `editingKey` nor `create`
    still merges into the entry under the key it derives, because the toggle
    of web apps before #402 posts exactly that (only a tab left open from
    before #402 sends one, until it reloads).
  - **The enable toggle** (`PATCH /api/integrations/:key`, body
    `{ "enabled": true|false }` and nothing else) sets `enabled` alone, writes
    nothing when the entry is already in that state, and asks for a retry when
    it enables.
  - **Delete** (`DELETE /api/integrations/:key`, the entry found by its own
    key) removes the entry and then its secrets (4.4), so a new integration
    under that key starts with no credential. A save whose write fails
    stores nothing (4.4).
- **display config** -- title, theme, layout (`{lg,md,sm}` grid item arrays),
  sections (per-panel visibility/order/colour), `overviewSections` (the
  Overview's show/hide switches, #307), search/weather/clock flags
  (`showSearch`, `showWeather`, `showClock`), links, tabs, fonts. Read
  copy-on-read; validated by Zod (`overviewSections` only takes on or off).
  The client drops two keys nothing reads (`dropDeadKeys`,
  `src/shell/overviewSections.js`): `showTodos`, Widgets' old "Show
  checklist panel", which nothing drawn ever read, and `showDockerStats`.
  Nothing else changes; the server's copy loses them at the next save.
  `customGroups` holds service uids; a group's old icon, colour and hidden
  are read as absent and go at the next save (#517, "Custom groups").
  - **A save needs the version it read** (#547), by `services.yaml`'s
    mechanism (`util/fileVersion.js`, #423): a device open from before
    another's save used to post its whole old copy, so a section hidden on
    one device came back when the other saved anything. The version is an
    HMAC-SHA256 of `display-config.json`'s bytes with the same key; a missing
    file's is `absent`, so the first save names it.
    `GET /api/display-config` answers it as a strong ETag (a poll's
    If-None-Match gets a 304; the demo sends none), and `POST` must send it back in
    `If-Match`: none is a 428, another a 409 `{ error, stale: true }` with
    the version now as its ETag; nothing is written either way. The read,
    the check and the write are one synchronous step, and a save answers
    with the version it wrote.
  - **A file that is no config is never answered as one**, so no device lays
    its changes over an empty copy and saves a config without the rest (the
    links, the tabs, `backupJobs`). One that doesn't parse or isn't a JSON
    object is a 503 `{ error, code: "config_unparseable" }` with its reason
    and position (never its text) and the file's version as the ETag: a
    device saves its whole config over that version, which rewrites the
    file. One that can't be read is a 503 `config_unreadable` with no
    version, and so is a save: fix it on the host.
  - **The read leaves out each value no save would take** (a hand edit), at
    the depth it is refused: a reserved key such as a nested `__proto__`, an
    unsafe `url` (the link or tab that holds it goes, the others stay), or a
    value the schema refuses (one `overviewSections` entry, not the map).
    One warning per version of the file names each path, never the value. A
    device saves back what it read, so the value would otherwise refuse
    every save from Settings; the next save drops it.
  - **A refused save is rebased, not dropped** (`useConfigPersistence`,
    `src/utils/rebaseConfig.js`). Display saves are automatic (a switch
    flipped saves 2 s later), so throwing the edit away would undo what the
    user just did. Saves go out one at a time, each over the version the one
    before it answered, and a config equal to the server's copy sends
    nothing. On a 409 (or a 428, when the mount read failed and there is no
    version) the device reads the server's copy and lays over it only the
    leaves it changed since the copy it last read: plain objects recurse,
    arrays and scalars are leaves, so two devices' switches in
    `overviewSections` both stay, and a leaf both changed takes this
    device's value. It shows that, keeps it in localStorage and saves it
    once over the new version ("Merged with changes from another device").
    Refused again, it takes the server's copy as it is ("Settings changed on
    another device; reloaded"). It shows or lays changes over only a copy: an
    object with its version (the read-only demo's needs none). With no file
    or one that doesn't parse, it keeps its config and sends the whole of it
    over that version; with one the server can't read, it keeps its config
    and says why.
  - **An edit whose save never landed is saved at the next load.**
    localStorage keeps, beside the config (`jaghelm-config`), the copy it
    descends from and its version (`jaghelm-config-base`), written together.
    At the next load what differs from that copy is laid over the server's
    copy and saved, as a refused save is. The unload flush (a keepalive fetch
    with the version; sendBeacon can't send `If-Match`) is only a head
    start. A tab open from before the version check came in sends none, and
    its saves get 428 until it is reloaded.
- **secrets** -- AES-256-GCM blob and the origins it may be sent to (#556),
  keyed by name (`integration_<key>_<field>` for a Settings save).
- **config version key** -- `config-version.key`: 32 random bytes (mode 0600)
  that the versions of `services.yaml` (#423) and `display-config.json`
  (#547) are HMACs with (`util/fileVersion.js`, above). Made on first
  start by a temp file linked into place, so two boots racing end up with one
  key. Never logged or answered. One that can't be read or isn't 32 bytes
  stops the boot (a key made up for one run would change every version at
  the next restart). Losing it costs one refused save per open screen: a new
  key is made and every version changes once.
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
  CHK["Gitea check.yml on the PR<br/>lint + typecheck + tests + CHANGELOG format<br/>+ gallery screenshots and axe"] --> PR
  PR["PR merged on Gitea<br/>(source of truth)"] --> MIRROR["mirror -> GitHub"]
  MIRROR --> GH["GitHub Actions: build-push.yml"]
  subgraph GH2["build-push.yml"]
    T["test gate<br/>node:test + Vitest + typecheck + audit"] --> B["build image<br/>:latest, :sha-short"]
    B --> S["cosign keyless sign (by digest)"]
  end
  GH --> GHCR["GHCR"]
  TAG["vX.Y.Z tag pushed on Gitea"] --> REL["GitHub Actions: release.yml<br/>add :X.Y.Z to the :sha-short digest<br/>+ GitHub Release"]
  REL --> GHCR
  PR -->|"push trigger (fast path)"| DEP["Gitea deploy.yml (self-hosted)"]
  CRON["every 5 min"] --> REC["Gitea reconcile.yml (self-hosted)<br/>vm-103's revision vs main's head"]
  subgraph DEP2["scripts/deploy/deploy.sh, run by both"]
    KEY["pin vm-103 host key<br/>(VM103_HOST_KEY)"] --> WAIT["deploy.yml: wait for :sha-short<br/>(superseded or late: green, vm-103 untouched)<br/>reconcile.yml: deploy main's head if behind<br/>(no image 30 min after the commit: fail)"]
    WAIT --> STAGE["stage: pull :sha-short<br/>+ deliver and verify compose.yaml"]
    STAGE --> SWITCH["retag :latest + recreate"]
    SWITCH --> GATE["health gate<br/>(Docker health + /api/health<br/>+ revision = this commit)"]
    GATE -->|"fail"| RB["auto-rollback to prev image<br/>+ prev compose.yaml;<br/>hold the commit from the reconcile"]
    GATE -->|"pass"| LIVE["live on prod"]
  end
```

- **PR gate** ([check.yml](../.gitea/workflows/check.yml)) runs on the
  self-hosted Gitea runner for every PR to `main`: secret scan, CHANGELOG
  format (both CHANGELOGs and their `changes/` fragments), lint, typecheck,
  server, web and mobile tests, and the asset check. Its `gallery` job, beside
  them, screenshots every state of every `src/ui/` component against its
  committed baseline and runs axe on each, in the pinned Playwright container
  ([GALLERY.md](GALLERY.md)).
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
- **Deploy** runs on vm-103's self-hosted Gitea runner, labelled `vm103` (no
  workflows but these two may use that label), as two workflows that run one
  implementation, [scripts/deploy/deploy.sh](../scripts/deploy/deploy.sh),
  read at the run's commit from the Gitea API (the runner has no checkout).
  **Deploy JagHelm** ([deploy.yml](../.gitea/workflows/deploy.yml)) is the
  fast path: on a push to `main` it waits up to 6 minutes for that commit's
  `:sha-<short>` image. If main moves past the commit meanwhile, or the image
  is not there in time, it ends green and changes nothing. **Reconcile
  production** ([reconcile.yml](../.gitea/workflows/reconcile.yml)) runs every
  5 minutes: it reads `/api/health`'s `revision` over HTTP and main's head from
  Gitea, stops after one line when they match, deploys main's head when it is
  behind and the image exists, and **fails when main's head still has no image
  30 minutes after its commit** (a failed or missing build). A commit whose
  deploy failed on vm-103, or that was rolled back by hand, is named in
  `deploy-failed` in the stack directory, and scheduled runs don't retry it; a
  run started by hand does. It runs only on `main`. Both share a concurrency
  group, so they never race
  ([ADR 0007](adr/0007-reconcile-deploy.md)). The deploy reaches the host over
  SSH that verifies a
  **pinned host key** (the `VM103_HOST_KEY` repository variable; without it the
  deploy fails before any SSH). There is no fallback to `:latest`. It pulls and
  **pins the commit's `:sha-<short>`** image and **delivers the commit's
  `compose.yaml`** to the
  stack directory: written as `compose.yaml.new`, checked by sha256 on the host,
  the old copy kept as `compose.yaml.prev`, renamed into place and validated with
  `docker compose config` before the container is recreated, so compose changes
  reach production with the release. The log records the repo and host hashes
  and a diff of the host copy. It then recreates behind a **health gate**, which
  also requires `/api/health`'s `revision` to be this commit, so a green deploy
  means the commit is live; any
  failure after the host was changed rolls back the previous image **and** the
  previous `compose.yaml` together, unless a later deploy has replaced it
  since. A run whose commit is no longer main's head changes nothing and ends
  green as superseded. What green and red mean, how to recover and the manual
  rollback: [RELEASING.md](RELEASING.md#production-deploys). The deploy owns `compose.yaml` on the host:
  host-specific additions (a secrets mount, host networking) go in
  `compose.override.yaml`, which Compose merges and the deploy never touches.
  Before the container is touched, the deploy refuses a merged config that
  drops host networking or a mount the running container has (such a drop can
  deploy "healthy" while push quietly stops), unless a hand-made
  `compose.accept-drops` file in the stack directory accepts it for one deploy;
  and it fails if vm-103 cannot pull the commit's image.
  Configuration (Gitea repository settings, Actions):

  | Kind | Name | Use |
  |------|------|-----|
  | Variable | `VM103_HOST_KEY` | Required. vm-103's host key as one known_hosts line (`<address> ssh-ed25519 AAAA…`), from `ssh-keyscan -t ed25519 <address>` with the fingerprint checked on vm-103. Update it after a rebuild. |
  | Variable | `COSIGN_VERIFY` | Optional. `true` verifies the image signature before deploying. |
  | Job token | `GITEA_TOKEN` (automatic) | Reads `deploy.sh`, main's head and `compose.yaml` at the deployed commit from the Gitea API; the jobs limit it to `contents: read`. Nothing to set. |

## 8. Testing

Automated tests gate every PR to `main` (`check.yml`) and every build of `main`
(`build-push.yml`):

- **Backend** (`node --test`, `npm run test:ci`): the AES-GCM secrets round-trip +
  tamper, the SSRF guard vectors, credential redaction, the upload allowlist,
  config schema/copy-on-read (incl. a `SIGKILL`-mid-write chaos test), route
  contracts, rate limiting, `/health` + `/readyz`, the status model (one test
  per row of spec §6.1's severity table in `server/status/severityTable.test.js`,
  each rule table-driven, and source-down fixtures through the real
  `assembleServices`), push built on it (the hysteresis table and its restart
  case, one push per failed source, the model's reason in every push, the FCM
  payload the Android app reads), backups and Arcane agents end to end (the
  display config and the poller through the loop to `/api/status`), every
  Arcane push pinned as a snapshot (`server/arcane/pushContent.test.js`),
  `/api/status` and its ETag, contract tests
  that freeze `/api/services`, `/api/ups` and `/api/cron/status`
  (`server/routes/contract.test.js`), and the pure HelmGrid
  `gridMath`, the service-worker precache injector, and the worker's install,
  activate and fetch handlers run against a fake cache (`scripts/sw.test.mjs`).
  Node reads run against a mock Prometheus (`server/testing/mockPrometheus.js`)
  that evaluates the PromQL JagHelm sends over series shaped like the homelab's
  and counts the queries: the per-cycle budget, and the batched reads against
  the per-node reader they replaced (`server/testing/legacyNodeData.js`).
- **Client** (`npm run test:client`, Vitest + jsdom + React Testing Library):
  config-driven rendering, settings primitives, the keyboard grid handle,
  per-source health banners, overlay/confirm semantics, the 304-stable data
  hook, the old-tab chunk reload, its per-build guard and stall watchdog
  (`src/chunkReload.test.jsx`), the router (`src/router/`), the shell
  (`src/App.shell.test.jsx`: the header, every nav entry, deep links, Back and
  Forward; `src/shell/ShellHeader.test.jsx`: each state of the header, and a
  render count proving the "updated" tick re-renders nothing else), the rule
  for a stale status (`src/shell/statusFreshness.test.jsx`: the hook, its
  words, its one clock, and the age boundary, to the ms and after a tab
  shown hours later; `src/demo.render.test.jsx`, "No signal": no level
  colour in the header, the panel, the strip, the Infrastructure section or
  the Services section,
  no lamp named by a level word, one age everywhere, a tab shown hours
  later grey before its answer, and every colour back with the next
  answer), the status
  poll's request budget (`src/App.polling.test.jsx`), the loaded-app cap
  (`src/hooks/useAppFrames.test.jsx`), the Infrastructure section's nodes
  against the model's fixtures (`src/shell/infrastructureView.test.jsx`) and
  on the demo (`src/demo.render.test.jsx`), the Services section's rows,
  groups and count against the model's fixtures
  (`src/shell/servicesView.test.jsx`) and on the demo, a saved layout's version step,
  run once (`layouts.test.jsx`, `DashboardView.test.jsx`), and the `src/ui/`
  components. The
  status fixtures (`src/testing/statusFixtures.js`) are built by the server's
  own model, never written by hand: the demo's boards as a client gets them
  (`demoBoard`), with a node's readings or the lines moved, among them the
  incident with the NAS at 94.6 % disk (`nasDiskIncident`).
  A test file that imports the app loads every lazily loaded view
  (`src/lazyViews.js`) before its tests run, and from then on each renders
  at once, without suspending (`src/testing/setup.js`). So a test that opens
  Settings, Alerts, an app or the More sheet never races its first import,
  or React's held-back reveal of it, on a busy machine (#490). A file that
  imports a floating component loads the floating layer the same way, so each
  draws Base UI from its first render; `src/ui/floating.test.jsx` gives each a
  layer of its own that loads only when the test lets it, and opens every one
  from the keyboard before it has (#444).
- **Cross-client status suite** (both of the above): seven named status fixtures
  (`server/testing/statusScenarios.js`) through the real push cycle
  (`server/status/crossClient.test.js`, in `test:ci`) and through the `src/ui`
  status components (`src/ui/crossClient.test.jsx`, in `test:client`), the
  Android screens (`mobile/src/crossClient.test.jsx`) and the same screens
  in the web's look below 768px (`src/phone/crossClient.test.jsx`, #303): every
  push and every status word, count, state and meter on the screen must agree
  with the model, or be a named exception (see 4.7).
- **Component gallery** (`npm run gallery:test`, Playwright in its pinned
  container; CI's `gallery` job): every state of every `src/ui/` component, in
  both themes and densities and the three accents where colour follows the
  accent, screenshotted against `gallery/baselines/` with no tolerance, and
  axe on each with every default rule, portals included, and two exceptions
  scoped to Base UI's markup around an open Select
  ([GALLERY.md](GALLERY.md#the-two-axe-exceptions)). `npm run gallery:update` regenerates the
  baselines; an approved change commits them in its PR.
  `scripts/gallery-build.test.mjs` (in `npm test`) keeps the gallery out of
  the production build and the container pinned in step.
- **The app shell in a browser** (`npm run test:e2e`, Playwright in the
  gallery's container; CI's `gallery` job, after the gallery): `e2e/shell.spec.mjs`
  and `e2e/overview.spec.mjs` run the production build under `vite preview`,
  answering every `/api` request in the test with the demo server's own
  answers (`demoResponse`, `e2e/app.mjs`) in its incident scenario (and, for
  the Overview, its healthy one), `/api/status` included, the shell at 390 and
  1440px and the desktop Overview at 768 (the narrowest window that draws it,
  #303) and 1440px. They check
  the header's incident sentence and its steel "No signal" with the backend
  down (and back), that every nav entry (sidebar, phone tabs and More) opens
  its page and every old view is reachable (on a phone an app's frame filling
  the window between its bar and the tabs), the app bar (Reload makes a new
  frame; "Open in new tab" is `_blank` with `noopener noreferrer`), Back,
  Forward and a reload, no sideways scroll on any page, and axe with every default rule, dark and
  light, at both widths: the whole Alerts page, and the shell's chrome and
  the status around today's Overview board. The Overview's status (#297): in
  the incident, the issue count and every issue row are on screen without
  scrolling (inside the window, under the header, above the phone's tabs);
  healthy, the quiet line, with no red, amber or green in the status area but
  its 10px lamps, the line's and the strip's (every colour each element
  draws, read in OKLCH); and an
  issue row, clicked or by Enter, brings its entity's place on the board into
  view, clear of the header, and focuses it; it is a link to its place's
  anchor, and a click dispatched with Ctrl, Meta, Shift, Alt or the middle
  button is neither cancelled nor moves focus or the scroll, while a plain one
  through the same dispatch does (#515: no real new tab, which tested
  Chromium, not JagHelm). The subsystem strip (#298): on
  screen under the status without scrolling, a tile per subsystem the model
  has anything in, nothing in a tile cut off and no sideways scroll; a tile, clicked or by Space and Enter (its focus ring showing),
  filters the rows and the board and back, Back and Forward follow the URL,
  and a filter whose panel is switched off says so; axe on the
  filtered status and the note. The Infrastructure section (#299,
  `e2e/infrastructure.spec.mjs`), at 1440 and 768px, dark and light, on
  the demo's healthy board and on its incident with the NAS at 94.6 % disk
  (`nasDiskIncident`, `src/testing/statusFixtures.js`, built through the model,
  answered in place of the demo's `/api/status` and `/api/services`): nothing
  in a card or the table cut off and no sideways scroll, in both views; axe on
  the section; healthy, no red, amber or green in it but its 10px ok lamps
  (the users' node colours, 10px swatches, set aside), so every meter is the
  accent's; the incident's amber only on the NAS's card (its word, its disk
  meter at "94%" and its reason), no red; a node's issue row brings its card
  into view and focuses it; the Nodes filter keeps the section and Services
  hides it. At 768px with the table chosen, the section draws the
  cards, with the NAS's warning and its "94%" on screen and nothing to scroll
  sideways. Each node panel below is as tall as its content (not shorter, and
  within a grid row), on the default layout and on a layout saved before
  #299, which is saved again with its version; and no panel on the board
  is shorter than its content (#498). The Services section (#300,
  `e2e/services.spec.mjs`), dark and light: every service's name in full and
  its column at least 120px at 1024 and 1440px, by node and by custom group,
  beside app metrics long enough to squeeze it (the metric ends in an
  ellipsis instead); the Phone board's list at 768px with nothing cut off; healthy,
  no red, amber or green in it but its small ok lamps, every row muted; the
  incident's red on Jellyfin's row alone; the grouping kept across a reload;
  the strip's Services tile brings the section alone into view, and a
  service's issue row focuses its row; axe on the section. No signal (#480, #495,
  `e2e/no-signal.spec.mjs`), at 1440 and 768px, dark and light: on the NAS
  incident, `/api/status` refused (the server unreachable) or answered 503
  (its status past the TTL); fresh, the colour probe finds the panel's red
  and the NAS's amber, then stale, no red, amber or green anywhere in the
  header, the Overview's status (panel and strip), the Infrastructure
  section or the Services section, every lamp the steel ring; the header and
  the panel read the same age as it moves on, and the next answer brings the
  colours back. The web on a phone (#303, `e2e/phone.spec.mjs`), at 390 × 844
  and 360 × 780 on the demo's incident: the five tabs, each its screen under
  its own URL, More keeping the rest, and `/services` and `/infrastructure`
  still the Overview's at 1440px; the Overview in the Android app's order
  (the status card, the strip, "Needs attention · 2" and its rows, then
  Services and Infrastructure as lists), and with six issues
  (`sixIssueIncident`) the strip on screen at scroll 0; the header the Phone
  board's (#569), dark and light: 56px, the 30px shield 16px in and the name,
  one button, the 44px theme toggle, which switches the theme of the header
  and the screens and keeps it, and no status word but the card's; with
  signing in asked for, More's Log out, its label where the links' are,
  signs out; a row, by Enter or a
  tap, opens its detail as a full-screen modal sheet named by its title, the
  browser's Back closes it with focus back on the row, Forward opens it
  again, Escape and the sheet's Back close it, and a service opened from a
  node's sheet stacks over it; the mock's type (the status word and a
  sheet's title 22/28 at 800 by a 16px lamp, the Alerts count 10px at 800 in
  an 18 × 16 pill); a reload with a sheet open and /api/services held back
  says "Loading…" until the cards come, never "no longer reported"; healthy,
  every lamp ok and nothing red or amber; with the server out of reach or
  answering 503 from the start, "No signal" and why, every lamp the ring;
  under No signal no red, amber or green on the
  screen, every lamp the ring, the header's live region saying "No signal"
  and why, the lists' counts last known;
  axe on each screen and detail, dark and light; and at 767 and 768px the
  phone screens and the desktop Overview flip  with the bottom tabs, at the same pixel. The utilities (#301,
  `e2e/utilities.spec.mjs`), on the demo's links, commits and to-dos: at
  1440px the Overview's rail beside its sections, level with the attention
  panel and 280 to 340px wide, today's board's own three left out, and none
  at 1280 (the board has them there), where the Launch page (from
  the sidebar) has all three panels and every link group; narrowing across
  1440 drops the rail and keeps today's board's elements (no remount); no
  sideways scroll at 390, 1280, 1440 and 2560px; the Checklist adds, ticks
  and deletes over plain HTTP (no `crypto.randomUUID` in the page), each
  change reaching the server, which a reload shows, on the Launch page and in
  the rail; axe, dark and light, on the whole Launch page and on the
  Overview's shell, status and rail. Today's extras (#307,
  `e2e/extras.spec.mjs`): at 1440px weather and the clock at the top of the
  rail when configured, and none (no `/api/weather` read) when not; at 1280
  no rail, and the Launch page has them beside the web search, over Quick
  Launch; the search opens the configured engine's results in a new tab
  with no opener; a section switched off in Settings → Appearance stays off
  after a reload in a second browser context (another device), against a
  server that keeps the display config it is sent, and comes back when
  switched on there; a browser open from before that switch hides another
  section without bringing it back (#547: its save is refused, rebased and
  saved once more, both sections stay hidden on both); axe on the rail and
  the Launch page. Nothing hides (#302,
  `e2e/reflow.spec.mjs`): the Overview at 360, 390, 768, 1024, 1280, 1440,
  1920 and 2560px (below 768px the phone screens' lists, #303, and on the
  incident at 360, 390, 480, 600 and 767px the tab bar and a service's, a
  node's and an alert's sheet), healthy and
  incident, and on the incident with the
  model's longest subsystem sub-lines at each of them: the page no wider than
  its window; no element clipping its content (overflowing on an axis it
  clips, `hidden` or `clip`) unless it ends in an ellipsis with the whole text
  in a title or an accessible name and 64px of it drawn (#303: the header's
  sentence squeezed to a few letters on a phone passed before), and no text
  spilling out of its box;
  every service's and node's name whole and in the window; a failure names
  the element and the width. Every status fixture's strip, and a six-tile
  one with "Low battery", at 1024, 1280, 1440 and 1460px (past the page's
  split), in each of the three typefaces (#541): each tile's value and
  sub-line the model's, whole (no word cut, `overflow-wrap: normal`, nothing
  clipped or ending in an ellipsis), the value on one line, six tiles in one
  row or two of three, never 5 + 1. And six tiles carrying every value the
  model gives a tile, at each strip width from 672 to 1200px in each
  typeface: in one row from 816px and not below, every value on one line. Today's board is held only to its panels'
  heights (#306 deletes it: its Pipeline's commit messages and its Checklist's
  add row don't fit at 360 and 390px). A tablet (768 and 1023px) is one
  column, the strip wrapping. The first load at 390 × 844 on the incident
  shifts its layout by 0.1 or less (CLS, by a `layout-shift`
  PerformanceObserver, shifts after input left out; it was 0.50, the status
  arriving over sections already drawn, #243); from 768px up to 2560px and
  back with motion on, narrower panels at 1600 and 1100px included, every
  frame the board paints has every panel as tall as its content (#561); at
  1600px a tick that changes nothing measures no panel, and with a source 4 s slow a panel keeps the
  height it had last time until that source answers, then takes its own
  once. All eight leave screenshots in
  `test-results/e2e/shots/`.
- **Mobile** (`npm run test:mobile`, Vitest): the Android app's views (the
  shared phone screens in `src/phone/`, in the Android look), login,
  push routing, on-device storage, and the shared `src/ui/` components through
  the Android build's `@ui` alias. Its screen tests draw statuses the
  server's own model builds (`mobile/src/testing/board.js`), never status
  JSON written by hand, and the cross-client suite's Android side runs here
  (4.7).
- **The Android screens** (#546, `mobile/visual/android.spec.mjs`,
  `npm run test:android-shots`, Playwright in the gallery's container; CI's
  `gallery` job, last): the app as the APK runs it (its `index.html`, boot
  and shell, built with `mobile/vite.config.mobile.js`), each screen
  reached by tapping from launch and shot at 390 × 844 against
  `mobile/visual/baselines/` with no tolerance: the Overview calm,
  degraded, in an incident, with no signal (the server lost 3 min on) and
  with nothing monitored; Services, with one down and filtered to Down;
  Infra; Alerts; the service, node and incident details (a service's and
  the UPS's); Notification settings, and with the server unable to push;
  sign-in on first run and again; and Can't reach JagHelm. A screen taller
  than the phone's is shot again scrolled to its end (the incident's and no
  signal's Overview, Notification settings), and any other taller screen
  fails its test until it has that end shot too. The phone's plugins are
  stubbed at the boundary (`mobile/visual/native.js`) and the server is
  answered in the test from boards the model builds; a test fails on an
  error logged or a request elsewhere. `npm run android-shots:update`
  regenerates the baselines ([mobile/DESIGN.md](mobile/DESIGN.md#android-screenshots)).
- **The sign-in page in a browser** (#305, `e2e/login.spec.mjs`, with the
  shell's tests): the production build with a server that asks for a sign-in
  and takes one username and password, at 390 and 1440px, dark and light.
  axe finds nothing blank, with a wrong password's error on its field and with
  the sign-in failing to reach the server, and nothing scrolls sideways; a
  wrong password sent with Enter puts the error on the password field and
  focus there, and the right one opens the shell with the token stored.
  JagHelm's logo loads, the lockup for the theme (#530), and on a 390 × 667
  phone the page fits without scrolling, blank and with an error.
  Screenshots of each go to `test-results/e2e/shots/`.
- **The first load in a browser** (#444, `e2e/first-load.spec.mjs`, with the
  shell's tests): on the incident fixture at 1440px the page fetches exactly
  what `scripts/first-load.mjs` counts, the app's data aside, and not the
  floating layer, which the first pointer move brings; and a link focused by
  keyboard while the layer is held back keeps focus, the same element, when
  it arrives, and its tooltip opens on the next focus, beside it from the
  first frame it shows in.
- **Repo guards** (`node --test`, `scripts/*.test.mjs`): the deploy runner pin,
  the secret floor (`.gitignore`, tracked templates, the scanner catching a
  planted key) and its wiring in `check.yml`, the docs' preset and test
  counts (`doc-counts.test.mjs`), and the UI stack's separation from today's
  CSS and its reach into the Android build (`ui-stack.test.mjs`,
  `ui-preflight.test.mjs`), and the design tokens' shape and contrast
  (`ui-tokens.test.mjs`, `ui-contrast.test.mjs`) and the chart colours
  (`chart-palette.test.mjs`), and the fonts and type scale
  (`fonts.test.mjs`), and every lazy view's loader in `src/lazyViews.js`,
  the list the client tests load up front, and the floating layer's one
  loader (`lazy-views.test.mjs`), and the first load's arithmetic
  (`first-load.test.mjs`), and the phone screens' freedom from any platform
  (`phone-imports.test.mjs`). Write new
  repo checks this way, not as shell scripts: `npm test` only collects
  `*.test.{js,mjs,cjs}`.

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
| [0002](adr/0002-in-memory-single-instance.md) | Single-instance, in-memory state (no DB); sessions alone are also kept on disk, as token hashes (#250) |
| [0003](adr/0003-scoped-tls-bypass.md) | Per-request, opt-in TLS-verify bypass for self-signed infra |
| [0004](adr/0004-config-copy-on-read.md) | Config is copy-on-read + synchronous atomic writes |
| [0005](adr/0005-event-driven-deploy.md) | Event-driven build->deploy trigger (superseded by 0007, never enabled) |
| [0006](adr/0006-one-severity-table.md) | One severity table, judged on the server; push reads the same thresholds |
| [0007](adr/0007-reconcile-deploy.md) | Production converges on main's head: a scheduled reconcile on Gitea's own runner |

## 10. Known tradeoffs

Single-instance / in-memory (no clustering), single-user / single-tenant, and a
hard Prometheus dependency for node metrics are **deliberate scope choices**, not
bugs. The full list -- security defaults (open-by-default, host networking),
integration drift, and roadmap items -- lives in
[`KNOWN-ISSUES.md`](../KNOWN-ISSUES.md).
