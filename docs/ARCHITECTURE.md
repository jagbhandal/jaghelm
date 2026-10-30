# JagHelm — Architecture

JagHelm is a self-hosted homelab dashboard whose differentiator is **live data,
not just links**: it renders real Prometheus / cAdvisor metrics and pulls live
state from 35+ service integrations, on an Overview that reflows with its
content: problems first, then the nodes, the UPS, the jobs and the services.
It is **single-user, single-instance, and file-backed** (no database), and ships
as a Docker image to a homelab.

> Reflects `main` as of 1.0.0. For *why* specific decisions were made, see the
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
  env.js                    the environment schema: every variable, its type, default and
                            old name; the one reader of process.env, checked at boot (see 4.4)
  refresh.js                background refresh loop (start/stop)
  gitea.js                  the Pipeline panel's source: each repo's latest push runs (their
                            CI result, branch and sha) or, without Actions, its commits on
                            its default branch, polled every 5 minutes (see 4.2)
  cache.js                  bounded in-memory cache (evicts least recently written, ETags)
  discovery.js              Prometheus/cAdvisor -> nodes + services, one query per reading
                            across all nodes (see 4.2) (ignores containers labelled as Arcane
                            internal helpers, and throwaway containers named GITEA-ACTIONS-TASK-…
                            (CI jobs) or handbook-build-… (the handbook build), so
                            short-lived helpers and jobs never become cards or presence
                            breadcrumbs, or take a monitor)
  routes/containers.js      POST /api/containers/forget (#688): Remove on a missing container
  lokiLogs.js               GET /api/logs (#672): a node's or container's last error-ish
                            Loki lines, escaped query, cleaned output, 30 s cache
  promHistory.js            GET /api/history's series: node CPU, memory, disk and temperature,
                            and each drive's temperature (#728),
                            container CPU and memory over 1h / 24h / 7d / 30d from Prometheus
                            query_range, cached a step at a time (#311, see 4.2)
  monitoring.js             GET /api/monitoring (#751): every chart of the Monitoring page for a
                            range, from a frozen chart table, cached a step at a time per
                            (chart, range), each chart failing on its own (see 4.2); the
                            power-draw and monthly-cost charts (#753) are in it;
                            monitoringSections.js: the page's sections, shared with the client;
                            monitoringFocus.js: which chart an issue opens (#752), the banner's
                            "View graph" targets (`/monitoring?focus=<chart-id>`)
  energyCost.js             what the UPS's draw costs (#744, Monitoring spec 6): one hourly
                            30 d Prometheus query, kWh per local day (DST-safe), the rate in
                            force per day, month to date and projection; read by the monthly-cost chart
                            (monitoring.js); no route of its own
  diskForecast.js           GET /api/disk-forecast: days until each node's disk is full, a line
                            fitted to 7 days of Prometheus disk use, cached 10 minutes (#670, see
                            4.2); diskForecastLines.js: the amber/red lines both sides read
  drives.js                 drive health (SMART, #727): the status model's `drives` input, read from
                            smartctl_exporter series in Prometheus, probed and cached 10 minutes
                            (see 4.7 "Drive health"); status/drives.js judges them
  hostActions.js            GET /api/host-actions: the unticked rows of homelab-infra #848, the
                            pending host steps, read from Gitea (read-only), cached 5 minutes
                            (#673, see 4.2)
  backups.js                GET /api/backups: each marked backup job's last good run (from the cron
                            store) and b2.js's saved bucket samples (#675, see 4.2); b2.js: the
                            daily Backblaze read of the bucket's size (state: data/b2-usage.json);
                            backupAgeLines.js: the amber/red hours both sides read
  driftReports.js           the strict schema, limits and sanitising of a drift report, and the
                            36 h stale default; driftStore.js: the latest report per host
                            (data/drift-reports.json); routes/drift.js: POST /api/drift/report
                            and GET /api/drift (#674, see 4.2)
  expiry.js                 GET /api/expiry: TLS certificate and Tailscale node-key expiry, days
                            left; tlsExpiry.js (one handshake), tailscaleExpiry.js (device keys,
                            cached 6 h), expiryTargets.js (target parser and the amber/red
                            lines, shared with the web) (#676, see 4.2)
  monitors.js               Uptime Kuma: loads the monitors and assigns them to containers,
                            one container per monitor unless mapped (see 4.2)
  kumaBeats.js              each monitor's last 50 checks for the heartbeat strips: Kuma's
                            own beats, else one a cycle; encoded for /api/services, decoded
                            by the web (#312, see 4.2)
  icons.js                  icon picker search index: names only, persisted in the data dir,
                            refreshed from GitHub by the first search when a day old (see 6)
  icon-cache.js             public /api/icons/cached: icon-repository icons on disk, size-capped
                            with LRU eviction; a jsDelivr 403/5xx retries on
                            raw.githubusercontent.com (see 6)
  icon-sources.js           the icon repositories it may fetch from; the web client imports it too
  config.js                 services.yaml: load, hot-reload watch (and its 30 s retry while
                            broken), copy-on-read, its version, and the one atomic writer,
                            over the version read (see 6)
  firstBoot.js              first boot with no services.yaml: discovery, and the refresh
                            asking again until Prometheus has nodes, then one save (see 6)
  setup.js                  the guided first run's marker (`setup-pending` in the data dir):
                            left by a first boot, cleared by Finish or Skip (see 5, "First run")
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
  thresholdsFile.js         thresholds.json, the threshold lines Settings → Notifications
                            saved, read each cycle when it changes (#320, see 4.7)
  auth/                     scrypt passwords, sessions (token hashes on disk), login rate limit,
                            middleware
  routes/                   one router per resource (see 4.1)
  arcane/                   Arcane poller: read-only API client, state derivation, push builders,
                            its state and the commit that writes it with its pushes into the
                            push outbox (notices.js), dry-run module (see 4.2), and the agents
                            the status model reads from it (agents.js, see 4.7)
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
                            frames, Alerts, the More sheet, the phone screens and their
                            details, the detail drawer), every React.lazy() takes one;
                            the client tests load them all up front (see 8)
  router/                   routes.js (the route table: paths, params, and a route kept
                            hidden until its page exists, none now), useRoute.js
                            (the History API router, and a query parameter, useSearchParam)
  shell/                    the shell wired: ShellChrome.jsx (header, sidebar, phone tabs and
                            More sheet, fed from the route, the config and the status poll),
                            nav.js (the nav as data), AlertsPage.jsx (Active and History,
                            #314; alertsView.js, its filters and rows; alertsFilter.js,
                            the filters in the address, on listFilters.js's hook;
                            useAlertHistory.js, /api/events),
                            OverviewStatus.jsx (the
                            Overview's top from 768px: its status and subsystem strip),
                            PhoneView.jsx, phoneData.js and phoneNav.js (below 768px the
                            phone screens, their data from the web's parts, their details
                            a history entry each, #303), entityNav.js (entity URLs,
                            `?entity=<id>`: open, close, a row's link, #309), detail/ (the
                            desktop's detail drawer: EntityDrawer.jsx, its body
                            EntityDetail.jsx and what it reads, entityDetail.js, #309;
                            what a detail adds per kind, entityExtras.js, the reads it
                            makes while open, useDetailSources.js, its links,
                            detailLinks.js, and a node's Proxmox entry, proxmox.js, #310;
                            a job's runs and overdue line, jobRuns.js, and its Remove,
                            JobRemove.jsx and removal.js, #578; a node's or a container's
                            history, HistoryCharts.jsx and useHistory.js, #311),
                            historySeries.js (/api/history's answer as the drawer's
                            charts draw it) and historyLines.js (its lines, which the
                            node cards' hour of CPU reads alone, #311),
                            ShellAttention.jsx
                            (the attention panel both draw), statusView.js (how the status
                            model's issues are counted and worded, and its subsystems made
                            the strip's cells), overviewFilter.js (the strip's filter, in the
                            URL), entityAnchors.js (each Overview place's anchor),
                            OverviewBoard.jsx (the Overview's sections under its status,
                            from 768px, its first-run panel and its filter's note; it
                            replaced the old grid board, #306), useDashboardData.js
                            (what it reads beside the status, 304-stable, with each
                            source's health, sourceHealth.js, and each service's
                            integration numbers, useAppDataMatching.js), tickBudget.js
                            (the requests a tick may make, spec §4),
                            diskForecast.js (the nodes' "N days left" under the Disk
                            meter, #670: the note, its lines, the half-hourly read),
                            backups.js, Backups.jsx and BackupsSlot.jsx (the Overview's
                            Backups section, its own chunk, #675: the ages judged against
                            the lines, the 5-minute read),
                            OverviewInfrastructure.jsx and infrastructureView.js (the
                            Overview's Infrastructure section, its nodes from the model),
                            OverviewPower.jsx and powerView.js (its Power section: the
                            UPS, on mains too, #306),
                            OverviewServices.jsx and servicesView.js (the Overview's
                            Services section, its rows from the model, #300),
                            ServicesPage.jsx and InfrastructurePage.jsx (the Services and
                            Infrastructure pages, each its own chunk, #313: the
                            Overview's sections, from what both share,
                            useServicesSection.jsx and useInfrastructureSection.jsx,
                            with filters in the address, listFilters.js (the one
                            URL-filters hook and search draft, the Alerts pages'
                            too) over filterQuery.js (pure: the query and what a
                            search or state keeps), and what they keep,
                            pageFilters.js, out of the first load; a Proxmox
                            node's lists, proxmoxNodes.js), usePref.js (a choice kept
                            per browser that every reader of it follows),
                            OverviewJobs.jsx, PhoneJobs.jsx, jobsView.js and
                            removedJobs.js (the Overview's Jobs section and the phone's
                            list, each its own chunk, their rows from the model, the
                            jobs a Remove took off, #578), useChunk.js (a lazy chunk
                            drawn as soon as it is in, with no Suspense),
                            Utilities.jsx, utilities.js and LaunchPage.jsx (Quick Launch,
                            Pipeline and the Checklist: the Overview's rail from 1440px
                            and the Launch page, #301), OverviewLayout.jsx and
                            OverviewRail.jsx (the Overview's frame, and its rail, a chunk
                            of its own, #532), extras.js (weather, the clock
                            and the web search, #307), overviewSections.js (the
                            Overview's show/hide switches, #307), customGroups.js (the
                            custom groups, by service uid, #517), useMediaQuery.js (a
                            width the markup changes at),
                            freshness.js (the client's one rule for how old an answer
                            may get, #559), statusFreshness.js (the one rule for a stale
                            status: whether the poll's status is current, and how each
                            place draws one that isn't), theme.js (dark, light or system, and the old
                            themes' migration; see 5, "Design system")
  api/client.js             apiFetch -- explicit auth-injecting fetch wrapper
  context/                  ConfigContext (config + update via setIn), OverlayContext (toast/confirm)
  hooks/useData.js          fetchJson (304-aware), weather, search engines
  hooks/useStatus.js        the header's /api/status poll (see 5, "Status in the header")
  hooks/useSetup.js         whether the guided first run is pending, asked once at open (see 5, "First run")
  firstRun/                 SetupWizard.jsx: the guided first run, its own chunk (see 5, "First run")
  util/format.js            the one formatting module: units and locale for every date, time and
                            temperature (see 5, "Units and locale")
  hooks/useAppFrames.js,    app tabs: which frames are mounted (at most five, least recently
  hooks/useEmbedStatus.js   used out first), and each frame's load state (logic only; see 5,
                            "App tabs")
  utils/setIn.js            immutable structural-sharing deep-set
  components/settings/       Settings (#317, see 5, "Settings"): sections.js (the one list
                             of sections), sectionTerms.js (what they are found by),
                             sections/ (one module per section), the search
                             (settingsSearch.js), services.yaml's reads and saves
                             (serverConfig.js), shared primitives, and the cards the 13
                             tabs had; sections/integrations/ holds Integrations'
                             hooks and row words
  components/                CommandPalette, LoginPage, IconPicker, ErrorBoundary, etc.
  views/SettingsView.jsx     Settings' index and addresses: /settings, /settings/<section>,
                             an old tab's address to its section (no live preview, #306)
  views/AppFrames.jsx,       app tabs as they look today: the host keeping visited frames, and
  views/IframeView.jsx       one frame with its loading, slow and blocked notices
  styles/global.css          today's two themes (dark, light) on the new tokens' values +
                             component styles
  styles/fonts.css           today's fonts, self-hosted: the files Google Fonts served (see 5.1)
  styles/legacy.css          imports global.css and fonts.css into the `legacy` cascade layer
  fonts/                     every woff2 the web app ships (latin subsets; latin-ext too for the
                             new UI's faces) and their OFL licences
  ui/                        the redesign's component library (see 5.1):
                             tailwind.css (the stack's stylesheet), tokens.css (the design
                             tokens, docs/design-system.md), accents.js (the accents offered),
                             typefaces.js (the faces offered), fonts.css (their @font-face),
                             preflight.css (generated),
                             the controls (#285: button, icon-button, input, select, switch,
                             checkbox, field, segmented-control, tabs; design-system.md),
                             the containers (#286: root, panel, dialog, drawer, confirm,
                             popover, tooltip, toast, banner, empty-state, skeleton),
                             the status components (#287: status-lamp, status-word,
                             issue-row, subsystem-strip, attention-panel; #314: alert-history, alert-filters, the
                             web's), the data components (#288: metric-meter,
                             sparkline, uptime-bar, entity-row, fact-list, table; #311:
                             chart and its geometry, lib/chart.js, which the sparkline
                             shares, and detail-charts; #747: area-chart, in and out mirrored),
                             the sign-in screen (#305: login-form),
                             the shell (#296: app-shell, app-header, side-nav,
                             bottom-tabs, app-bar), the Overview's sections (#299:
                             node-card, infrastructure-section; #300: services-section;
                             #578: jobs-section),
                             the utilities (#301: utilities, Quick Launch, Pipeline,
                             the Checklist, the rail and the Launch page's layout;
                             #307: WeatherClock, WebSearch),
                             lib/status.js (the five states, their words,
                             the two looks, and why there is no signal),
                             lib/ago.js ("12 s ago"), lib/clock.js (the one clock every
                             age on screen and every judge of staleness reads, #559),
                             lib/utils.js (cn, taught the theme),
                             lib/portal.js (portal roots and the switches they copy),
                             lib/floating.jsx (the floating layer's loader and the
                             triggers drawn until it is in), floating/ (the popups'
                             Base UI parts, one chunk loaded on first use; see 5.1),
                             lib/field-context.js (how a Field labels its control),
                             lib/tone.jsx (a tone's icon), lib/name.js (an overlay's
                             required name), lib/link.js (a link the page opens itself)
  phone/                     the phone screens, shared (#303; see 5.1, "The phone screens
                             are shared"): views/ (Overview, Services, Infra, Alerts and the
                             service, node and incident details), components/ (the rows,
                             cards, bars and headers they draw), data/ (board.js, what each
                             screen shows of the status model; derive.js and groupByDay.js,
                             display helpers), nav/ (useNavStack.js, a tab's detail stack;
                             issueRoute.js, where an issue row leads; entityRoute.js, which
                             detail an entity id opens, #309), platform.js (what a
                             screen needs of the shell drawing it), sheet.js (a detail's title
                             naming the web's sheet); their tests are here

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
                            reflow.spec.mjs, first-load.spec.mjs, extras.spec.mjs,
                            palette.spec.mjs, pages.spec.mjs, what
                            they share in app.mjs; see 8): the
                            production build served
                            by `vite preview`, every /api request answered in the test; run
                            by playwright.e2e.config.mjs in the gallery's container

public/sw.js                service worker (precache injected at build)
components.json             shadcn/ui CLI settings (JSX, Base UI, `@ui` -> src/ui/)
scripts/                    inject-sw-precache.mjs, check-assets.mjs, changelog-lint.mjs,
                            changelog-fold.mjs, release-notes.mjs (build/CI/release helpers),
                            ui-preflight.mjs (writes src/ui/preflight.css),
                            ui-contrast.mjs (the design tokens' contrast check, and the
                            chart colours' gates), gallery.mjs (runs the gallery's tests in
                            their container), deploy/deploy.sh (the production deploy both
                            Gitea deploy workflows run, one command per step)
changes/                    CHANGELOG fragments, one per PR;
                            the release PR folds them into the CHANGELOG (RELEASING.md)
.github/workflows/          build-push.yml (test -> build -> sign -> GHCR), release.yml (tag ->
                            promote by digest -> GitHub Release)
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
It answers each read the web app sends from the demo's fixtures
(a test walks its source for them, `server/demo.reads.test.js`), and
any other `/api` path with the live server's 404 (`Endpoint not found`), so an
endpoint the demo doesn't know can't pass for an empty one (#437).
`/api/status` is the status model (4.7) of the demo's board.

Routers (each `server/routes/*.js`), mounted under `/api`:

| Mount | Auth | Purpose |
|-------|------|---------|
| `/api/auth` | public | login, logout, auth-status |
| `/api/health`, `/api/readyz` | public | liveness / readiness probes |
| `/metrics` | public | Prometheus exposition |
| `/api/services` | token | discovered nodes + services, and each monitored service's heartbeat strip (`beats`, 4.2) (background-refreshed, ETag); `services.yaml` for Settings, without its credentials, and its save over the version read (`/config`, ETag and If-Match, see 6) |
| `/api/status` | token | the status model (4.7), built once a background cycle (ETag, and its build time as Last-Modified; 503 before the first cycle) |
| `/api/events` | token | the alert history (#267, 4.7 "Push"): every event push's differ made in the last 30 days, newest first, a page at a time (`limit`, at most 200; `before`, the last page's `next`), filtered by `entity`, `severity`, `kind` (the entity's kind, #314) and `q` (text, #314) |
| `/api/integrations` | token | per-integration live data (background-refreshed, ETag); the Settings save and enable toggle (see 6); the connection test (`/test`, see 4.3) |
| `/api/display-config` | token | the display config blob, and its save over the version read (ETag and If-Match, see 6) |
| `/api/setup` | token | whether the guided first run is pending (`GET`), and Finish or Skip (`POST /done`), which clears it for every device (#322, 5 "First run") |
| `/api/thresholds` | token | the threshold lines Settings → Notifications edits (#320, 4.7 "The threshold config"), and their save to `thresholds.json` over the version read (ETag and If-Match) |
| `/api/push/alerts` | token | Settings → Notifications' alert rules (#669, 4.7 "Smarter alerts"): what is held back, snoozed or acknowledged, and lifting one |
| `/api/push/web/alert-action` | the browser's own subscription endpoint, not the session | a notification's Snooze 1h and Ack buttons, posted by the service worker (#669) |
| `/api/push` | token | Settings → Notifications' devices by fingerprint (`/devices`, never a token), removing one, and the test push (`/test`, #320, 4.7 "Push"); the Android app's registration, status and prefs routes are gone (#659) and answer 404 like any unknown route. The browsers' own subscriptions are under `/api/push/web` |
| `/api/embed-check/:tabId`, `POST /api/embed-check` | token | whether a saved app tab's headers let the browser frame it (see 5, "App tabs"); the POST asks it of an address not saved yet, `{ url, origin }`, for Settings → Apps & links' add form (#362) |
| `/api/secrets` | token + **auth-required** | encrypted credential store (fail-closed) |
| `/api/backups` | token | the Overview's Backups section (#675, 4.2 "Backups"): each marked backup job's last good run and the saved B2 bucket size samples; local, no outbound request |
| `POST /api/containers/forget` | token + **auth-required** | forget a missing container from the container registry (#688, 4.2 "Kuma monitors and containers"); fail-closed |
| `/api/cron`, `/api/todos`, `/api/upload`, `/api/icons` | token | widgets + asset upload |
| `/api/drift` | `POST /report`: the shared secret in the body (`JAGHELM_CRON_SECRET`); `GET /`: token | a host's config drift check result, pushed by a timer on that host, and the Overview's Config drift row's read (#674, 4.2) |
| `/api/icons/cached` | public | icon-repository icons from the local icon cache (an `<img>` can't send the token; see 6) |
| `/api/...` (infrastructure) | token | UPS, Gitea activity, etc., read from the refresh loop |

Auth is a **header token**, not a cookie (so permissive CORS is not a CSRF
vector). `/api/secrets` and `POST /api/containers/forget` additionally go
through `requireAuthEnabled` -- they return 403 when no password is set, so an
open instance can't enumerate credentials or clear a warning ([KNOWN-ISSUES](../KNOWN-ISSUES.md) covers the open-by-default model).

### 4.2 Background refresh & cache

`refresh.js` runs a single in-process interval that re-fetches node/service
metrics and every configured integration that is due (see 4.3) into the bounded `cache.js`
(it evicts the least recently written key at max entries, so user-influenced
keys can't exhaust memory). API reads serve from the cache and attach an ETag;
an unchanged poll returns `304`.
Each cached value is serialized and hashed once, on its first request, and kept
with it, so later requests (`200` or `304`) only send what is already in memory
until the next refresh replaces the value.
`If-None-Match` is matched per RFC 9110: weak comparison (a `W/` ignored on
either side), a list of tags, or `*`.
Two reads served outside the cache have their own reuse rules: `/api/history`
(the history charts, below) keeps its own cache a step at a time and carries an
ETag of its response, and `/api/cron/status` (whose `seconds_since_report`
changes every second, so an ETag would never match) sends `Cache-Control:
private, max-age=60`.

**Monitoring charts** (#751, Monitoring spec §7; `monitoring.js`, route in
`routes/infrastructure.js`, behind auth). `GET /api/monitoring?range=1h|24h|7d|30d`
answers `{ range, charts }`, every chart of the Monitoring page in one request.
The charts are one frozen table, `MONITORING_CHARTS`, like `HISTORY_SERIES`:
each chart's id, `title`, `question`, `section` (`monitoringSections.js`), the
`request` noun its failure sentence uses, and `read`, which asks Prometheus and
returns the chart's data or throws. The client sends a range and nothing else,
never PromQL; a chart is added by adding its row (and its drawing in
`src/shell/monitoringDrawings.jsx`). The ranges, steps and windows are `/api/history`'s.
Each (chart, range) is cached until the range's next step begins, concurrent
reads share one query, and a failed read is kept 10 seconds; a failure goes out
as that chart's own `ok: false` with its fixed sentence from `failureWords.js`
("Prometheus refused the CPU query (HTTP 400)"), the raw detail logged once, and
the other charts are untouched. The ETag is a hash of the response. A chart
marked `live` is not kept here (its reader keeps its own), and a reader may
answer `{ ok: false, error }` with a sentence it already has. The charts are
`cpu-overview` (every visible node's CPU as the Overview's cards read it),
`power-draw` and `monthly-cost` (#753; see below).

**Power draw and Monthly cost** (#753, Monitoring spec §5, §6; section *Power
and cost*). `power-draw` is the UPS's watts (`nut_load` times
`nut_real_power_nominal_watts`, `energyCost.wattsQuery` at the range's window)
as `{ state, values, maxValues, stats, runtimeMinutes }`: `values` is one number
per step with `null` for a step with no reading (never 0), `maxValues` the
highest reading per step on 7 d and 30 d (the max band), `runtimeMinutes` the
UPS panel's runtime at the present load. `state: 'no-ups'` (no UPS series in
the range) carries no values and the page says so in words. `monthly-cost` is
`energyCost.read()` trimmed to `{ state, currency, currentRatePerKwh, days,
month }`, always the last 30 local days whatever the range; it is `live`, so a
rate saved in Settings shows on the next read. Money is rounded once per day
and once for the month, so the displayed bars need not sum to the month
figure: nothing on the client sums them. With no rate `currency` and every
cost are null, kWh stays, and the page shows an empty state linking to
Settings → System.

**History charts** (#311, spec §8; `promHistory.js`, route in
`routes/infrastructure.js`, behind auth). Prometheus already holds the
history, so JagHelm keeps none: `GET /api/history?series=…&entity=…&range=…`
asks Prometheus `query_range` for predefined series only, never PromQL from
the client: `node.cpu`, `node.memory`, `node.disk` (`/`, or the largest
filesystem on a node without one, as the instant read picks it) and
`node.temperature` (the hottest sensor) for a node, `drive.temperature` (#728,
smartctl's current temperature, one line a drive named by its `device`; it
needs a node as `entity`, and a node with no drives answers no lines),
`container.cpu` and `container.memory` (cAdvisor's working set, in bytes) for
a container. Up to five series of one kind go in one request (a node's drawer
reads its four, and its drives' when it has drives); `entity` is a node's key in services.yaml, or none for every visible
node (the node cards' hour of CPU: one query), or `<node>/<container>` for a
container series, each asked by the node's Prometheus `node` label
(`prometheus_node`, else its key). A container must be one the server itself
has seen on that node (its cached `/api/services` cards, or the container
registry, which keeps a gone one for a day: `containersOn`), and the query
names it by the server's own string: an unknown one is a 404 before anything
is cached or asked, so made-up names can neither send queries nor push real
answers out of the cache. `range` is `1h` (a point a minute, 61),
`24h` (every 5 minutes, 289), `7d` (every 30 minutes, 337) or `30d` (every
2 hours, 361; #745). On `7d` and `30d`, `max=1` adds `maxLines` to each series:
the highest reading in each step's window (`max_over_time`), so an average
does not hide a spike; `1h` and `24h` ignore it. Rates and
averages run over a window as long as the step, at least 2 minutes. An
unknown series or range, a malformed entity, or a container series without
one is a 400; a node services.yaml lacks is a 404. A range ends on a whole
step, so every read within one step asks Prometheus the same question: each
(series, entity, range) is cached until the next step begins (at most 200
entries, the oldest written evicted), and reads that arrive while one is
asked share its query, so any number of open drawers and Overviews cost one
query per step. The answer is `{ range, entity, series: [{ series, unit,
startMs, stepMs, count, ok, lines: [{ entity, values }] }] }`, one value per
step (null where Prometheus has none, so a gap stays a gap); a series whose
query failed is `ok: false` with no lines and a fixed `error`, the sentence a
failed Prometheus says everywhere (`failureWords.js`, 4.7 "Failed sources",
#605: "Prometheus refused the connection", "Prometheus refused the query
(HTTP 400)", "Prometheus is off: its URL is refused", "No Prometheus is set
up"), never Prometheus's text or a fetch
error's, kept for 10 seconds before Prometheus is asked again, and the chart
says "No data from Prometheus" rather than drawing an empty line that looks
healthy. The detail is logged as a warning once when a failure starts or its
sentence changes, and an info line once when Prometheus answers again, not on
every read. The ETag is a hash of the response, so a
poll within the step is a 304. The demo answers it from made-up readings
around each node's and container's current ones, refusing what the live
route refuses (`demoHistory`).

**Disk forecast** (#670; `diskForecast.js`, route in `routes/infrastructure.js`,
behind auth). `GET /api/disk-forecast` answers `{ ok, computedAt, windowDays,
nodes: { <node key>: { mount, primary, status, daysLeft, growthBytesPerDay,
r2, samples } } }`: how many days until a node's disk is full, from a least-squares
line through 7 days of used bytes (a point an hour, `node_filesystem_size_bytes`
less `_free_bytes`, every visible node in two `query_range` reads). The mounts
are real filesystems only: tmpfs, overlay, squashfs, network (nfs, cifs,
fuse) and the other pseudo types are left out in the query, and so are mounts
under `/var/lib/docker`, `/var/lib/containers` and `/var/lib/kubelet`, `/run`,
`/sys`, `/proc`, `/dev`, `/snap`, `/boot/efi` and the bind mounts of
`/etc/hosts`. A node is summed up by its mount with the fewest days left, else
by the one its disk meter shows (`/`, or its largest filesystem; `primary`). A
line is believed only when the data supports it, in this order: the last
reading is within two steps of the window's end (else `nodata`: a node shut
down, as MS-S1 is when idle, never gets a number); the fit starts after the
last drop of more than 2 % of the size between two points (a cleanup is not a
shrinking disk), and needs 36 hourly points after it (else `insufficient`); a
slope of zero or less, or a date more than 365 days away, is `stable`; an R² under
0.6 is `noisy` (a sawtooth of filling and pruning); the rest is `ok` with
`daysLeft` to a tenth. One answer is kept 10 minutes and shared by every
reader (a failed read 30 seconds), so any number of tabs cost two Prometheus
queries per 10 minutes; a failed Prometheus is `ok: false` with the fixed
sentence (4.2 history charts) and no nodes. The server decides nothing about
colour or alerts: the web reads the answer (`src/shell/diskForecast.js`),
draws `ok` as "N days left" under the node's Disk meter (cards, table, phone
Infra and node detail), amber under the display config's `diskForecastDays.warn`
(default 14) and red under `.crit` (default 3), with an icon and a word each
(`MeterNote` in `metric-meter.jsx`), and `nodata`, or any number while the
status is stale or the disk reading has no value, as "No signal". `stable`,
`noisy` and `insufficient` draw nothing. `diskForecastDays` (Settings → Nodes &
Services → Disk forecast) is `{ warn, crit }` in whole days, 1 to 365, crit under
warn; any other shape reads as unset, the route's read leaves it out, and it is
an `ATOMIC_KEYS` entry. The web reads the forecast on load and every 30
minutes after, not while the tab is hidden, on a clock of its own (the second
exception to the tick budget, `tickBudget.js`); the phone only while the
Infrastructure tab or a detail is open. The demo answers it with made-up
numbers, all drawn plain.

**Pending host steps** (#673; `hostActions.js`, route in `routes/infrastructure.js`,
behind auth). `GET /api/host-actions` reads one Gitea issue, homelab-infra #848
(a pinned running list of the PRs whose change only takes effect once someone
acts on a host), and counts its unticked checklist rows. Read-only, with the
Pipeline panel's `JAGHELM_GITEA_URL` and `JAGHELM_GITEA_TOKEN` (no new variable;
the token must be able to read that repo's issues), the token in the
`Authorization` header only and never in a log line. With either unset (or a URL
JagHelm refuses, `sourceUrls.js`) the answer is `{ configured: false }` and the
web draws nothing. Otherwise `{ configured: true, ok: true, count, items: [{ ref,
title, href }], more, href, stale? }` (`items` the first 8; `href` the issue; a row's
`href` its PR or issue in Gitea), or `{ configured: true, ok: false, href }` when
Gitea doesn't answer, answers an error, or the body isn't a checklist; the web
then draws one quiet link, "See #848", never a count. A row is a `- [ ]` line at
the start of a line inside the `## For Jag…` section (heading matched loosely,
case-insensitive; its `###` sub-headings stay inside it, the next `##` ends it),
outside code blocks (closed only by their own fence marker and length) and HTML
comments; its first **bold** text is the reference (`owner/repo#n`, or `#n` in
homelab-infra) and the words after it the title. Rows under "Waiting on Jag, no
host needed", "Claude's own host steps" and "Done" are not counted. No `For Jag`
section at all is unreadable; the section with no open row is zero (no tile, no
warning). The request has a 5 s timeout; one answer is kept 5 minutes and shared
by every reader (a failed read 1 minute), and the last good list keeps being
served, marked `stale`, for 30 minutes while Gitea is down. A token Gitea refuses
(401, 403) or a repo it can't see (404) is "See #848", asked again only every 10
minutes, with one warn line (the status) per window. The token never follows a
redirect to another origin. The answer is never an HTTP error. The web (`src/shell/HostActions.jsx`, its own chunk, loaded
by `HostActionsSlot` only when a page draws it) shows "Pending host steps" with the
count and a link out per row: after Services on the Overview (the section
`hostActions`: it moves and hides in Edit layout and in Settings → Appearance →
Overview sections like the others), and above the lists on the phone's Overview,
three rows at most. Zero open or no Gitea draws nothing at all; it never alerts or
changes a status. It reads on mount and every 5 minutes (`useHostActions`), on a
clock of its own (see the request budget below). The demo answers
`{ configured: false }`.

**Backups** (#675; `backups.js` and `b2.js`, route in `routes/infrastructure.js`,
behind auth). `GET /api/backups` answers `{ jobs, b2 }` from what the server
already holds; it makes no request of its own. It never alerts.

*Jobs.* One entry per key in `backupJobs` (4.7), by node then name, from the cron
store (`cron-store.js`, the last 3 runs of a job): `{ key, node, job, seen,
hostDown, last: { at, status, error? }, lastGood, failedRuns, runs }`. Where each
comes from: Proxmox is `pve:proxmox-backup`, reported by the PVE notification
webhooks (one result per vzdump job, not per guest, so there is no per-guest
row); vm-103 is `docker-brain:vm103-backup`, from `vm103-backup.sh`; the NAS is
`nas:nas-b2-backup`, from the rclone job's `backup.sh`. `lastGood` is the newest
success among the stored runs, `null` when all of them failed. A marked job
nothing has reported is `seen: false`. `hostDown` is true only when the board has a node
of that name (case-insensitive; `docker-brain`, vm-103's hostname, is looked up
as `vm103`) and reports it unreachable; an unknown node is not assumed down.
The server judges no age. The web (`src/shell/backups.js`) draws: no report,
"No signal"; a failed last run, red with the reporter's words and the last good
run; otherwise the age of the last good run against `backupAgeHours` (4.8),
amber from `warn` and red from `crit`, except that an old report from a host the
board knows is unreachable is amber at most ("<node> is not reporting"), since
the NAS and MS-S1 may simply be off.

*B2 bucket.* Off unless `JAGHELM_B2_KEY_ID`, `JAGHELM_B2_APP_KEY` and
`JAGHELM_B2_BUCKET` are all set (with only some, one boot warning names the
three, never a value). `startB2Usage` (from `index.js`) runs one job: 90 s after
boot (a day after the last good sample instead, when that is under 6 hours old),
then every 24 hours. A run authorizes (`b2_authorize_account`, v3), takes the
bucket id (from the key when it names the bucket, else `b2_list_buckets`) and
pages `b2_list_file_versions` (5000 a page, at most 200 pages and 3 minutes, 20 s
a request). Totals count only each name's newest version when it is an upload
(`liveBytes`); every older upload version, and every upload behind a hide marker,
is `hiddenBytes`, so a return of the old "keep all versions" growth shows as
hidden bytes while the live size stays flat. Per top-level folder it keeps the
bytes and the newest upload time (at most 40 folders, the rest "(other)").
A key limited to a name prefix lists only that prefix (shown as "key limited to …"). A redirect from Backblaze is refused, and a Retry-After on 429/503 is honoured up to 6 hours. Requests go only to `https://api.backblazeb2.com` and to the `apiUrl` and
`downloadUrl` it returns, each refused unless an https host under
`backblazeb2.com` with no credential or port (`isB2Url`); they go through
`safeFetch` in strict mode, which re-checks every redirect. The authorization
token is a local of one run; the application key is read from the environment
and never stored, logged or served, and an error is made of fixed words (never
Backblaze's message or a URL). One run at a time (a second `run()` gets the same
promise). A failed run backs off, 30 minutes doubling to 6 hours, and for a key
Backblaze rejects (401, 403) 6 hours doubling to a day, with one warn line per
attempt ("B2 key rejected: …" or the fixed reason) and one info line when it
works again.

Results are kept in `data/b2-usage.json` (atomic write): `{ bucket, latest,
history, error }`, `history` at most 90 daily points `{ t, live, hidden, files }`
(a second sample the same UTC day replaces the first). A file for another
bucket, or damaged, is read as no history. `b2` in the answer is `{ configured:
false }`, or `{ configured: true, bucket, pending, error: null | 'key-rejected' |
'unreachable', checkedAt, liveBytes, hiddenBytes, hiddenVersions, files,
weekChangeBytes, history: [[t, live]…], prefixes }` (the size fields only after a
first good sample; `weekChangeBytes` is the latest against the oldest point 6 to
8 days back, `null` with less history).

The web draws the bucket as one more row: its size, "+N GB in 7 d", a sparkline
from 2 points; amber for a rejected key, for a sample over 2 days old, and when
hidden versions are at least 10 GB and a tenth of the live size ("N GB hidden
versions"); unknown before the first sample. Under it, a disclosure lists when data
last arrived in each folder: a fact, not judged. The section is `backupFreshness`
(Settings → Appearance → Overview sections "Backup freshness", movable in Edit
layout); the web reads it on mount and every 5 minutes (`useBackups`), its own
chunk loaded when the browser is idle, outside the tick's budget (see below). It
draws nothing with no job marked and no B2 key, and the demo answers
`{ jobs: [], b2: { configured: false } }`.

**Config drift** (#674; `driftReports.js`, `driftStore.js`, `routes/drift.js`).
The repo's `drift_check.py` compares each stack's and each Pi's tracked config
files with what is on the host (repo is intent, host is truth). JagHelm runs no
check and holds no SSH key: a timer on a host that can run it pushes the result,
the way the PVE notification webhook pushes its backup results to
`/api/cron/report`. `POST /api/drift/report` takes the same shared `secret` in
the JSON body as the cron report (`JAGHELM_CRON_SECRET`, no new variable),
compared in constant time and a string only; with the secret unset the endpoint
is off (401) and `GET /api/drift` answers `{ configured: false }`, so the row is
absent. The body is `{ secret, host, checkedAt, status: "ok"|"drift"|"error",
items: [{ name, kind, detail? }] }` and nothing else (an unknown field is 400):
`host` letters, digits, `.`, `_`, `-` (64); `checkedAt` an ISO 8601 time with a
zone, a time after the server's clock is clamped to it, and a report checked earlier than the stored one is ignored (`200 { ok: true, stale: true }`); at most 200 items (`name` 256, `kind` 32,
`detail` 500 characters; more is 413, not cut, so a count never lies); the whole
body 64 KB; 32 hosts. Control characters in a string become spaces; bidi overrides and zero-width characters are removed. Each host
keeps its latest report only, with the server's `receivedAt`, in
`data/drift-reports.json` (written atomically like the cron store). `GET
/api/drift` (session auth) returns `{ configured, now, reports }`; `now` is the
server's clock, so an age never rests on the browser's.

The web (`src/shell/ConfigDrift.jsx`, own chunk, loaded once idle by
`ConfigDriftSlot`; judging in `src/shell/drift.js`) draws a "Config drift" row
after the pending host steps on the Overview (section `configDrift`: it moves and
hides in Edit layout and Settings → Appearance → Overview sections) and above the
lists on the phone's Overview. **Green** "No drift": every host's latest report
is ok and the newest report is younger than `driftStaleHours` (Settings → Nodes &
Services → Config drift, whole hours 1 to 720, default 36; an unset or bad value
reads as 36, on the read and on a save). **Amber**: any host says `drift`
("Drift"), or any says `error` ("Check failed", the check could not read a file),
or ANY host's report is older than the setting ("Unknown", naming the host and
its age: a silent host is never green, and with one cron job per host a dead job
must show). **Grey** "No reports": nothing was ever pushed. A host that is switched
off (MS-S1) keeps its last report and reads Unknown while it is off (no push
alert); each host's report age is shown beside it, and the row opens to the
per-host list with the drift items. A host whose last report is over 30 days old
(`DRIFT_PRUNE_DAYS`) is dropped from the store on read and on write, so a
decommissioned host is Unknown for 30 days and then gone; delete its key from
`data/drift-reports.json` to remove it sooner. Age is by the server's receive time, not the
host's `checkedAt`. Nothing here sends an alert. It reads on mount and every 5
minutes, on a clock of its own (see the request budget below). The demo answers
`{ configured: false }`.

A host pushes with `docs/examples/drift-push.sh`: it runs `drift_check.py` for
one host, maps its exit code (0 ok; 1 with items drift, 1 with none is a crash, so `error`; 2 some file unreadable → `error`) to
`status`, turns its `DIFF`, `MISSING` and `UNREAD` lines into items, and posts the
JSON with the secret read from a file by jq and handed to curl on stdin, never on a command line (call it by the check's absolute path; cron's cwd differs):

```sh
H=${1:?host}; DC=${DRIFT_CHECK:-/opt/homelab-infra/tools/ops/drift_check.py}
OUT=$(python3 "$DC" "$H"); RC=$?
jq -n --rawfile s "${SECRET_FILE:-/etc/jaghelm/secret}" --arg h "$H" --arg t "$(date -u +%FT%TZ)" --argjson rc "$RC" --arg out "$OUT" \
  '[$out|split("\n")[]|capture("^\\S+\\s+(?<kind>DIFF|MISSING|UNREAD)\\s+(?<name>.+?)(?:  (?<detail>\\(.*\\)))?$")
    |{name:.name[:256], kind, detail:((.detail // "")[:500])}][:200] as $i
   | {secret:($s|rtrimstr("\n")), host:$h, checkedAt:$t, items:$i,
      status:(if $rc==0 then "ok" elif ($rc==1 and ($i|length)>0) then "drift" else "error" end)}' |
  ${CURL:-curl} -fsS --max-time 20 -H 'Content-Type: application/json' --data @- "${DRIFT_URL:-https://jaghelm.example}/api/drift/report"
```

```json
{ "secret": "...", "host": "pi-1", "checkedAt": "2026-10-24T06:00:00Z", "status": "drift",
  "items": [{ "name": "/etc/keepalived/keepalived.conf", "kind": "DIFF", "detail": "" }] }
```

Run it once per host the check covers (`pi-1`, `pi-2`, `vm-101`), from a daily
timer on the machine that has the SSH wrappers' keys (the check is read-only
there; JagHelm gets only its result).

**Expiry tracker** (#676; `expiry.js`, `tlsExpiry.js`, `tailscaleExpiry.js`,
`expiryTargets.js`, route in `routes/infrastructure.js`, behind auth).
`GET /api/expiry` lists what is about to expire, from two sources, each absent
unless set up, built so another source (a domain, a Gitea token) is one more
producer of items in `expiryAnswer`. Read-only; nothing here alerts (a push alert
for an item nearing its date is a follow-up).
*TLS certificates*: the targets are the display config's `expiry.tls`, an array of
`host` or `host:port` (a name, an IPv4 address or `[v6]`, port 443 unless
written, at most 30), edited in Settings → Nodes & Services → Expiry. Read and
written through one parser (`parseTarget`): only entries that parse survive,
canonical and once each, so one bad row never costs the list or a save; a value
of another shape reads as unset. The server makes a real TLS handshake with each
(`tls.connect`, SNI set from a typed name) about a minute after boot
(`startExpiryChecks`) and every 6 hours, 5 at a time, 6 s each, and at once for
a target with no result yet, so a target just added reads "Checking…" for a
moment and not for six hours. The handshake uses `rejectUnauthorized: false` so
an expired or self-signed certificate is read and reported, never trusted for
anything: the socket is closed the moment the certificate is in, no HTTP request
is made (so no redirect and nothing sent beyond the handshake), and only the end
date and the issuer's CN (one line, control characters out, 60 characters) are
kept, in memory. Targets are checked like other outbound requests: the SSRF
guard (`util/ssrf.js`) always refuses the cloud metadata address and 0.0.0.0/8,
and with `JAGHELM_BLOCK_PRIVATE_NETWORKS=true` also private, loopback and
link-local addresses, as `blocked`; a name is looked up first and the address
connected to is the one checked, so a name that resolves into a private range
is refused too. Without the setting a LAN address is a fine target. States:
`ok`, `expired` (also when a result read earlier has since passed its date),
`unreachable` (no TCP connection: refused, timed out, no such name),
`handshake_failed` (connected, no certificate came back), `blocked`, and
`checking`; a read certificate also says whether it covers the typed name
(`mismatch`: subject CN or SAN, IP SAN for an address), and one that does not
is amber, never green. *Suggestions*: the https hosts in services.yaml's integration URLs
(no credentials) that are not tracked yet come back as `suggestions`, for
Settings' one-click Track; JagHelm never adds one itself.
*Tailscale node keys*: with `JAGHELM_TAILSCALE_API_KEY` set (the Tailscale
integration's variable, so no new key if that is set up; a secret, in the
`Authorization` header only; never logged, returned or in a URL; an API access
token expires in 90 days at most), one GET to
`https://api.tailscale.com/api/v2/tailnet/{JAGHELM_TAILNET or -}/devices`, 10 s,
no redirect followed (a 3xx is a failure), one answer kept 6 hours. Per device it
reads `name` (its first part, the console's machine name; else `hostname`, which a
phone may report as "localhost"; equal names get their short id), `keyExpiryDisabled`,
`expires`, `lastSeen` and `isExternal` (shared-in devices are skipped); a device with `keyExpiryDisabled: true` is only counted
(`noExpiry`: one line in the UI), and any other device without a usable
`expires` is `unknown`, never a date. A device whose key has expired and that was
last seen over 30 days ago is `offline`: a muted "offline since <date>, key
expired" line outside the rows and the section's states (a machine that is
deliberately off the tailnet, such as MS-S1, can have its lingering entry
deleted in the Tailscale admin console). The key is the Tailscale integration's:
`.env`, else the secret Settings stored for it (`REPLACE_ME` counts as unset). 401 and 403 are `rejected` (the web says
the key was refused and that tokens expire), anything else `unreachable` or
`unreadable`; one warn line per retry window (10 minutes, 30 for a rejected
key), and the last good list is served, marked `stale`, for 48 hours except
after a rejection. Unset, the source is absent.
The answer is `{ configured, items: [{ id, source, name, detail, state,
daysLeft, expires }], noExpiry, tailscale: { configured, state, stale? },
suggestions }`, soonest first with the undated last; `daysLeft` is worked out
when the answer is built from the end date, so a result kept for hours is never
a stale count. `configured` is false with no target and no key (the web draws
nothing); the answer is never an HTTP error. The colours are the web's
(`src/shell/expiry.js`): amber under `expiryDays.warn` (default 21), red under
`expiryDays.crit` (default 7), whole days 1 to 365, red under amber, validated on
read and write like `diskForecastDays` (the earlier separate `expiryWarnDays` and
`expiryCritDays` are still read until Settings saves the pair; `expiry` and
`expiryDays` are `ATOMIC_KEYS`), always an icon and words, and anything without a date
(unreachable, handshake failed, refused, unknown, checking) sorts with the
amber ones and is never green. The web (`src/shell/Expiry.jsx`, its own chunk,
loaded by `ExpirySlot` when idle and only when a page draws it) shows the
section `expiry` after the pending host steps (it moves and hides in Edit layout
and Settings → Appearance → Overview sections), and a list above the lists on the
phone's Overview, four rows then a button for the rest. It reads on mount and
every 30 minutes (`useExpiry`), every 3 seconds (ten times at most) while a
target is still `checking`. The demo answers `{ configured: false }`.

It replaced the in-memory ring buffer (`history.js`, #266), which kept the
last 120 samples of each node's CPU, memory and disk from every refresh
cycle in `history.json` in the data dir and served them with no 304. The
refresh loop records nothing now; a `history.json` left from an older
version is never read or removed, and can be deleted by hand.
The loop is cancelled cleanly on shutdown (no leaking timer).

Node data comes from Prometheus in one batch per cycle (`getNodesData` in
`discovery.js`, #234): one instant query per reading, each matching every
visible node at once (`node=~"a|b|…"`, labels regex-escaped) and split by the
`node` label in JS. That is 13 queries a cycle (`NODE_QUERIES`) whatever the
number of nodes, plus one for the UPS (its four NUT series in one
`{__name__=~…}` selector); it was 14 per node, 2 more every cycle for a node
with no `/` filesystem, and 4 for the UPS (90 a cycle with the homelab's six
nodes). The UPS query asks for the UPS `JAGHELM_UPS_NAME` names (NUT's name,
the exporter's `ups` label), or with none set, for every UPS the exporter
reports, and the refresh keeps one: the first by name that has a reading,
else the first seen in the last 7 days (`pickUps`, #249; one info line when
there are several). No name is built in.

Gitea is not read every cycle (`gitea.js`, #249): a poll every 5 minutes
(`GITEA_POLL_MS`, Jag's decision on #249) is one `repos/search` request and one
request per repo (`fetchRepoPipeline`), however many rows it gives (#532). A
repo with Actions (`has_actions` in `repos/search`) is read through its latest
push runs (`/actions/runs?event=push&limit=10`): a row per commit and branch
they ran on, the run's title, branch and short SHA, and the commit's CI result
from the newest run of each workflow on it, judged by the status rules' one
table (`judgeCiRuns` in `server/status/rules.js`, ADR 0006): failed is `crit`
"Failed"; running, waiting or queued the no-signal ring ("Running",
"Waiting", "Queued"); passed `ok` "Passed"; cancelled or skipped `unknown`,
saying which. A full page of 10 runs leaves out the commit its oldest run
is on (unless it is the only one): its other workflows may be on the next
page, and four workflows a push (ilaaj-nanoclaw) would otherwise read as
passed on the two the page holds. A repo with Actions off is read through
its commits (`fetchRepoCommits`, without diff stats, files or signature
checks: `stat=false&verification=false&files=false`, a third smaller and
about three times as fast) on the branch `repos/search` gives as its
`default_branch` (none given: Gitea's own default), with no CI result: no
lamp, never a failure. So is a repo whose runs answer has no run (Actions on
but no workflow, or no Actions API, a 404): that poll costs it a second
request, and for the next hour (`NO_RUNS_RECHECK_MS`) it is read through its
commits alone, so the steady state is one request per repo; an hour rather
than until a restart, so a repo given its first workflow shows its lamps
within the hour. Gitea answers both without an ETag, so nothing is asked
conditionally. Pipeline is information, not monitoring: a failed run is no
entity, issue or push. Between polls the cycle gets the last poll's result with
no request; one poll runs at a time. A failed poll is tried again after 30 s
(`GITEA_RETRY_MS`), then twice as long each time up to 5 minutes, and until
one answers the cycle has a Gitea error (the Gitea source failed). The list is
cached for two polls after Gitea last answered, so `/api/gitea/activity`
never polls between them and keeps serving the last list through a failure,
its age in `Last-Modified` (when Gitea answered); past that the route answers
502. A failure is logged when it starts (the first failed poll's line) and
when it clears ("Gitea answers again", with the failed polls and how long),
the polls between at debug. With no Gitea URL set, nothing is ever polled. The queries: `up` (max by node), CPU, memory (MemTotal, MemAvailable
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
place, and the payload adds `discovery: 'waiting'`, which Settings → Nodes &
Services reads to say the nodes will come by themselves. `/api/ups` carries its own
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
  source's 2 failed cycles): "Prometheus hasn't scraped VM 103 in 3 scrape
  intervals", the node by its display name in `services.yaml`, else its
  `node` label (#605); the targets themselves (`vm103:9100 (vm103)`) go to
  the log only.
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
with no push snapshot (#461; 4.7, "Push").

#### Kuma monitors and containers

A Kuma monitor is one service, so it marks one container (#240): a down monitor
paints one card red, unless `services.yaml` maps it to several containers. It
sends one push either way (#407). Each cycle `assembleServices` (`refresh.js`) hands
`assignMonitors` (`monitors.js`) every shown, running container (the same name
on two nodes is two containers), plus the containers that stopped in the last
24 hours (the container registry's missing ones, kept for
`JAGHELM_PRESENCE_TTL_MS`, 24 hours by default), and the monitors are assigned
to them all at once. CI job containers and the handbook build container
(`handbook-build-<pid>`, matched by name prefix only) take no part: discovery
drops them (`IGNORED_NAME_PREFIXES` in `util/helperContainers.js`), and
records of them the container registry already holds are skipped too.

**Remove on a missing container (#688).** A container taken away on purpose
stays a "Missing" warning for `JAGHELM_PRESENCE_TTL_MS` and keeps the board
degraded. Its card (web drawer and phone sheet; only a container the model
judges Missing, drawn from a presence breadcrumb, and not a stack's lead,
whose members' sheets carry it) has **Remove…**, behind a confirm that says
"Forget <name> on <node>. It comes back if the container returns." and, when
`services.yaml` maps it to a Kuma monitor (`mapped` on the breadcrumb) or Kuma
last had a monitor on it (`kuma`), that this stays until edited: nothing of
`services.yaml`, Kuma or Docker is changed. `POST /api/containers/forget`
takes exactly `{ node, container }` (strings of at most 200 printable
characters; any other key, type or a non-JSON body is a 400 or 415, over 1 KB
a 413) and judges by the server's own cached board, never the browser's word:
the board must hold a presence card for that node and name, no running
container of that name on any node (else 409), and the registry must report
it missing (else 404). The node must also be reporting (`nodeReporting`):
reachable, with at least one card for something observed. A node that is off
(every target down), or whose cAdvisor is blind (`up` but no container
series), draws every container it remembers as Missing, so there it is a 409
and the detail shows "Remove is offered once the node is reporting" instead of
the button. It forgets the record at once (`containerRegistry.forget`
writes `container-registry.json` immediately, so a restart does not bring it
back), then runs a background cycle (`refreshNow`) and answers when it is
done or after 4 s, `refreshed: false` meaning the board follows on a later
cycle; the client reads again (`refreshNow.js`) instead of waiting for its
next poll. That cycle leaves the grid alone (`nextCycleAt` and the timer, so
clients' `X-Next-Refresh-Ms` stays true), and callers arriving while a cycle
runs share one queued behind it. It does count as a whole cycle to the status
model and push: a rule that waits for N cycles in a row (a pending monitor,
CPU over its line, push's debounce) gets one more cycle of its N, sooner than
the grid would give it. A Missing card pages only after the
hold (`JAGHELM_MISSING_PUSH_AFTER_MS`, #775), and removing it ends that
silently: no recovery is sent; a Kuma monitor's state is read from the
monitor, so it is unaffected. If the container runs again, discovery records it as a new one.
Gated as the secrets API (403 with no dashboard password unless
`JAGHELM_ALLOW_OPEN_SECRETS=true`, which therefore also opens container
removal to anyone who can reach the port), behind the session header, JSON only,
20 tries a minute per address.

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
   the wrong type (`util/configSchema.js`). The Settings UI writes `monitor`
   for a container on one node. For a container on several nodes (or one that
   already has `monitor_per_node` entries) it reads and writes
   `monitor_per_node[<node>]`; the first such write copies a container-wide
   `monitor` to the container's other nodes and removes it, so Auto-match on
   one node clears only that node. The dropdown's "No monitor" writes `false`.
   Settings shows, per container, what Auto-match would pick and why (#319):
   `GET /api/services/monitor-mapping` (`monitorMapping.js`, read-only, behind
   the same auth as `/api/services`) answers per uid (`node:container`)
   `{ attached, paused, suggested, why, candidates, held }`. It has no matching
   code of its own: every answer is `assignMonitors` on the last cycle's
   containers (running ones, and the stopped ones the board shows as presence
   cards), Kuma's monitors and the real `services:` mappings. `attached` is
   that run as it stands, so it follows the mappings and is current after a
   save, before the next cycle; `paused` marks a monitor Kuma has stopped
   hearing from. `suggested` is the same run with only this container's mapping
   on this node removed (a container-wide `monitor` stays on its other nodes):
   what Auto-match would do if it were cleared, and `why` its kind of match
   (`exact`, `url` and `contains` read "matched by name", `word` "matched by a
   shared word"; none is "no match"). A monitor another mapping holds is never
   suggested, since the matcher keeps it for that mapping, and `held` names each
   one with the `{ container, node }` that holds it, so Settings neither offers
   a button for it nor lets the dropdown pin it twice (two containers on one
   monitor are two red cards and two pushes). `candidates` are up to six
   monitors with similar names, best first. A monitor's own red card is listed
   too, with the monitor it is. Accepting a suggestion writes the same
   `monitor` / `monitor_per_node[<node>]` as any other choice, and Auto-match
   stays the way to take a mapping off. The row's tag reads this answer
   ("monitored" and the monitor's name, "monitor paused", else "no monitor";
   "opted out" for `false`), and the board's `monitored` while it is unread,
   never the container's own state; Settings reads it again after each save.
   Display name and icon follow the same rule (#636): `display_name_per_node`
   and `icon_per_node` (node key to a string) come first, then `display_name`
   / `icon`, then the discovered default, resolved by `overrideOf` in
   `monitors.js` for the running, monitor-only and stopped-container cards (a hand-edited
   non-string or blank value is ignored and never blocks a save).
   The Settings UI writes them per node under the same condition as the
   monitor, and its first per-node write moves a container-wide value to the
   other nodes' entries. Every card, group, search entry, push and alert reads
   the card's `display_name`, so a per-node name shows everywhere.
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
its grey card is what keeps it on the board (#438). A running container whose
monitor is paused keeps the container's own status on its card (status-page
fallback only; `/metrics` leaves paused monitors out), and the model reads the
service as no signal ("Kuma: monitor paused", `kumaStatusOf` = `paused`). The
uid stays in `monitorOf`, so the push snapshot holds its last state: staleness
pages nothing, a flapping monitor does not page twice, and a paged outage still
recovers (#488). A down monitor no running
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

Which node such a monitor is on (#644). A monitor no container carries
(`cadvisor-pi1`, whose cAdvisor the board hides) used to fall to the first
node, so four of them all appeared under Staging. `placeMonitor` now chooses
the node in this order, the first that gives one: (1) `monitor_nodes` in
`services.yaml` (monitor name, any case, to a node key on the board; Settings
sets it, below); (2) the node of the stopped container that got the monitor
while it is down, else the node it was last seen on, as before; (3) the node
whose address the monitor checks: the host of Kuma's `monitor_hostname`, else
of `monitor_url` (`kumaMetrics.js` keeps that host as `targetHost`, never the
URL, its credentials or query), matched to a node's `address:` (a host,
host:port or URL, or a list of them; hand-edited) or its key or
`prometheus_node` read as a host name (`pi1`, `pi1.lan`), when exactly one node
matches; (4) the node whose key, `prometheus_node` or display name is a whole
word of the monitor's name, when exactly one is (`cadvisor-pi1` is on `pi1`;
`vm101`, `vm-101` and `vm 101` are one word, `pi1` is not in `pi10`); (5) the
first node. An ambiguous match decides nothing and the next rule runs. The
rules look only at this cycle's inputs, in node-key order, so the answer does
not depend on the order of the nodes or monitors (`monitorNode.js`). The
choice is made again every cycle and is not remembered, so a setting or a node
that joins the board takes effect at the next cycle. A monitor that rule 1, 3
or 4 moves has a new uid (`node:name`); the push snapshot carries its state
across by `monitorOf` (#395), so an outage that began on the old uid recovers
once, on the new. `monitor_nodes` is checked like `monitor_per_node`: a value
that is not a node key, or a node not under `nodes:`, warns once. The refresh
keeps `monitorPlaced` (uid to `{ monitor, node, by }`) beside the payload for
every such monitor, up, down or pending, and `GET /api/services/monitor-mapping`
returns it as `monitorOnly`: Settings → Nodes & Services lists each as a row on
its node, tagged "monitor only", whose only field is a Node choice (Automatic,
or a node) that writes `monitor_nodes`; the row moves as soon as it is chosen. The row also
edits the monitor's display name and icon, written under its monitor name in
`services:`; the card resolves them by that name on any node (this node's
per-node entry, else the first node's, else the container-wide one,
`monitorOverrideOf`), so a move never loses a rename. A status entity of such
a monitor carries `monitorOnly: true`, and a custom group entry `node:name`
that matches no service holds the monitor-only service of that name wherever
it now is (`customGroups.js`); Settings rewrites it to the new uid when every
node is read. A `monitor_nodes` key that matches no monitor (renamed in Kuma)
warns once. Rows are keyed by monitor id.

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
Prometheus or Kuma failed (`sourceErrors`: its cause, `{ cause, status? }`,
which the model says in words, 4.7 "Failed sources", #605). Kuma's own status (`up`, `down`,
`pending`, `maintenance`) comes from `kumaStatus` on each monitor
(`kumaMetrics.js`, both the `/metrics` and the status-page paths).

The service registry's `seen` list has one record per monitor, the last node in
the pass for one mapped explicitly to a container on several nodes. A record is
written only when a monitor's node or container changes, so cycles that match
the same way write nothing, whatever order discovery returns containers in.

#### Compose stacks (#642)

A Compose stack is one row of the Services list, not one row per container.
The server groups once, in `assembleServices` (`server/stacks.js`), and the web
reads the result; no client groups.

*Where the project comes from.* Discovery reads cAdvisor's
`container_label_com_docker_compose_project` off `container_last_seen` (it was
already on the series) and carries `project` (lower case) and `image` on each
container that has one. A cAdvisor that does not export the label (a Pi's)
gives a container with no project, which is its own row, as before. The
container registry remembers the project (`container-registry.json`), so a
stopped member still belongs to its stack as a grey presence card.

*The rule.* A stack is one project on **one node**: the same container on two
nodes (gateway-npm on both Pis) is two cards and no stack, and one project on
two nodes is two stacks. Within it:

1. A member with its **own Kuma monitor that checks a web address** is a row
   of its own (Nextcloud and Collabora are two rows). A monitor of a port,
   ping or DNS check is no web address (`monitor_type` from Kuma's metrics,
   `isWebMonitor`); a monitor of unknown kind (the status-page fallback)
   counts as one.
2. Every other member (redis, postgres, cron, ML) folds into the stack's lead.
3. The lead is chosen from **all** the members, running or not: from those
   that are rows of their own when there are any, else from the rest, by
   `leadRank` (lower leads): the container named for the project (`loki` for
   `loki`), then a main-process name after it (`immich-server`,
   `nextcloud-app`), then any other name that carries the project, then any
   other, a database, cache or helper name after them, and an exporter or
   cAdvisor last; ties go to the shorter name, then the name itself. It
   depends on the names alone, never on the order cards arrive in. A member
   that stops (a red card for its down monitor, or a grey presence card, both
   of which remember the Compose project, and the container registry remembers whether its own monitor checked a web address, so a stopped member is still its stack's lead or its own row) keeps its place: the lead never
   moves when a member stops or starts, and a stopped lead keeps the row and
   its own state ("Down"). A member with its own web monitor is never made the
   lead by fallback.
4. A stack with nothing folded into its lead is no stack.

The stack is named by `display_name` in its override, else by its lead when the
lead is the container named for the project (so `wikijs` renamed "Wiki.js"
gives "Wiki.js"), else by the project in words ("Immich").

*API shape.* Cards keep their uid, status, monitor and everything else; only
annotations are added. The lead's card has `stack: { id: "<node>:<project>",
project, name, rollup, members }` (`members`: `{ uid, container, name, status,
source, image?, lead? }`, the lead first; `rollup`: `{ state, word, reason,
member }` from the cards' statuses), and a folded card has `foldedInto:
<lead uid>`. Every container is still a card, so the node's container counts,
the drawer, search and the palette are unchanged. The status model reads the
same grouping (`status/stacks.js`): the lead's **entity** gets `stack: { id,
project, name, count, chip, bad, members, rollup }` (`members`: `{ id, name,
state, word, reason, lead? }`; `chip`: "+3" or "+3 · 1 down") and a folded
entity `foldedInto: <lead entity id>`. An entity's own state, word and reason
are never changed: **push reads the entities, so what it sends, and on which
ids, is as before** (a stack's failing member still pushes under its own uid).

*Rollup.* The worst member by the model's order, crit over warn over
unknown over ok (a member in maintenance is none of them). A failing member
other than the lead makes the row "Degraded" in that member's level, the reason
naming it ("Immich Redis is down", "Immich Redis has stopped"); a failing lead
keeps its own word. `rollupOf` does it for both the cards and the entities.

*Counts.* The model counts **rows** in a second set of fields and leaves the
first as it was: `overall`, `issues` and `subsystems` count every container
(older installed clients read them), while `rows` (`{ overall, issues,
subsystems }`, present only on a board that has a stack) counts stacks: a stack
is one service in the tile, one issue, and the sentence names the failing
member ("Immich Redis is down", or "2 stacks degraded"). The web takes `rows` in
place of the three (`useStatus.js webStatus`), so the Services tile, the page's
count, "N of M up" and Attention are rows; `entities` keeps every member, and
the Infrastructure node cards and the node's container counts stay per
container. A member with no signal makes the row "No signal", not "Degraded".

On a Pi whose Compose project holds two containers (pi-2's `gateway-npm`
project holds gateway-npm and gateway-tunnel), the second folds into the first
as the rule says; `stacks: { "pi-2:gateway-npm": { split: [gateway-tunnel] } }`
gives it its row back.

*Overrides.* services.yaml's `stacks:` is keyed by `node:project`:

```yaml
stacks:
  vm-103:immich:
    lead: immich_postgres     # this container leads (it wins over the rule)
    ungroup: true             # leave the project as plain rows
    split: [immich_redis]     # these stay rows of their own
    display_name: Photos      # the stack's name
```

They are per node, as `monitor_per_node` is. An entry that is not a map, a key
that is not `node:project`, a node not under `nodes:`, a project no container
of the node carries (only once containers are read) or a lead or split naming no
container warns once and is ignored. Settings → Nodes & Services edits them in
the service's editor (Set lead…, Ungroup, Split out, Group again) and the
stack's panel does the same, through the same functions
(`servicesConfig.js withStack*`); the panel saves one edit at a time over the
version it read (`stackEdits.js`) and the board changes at the next refresh.

*Custom groups* hold uids (#574). A group that lists the lead's uid shows the
stack row; one that lists a folded member's uid shows that member as itself
(its own state), in that group only; a folded member no group lists is in no
list. A legacy bare container name holds every service of that name, folded or
not.

*The client.* `serviceRows` (`servicesView.js`) drops folded entities from the
rows and gives each stack row its name, the rollup's state, word and reason, its
`stack` (the chip) and its folded rows. `EntityRow` draws the chip after the
name (not a tab stop) and names the row "Immich, stack of 4 containers,
degraded: Immich Redis is down". The row opens the lead's entity: the drawer
(`entityDetail.js stackView`) draws it as the stack, with the containers in
`StackSection` (`DetailStack` in `src/ui/stack-panel.jsx`), both in the lazy
detail chunks; a phone's sheet does the same (`PhoneDetail.jsx`), and each
container's Details opens its own detail over the stack's.

#### Heartbeat strips (#312)

Each monitored service's last 50 checks, for the strips on its rows, in its
drawer and on its phone sheet (`UptimeBar`, 5), come from `server/kumaBeats.js`:

- **Kuma's own beats, when the load read them.** The status-page path
  (`fetchFromStatusPage`) already reads `/api/status-page/heartbeat/default`
  every cycle, and its `heartbeatList` holds each monitor's recent beats
  (status, time, ping) at Kuma's own interval. `kumaBeats()` keeps the newest
  50 as the monitor's `beats`: real history, whole again after a restart.
- **The `/metrics` path reads them too (#629).** With a `KUMA_API_KEY` set
  (as the homelab runs), `/metrics` gives only each monitor's latest state, so
  `fetchFromMetrics` also reads `/api/status-page/heartbeat/default`, one
  extra GET a cycle, concurrently with `/metrics` and under the same timeout.
  Monitors are matched by Kuma monitor id (the same id on both). A monitor the
  status page doesn't list, or a read that fails or is empty, carries no
  `beats`, and falls to the next case.
- **Otherwise one beat a cycle.** The refresh samples it: each cycle's Kuma status and response time is one beat at the
  cycle's clock, in a ring of at most 50 per monitor, in memory (ADR 0002; a
  restart starts it again).

**Which kind of history it is (#671).** A monitor off Kuma's status page
'default' only ever has the sampled ring, which starts empty at every restart.
The store remembers where each ring came from. On the `/metrics` path a monitor
the heartbeat read lists is Kuma's and one a *successful* read does not list is
marked `offStatusPage` (`monitors.js`), so it follows the page within a cycle
either way; a failed or slow read marks nothing and changes nothing, so a missed
read never labels a Kuma monitor (a monitor with no history yet is unlabelled).
`/api/services` adds
`history: 'since-restart'` to the encoded beats of a sampled strip (absent
means Kuma's; `decodeHistory`, an older server reads as Kuma's). The web draws
such a strip with the words "history since restart" (icon and words, the
reason as a tooltip, written out in the detail for a finger) and its slots
before the restart as flat "not recorded" dashes, not the hollow rings of
"no data", which look like an outage (on a row from 672px the note sits beside
the strip, so the row keeps its height). A real no-data check (Kuma unreadable)
stays hollow. Nothing is stored: the ring is still not persisted (ADR 0002).

The store (`createBeatStore`, kept by `refresh.js`) holds only the monitors
Kuma lists now, each at most `BEATS_KEPT` (50), whatever Kuma sends. A
status-page load whose heartbeat read is refused or times out (the page
answering) gives each monitor `beats: null`, and its last beats are kept as they were, neither
emptied nor sampled over. On the status-page fallback only (the live `/metrics`
source is unaffected), a heartbeat read that answers non-2xx fails the
load instead (the last statuses stay until they go stale, #341). A Gitea
commits request answering non-2xx fails too; repos/search's `empty` repos are
not asked. A cycle
that can't read Kuma adds a beat with no data to every ring (the monitors a
failed load hands back are Kuma's last answer, not new beats), and the next
load with Kuma's beats replaces it with what Kuma saw. While Kuma is
unreadable past its stale ceiling, the uids of the last cycle that read it
keep their strips.

`/api/services` serves them as `beats`: by service uid (`monitorOf`'s uids,
so a container with no monitor has none), each `encodeBeats`' compact
object, `{ t, d, s, p }`: the oldest beat's time in seconds, the seconds from
each beat to the next, one character per beat (Kuma's status, `0` down, `1`
up, `2` pending, `3` maintenance, `-` no data) and each response time in ms.
That is about 5 KB for 12 services (1.3 KB gzipped) and 26 KB for 60 (6 KB
gzipped). The web decodes them with `decodeBeats` (the same dependency-free
module), at most 50 whatever a server sends. They ride `/api/services`
because the rows read it every tick already (no request of their own, so the
tick budget holds, `tickBudget.js`), and not `/api/status`: they move every
Kuma interval, and the status model reads nothing of them, so a steady
board's status keeps its ETag and its 304s (`server/routes/status.beats.test.js`).
`beats` is a key added beside `/api/services`' frozen ones, as spec §6.3 adds
a field rather than change one (`server/routes/contract.test.js`): an older
client reads `nodes`, `overallHealth` and `sources` as before and never
looks at it.

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
check run (#235). It diffs against persisted state and records Arcane's scheduler-started
update and prune runs, and its image watcher's checks, into the cron store. On its own weekly
timer it also reads Arcane's stored vulnerability scan results for the environments in
`ARCANE_VULN_DIGEST_ENVS` and pushes a digest per environment when something is new
(`arcane_vulns`), recording each digest as the `arcane-vuln-digest` cron job. Both hand
their pushes to the push outbox and the alert history, as the refresh loop does (#581,
`arcane/notices.js`; 4.7 "Push", Sending): each poll or digest run ends with one atomic
write of `push-snapshot.json` that holds its state (what it has already notified, under
`producers`) and records and queues its pushes, so a crash on either side of it neither
loses a push nor finds it twice, and neither loop waits on the push service. Cron runs are recorded after that
write. One poll or release check runs at a time. Its `arcane_*` push types map to the `watchtower` preference category (labelled Updates
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
A preset that was deleted outright (Nextcloud, no longer supported) is listed in
`RETIRED_PRESETS` in `registry.js`: an integration saved under it stays in the
config for Settings to show as "No longer supported" (so it can be deleted), but
the refresh loop skips it with one log warning and it never reaches the payload.
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
  entry, its preset's `.env` variable (`JAGHELM_GITEA_URL`, `JAGHELM_NTFY_URL`
  and the rest, or its old unprefixed name, 4.4) or the keyed
  `integration_<key>_url` secret, is checked there, the one place
  every refresh, connection test and origin reads it (#419): a refused one
  resolves to no URL and `_urlProblem`, so nothing is requested and the
  refresh fails with it. It names where the URL came from, the variable by
  the name it is set under ("JAGHELM_GITEA_URL
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

- **Writable-folder preflight** (`util/dataDirCheck.js`, #697). `boot()` (index.js)
  runs `checkDataDirs` right after the environment check and before any
  subsystem writes: for the data folder (`DATA_DIR`) and `uploads/`, the folder
  is made if missing, must be a directory, and must pass a create-and-delete probe file for
  the running uid. On failure it prints ONE plain message to stderr (no logger
  JSON, no stack): the folder, the uid/gid, and the fix (`mkdir -p ./data &&
  sudo chown -R <uid>:<gid> ./data` with the real uid/gid, or JAGHELM_DATA_DIR's own path; or a named volume; inside Docker, found via
  `/.dockerenv`, `/run/.containerenv` or the PID 1 cgroup), then `process.exit(1)`. The module-level `mkdirSync` in
  index.js swallows its error so this message is what the user sees; every
  other boot error still goes through `fatal boot error`. Demo mode skips it
  (it writes nothing). The image creates and chowns `/app/data` and
  `/app/uploads` to uid 1000 (guarded in `scripts/docker-image.test.mjs`), so a
  named volume starts writable; a host bind mount keeps the host folder's owner.
  User-facing text: [DATA-DIR.md](DATA-DIR.md).
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
  `PROMETHEUS_URL`, `KUMA_URL` and `JAGHELM_GITEA_URL` there (`sourceUrl`,
  `sourceUrlSet`) and nowhere else; the Gitea integration preset reads
  `JAGHELM_GITEA_URL` as its URL too, through the integrations' check (4.3). One that
  carries a credential (`urlCredential`, 4.3: `user:pass@` or a user alone,
  as the parser reads it or not, a password with a raw `#`, `/` or `?`,
  whitespace or a quote, a second URL glued on, the scheme left out, or a key
  in the query) is refused: it is never requested or logged, and its source
  is off. None has a default (#704): `localhost` is JagHelm itself under the
  shipped bridge compose. An unset `PROMETHEUS_URL` is its own state,
  `sourceUrlUnset`: the model lists Prometheus off with "Prometheus is not set.
  Set PROMETHEUS_URL in .env." (not the "unreachable" of a wrong address), the
  boot warns it once, discovery rejects every read marked `unset`, and a first
  boot waits for nothing; an unset `KUMA_URL` or `JAGHELM_GITEA_URL` is a
  source not set up, quiet, with no request. `scripts/dev-server.mjs` sets
  the local one for `npm run dev`. None is needed: Kuma's key goes in
  `KUMA_API_KEY`, Gitea's token in `JAGHELM_GITEA_TOKEN`, and JagHelm has no
  Prometheus login. Node's fetch refused a URL with userinfo anyway, so no
  working setup is lost unless a path held a raw `@` after a port (write it
  `%40`). The
  problem names the variable (by the name it is set under, its own or its
  old one) and where the credential goes instead, never
  the value: the boot warns it once (`warnRefusedSourceUrls`), discovery and
  the Kuma reads fail every cycle with it and ask nothing, logging nothing
  more; a first boot saves no `services.yaml` and doesn't wait for nodes,
  with one line (6, #566); Gitea's panel is off as without a URL; the status model makes the
  source off (4.7); `/api/health` lists it (4.6), and `/api/readyz` reads it
  as not ready without asking. `ARCANE_URL` is refused by the same
  `urlCredential` (`arcane/config.js`): the integration is off, with one
  warning, and nothing is requested.
- **Environment** (`env.js`, #249): one schema lists every variable JagHelm
  reads, with its type (text, URL, secret, list, true/false, whole number,
  number above 0, port, or one of a set), its default and the old name it
  still answers to; `env.example` lists the same set (`env.docs.test.js`).
  It is the one module that reads `process.env` (`env.reads.test.js`):
  every other module asks `envValue(name)`
  for the value, parsed, or the default when unset, and an empty `NAME=`
  counts as unset. A name the schema lacks throws, so a reader can't drift
  from it. The boot checks the whole environment once (`reportEnv`, first
  thing in `boot()`): a value that doesn't fit its type is warned once,
  naming the variable, what it must be and the default used instead, never
  the value, and the defaults are the safe side (the CSP enforced, the
  secrets API closed, no demo). Only the variables marked `refuse` stop the
  start, with an error line and exit 1: `PORT` (nothing to listen on) and
  `JAGHELM_BLOCK_PRIVATE_NETWORKS` (a strict SSRF guard asked for would not
  be given). `index.js` imports `dotenv/config` first, so the `.env` in the
  working directory (`npm start`) is loaded before any module reads the
  environment; a variable the process already has wins. Names: the integration presets' variables
  and the Pipeline panel's Gitea pair take the `JAGHELM_` prefix the docs
  promised (`JAGHELM_SONARR_URL`, `JAGHELM_GITEA_TOKEN`), so another service's
  variable in a shared env file can't be picked up; the server's own settings
  keep their names (`PROMETHEUS_URL`, `KUMA_URL`, `DASH_*`, `PORT`,
  `ARCANE_*`, …). The unprefixed names those variables had up to 3.0 still
  work, until a later release drops them: the boot warns once for each one set, without its value,
  and when both are set with different values the `JAGHELM_` one is used and
  the warning says so. A message about a value (a refused URL) names the
  variable by the name it is set under, so it matches the user's file.
- **Data dir** is single-sourced via `util/dataDir.js` (`JAGHELM_DATA_DIR`) so
  secrets/auth/sessions/config/cron, the push snapshot (`push-snapshot.json`,
  with the outbox, the alert history and Arcane's state, 4.7 "Push") and the
  icon cache never split across locations.

### 4.5 Auth & rate limiting

scrypt password hashing (`auth/passwords.js`), sessions that survive a restart
(`auth/sessions.js`), and a brute-force **login rate limiter** (`auth/rateLimit.js`).
A reusable `util/rateLimiter.js` additionally throttles the abuse-prone
integration connection-test endpoint.

The login limiter (#257) has no global lock. **Per address**
(`auth/loginAddress.js`: an IPv4 address or an IPv6 /64, from `req.ip`, so
`TRUST_PROXY` behind a proxy): 5 failures in a row are free, then a wait of
30 s doubling to 15 min; a sign-in clears the address, and its failures are
forgotten an hour after the last. **The account:** one token bucket that every
attempt draws on, whatever user name it carries (there is one account; a map of
names could be filled, and would tell which name is real): 10 deep, one more
every 30 s, so rotating addresses get at most 10 + 120 guesses in any hour. One
address can't empty it (5 free, then at most one per 30 s). Its tokens go to
whoever asks first, so many addresses asking all the time can keep a new
address out. Two kinds skip it, still subject to their own backoff: **known**
addresses, the last 16 that signed in, in `known-addresses.json` in the data
dir (atomic, `0600`, plain keys: a hash of an address is undone by trying them
all; unreadable = none and one warning), each known through 3 failures in a row
and gone at the 4th (at most 4 bucket-free guesses an hour each), all but the
caller's forgotten on a password change; and addresses in `LOGIN_TRUSTED_NETS`
(CIDRs, checked with `net.BlockList`; a bad entry or `/0` is refused at start
with one warning), held per address only. Both checks run after the 400 for a
non-string field and before the password; a refusal is a 429 with
`Retry-After` (exposed to CORS) and changes nothing. An attempt let through
counts as a failure when it starts and `succeeded()` undoes that, so parallel
requests can't all pass one check. Records outside the trusted nets are capped
at 1,000, oldest first, but only an attempt the bucket or a known address let
through makes one, so at most 146 are live and the cap only drops forgotten
ones; a flood of fresh addresses can't push a waiting one out.
`createLoginLimiter` refuses limits that would break this. Trusted-net records
have their own cap of 1,000. Waits and the bucket are in memory on a monotonic
clock; a restart clears them. Every failure still waits the jittered 400 ms
floor. Both clients say "Too many attempts. Try again in N s." (or min) from
`Retry-After`, seconds or an HTTP date (`src/api/retryAfter.js`).

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
button: the sign-in screen replaces the app, every
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
learns of another tab's sign-out from its 401.
A server older than the route answers 404 (or 401), which changes nothing: the client
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
  once, with the error's raw detail (each message along its cause chain:
  "fetch failed: connect ECONNREFUSED 10.0.0.9:9090") and the words a client
  is told (`words`), warn again when it fails for another reason (its words
  change, #605), and their recovery logs once at info with how long it was
  down; the failed cycles in between log at debug, however the raw detail
  varies (`util/sourceHealthLog.js`). Gitea's poll logs the same way, at
  error. A failed integration attempt logs its error;
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
  `/api/health` and `/api/readyz` are not logged unless they fail (5xx). The line is
  written on `close`, so a client that aborts is logged too, at info with status 499 and
  `aborted: true` (#338); `apiError` lines carry the same stripped `path`.
- **Prometheus metrics** at `/metrics` via `prom-client` (`metrics.js`): request
  rate (an aborted request counts under `code="499"`), latency histograms, the `services` cache age, refresh-loop health and
  sign-in failures: the series `docs/slos/` queries, and no Node.js process
  metrics (#259: their 10 ms event-loop sampler cost about 0.2% of a core at
  idle, and cAdvisor shows the container's CPU and memory). The SLO queries
  assume a 30 s scrape.
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
  in seconds (`{ queued: 0, oldestAgeS: null }` with none, or with push off), and
  since #653 `webSubscriptions` and `webFailing`, how many Web Push browsers are
  subscribed and how many failed their last send (counts only, never an id),
  so a key the push service refuses or a long outage shows; `status` stays as it is. `/api/readyz` reads a refused
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
#469, below), for the nodes `services.yaml` still has (#361). Since #267 they
come from the alert history's baseline, which moves every cycle, push on or
off, so they are the last cycle's levels; push's own baseline holds while
push is off, and is the same with it on. A reading inside its hysteresis band
after a restart is still over its line: push sends, and the history records,
neither a second alert nor a false "back to normal". With push back on, a
reading that fell below its clear line meanwhile is normal, and its clear is
sent. The
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
store's statuses, whether `KUMA_URL` and `JAGHELM_GITEA_URL` are set, which source
URLs are refused for holding a user or password (`refusedSources`, by source,
its problem: `sourceUrlProblems`, #419), and the cycle's error set
(`runCycleRefreshes`, for Gitea). Four more come from elsewhere
(#291, #505, #727), with no read of the model's own:

- **`backupJobs`**, which cron jobs are backups: `display-config.json`'s
  `backupJobs`, a list of `"node:job"` keys (`"pve:proxmox-backup"` for the
  Proxmox vzdump results, which the PVE notification webhook reports as a cron
  job), read from the display config the loop already holds for the thresholds
  (`status/backupJobs.js`). A job is a backup only when the list names it,
  never by its name. An entry that isn't a `"node:job"` string is dropped, with
  one warning until the list changes; the save itself
  (`POST /api/display-config`) keeps what it is sent, since a web save sends
  back the whole config it read. Settings → Nodes & Services edits the list
  (#319): its Backup jobs panel lists the jobs `/api/cron/status` has seen, with
  a switch each that marks or unmarks the `"node:job"` key, and keeps listing a
  marked job nothing reports any more ("not reporting") so it can be unmarked.
  It is the same key as before, so a list written by hand shows as marked and
  needs no migration.
- **`arcaneAgents`**: each Arcane environment's agent, `{ env, state }`, with
  `state` the poller's `envHealth` from the environment list it last read
  (4.2, `arcane/agents.js`): `null` when Arcane isn't set up and before its
  first list, so no agents rather than unknown ones; every agent `unknown`
  while the list fails.
- **`drives`** (#727): the drive read (`drives.js`), cached under `drives` by
  the loop before the status step (`refreshDrives` in `refresh.js`): `{ enabled:
  false }` with `JAGHELM_DRIVES=off`, `{ enabled: true, nodes }` when it read
  (`nodes` empty when no smartctl series exist), or `null` when the read failed
  or did not run. See "Drive health" below.
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
               drives?,                                                       // a node's, see "Drive health"
               runtimeMinutes?, runtimeOnMainsMinutes?, load?, model?,       // the UPS's
               schedule?, everySeconds?, lastRun?, overdue?, since }],
  sources: { prometheus: { state: 'ok' | 'failed', error?, since }, kuma, nut, gitea, config,
             'drives-source:<node>'? },                  // a node blind to its drives, see "Drive health"
  thresholds: { cpu: { warn, cycles }, mem: { warn }, disk: { warn, crit },   // the lines it judged by
                temp: { warn, crit }, hysteresis: { fraction, celsius }, pending: { cycles },
                driveTemp: { nvme: { warn, crit }, sata: { warn, crit } } },
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
  or `JAGHELM_GITEA_URL` that is set is something set up, whatever it answers); and the
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
  `cpu`, `temp`, `pool:<name>`, `drive:<node>:<device>`), so a meter is coloured by the server's rule.
  `metric` is the reading behind a node's state, and the UPS's charge, on
  mains as on battery (#541). The UPS's `runtimeMinutes` (#549) is the
  runtime NUT says is left on battery, in whole minutes, rounded as
  it has always been shown ("8 min left"), from the same read; it is
  null on mains, with no runtime reading, and with no signal, so no screen
  draws a runtime the cycle's read didn't give; it counts down, so on battery
  it moves the status, and its ETag, about once a minute. Every UPS entity
  has the key, so a client tells "no reading now" from a server older than
  #549, whose UPS has none. From the same read the UPS carries (#586)
  `runtimeOnMainsMinutes`, on mains the runtime NUT gives at this load (whole
  minutes, rounded the same way), `load` in % on mains as on battery (rounded
  down, as a meter shows a reading), and `model`, NUT's name for its model
  while the UPS query answers; each is null without one, never 0, and with no
  signal neither reading is given, as the charge isn't. The detail drawer and
  the phone's UPS sheet draw them from the status, so the web never reads
  `/api/ups`. Load and the runtime on mains drift with the load on a steady
  board, so the model samples and holds them (`holdUpsReadings` in
  `model.js`): it serves them as last read, and reads them afresh only when 5
  minutes (`UPS_HOLD_MS`) have passed since, when any other field of the UPS's
  entity changes (state, charge, runtime left, model), or when either goes to
  or from null. A steady board then keeps one status, and one ETag, between
  reads, and a reading served is at most 5 minutes old, plus a cycle and a
  poll. After a restart the first read is fresh. A job's and a backup's entity (#578) carries what
  its last run reported, so the Overview's Jobs section and the phone's list
  draw every job from the status alone: `schedule` in words
  (`status/schedule.js`: the reporter's words as sent; a common cron
  expression put in words, "30 6 * * *" is "daily at 06:30", six fields
  with seconds first too, a note in brackets kept, and one it has no words
  for as sent; with none, the interval, "every 24 h"), `everySeconds` (the
  interval it is expected at), `lastRun` (when it last reported, ms since the epoch) and `overdue`
  (`cron-overdue.js`, the rule `/api/cron/status` uses, whatever the word: a
  failed backup is still overdue); each left out when the run has none. They
  change only when the job reports, so a steady board's ETag still holds
  between reports; a report is a change on the board.
- **Drive health** (#727; `drives.js`, `status/drives.js`; design:
  `docs/superpowers/specs/2026-10-29-drive-health-design.md`). An optional
  module: a drive is a sub-entity of its node, never a card, and an install with
  no smartctl series, or with `JAGHELM_DRIVES=off`, builds exactly the model it
  built before drives. `drives.js` reads `smartctl_exporter` through Prometheus
  (`count(smartctl_devices)` probes, cached 10 minutes with the read: the probe
  alone when no series exist; otherwise 10 instant queries, all aggregated
  `by (node, device…)`, so the info series' `serial_number` never arrives and
  no record holds anything derived from it). A counter is judged by its growth
  over 7 days, never "above zero": `delta` of the SATA raw counts of attributes
  5, 197 and 198 (a query each) and `increase` of the NVMe media errors, so no
  history means no growth and no alert, and a counter reset is not growth.
  Temperature is read for `temperature_type="current"` only. **Each drive is a
  condition of its node, `drive:<node>:<device>`** (the precedent is
  `pool:<name>`), judged in `status/drives.js`: crit when its health check
  failed, an NVMe's critical warning is set or its media errors grew; warn when
  a sector count grew or an NVMe's spare is at or below its threshold; warn or
  crit by temperature, by kind (`thresholds.driveTemp`: NVMe 70/80, SATA
  55/60 °C, the 5 °C hysteresis, saved as `nvmeTemp` and `sataTemp`, additive
  in `thresholds.json`). The node's state is the worst of its readings and its
  drives, its reason names the drive ("drive sdb failed its health check"), and
  the entity's `drives` lists them (`key`, `device`, `model`, `type`, `state`,
  `word`, `reason`, the readings and whether each counter grew). Push needs
  nothing new: the keys are in the snapshot's host levels, and the differ words a
  drive's event "sdb on nas" with the drive's own reason, so each drive
  alerts, holds and recovers on its own. A read that did not run, or a node
  that cannot be read, **holds** a drive's level (its condition is `unknown`),
  as an unread pool does. **Blind** is a source of its own, `drives-source:<node>`:
  a node that had drives (the model holds a level for one) and now has none in
  the read, or whose smartctl scrape is down (never a drive's own exit status:
  every drive whose data arrived is judged) is one `source_down` in the snapshot's sources
  (two cycles, as a monitoring source), an `unknown` issue "Drive monitoring has
  no signal on <node>", never the node's state. A blind hold is timed like a
  #469 hold: after 24 h the drives and the source are forgotten silently
  (`driveDropped` on the node entity tells push not to word it), as is what a
  module switched off held. A node that never had drive data raises nothing.
  The loop starts the read without waiting for it (`refresh.js refreshDrives`)
  and the model uses the last result, so a slow Prometheus adds nothing to a
  cycle; a temperature's hysteresis starts only from its own last level
  (`memo.driveTemps`), which a restart does not keep. Judging a node's drives may throw: it is reported once (until
  the error changes), the node is judged without them and keeps what it held.
  **The UI** (#728) only draws what this gives. A node's detail (the desktop's
  drawer and the phone's sheet) shows a **Drives** block directly under the
  status box (`src/shell/detail/driveView.js` makes the rows,
  `src/ui/detail-drives.jsx` draws them): a lamp, the device, its word when it
  is not healthy, its temperature, and a row opens to the readings the server
  delivered; never a serial number, which no record carries. A node with a
  drive that may sleep (not NVMe) adds "Sleeping drives show their last
  reading". A node whose scrape target declares `reading_interval` (#732;
  drives.js `readingSeconds`, the node entity's `driveReadingSeconds`, display
  only) gets one line instead that says how often readings refresh and, where
  a drive may sleep, that a sleeping drive shows its last reading. A node blind to its drives shows its held drives as no signal. The
  temperature chart adds a line a drive (the five hottest, in chart slots by
  name, "+N more drives, not drawn" under it). A drive alert's link,
  `/?entity=nodes/<node>&drive=<device>` (`entityNav.js useDriveParam`), opens
  that row marked. `GET /api/thresholds` says `drives: 'on' | 'off' | 'none'`
  so Settings > Notifications shows the module's switch, read-only (set by
  `JAGHELM_DRIVES` on the host), only where the module is on or off by choice.
  A node without drive data draws none of it.
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
  container is a plain missing one, "Missing: no longer running". A running
  container named `<12 lowercase hex>_<name>`, what an interrupted compose
  recreate leaves (#772), is a warning, "Temporary name", whose reason names
  the real container. A plain missing container (no monitor judges it) also
  says when it has been gone long enough to page (`pageDue`, #775): `now`
  minus when it was last seen reaches `JAGHELM_MISSING_PUSH_AFTER_MS` (10
  minutes by default; finite and above 0, else the default with a boot
  warning, like the presence settings). The model is the one place that
  hold is timed, and the card's own 90 s grace and 24 h fade are unchanged. A
  node is
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
- **Why a source failed is said in words** (#605, `failureWords.js`): one
  mapping, server-side, from a failure to a sentence, for a source's `error`,
  its issue's `reason` (and so the push it sends and the alert history's
  record of it), and `/api/history`'s failed series. `readFailure` reads the
  cause from what the reader's error carries: an HTTP status, a mark the
  reader set (`failure`), an errno or undici code or a `TimeoutError` along
  its `cause` chain, else the codes its text names (a failure kept only as
  text). `failureSentence` names the source and the cause, keeping an HTTP
  status: "Prometheus refused the connection", "… didn't answer in time",
  "Prometheus's address didn't resolve", "Prometheus's TLS connection
  failed", "Kuma refused the credentials" (401), "Prometheus refused the query
  (HTTP 403)" (any other 4xx; a failed targets read says "the targets read"),
  "… answered with an error (HTTP 503)" (5xx), "Prometheus refused the query"
  (a 2xx error answer), "Prometheus's answer couldn't be read", "Kuma's status
  page lists no monitors", "…'s redirect wasn't followed (see the log)" (one
  `safeFetchCore.js` refuses), "…'s address is blocked (see the log)" (the
  SSRF guard), "Prometheus is off: its URL is refused" (#419: what a chart
  says; the source's issue keeps the problem naming the variable, below),
  "No Prometheus is set up", else "… didn't answer"; a failed source with
  nothing to read, "No answer this cycle". No errno code, stack text, URL,
  host name or credential reaches a client field. The services refresh keeps
  the cause in `sourceErrors`, Gitea's poll keeps its own (`giteaFailure`,
  which `readStatusInputs` reads from the caches it is given), and the raw
  detail goes to the log once per failure state (above). One sentence per
  cause also means a raw error that varies every cycle (a port in the
  message) leaves the status, and its ETag, as they were. An integration that
  fails says it the same way, naming it by its key ("sonarr refused the
  connection"): its fetch keeps the cause as `_failure` beside `_error`
  (`integrations/handler.js`, `lib/http.js` keeping undici's code and its
  timeout); a refused URL, a missing config and JagHelm's own refusals (an
  endpoint off its origin, a credential for another address, one that can't
  be read) have none and say their `_error`. The node problems Prometheus has
  while it answers (#476) name the nodes by their display name, never a
  target's address, which goes to the log (`problemDetail`). Events recorded
  before #605 keep the text they were recorded with: the history is a
  record.
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
  fixture), and so does every client that reads the model (#325).
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
  battery (64 % charge)"), for the header sentence, push and a client
  older than #541; Power with several entities counts its no signal ones
  there too. No client splits a string.
- **The sentence**: with warnings or worse, each kind of problem with its count
  in issue order ("2 services down · Prometheus unreachable · 1 job failed"),
  then "N no signal"; with only unknowns, "31 up · 1 no signal"; healthy, the
  quiet line ("All 32 services up · 6 nodes healthy"). With nothing on the
  board, "Nothing monitored yet", with `empty` or `unknown` (above).

**The threshold config** (`thresholds.js`, [ADR 0006](adr/0006-one-severity-table.md)):
`DEFAULT_THRESHOLDS` holds every number, usage lines as fractions of 1 as push
has always compared them. `resolveThresholds()` lays the saved lines over the
defaults, and `refresh.js`'s `getThresholds()` returns the result. Push has no
lines of its own: it sends what the model judges, so the two can't disagree
about a line. `/api/status` serves the set each status was judged by
(`thresholds`, above), so the screens' meters draw the same lines.

- **Settings → Notifications edits them** (#320): CPU's and memory's warning
  lines, and the disk's and the temperature's warning and critical lines, in
  percent and °C. `GET /api/thresholds` (`routes/thresholds.js`) answers each
  metric in force with its unit, defaults, range, hysteresis (`band`, in its
  unit, a hand-edited one included: the page says it) and whether it is custom;
  `PUT` saves a table (`{ cpu, mem, disk, temp }`, each `{ warn, crit?, unit }`
  or null for its defaults) to `thresholds.json`, by the config files' write
  discipline (a version in `If-Match`, 428 without one, 409 over a stale one,
  an atomic write; 6, "thresholds"). `status/thresholdTable.js` checks a
  table: an unknown metric, a unit that isn't the metric's, a line out of
  range (10 to 100 %, 30 to 120 °C) or a warning line not under its critical
  one is a 400 saying why, with the metric. The file keeps only the metrics
  away from their defaults, each with its unit, and the refresh loop reads it
  every cycle (`thresholdsFile.js`, parsed again only when the file changes,
  as display-config.json is), so the model, and push with it, judge by a
  save from the next cycle. A file that doesn't parse or holds a line a save
  would refuse is not used (one warning per version, never its text) and is
  a 503 to the GET until a save rewrites it.
- **Before #320**, four values could be hand-edited under
  `display-config.json`'s `pushThresholds` (`cpu`, `mem`, `disk`,
  `hysteresis`, fractions). They still count while there is no
  `thresholds.json`, and the editor shows them as the lines in force; its
  first save replaces them (a disk warning line hand-set above its critical
  one loads as both equal: the page shows a notice on that row, not an
  error, until a line is edited, and a save over it is refused by the server
  as any bad row). The hand-edited `hysteresis` counts either way
  (the editor doesn't set it), and so do CPU's 2 cycles and Kuma's pending
  cycles, which stay the defaults.

**`GET /api/status`** (`routes/status.js`, token auth like every `/api/*`
read) serves the status the loop cached this cycle under `status`, with the
cache's ETag (4.2: computed once per value). Reasons hold no times, the lines
change only with the config, and the UPS's drifting readings are held for 5
minutes (above, #586), so a steady board serves the same bytes from cycle to
cycle and a poll with the last ETag gets a 304 (`server/routes/status.test.js`,
`status.upsHold.test.js`); every 5 minutes at most, a new load or runtime on
mains is a 200. The status stays fresh for two refresh intervals (at least the cache's 2
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
`/api/cron/status`, which keep their shape and meaning for clients already
installed (spec §6.3; frozen by `server/routes/contract.test.js`): the new
states (maintenance, pending, unknown because a source failed) appear only
here.

**The clients draw it, and judge nothing.** The web reads it in `useStatus`
(5, "Status in the header"), and the phone screens draw it through
`src/phone/data/board.js` and the web's own helpers (`headlineOf`,
`subsystemCells`, `whereOf` and `lastKnownLine` in `src/shell/statusView.js`,
`drawnState`, and `infrastructureNodes` in `src/shell/infrastructureView.js`).
The model carries the UPS's charge (#541) and its runtime on battery (#549), so
no client reads `/api/cron/status` or `/api/ups` for them; its UPS detail
draws the model's load, model and runtime on mains (#586). Only a server older
than #549, whose UPS entity has no `runtimeMinutes` key (`needsUpsRead` in
`board.js`, read off the status the round brought, so finding out costs no
request), is asked `/api/ups` too, after its status lands, for that runtime
and, before #541, the charge on mains; that read goes with `/api/ups` in
Phase 4's endpoint cleanup. A 404 from `/api/status` is a server older than
the status model, which the page says in words. What each screen shows comes from
`src/phone/data/board.js`: the Overview's card (the board's word and the
issues' counts, the quiet line, or an empty board's "Nothing monitored yet"
alone), a strip cell per subsystem with anything (the model's value over its
sub-line, as the web's tile, #541; the Power cell adds the model's UPS runtime
on battery, "21 min left", none while the status is stale, since it is a
countdown, and from a server older than #541, which gives no sub-line, its
charge on mains), the ranked issues with where they are and their reasons, each
service row's state and word, and each node card's state, word, hosted
counts ("4 / 5 services up · 1 down", or "No services") and readings, each
coloured by its condition and printed by `shownReading`. `derive.js` keeps
display helpers only, and `scripts/phone-no-severity.test.mjs` fails on a line
or a severity of the screens' own anywhere in `src/phone/`.

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
  "pve · Disk 94 % (warning above 90 %)". A push names the model's entity it is
  about (`push/entity.js` `entityOf`, #309): `services/<uid>`, `nodes/<node>` (a
  reading's push too), `power/ups`, the job's or backup's id as the model files
  it (the differ names it, since only the model knows a backup), `sources/<name>`,
  or `integrations/arcane:<env>` for an Arcane agent's; none for an Arcane
  update, release or digest, or the status check's own push. The Web Push
  payload carries it as its `tag` and its tap's URL `/?entity=<id>`, which opens
  that entity's detail screen, the one its row and the web's `?entity=` URL open
  (`src/phone/nav/entityRoute.js`): a service's Service detail, a node's Node
  detail, anything else Incident detail. Incident detail
  shows the push's own fields for an event that is no entity now.
- A container under a temporary name pages as a `service_temp_name` warning
  (#772), with the temporary card's uid as its id, and sends
  `service_temp_name_cleared` when the real name runs again (its entity is the
  real container's). The snapshot keeps it in `tempNames` (`node:uid` ->
  `warn`, then `ok` for the cycle of the recovery), a key left out while there
  is none. It follows the `service` push category, the recovery switch, Ack,
  Snooze and quiet hours like a service's page.
- A backup pages as the job did: `cron_failed`, `cron_overdue` and
  `cron_recovered`, with the same id and node, so a browser routes it
  as before; its reason is the backup's ("Last backup failed: …"). One
  difference (#478): a failed backup's `cron_failed` is `critical` (urgent
  delivery), because the model judges it `crit`; a failed job stays
  `warning`, and an overdue backup stays `warning` as the model's `warn`. Marking or unmarking a job sends nothing: the snapshot keys a job by
  `node:job` either way.
- A container the registry calls Missing (it ran past
  `JAGHELM_PRESENCE_ESTABLISH_MS`, so a one-shot job is not one; an ignored
  name such as `handbook-build-*` or a Gitea action task never gets a card)
  pages as a `container_missing` warning once its card is `pageDue` (#775),
  with the card's uid as its id and the node it last ran on. The snapshot
  keeps it in `missing` (`node:uid` -> `warn`, then `ok` for the cycle of the
  recovery), a key left out while there is none. When the name runs again,
  on that node or another, `container_returned` is sent. Remove (the
  registry forgets it), the 24 h fade and a card a Kuma monitor takes over end
  it with no recovery; a Prometheus failure or a No signal card holds it. A
  container judged by its own Kuma monitor is never `pageDue`: the monitor
  pages it (`service_down`), not twice. It follows the `service` push
  category, the recovery switch, Ack, Snooze and quiet hours (a warning waits
  for the morning in the default quiet mode) like a service's page. It is a
  warning in the model already, so it shows in Needs attention and, with no
  chart, under the Monitoring banner's "other issues".
- An integration and an Arcane agent send nothing,
  as before: the Arcane poller pages for its agents itself
  (`arcane_agent_offline` after 2 polls down, `arcane_agent_recovered`), so an
  agent outage is one push. Arcane's updates, held-back updates, releases and
  digests are pushes only, never model issues. Since #581 they go through the
  same outbox and alert history as the differ's events (Sending, History).
- Delivery: `push/webPush.js` sends each event to each browser that turned
  alerts on, encrypted for it and posted to its push service (Web Push, below).
  The Firebase sender and its `FCM_SERVICE_ACCOUNT` key went with the Android
  app (#659); `push/channels.js` is the one face the outbox, the cycle and the
  test push send through.
- Sending (#579): the refresh loop never waits on the push service. With it out
  of reach a send can take seconds to minutes, and before #579 the cycle awaited every
  send, so `/api/health` went 503 past 90 s and the board froze. Now the
  cycle diffs and hands its events to an outbox, and returns:
  `advance(snapshot, events)` (`push/dispatch.js`) moves the snapshot and
  queues the events in one atomic write of `push-snapshot.json`, which
  holds the snapshot's fields and, while any are queued, `outbox` (each
  event with `queuedAt`, and `sent` once a phone took it; an older JagHelm
  reads a file with none as its own). One sender (`push/outbox.js`) sends
  one at a time, oldest event first, to each phone its prefs let through,
  so each phone gets its events in order. A failure every phone would share
  (no answer from the push service, the key refused: `allPhones` in
  the sender's result) stops the round, and the next waits 10 s,
  30 s, 1 and 2 minutes, then every 5. One for this phone only (`retry`: a
  5xx, a 429, the quota) makes that phone wait the same way while the
  others go on; given up for it after 16 tries (about an hour) on an event
  another phone took, with one warn line, never on one no phone took. Any
  other failure (a gone subscription, pruned; a payload the push service refuses) is done with
  that phone, logged as before. An event every phone is done with leaves
  the outbox; each sender round writes the file once at its end, for every
  event it finished (#267: not a whole-file write per event). So a crash before the cycle's write re-diffs
  the change and pages once, one after it sends the queued events from the
  file and re-diffs nothing, and only one between a send and its round's
  write can page twice. A page no phone has taken and its recovery both leave the
  outbox, unsent. Past 100 events (`OUTBOX_CAP`) the oldest pages not being
  sent are dropped, with one warn line naming them; a recovery never is
  (its page went out). `/api/health` shows the outbox (4.6). Shutdown needs
  nothing more: the outbox is on disk with each change
  (the cycle never waits on the push service).
- The outbox's other producers (#581): the Arcane poller and the weekly
  vulnerability digest (4.2). Before, each awaited its own sends: with the push service
  out of reach its loop stalled, and a send that failed lost the notice. Now
  each run ends with `notify(name, state, events)` (`push/dispatch.js`), one
  atomic write that puts the producer's state in `push-snapshot.json` under
  `producers` (`arcane`: the poller's environments, agents, seen runs and
  held-back sets; `arcane-vulns`: the digest's finding keys, KEV counts and
  last run), records its events in the history and queues them, then wakes
  the sender. Same order, retries, bound and per-phone rules as a cycle's. A
  crash before the write leaves the producer's last state, so it finds the
  same news again and queues it once; one after it leaves the pushes queued
  with the state that made them. The state is copied in at each write, so
  the refresh loop's writes in between carry the last committed state, never
  a poll's half. An agent's offline and its recovery, both unsent, leave the
  outbox together (`arcane_agent_recovered` ends the episode); updates,
  held-back updates, releases and digests never collapse. With push off the
  events are recorded `off`, nothing is queued, and the state moves all the
  same, so turning push on later sends nothing old (as before #581). The
  state used to be in `arcane-state.json`, `arcane-held-back.json` and
  `arcane-vuln-state.json`: the first start with #581 reads them once, writes
  what they held under `producers` and leaves them in place, for a rollback
  (an older JagHelm reads its own files and takes `producers` for a snapshot
  field no diff reads). Each producer's entry carries `savedAt`, when the file
  took its state. An older JagHelm run after a rollback leaves `producers` as
  they were and keeps notifying into its own files, so at the next start an
  old file written after `savedAt` is read in place of the snapshot's copy,
  and nothing it notified is announced again (`arcane/notices.js`). Not after
  a `push-snapshot.json` that doesn't parse: what was lost may be newer than
  the old files, so each producer starts fresh, a silent baseline, and the
  warning says so (Arcane's changes since its last write are not pushed; a
  release or offline agent already pushed may be pushed again). The digest
  keeps each finding as its repository (which carries an uncertain
  repository's findings forward) and a 10-character hash of its id and
  package, grouped by repository (`arcane/vulnStateStore.js`): vm-103's 3462
  findings take about 42 KB, not about 205 KB, at most about 240 KB at the
  20 000-key cap, carried by every write of the file. The old shape is read
  and hashed, so no finding reads as new.
- History (#267): every change is recorded (`push/alertHistory.js`), with
  push set up or not, against a baseline of its own; since #581 every Arcane
  notice too, in the write that queues it (`entity` null but for an agent's,
  `reason` null). Two baselines: the
  history's moves every cycle; push's moves only while push is on, as before
  #267, so a cycle with push off never changes what a phone is sent later (a
  page queued before push went off is not sent stale over its recovery, and
  an outage that opened meanwhile pages once push is back). While push is on
  they are the same snapshot, built and diffed once, so the history is what
  was paged, each once; a page push makes on coming back takes the record
  from while it was off. With no VAPID keys push's baseline holds, nothing is
  queued and no sender is woken. The record goes in the same atomic write
  that moves the baselines and queues the pushes, under `history` in
  `push-snapshot.json`: `{ lastId, events }`, plus `snapshot`, the history's
  baseline, only while it differs from push's (written once an event was ever
  recorded or the two differ). A JagHelm from before #267 keeps the outbox
  and drops `history` at its first write after a change of state. So a crash
  before that write re-diffs the change and records it once, and one after it
  diffs nothing again: no event lost or recorded twice, with nothing to
  dedupe. Each record: `id` (a decimal string, one more than the last; the
  file keeps the last, so none is given twice), `at`, `type`, `severity`,
  `entity` (the model's id the push's tap and #309's URLs open, null for the
  status check's own), `title`, `body`, `reason`, `node`, `key` (the push's
  `id`) and `push: { state, phones, suppressed }`, state `off` (push not set
  up), `queued`, `sent` (to `phones` phones), `suppressed` (no phone got it,
  one's settings turned it off), `unsent` (no phone, each send failed for
  good, or push had nothing to send: the end of a problem that came and went
  while push was off) or `dropped` (the outbox let it go unsent: its problem
  cleared first, or the outbox was full), noted in the write that changes the
  outbox. Kept
  30 days (`HISTORY_MAX_AGE_MS`) and at most 1000 events (`HISTORY_CAP`: a
  month of a homelab's alerts is tens to a few hundred; a flapping service
  keeps the newest), about 400 KB at most, so the file is still small to
  rewrite with each page. A file that doesn't parse is moved aside first
  (`push-snapshot.json.corrupt-<time>`, 0600, the newest only), so no write
  destroys what is left of it, and JagHelm starts with no snapshot, outbox,
  history or Arcane state, with one warn line: the parse error's reason and
  position, the file's size and how many queued pushes, events and producers'
  states it held, never its text (#504), and what the lost Arcane state means
  (#581). A record that can't be read is dropped with one warn line counting
  them. `GET /api/events` (`routes/events.js`) serves it, newest
  first: `{ events, next }`, `limit` (50, at most 200), `before` (an id: the
  last page's `next`, so new events never move a page being read), `entity`
  (repeat for several), `severity` (a comma list), `kind` (#314: the first
  part of the entity's id, `services`, `nodes`, `power`, `jobs`, `backups`,
  `integrations` or `sources`, `ENTITY_KINDS`; a comma list; an event of no
  entity has none) and `q` (#314: 1 to 100 characters, any case, in the
  title, words, reason or entity id); anything else is a 400 saying which.
  The Alerts pages show it (#314, 5 "The Alerts page"). A record keeps the
  words it was recorded with: a source's failure is in words since #605, and
  older records keep the raw error they were sent with. The demo answers it
  with a history of its own board (`demoEvents.js`), loaded into the live
  store and read with the live route's query reader (`readEventsQuery`), so
  it pages, filters and refuses as a live server does.
- Devices and the test push (#320, #268), for Settings → Notifications. The
  Web Push store (`push/webPushStore.js`) keeps, beside each browser's
  subscription, when its push service last accepted a push for it
  (`lastDeliveredAt`) and its last failed send for that device alone
  (`lastError`, the sender's code, cleared by the next accepted one). The
  sender records both as it goes (`settleTokens`, `recordFailure`); a
  delivery's time is written at most once an hour, so a flapping service
  doesn't rewrite the file every send. A failure every device would share is
  the sender's own (`stalled()`, since when and the code) until a round gets
  through. `GET /api/push/devices` lists the devices by fingerprint (the
  subscription's id, `deviceIdOf`), never a token or an endpoint: name (the one
  its browser gave, two of a name told apart by the fingerprint's start),
  platform (`web`), registered, last seen, last delivered, the last failure in
  words (`push/sendWords.js`: no send code reaches a client), the categories it
  gets, the prefs a new device starts with, `stalled` in words, the last test
  push, and `channels: { web }`. `DELETE /api/push/devices/:id` removes one (it
  registers again when alerts are turned on in that browser again).
  `POST /api/push/test` (`push/testPush.js`) records a `push_test` event
  (severity info, no entity) and queues it like any push (`snapshot.queue`), to
  every device or, with `device`, to one: the event carries that fingerprint and
  the sender gives it to that device alone, the others done with it unsent and
  not counted as switched off. No category keeps it from a device
  (`categoryOf` gives it none); a device's push switch does. One per device
  every 30 s (in memory; 429 with `Retry-After`, every device counting for
  each); 409 with push off or no device, 404 for an unknown one. The sender's
  `onResult` tells it each device's outcome, so the last test push says, device
  by device, delivered, switched off, failed (why, in words), removed (a gone
  subscription) or on its way, and "Waiting" while the push service can't be
  reached. The demo answers the devices with push off and no device.
- The Android app's device records (#659). The app registered FCM tokens in
  `push-tokens.json`; nothing reads that file now. At boot
  `push/retiredFcm.js` drops every record in it that is not a Web Push
  subscription (one with an `endpoint`), logs one info line with the count
  (never a token), and writes the file back atomically (0600), `{}` when
  nothing is left; with none to drop it does nothing and says nothing. A
  persisted outbox needs no migration: an entry holds the event, and who it
  goes to is worked out each round from the devices there are, so a test push
  addressed to an app's device finds no one and leaves the outbox unsent.

**Web Push to the installed dashboard** (#653) is the only delivery channel
(the Firebase channel for the Android app was removed in #659). A device is a
Web Push subscription (a browser or installed PWA that turned alerts on in
Settings → Notifications), listed in the device list with its own prefs,
delivery times and last failure, behind the outbox (the differ, snapshot,
outbox, retries and test push know one store and one sender).

- *Pieces.* `push/webPushCrypto.js` (RFC 8291 aes128gcm encryption, RFC 8292
  VAPID ES256 JWT, on `node:crypto` alone: no `web-push` package; the RFC 8291 appendix A
  example is its golden test),
  `push/webPush.js` (the sender, the payload, `readVapid`),
  `push/webPushStore.js` (`push-subscriptions.json`, below), `push/pushEndpoint.js`
  (the endpoint allowlist), `push/channels.js` (`createChannels`: `isPushEnabled()`
  is Web Push up, `sendToToken` routes a `wp:<id>` pseudo token to Web Push; any
  other token is nobody's and is never sent) and `routes/webPush.js`.
- *The key pair* (#698). A container user runs no tool: with `VAPID_PUBLIC_KEY`
  and `VAPID_PRIVATE_KEY` both unset, the boot (`initWebPush`) takes JagHelm's
  own pair from `vapid-keys.json` in the data dir (`push/vapidStore.js`),
  making it first if there is none (mode 0600, a temp file linked into place,
  so two boots racing end up with one pair; JSON `{ publicKey, privateKey }`).
  Env values always win: both set means the file is neither read nor made; one
  without the other is `incomplete` and Web Push stays off, naming the missing
  variable. `VAPID_SUBJECT` is optional: it defaults to the project's GitHub page
  (`https://github.com/jagbhandal/jaghelm`), the contact a push service sees in
  the token, so on someone else's install its abuse reports would point at the
  project: set your own `mailto:` or `https:` address to be the contact (a set
  one that is neither turns Web Push off).
  Every browser's subscription is bound to the public key, so a new pair turns
  them all "needs turning on again" and a stored pair is never replaced
  silently. Failures leave Web Push off (JagHelm itself still boots, one error
  log line, Settings says what to do) under three reasons: `key-file-damaged`
  (not JSON or not a matching pair, with browsers subscribed: restore it or
  delete it), `key-file-unreadable` (permissions, a directory: never replaced),
  `key-file-unwritable` (no key could be kept: read-only, full or missing data
  folder). With no browser subscribed there is nothing to orphan, so a damaged
  file is set aside as `vapid-keys.json.bad-<time>` (newest 3 kept; it may hold
  the old key, mode 0600) and a new pair is made. Making a pair, or replacing a
  damaged file, is done under `vapid-keys.json.lock`, so racing boots end with
  one pair; temp files older than 5 minutes (they hold the key) are swept at
  start. A file readable by group or other is tightened to 0600 with one
  warning. If the `VAPID_*` keys are removed from `.env` while browsers are
  subscribed, a new stored pair is made and one warning counts the browsers:
  each phone re-subscribes the next time it opens JagHelm
  (`webPushSync.js` sees the key differ); until then its sends show as
  `webpush/rejected`. The private key is in that file and, as a key object, in
  the sender only: never in a log line, an error, `/api/health`, the status or
  `GET /api/push/web/key`, which answers the public key. `scripts/vapid-keys.mjs` stays for those who
  want to make a pair themselves (it prints three `.env` lines and writes
  nothing; the image doesn't ship it, nothing needs it). Without a usable pair
  Web Push is off, Settings says so, `isPushEnabled()` is false and nothing is
  queued or sent.
- *Subscriptions.* `push-subscriptions.json` (mode 0600, atomic writes) keeps,
  per browser, an id (the first 12 hex characters of the SHA-256 of its endpoint,
  which the page computes too, to tell its own row), a name, the endpoint, the
  keys (`p256dh`, `auth`), registered and last-seen times, prefs, last delivery
  and last failure. At most 20, a name of 64 characters, an endpoint of 1024.
  Registering the same endpoint again refreshes it. A subscription dropped as
  unseen keeps its prefs (not its endpoint or keys) under `~aged` in the same
  file, at most 20, so a muted phone that comes back is still muted (#346);
  removing one on purpose keeps nothing. The endpoint and keys leave
  the store through `subscriptionOf` alone, which only the sender calls; the
  list, the device list and the outbox's token list carry the id and name. The
  outbox knows a subscription as the pseudo token `wp:<id>` (no secret; it is
  what its log lines show). The file is re-checked on load (endpoint against the
  allowlist, keys' sizes and curve), so a hand-edited file cannot aim the sender
  elsewhere.
- *Routes* (login-gated, mounted at `/api/push/web`): `GET /key` (`{ enabled,
  publicKey }` or `{ enabled: false, reason }`: `unset`, `incomplete`, `invalid` or `key-file-damaged`/`-unreadable`/`-unwritable`;
  never the private key), `GET /subscriptions` (id, name, createdAt, lastSeen),
  `POST /subscriptions` (`{ subscription: { endpoint, keys }, name }`; 201 new,
  200 refreshed; 400 for an endpoint off the allowlist or bad keys; 409 with Web
  Push off or 20 kept), `DELETE /subscriptions/:id`, `POST /test` (`{ id }`, the
  same test push as `POST /api/push/test`: queued through the outbox, `Urgency:
  high`). `GET /api/push/devices` says `channels: { web }` and its
  `enabled` is Web Push being up; a device has `platform: "web"`.
- *The message.* A small JSON, encrypted for the browser: `{ v: 1, title, body,
  tag, url, severity, type }`. `title` is the event's ("Service down"), `body`
  only its subject, the service or host and its node, never its reason or an
  address (it shows on a locked screen); `tag` is the event's entity, so a
  repeat and the recovery replace the earlier notification (`renotify` so the
  replacement still alerts); `url` is the dashboard deep link `/?entity=<id>`
  or `/` (a drive's alert adds `&drive=<device>`: `/?entity=nodes/nas&drive=sdb`,
  so the detail opens with that drive marked, #728). Sent with `TTL` (a day for a critical state, an hour otherwise),
  `Urgency: high` for a critical state and for a test push (so a phone in Doze
  gets it at once), `normal` otherwise, and `Content-Encoding: aes128gcm`.
- *Answers.* 2xx accepted; 404 and 410 remove the subscription; 429 and 5xx,
  and no answer within 10 s, are retried for that browser only, by the outbox's
  backoff (never a stall for every phone: other push services are independent);
  any other 4xx and any redirect are never retried (a 401 or 403 is the VAPID
  key or subject refused, said so in the device list). A failure is told in
  words (`push/sendWords.js`), never its status text.
- *Service worker* (`public/sw.js`): `push` always shows a notification (a
  payload that does not parse shows a generic one: browsers punish silent
  pushes), with the tag, icon and `data.url`; `notificationclick` focuses an
  open dashboard window and navigates it to the link, else opens one. The link
  is validated again there: a relative path on the worker's own origin, or `/`.
  A payload with `actions: true` and `keys` shows Snooze 1h and Ack buttons
  (#669, below). The caching is unchanged, except that a response is never cached when it is
  an opaque redirect, was redirected, or ends on another origin (Cloudflare
  Access's sign-in page must not be kept as the dashboard). `pushsubscriptionchange`
  subscribes again with the old subscription's key (no prompt: the permission
  stands); the worker cannot sign a request (the session token is in
  `localStorage`), so the page registers the new one at its next load.
- *Keeping it alive* (`src/webPushSync.js`, a lazy chunk run once per signed-in
  load; the worst failure is a subscription that dies silently, now the only phone channel). Permission granted and a subscription held: it is registered
  again when the server doesn't list it (a 410 prune heals at the next load) and
  at least daily (so the 180 day "unseen" drop never reaches a live phone);
  alerts were on (a `localStorage` flag, no endpoint) and the browser lost it:
  subscribed again, no prompt. Permission taken back, a refused subscribe or Web
  Push turned off on the server: "Alerts on this phone stopped" (`src/ui/
  alerts-stopped.jsx`) on any page, with one button (from the click it may ask
  for permission; blocked, it opens Settings). A server it can't reach is no
  verdict. Server side, each device's last delivery and last failure (in words)
  show in Settings, and `/api/health` `push` carries `webSubscriptions` and
  `webFailing` (counts).
- *Smarter alerts* (#669). Between the outbox and the phones sits a small
  policy (`push/alertPolicy.js`; the pure rules are `push/alertRules.js`, the
  Snooze and Ack state `push/alertState.js`). Each sender round asks it to
  `plan` the queued entries into units; the queue, its collapsing of a page
  with its unsent recovery, its cap and its retries are unchanged. Only
  pages and recoveries are touched: a test push, a push for one device and
  anything that is neither (an Arcane update, the status check's own push)
  go out alone and at once.
  *Grouping.* A critical page is never held: it goes out at once, and later
  alerts in the burst group as below. Other pages queued within the window (`alerts.groupWindowSeconds`,
  default 60, 0 off; counted from the first one's `queuedAt`) are one summary push
  (`alert_group`: "5 services down on apps"; the node when they share one;
  the first names and a count; never a reason), recoveries another. The unit
  is sent once the window since its first is over, so no alert waits longer
  than the window and a lone one goes as itself. While a window or quiet hours
  are set, a page and its recovery no longer cancel out in the outbox
  (`collapses` in `refresh.js`): both are sent, so a flap inside the window
  or a night is reported, never lost; with the window off and no quiet hours
  they cancel out as before. A group's tag is unique to its burst, so a
  second burst does not replace the first. `queuedAt` is persisted, so a
  restart works the window out again.
  *Quiet hours* (`alerts.quietHours`: enabled, start, end, mode; the zone is
  `alerts.timezone`, #703: a name on `Intl.supportedValuesOf('timeZone')` or
  UTC, which `POST /api/display-config` refuses with a 400 if it is not; one
  read from the file that is not is dropped). Unset, the zone is the server's
  own (`systemTimezone()`: the container's `TZ`, UTC if unset) when no
  `alerts` is saved, and America/Toronto, the earlier fixed zone, when
  `alerts` is saved without a `timezone`, so an upgrade changes nothing
  (`resolveAlerts`). Settings' picker (Quiet hours row) learns the server's
  zone from `serverTimezone` in `GET /api/push/alerts`, asks `GET /api/push/alerts/timezone?name=` before saving a pick (a zone the browser lists but the server refuses is shown as an error and the last good zone stays), writes the zone it
  showed along with the first change on an install with no `alerts`, and
  draws the zone's local time and the hours in it in the status line. An alert queued inside them is
  held: in `critical` mode a critical page still goes out, in `silent` mode
  nothing does; a page and its recovery both reach the summary. What is held leaves as one
  `alert_digest` ("While you were away: 3 services down") when they end, or
  as itself if it is alone. The end is found by counting minutes, so across
  a clock change it can be an hour out; the summary is early or late, never
  lost. The wait is not a stall: `/api/health` `oldestAgeS` skips held pushes.
  *Snooze and Ack.* The payload carries `keys` (the alert's episode, the
  recovery type and id, so acking a disk warning does not silence the node
  being unreachable; or each member of a summary) and `actions: true` for a page. The worker cannot read
  the page's session token, so its buttons post `{ endpoint, action, keys }`
  to `POST /api/push/web/alert-action` with the browser's own push
  subscription endpoint as the proof (a capability only that browser and the
  server hold, compared as digests in constant time; unknown: 404; 60 failed
  lookups a minute from one address, valid ones never counted). The push
  endpoint is the bearer: the push service's operator knows it too, an
  accepted residual risk for one user's homelab (the action can only snooze
  or ack). Snooze holds a page to the end of the snooze, and sends it then
  once if the incident is still open (dropped with its recovery if it
  recovered meanwhile), for an hour (1 to 1440 minutes in the API, at most
  24 h). Ack silences repeat pages for an open incident until its recovery,
  which is sent and ends the ack. Both ring through for a page worse than
  the incident was when silenced (a warning acked, then critical). Only an
  incident push has handled and not seen recover is open, so a late tap
  cannot silence the next one. Silenced entries are finished unsent (the
  history says `off`). The state is the push file's `producers["alert-policy"]`
  (written with the outbox, so it survives a restart); Settings lists it
  with a Lift button (`GET /api/push/alerts`, `POST /api/push/alerts/clear`).
  *Known causes* (`alerts.knownCauses`, at most 20 of `{ match, label }`;
  unset reads as one rule for "omada", Jag's own homelab, the only install
  without a saved list; save a list, empty if need be, to change it): an alert whose subject (service or
  host name), id or entity holds `match`, in any case, gets `label` after its
  body's " · " and a `cause` on `GET /api/events`, applied as read, so a rule
  added later tags the history too. The Alerts page draws "Known cause: ...".
  `alerts` is an `ATOMIC_KEYS` entry (a stale save keeps the server's copy);
  the schema and the route's read keep only the valid parts of it.
- *Parallel sends.* The outbox sends one device at a time and a push service that
  does not answer costs up to 10 s, so `push/channels.js` sends the subscriptions
  an event is going to together, 4 at a time, the first time the outbox asks for
  one in a round; its calls for the others take what is on its way. A send never
  throws, so one browser's failure is its own answer; a subscription that just
  failed for a retry is left to the outbox's backoff.
- *Cloudflare Access.* Behind Access (email OTP), an ended session answers every
  request from the page with a cross-origin 302 that fetch can only fail. The
  first `/api/auth/check` is sent with `redirect: 'manual'` and an 8 s timeout
  (`BOOT_CHECK_TIMEOUT_MS`); an opaque redirect shows "Sign in again" with a
  Reload (`src/ui/access-expired.jsx`, lazy) instead of a blank page or a
  JagHelm login form; a status poll that fails runs the same probe once
  (`probeAccess`) and raises the same notice over the page. A hang times out
  into the login gate, as a failed check always did.

*Threat model (#653).* What the parties see: Google's, Mozilla's, Apple's or
Microsoft's push service sees the endpoint (it issued it), the size and timing
of each message and its ciphertext, nothing of the title or body (RFC 8291: ECDH
P-256 against the browser's key, so only that browser decrypts); it is told
`Urgency` and `TTL`. JagHelm's VAPID key proves to the service which server
sends, so a stolen endpoint alone cannot push (the service refuses another
sender, and cannot be read from the ciphertext). Assets and what protects them:
(1) *The endpoint URL and the keys are capabilities*: whoever holds endpoint and
`p256dh`/`auth` can push to that browser, with a VAPID key of their own where
the service does not bind subscriptions to one. So they are stored 0600, sent by
the page only over the signed-in session, never returned (the list shows id,
name, times), never logged or put in an error (every log line of this code is an
id and a code; the logger also redacts the path of any URL on a push service,
`util/redact.js`), never in a test's output. (2) *The VAPID private key* is read
by `env.js` as a secret, or from `vapid-keys.json` (0600, #698), held as a key object, only signs, never logged or
served. Rotating it (a new pair) turns every browser's subscription "needs
turning on again". (3) *SSRF*: the endpoint is input from a signed-in user, and
the server will POST to it. It must be https, on the default port, with no
credentials or fragment, at most 1024 characters, and its host must be, or be a
subdomain of, `fcm.googleapis.com`, `push.services.mozilla.com`,
`push.apple.com` or `notify.windows.com` (`push/pushEndpoint.js`), checked at
registration, on load and again before every send; the send follows no redirect,
times out after 10 s and never reads the answer's body. Decision: an allowlist,
not the private-network blocklist the integrations use (`util/ssrf.js`), which
leaves every public host open, and the push services are a short, stable list;
a browser on another service is refused with a message that says so, and the
list is one constant to extend. Residual: DNS for an allowlisted name is
trusted. (4) *Abuse by a signed-in user*: 20 subscriptions at most, a test push
once per device every 30 s, a 100-event outbox; the routes need a session
(`x-auth-token`, not a cookie, so no CSRF). (5) *The lock screen*: the text is
state and subject only, and a tap goes to a same-origin path.

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
  entity by its type, id and node, and must carry the
  entity's state (by its severity: critical, warning, info), the word its type
  stands for ("Service down" is the model's Down), and the model's reason; its
  the Web Push payload's tag and URL must name it, and it must route to that
  entity. Every issue the model pages for must have
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

A disagreement fails it unless a named exception (`KNOWN` in each file) covers
it, where it says. An exception that stops happening fails too, so settling
one is deleting its entry. There are none today: #478 settled the failed
backup's push severity and #450 the meter's number. The old Android
derivation went in #325; the
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
  APP --> CPAL["CommandPalette<br/>(issues, entities, pages, apps,<br/>Settings sections, Quick Launch links)"]
  SH --> OL["/ : OverviewLayout<br/>(the utilities rail from 1440px)"]
  OL --> OS["OverviewStatus<br/>(the poll's status: ShellAttention,<br/>SubsystemStrip, the ?subsystem= filter)"]
  OL --> DV["OverviewBoard<br/>(useDashboardData: 304-stable,<br/>per-source health; tickBudget.js)"]
  OL --> UR["UtilitiesRail: weather and the clock,<br/>Quick Launch, Pipeline, Checklist<br/>(utilities.js, extras.js)"]
  SH --> LP["/launch : LaunchPage<br/>(the same panels and the web search)"]
  DV --> OI["OverviewInfrastructure<br/>(the poll's status + the board's readings:<br/>InfrastructureSection, cards or table)"]
  DV --> OPW["OverviewPower<br/>(the poll's status: the UPS's row)"]
  DV --> OJ["OverviewJobs (its own chunk)<br/>(the poll's status: JobsSection)"]
  DV --> OSV["OverviewServices<br/>(the poll's status + the board's latency and<br/>app metrics: ServicesSection, by node or group)"]
  SH --> SPG["/services : ServicesPage (its own chunk)<br/>(ServicesSection + ListFilters,<br/>the filters in the address)"]
  SH --> IPG["/infrastructure : InfrastructurePage (its own chunk)<br/>(InfrastructureSection + ListFilters,<br/>each Proxmox node's lists)"]
  SH --> AP["/alerts : AlertsPage<br/>(ShellAttention + AlertHistory:<br/>/api/events, the filters in the URL)"]
  SH --> SV["/settings/:section? : SettingsView<br/>(the index and its search, or a section;<br/>an old tab's address to its section)"]
  SH --> AF["/apps/:id : AppFrames<br/>(useAppFrames)"]
  AF --> IV["IframeView per app<br/>(useEmbedStatus)"]
  SV --> SEC["sections/: Nodes & Services, Integrations,<br/>Apps & links, Notifications, Appearance, System<br/>(one module each)"]
  SEC --> PRIM["settings primitives<br/>Card/Group/Toggle/ChoiceGroup/UiButton"]
  SEC --> ITAB["sections/integrations/<br/>(data, form and action hooks, row words)"]
```

- **Shell and routing** (#296). Every page lives in `AppShell`
  (`src/ui/app-shell.jsx`): the 48px header across the top (below 768px the
  Phone board's own, 56px, #569: "The phone screens on the web"), the grouped
  sidebar from 768px (Monitor: Overview, Services, Infrastructure and Alerts,
  the mock's order; Apps: one entry per
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
  `/services` and `/infrastructure` (#313). A path no route matches (or a
  route kept `hidden` until its page exists; only `/monitoring` (#751) is now) shows the Overview
  and replaces the URL with `/`, its query kept. `/services` and
  `/infrastructure` are a page at every width: below 768px the phone's
  Services and Infrastructure tabs (#303), from it the wide pages ("The
  Services and Infrastructure pages" below), so a window crossing 768px keeps
  the path and its query, filters and all (#567's review: the wide layout
  used to replace them with `/`). An `:id` the config has no
  app for does too, once the server's config has loaded (it may only be missing
  from this browser's copy). A plain click on a nav link navigates in the page
  (`followLink`); a modified or middle click opens a browser tab. The server's
  SPA fallback serves `index.html` for every path, so a deep link, Back,
  Forward and a reload all land where the URL says. Each page names the
  browser tab ("Alerts — JagHelm"), an open entity by its name. The command palette (⌘K or Ctrl K, or the
  header's search button) is the item below.
- **The command palette** (#315, UX audit m8). `src/shell/paletteIndex.js`
  builds what it finds, from the poll's status, the config and the nav's
  pages, in groups: the current issues (the model's order, worst first), then
  each entity with an address by its subsystem (services and containers,
  nodes, the UPS, jobs, backups, integrations and Arcane agents), the pages,
  "Open <app>" for each embedded app, Settings' sections
  (`src/components/settings/sections.js`, the list Settings' index draws),
  the Quick Launch links and Log out. No themes: the header's toggle and
  Settings → Appearance switch them. A query keeps the rows that have each of
  its words, anywhere in the name or at the start of a word of its kind,
  where, detail or group ("ups" finds the UPS, not Backups); a name that
  starts with it comes first, and the groups follow their best row, a word
  of the name starting with it counting as the name does. An issue or an entity opens
  with the rows' own link (`useEntityLink`, below): its URL over the page
  under the palette, its detail there. A page, an app and a Settings section
  navigate. A Quick Launch link is the panel's link, its target from
  Settings → Apps & links, no opener. `src/ui/command-palette.jsx` draws it and
  runs the keys (design-system.md, "Command palette"), holding the
  highlighted row by its id, so a status that moves the rows never changes
  what Enter opens; a modified or middle click on a row with an address is
  the browser's, a new tab. It is portalled to the end of `<body>`, so it
  opens over the detail drawer, whose Escape it keeps to itself. Only its
  shell is in the first load (#611): `CommandPalette.jsx`, the dialog and its
  field. What it finds (`CommandPaletteIndex.js`: `paletteIndex.js`, the
  search, Settings' sections and their search terms) is a chunk of its own
  (`loadCommandPaletteIndex`), fetched once the browser is idle, so ⌘K opens
  at once on a warm page; on one that hasn't it yet, the palette opens with
  its field and "Loading…" in the list (never "Nothing to show"), keeps the
  words typed, and fills in when the chunk arrives, or says it couldn't load.
  Below 768px no header has a search button, so only a keyboard's ⌘K or Ctrl K opens it.
- **Settings** (#317, spec §7). `/settings` is an index of Settings'
  sections, a card each (its lucide icon, its name and a one-line
  description; `SettingsIndex` in `src/ui/settings.jsx`) under a search of
  what they hold; `/settings/<section>` opens one. The sections are
  `src/components/settings/sections.js`'s list: Sources, Nodes & Services,
  Integrations, Apps & links (#362: embedded apps ordered by dragging or the
  Move buttons, an embedding check before one is added, Quick Launch groups
  and links, where links open, the web search; `tabs` and `links` are saved
  as before), Notifications, Appearance and System, in the
  spec's order. Each
  lists its parts, `{ name, anchor }`: the part's heading on the page and its
  id there. What a part holds (its controls' names, the tab it came from
  before #317 and other words for them, its `words`) is `sectionTerms.js`'s,
  which loads with Settings' chunk and the palette's index, not with the
  first screen (#611). The search (`settingsSearch.js`)
  finds a section when every word of the query starts a word of its name and
  line, or of one part's name and words; its card names the parts found
  ("Matches: Font family") and opens the section at the first
  (`/settings/appearance#font`). The command palette finds a section by the
  same words (its row's `terms`, `paletteIndex.js`, from `sectionTerms.js`), so "typography" or
  "security" finds where those tabs went in both. Each section is one module
  in `src/components/settings/sections/` (`index.js` maps an id to it): it
  draws the section's page, each part a `Card` or `Group` under the id its
  entry names, and carries its `icon`. A section's card (#318–#323) changes
  its module and its entry. `src/views/SettingsView.jsx` draws the index (a
  `ShellPage`) or a section's page (`SettingsSectionPage`: "Settings /
  <name>", its name as the h1 and its line, `SettingsNav` beside it from
  768px), scrolls to the `#anchor` the address has, and keeps the search's
  words while Settings is open, so Back from a section finds them. The 13
  tabs before #317 are parts of the sections now, moved as they were (the
  PR's table): an old address (`/settings/sections`) opens the section and
  part that hold what it had (`MOVED_SECTIONS`, `MOVED_ANCHORS`) and the URL
  is replaced by theirs (`/settings/nodes#custom-groups`), one no section has
  by `/settings`. `settingsHref(id, anchor)` writes a link to a part and
  throws on one Settings doesn't have, as `pathTo` does; the detail drawer's
  links take theirs from `src/shell/detail/settingsLinks.js`, and
  `scripts/settings-places.test.mjs` checks that every Settings place a
  string, link, table or living doc names is one Settings has. The router's
  table is as it was (`/settings/:section?`). A section's page is today's
  Settings markup until its card rebuilds it, so it sits outside any `.jh-ui`
  root, and its head and list are roots of their own; the design system's
  Button in it is `UiButton` (`primitives.jsx`: a root that draws no box).
  Its parts are h2 (`Card`, `Group`), a card in a part h3. Nodes & Services
  reads services.yaml when it opens and saves it as before
  (`serverConfig.js`, see 6, "Settings sends the version"), and its custom
  groups list the services it read. **Notifications** (#320) is built on the
  design system (`ThresholdTable`, `PushCategories`, `PushDevices` in
  `src/ui/`): its thresholds (4.7, "The threshold config") are checked on
  the page as the server checks them and saved with one Save over the
  version read, a refusal shown on the row it names and a 409 read again;
  its phones and categories come from one read of `GET /api/push/devices`,
  read again every 2 s while a test push is on its way (a minute at most).
  Remove asks first (a Confirm naming the phone). The live preview is gone
  (#306): a change applies to the board as it is made.
  **Sources** (#318) draws the header's status poll (`useStatus`, which
  `App` hands `SettingsView` and it the section: no request of its own), so
  it moves with the board and greys with it (`useStatusFreshness`, the one
  stale rule, #480). `sections/sourcesView.js` makes its rows from the model
  alone: Prometheus, Kuma, NUT and Gitea as `sources` says them, `ok`
  ("Answering") or `failed` with its error as served, the word of its
  `sources/<name>` issue when it has one ("Failing", "Off"), and `since`;
  one `sources` doesn't list is "Not set up", naming the variable to set.
  While `sources.config` is failed (services.yaml can't be used), a row for
  it comes first, the model's error and a link to Nodes & Services. The cron
  reporters' row counts the jobs' and backups' entities and the newest
  `lastRun`; its state is the worse of the Jobs and Backups subsystems, its
  word "Reporting" only while that is ok, else the model's
  (`subsystemCells`), with each failing subsystem's `sub` ("Backups: 1
  failed"). Its link opens the Jobs section filtered to the one kind that
  reports (`/?subsystem=jobs`), or the whole Overview when both do, since a
  filter shows its group alone; on a phone, the Infrastructure tab. Each row
  names its `.env` variable, never a URL: the model serves no address
  (`SourceList`, `src/ui/source-list.jsx`). Addresses aren't edited in
  Settings.
- **Settings → Nodes & Services** (#319, spec §7). Nodes and Custom groups are
  the earlier tabs' markup, moved by #317; the Services and Backup jobs panels
  are rebuilt on `src/ui/service-mapping.jsx` (`ServiceMap`, `BackupJobList`;
  the section is `sections/NodesServices.jsx`, the services' state
  `ServicesTab.jsx`, how each edit changes services.yaml `servicesConfig.js`).
  A disclosure per node lists its containers, each with its tag; Edit opens the
  display name, icon and monitor, with the Auto-match suggestion under the
  monitor (see "Explicit mapping" in 4.2 for the endpoint behind it). The
  section reads the config, `/api/services`, `/api/services/monitors` and
  `/api/services/monitor-mapping` together when it opens; without the last the
  choices are all there is. Backup jobs are `backupJobs` in the display config.
- **Settings → Integrations** (#323, spec §7). Two parts, Connected and Add
  an integration (`IntegrationList`, `PresetGallery`, `IntegrationForm` in
  `src/ui/integrations.jsx`; the section is `sections/Integrations.jsx`).
  A row is the preset its entry says (`preset`, else its key, the server's own
  rule in `integrations/lib/config.js`); it never guesses from the part of the
  key before an underscore. An entry naming a preset the gallery doesn't list
  (the server gates presets marked `unsupported` out of `/presets`) reads
  "Unsupported preset", not Custom; one naming nothing known is Custom; and
  while `/presets` can't be read every row shows its key with no kind and the
  list says why. Its lamp and word are the status model's for
  `integrations/<key>`, greyed to no signal with a stale status; a disabled one
  isn't fetched and says so. A custom entry's `endpoint` and `fields` are
  written in services.yaml: Settings keeps them on save (#402) and says so on
  the row and in the form, which has no inputs for them. The requests are
  unchanged (`sections/integrations/useIntegrationActions.js`). No stored
  credential is ever read back. The server is what keeps a credential out of a
  test result or a refusal; as defence in depth the form also blanks what it
  was typed, in any letter case, from those two texts: the password or token
  as typed, `encodeURIComponent`-encoded (with `+` for a space too) and as JSON
  escapes it in a string, when it has four characters or more. A truncated
  echo, a hash or base64 of it and a shorter secret are not caught.
  Removing, from the row or the form, asks in the Confirm dialog by display
  name, and says stored credentials are deleted only for an entry that has
  some. Nothing in `src/` reaches the browser's `confirm()`,
  `alert()` or `prompt()`: `scripts/no-browser-dialogs.test.mjs` resolves every
  such name per scope (a `confirm` from `useConfirm()` is the app's own only
  inside the function that declares it) and follows copies of `window`,
  `top`, `parent` and `globalThis`.
- **Entity URLs** (#309, spec §7, §8). Every entity the status model has
  (a service or container, a node, the UPS, a job, a backup, an integration,
  an Arcane agent, a failed source) has an address: its model id (4.7, stable
  across refreshes and restarts) in the query of the page it is opened over,
  `?entity=<id>`, written with its `/` and `:` as they are
  (`/?entity=services/apps:jellyfin`, `/alerts?entity=nodes/storage`). A
  query, not a path, because the detail is drawn over the page it was opened
  from, which stays drawn and keeps its state under it; the Overview's
  filter stays beside it (`/?subsystem=nodes&entity=nodes/pve`). The URL
  drives the detail (`src/shell/entityNav.js`): from 768px `App` draws the
  Drawer (`src/shell/detail/EntityDrawer.jsx`, its own chunk, loaded with the
  first entity opened) over any page; below 768px the phone screens draw the
  entity's detail sheet (`phoneNav.js`, below), so a resize keeps it open.
  A row opens it by pushing its URL (`openEntity`), an entry that holds the
  details it shows (`history.state`), which marks it as opened in the page:
  Escape, the close button, the scrim or a sheet's Back go back to the page
  (`closeEntity`), as the browser's Back does, and focus returns to the row.
  One opened from its URL (a reload of a link, a link in a new tab, a push)
  has no entry before it in this app: closing it replaces the URL with the
  page's. A reload, Back and Forward draw what the URL says, and so does a
  sign-in: the sign-in screen leaves the URL alone, and the shell opens it
  (`e2e/entity.spec.mjs`). An id the model has nothing by (removed, renamed,
  an old link) says "No longer monitored"; a monitoring source's
  (`sources/…`), which the model lists only while it fails, says "This
  incident has resolved" (#314, as the phone's incident sheet does). The URL's id is anyone's to
  write, so the drawer's titles are the model's names or fixed words, and a
  gone id shows only as code, cut to 64 characters. The rows that open one: every
  issue row (the attention panel, Alerts, the phone's lists), a Services
  row, a node's card and its row in the table (links the page opens itself,
  `src/ui/lib/link.js`: a plain click opens it here, a modified or middle
  click is the browser's, a new tab at the same URL), and the phone's rows.
  Which detail an id opens is `src/phone/nav/entityRoute.js`, the one map
  the web and a push's tap share: `services/…` Service
  detail, `nodes/…` Node detail, anything else Incident detail. What the
  drawer draws is the next item. The command palette opens them the same
  way (#315).
- **The detail drawer's content** (#310, spec §8). The same on the desktop's
  drawer and the phone's sheet (web look): the model's word, reason and
  since in the status box, then what the kind adds, built by
  `src/shell/detail/entityExtras.js` from the status and the reads the detail
  makes while it is open (`useDetailSources.js`: as it opens, then on each
  answer of the header's status poll, so they pause with it in a hidden tab;
  none while it is closed). A node: its readings as meters (the
  Infrastructure card's, the model's level for each), its uptime, memory and
  disk in units, and on a Proxmox node (`proxmox.js`: the integration's
  `_target` node, else "pve", as the model reads its pools) its virtual
  machines, its storage pools as meters on the disk rule (the model's level
  for each `pool:<name>`, the served lines) and its last vzdump backup. A
  service or container: Kuma's latency (while up) and 24 h uptime (a
  service's only), a breadcrumb's last seen, its node, Docker's CPU, memory
  and RX/TX rates while it runs (the rate fields, spec §6.3), and the stats
  of the integration the Services rows match to it (`integrationClaims`).
  The UPS, all the model's (#586): its charge, runtime (the minutes left on
  battery; on mains, at this load), load and model, a reading it has none
  of left out. An
  integration: its fields, or why its last read failed. A job or a backup
  (#578): its node under its name, its schedule in words and its last report
  (the model's), then "Last runs": the overdue line while the model says it
  is overdue, the old panel's "Last report 31 h ago · expected every 24 h",
  in the warning's colour, over its last three runs from `/api/cron/status`
  (when, how long, the word and the error of one that failed, a job's failed
  run a warning and a backup's critical, as the model judges them), and its
  Remove (below). A Proxmox backup
  still running (no status yet) says "Running", never "Failed". A read that
  fails keeps what it had, under a Banner saying so; with a stale status the
  facts are greyed as last known ("Last known 3 min ago", #480) and the UPS
  has no runtime. Links (`detailLinks.js`): JagHelm keeps no address for a
  service, Grafana or Kuma, so they are the user's own apps (opened inside
  JagHelm) or Quick Launch links, found by their exact name, never an icon:
  Open <service>, Proxmox, Grafana, Uptime Kuma; then where the thing is set
  up in Settings. Every app and link of a name is collected, and two reaching
  different addresses give no link; what is one per node names its node
  ("Proxmox pve2", "cAdvisor (Storage)" for a service on several nodes),
  else it has none. `EntityDetail.jsx`
  leaves slots for #312 (heartbeats), #311 (charts) and `runs` (a job's
  Remove, #578), drawn where they go when given. The drawer fills
  `heartbeats` for a service with a Kuma monitor (`DetailHeartbeats`, under
  the status box: "Heartbeats · last 50", how often the checks come, "every
  30 s", and the strip of 50, focusable, its arrows reading each check; from
  the `/api/services` read it makes already); the phone's sheet draws the
  same, "· last 30", in its large beats. The drawer fills `chart`
  for a node, and for a service or container with a container (its
  `/api/services` card names it), under the status box: "History" with the
  range switch (1 h, 24 h, 7 d; 1 h as it opens, kept from one entity to the
  next), then a node's "Usage" (CPU, memory and disk on one 0–100 % axis)
  and, with a sensor, "Temperature", or a container's "CPU" and "Memory"
  (`HistoryCharts.jsx`, `historySeries.js`, drawn by `Chart` from `src/ui`;
  in the drawer's chunk, so out of the first load). Its read
  (`useHistory.js`) is one request of the entity's series as the drawer
  opens and when the range changes, then again on a status answer once the
  range's step has passed (a minute for 1 h), with the last ETag: an open
  node or container drawer adds at most one request a minute, the one
  exception to the 4-a-tick budget (`tickBudget.js`). Its charts are one
  `ChartGroup`: they share a time axis (the same plot left edge and width),
  and their time ticks are one even stride on the local clock. A series
  Prometheus didn't answer says so, and why, in place of its line; a read
  that failed says the history couldn't be read. The phone's sheet draws the
  same charts (#602, "The phone screens on the web" in 5). The parts are `src/ui/entity-detail.jsx`
  (docs/design-system.md). Reads per status tick while open: none of what
  the page already reads (the detail takes the page's answer to the same
  address, `lastAnswer` in `useData.js`, when one came since its own read and
  within an interval and a half), else a node, a service or a container 2
  (`/api/services`, and `/api/integrations` when the model has an
  integration), an integration 1, any other kind 0 (the UPS too, #586).
  **Recent errors** (#672): under the sections, a node's and a service or
  container's (the same targets as the history) "Recent errors · last 6 h",
  the last 20 error-ish log lines from Loki. The server (`lokiLogs.js`,
  `GET /api/logs?entity=<node>|<node>/<container>`, `LOKI_URL`) builds the
  query itself, `{host="<node's Prometheus label>",container_name="<name>"}`
  matching `error|err|warn|warning|fatal|panic|critical|crit` as words, from
  names it knows (a node of services.yaml, a container it has seen there; any
  other is a 404 before Loki is asked, and a node with `visible: false` is
  one), each escaped into a double-quoted LogQL string. `host` is the node's
  `loki_host` in services.yaml (a plain name, else ignored), else its key:
  not the Prometheus label, which differs on the homelab (`vm103` there,
  `vm-103` in Loki). It asks Loki for the 6 h before now, newest first, limit 20,
  a 4 s timeout, and keeps an answer 30 s (a failed one 10 s). Every line is
  cleaned before it leaves: ANSI, control, bidi and zero-width characters out,
  a JSON line reduced to `level module: msg`, credentials redacted
  (`redactSecrets`, plus Authorization/Cookie and similar headers, Bearer,
  token, password, pass, pwd, secret and api-key pairs, `*_PASS/_KEY/_TOKEN`
  env pairs, JWTs, GitHub/GitLab/Anthropic/OpenAI/AWS/Slack token shapes, PEM
  private keys, Slack and Discord webhook URLs), cut at 300 characters; the
  web draws it as text. The answer is `ok`, `none` (the target sent logs in
  the window, none error-ish: the all-clear), `silent` (it sent none, found by
  a second one-line query: "No logs received from <host>: check the Loki host
  label", as for a host that is off or a wrong `loki_host`) or `unavailable`
  with a fixed sentence (`failureWords.js`, "No Loki is set up", "Loki
  refused the connection"); a read that fails in the browser is `unavailable`
  too, never an error toast. With no dashboard password set the route answers
  `unavailable` and asks Loki nothing (raw logs, as the secrets API:
  `JAGHELM_ALLOW_OPEN_SECRETS=true` overrides). It is read as the detail opens and then at most
  once a minute on a status answer (`useLogPeek.js`), never from a sheet
  another covers; it is in the detail's chunk.
  A job's runs are read as its detail opens and again only when the model's
  `lastRun` says it reported since, never per tick and never from the page's
  answer, past the HTTP cache the route allows (a minute). Over the
  Overview, which reads `/api/services` and `/api/integrations` each tick
  (`OverviewBoard`), a node's or a service's detail adds none. The phone's
  sheet has `/api/services` already, so it asks only the other, and only the
  sheet on top asks. Nothing on the web reads `/api/ups` (#586): the UPS's
  detail draws the model's load, model and runtime on mains, which the
  model holds for up to 5 minutes between reads (4.7), so they are at most
  that old, plus a cycle and a poll. The endpoint stays for
  the old-server fallback until Phase 4 removes it (spec §6.3).
- **The Alerts page** (#296, #314, spec §8). `/alerts` says what is wrong
  now and what happened. *Active* is the status model's issues, worst first,
  as the Overview's top draws them (`ShellAttention`, below). *History* is
  the alert history (`GET /api/events`, 4.7 "Push"), newest first, by day
  ("Today", "Yesterday", "Oct 18", the viewer's calendar): each event's
  time, its entity (the model's name and where, or what the event said for
  one the model no longer has, "No longer monitored"), the change (the step
  its type names: "Down → Up", or just what it became where the type doesn't
  say from what, "Down", "Critical"; `changeOf`), why (the model's reason,
  as the push said it, left out where it only says the change again: "On
  mains" after "On battery → On mains", "Healthy" after "Normal";
  `restates`) and what the phones got ("Sent to 2 phones",
  "Sending", "Push not set up", "Not sent: off in phone settings", "Not
  sent"), as `AlertHistory` rows (`src/ui/alert-history.jsx`). Push off still
  records every event (#267), so History works without push. One set of
  filters over both, in the address (`alertsFilter.js`, on the list pages'
  one hook, `listFilters.js` `useUrlFilters`, #313: a replaced entry keeps
  what it held, and an open entity's id stays as written; the controls are
  `ListFilters` configured, `AlertFilters`):
  `?severity=critical|warning|info`, `?kind=` an entity kind and `?q=` a
  search, so Back undoes a change (the search is one entry however long it is
  typed: it commits 300 ms after the last key and refines the entry it
  started), a reload keeps them, and a link opens the page filtered; a value
  it doesn't know is no filter. Active filters the status in hand
  (`issueMatches`: critical is crit, warning is warn, info is never active,
  and no signal is no severity); History asks the server with them, since it
  keeps up to 1000 events and sends 50 a page ("Show older" asks for the
  next), and a filter in the client would see one page. With a filter set the
  attention panel says "Showing critical alerts on services only" with Clear,
  and "No active …" when none is left; the toolbar has "Clear filters".
  `useAlertHistory` asks the first page again on each answer of the status
  poll (so a new event, and what push did with it, shows within a poll), and
  none while the browser tab is hidden, as the poll pauses. A failed read
  says "History unavailable" with Retry, never "nothing happened"; a refresh
  that fails keeps the rows it had and says so; a server without
  `/api/events` (a 404: one older than #267) is "History needs a newer JagHelm server", Active only, and isn't asked
  again this session, for any filter or visit. Each row
  opens its entity's detail over the page (`useEntityLink`, #309), the
  filters kept in its URL. A row's name is never cut short: a long one
  wraps, and on a phone the change goes under it. The page is its own chunk
  (`loadAlertsPage`). The phone's Alerts tab draws the same two views and
  filters from the shared screen (5.1, "The phone screens are shared").
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
  When the server can't be reached the header says steel "No signal". The last status is kept, but never drawn as current (#480, "No
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
  says whether anything is wrong, what and where, before its sections
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
  state is the poll's), and is memoised on the poll, so the sections' tick
  doesn't re-render it. Each row opens its entity's detail over the page, at
  its URL (#309, `entityNav.js`); before that it led to an in-page anchor,
  and each node card and service row still carries its entity's anchor
  (`entityAnchors.js`). The list of places drawn, which the rows read, went
  with the old board (#306), whose panels were most of them. A wrapper
  (`.overview-status`, `global.css`) lines the status up with the sections
  under it: the page's padding plus their 16px margin.
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
  The sections under it keep that subsystem's (`OverviewBoard`,
  `SECTION_OF` in `overviewSections.js`): Nodes Infrastructure, Power the
  Power section, Jobs and Backups that group of the Jobs section, Services
  the Services section. When the filter keeps none, a note in their place
  says why (`emptyFilterReason`), never that the subsystem isn't set up,
  since the model says it is: its section switched off ("The Jobs section is
  switched off", with where to switch it on), or no section of its own
  (Integrations, whose numbers show on their services' rows). Each note
  offers "Show everything". (The old grid board kept each subsystem's panels
  the same way, until #306 removed it.) With
  a stale status, each tile keeps its value and sub-line, as last known, its
  lamp the steel ring (#480); how old they are is said once, by the header
  and the attention panel, never on a tile (#541).
- **The Overview on a phone** (#484, #303, spec §8 "Phone width"). Below
  768px (`PHONE_WIDTH` in `@ui/app-shell`, `(width < 48rem)`: the shell's own
  `md`, where the bottom tabs replace the sidebar, one value for both) the web
  draws the phone screens, not the desktop Overview ("The
  phone screens on the web", 5.1). Their Overview is the Phone board's, in the
  Phone board's order: the status card, the strip, then the issue list, so a
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
  says "No signal", why, and what it last knew.
  From 768px the Overview is the desktop's: one panel with the strip under it,
  as before. A resize across 768px swaps the two.
- **The Overview at every width** (#302, spec §3 goal 3, §8). Nothing hides
  from 360 to 2560px: no sideways scroll, nothing clipped, every name whole
  (`e2e/reflow.spec.mjs`). The widths come from the shell's two media
  queries, `PHONE_WIDTH` (768px) and `RAIL_WIDTH` (1440px), and no third: a
  tablet (768–1023px) is the desktop Overview in one column, which it is by
  flow (the status, the strip, Infrastructure, Power, Jobs and Services stack
  at every width without the rail), and its strip wraps by its own
  container queries (six tiles to a row from 816px of strip, where the
  widest value, "Low battery", fits in every typeface, #541; two rows of
  three under it), as the node cards fill their section's width. Sections
  grow with their content and never clip it; a strip tile's value and
  sub-line wrap only between words, never cutting one. On the first load the page fills in from the top (#243):
  `OverviewBoard` draws nothing until the header's poll has its first answer
  (`reach` past `loading`), while its data loads, so the status, a
  placeholder of unknown height until then, can't push down sections already
  drawn under it (CLS 0.50 at 390px before, 0.0001 after).
- **The Infrastructure section** (#299, spec §8 item 3). The first section
  under the status (`OverviewBoard` draws it, 16px in, lined up with the
  status), the nodes as cards or a table (`OverviewInfrastructure`
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
  the one `units` setting (5, "Units and locale") drives the weather; the
  model's temperatures stay °C until #494 serves the unit with the status.
  Under the meters: the hosted services' up and
  down counts (the model's service and container entities on the node), the
  uptime and the last hour of CPU (a Sparkline, its tooltip printed by
  `shownReading`), every node's from one read of
  `/api/history?series=node.cpu&range=1h` (#311, 4.2), a point a minute. The user's colour for a node shows only as a 10px swatch.
  The table has the same readings, coloured the same way; it needs 720px, so
  in a narrower section (a phone, a tablet) the section draws the cards and
  offers no toggle, rather than scroll the state and the readings off to the
  side, and the table comes back when it fits. Cards or table is kept per
  browser (`prefs`, `jaghelm-infrastructure-view`), cards by default; with
  storage blocked the choice lasts the visit. Each node drawn carries its
  anchor (the card, or its name in the table) and opens its detail, where its
  Proxmox lists are (#310). It shows unfiltered and under the Nodes filter,
  and another filter hides it. Before the first status or `/api/services`
  answer, three placeholder cards; with no node, nothing; when
  `/api/services` stops answering, a Banner over the last readings says so,
  with Retry. With a stale status (#495), no level from it is drawn: every
  node and meter is no signal (the steel ring; a meter's fill steel and its
  number, still `/api/services`', in text-2, said "94%, no signal"), the
  words and reasons kept, and the count says "3 nodes · No signal · last
  known 3 min ago". The old board's node panels went with it (#306): their
  Proxmox lists are the node's detail's, and the Infrastructure page's
  (#313). A node is marked by its name, its role and its colour (Jag, #306):
  Settings → Nodes & Services has no icon field, every Settings save of
  services.yaml drops a node's `icon` (`withoutNodeIcons`,
  `src/components/settings/serverConfig.js`), and discovery writes none.
- **The Services section** (#300, spec §8 item 4). The last section
  (`OverviewBoard` draws it, lined up the same way), every service in one
  list (`OverviewServices` in `src/shell`, drawing `ServicesSection` and its
  `EntityRow`s from `src/ui`). It replaced the old board's service cards: the
  custom groups are its grouping rather than panels of their own, and no
  card is dragged between panels, so a custom group's services are chosen in
  Settings → Nodes & Services (see "Custom groups" below). It reads the header's
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
  Group is disabled, with a link to Settings → Nodes & Services; Settings'
  order, the rest under "Not in a group", each row with its node beside the
  name); within a group the worst
  first, then by name. services.yaml has no tags, so there is no grouping by
  tag. The choice is kept per browser (`prefs`,
  `jaghelm-services-grouping`), by node by default. The heading counts what
  it lists, the mock's "12 monitored · 1 down · 1 no signal" (each failing
  kind by the model's word), "· all up" when nothing fails. The name is never
  cut short before anything else (`EntityRow`); narrower than 672px the row is
  the Phone board's, the name over "metric · latency". Settings has no
  service-card options any more. Each row carries its anchor and opens its
  service's detail. It shows
  unfiltered and under the Services filter, which keeps it alone; another
  filter hides it. Before the first status or `/api/services` answer,
  placeholder rows; with no service in the model, nothing; when
  `/api/services` or `/api/integrations` stops answering, a Banner over the
  last numbers says so, with Retry. With a stale status, every row is no
  signal (the steel ring named "No signal", the detail in steel), its words
  and numbers kept, and the count says "12 monitored · No signal · last known
  3 min ago". A service with a Kuma monitor draws its heartbeat strip (#312,
  `/api/services`' `beats`, 4.2) as the row's trailing figure: its last 30
  checks, newest on the right, empty slots on the left while it has fewer,
  each check's word, time and response time in a tooltip under the pointer
  (never on touch; a strip inside a row is no tab stop). The first screen
  carries only the static strip: the tooltip and the drawer strip's keys
  come with the floating layer, asked for the first time a pointer comes
  over a strip or one takes focus, and add nothing to its box. From 672px of the
  row the strip takes what the name, detail and meta leave, up to its 178px,
  losing its oldest beats first; narrower, the newest 12. A container with
  no monitor draws no strip, but keeps a strip's room, empty and hidden
  (`BeatSpace`), while another row has one, so the rows line up. With a
  stale status, a failing or pending check is drawn in no signal's solid,
  never a level's colour. The Services page's table has the same strip in a
  Heartbeats column (a dash with no monitor), which gives up its oldest
  beats, down to the newest 12, before the table would scroll sideways
  (`fit`); the phone's rows show it too (the newest 12).
- **The Power section** (#306). Under Infrastructure (`OverviewBoard` draws
  it, lined up the same way), the UPS (`OverviewPower` in `src/shell`,
  drawing `JobsSection` from `src/ui` with its own title and Lucide `Zap`):
  the new home of the old board's UPS panel. On mains the UPS has no issue
  row, so this row is its one place on the Overview; it opens the UPS's
  detail (#310: the charge, load, model and runtime). It reads only the
  header's poll (`powerView.js`): the `power/ups` entity's lamp, word and
  name (the model's, else "UPS"), its charge while it is well ("100 %
  charge", the model's `metric`), else its reason, and on battery the
  minutes left (`runtimeMinutes`, #549, never from a stale status); the
  heading counts it as the Power subsystem does ("On mains"). It shows
  unfiltered and under the Power filter, which keeps it alone; another
  filter hides it, and so does its switch (Settings → Appearance → Overview
  sections, `power`). With no UPS in the model, nothing; with a stale status
  the row is no signal, its words kept.
- **The Jobs section** (#578). Between Power and Services (`OverviewBoard`
  draws it, lined up the same way), every scheduled job and backup
  (`OverviewJobs` in `src/shell`, drawing `JobsSection` and its `EntityRow`s
  from `src/ui`): the new home of the old board's Scheduled Jobs panel. It
  reads only the header's poll, the model's job and backup entities with
  their `schedule`, `lastRun` and `overdue` (4.7), so it adds no request,
  and judges nothing (`jobsView.js`): a row per job, by node then name, in
  two groups, Jobs then Backups, each counted by the model ("3 / 3 OK"). A
  row: its lamp, its name, its node, the model's schedule in words while it
  is well, otherwise the model's reason in its state's colour, and how long ago it
  last reported, by the status's clock ("3 h ago"). Healthy rows are muted;
  a failed backup is critical and tinted, a failed or overdue job a warning
  (the one severity table, ADR 0006). The heading counts them: "7 scheduled
  · all OK", "6 scheduled · 2 failed · 1 overdue · 1 no signal". A row opens
  its detail (above): Remove there asks first (the library's `Confirm`,
  naming the job and its node), then calls the old panel's endpoint
  (`deleteCronJob`, `DELETE /api/cron/jobs/:node/:job`), and on success the
  row goes at once (`removedJobs.js`: until the model drops it next cycle,
  unless it reported again since; on a read-only server for the visit), the
  drawer closes, and focus lands on the row after it (or before it; the
  only one, on the section's heading: the section stays, saying none is left
  to list, until the model drops the job); one that fails says why over the
  button ("JagHelm answered HTTP 500. Nothing was removed."). A job or node
  named "." or ".." is refused by the cron route on report and on delete
  (400), and never sent by `deleteCronJob`: a browser rewrites such a path
  segment, so its 404 would say nothing of the job. It shows unfiltered, and under the Jobs or Backups filter
  with that group alone; another filter hides it, and so does its switch
  (Settings → Appearance → Overview sections). With a stale status every row
  is no signal, its words kept, and the count says how old they are; with no
  job in the model, nothing. The demo's jobs run on their schedules, in UTC,
  which their schedules say ("daily at 02:00 (UTC)"); a schedule is in its
  reporter's clock and a run's time in the viewer's ([docs/REPORTING.md](REPORTING.md)). It is its own chunk (`loadOverviewJobs`), so a
  phone's first load doesn't carry it: `OverviewBoard` asks for it as it mounts,
  beside the status poll, and draws nothing under the status until it is in
  when the model has a job, so it never moves Services as it comes (the
  desktop's first load counts it, `scripts/first-load.mjs` DESKTOP_CHUNKS).
  Below 768px the same list is under the nodes on Infrastructure
  (`PhoneJobs.jsx`, its own chunk, asked for with that tab, the last thing on
  it; `PhoneView.jsx` gives it to the tab as `after`), each row opening its sheet,
  whose Remove closes it the same way.
- **The Monitoring page** (#751, Monitoring spec §5, §7). `/monitoring`,
  `MonitoringPage.jsx` in `src/shell` (its own chunk, `lazyViews.js`), from
  768px: sections whose headings say what they answer (Power and cost,
  Capacity, Resources, Containers, Drives), a Chart per entry of
  `GET /api/monitoring`, drawn by that chart's entry in `DRAWINGS`
  (`monitoringDrawings.jsx`: `{ section, Body }`, `Body` a component for the
  Panel's content, which draws its own failed and empty states; its header
  comment is the shape), a range switch of 1 h, 24 h, 7 d and 30 d. Placeholders
  stand where charts will be until the first answer; a chart Prometheus could
  not answer shows its own sentence; a section with no chart is not drawn. The
  route is **hidden** in `routes.js` while the charts arrive card by card
  (#734): it is out of the sidebar's Monitor group (after Infrastructure when
  shown) and the palette, and a visit lands on the Overview, at any width (it
  has no `phone` flag until the phone's page, #755). The card with enough
  charts removes `hidden`. `useMonitoring.js` reads it: once as the page
  opens and on a range change, then on an answer of the status poll once the
  range's step has passed, the tick budget's exception (below).
- **The Services and Infrastructure pages** (#313, spec §8). From 768px,
  `/services` and `/infrastructure` in the sidebar's Monitor group (and the
  palette's pages): every service, and every node, drawn by the Overview's
  own sections (`ServicesPage.jsx` and `InfrastructurePage.jsx` in
  `src/shell`, each its own chunk, `lazyViews.js`). Both are built from what
  the Overview's sections are (`useServicesSection.jsx`,
  `useInfrastructureSection.jsx`: the rows or nodes from the model, each
  opening its detail over the page, the freshness, the grouping or the cards
  / table choice, the loading and the stale-numbers Banner), so a row, a card
  and a table row have one source. Over them a row of filters (`ListFilters`,
  `src/ui/list-filters.jsx`, the Alerts page's too): a search and a Select
  each, and "Clear filters" while any is set. The filters are the page's
  address (`listFilters.js`, one hook and one search draft for every list
  page, the Alerts pages included, over the pure `filterQuery.js`: `?q=`,
  `?state=`, `?node=`, `?tag=`, `?role=`), so Back undoes a change
  (each is a history entry; a search goes in once typing stops, refined in
  the same entry), a reload keeps them, a link opens the page filtered, and
  an entity opened over the page keeps them under it. What each keeps is
  `pageFilters.js`, apart from the view models so only the pages' chunks
  carry it. The search matches
  each of its words, anywhere: a service's name, its node's key or name, a
  custom group holding it, its container; a node's name, key or role. The
  state filter goes by the state drawn (`problems` is the model's issues:
  critical, warning and no signal; with a stale status every row is no
  signal, and is filtered so). Services: State, Node, and Tag only once a
  service has tags (#519; none do yet, so there is no dead control, and a
  `?tag=` is ignored); the Overview's Node / Group grouping (one choice for
  both, `usePref.js`: every reader of a key follows a change in another, so
  the Overview, out of sight, comes back with it), and List or Table (kept
  per browser, `jaghelm-services-view`): the table (`ServicesTable`,
  `src/ui/services-table.jsx`, a module only the page's chunk carries) has
  the same rows in the groups' order (service, node, the custom group while
  grouped by one, container, detail, latency, heartbeats, state), is drawn
  from 800px of section (720 and the strip's newest 12, #312), and below
  that the list stands in. The Overview's Services section ends with "Show all
  12 services →", to the page. Infrastructure: State (no maintenance: a node has none) and
  Role (services.yaml's subtitle, while any node has one); cards or table,
  one choice with the Overview's; and under the nodes, each Proxmox node's
  virtual machines and storage pools, as its detail builds them
  (`proxmoxNodes.js` calls `entityExtras.js`), for the nodes the filters
  leave. The count says what a filter left ("3 of 12 monitored · 1 down", "1
  of 3 nodes · 1 warning"); a filter that leaves nothing says so with Clear
  filters. Each page reads what the Overview's section reads, on the App's
  tick while it is open (the request budget below), and the Overview's
  board reads nothing meanwhile. Below 768px the same addresses are the
  phone's tabs: `PhoneView.jsx` gives the Services tab its search and node
  chip from the address (`q`, `node`; a chip pressed there clears the wide
  page's `state` and `tag`, which its chips can't show, and until then they
  wait in the address; a node the list doesn't have is All), so crossing
  768px keeps both. The phone's search is the page's (`searchMatches`:
  each word, trimmed, in a service's name, its node's key or name, or its
  container), so one `?q=` lists the same services at 767 and 1440px. The
  Infrastructure tab has no filters.
- **Node order** (#667, `src/shell/nodeOrder.js`). Settings → Nodes &
  Services → Nodes has a Move up / Move down button per node. The order is
  the display config's `nodeOrder`: node keys, first to last (at most 64,
  strings; the schema reads any other shape as unset and the route's read
  leaves it out, so a hand edit never refuses a save; a key over 64
  characters is dropped from the list alone). One rule, `orderNodes(keys, nodeOrder)`: the listed keys first as
  saved, nodes the list lacks after in their current order, a removed node
  ignored. It is applied once, where the dashboard reads `/api/services`
  (`useDashboardData`'s `nodeOrder` option, `withNodeOrder`), so the
  Infrastructure page and cards, the Services groups and Node filter, the
  Overview and the phone's screens list the nodes alike; Settings' rows use
  it too. `nodeOrder` is an `ATOMIC_KEYS` entry (server copy wins on a stale
  save, with its own toast), and each move is worked out inside the config
  update from the order at that moment, so quick clicks all count.
- **Disk forecast lines** (#670, `src/components/settings/sections/DiskForecast.jsx`).
  Settings → Nodes & Services → Disk forecast sets the display config's
  `diskForecastDays` (`{ warn, crit }`, 14 and 3 days unless saved) that colour
  the forecast (4.2, "Disk forecast"). Two number fields save as soon as they
  make a valid pair; a pair that doesn't (red not under amber, not whole days)
  is said and not saved. A preview of the three colours follows the lines, and
  Reset drops the saved pair. Atomic, with its own stale-save toast.
- **Backup freshness lines** (#675, `src/components/settings/sections/BackupFreshness.jsx`).
  Settings → Nodes & Services → Backup freshness sets the display config's
  `backupAgeHours` (`{ warn, crit }`, 36 and 72 hours unless saved; whole hours, 1
  to 720, red over amber) that colour the Backups section's ages (4.2,
  "Backups"). Same shape as the disk forecast lines: valid pairs save at once, a
  bad one is said and not saved, a preview of the three colours follows, Reset
  drops the pair. Read on the server as unset when it is no pair (never fails a
  save). Atomic, with its own stale-save toast.
- **Custom groups** (#517, `src/shell/customGroups.js`). Settings →
  Nodes & Services makes them; the Services section groups by them. A group is
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
  The old Sections tab's titles, subtitles, icons and colours for the old
  board's panels (UPS, Pipeline, Quick Launch, the Checklist) went with it
  (#306, the Settings map in spec §15): Settings → Appearance keeps a switch
  each for the three utilities, and the UPS's is the Power section's.
- **Utilities: the rail and the Launch page** (#301, spec §8 item 5). Quick
  Launch, Pipeline and the Checklist are one component each in `src/ui`
  (`utilities.jsx`), fed by `src/shell/utilities.js` and wired in
  `src/shell/Utilities.jsx`, and drawn in two places, each a chunk of its own,
  so a phone's first load carries none of them (#532). The Launch page
  (`/launch`, `LaunchPage.jsx`, its own chunk) holds all three at every width:
  Quick Launch across the top, Pipeline and the Checklist side by side from
  672px of page. From 1440px (`RAIL_WIDTH` in `@ui/app-shell`, `(width >=
  90rem)`, beside `PHONE_WIDTH`) the Overview's frame (`OverviewLayout.jsx`)
  draws the same panels in a rail beside its sections (`OverviewRail.jsx`,
  `loadOverviewRail`: its column is laid out at once and the panels drawn in
  it once the chunk is in, so the sections never move; the desktop's first
  load counts it), the mock's widths
  (`flex: 1 1 300px`, 280 to 340px). Narrower, the rail is not rendered at
  all, so nothing is drawn twice or polled off screen; the sections keep their
  place in the tree either way (only the wrapper's class changes), so crossing
  1440px never remounts them. While the rail shows, the page's 5%
  gutter moves out to the split (`.overview-split`, `global.css`) so the
  sections and the rail line up 24px apart. The rail keeps Settings →
  Appearance's switches for the three panels (its Utilities card); the Launch page draws everything
  set up, whatever they say. No new server data: Quick Launch is the config's
  `links`, every group with a link in the config's order (the old board drew
  only the first three), a link opening in Settings → Apps & links' target, one the
  browser can't open (`safeUrl`) left out; Pipeline is `/api/gitea/activity`,
  the newest six commits across the repos, each the mock's row (#532): the
  CI result's lamp and "repo · CI Passed" (with no CI result, "repo ·
  message"), over "branch · sha", the age, and the message in its tooltip; no
  panel when Gitea isn't set up (`giteaConfigured`, `utilities.js`),
  and a Banner over the last rows when the read fails; the Checklist is
  `/api/todos` (`useTodos`): each add, tick and delete saves the whole list
  (the endpoint replaces it, after checking each todo: `id` a string up to 64 characters or a whole number (older clients wrote `Date.now()`),
  `text` up to 1,000, `done`, optional `due` as YYYY-MM-DD and `created` as an ISO time, at
  most 500 todos, else a 400 and nothing written, #352; a file saved earlier loads as it is), a new task's id is `uuidV4` (plain HTTP too,
  #236), a failed save is a toast and a re-read, and nothing can be added
  until the first read lands, so a failed read can't be saved over. The list
  is one for the whole page (`todoStore` in `utilities.js`, read through
  `useSyncExternalStore`): the rail and the Launch page show and save it,
  so neither saves a stale copy over the other's change. Each view reads on
  mount; a read is dropped when the tab changed the list since it went out,
  or a save was still out then; the list is forgotten when the last view
  goes (another page, a sign-out). Below 1440px the Overview draws none of
  the three: they are the Launch page's (the old board drew its own, #306).
- **Today's extras and the Overview's sections** (#307, spec §8 "Today's
  extras keep a home"). The weather, the clock and the web search, which the
  old header drew, are back (`src/shell/extras.js`, wired in `Utilities.jsx`):
  weather and the clock are one card (`WeatherClock`) at the top of the
  rail from 1440px and at the top of the Launch page at every width; the web
  search (`WebSearch`) is on the Launch page beside them. They read what
  Widgets had, as before (Settings → Appearance and, for the search,
  Settings → Apps & links, since #317): the weather shows when it is on and a place
  is set (`showWeather`, `weatherLat`, `weatherLon`, the city, the `units`
  setting over `/api/weather`'s Fahrenheit), the clock until `showClock` is false
  (the old header always drew it), the search until `showSearch` is false;
  the search sends the words to `searchEngine`'s results page in a new tab,
  with no opener. A card shows only what is configured, and nothing with
  neither; the rail is drawn when it has any panel. Settings → Appearance →
  Overview sections has a show/hide switch for the subsystem strip,
  Infrastructure, Power (#306), Jobs (#578), Services, the pending host steps
  (#673; drawn only with a Gitea set up and a step open, so a switch that
  changes nothing visible means there is nothing to show), the backups (#675;
  drawn only with a backup job marked or B2 set up), Config drift (#674;
  drawn only once the server has `JAGHELM_CRON_SECRET`, the same), Expiry (#676;
  drawn only with a TLS target or a Tailscale key set up) and the whole rail
  (`overviewSections` in the display config, `sectionShown`), which the
  server holds, so a section hidden on one device is hidden on the next load
  on another. The attention panel's switch is on and locked: it shows only
  when something is wrong, so it is never hidden, whatever the config says.
  With the strip off a phone
  draws the attention panel as one card. The Launch page keeps every
  utility whatever the rail's switch says.
- **Edit layout** (#330, spec §8). A mode of the Overview from 768px, turned
  on by the header's "Edit layout" toggle (`AppHeader`'s `onEditLayout`; the
  phone screens below 768px draw no sections, so they have none). Off, the
  page reads exactly as before: the mode adds only that button. On, the panel
  `OverviewEditor.jsx` (the shell's part: it holds the arrangement) draws the design system's `LayoutEditor` above the sections: it is a chunk of its own
  (`loadOverviewEditor`, asked for when the mode is entered, so no first load
  carries it), and the Overview itself reads only the stored arrangement
  (`overviewLayout.js`). Escape or Done leaves it, focus back on the toggle.
  **The arrangement** is `overviewLayout` in the display config:
  `{ order: [section ids], pinned: [service uids] }`, ids and uids in order,
  never positions, so the reflowing layout lays it out at any width. It goes
  through the same versioned save as any setting (#233, #547), with a
  stricter conflict policy than the leaf merge: `overviewLayout`,
  `customGroups`, `themes`, `nodeOrder`, `diskForecastDays`, `backupAgeHours` and the Expiry keys (#676) are `ATOMIC_KEYS` (`src/utils/rebaseConfig.js`,
  `rebaseDetailed`). Their lists can't be merged without losing one device's
  edit (a pin added here, a group renamed there), so when a save is refused
  as stale and both devices changed one, the server's value stands, this
  device's edit of it is dropped, and the toast says "Your layout changed on
  another device; your last change was not saved. It is shown as saved
  there." (not "Merged"); a key only one side changed, and every other
  setting, still merges leaf by leaf. Reset is the same edit and takes the
  same path. That a device starts from the server's copy is by construction:
  entering Edit layout reads the display config again first
  (`useConfigPersistence`'s `refreshRef`, which sends what is owed, re-reads
  and rebases) and opens only once that has settled, a read that fails leaves
  the mode off with the reason, and a tab in the mode that is focused again
  reads it again. Apart from that read, another device gets a saved
  arrangement when it next loads the page, as every setting does. The
  editor's chunk failing to load (an old tab after a deploy) says so inline
  with Reload and turns the mode off. Pins are pruned only when their service
  is really gone (`serviceGone`: the model has no such service and its node
  answered in full), never because a node is down or unread; a pin with no row
  now is listed "not shown now" so it can always be unpinned (a pin on a
  service later folded into a stack shows the same way: only a stack's lead
  can be pinned). Controls name a service with its node, and a group name that
  exists is not added twice. The schema bounds both lists and reads a value of
  any other shape as unset (`configSchema.js`), never failing a save.
  `readLayout` never throws: an
  unknown id is ignored, a section the stored order lacks (a newer build's)
  comes after the stored ones in the default order, a duplicate counts once;
  no arrangement is the default, which draws the Overview as it always was
  (`layoutValue` stores nothing for the default, so an untouched config stays
  as it was). A pinned uid whose service is gone draws nothing and is pruned
  the next time Edit layout saves. The old grid keys (`gridLayout`,
  `gridColumns`) are read by nothing, as before (`dropDeadKeys`).
  **What it edits**: the order of Infrastructure, Power, Jobs, Services, the
  pending host steps, Config drift and Expiry (Needs attention and the strip always come first, the rail sits beside
  them: the incident-first order is not an arrangement); each section's
  show/hide switch, which is `overviewSections.<id>`, the very key Settings →
  Appearance → Overview sections edits, so either place changes both;
  services **pinned** to the top of the Services section (`withPinned`: a
  group titled "Pinned", in pin order, out of the group they would have been
  in; a pinned stack is its lead's row, still one row); and **groups**,
  which are the custom groups of Settings → Nodes & Services (`customGroups`,
  #517, #574), not a second concept: Edit layout adds one by name and puts a
  service in it (a service held through a bare container name can only be
  moved in Settings), after which the section groups by group. Hiding a
  section never hides an alert: Needs attention and the header read the
  model, not the sections. Spec §8 says "hide sections and services", but only sections can be hidden: a service stays in the list so a failing one can never be hidden. Every move has a keyboard way (Move up / Move
  down, focus staying on the moved row's button) and a polite live-region
  announcement; dragging a row's grip (pointer events) makes the same move.
- **No signal: a stale status** (#480, #495). The poll's status is stale
  when `reach` isn't `ok` once the first answer is in: a failed poll
  (`down`), or a 503 (`waiting`), which the server answers once its status
  is past the cache's TTL (`/api/status`, 4.7); or when its last answer is
  older than `updated.staleAfter`, two poll intervals and the request
  timeout (`staleAfterMs`, the client's one rule for how old an answer may
  get, `src/shell/freshness.js`, #559, from the interval and
  `REQUEST_TIMEOUT_MS` in `useData.js`: 72 s at the default 30 s, 252 s at
  120 s). That second rule is for a hidden tab or a sleeping laptop, which
  ask nothing and leave `reach` at `ok`: the first render after the tab is
  shown again is grey, before the poll's answer comes. While fresh nothing
  ticks: the one clock (`src/ui/lib/clock.js`) waits for that boundary with
  one timer, for every place and every other judge, re-armed on each answer,
  and moves at once as the tab is shown again (a `visibilitychange` to
  visible, on the window in the capture phase, before anything re-renders)
  or as the machine wakes (its overdue timer fires). The Overview's
  sections' notes judge their own answers by the same rule on the same clock
  ("Polling and the request budget" below). `useStatus` keeps the last
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
  screen ticks on the same one clock (`useAgo`, `src/ui/lib/ago.js`), so the
  header and the panel never read a second apart; it ticks at once as the tab
  is shown again, and nothing ticks for the status while it is fresh. The
  header's live region says "No signal" and why, never the moving age. A
  lamp drawn as no signal beside a last known word ("Healthy", "Down") is
  named "No signal", not by that word (`lampName`, `src/ui/lib/status.js`),
  and a tile's or a row's name says it before the word.
  The answer that brings a status back restores every colour in its render.
- **State.** `ConfigContext` exposes `config`, the stable `setConfig`, and a
  memoised `update(path, value)` built on `setIn` (immutable structural-sharing
  deep-set) -- so leaf cards memoise and don't re-render on unrelated edits.
  `OverlayContext` provides `useToast` / `useConfirm` (focus-trapped, Escape,
  focus-restore, reduced-motion). `api/client.js` `apiFetch` injects the auth
  token explicitly (replacing an old `window.fetch` monkey-patch).
- **Guided first run** (#322, spec §8). A first boot (no `services.yaml`,
  `firstBoot.js`) leaves a `setup-pending` marker in the data dir
  (`server/setup.js`); `GET /api/setup` says whether it is there and
  `POST /api/setup/done` removes it, for every device, so it survives a
  restart and an upgrade never shows it. `useSetup` asks once when the app
  opens (not in the read-only demo), and while the answer is pending the
  Overview's address draws `firstRun/SetupWizard.jsx`, its own chunk, in
  the Overview's place (the Overview stays mounted behind it); every other
  page stays reachable. It is a path through Settings' own pieces, not forms
  of its own: Connect Prometheus and Kuma and NUT are Settings → Sources'
  rows (`sourceRows`, `SourceList`), Pick nodes is the Nodes editor
  (`NodesTab`, through `useServerConfig`), and Integrations is the
  Integrations section. The sources' addresses are `.env`, which the app
  doesn't write, so those steps show the live state and say what to set.
  While the first boot still waits for a node (`discovery: 'waiting'`) the
  steps save nothing, since a save writes `services.yaml` and ends the wait,
  and Integrations opens once a node is in. Finish and Skip are the same
  call. A source that is not set up draws no panel anywhere (spec §8): the
  status model lists only the sources that are, and the strip, Power, Jobs
  and Backups follow it (`src/App.setup.test.jsx`).
- **Units and locale** (#322, #260). Two display-config keys: `units`, `metric` (the default, °C) or `imperial` (°F), and
  `locale`, a BCP 47 tag or empty for the browser's own. Settings →
  Appearance sets them. `util/format.js` is the one module that prints a
  date, a time or a temperature: `App.jsx` hands it the config on each
  render (`setFormatting`), it builds `Intl.DateTimeFormat`s on use, kept
  per locale and options, so no file names `en-US` or a unit. A fresh install
  (`defaultConfig.js`) is metric. An existing install keeps what it drew:
  `server/displayUnits.js` runs once at boot and, for a display-config.json
  with no `units`, saves `imperial` (a stored `tempUnit` of C: `metric`);
  one with `units`, no file, or a file that doesn't parse is left alone. A
  config still without `units` (an old copy in a browser) reads by the same
  rule (`unitsFromConfig`), and a saved `tempUnit` becomes `units` on load
  (`dropDeadKeys`). The step headings of the guided setup take focus and are
  announced. The
  weather asks open-meteo in Fahrenheit and prints by `units`; the status
  model's temperatures, reasons and push text stay °C until #494 serves
  the unit with `/api/status`.
- **First run, no node yet** (#566, #571). On a first boot with no node yet (none in
  `/api/services` nor in the model), `OverviewBoard` draws a panel where the
  nodes will be: while the server asks Prometheus for nodes each refresh
  (`discovery: 'waiting'`, 6) it is "Waiting for your first node", which
  says they appear on their own and offers no way to Settings, where a save
  would end the wait; otherwise "Connect your first node", with how to add
  one and Open Settings. The grid board it replaced (HelmGrid, its drag and
  resize, its saved layouts) went in #306: the Overview reflows with its
  content, and arranging came back as Edit layout (#330, above). Its
  saved keys (`gridLayout`, `gridColumns`, `showCronJobs`, Typography's
  `fontSizes`, the UPS panel's `sections.ups`, the panels' titles, icons and
  colours) are read by nothing; a UPS panel switched off becomes the Power
  section switched off, unless that is set:
  `dropDeadKeys` (`overviewSections.js`) leaves them out of every copy
  `useConfigPersistence` reads, so a load sends nothing and the next save
  goes without them; a layout kept in one browser can't overwrite another's
  (#233). services.yaml's `grid_layout` and `grid_columns` are among the
  keys the server warns it doesn't read (6).
- **Data fetching.** `useDashboardData` holds a **304-stable identity contract**:
  on an unchanged poll `fetchJson` returns the same reference and `setState`
  bails via `Object.is`, so an all-304 tick triggers zero re-renders. It stores
  a response's ETag and body together, only once the body has parsed, so the
  `If-None-Match` it sends always describes the body a 304 hands back; a 200
  with an empty, malformed or cut-off body fails and keeps the last good pair.
  Per-source health (error / stale / retry) is derived at render without
  per-tick state.
- **Phase-locked polling** (#630). The server's loop builds the status and
  the services once a cycle, so a browser on its own 30 s timer saw data up
  to two intervals old (the cycle's phase, then its own). `/api/status` and
  `/api/services` therefore send `X-Next-Refresh-Ms`: the ms until the next
  cycle should have finished (`server/refresh.js`, `nextRefreshHintMs`: the
  next cycle's start, or the running one's, plus the last cycle's length and
  250 ms (2 s assumed before any cycle has finished), held to 1 s .. 2 x the
  interval, and past the expected end growing with the overrun, up to the
  interval, so a slow or wedged loop is not asked about every second; set
  on the 304 too, exposed to
  CORS, absent when no loop runs). A duration, never a time, so the
  browser's clock can't skew it. `src/pollSchedule.js` times the status poll
  (`useStatus`) and the tick (`App.jsx`) from the newest hint, plus up to
  250 ms of jitter; with no usable hint (an older server,
  a garbled or spent one) they keep the fixed interval, and a hint arriving
  re-times a wait that had none, once. Short hints in a row back off, each
  wait twice the last up to the interval, and the tick doesn't follow a short
  hint at all. The Settings → System → Data refresh slider
  governs both: a save that changes it restarts the loop at the new
  interval (`restartBackgroundRefresh`), and the hint follows. The tick
  count, the ETag/304 contract and the pause in a hidden tab are as below.
- **Polling and the request budget** (spec §4, #306). `App.jsx` drives one
  tick per refresh interval (30 s by default), and only while the Overview
  is on screen, or from 768px the Services or Infrastructure page (#313): a
  hidden browser tab, or any other page, pauses it, and returning refreshes
  every source at once. On those two pages the page reads, and the
  Overview's board (mounted, out of sight) reads nothing: the Services page
  `/api/services` and `/api/integrations` each tick, the Infrastructure page
  those and `/api/history` one tick in three, as the Overview does, so
  either stays within the budget below. A tick costs a tab at most 4
  requests (`tickBudget.js`): the header's `/api/status` (on every page,
  paused only while the browser tab is hidden), `/api/services` and
  `/api/integrations` (`useDashboardData`, for `OverviewBoard`), and one
  slow read in turn: `/api/history` (every node's hour of CPU, #311; a new
  answer exists once a minute, so it is often a 304) on ticks 1, 4, 7 …, the rail's Pipeline
  (`/api/gitea/activity`, from 1440px) on ticks 2, 5, 8 …, and the rail's
  weather (`/api/weather`) on ticks 3, 6, 9 … once its 10 minutes are up,
  never two. One exception: an open node or container drawer's history
  read, at most once a minute on a status answer (#311), and the same read
  of a node's or a container's sheet on a phone (#602), never of a sheet
  another covers; its recent errors (`/api/logs`, #672) are read the same way,
  once a minute at most. The other: `/api/disk-forecast` (#670), read when the
  Infrastructure section or the phone's Infra tab draws and every 30 minutes
  after, on its own clock, not while the tab is hidden. And the pending host
  steps (`/api/host-actions`, #673), read when the Overview (or the phone's)
  draws them and every 5 minutes after, on their own clock, not while the tab
  is hidden, so a tick can cost a 5th request once in 5 minutes. The Backups
  section (`/api/backups`, #675) keeps the same terms, and so does the
  config drift row (`/api/drift`, #674). And the Expiry list (`/api/expiry`,
  #676), read when drawn and every 30 minutes after on its own clock (every 3
  seconds, ten times at most, while a newly added target is still checking). The
  old board's `/api/ups` and `/api/cron/status` went with it: the model
  carries the UPS and the jobs. One more exception, only while the Monitoring
  page is open (#751): `/api/monitoring`, once the range's step has passed, on
  a status answer (at most once a minute; the page is not the Overview, so the
  board's tick does not run behind it). CI holds it (`src/App.polling.test.jsx`,
  over 45 ticks with the weather on, and `e2e/budgets.spec.mjs` on the built
  app, the weather on, a hidden tab asking nothing; the Monitoring page's
  reads are counted in the first, with its route shown, and the second checks
  that while it is hidden a visit asks nothing).
  An open detail adds none of these (it takes the page's answers), its own
  reads only where the page doesn't read them ("The detail drawer's
  content" above), and none while closed. A
  section shows its "updated ... ago" note once its source's last answer is
  stale by the header's rule (`staleAfterMs`, `src/shell/freshness.js`: two
  polls and the request timeout, 72 s at 30 s) on the header's clock
  (#559): `useDashboardData` watches each source's boundary on the one clock
  and reads its last answer then, so for the same answer time the note and
  the header's No signal come at the same moment, a source that answers
  every poll never shows one, and a note clears as soon as its source
  answers again, a 304 too (#545). While it shows, its age moves on the same
  clock. Out of sight (another page, a hidden tab) the board watches no
  boundary and its notes tick nothing, so it renders nothing there; the
  render that brings it back judges at once. A hidden tab or a sleeping
  laptop is no excuse, for the notes as
  for the header: shown again or awake, both are stale until the answers.
  Time the Overview spent on another page with the tab showing is excused:
  it asked nothing while the header's poll went on, so back, a source's
  silence counts from then, unless it is failing. The utilities (#301) read only
  while drawn and the browser tab shows: Pipeline `/api/gitea/activity` on
  its ticks (above) in the rail, and on the Launch page on its own clock,
  every third interval (90 s at
  30 s), with the last ETag; the Checklist reads `/api/todos` once when it
  is drawn; the weather (#307) `/api/weather` when it is drawn (unless the
  page read it in the last 10 minutes), then every 10 minutes, a failed read
  again a minute later (in the rail, on its ticks once due; on the Launch
  page, on its own clock), and nothing while it is configured off. The
  Alerts page and the phone's Alerts tab ask `/api/events` once as they
  open, and again on each answer of the header's poll (#314): 2 requests a
  tick on the Alerts page, 3 on the phone's tab (with `/api/services`).
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
  - **Before an app is saved** (#362): Settings → Apps & links' add form
    sends `POST /api/embed-check` with `{ url, origin }`: the same fetch, rules,
    cache (keyed by the address, apart from tab ids) and read limit, for an
    address typed into the form, still never sending a cookie. The form says
    the answer before saving: an app that embeds is added at once; one that
    blocks, or could not be read, waits for "Open in a new tab instead", "Add
    it inside JagHelm anyway" or "Back to edit". The apps list asks the same
    for each framed app, as the saved-tab check (`GET /api/embed-check/:tabId`,
    the cache the frames share), and POST only for an address that is not saved.
    "Add it inside JagHelm anyway" saves `embedAnyway: true` on the tab: its
    frame is drawn even when the check says it blocks, with a dismissible note
    saying the site asks not to be embedded (`useEmbedStatus`, `IframeView`).
    The blocked panel in the app view offers the same choice (#445): "Show it
    anyway" writes `embedAnyway: true` on that tab through the config (App's
    `setEmbedAnyway`, saved like any edit), so it holds across reloads; the
    note's "Stop showing it anyway" and Settings → Apps & links' per-app switch
    (the row says "shown anyway") remove it. Nothing is forced: the frame is
    only drawn, and the browser still refuses it if the site really blocks it,
    which the note says. `frame-ancestors` matching follows browsers' upgrade of
    an `http:` source: `http://host:80` names an https JagHelm on `host`'s
    default port, and no other port is widened. Known gap, not changed here:
    a source's path is ignored, so `http://host:80/path` reads as matching where
    browsers would not match it.
    An app with `newTab: true` (its `icon` is optional
    too) opens in a new browser tab: the sidebar and the palette link to its
    address, and it never gets a frame.
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
  dark and light; Settings → Appearance offers all three (the command
  palette no longer does, #315). The choice is kept per browser (`prefs`, `jaghelm-theme`). **Settings
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
- **Custom themes (#331).** Themes as validated data: the display config's
  `themes` (a list of `{ id, name, base, tokens }`, at most 8; Settings →
  Appearance → Custom themes pastes or uploads one). `server/themes.js`
  validates (`validateTheme`, `validateThemes`, `themesSaveError`): strict
  colour parser (`#hex` and `oklch()` only, rewritten from the numbers read),
  known token names, bounded strings, then the contrast rules of #283 run over
  the theme laid on its base (`server/uiContrast.js`, the code
  `scripts/ui-contrast.mjs` re-exports; `server/themeBases.js` is `tokens.css`
  as data, generated by `scripts/theme-bases.mjs`). It runs in the browser
  when the config loads (`src/shell/customTheme.js`, fetching the validator
  through `lazyViews.js` only when a custom theme is chosen; Settings has it in
  its chunk) and in `routes/displayConfig.js` when a save adds or changes a
  theme (400, naming the pairing; a theme already on disk passes through so a
  bad one can be removed). The choice is per browser (`custom:<base>:<id>`,
  `theme.js`); the shell gives every `.jh-ui` root the validated colours as
  `themeVars`, set as custom properties on its `style` and copied by portal
  roots (`ui/root.jsx`, `ui/lib/portal.js`). Failing, missing or not-yet-loaded
  themes draw as their base. `themes` is an atomic key of `rebaseConfig` (server copy wins on a stale save, with a toast); a 4xx refusal of a save carries the server's reason to the toast and is not retried until the config changes (`useConfigPersistence`). See [design-system.md](design-system.md), "Themes".
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

### 5.1 UI stack (Tailwind CSS v4, shadcn/ui, Lucide)

The overhaul (spec `docs/superpowers/specs/2026-10-18-jaghelm-overhaul-design.md`,
§5) rebuilds the screens on one component library in `src/ui/`. Until the last
old screen goes, the new stack sits beside today's CSS and must not restyle it.

- **Toolchain.** Tailwind CSS v4 compiles at build time through `@tailwindcss/vite`
  in `vite.config.js`, into the app's one hashed stylesheet. Nothing is injected at runtime or loaded from a CDN.
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
  components (#287), and the
  shell (#296), the first screen built on them. The component gallery shows each in every state
  ([GALLERY.md](GALLERY.md), #289). The
  interactive controls and containers are built on Base UI primitives. A
  screen's root is a `UiRoot` (`src/ui/root.jsx`), which carries its switches
  to every portal; roots can nest, and a page has one toast viewport. Screens
  import the components, never `@base-ui/react` itself
  (`scripts/ui-stack.test.mjs`).
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
  one `import()` in `src/` outside `src/lazyViews.js` (`lazy-views.test.mjs`).
- **First paint is four scripts** (#444): the entry, Rolldown's runtime,
  `vendor-react`, and `shared`, every module first paint loads that a lazy
  chunk (Settings, the floating layer) also needs (`vite.config.js`), rather
  than a small chunk per set of chunks sharing them. `scripts/first-load.mjs`
  builds and adds up the first screen's download against spec §4's two
  budgets: 230 KB for the scripts, styles and page (the logo with them) and
  60 KB for the faces, at 1440 and at 390px, and exits 1 when either is over
  at either width: CI's `check` job runs it as a gate (#306).
  `e2e/first-load.spec.mjs` checks it counts what a browser fetches, and
  `e2e/budgets.spec.mjs` the faces on the built app (no old screen's face,
  no latin-ext file for latin text, the active face's one for "Łódź"). It
  reports a phone's first screen too (#303): the same page, plus the phone
  screens' chunk and what it imports (`--phone`), which the same spec checks
  at 390px; and, apart
  and in no total, what a phone fetches once the browser is idle after that,
  the detail screens' chunk (#309, `PHONE_IDLE_CHUNK`), and at either width
  the command palette's index (#611, `PALETTE_IDLE_CHUNK`). A desktop's first
  screen counts the Jobs section's and the utilities rail's chunks and what
  they import (`DESKTOP_CHUNKS`, #578, #532), which a phone's never loads.
- **The phone screens** (#303, spec §8 "Phone width"): the screens (Overview,
  Services, Infra, Alerts, and the service, node and incident details), the
  components they draw and the logic they need (`board.js`, `derive.js`,
  `groupByDay.js`, `useNavStack.js`, `issueRoute.js`) are in `src/phone/`, and
  the web below 768px draws them. A screen imports no platform. It gets the
  poll, the navigation stack and the entry's params as props (`data`, `nav`,
  `params`), and the rest from the `PhonePlatform` around it
  (`src/phone/platform.js`): today only `openTarget`, what Open does. A screen
  drawn outside a `PhonePlatform` throws, and so does a `PhonePlatform` whose
  value has no `openTarget` function, as it mounts. Alerts (#314) shows Active
  and History with one set of filters, as the web's Alerts page does (the
  severity chips, then the search with the kind as a Select beside it, two
  lines at 390px), reading `/api/events` through the shared `useAlertHistory`
  (`getEvents` in `useData.js`) and the status poll's `updated`
  (`data.updated`); the filters are kept in the address. A history row opens
  the detail its entity's kind opens (`entityRoute`: a service's, a node's,
  else the incident's), as every row does. `scripts/phone-imports.test.mjs`
  fails on an import in `src/phone/` (`import`, `export … from`, `import()` or
  `import.meta.glob()`) of a native plugin (`@capacitor*/`, `@capawesome*/`,
  `@capgo/`, `capacitor-`, `cordova-plugin-`) or of `@shared/` (a retired alias
  for `src/`), and on a glob that is root-relative or not written out. The
  screens draw the `src/ui/` look (design-system.md, "Phone screens");
  `src/ui/tailwind.css` scans `src/phone/**/*.jsx` for classes, and the screens'
  tests are beside them (`src/phone/*.test.jsx`). `scripts/phone-no-severity.test.mjs`
  holds them to judging no state of their own (ADR 0006).
- **The phone screens on the web** (#303, spec §7, §8 "Phone width"). Below
  768px `App.jsx` draws `src/shell/PhoneView.jsx` (its own chunk, loaded only
  there: `loadPhoneView`; the detail screens a chunk of their own,
  `PhoneDetail.jsx`, so the desktop's detail drawer shares their parts
  without a phone's first load fetching them, #309: asked for once the
  browser is idle after the screens draw, and at once beside them when the
  URL names an entity as the app starts, `preloadPhoneDetail.js`; until it
  is in, a sheet has its Back, focused, and "Loading…", `DetailLoading`) in
  the page, under the header and above the tabs,
  in place of the desktop Overview and the Alerts page:
  Overview on `/`, Services on `/services`, Infrastructure on
  `/infrastructure`, Alerts on `/alerts`. It gives the screens what
  the phone shell needs, from the web's own parts
  (`phoneData.js`): the header's poll (`useStatus`: the status, its reach and
  clock), judged fresh or stale by the one rule (`useStatusFreshness`), and
  the cards, read by `useDashboardData` with `only: ['services']` (a tick
  costs that and the status, nothing more; the model carries the
  UPS's runtime, #549, and its load, model and runtime on mains, #586, and
  the web's own server always does, so neither its phone screens nor the
  UPS's sheet need `/api/ups`),
  on the tick the Overview's interval runs while a phone tab is on screen.
  The screens judge nothing: they draw the model through `board.js`, and the cross-client suite holds
  their words to the model (`src/phone/crossClient.test.jsx`). The navigation is the shared nav stack
  (`useNavStack`) with the browser's history (`phoneNav.js`): a pushed detail
  is a history entry under its entity's URL ("Entity URLs" above, #309), the
  details under it kept in `history.state`, so Back closes it, Forward opens
  it again and a reload draws it again; an entry whose URL names an entity it
  holds no stack for (a link, a resize from the desktop's drawer) draws that
  entity's detail alone. A detail's own Back goes back in the history, or,
  opened from its URL, leaves the tab's URL. Each
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
  have "no longer monitored", and with nothing to read it says why ("No
  signal", or the cards' read failing). Incident detail shows any entity the
  model has, an issue or not (an entity URL opens the UPS on mains, a job
  that ran), without "Active"; a failed source no longer listed has
  "resolved". The sheets show what the desktop's drawer
  shows (#310, "The detail drawer's content" in 5): `PhoneDetail.jsx` gives
  the screen its entity's extras (`data.extras`) from the reads the sheet on
  top makes.
  A node's sheet and a container's also draw the drawer's history charts
  (#602), as the screen's `charts`, for the drawer's target
  (`entityDetail.js` `chartTarget`): `HistoryCharts` at `size="touch"`
  (the range switch's segments 44px targets), under the status box, as in
  the drawer. One chart a row on
  one time axis, the same legend, end labels and failure states as the
  drawer; by touch a finger shows the crosshair, a sideways drag moves it,
  lifting hides it. A sheet another covers reads none (`paused`) until it is
  on top again. A server from before #311 has an `/api/history` is the ring buffer's (number lists keyed `<node>:cpu`,
  `:mem` and `:disk`, or `{}` before its first sample): its first such
  answer marks that server old for the session (`useHistory.js`, by API
  base), so no sheet draws charts, says an error or asks it again until a
  reload. An answer of neither shape is a failed read ("Not an answer of
  /api/history"), asked again as one.
  `PhonePlatform`'s `openTarget`
  on the web opens a service's address (`safeUrl`: http, https, mailto) as
  the web's links open, a new tab or this one (Settings → Apps & links,
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
  (`global.css` and `fonts.css`). The new stack's rules therefore
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
  Chrome or Edge 118, Safari 17.4 or Firefox 146. In an older browser new components lose the reset, and today's
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
  `--text-*`, `--font-mono`, `--font-body` and `--font-display` there, and the prefix keeps an old widget inside a new screen on its
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
  `src/styles/fonts.css`: JetBrains Mono's latin file, which the old
  `--font-mono` names. The Clean, Rounded, Sharp and System font presets and
  their faces (Inter, Fira Code, Nunito, Source Code Pro, Rajdhani, Roboto,
  Roboto Mono) went with the dead Font family cards (#660). The new UI's faces are in `src/ui/fonts.css` (Manrope by default, Plus
  Jakarta Sans or Montserrat by `data-typeface`, JetBrains Mono), under family
  names ending in "Variable" so they never join today's families; JetBrains
  Mono's latin file is shared, so it downloads once. Each new face is a latin
  and a latin-ext file with Google's `unicode-range`, so the latin-ext file
  downloads only for text that needs it, such as "Łódź" (#394); today's mono
  file is latin only. A browser downloads a face only when text renders in it, and
  nothing is preloaded, so a default user never downloads Plus Jakarta Sans or
  Montserrat; Settings → Appearance's Font family cards draw each in its own
  face, so opening that page downloads the other two. The choice is the display
  config's `typeface` (`appearanceOf`, `src/shell/appearance.js`): the shell
  sets `data-typeface` on every `.jh-ui` root, portals included, like the accent
  and density. A config's old `fontFamily` is read once, only while it has no
  `typeface` (every old preset maps to Manrope), and is ignored after. The old
  `--font-display`, `--font-body` and `--font-mono` variables, which the
  remaining old widgets still read, follow the chosen face
  (`useThemeVars.js`). `scripts/fonts.test.mjs` checks that every `@font-face`
  matches its file and licence and each file its pinned sha256, that nothing
  names Google Fonts or loads a font or stylesheet from elsewhere, that "Łódź"
  draws in each new face from its latin-ext file while latin text never needs
  it, and the new UI's 60 KB budget;
  [design-system.md](design-system.md#type) has the faces and the scale.
- **When the old CSS is gone,** drop the `legacy` layer and the scoping: import
  Tailwind's own preflight, move the tokens to `:root` and drop `reference`.
  Delete `src/styles/fonts.css`; the eight files in `src/fonts/` (the new UI's
  four faces, latin and latin-ext) all stay.

## 6. Data model

All state is files under the data dir (no DB):

- **services.yaml** -- nodes, per-service overrides (display name, icon, and
  the Kuma monitor mapping `monitor` / `monitor_per_node`, see 4.2; each of
  `display_name`, `icon` and `monitor` also has a `_per_node` map keyed by node) and
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
  - **Find nodes** (#572, `findNodes.js`) is the way back for a file with no
    nodes (a Settings save during the first boot's wait, or one written by
    hand): Settings → Nodes & Services has a Find nodes button (in `NodesTab`, so the
    guided first run has it too, except while the first boot still waits for nodes
    with no file: its "Waiting for your first node" panel shows then, and
    a saved file with no nodes shows `NodesTab`) that sends `POST /api/services/nodes/find`
    (behind auth, 10 a minute per IP; the demo refuses it like every POST, so
    its button answers "No new nodes" without asking). The route runs the
    first boot's own `discoverNodes()` and answers `{ nodes }`, the ones the
    file lacks in the shape `generateDefaultConfig` gives (key = the
    Prometheus `node` label; from the `instance` fallback the host part, with
    no port or ':' (`util/nodeKeys.js`), `-2`, `-3` on a clash, and
    `prometheus_node` the real label, which a first boot does the same).
    A label counts as present when a node is keyed by it or by its host key
    (naming no other node), or has it as `prometheus_node`, hidden nodes
    included. A save adding a node key with a ':' is a 400 (a key the file
    has is left as it is, and loading warns once); with no Prometheus set up
    the route answers 502 `prometheus_unset` ("No Prometheus is set up"). It writes nothing: on Add the tab saves the whole config
    with those nodes added, through the ordinary save over the version it
    read (a moved file is the usual 409 and reload). It never removes,
    renames or edits a node. Prometheus that can't be asked is a 502 with
    the sentence of `failureWords.js`; none new is "No new nodes".
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
    Settings → Nodes & Services reads the config, changes it and posts all of it
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
  - **Settings sends the version.** Settings → Nodes & Services sends each
    save with the version its config was read at (`serverConfig.js`), one save at a time, so
    each sends the version the last one answered. A 409 for the version shows
    "Settings changed elsewhere; reloaded"; any other refusal (a 428 too)
    shows the server's reason. Either way Settings reads the config again,
    and the edits made on the screen it replaces are dropped, not sent: one
    that would have gone out from it says "Not saved: an earlier change on
    this screen was refused". A read that fails shows why in place of
    Nodes and Services, never the old or edited config. The version and the
    save queue are the app's, not the section's (#501): leaving the section
    (for another, or another page) sends the pending save at once, opening it
    reads the config again, and reads go out in
    the same queue as saves, so a read never answers a version a save has
    already replaced. A read that answers after an edit it didn't see
    leaves the screen and its version alone; a change made elsewhere then
    refuses that edit's save (409). A save or read with no answer in 15 s
    fails (`AbortSignal.timeout`), so a hung one can't hold up the queue; a
    timed-out save may have landed, so the config is read again before the
    next save. While a save is waiting or on its way, closing the browser
    tab asks first (`beforeunload`). The integration form doesn't post the
    config, 
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
- **thresholds** -- `thresholds.json` (#320): the threshold lines Settings →
  Notifications saved, only the metrics away from their defaults, each with
  its unit (`{ "disk": { "warn": 88, "crit": 94, "unit": "%" } }`). Saved by
  `PUT /api/thresholds` over the version read (an HMAC of its bytes with the
  config version key, as below; a missing file's is `absent`), atomically;
  read by the refresh loop every cycle (4.7, "The threshold config").
- **push tokens** -- `push-tokens.json`: retired with the Android app (#659). Nothing
  writes it; at boot its FCM token records are dropped and what is left (nothing,
  normally) is written back (4.7, "Push": the Android app's device records).
- **push subscriptions** -- `push-subscriptions.json` (mode 0600): each
  browser's Web Push subscription (endpoint, keys, name, times, prefs, last
  delivery and failure) by id, at most 20 (#653, 4.7 "Push": Web Push). The
  endpoint and keys are capabilities and never leave it but to the sender.
- **Web Push key pair** -- `vapid-keys.json` (mode 0600): JagHelm's own VAPID
  pair, made at the first boot with `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`
  unset (#698, 4.7 "Push": the key pair). Keep it in backups: losing it means
  every browser turns alerts on again.
- **secrets** -- AES-256-GCM blob and the origins it may be sent to (#556),
  keyed by name (`integration_<key>_<field>` for a Settings save).
- **config version key** -- `config-version.key`: 32 random bytes (mode 0600)
  that the versions of `services.yaml` (#423), `display-config.json`
  (#547) and `thresholds.json` (#320) are HMACs with (`util/fileVersion.js`,
  above). Made on first
  start by a temp file linked into place, so two boots racing end up with one
  key. Never logged or answered. One that can't be read or isn't 32 bytes
  stops the boot (a key made up for one run would change every version at
  the next restart). Losing it costs one refused save per open screen: a new
  key is made and every version changes once.
- **Arcane state** -- in `push-snapshot.json` under `producers` since #581, written with
  the pushes it notified (4.7 "Push"): `arcane` (`state`: baselined environments, agent
  down counters, seen activity ids, each environment's pending updates, runs waiting on
  their job run, last notified release; `heldBack`: held-back containers per environment)
  and `arcane-vulns` (`vulns`: each environment's critical/high findings, as repository and
  a short hash of id and package, KEV count and stale or failed images at the last
  vulnerability digest, and when it last ran), each with `savedAt`; tolerant load. The
  `arcane-state.json`, `arcane-held-back.json` and `arcane-vuln-state.json` of an older
  JagHelm are read at the first start with #581, and again only when written after
  `savedAt` (a rollback ran meanwhile); left in place.
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
    T["test gate<br/>node:test + Vitest + typecheck + audit (as check.yml)"] --> B["build image<br/>:latest, :sha-short"]
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
  format (the CHANGELOG and its `changes/` fragments), lint, typecheck,
  server and web tests, the asset check, and the same
  `npm audit --audit-level=high` that the image build runs
  (#616; `scripts/ci-audit.sh` says whether a failure was an advisory or the
  registry, and `scripts/ci-workflows.test.mjs` keeps the two commands equal).
  A new advisory turns every open PR red at once, by design: merge one
  dependency PR first, then re-run the others. Its `gallery` job, beside
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
  case, one push per failed source, the model's reason in every push, the Web Push
  payload), backups and Arcane agents end to end (the
  display config and the poller through the loop to `/api/status`), every
  Arcane push pinned as a snapshot (`server/arcane/pushContent.test.js`),
  `/api/status` and its ETag, contract tests
  that freeze `/api/services`, `/api/ups` and `/api/cron/status`
  (`server/routes/contract.test.js`), the first-load budget gate
  (`scripts/first-load.test.mjs`: it exits 1 on a build over either budget),
  the service-worker precache injector, and the worker's install,
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
  Forward; `src/App.entity.test.jsx`: each kind of entity's URL opening the
  drawer from 768px and the phone's sheet below it, a reload, Back, Escape,
  focus back on the row, an id the model has nothing by, and every kind of row
  opening its entity, #309, and what a detail reads while open and shows, the
  drawer's and the sheet's, #310; `src/shell/detail/EntityDetail.test.jsx`:
  each kind's facts, sections and links from fixtures the model judges, #310;
  `src/shell/detail/useDetailSources.test.jsx`: the reads as it opens, on
  each status answer while open, the page's answer taken, none closed, a
  failed read kept, one in flight dropped when it closes, a job's runs only
  as it opens and when it reports again;
  `src/ui/chart.test.jsx` and `src/ui/lib/chart.test.jsx`: the Chart's
  slots, dashes past three series, end labels, axes, gaps, crosshair,
  keyboard and states, and its geometry, #311;
  `src/shell/detail/HistoryCharts.test.jsx`: a node's and a container's
  charts from the demo's /api/history, one request each, the range switch,
  reads paced by the step, Prometheus failing and a failed read, #311; no
  axis printing two equal labels (a sweep over °C, % and MB or GB, and as
  drawn), an older server, an answer of neither shape, a covered sheet, #602;
  `server/promHistory.test.js`, `server/routes/history.test.js` and
  `history.auth.test.js`: the 400s and 404s (an unseen container among
  them, with no query and no cache entry), the queries, the cache within a
  step, the ETag and 304, Prometheus failing in a fixed sentence logged
  once, the 401, #311;
  `e2e/history.spec.mjs`: the drawer's charts for a node and a container on
  the demo, the range switch, the crosshair, the node cards' line, axe, #311;
  and at 390px a node's and a container's sheet, one chart a row on one
  time axis, the 44px switch, the crosshair by touch, axe, #602;
  `src/shell/PhoneDetail.history.test.jsx`: the web sheet's charts under the
  status box, one request, none for a covered sheet or an entity with
  nothing to chart; a server older than #311: no charts, no error, asked once a
  session, #602;
  `src/App.jobs.test.jsx`: the Jobs section after Infrastructure from the
  status alone, its filter and switch, a row opening its drawer, Remove
  asking first, calling the old panel's endpoint, the row gone and focus on
  the next, a failed Remove saying why, and the phone's list and sheet, #578;
  `src/shell/detail/detailLinks.test.jsx`: links by exact name, an ambiguous
  name none, one per node named for its node;
  `src/App.palette.test.jsx`: each kind of result the command palette finds
  (a service, a node, the UPS, a job, a backup, an integration, an issue, a
  Settings section, a page, an app, a Quick Launch link) opening where it
  should, and no themes, #315;
  `src/shell/ShellHeader.test.jsx`: each state of the header, and a
  render count proving the "updated" tick re-renders nothing else), the rule
  for a stale status (`src/shell/statusFreshness.test.jsx`: the hook, its
  words, its one clock, and the age boundary, to the ms and after a tab
  shown hours later; `src/shell/freshness.test.jsx`, #559: the header and
  the sections' notes stale together at every clock phase for the same
  answer time, through a sleep and a hidden tab, and fresh together on the
  answers, and `src/ui/lib/clock.test.jsx`, the one clock;
  `src/demo.render.test.jsx`, "No signal": no level
  colour in the header, the panel, the strip, the Infrastructure section or
  the Services section,
  no lamp named by a level word, one age everywhere, a tab shown hours
  later grey before its answer, with the Infrastructure section's note, and
  every colour back and the note gone with the next answers), the status
  poll's and the tick's request budget, at most 4 a tick with the rail's
  Pipeline counted (`src/App.polling.test.jsx`, #306), the Overview's
  sections, first run, filter note and a healthy tick re-rendering no
  section (`src/shell/OverviewBoard.test.jsx`, #252), the loaded-app cap
  (`src/hooks/useAppFrames.test.jsx`), the Infrastructure section's nodes
  against the model's fixtures (`src/shell/infrastructureView.test.jsx`) and
  on the demo (`src/demo.render.test.jsx`), the Services section's rows,
  groups and count against the model's fixtures
  (`src/shell/servicesView.test.jsx`) and on the demo, the old board's saved
  keys read by nothing and never sent on a load
  (`useConfigPersistence.version.test.jsx`, #306, #233), and the `src/ui/`
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
  status components (`src/ui/crossClient.test.jsx`, in `test:client`) and the
  same screens below 768px (`src/phone/crossClient.test.jsx`, #303): every
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
  the status and the sections of the Overview. The Overview's status (#297): in
  the incident, the issue count and every issue row are on screen without
  scrolling (inside the window, under the header, above the phone's tabs);
  healthy, the quiet line, with no red, amber or green in the status area but
  its 10px lamps, the line's and the strip's (every colour each element
  draws, read in OKLCH); and an
  issue row, clicked or by Enter, opens its entity's detail over the page
  (#309); it is a link to the entity's URL, and a click dispatched with
  Ctrl, Meta, Shift, Alt or the middle
  button is neither cancelled nor moves focus or the scroll, while a plain one
  through the same dispatch does (#515: no real new tab, which tested
  Chromium, not JagHelm). The subsystem strip (#298): on
  screen under the status without scrolling, a tile per subsystem the model
  has anything in, nothing in a tile cut off and no sideways scroll; a tile, clicked or by Space and Enter (its focus ring showing),
  filters the rows and the sections and back, Back and Forward follow the
  URL, and a filter whose section is switched off says so; the Power tile
  keeps the UPS's row, on mains, which opens its detail with its charge,
  runtime, load and model (#306); axe on the filtered status, the Power
  section and the note. The Infrastructure section (#299,
  `e2e/infrastructure.spec.mjs`), at 1440 and 768px, dark and light, on
  the demo's healthy board and on its incident with the NAS at 94.6 % disk
  (`nasDiskIncident`, `src/testing/statusFixtures.js`, built through the model,
  answered in place of the demo's `/api/status` and `/api/services`): nothing
  in a card or the table cut off and no sideways scroll, in both views; axe on
  the section; healthy, no red, amber or green in it but its 10px ok lamps
  (the users' node colours, 10px swatches, set aside), so every meter is the
  accent's; the incident's amber only on the NAS's card (its word, its disk
  meter at "94%" and its reason), no red; a node's issue row and its card
  open its detail; the Nodes filter keeps the section and Services
  hides it. At 768px with the table chosen, the section draws the
  cards, with the NAS's warning and its "94%" on screen and nothing to scroll
  sideways. A layout the old board saved draws nothing, and the browser
  keeps none (#306). The Services section (#300,
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
  colours back. The Services and Infrastructure pages (#313,
  `e2e/pages.spec.mjs`; `src/App.pages.test.jsx`): the sidebar's Monitor
  order; each search, State, Node and Role filter narrowing the list and
  going in the address, Back undoing it, a link opening the page filtered;
  no Tag filter while no service has tags; the table kept across a reload;
  `/services` and `/infrastructure` keeping their path and filters as the
  window goes from 768 to 767 to 1440px, the phone's tab showing the same
  search, and the phone's node chip and search reaching the wide page; axe
  on both pages, dark and light; no sideways scroll at 768px. The web on a phone (#303, `e2e/phone.spec.mjs`), at 390 × 844
  and 360 × 780 on the demo's incident: the five tabs, each its screen under
  its own URL, More keeping the rest; the Overview in the Phone board's order
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
  panel and 280 to 340px wide, each panel once, and none at 1280 (the
  Overview draws none of the three there), where the Launch page (from
  the sidebar) has all three panels and every link group; narrowing across
  1440 drops the rail and keeps the sections' elements (no remount); no
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
  every service's and node's name whole and in the window (past a sheet's
  fold counts as whole when scrolling it shows the name whole, #602; the
  sweep's own test plants that, an overflow-x strip and a hiding box); a
  failure names the element and the width. Every status fixture's strip, and a six-tile
  one with "Low battery", at 1024, 1280, 1440 and 1460px (past the page's
  split), in each of the three typefaces (#541): each tile's value and
  sub-line the model's, whole (no word cut, `overflow-wrap: normal`, nothing
  clipped or ending in an ellipsis), the value on one line, six tiles in one
  row or two of three, never 5 + 1. And six tiles carrying every value the
  model gives a tile, at each strip width from 672 to 1200px in each
  typeface: in one row from 816px and not below, every value on one line. A
  tablet (768 and 1023px) is one column, the strip wrapping. The first load
  at 390 × 844 on the incident shifts its layout by 0.1 or less (CLS, by a
  `layout-shift` PerformanceObserver, shifts after input left out; it was
  0.50, the status arriving over sections already drawn, #243): spec §4's
  budget, a CI gate (#306). With motion on, no frame clips anything: from
  768px up to 2560px and back (#561), and a phone turned from 390 to 768px
  and back (#306; HelmGrid's remount used to cut Scheduled Jobs for a
  frame). All eight leave screenshots in `test-results/e2e/shots/`.
  Spec §4's other budgets on the built app (#306, `e2e/budgets.spec.mjs`):
  the default setup fetches at most 60 KB of faces at 1440 and 390px and no
  old screen's face; for each typeface, latin text fetches no latin-ext
  file and "Łódź" exactly the active face's (and JetBrains Mono's in mono
  text); a tick at 1440px, the rail's Pipeline drawn, costs at most 4
  requests, and a hidden tab none.
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
- **Entity URLs in a browser** (#309, `e2e/entity.spec.mjs`, with the
  shell's tests): at 390 and 1440px, an entity opened from its URL over its
  page, a reload, Escape back to the page's URL; a row's, Back, focus on the
  row, Forward and Escape; an id the model has nothing by; a deep link behind
  a sign-in, open once signed in; axe with the detail open, dark and light.
- **The command palette in a browser** (#315, `e2e/palette.spec.mjs`, with
  the shell's tests): at 1440px, the issues first; an entity opening its
  drawer at its URL, Escape and focus back on the search button; a Ctrl-click
  and a middle click opening it in a new tab; a Quick Launch link opening in
  a new tab with no opener; over an open drawer, on top and focused, Escape
  closing it alone with focus back in the drawer; axe with it open, dark and
  light.
- **The first load in a browser** (#444, `e2e/first-load.spec.mjs`, with the
  shell's tests): on the incident fixture at 1440px the page fetches exactly
  what `scripts/first-load.mjs` counts, the app's data aside, and not the
  floating layer, which the first pointer move brings (at 390px, then the
  detail screens' chunk once the browser is idle, #309); and a link focused by
  keyboard while the layer is held back keeps focus, the same element, when
  it arrives, and its tooltip opens on the next focus, beside it from the
  first frame it shows in.
- **Repo guards** (`node --test`, `scripts/*.test.mjs`): the deploy runner pin,
  the secret floor (`.gitignore`, tracked templates, the scanner catching a
  planted key) and its wiring in `check.yml`, the docs' preset and test
  counts (`doc-counts.test.mjs`), and the UI stack's separation from today's
  CSS (`ui-stack.test.mjs`,
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

The Vitest config (`vite.config.js`) starts
its workers with `--no-experimental-webstorage`: Node 25 and later ship a
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
