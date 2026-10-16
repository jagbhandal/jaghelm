# Changelog

All notable changes to JagHelm are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Breaking changes
- **Nextcloud authenticates with a serverinfo token.** Username and password are no longer accepted. On the Nextcloud host run `occ config:app:set serverinfo token --value "$(openssl rand -hex 32)"`, then enter the token in the integration's **API Key (NC-Token)** field.

### Added
- Watchtower update notifications via Discord and mobile push, including containers held back by monitor-only labels.
- `/api/health` reports the build commit alongside the version.

### Changed
- Version tags now point to the exact image built from `main`; releases no longer rebuild, and published tags never move.

### Fixed
- Nextcloud polling no longer triggers Nextcloud's brute-force protection.

### Security
- The Gitea integration sends its API token in the `Authorization` header instead of the URL, keeping it out of Gitea's request logs.
- Dependencies updated to resolve published high-severity advisories.

## [1.5.0] — 2026-06-27

Adds the Android app with push notifications for state changes, keeps stopped
services visible on the board, and reads Kuma monitors from Kuma's
authenticated metrics endpoint when an API key is set.

### Added
- Android app: a Capacitor app, distributed as a signed APK, that shows the
  dashboard over the tailnet. Sign in with your JagHelm username and password;
  an optional keep-signed-in setting revalidates the session on launch.
- Push notifications to the Android app (Firebase Cloud Messaging) when state
  changes: a service goes down or recovers, a host becomes unreachable, a host
  metric crosses a threshold (with a hysteresis band so it does not flap at the
  edge), a UPS switches to battery or power is restored, or a cron job fails or
  recovers. The server compares each refresh with the previous one and notifies
  only on real transitions. Push needs a Firebase service account on the
  server: set `FCM_SERVICE_ACCOUNT` (or `GOOGLE_APPLICATION_CREDENTIALS`) to the
  path of its JSON key. Without one, push is off and everything else works.
- Tapping a notification opens the related incident in the app (`jaghelm://`
  links).
- Notification settings per event category. Turning notifications off removes
  the device token on the server, not only on the phone.
- With `KUMA_API_KEY` set, JagHelm reads every Kuma monitor and its 1-day uptime
  from Kuma's authenticated `/metrics` endpoint in one request, keyed on
  `monitor_id`, instead of two status-page requests. It falls back to the status
  page when the key is unset or rejected (`401`), or when Kuma is too old to
  report `monitor_id`, so a bad key never empties the board.
- An overall health status, computed on the server, shown as one status dot in
  the web navigation bar and on the app's Overview.
- Services that nothing monitors are tagged "unmonitored".
- `CSP_CONNECT_EXTRA` adds comma-separated origins to the Content-Security-Policy
  `connect-src` directive, for clients that call the API from another origin.
  Each entry must be an `http`, `https`, `ws` or `wss` URL; invalid entries are
  dropped with a warning.

### Changed
- Services are sorted down, then unknown, then up, so problems are listed first.

### Fixed
- A stopped container's card no longer disappears from the board, which made an
  outage look like everything was fine. The board now combines running
  containers, active Kuma monitors and recently seen containers: a down service
  stays on the board as a down card, and a container that has just disappeared
  leaves a grey placeholder.
- A container that has just stopped no longer shows as running while
  Prometheus still serves its recent metrics: a container not seen for 90
  seconds (`JAGHELM_CONTAINER_STALE_SEC`) counts as stopped.
- `ETag` is included in the CORS exposed headers, and the web dashboard and the
  app resolve the API base address the same way.
- Android app: push registration only runs when the build includes Firebase
  configuration.
- Android app: tapping a node row navigates correctly.
- Android app: tap targets are at least 44 px.
- Android app: the server address placeholder shows a tailnet address.

### Security
- The Kuma `/metrics` parser and the push token and preference store reject
  `__proto__`, `constructor` and `prototype` keys and validate numeric input.
- Android app: cleartext HTTP is allowed only for tailnet addresses, the
  deep-link intent filter is not `BROWSABLE`, and Android backup
  (`allowBackup`) is disabled.
- A warning is logged at startup when `KUMA_API_KEY` would be sent over plain
  HTTP to a host other than localhost; use an `https://` `KUMA_URL` for a
  remote Kuma.
- `firebase-admin`, added for push notifications, brings 6 moderate-severity
  transitive advisories (through `@google-cloud/storage`); none are high or
  critical.

## [1.4.0] — 2026-06-22

A maintenance release with no new features that fixes a board freeze during
Kuma outages, zero values shown as missing data and icons shown as filenames,
and tightens security, with four changes that may need action on upgrade.

### Breaking changes
- **The Content-Security-Policy is enforced by default.** It was sent in
  report-only mode; enforcing it contains cross-site scripting, and custom
  inline scripts no longer run. To return to report-only, set
  `CSP_REPORT_ONLY=true`; `CSP_ENFORCE` is no longer read.
- **The raw infrastructure endpoints need a dashboard password.** Without one,
  the Prometheus query, Docker container list, and AdGuard, NPM and Uptime Kuma
  stats endpoints return `403`, so an unauthenticated device on the network
  cannot query the homelab or the Docker socket through JagHelm. The Uptime
  Kuma endpoint also feeds the navigation bar's health dot, which then shows
  unknown. On a trusted LAN, set `JAGHELM_ALLOW_OPEN_INFRA=true` to allow them.
- **Links accept only `http`, `https` and `mailto` URLs, or relative ones.**
  Saving or importing a configuration in which any `url` value has another
  scheme (for example `ssh://` or `javascript:`) is rejected, and such links
  edited directly into the configuration files do nothing when clicked. This
  stops a stored `javascript:` link from running in JagHelm. Change or remove
  links with other schemes before saving.
- **The Deluge, qBittorrent, Transmission and Watchtower integrations are
  removed.** Watchtower's endpoint triggered an image update on every refresh
  instead of reporting status, and the other three never returned data because
  their login flows are not supported. They are gone from the gallery, and
  existing ones are no longer polled; remove them from your configuration.

### Changed
- Built-in service icons load from the maintained `homarr-labs` Dashboard Icons
  CDN instead of the deprecated `walkxcode` one.
- Proxmox integrations are identified by their preset rather than by the fields
  they return.
- Integrations are refreshed at most 6 at a time instead of all at once.
- Server responses are gzip-compressed.

### Fixed
- A sustained Kuma status-page `5xx` no longer leaves the board showing old "up"
  statuses past the 5-minute staleness limit; statuses fall back to "unknown".
- A real `0` (a container at 0% CPU, an idle sensor at 0°, a UPS reading of 0,
  0 MB used) is no longer shown as missing data, across node discovery, refresh
  and the Docker containers view.
- A panel or quick-link icon set to a Dashboard Icons slug or filename (`gitea`,
  `gitea.svg`) shows the icon instead of the text; every view resolves icon
  values the same way.
- Proxmox VM, storage and backup panels appear for any node, not only one named
  `pve`.
- Deleting an integration waits for the deletion to finish before leaving the
  page.
- A failed delete, toggle or refetch shows an error message instead of silently
  leaving stale data on screen.
- When the authentication check fails with a network error or `5xx`, the login
  screen is shown instead of a page whose requests then fail with `401`.
- Hiding a service matches its name exactly: hiding `redis` no longer also hides
  `redis-backup`, and un-hiding cannot remove an unrelated rule.
- Caddy and Frigate count fields show the correct values.
- The GitLab tile shows the GitLab version instead of a project id.
- Demo routes with a trailing slash work.
- The Retry button on embedded tabs restarts its load timeout.
- Weather latitude and longitude update when a configuration is imported.
- In the navigation bar, pressing Enter opens the same link the dropdown
  suggests.
- When several containers match a service, the same one is always chosen.
- A corrupt password hash in `auth.json` makes a login fail normally instead of
  returning a server error on every attempt.
- The checklist file `todos.json` is stored in the directory set by
  `JAGHELM_DATA_DIR`, like the other data files.

### Security
- The server refuses to save, test or poll a removed integration, including
  one in a configuration that was edited directly or imported.
- Outbound requests are checked by the SSRF guard on every redirect (up to 5
  hops) instead of only at the first URL, and response bodies are capped at
  10 MB. Prometheus and Kuma requests go through the same checks.
- The SSRF guard always blocks the IPv6 unspecified address (`::`) and its
  IPv4-mapped form, as it does `0.0.0.0`.
- The icon cache proxy (`/api/icons/cached`) no longer follows redirects, which
  could lead outside its allowed CDNs, caps icons at 2 MB, and serves them with
  a sandboxing Content-Security-Policy and `nosniff`.
- The configuration's prototype-pollution check rejects reserved keys
  (`__proto__`, `constructor`, `prototype`) at any depth, not only at the top
  level.
- Saving or testing an integration accepts only the URL parameters its preset
  declares, so a request cannot inject an endpoint, URL, TLS setting or extra
  headers.
- Session logins build JSON request bodies structurally, so a quote or
  backslash in a credential is escaped instead of altering the request.
- Credentials embedded in URLs (`https://user:token@host`) are removed before
  an error is logged or returned to the browser.
- `undici` is updated to 6.27.0, fixing a high-severity advisory in the HTTP
  client used for integrations.

## [1.3.0] — 2026-06-18

Adds metric sparklines, critical-value highlighting, error details on
integration cards, a command palette, keyboard control of the grid and offline
start-up, and improves the layout on phones.

### Added
- Sparklines: the refresh loop keeps about one hour of each node's CPU, RAM and
  disk usage and draws a trend line behind each metric. The history is a fixed
  window, not a time-series database; it is served from the authenticated
  `/api/history` endpoint and stored in `data/history.json`, which is created
  automatically, stays bounded and is safe to delete (it refills).
- A metric value turns red when it crosses its critical threshold, and its card
  gets a colored halo. A screen-reader severity label gives the same information
  without color, and amber is not used on large text, to keep contrast.
- When an integration's last fetch failed, its card shows a collapsible "No
  data — why?" section with the redacted error (for example `HTTP 401`) instead
  of blank values.
- A command palette (Ctrl+K, or Cmd+K on macOS) with fuzzy search, to jump to
  any tab, theme or configured link and to run actions such as Settings and
  Log out.
- An Auto-arrange button (Settings → Layout) that packs every panel into a
  gapless grid in priority order: nodes, then widgets, then groups.
- The dashboard grid can be operated from the keyboard: each panel has a handle
  that appears on focus; arrow keys move the panel one cell and Shift+arrow
  resizes it, with screen-reader announcements and feedback at the grid edge.
- The web app starts offline: the service worker precaches the first-paint
  bundles and serves files under `/assets/` from cache first.

### Changed
- On phones, the navigation bar drops the clock and "updated" time (and, on
  the narrowest screens, the weather city), side-by-side settings fields stack,
  and the settings sidebar reflows.

### Fixed
- Resizing a panel: the panel now follows the snapped grid outline while
  dragging, instead of running ahead of it and snapping back on release, and
  it cannot be dragged past the edge of the grid.

## [1.2.0] — 2026-06-18

Adds structured logging, Prometheus metrics, a readiness probe, a report-only
Content-Security-Policy, a read-only demo mode and signed container images,
along with accessibility and usability improvements across the interface.

### Added
- Structured request and error logging, with secrets redacted, replacing
  ad-hoc console output.
- Prometheus metrics at `/metrics` (request rate, latency histograms,
  refresh-loop health), served without authentication so Prometheus can scrape
  them.
- A readiness probe at `/api/readyz`, separate from the liveness check
  `/api/health`: it reports ready when Prometheus is reachable, and reports
  whether Kuma is reachable without depending on it.
- Demo mode: `DEMO_MODE=true` serves a read-only sample dashboard, for
  screenshots and public demos, and refuses writes. It is off by default.
- schema.org JSON-LD structured data for search and social previews.
- A save-state indicator; pending edits are sent when the page closes, so a
  quick close does not lose them.
- Each data source shows its own error, stale or retry state with a one-click
  retry, instead of the whole board failing together. Polls that return
  unchanged data still cause no re-render.
- Skeleton loaders while data loads, and live regions that announce updates to
  screen readers.
- An accessible navigation menu on phones.
- The settings live preview can be collapsed, and the settings sidebar groups
  its sections under labels.
- Field-level validation in settings (for example weather coordinates),
  reported to screen readers.
- Importing a configuration backup checks the file and asks for confirmation
  before replacing the configuration.

### Changed
- Notifications appear as non-blocking toasts, and confirmations as themed
  dialogs (focus trap, Escape to close, focus restore, reduced motion),
  replacing the browser's `alert()` and `confirm()`. Resetting the grid,
  removing all overrides and deleting a group or tab now ask for confirmation.
- The theme control opens a picker with a swatch for each of the 10 themes
  instead of cycling through them; it works with the keyboard and screen
  readers.
- The dashboard loads a smaller initial bundle (route-level code splitting) and
  re-renders less when the configuration changes.
- Fonts load on demand instead of through a render-blocking `@import` of 11
  font families.

### Fixed
- Configuration saved through the API is validated and size-limited before it
  is written; an invalid body is rejected with a `400` error instead of being
  stored.
- The server hands out copies of the configuration, so a failed save no longer
  leaves the running configuration different from the file on disk.
- Colors that used the undefined `--teal` and `--blue` tokens now render.
- The navigation bar background follows the theme instead of staying dark on
  light themes.
- An embedded tab that loads slowly is no longer marked as blocked after it
  has loaded.

### Security
- A Content-Security-Policy is sent in report-only mode: violations are
  reported, but nothing is blocked unless `CSP_ENFORCE=true` is set, so custom
  inline scripts keep working.
- The service worker is registered from a script file instead of an inline
  script, so an enforcing policy will not need `unsafe-inline`.
- After 50 failed logins within 15 minutes, from any addresses, every login is
  refused until the window passes, and each failed login is delayed by about
  400 ms. This adds to the existing per-address limit.
- The integration connection test is limited to 10 requests per minute per
  client address (`429` when exceeded), and each test is logged with its target
  host.
- Stricter input limits on the cron, secrets and integration routes.
- Container images are signed with cosign (keyless) and can be verified with
  `cosign verify`.

## [1.1.0] — 2026-06-17

A hardening release covering security, reliability, accessibility and the
container runtime; several changes need action before upgrading.

### Breaking changes
- **The secrets API is closed when no password is set.** Without a dashboard
  password, `/api/secrets` returns `403` instead of being readable by anyone.
  Saving integrations is unaffected, so setups without a login keep working. On
  a trusted LAN, set `JAGHELM_ALLOW_OPEN_SECRETS=true` to allow access. A
  warning is logged at startup when no password is configured.
- **`compose.yaml` uses a bridge network and a hardened runtime.** The default
  changes from `network_mode: host` to a bridge network publishing
  `3099:3099`, and the container runs read-only as `user: 1000:1000` with
  dropped capabilities. Before the first start, make sure the host `data/` and
  `uploads/` directories are owned by UID 1000. `network_mode: host` remains as
  a commented option, needed to reach LAN exporters directly.
- **The AdGuard and NPM panels no longer have built-in endpoints.** They no
  longer fall back to `192.168.68.13` and `admin@example.com`; set `ADGUARD_URL`
  and `NPM_URL` to enable them.
- **`DASH_SECRET` is validated.** Example placeholders such as
  `your-random-secret-here` and `changeme` are refused as the encryption key;
  generate a real one with `openssl rand -hex 32`. Existing encrypted data
  remains readable through a legacy-salt fallback.
- **Cross-origin requests are blocked by default.** The API answers browser
  requests from another origin only when that origin is listed in
  `CORS_ORIGIN` (comma-separated, exact scheme, host and port). If a page on
  another origin calls the JagHelm API, add its origin to `CORS_ORIGIN`.
- **The `?token=` query parameter is no longer accepted.** Send the session
  token in the `x-auth-token` header instead; tokens in URLs leak into proxy
  logs, browser history and `Referer` headers.

### Added
- A visible keyboard focus ring in all 10 themes (WCAG 2.4.7), and support for
  `prefers-reduced-motion`.
- Status is shown by shape and screen-reader text as well as color (WCAG
  1.4.1).
- Settings labels are associated with their fields, the navigation bar and
  settings sidebar mark the current item (`aria-current`, `aria-selected`), and
  icon buttons have accessible labels.
- A first-run screen with a "Connect your first node" button.
- A Cron Jobs panel that shows each scheduled job's latest status and run time.
  Jobs report to `POST /api/cron/report`, authenticated with
  `JAGHELM_CRON_SECRET`; without the secret the endpoint is disabled.
- `TRUST_PROXY` lists the reverse proxies whose `X-Forwarded-For` header is
  trusted, so the login rate limiter sees each client's address instead of the
  proxy's. It is empty by default.
- `JAGHELM_BLOCK_PRIVATE_NETWORKS=true` makes the SSRF guard also block
  private, loopback and link-local addresses, for setups where integration URLs
  are not trusted. By default these are allowed, since homelab services live
  there; non-HTTP schemes, `169.254.169.254` and `0.0.0.0/8` are always blocked.
- The version is read from `package.json` and reported in `/api/health`, the
  startup log and the image labels.
- Each image is also published with an immutable `:sha-<short>` tag for pinning
  and rollback, and carries OCI image labels.
- Open Graph and Twitter card metadata for link previews.
- The README compares JagHelm with similar dashboards.

### Changed
- `/api/health` reflects whether the refresh loop is alive and returns `503`
  (`degraded`) when the loop stalls; the Docker `HEALTHCHECK` uses it instead of
  a fixed response.
- Upload errors appear as inline, dismissible messages instead of blocking
  `alert()` dialogs.
- Content-hashed files under `/assets` are served with an immutable
  `Cache-Control` header, so reloads skip revalidation.
- The service-worker cache key includes the version.
- `multer` is upgraded from 1.x, which is end-of-life, to 2.x. No configuration
  change is needed.
- A refresh in which nothing changed no longer re-renders the dashboard.

### Removed
- SVG uploads for the logo and background images: SVG can carry scripts, so
  uploads accept PNG, JPEG, GIF and WebP.

### Fixed
- Failures in asynchronous API routes return JSON instead of an HTML `500`
  page.
- A stray unhandled promise rejection or uncaught exception no longer stops the
  app.
- Integration fetch errors are reported instead of showing as zeros during an
  outage.
- Uptime Kuma statuses expire after a staleness limit, so the board no longer
  stays frozen on all green.
- A corrupt `services.yaml` is no longer re-parsed every 5 seconds.
- `services.yaml`, the display configuration and the checklist are written
  atomically, so a crash during a write cannot leave a truncated file.
- On `SIGTERM` or `SIGINT` the server stops its refresh timer and lets open
  requests finish, for up to 10 seconds, before exiting.
- One unreachable node no longer empties the services list; the other nodes
  still render.
- A theme chosen in the browser is no longer replaced by the configuration's
  theme when settings reload.
- The PhotoPrism integration signs in with a username and password only. Its
  setup text no longer suggests OAuth2 client credentials for accounts with
  two-factor authentication, which never worked; use an account without 2FA.
- Two instances of the same integration preset no longer receive each other's
  cached data.
- A panel that throws an error shows the error in place instead of blanking the
  dashboard.
- Muted text in light themes meets AA contrast.
- The missing PWA and social icons are included, fixing app installation and
  blank link previews.

### Security
- Integration requests and session logins, including Proxmox, go through an
  SSRF guard that checks every outbound URL. Operator infrastructure
  (Prometheus, Kuma) is exempt from the strict-mode private-address blocking.
- API keys in query-string authentication (`?apikey=…`) are removed from URLs
  before an error is logged or returned to the browser.
- The encrypted secrets store, the admin password hash and the cron history are
  written atomically with `0600` permissions, so a crash during a write cannot
  truncate them.
- Each installation gets a random key-derivation salt instead of the published
  static salt (existing data keeps working through a legacy fallback), and a
  corrupted salt file stops startup instead of silently losing secrets.
- Resolved all 10 published dependency advisories (`path-to-regexp` ReDoS,
  `qs`, `js-yaml`, `postcss`, `vite`).
- Prometheus queries have a length limit, and per-query caches are bounded.
- Security headers are sent on every response (Helmet): HSTS, `nosniff`,
  `Referrer-Policy: no-referrer`, and `X-Frame-Options: DENY`, so JagHelm can
  no longer be shown inside another site's frame.
- A failed login shows the same message whether the username or the password
  is wrong.
- JSON request bodies are limited to 1 MB.

## [1.0.0] — 2026-03-27

First public release.

### Added
- Container image published to GitHub Container Registry
  (`ghcr.io/jagbhandal/jaghelm`).
- HelmGrid, a drag-and-resize layout engine.
- An integration engine with 42 presets.
- A settings interface.
- 10 themes.
- Stored credentials encrypted with AES-256-GCM.
- Password authentication with scrypt hashing.

[Unreleased]: https://github.com/jagbhandal/jaghelm/compare/v1.5.0...HEAD
[1.5.0]: https://github.com/jagbhandal/jaghelm/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/jagbhandal/jaghelm/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/jagbhandal/jaghelm/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/jagbhandal/jaghelm/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/jagbhandal/jaghelm/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/jagbhandal/jaghelm/tree/v1.0.0
