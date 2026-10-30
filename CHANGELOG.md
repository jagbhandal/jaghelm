# Changelog

All notable changes to JagHelm are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/). Releases before 2026-10-25 used an
earlier numbering, kept in
[docs/history/CHANGELOG-pre-1.0.md](docs/history/CHANGELOG-pre-1.0.md).

## [Unreleased]

## [1.2.0] — 2026-10-30

JagHelm gains a Monitoring page for power, cost, disk, CPU, memory, network, container and drive history, drive health (SMART) on the nodes, an energy cost setting, and new alerts for restart loops, out-of-memory kills, missing containers and temporary container names.

### Added
- A Monitoring page, in the Monitor menu after Infrastructure and in the command
  palette. It shows how the lab is doing over time, from Prometheus, in sections
  that each ask a plain question: power draw and monthly cost, which disk fills
  first, CPU and memory by node, network, container memory growth, restarts and
  OOM kills, and drive health. One switch sets the range (1 hour, 24 hours,
  7 days or 30 days). When an alert has a chart, a banner at the top lists it
  with a View graph link that scrolls to that chart and marks it. The charts show
  even when everything is healthy, and a chart that cannot be read says so in
  words.
- Monitoring on a phone, under More and at the same address. Power, cost, disk
  runway, memory with swap, network, container memory growers, restarts and OOM
  kills, and drives are drawn for the phone. CPU is a list of rows with a small
  trend line, and each drive is a list row with its reason in full.
- The Monitoring charts. Power draw is the UPS's watts, with the highest reading
  per step on 7 and 30 days. Monthly cost is the daily cost, month to date and a
  projected month; with no UPS data or no rate set it says so instead of drawing
  zeros. Disk runway lists each node's days until its disk is full, soonest
  first, and says in words when a node is off, a disk fills too irregularly or
  there is not enough history. CPU, Memory and swap, and Network (real
  interfaces only, in and out as a mirrored area) draw a cell per node. CPU
  shows the warning line and each node's I/O wait and temperature in a
  drill-down. Container memory growers ranks the ten containers whose memory
  grew most over 7 days, and says why when Prometheus lacks the recording rule.
  Restarts and OOM kills are an event strip, one row per container with events,
  with a missing reading shown as a gap rather than as no restarts. Drives lists each
  drive's lamp, word, reason and temperature against its kind's warning and
  critical lines, and each NAS RAID array's members present against expected,
  flagged when degraded.
- An energy cost setting in Settings > System: a currency symbol and a list of
  electricity rates, each a start date and a price per kWh, with the newest
  marked Current. A bad date or price is explained next to its field and nothing
  is saved until it is fixed. The price box accepts a leading currency symbol,
  such as $0.20, and saves the number only.
- `GET /api/monitoring?range=` serves the Monitoring charts with the same login
  as the history API. Each chart is read, cached and fails on its own.
  `GET /api/history` accepts `range=30d` (a point every 2 hours, as far back as
  Prometheus keeps), a `max=1` option on 7 and 30 days that adds the highest
  reading in each step so a spike does not vanish, and the series `node.iowait`,
  `node.swap`, `node.net.rx` and `node.net.tx`. `/api/disk-forecast` also gives
  each node's disk size and used bytes.
- Drive health. Where Prometheus scrapes `smartctl_exporter`, each node judges
  its drives (SATA and NVMe). A drive that failed its health check, reports an
  NVMe critical warning or is logging growing media errors is critical; one whose
  reallocated, pending or offline-uncorrectable sector count grew in the last
  7 days, or whose NVMe spare is at or below its threshold, is a warning. The
  node is no longer green while a drive is, and its reason names the drive
  ("drive sdb failed its health check").
- Each drive alerts on its own, as "sdb on node", so a second failing drive is
  pushed separately and one drive's recovery does not hide another's. A drive
  alert opens its node's detail with that drive open and marked, from the Alerts
  page, the phone and a push.
- Drive temperatures have their own warning and critical lines by kind (NVMe 70
  and 80 °C, SATA 55 and 60 °C), saved with the other thresholds as `nvmeTemp`
  and `sataTemp`. Settings > Notifications lists them, as "Drive temperature,
  NVMe" and "Drive temperature, SATA", only where drive data exists, and shows a
  read-only "Drive health" switch. `/api/thresholds` reports it as `drives`.
- A node with drive data shows a Drives block in its detail (the desktop drawer
  and the phone sheet): one row a drive with its lamp, name, word and
  temperature, opening to the model, type, power-on hours, health check and the
  drive's own readings. Serial numbers are never shown. The node's temperature
  chart draws a line for each of the five hottest drives, and `/api/history` has
  a `drive.temperature` series.
- A node that had drive data and no longer has any, or whose `smartctl_exporter`
  scrape is down, raises one "Drive monitoring has no signal" alert. It does not
  turn the node amber, and after 24 hours without a signal the node's drives are
  forgotten and the alert ends quietly.
- Drive health is optional. It is active only where Prometheus holds
  `smartctl_devices`, and `JAGHELM_DRIVES=off` turns it off even then. An
  install without the series is unchanged. The demo serves an NVMe and three
  healthy drives on its storage node.
- The Drives block says how often readings refresh when the smartctl scrape
  target in `prometheus.yml` carries an optional `reading_interval` label (`10m`,
  `1h`) equal to the exporter's `--smartctl.interval`. Without the label the
  block is unchanged.
- A push when a container is in a restart loop (restarted more than 3 times in
  the last hour) or is killed for running out of memory, and a second one when it
  settles. They appear in the Monitoring banner and the Alerts page, open the
  restarts chart, and follow Ack, Snooze and quiet hours like the other service
  alerts.
- A per-container restart-loop limit, for a container that restarts on purpose.
  `display-config.json` takes `"restartLimits": {"node:container": 4}` (node
  and container name, an integer from 3 to 60). The container alerts only above
  that many restarts in the hour, and the alert says the limit that applied.
- An established container that stays Missing for more than 10 minutes sends one
  warning push naming it and its node, and a recovery when it runs again.
  Removing its card, Ack, Snooze, the 24 hour fade and quiet hours silence or end
  it as for any alert. A one-shot job, an ignored name, a name running on another
  node and a container an Uptime Kuma monitor judges send nothing.
  `JAGHELM_MISSING_PUSH_AFTER_MS` changes the 10 minutes.
- A running container named like `<12 hex characters>_<name>`, what an
  interrupted compose recreate leaves behind, shows a warning on its card and in
  Needs attention, naming the real container. It pages once and sends a recovery
  when the container runs under its real name again.

### Changed
- A node's CPU has to stay at or above its warning line for 30 minutes before it
  warns or pushes (it was 2 refresh cycles, about a minute), so a backup night no
  longer pages. The line itself is still set in Settings.
- Rolling back to an older JagHelm after a drive temperature line has been saved
  needs the `nvmeTemp` and `sataTemp` entries removed from `thresholds.json`
  first: the older version rejects the whole file while they are in it.

### Fixed
- Disk runway names the mount and its size on every row ("node /mount, 4.2 GB"),
  and a node whose fullest mount is not its main data volume also shows that
  volume as its own row. The Infrastructure and phone node cards name the size
  too.
- A single step up in disk use (one install or update on a small system partition, flat
  before and after) is no longer read as steady growth with a made-up fill date;
  the forecast starts after the step.

## [1.1.0] — 2026-10-26

Settings no longer show a refused save as saved, quiet hours get a time zone picker, and JagHelm stops guessing that Prometheus and Uptime Kuma are on localhost, so an install that relied on the guess now needs `PROMETHEUS_URL` in `.env`.

### Breaking changes
- JagHelm no longer assumes Prometheus is at `http://localhost:9090` or Uptime
  Kuma at `http://localhost:3001`. Inside the container `localhost` is JagHelm
  itself, so under the shipped bridge compose those guesses only ever failed.
  An install with no `PROMETHEUS_URL` in `.env` must add it (and `KUMA_URL`
  when Uptime Kuma is used), then run `docker compose up -d`. Only an install
  that relied on the guess is affected, for example one on `network_mode: host`
  with Prometheus on the same machine.
### Added
- Quiet hours have a time zone picker (Settings, Notifications, Alert rules).
  The status line shows the current time in the selected zone and the quiet
  hours in that zone, and "Use this device's zone" selects it in one click. A
  new install uses the server's own time zone (the container's `TZ`, UTC if
  unset). An install that already saved alert rules keeps America/Toronto until
  another zone is picked, so nothing changes on upgrade. A save naming a zone
  that is not a real time zone is refused. The first save pins the zone, so
  changing `TZ` later does not move quiet hours.
### Changed
- With `PROMETHEUS_URL` unset, the board now says "Prometheus is not set. Set
  PROMETHEUS_URL in .env." instead of a connection refused, and JagHelm
  makes no request. A wrong address still reads "Prometheus unreachable".
  With `KUMA_URL` unset there is no Uptime Kuma, and no error.
- The docs now agree: node readings need Prometheus, while links,
  integrations and Uptime Kuma status work without it.

### Removed
- The `CSP_CONNECT_EXTRA` setting. It only widened the Content-Security-Policy for the retired Android app; the server now always sends the same strict policy, and a leftover `CSP_CONNECT_EXTRA` line in `.env` is ignored.
- The Nextcloud integration preset and its `JAGHELM_NEXTCLOUD_URL` and
  `JAGHELM_NEXTCLOUD_TOKEN` settings. A Nextcloud integration saved earlier is
  no longer fetched and no longer shows on the Overview; Settings lists it as
  "No longer supported" so it can be removed.
### Fixed
- A request abandoned by the browser or a monitor before the answer was ready
  now shows in the access log (marked aborted, status 499) and in the request
  metrics and latency histogram; before, it left no trace. Error lines in the
  log now include the request path.
- Saving the checklist now refuses a malformed body (a todo with a missing or
  oversized field, or more than 500 todos) with a 400 and writes nothing. Lists
  already saved, including older numeric ids, load and save as before.
- A phone that was muted (or narrowed to a few categories) and went unseen for
  about six months came back with every alert switched on. It now keeps its
  choices when it registers again.
- In Settings, a refused change no longer looks saved. Saving or testing an integration, changing the dashboard password and lifting a snoozed alert now check the server's answer: a refusal shows the server's reason (or its HTTP status) and the integration form stays open and unsaved.
- An icon that is not saved on the server yet now still shows when jsDelivr
  refuses it (it sometimes answers "Package size exceeded" for Dashboard
  Icons). JagHelm fetches that icon from GitHub instead and saves it as usual.
- In a Proxmox cluster, same-named storage pools on different nodes (such as `local-lvm`) are no longer merged into one pool, which could hide a full pool behind a healthy one. Only the monitored node's pools are shown, and a shared storage appears once.
- On Kuma's status-page fallback (not the `/metrics` source), a running container whose monitor was paused while down is no longer shown as down and no longer sends a "service down" notification.
- On the status-page fallback only, a Kuma heartbeat read that answers with an error status is now a failed load that names the status and keeps the last good statuses, instead of loading every monitor with no status. A Gitea repo whose commits request answers with an error is left out, and if every repo does the poll fails and keeps the last list.
- Resizing or rotating the window across 768 px no longer drops keyboard focus:
  the issue row that had focus keeps it in the other layout.
## [1.0.1] — 2026-10-25

Alerts on a phone now work without generating a key first, and a data folder JagHelm can't use is reported with the exact fix.

### Added
- JagHelm makes its own Web Push key pair the first time it starts and keeps it
  in the data folder as `vapid-keys.json`, readable by JagHelm only, so alerts
  on a phone no longer need `node scripts/vapid-keys.mjs` or any `VAPID_*`
  setting. Nothing to do if you already set `VAPID_PUBLIC_KEY` and
  `VAPID_PRIVATE_KEY` in `.env`: they still win, your phones stay subscribed,
  and `VAPID_SUBJECT` is now optional.

### Changed
- If the stored Web Push key file is damaged while phones are registered, alerts
  stay off and Settings says so, instead of silently making a new key that
  would sign every phone out of alerts. Settings also says what is wrong when
  JagHelm's own key can't be used (damaged, unreadable or can't be saved), and
  a key file that others could read is locked down to JagHelm only.

### Fixed
- JagHelm checks its data and uploads folders before it starts. If one is
  missing, isn't a folder, or can't be written to (a root-owned `./data` that
  Docker made, for example), it stops with one plain message naming the folder,
  the user it runs as and the exact commands to fix it, instead of a crash with
  a stack trace. [docs/DATA-DIR.md](docs/DATA-DIR.md) explains the fix and the
  named-volume alternative for a first install. An install that already starts
  needs nothing.

## [1.0.0] — 2026-10-25

The redesigned JagHelm: a status-first Overview with sections for infrastructure, services, power, jobs, backups, drift and expiry, alerts that reach the installed dashboard over Web Push, a layout you can edit, and the same screens on a phone, with the Android app retired.

### Breaking changes
- Version numbers restart at 1.0.0, which replaces every earlier number
  (3.0.0 and below). An install pinned to an older image tag, such as
  `:3.0.0`, must move to `:1.0.0`, the release pin, or to `:latest`, which
  follows `main` and is a build, not a release; the older tags are retired.
  Update tools that compare tags (Renovate, Diun) will treat 1.0.0 as older than
  3.0.0, so repoint them. Already in 3.0.0, so no action if you run it: a
  checkout needs Node 26 (the image ships its own); JagHelm asks Prometheus 14
  queries per refresh instead of 90; `/api/status` serves the status model, and
  `/api/services` gives container traffic as `docker.rxBytesPerSec` and
  `docker.txBytesPerSec`; `/api/integrations` gives each integration a
  `_status`; `monitor_per_node:` and `monitor: false` in `services.yaml`;
  `DEMO_SCENARIO`, `JAGHELM_ICON_CACHE_MAX_MB` and `JAGHELM_HOST`;
  `PATCH /api/integrations/<key>` to enable or disable; and the removal of
  `GET /api/integrations/:type`, `/api/uptime/monitors`,
  `/api/prometheus/query`, `/api/adguard/stats`, `/api/npm/stats` and
  `/api/docker/containers` (they answer 404; `JAGHELM_ALLOW_OPEN_INFRA`,
  `ADGUARD_URL`, `ADGUARD_USER` and `ADGUARD_PASS` do nothing and can be
  removed). From 2.x, apply all of these.
- The Android app is retired and its Firebase push sender is gone. Open JagHelm
  at its https address in the phone's browser, add it to the home screen and
  turn on Settings → Notifications → Enable alerts on this device. `FCM_SERVICE_ACCOUNT`, `GOOGLE_APPLICATION_CREDENTIALS`, the
  service-account key and its compose mount are no longer read (a leftover one
  is ignored without a warning and can be deleted). The app's device records
  are dropped at the next start, and `/api/push/register`, `/api/push/status`
  and `/api/push/prefs` answer 404.
- A password, token or user name that a custom integration's endpoint fills in
  through `{token}`, `{password}` or `{username}` is now URL-encoded, so one
  with `&`, `#`, `/`, `?`, a space or `@` arrives intact. Write credentials in
  `services.yaml` as they are: one you encoded by hand is now encoded twice, so
  write it unencoded again.
- The example `DASH_SECRET` in README and Get Started is refused as an
  encryption key, as `env.example`'s already was, in any case and with spaces or
  quotes around it. An install running on
  `replace-with-output-of-openssl-rand-hex-32` or
  `paste-your-random-secret-here` can't read any stored credential until it has
  a real key. Generate one with `openssl rand -hex 32`, set it as `DASH_SECRET`
  in `.env`, restart, then enter each integration's password or token again in
  Settings. That key was public, so if `data/` or a backup of it ever left the
  host, also change those passwords and tokens in the apps themselves, as
  [section 1 of the incident runbook](docs/security/INCIDENT-RUNBOOK.md#1-datasecretsjson-or-dash_secret-was-exposed)
  describes.
- Moving an integration to a new address (another host, port, or http to
  https) means typing its password or token again. Save and Test refuse a new
  address with the credential left blank, and so does a save of the whole
  config in Settings.
- `/metrics` no longer exports Node.js process metrics (`process_*` and
  `nodejs_*`). If a dashboard or alert of yours reads one, point it at the
  container's own metrics (cAdvisor, `docker stats`).
- After updating, reload any JagHelm tab that was already open: until then its
  display settings can't be saved.

### Added
- A new frame around every page: a header that says how the homelab is in one
  line from the server's status ("Critical · 1 service down · UPS on battery"),
  with when it last heard and a link to what is wrong; a sidebar with Overview,
  Services, Infrastructure, Alerts, Tools, your embedded apps and Settings,
  which folds to icons; and, on a phone, tabs. Every page has its own address
  (`/alerts`, `/settings/tabs`, `/apps/<app>`), so links, bookmarks, Back and a
  reload land where you were.
- The Overview opens with what needs attention: how bad in one line, each
  problem worst first with where it is, why and for how long, or one quiet line
  when all is well. Under it, a strip shows Services, Nodes, Power, Jobs,
  Backups and Integrations at a glance; click a tile to narrow the problems and
  the sections to that part (the filter is in the page's address).
- Overview sections: Infrastructure (a card or table row per node with CPU,
  memory, disk and temperature meters, service counts, uptime and the last
  hour of CPU), Services (every service grouped by node or by your custom
  groups, with status, latency, one number from its integration and an Uptime
  Kuma heartbeat strip), Power (the UPS, on mains or on battery, with charge and
  runtime), and Jobs (every scheduled job and backup with its schedule in
  plain words, last report and overdue state). Settings → Appearance → Overview
  sections hides any of them.
- Edit layout: a header button opens a panel to reorder the Overview's
  sections, show or hide them, pin services to the top of Services and put
  services in custom groups. Every move has a button as well as dragging, and
  is announced to screen readers. It is saved with your other settings, so
  your other devices follow, and a device with an old copy can no longer
  overwrite a change made elsewhere.
- Everything JagHelm watches has its own address (`?entity=<id>` over the
  page you are on). A service, node, UPS, job, backup or integration opens in
  a side panel on a computer and a full-screen sheet on a phone, with its state,
  why and for how long, plus its meters, Proxmox virtual machines, storage
  pools and last backup, container CPU, memory and traffic, integration
  numbers, and links to your own apps. A reload, bookmark or link brings it
  back; something no longer monitored says so.
- History charts in a node's and a container's panel (CPU, memory, disk,
  temperature over 1 hour, 24 hours or 7 days, from Prometheus), readable by
  touch or arrow keys, with dashed and dotted lines past the third so lines that
  cross stay apart for colour-blind eyes.
- A service's panel lists its last 50 checks under Heartbeats. With Kuma's
  status page the strips are Kuma's own; with `KUMA_API_KEY` set JagHelm records
  one check per refresh, and shows Kuma's own history right after a restart.
- Docker Compose stacks are one row in Services, not one per container, with a
  chip for the rest. The row follows its worst container and the panel lists
  each one; Set lead, Ungroup and Split out (or `stacks:` in `services.yaml`)
  change the grouping.
- Services and Infrastructure pages with search and filters by state, node or
  role, kept in the address; services as a list or table, nodes as cards or a
  table; Infrastructure lists each Proxmox node's virtual machines and
  storage pools.
- Alerts that reach the installed dashboard over Web Push, with the screen off
  and without Tailscale: Settings → Notifications → Enable alerts on this device
  (the browser asks for permission) and Send test alert. It needs
  `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` on the server (make
  the key pair with `node scripts/vapid-keys.mjs`, see the getting-started
  guide); without them Settings says so. Each browser is listed and can be
  removed. If alerts on a phone stop (permission withdrawn, subscription
  dropped), JagHelm mends it quietly or says "Alerts on this phone stopped" with
  a button to turn them back on.
- Alert controls: a burst arrives as one push ("5 services down on apps"),
  while a critical alert still goes out at once; the grouping window is 30
  seconds to 5 minutes or off. Notifications have Snooze 1h and Ack buttons that
  survive a restart, and Settings lists what is silenced with a Lift button.
  Quiet hours (Toronto time) hold alerts, with critical ones ringing or not as
  you choose, and send one "While you were away" summary. Known causes label a
  matching alert, such as "AP auto-upgrade reboot". The warning and critical
  lines for CPU, memory, disk and temperature are set under Settings →
  Notifications, each with a default and Reset, and apply to the board and push
  alike.
- Alert history: JagHelm keeps 30 days (up to 1000) of its alerts, with or
  without push set up, saying when, what, why and whether it reached your
  phones. The Alerts page shows it under the active issues, grouped by day, and
  filters by severity, kind and search; `GET /api/events` serves it, with `kind`
  and `q` filters. Arcane's notifications (update runs, held-back updates,
  agents offline, releases, the weekly vulnerability digest) are in it too.
- A status failure is not silent: after two failed checks one "JagHelm status
  check failing" alert goes out, and one on recovery; `/api/health` reports
  `statusModel`, `config`, `push` (queued alerts and the oldest's age) and
  `sourceUrls` fields. A `services.yaml` that doesn't parse or can't be read is
  said in the header and by one "JagHelm config broken" alert, not shown as an
  empty healthy board.
- A command palette (Ctrl+K, Cmd+K on macOS, or the header's search button)
  finds current issues, every service, node, UPS, job, backup and integration,
  Settings sections, apps and Quick Launch links; choosing one opens it.
- Embedded apps are in the sidebar and the palette, up to five loaded at once
  with Unload, and a bar with Reload and Open in new tab. Settings → Apps &
  links adds an app and checks whether it allows being framed; one that blocks
  it can open in a new tab, or "Show it anyway".
- A Launch page (Tools) holds Quick Launch with every link group, Pipeline
  (the newest commits across your Gitea repos with each commit's CI result) and
  the Checklist, plus the weather, clock and web search. From 1440px wide the
  Overview shows the same panels beside its sections.
- Themes: Dark, Light and System (follows your device), a sun and moon button
  in the header, an accent of violet, fuchsia or cyan, comfortable or compact
  density, Manrope, Plus Jakarta Sans or Montserrat as the font, and Custom
  themes added as JSON that load only if they keep text, status and accent
  colours readable and the five statuses visibly apart. Settings → Appearance
  also sets Units (metric or imperial) and Dates and times.
- Settings is an index of its sections (Nodes & Services, Integrations, Apps &
  links, Appearance, System, Notifications and Sources) with a search that
  finds a setting by name and old tab names; an old Settings address opens the
  section that holds it now. Sources shows each monitoring source (Prometheus,
  Uptime Kuma, NUT, Gitea, the cron reporters) answering, failed with why, or
  off, with the `.env` variable that sets it.
- Settings → Nodes & Services: reorder nodes; mark cron jobs as backups with a
  switch; Find nodes asks Prometheus for nodes `services.yaml` lacks; each
  service shows which Uptime Kuma monitor Auto-match would pick and why, and a
  container on two nodes (such as `gateway-npm`) gets its monitor, display name
  and icon per node; a Kuma monitor with no container sits on the node its
  address or name points to (on upgrade, expect NAS (Ping) and NAS UI to move
  from Staging to the NAS and cadvisor-pi1, cadvisor-pi2 and cadvisor-vm103 to
  their own nodes; the setting is keyed by monitor name, so renaming a monitor
  in Uptime Kuma drops it).
- Settings → Integrations: Connected integrations with the board's own status
  word, Disable, Edit and Remove, a preset gallery with search and category,
  and a custom builder. Test connection runs exactly what the next refresh would
  with the form as you would save it, and a password or token is never shown or
  read back. A failing source or integration says why in one plain sentence
  ("Prometheus refused the connection") everywhere it appears.
- A disk forecast on each node's Disk meter: "12 days left" from a line through
  the last week of disk use, amber under 14 days and red under 3 (Settings →
  Nodes & Services → Disk forecast moves both); a flat, shrinking or distant
  disk shows nothing. It colours a number and sends no alert.
- Recent errors in a node's or container's panel: its last 20 error and warning
  log lines from the last 6 hours, read from Loki once `LOKI_URL` is set (set
  `loki_host` on a node Loki names differently). Passwords and tokens in a line
  are hidden, and logs show only once a dashboard password is set.
- Backups on the Overview: for each job marked as a backup, when it last ran
  well, amber after 36 hours and red after 72 (Settings → Nodes & Services →
  Backup freshness moves both), red at once on failure, and "No signal" for one
  that never reported. With a read-only Backblaze B2 key in `JAGHELM_B2_KEY_ID`,
  `JAGHELM_B2_APP_KEY` and `JAGHELM_B2_BUCKET` it also shows the bucket's size,
  a sparkline and growth from a once-a-day read, and warns when hidden old file
  versions pile up. Read-only; it sends no alert.
- Config drift on the Overview: a host-side timer runs the drift check and
  pushes the result to `POST /api/drift/report` with `JAGHELM_CRON_SECRET`;
  JagHelm runs no check and holds no key. A host reporting drift or a failed
  check is amber, an old report is "Unknown" (Settings → Nodes & Services →
  Config drift sets the hours, default 36), and the row sends no alert. It is
  absent without the secret.
- Expiry on the Overview: the TLS certificates and Tailscale node keys you
  track, soonest first, with days left (amber under 21, red under 7; Settings →
  Nodes & Services → Expiry moves both). Add up to 30 hosts (`host` or
  `host:port`); the server makes a TLS handshake with each every 6 hours, and
  `JAGHELM_BLOCK_PRIVATE_NETWORKS=true` refuses private addresses here too. With
  `JAGHELM_TAILSCALE_API_KEY` (and `JAGHELM_TAILNET` if the token's own tailnet
  isn't wanted) it lists each Tailscale device's key expiry. A certificate that
  doesn't cover the host shows amber. Nothing sends an alert.
- Pending host steps on the Overview: how many open steps the tracking list in
  homelab-infra issue #848 holds, with a link to each, using the Gitea address
  and token the Pipeline panel already has. Read-only; it appears only when Gitea
  is set up and a step is open. The Gitea token must be able to read that
  repo's issues, or the tile shows only a "See #848" link.
- A job's panel shows its schedule, overdue line, last three runs and a Remove
  button that forgets the job and its history until it reports again. A
  container you removed on purpose has a Remove button that clears its "Missing"
  warning at once; it reappears by itself if the container comes back.
- A guided first-run setup for a new install: it checks Prometheus, lists the
  nodes found so you can name or switch some off, shows whether Uptime Kuma and
  your UPS are connected, and offers Integrations. Every step can be skipped,
  and an existing install never sees it.
- The phone gets the same screens in the browser: Overview with the status
  card, strip and issues, Services, Infrastructure and Alerts tabs, More for
  embedded apps, Launch and Settings, row details as sheets that Back closes.
- New environment variables: `JAGHELM_UPS_NAME` (which NUT UPS the Power
  section shows), `LOGIN_TRUSTED_NETS` (networks that skip the sign-in wait
  during an attack, such as `192.168.68.0/22,100.64.0.0/10`; behind a reverse
  proxy it needs `TRUST_PROXY` set right), and the ones named above. `env.example`
  lists every variable JagHelm reads.
- `/api/status` says which lines it judged by (`thresholds`).

### Changed
- JagHelm checks its environment at start. A value that doesn't fit its
  variable (`LOG_LEVEL=trace`, `CSP_REPORT_ONLY=0`) is warned about once in the
  log, naming the variable and the default used, never the value. Only a `PORT`
  that isn't a port number, or a `JAGHELM_BLOCK_PRIVATE_NETWORKS` that isn't
  true or false, stops the start. `npm start` reads `.env` first, so
  `LOG_LEVEL` and `JAGHELM_DATA_DIR` there count.
- Sessions survive a restart or update: one ends after 30 days without use, or
  90 days after sign-in. They are kept in `data/sessions.json` as hashes, and
  the sign-in page names the reason when a sign-in is refused. Without phone
  notifications JagHelm still writes `data/push-snapshot.json` (history and
  alert state), and it also holds Arcane's state; the first start reads the
  older `arcane-*.json` files and leaves them for a rollback.
- Push and the status come from one status model. The Overview asks the server for at most
  four requests per refresh and none while the tab is hidden, and node history
  comes from Prometheus, so JagHelm no longer keeps `history.json` (an old one
  can be deleted). The server's dependencies shrink from 290 packages to 89
  and its image by about 90 MB.
- When JagHelm can't reach its server, or the status is out of date, nothing
  keeps the last status's colour: the header, attention panel, strip,
  Infrastructure and Alerts turn grey with "No signal · last known 3 min ago"
  while the last numbers stay visible. The age counts from when the server built
  the status.
- A failed backup pages as critical; a failed job that isn't a backup, and an
  overdue backup, stay warnings. A reading is written rounded down everywhere,
  and a node reading with no value keeps its warning, as a held warning, until
  the reading returns, the node leaves `services.yaml`, or 24 hours pass.
- The UPS panel shows a UPS of any name (the first by name with a reading,
  unless `JAGHELM_UPS_NAME` names one), and the Pipeline panel shows each repo's
  commits on its default branch, not only `main`.
- The Pipeline panel reads Gitea every 5 minutes, about a tenth of the
  requests, and keeps the last commits for up to 10 minutes if Gitea stops
  answering.
- A fresh install starts in °C; an existing one keeps what it was drawing,
  saved once as the Units setting, and dates follow the browser's locale. An
  existing install's old theme becomes dark or light to match, and a font preset
  or custom accent saved earlier reads as Manrope or the nearest accent.
- The access log records every change at the default log level (a save, a
  delete, a cron report, a sign-in); a quick successful read is logged only at
  `LOG_LEVEL=debug`.
- A failed login to a session-login app (Nginx Proxy Manager, Portainer,
  PhotoPrism) says why, and the command palette's list loads when the browser is
  idle.

### Deprecated
- The unprefixed names of the integration and Gitea variables (`GITEA_URL`,
  `GITEA_TOKEN`, `NPM_URL`, `SONARR_API_KEY` and the rest) still work, with one
  warning each in the log at start; a later release drops them and reads only
  the `JAGHELM_` names. Rename them in `.env`. When both names are set with
  different values, the `JAGHELM_` one is used. The `JAGHELM_` names now work
  for every integration.

### Removed
- The old grid board under the Overview, with its drag, resize and saved layout,
  and Settings → Layout's grid columns, Auto-arrange, Reset and Collapsible
  sections. Everything it showed has a home in the sections, panels and Launch
  page above; arranging the Overview is the Edit layout mode. Service cards,
  per-container CPU, memory and network numbers on the Overview, the old
  panels' titles, icons and colours, the UPS panel switch, the scheduled jobs
  panel switch, the Settings live preview, a node's Icon field (a saved one is
  dropped at the next save of `services.yaml`), and the font-size sliders go
  with it.
- The ten editor-inspired themes, the navigation bar's welcome message, theme
  button and free accent colour picker, a custom group's icon, colour and hidden
  options (a hidden group could hide a service that is down), and the
  Appearance font presets Clean, Rounded, Sharp and System.

### Fixed
- Config safety: a save in Settings keeps the comments and quoting of a
  hand-written `services.yaml` (a file using YAML anchors or merge keys is still
  rewritten whole, and the log says so); an unreadable or unparseable file is
  never overwritten and Settings says which line is wrong; a stale tab can no
  longer undo another device's change to Nodes, Services or the display
  settings (it is merged or refused and reloaded, and a closing tab asks first);
  a `services.yaml` that was already broken at start and then deleted leaves an
  empty board until you restart JagHelm, which discovers your nodes again;
  a hand-edited value Settings can't save is left out instead of blocking every
  save; a first start while Prometheus is down no longer leaves an empty board
  for good.
- Integrations: deleting one deletes its stored password, token and URL, and
  renaming one keeps a secret another uses; a secret that can't be written or
  read fails the save or the card instead of sending an empty login; a custom
  integration is tested at its own endpoint, and the preset list no longer
  guesses from the part of a name before an underscore.
- Alert accuracy: a node already in trouble when first seen, a UPS going on
  battery with no prior reading and every open problem at start without saved
  state now alert; a reading that misses a cycle, a Proxmox storage pool whose
  fetch fails and a Prometheus that has just started no longer end an alert, send
  a false "back to normal" or flood "unreachable"; a Prometheus that stores
  nothing, blocks its targets list or never scrapes a node alerts as failing
  once, naming it; and a container stopped under another name, or whose Kuma
  monitor is paused, is a missing container, not critical while its monitor is up.
- Push delivery: a notification that can't be sent is kept in order, up to 100,
  and sent when the internet is back, also after a restart, without holding up
  the dashboard or `/api/health`; a problem that cleared meanwhile sends
  neither the alert nor its recovery; Arcane polling and its digest no longer
  stall.
- The Overview no longer jumps as it loads on a phone, strip tile words wrap
  instead of breaking, panels take their content's height at once when a window
  resizes, resizing past 768px stays on Services or Infrastructure, and a
  confirmation opened from a phone sheet is no longer hidden behind it. A
  signed-out tab stops polling and asks you to sign in, and a Cloudflare Access
  sign-in that has ended says "Sign in again".
- A new install with nothing set up says "Nothing monitored yet" and one that
  can't reach Prometheus says "Prometheus unreachable", instead of a grey "No
  signal". The handbook's short-lived build container no longer appears as a
  card and then a "Missing" one. The README and getting-started guide show the
  `compose.yaml` JagHelm ships, a bridge network with port 3099 published.

### Security
- Failed sign-ins no longer lock everyone out. Failures slow down only the
  address they come from (after 5 in a row it waits 30 seconds, doubling to 15
  minutes), guesses from many addresses share one budget of 130 an hour, and
  the 16 addresses you signed in from most recently and `LOGIN_TRUSTED_NETS`
  skip the wait. A user name or password that is not text is refused.
- Logging out ends the session on the server, so a copied token stops
  working; your other sessions stay signed in. Changing `DASH_PASS`,
  `DASH_USER` or `DASH_SECRET`, or removing `data/auth.json`, signs every device
  out at the next start; to do it without changing the password, stop JagHelm,
  delete `data/sessions.json` and start it again.
- A stored password or token goes only to the address it was entered for, and
  every integration request stays on its URL's host and port; at the first start
  each stored credential is bound to the addresses of the integrations that use
  it. Credentials in `.env`, or typed into `services.yaml` by hand, go where the
  URL points, as before.
- A URL carrying a user name, password or key (`https://user:pass@host`,
  `?key=`, `?token=`), in `PROMETHEUS_URL`, `KUMA_URL`, `GITEA_URL`,
  `ARCANE_URL`, an integration's variable or its stored URL, is refused and never
  requested or logged; the board names the variable and where the credential goes.
  Such a URL never worked, so no working setup changes, unless a path held a
  raw `@` after a port: write it `%40`. A `$secret:` reference in an integration field is
  refused too, unless it is the one already stored in that field.
- A `services.yaml`, `secrets.json`, `auth.json` or `display-config.json` that
  doesn't parse is no longer logged with the lines around the error, and the log
  hides a password made of digits followed by a raw `#`, `/` or `?`.
- zod is updated to 4.6.7 (GHSA-mrhx-c7xc-m3w5). undici (7.30.1) and vitest
  (4.1.12) are updated for advisories that affect test tooling only. The server image runs Node 26.12.1
  on Alpine 3.24.3, which fixes a Brotli decoder out-of-bounds write in Node (CVE-2026-111497, high).

[1.1.0]: https://github.com/jagbhandal/jaghelm/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/jagbhandal/jaghelm/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/jagbhandal/jaghelm/releases/tag/v1.0.0
[Unreleased]: https://github.com/jagbhandal/jaghelm/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/jagbhandal/jaghelm/compare/v1.1.0...v1.2.0
