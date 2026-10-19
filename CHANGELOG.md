# Changelog

All notable changes to JagHelm are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed
- The server no longer writes two log lines on every refresh cycle, which were most of what it logged. "background cycle complete" and "Loaded monitors from Kuma" are now debug lines (set `LOG_LEVEL=debug` to see them; see `env.example`). A cycle is still logged at info when it takes 5 seconds or more, or when the set of refreshes that failed in it changes (Gitea or an integration starting or stopping failing, for example), so a new failure and its recovery each get one line; a refresh that keeps failing still logs its own error every cycle. Loading Kuma's monitors is logged at info when the number of monitors or where they are read from changes, and on the first load after a failed one. Kuma answering with no monitors (for example an error status from its status page) now logs one warning per outage; a Kuma that can't be reached still logs an error every cycle. Containers with no matching Kuma monitor are listed in one line per boot instead of one line each.

### Fixed
- A request redirected with `307` or `308` now keeps its method and body, as those codes require, instead of being turned into a `GET` without a body. A session login (Nginx Proxy Manager, Portainer, PhotoPrism) behind such a redirect on the same host and port, or from `http://` to `https://` on it, now works. A login redirected to another origin (host, port or scheme, apart from that upgrade) is refused instead of being re-sent there. `301` and `302` still turn any method but `GET` and `HEAD` into a `GET` without a body, and `303` turns every method, `HEAD` included, into one.
- The server's access log now records API requests. It logged each request's path as seen from inside the router that answered it (`/gitea/activity` for `/api/gitea/activity`), so no routed API request was logged at info and error lines showed a shortened path. Each request now logs one line with its full path, without the query string: at error for a `5xx`, at info for a `4xx` or a request that took 300 ms or more, and at debug otherwise. `/metrics` and the `/api/health` and `/api/readyz` probes are not logged unless they fail with a `5xx`; before, the probes were also logged at debug when healthy.
- The server no longer loads the integration presets' test files as presets at startup, so it no longer logs two "Skipping invalid preset" errors (for `gitlab.test.js` and `nextcloud.test.js`) or prints their test output in its logs. Test files are also left out of the image.

### Security
- An integration whose key is in the URL (SABnzbd, Tautulli and Emby, or a custom integration with `{token}`, `{password}` or `{username}` in its endpoint) no longer follows a redirect to another origin (host, port or scheme), which could take the key there in the redirect's query string. Its connection test and dashboard card instead report that it was redirected to another origin and is not following because the credential is in the URL: set the integration's URL to the address it redirects to. A redirect from `http://` to `https://` on the same host and port is still followed. Once per pair of origins, JagHelm logs a warning, without the key, when it refuses such a redirect, and when it follows that upgrade, since the key went out in clear text first.
- Outbound requests now forward only `Accept`, `Accept-Encoding`, `Content-Type` and `User-Agent` when a server redirects to a different origin, and drop every other header. Before, only `Authorization`, cookies, `X-API-Key` and `X-Api-Token` were dropped, so the Gotify, Plex, Jellyfin, GitLab, Nextcloud, Pi-hole and PhotoPrism credentials, and a custom integration's own auth header, followed the redirect. A redirect from `http://` to `https://` on the same host and port (a reverse proxy's force-SSL) keeps every header, since they were already sent to that host; this also restores integrations behind such a redirect that authenticate with `X-API-Key` (broken since 2.1.0) or `Authorization` (broken since 1.4.0). Once per pair of origins, JagHelm logs a warning when it drops headers on a redirect or follows such an upgrade, naming the headers but never their values; for an upgrade, configure the integration's `https://` URL so its credential is not sent in clear text first.

## [2.3.0] — 2026-10-18

A weekly Arcane vulnerability digest by mobile push, sent only when there is something new.

### Added
- A weekly Arcane vulnerability digest by mobile push. For the environments listed in `ARCANE_VULN_DIGEST_ENVS` (empty by default, which leaves it off), once a week (Sunday 14:00 UTC by default; `ARCANE_VULN_DIGEST_DAY` and `ARCANE_VULN_DIGEST_HOUR`) JagHelm reads the scan results Arcane has stored and pushes only when something is new: critical or high findings with a fix in the images your containers use, known-exploited (KEV) entries, or an image scan that has newly gone stale or failed. Each digest is recorded as a run of the `arcane-vuln-digest` scheduled job, which goes overdue when digests stop. It needs scanning turned on in Arcane and the `vulnerabilities:read` grant on JagHelm's Arcane key (a global grant in Arcane v2.16.1, so the list decides what is read); preview it with `node scripts/arcane-poll-once.js --vuln-digest`. See `docs/arcane/SETUP.md`.

## [2.2.0] — 2026-10-18

Overdue detection for Arcane's image watcher, no more ghost cards from Arcane's helper containers, and the deprecated Watchtower webhook is removed.

### Added
- Overdue detection for Arcane's image watcher: each check it runs on its own is recorded as a run of the `arcane-check` scheduled job per environment, which goes overdue when checks stop. The expected interval is `ARCANE_IMAGE_CHECK_HOURS` (default 6); see `docs/arcane/SETUP.md`.

### Removed
- `POST /api/watchtower/event` and the `JAGHELM_WATCHTOWER_SECRET` and `JAGHELM_WATCHTOWER_DISCORD_WEBHOOK` settings, deprecated in 2.1.0. Use the Arcane integration (`docs/arcane/SETUP.md`); the env vars can be deleted.
- The Watchtower dashboard integration, which was already marked unsupported (it could not be saved, tested or polled).

### Fixed
- Arcane's short-lived internal helper containers (volume, backup and scan helpers) are no longer discovered, so they no longer appear as grey "unknown" cards or turn a node's health dot yellow after they exit.

## [2.1.0] — 2026-10-17

JagHelm can now read an Arcane manager and send its update, held-back, prune, agent and release notifications by mobile push.

### Added
- Arcane update notifications by mobile push, covering applied and failed updates, held-back updates, Arcane agent outages and new Arcane releases, plus overdue detection for Arcane's scheduled update and prune runs. Set `ARCANE_URL` and `ARCANE_API_KEY` to enable it; see `docs/arcane/SETUP.md`.

### Deprecated
- `POST /api/watchtower/event` and `JAGHELM_WATCHTOWER_SECRET` / `JAGHELM_WATCHTOWER_DISCORD_WEBHOOK` are deprecated in favour of the Arcane integration and will be removed in 2.2.0.

### Security
- Outbound requests no longer forward `X-API-Key` or `X-Api-Token` headers when a server redirects to a different origin, matching the existing handling of `Authorization` and cookies. An API-key integration (Immich, Overseerr, NextDNS, Sonarr, Radarr, Lidarr, Readarr, Prowlarr, Bazarr) configured with an `http://` URL that redirects to `https://` now needs the `https://` URL, since the key is dropped on any origin change.

## [2.0.0] — 2026-10-16

Watchtower update notifications, overdue detection for scheduled jobs, and
token-based Nextcloud authentication.

### Breaking changes
- **Nextcloud authenticates with a serverinfo token.** Username and password are
  no longer accepted. On the Nextcloud host run
  `occ config:app:set serverinfo token --value "$(openssl rand -hex 32)"`, then
  enter the token in the integration's **API Key (NC-Token)** field.

### Added
- Watchtower update notifications via Discord and mobile push, including
  containers held back by monitor-only labels. Point Watchtower's webhook
  notifications at `POST /api/watchtower/event` and set
  `JAGHELM_WATCHTOWER_SECRET` (sent as `secret` in the body) to enable it; set
  `JAGHELM_WATCHTOWER_DISCORD_WEBHOOK` to also post to Discord.
- Overdue detection for scheduled jobs: reporters can declare an expected
  interval, and JagHelm alerts when a job stops reporting.
- Scheduled jobs can be removed from the dashboard, together with their history.
- `/api/health` reports the build commit alongside the version.

### Changed
- Version tags now point to the exact image built from `main`; releases no
  longer rebuild, and published tags never move.

### Fixed
- Nextcloud polling no longer triggers Nextcloud's brute-force protection.
- `ghcr.io/jagbhandal/jaghelm:1.4.0` pointed to the 1.5.0 build; it now points
  to the 1.4.0 build.

### Security
- The Gitea integration sends its API token in the `Authorization` header
  instead of the URL, keeping it out of Gitea's request logs.
- Scheduled-job report names must be plain strings, and reserved names such as
  `__proto__` are rejected.
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
- `CSP_CONNECT_EXTRA` adds origins the web dashboard may connect to (the
  Content-Security-Policy `connect-src`). It takes a comma-separated list of
  `http`, `https`, `ws` or `wss` URLs; invalid entries are dropped with a
  warning.

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
- Android app: plain `http://` is refused for public hosts; it is allowed only
  for tailnet, private-network (RFC 1918, unique-local IPv6), loopback and
  single-label (e.g. `http://nas`) addresses, the deep-link intent filter is
  not `BROWSABLE`, and Android backup (`allowBackup`) is disabled.
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
  they need POST requests or session handshakes (cookie sessions, a CSRF token)
  that JagHelm's integration engine does not support. They are gone from the
  gallery, and existing ones are no longer polled; remove them from your
  configuration.

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
- The server refuses to save or test a removed integration, and never polls one
  left in the configuration files or an imported backup.
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
- **PhotoPrism accounts with two-factor authentication are no longer
  supported.** The OAuth2 client-credentials fallback was removed; if you
  entered a client ID and secret, switch the integration to a PhotoPrism
  account without 2FA.

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
- JSON request bodies up to 1 MB are accepted (previously 100 KB).

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
- Skipping TLS verification for a self-signed Proxmox certificate now applies
  only to that integration's requests; before, it disabled certificate checks
  for every outbound request made at the same time.

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

[Unreleased]: https://github.com/jagbhandal/jaghelm/compare/v2.3.0...HEAD
[2.3.0]: https://github.com/jagbhandal/jaghelm/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/jagbhandal/jaghelm/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/jagbhandal/jaghelm/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/jagbhandal/jaghelm/compare/v1.5.0...v2.0.0
[1.5.0]: https://github.com/jagbhandal/jaghelm/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/jagbhandal/jaghelm/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/jagbhandal/jaghelm/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/jagbhandal/jaghelm/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/jagbhandal/jaghelm/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/jagbhandal/jaghelm/tree/v1.0.0
