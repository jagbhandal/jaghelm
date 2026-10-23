# Changelog

All notable changes to JagHelm are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Breaking changes
- **The example `DASH_SECRET` in README and Get Started is refused as an
  encryption key,** as `env.example`'s already was, in any case and with
  spaces or quotes around it. An install running on
  `replace-with-output-of-openssl-rand-hex-32` or
  `paste-your-random-secret-here` can't read any stored credential until it
  has a real key: its integrations say the stored credential can't be read,
  and Settings can't save one. Generate a key with `openssl rand -hex 32`,
  set it as `DASH_SECRET` in `.env`, restart, then enter each integration's
  password or token again in Settings; the log line at start says the same.
  That key was public, so if `data/` or a backup of it ever left the host,
  also change those passwords and tokens in the apps themselves, as
  [section 1 of the incident runbook](docs/security/INCIDENT-RUNBOOK.md#1-datasecretsjson-or-dash_secret-was-exposed)
  describes.

### Added
- `JAGHELM_UPS_NAME` picks the UPS the UPS panel shows, by its name in NUT.
- `LOGIN_TRUSTED_NETS`: networks whose addresses never wait on the shared
  sign-in budget during an attack, such as `192.168.68.0/22,100.64.0.0/10`
  for a LAN and a tailnet. Empty by default. Behind a reverse proxy it needs
  `TRUST_PROXY` set right, or anyone could claim such an address.
- JagHelm keeps a history of its alerts for 30 days (up to 1000), whether or
  not phone notifications are set up: each service going down or coming back,
  each reading over its line or back to normal, the UPS, jobs, backups and
  monitoring sources. Each says when, what it was about and why, and whether it
  went to your phones (to how many), was turned off in their settings, or
  wasn't sent. It survives restarts and updates. `GET /api/events` serves it,
  newest first, a page at a time, filtered by what it is about or by severity;
  the web and Android Alerts pages will show it in a later release.
- A new frame around every page: a header across the top that says how the
  homelab is, in one line from the server's status ("Critical · 1 service down ·
  UPS on battery"), with when it last heard and a link to the list of what is
  wrong; a sidebar with Overview, Alerts, your embedded apps and Settings, which
  folds down to icons and remembers that in this browser; and, on a phone, tabs
  for Overview, Alerts and More.
- When JagHelm can't reach its server, the header says "No signal" in grey, as
  the Android app does, instead of a status it can no longer vouch for.
- An Alerts page lists what needs attention now, worst first.
- Every page has its own address (`/alerts`, `/settings/tabs`, `/apps/<app>`):
  links, bookmarks, Back, Forward and a reload all land on the page you were on,
  offline too once JagHelm has been opened in that browser.
- Embedded apps are in the sidebar (under More on a phone) and in the command
  palette ("Open Grafana"). A dot marks an app that is still loaded; Unload
  frees it. At most five stay loaded at once: opening a sixth unloads the one
  you used least recently. Over an open app, a bar shows its name and address,
  with Reload (that app only) and Open in new tab.
- The Overview opens with what needs attention. When something is wrong, it
  says how bad in one line ("Critical · 2 critical"), what is wrong, and each
  problem worst first, with where it is, why and for how long; a problem
  takes you to its place on the board below when the board shows it (Ctrl or
  middle click opens it in a new tab), and "All alerts" opens the Alerts
  page. When all is well, one quiet line says so ("All systems normal · All
  32 services up · 6 nodes healthy"). Without a connection to the server, it
  says "No signal" and keeps showing what the server last said, and how long
  ago.
- Under the Overview's status, a strip shows each part of the homelab at a
  glance: Services, Nodes, Power, Jobs, Backups and Integrations, each with
  its state and its count ("11 / 12 up"). A part that isn't set up has no
  tile. Click a tile, or press Enter or Space on it, to see only that part:
  the problems above and the board below narrow to it, and "Showing Nodes
  only" says so, with Clear. Click it again to see everything. The filter is
  in the page's address, so Back undoes it and a link opens the Overview
  filtered.
- The Overview has an Infrastructure section above the board: a card for each
  node with its CPU, memory, disk and temperature meters, how many of its
  services are up or down, its uptime and its CPU over the last hour. A meter
  stays the accent colour and turns amber or red only at or over its warning
  or critical line, the same lines the status uses, and shows the same
  number and unit as the status reason (temperatures in °C). A node with no
  signal says so and shows no numbers. A node's colour shows as a small
  swatch beside its name. Switch to a table with Cards / Table; this browser
  remembers the choice. On a phone, where the table would hide the readings
  off to the side, the section shows the cards. An issue for a node in the
  panel above leads to its card, and the Nodes filter keeps the section.
- The Overview has a Services section under Infrastructure: every service in
  one list, grouped by node, one line each with its status, its name, its
  ping latency and one number from its app integration. A service that is
  down or not answering says why instead, in its status colour; healthy ones
  stay quiet. A Node / Group switch groups the list by the custom groups of
  Settings → Sections, the node beside each name; until there is one, Group
  is greyed out with a link there. This browser remembers the choice. On a
  phone each row reads its number and latency under the name. An issue for a service in the panel above
  leads to its row, and the Services filter shows the section alone. When
  JagHelm loses its signal, every row turns grey and the section says how old
  its numbers are.
- A Launch page (Tools in the sidebar, More on a phone, and the command
  palette) holds Quick Launch, Pipeline and the Checklist at any width, at its
  own address (`/launch`). Quick Launch shows every link group you set up in
  Settings → Links, not only the first three; Pipeline lists the newest
  commits across your Gitea repos; the Checklist adds, ticks and deletes tasks,
  with an optional due day.
- On a window 1440px wide or more, the Overview shows the same three panels in
  a column beside its sections, in place of the board's own. A panel switched
  off in Settings → Sections stays off there, and Quick Launch and Pipeline
  appear only once you have links or a Gitea.
- Every Checklist shows the same list, so a task added on one page is never
  lost to a tick on another.
- A sun and moon button in the header switches between the dark and light
  themes, and remembers your choice in that browser.
- A System theme in Settings → Appearance and the command palette follows your
  device's light or dark setting, and changes with it.
- The Overview has a Power section under Infrastructure: the UPS, on mains
  or on battery, with its charge, and on battery the minutes it has left. Its
  row opens the UPS's panel with the charge, load, model and runtime, on
  mains too, where it has no alert to open it from. The Power tile of the
  strip shows it alone, and Settings → Appearance → Overview sections can
  hide it; if you had switched the old UPS panel off, it starts hidden.
- Settings → Appearance has Overview sections: a switch for the subsystem
  strip, Infrastructure, Services and the column beside them, to show or hide
  each on the Overview. The choice is saved with your settings, so it holds on
  every device. Needs attention can't be hidden, since it only shows when
  something is wrong.
- Settings → Widgets has a switch for the clock, on unless you turn it off.
- Everything JagHelm watches has its own address: a service, a node, the UPS,
  a job, a backup or an integration opens at `?entity=<its id>` over the page
  you are on (`/?entity=services/apps:jellyfin`). On a computer it opens in a
  panel at the side of the page; on a phone, as a full-screen sheet. A reload,
  a bookmark, a link sent to someone and a sign-in all bring it back, and the
  browser's Back button or Escape closes it.
- Rows open what they are about: every row under Needs attention and on the
  Alerts page, each row of the Services section, and a node's card or its row
  in the Infrastructure table. The panel shows the state, why, for how long,
  and where it is. A middle click or Ctrl-click opens it in a new tab.
- A link to something JagHelm no longer watches (removed, renamed, or an old
  link) says so: "No longer monitored".
- Pushes to the Android app now name what they are about, so a tap opens it
  (see the app's changelog).
- The panel a row opens now has everything about that thing, on a computer
  and on a phone:
  - a node: its CPU, memory, disk and temperature meters, uptime, and memory
    and disk in GB; on a Proxmox host, its virtual machines, its storage
    pools (coloured by the same disk thresholds as a node's disk) and its
    last backup;
  - a service: its latency and 24-hour uptime, its container's CPU, memory
    and network traffic, and the numbers from its integration (or why the
    integration couldn't be read);
  - the UPS: charge, runtime (left on battery, or at this load on mains),
    load and model;
  - an integration: its numbers, or why it couldn't be read.
- On a computer the panel links to the thing (Open, using your own embedded
  app or Quick Launch link of exactly the same name), to Grafana and Uptime
  Kuma (your apps or links of those names), and to where it is set up in
  Settings. Something on more than one node (a Proxmox host, a container on
  every node) links only to an app or link that names its node, such as
  "Proxmox pve2"; two links of one name to different places give none.
- A Proxmox backup still running says so. While JagHelm can't be reached,
  the panel's details are greyed and say how old they are.
- A state that changed in the last minute says "just now", not "for 0 s".
- The panel fetches these details only while it is open, and refreshes them
  with the status, reusing what the page has just fetched. If a read fails,
  it keeps the last details and says they aren't updating.
- `/api/status` now also says which lines it judged by (`thresholds`): the
  defaults, or the ones set under `pushThresholds` in `display-config.json`.
  The new Overview's meters draw their warning and critical lines from it, so
  a meter turns amber or red exactly where the server's status and push
  notifications do.
- The Pipeline panel shows each commit's CI result from Gitea Actions, as the
  design has it: "repo · CI Passed" (or Failed, Running, Cancelled…) beside a
  lamp, over the branch and short SHA, with the commit's message in the
  row's tooltip. A long branch name is shortened, never the SHA. Rows come
  from push runs; pull-request and scheduled runs don't show. A repo without
  Actions shows its commits as before, with no lamp. Gitea is still read
  every 5 minutes, with smaller requests than before.
- The Overview has a Jobs section under Infrastructure: every scheduled job
  and backup, one line each with its status, its name, its node, its
  schedule in plain words ("daily at 06:30" for `30 6 * * *`) and how long
  ago it last reported. A job that failed or is overdue says why instead, in
  its status colour: a failed backup is red, a failed or overdue job amber.
  The Jobs and Backups filters show their own group alone, and Settings →
  Appearance → Overview sections can hide it. On a phone the same list is on
  the Infrastructure tab, under the nodes.
- A job opens its own panel: its schedule, when it last reported, the
  overdue line ("Last report 31 h ago · expected every 24 h"), its last three
  runs with their time, duration and error, and **Remove**. Remove asks
  first, then removes the job and its history as the old Scheduled Jobs
  panel did; the job comes back the next time it reports. If removing fails,
  the panel says why and nothing is removed.
- `/api/health` shows the phone notifications waiting to be sent, under
  `push`: how many (`queued`) and how long the oldest has waited
  (`oldestAgeS`), so a refused service-account key or a long internet outage
  shows. It doesn't change the health status.
- Arcane's notifications are in the alert history (`GET /api/events`) with
  JagHelm's own: each update run, held-back or caught-up update, agent going
  offline or reconnecting, Arcane release and weekly vulnerability digest, and
  whether it went to your phones. They are recorded with phone notifications
  off too.

### Changed
- The server sends push notifications with its own small Firebase Cloud
  Messaging client instead of the Firebase Admin SDK. Notifications reach the
  phone as before, with the same wording. The server's dependencies shrink from
  290 packages (92 MB) to 89 (22 MB) and its image by about 90 MB, and push is
  ready as soon as the server starts. Nothing to change: the same service-account
  key and `FCM_SERVICE_ACCOUNT` setting work as they are.
- JagHelm checks its environment at start. A value that doesn't fit its
  variable (`LOG_LEVEL=trace`, `CSP_REPORT_ONLY=0`,
  `ARCANE_RELEASE_CHECK_HOURS=6h`) used to be ignored or misread without a
  word: now the log warns once, naming the variable and the default used
  instead, never the value. Only a `PORT` that isn't a port number, or a
  `JAGHELM_BLOCK_PRIVATE_NETWORKS` that isn't true or false, stops the start,
  with a line naming it: fix it in `.env` and start again.
- The Pipeline panel reads Gitea every 5 minutes instead of at every refresh,
  about a tenth of the requests. A failed read is tried again after 30
  seconds, then less often, and the panel keeps the last commits meanwhile,
  for up to 10 minutes after Gitea last answered.
- `env.example` now lists every variable JagHelm reads.
- `npm start` reads `.env` before anything else, so `LOG_LEVEL` and
  `JAGHELM_DATA_DIR` there now count. Docker installs are unchanged.
- You now stay signed in, on the web and in the Android app, when JagHelm
  restarts or updates. A session ends after 30 days without use, and 90 days
  after you signed in in any case. Before, every restart signed every device
  out, and a session ended 24 hours after sign-in however much you used it.
- Without phone notifications set up, JagHelm now writes
  `data/push-snapshot.json` too: it holds the history and the last state it is
  compared against. Turning notifications back on still sends what changed
  since your phones were last told, never a stale alert.
- A `data/push-snapshot.json` that can't be read is kept as
  `push-snapshot.json.corrupt-<time>` (the newest one only) instead of being
  written over, and the log says how many alerts it held.
- The node panels on the board no longer show their own CPU, memory,
  temperature, disk and uptime tiles, which turned amber at 70 % while the
  status warns at 90 %, or the used / total GB. Those readings are in the
  Infrastructure section now; the panels keep their services and Proxmox
  lists, and are as tall as those. A board laid out before shrinks its node
  panels to fit once, on its first load; heights you set after that stay.
- The board no longer has service cards: the Services section lists the
  services, so the node panels keep only their Proxmox lists, and custom
  groups are a way to group that list instead of panels of their own. Service
  cards can no longer be dragged between panels; choose a group's services in
  Settings → Sections. Per-container CPU, memory and network numbers are no
  longer on the Overview, and Settings → Layout no longer has the service
  cards' options.
- On a phone (a window narrower than 768px), JagHelm in the browser now shows
  the same screens as the Android app, in the new look: the Overview with the
  status card, the subsystems and what needs attention, then your services and
  nodes as lists; Services, with search and filters; Infrastructure, with each
  node's readings; and Alerts. Tap a row to open its detail over the page,
  which says how long it has been that way; the browser's Back button closes
  it.
- The phone's tabs are Overview, Services, Infrastructure, Alerts and More, as
  in the Android app; More still holds your embedded apps, Launch and Settings.
- JagHelm has two themes, dark and light, drawn in the new design's graphite
  greys with one violet accent, and the board, Settings and the frame around
  them now match. If you picked one of the old themes, JagHelm opens in dark
  or light to match it: One Dark Pro, Dracula, Night Owl, GitHub Dark,
  Catppuccin Mocha and Material Ocean become dark; GitHub Light, Catppuccin
  Latte, Solarized Light and Atom One Light become light.
- The sign-in page matches the rest of JagHelm: JagHelm's logo over one card,
  with labelled Username and Password fields. In the light theme the logo's
  text is darker, so it reads on the light background. Your own logo, when
  you've uploaded one, still replaces it.
  A wrong password is said under the password field and the cursor goes back
  to it, with the text selected so you can retype it, and the message goes as
  soon as you do; an empty field is named before anything is sent. While a sign-in is on its way the button says
  "Signing in…" and a second press does nothing.
- When the server refuses a sign-in for another reason, such as too many
  attempts, the page says the server's reason instead of "Invalid
  credentials"; when the server doesn't answer, it says so.
- A fresh install with no node yet says "Waiting for your first node" (or
  "Connect your first node", with Open Settings) where the nodes will be,
  in the new look.
- A strip filter with nothing to show, such as Integrations, or one whose
  section is switched off, says why, with Show everything.
- Settings draws in Manrope, the app's own face, by default: the Default
  typography preset is Manrope and JetBrains Mono.
- Settings → Sections keeps a switch each for Quick Launch, Pipeline and the
  Checklist, the panels beside the Overview from 1440px wide.
- The Overview asks the server for less: at most four requests per refresh,
  the Pipeline's and the weather's included, and none while the tab is
  hidden.
- A row under Needs attention opens its detail instead of scrolling to that
  thing on the board below.
- Test Connection in Settings → Integrations now checks exactly what the
  next refresh will do with the form as you would save it, before anything
  is saved: the same requests, with the stored endpoint and fields, and the
  password or token you typed in place of the stored one. Its error is the
  one the integration's card would show. A preset is no longer tested at a
  lighter "test" address of its own.
- A failed login to Nginx Proxy Manager, Portainer, PhotoPrism or another
  session-login app now says why (such as "Login returned HTTP 401"), and a
  reply that is not JSON says so, on the card and in Test, without quoting
  the reply.
- A password, token or user name that a custom integration's endpoint fills
  in through `{token}`, `{password}` or `{username}` is now URL-encoded, so
  one with `&`, `#`, `/`, `?`, a space or `@` arrives intact instead of being
  cut short or sent to the wrong path. Write credentials in `services.yaml`
  as they are: one you encoded by hand is now encoded twice, so write it
  unencoded again.
- A failed backup now pages as critical, at high priority on Android, the way
  the board already shows it. A failed job that isn't marked as a backup is
  still a warning, and so is a backup that is only overdue.
- When JagHelm can't reach its server, or the server's status has gone out of
  date, nothing on screen keeps the last status's green, amber or red. The
  header, the Overview's attention panel, the subsystem strip and the
  Infrastructure section turn grey with a hollow lamp and say "No signal ·
  last known 3 min ago", followed by what the status last said, such as "All
  systems normal". The last issues, counts and node readings stay on screen,
  grey, so a short outage doesn't blank the page; every age counts on
  together, and the colours come back with the next answer. The Alerts page
  follows the same rule. A status that has gone unanswered for too long
  counts as out of date too, so a tab opened again after hours, or a laptop
  woken from sleep, shows grey at once rather than hours-old colours until
  the next answer. Screen readers hear "No signal" once, not every second
  of the age, and a grey lamp is read as "No signal", not as its last word.
- On a phone, the Overview's subsystem strip now sits between the status and
  the list of issues: the status and its sentence, then the strip, then the
  issues. In an incident with many issues the strip stays on screen at the
  top instead of dropping below the fold. The keyboard and screen readers
  follow the same order. Tablets and desktops are unchanged.
- The server's access log now records every change at the default log level:
  a request that saves or deletes something, a cron job's report and a
  sign-in each log one line with its method, path and status, where before
  only a failed or slow one did. Requests that fail (`4xx`, a refused sign-in
  or an expired session included) and requests that take 300 ms or more are
  logged as before. A successful read that answered quickly, such as the
  dashboard's own refresh every 30 seconds, is logged only with
  `LOG_LEVEL=debug`, which still shows every request.
- From 1440px the Overview loads its side rail (Quick Launch, Pipeline, the
  Checklist, weather and the clock) on its own, so a phone's first load is
  about 4 kB smaller.
- Each tile of the Overview's strip now shows its count large, with what it
  counts on a line under it, as the design draws it: "31 / 32" over "up · 1 in
  maintenance", and the UPS's "On battery" over "64 % charge". A tile with a
  problem names it there instead ("1 down · 1 no signal", "1 overdue"). The Power tile
  shows the charge on mains too. When a window is too narrow for six tiles side
  by side, they sit in two rows of three. With no signal, the tiles no longer
  each say how old the status is: the header says it once.
- After updating, reload any JagHelm tab that was already open: until then
  its display settings can't be saved.
- JagHelm's status now carries the UPS's runtime left while it is on battery,
  so the Android app reads it there instead of asking for the UPS separately.
  On a phone, the web's UPS sheet shows it from there too ("21 min left"), and
  a refresh no longer reads the UPS's own readings. `/api/ups` stays as it is
  for apps already installed.
- Moving an integration to a new address (another host, port, or http to
  https) now means typing its password or token again. Save and Test refuse
  a new address with the credential left blank, and say to re-enter it for
  the new address; so does a save of the whole config in Settings.
- On a phone, the header at the top of JagHelm in the browser is now the one
  from the phone design: JagHelm's logo and name, and the light and dark
  theme button, larger and easier to tap. The status is said once, in the
  Overview's status card, not again in the header. Settings and Log out are
  under More, and the Services tab has its own search. Tablets and desktops
  are unchanged.
- JagHelm keeps its Arcane state in `data/push-snapshot.json`. The first start
  after this update reads `arcane-state.json`, `arcane-held-back.json` and
  `arcane-vuln-state.json`, so nothing is announced again, and leaves them in
  place for a rollback; rolling forward again after one announces nothing the
  older version already did. You can delete them once you won't roll back.
- If `data/push-snapshot.json` can't be read, the log now also says that
  Arcane starts over: its changes since then aren't sent, and an Arcane
  release or offline agent already sent may be sent again.

### Deprecated
- The unprefixed names of the integration and Gitea variables (`GITEA_URL`,
  `GITEA_TOKEN`, `NPM_URL`, `SONARR_API_KEY` and the rest) still work in
  4.0.0, with one warning each in the log at start; a later release drops them
  and reads only the `JAGHELM_` names. Rename them in `.env`. When both names
  are set with different values, the `JAGHELM_` one is used.

### Removed
- `/metrics` no longer exports Node.js process metrics (`process_*` and
  `nodejs_*`). Sampling the event loop every 10 ms cost about 0.2% of a CPU
  core even when idle, and the CPU and memory figures repeat what the
  container's own metrics (cAdvisor, `docker stats`) show. The request, latency,
  cache-age, refresh-loop and sign-in failure series stay; if a dashboard or
  alert of yours reads a `process_*` or `nodejs_*` series, point it at the
  container's metrics instead.
- The welcome message under the navigation bar.
- The theme button in the navigation bar: pick a theme in Settings → Appearance
  or the command palette (Ctrl K, ⌘K on a Mac).
- The weather, the clock and the web search box that sat in the navigation bar,
  for now: they come back in the Overview's side panel and the Launch page.
- The ten editor-inspired themes, which didn't all have readable contrast.
- The free accent colour picker in Settings → Appearance: the accent is violet
  for now, and a choice of violet, fuchsia and cyan comes later.
- The title and subtitle under the logo on the sign-in page: the logo already
  says JagHelm and "Infrastructure Dashboard".
- The old grid board under the Overview's sections is gone, with its drag,
  resize and saved layout, and Settings → Layout's grid columns,
  Auto-arrange, Reset and Collapsible sections. Everything it showed has a
  home: the nodes in Infrastructure and their Proxmox VMs, storage pools and
  last backup in each node's panel; the UPS in Power; Scheduled Jobs in the
  Jobs section and each job's panel; Quick Launch, Pipeline and the
  Checklist beside the Overview from 1440px wide and on the Launch page.
  Arranging the Overview comes back as an Edit layout mode.
- Settings → Sections' titles, subtitles, icons and colours for the old
  board's panels, and its UPS switch; Settings → Widgets' "Show scheduled
  jobs panel"; and the Settings live preview, which showed the old board.
  The Power and Jobs sections' switches are in Appearance → Overview
  sections.
- Settings → Nodes has no Icon field: a node is marked by its name, its role
  and its colour. A node's saved icon is dropped the next time Settings saves
  `services.yaml`.
- Settings → Typography's font-size sliders, which sized only the old
  board's panels.
- Settings → Widgets no longer has a "Show checklist panel" switch. It never
  hid the Checklist, so nothing you see changes; the Checklist's switch is in
  Settings → Sections.
- A custom group's icon and colour options, which no longer drew anything,
  and its hidden setting: a hidden group could hide a service that is down.
  Choose which Overview sections show in Settings → Appearance.

### Fixed
- The integration variables now work under the `JAGHELM_` names the docs
  gave (`JAGHELM_NPM_URL`, `JAGHELM_SONARR_API_KEY`, …); only AdGuard's,
  Cloudflare's and PhotoPrism's did. The Pipeline panel's Gitea is
  `JAGHELM_GITEA_URL` and `JAGHELM_GITEA_TOKEN`.
- The Pipeline panel shows each repo's commits on its default branch, so a
  repo whose default branch isn't `main` no longer shows nothing.
- The UPS panel shows a UPS of any name. It read only one named `apcups`;
  with several, it shows the first by name that has a reading, unless
  `JAGHELM_UPS_NAME` names one.
- The Overview no longer jumps as it loads on a phone. The sections under the
  status used to be drawn first and then pushed down by the status when it
  arrived; now the page fills in from the top. On a phone the board's panels
  are drawn at their own height from the first frame, instead of at a saved
  height and then grown; on wider screens each panel keeps the room it took
  last time while its content comes in.
- A word too long for a tile of the subsystem strip ("maintenance", with six
  tiles in a row) breaks onto the next line instead of being hidden under the
  tile beside it.
- The weather, the clock and the web search are back; 3.0.0 dropped them with
  the old header. On a window 1440px wide or more, the weather and the clock
  sit at the top of the column beside the Overview's sections. The Launch page
  has them at any width, with the web search beside them, which opens your
  search engine's results in a new tab. They follow Settings → Widgets as
  before: the weather shows once it is switched on and has a place.
- The README and the getting-started guide now show the `compose.yaml` JagHelm
  ships: a bridge network with port 3099 published and the container hardening,
  plus the step that makes `data/` and `uploads/` writable by the app's user.
  They used to call host networking the default.
- Deleting an integration now deletes its stored password, token and URL
  too. They used to stay behind, and an integration added again under the
  same name quietly used the old credential. Adding an integration also
  clears any left under its name by an earlier delete.
- Renaming an integration no longer deletes a stored password that another
  integration uses too.
- An integration save that can't be written to `services.yaml` (a full disk,
  or the file changed or broken by hand at that moment) no longer leaves the
  password or token you typed stored. Nothing is saved, and saving again
  once the problem is fixed works as before.
- A password or token that can't be written to `secrets.json` now fails the
  save. It used to be reported saved and was gone after the next restart.
- A save in Settings no longer strips the comments from a `services.yaml` you
  wrote by hand. Toggling an integration, or saving the Nodes or Services tab,
  changes only the lines of what changed: your comments, blank lines and
  quoting stay, with the spacing evened out (two-space indents, one space
  before a comment at the end of a line). A file that uses YAML anchors,
  aliases or merge keys is still rewritten whole without its comments, and the
  log says so.
- A Settings tab left open from before a change can no longer undo it. Saving
  Nodes or Services used to send back the whole configuration as that tab
  last read it, so an integration added, a credential stored or a node edited
  since, in another tab, in Settings → Integrations or in `services.yaml` by
  hand, was deleted. Now such a save is refused: Settings says "Settings
  changed elsewhere; reloaded" and shows what is stored, and you make your
  change again.
- A hand edit that leaves `services.yaml` unreadable, such as one indentation
  slip, can no longer be overwritten by a save. Adding an integration or
  saving in Settings used to rewrite the file from the last good copy (at
  startup, an empty one), losing everything else in it. Now Settings says
  which line doesn't parse and saves nothing until you fix the file.
- Testing a custom integration no longer requests `<url>undefined`: it is
  tested at its endpoint from `services.yaml`.
- Testing an integration you are editing no longer needs its password or
  token typed again: a blank one tests the stored one, as Save keeps it.
- An integration whose stored password or token can't be read (its secret is
  gone, or won't decrypt) no longer sends a request with it left empty, which
  failed the login and then held the integration as "login refused twice".
  It sends nothing, its card says to enter the credential again, and it is
  retried as soon as the secret is back or the credential is saved again in
  Settings. This now holds for every kind of login, as it already did for a
  credential in the URL.
- A container that stopped, and was the last one a Kuma monitor ran on, no
  longer shows as critical while that monitor is up, such as the old name of a
  container redeployed under a new one. It is a warning, like any other
  missing container, and its reason says the monitor is up. While the monitor
  is pending it shows "No signal", and while it is in maintenance it shows
  "Maintenance". While the monitor is down, the board has one critical issue
  for the outage, the monitor's, not a second one for the container.
- An outage whose monitor's container was stopped under another name now
  pages. When a monitor went down after its container stopped, and the
  container no longer matched the monitor by name (its `services.yaml` mapping
  removed), the board showed it twice and no alert was sent, nor its recovery.
- A container whose Kuma monitor is paused no longer leaves the board when it
  stops, and is no longer described by that monitor's last state: it is a
  missing container like any other. This applies to Uptime Kuma versions read
  through the status page, which still list paused monitors.
- When JagHelm can't work out the status (an input its status check can't
  read), push no longer goes silent without telling anyone. After two checks
  in a row it sends one "JagHelm status check failing" alert, at high priority
  and whatever your category switches say, and one "JagHelm status check
  recovered" when it works again, along with anything that changed meanwhile.
  A single failed check sends nothing, and a restart while it fails doesn't
  send the alert twice. `/api/health` now has a `statusModel` field that says
  `degraded` while this lasts, with the kind of error and since when.
- The phone now alerts for a node that is already in trouble when JagHelm first
  sees it, such as one just added to `services.yaml`: unreachable, or with a
  reading over its line, it sends one alert. A new node that is healthy sends
  nothing, where it used to send "Host recovered".
- The phone now alerts when the UPS goes on battery even if JagHelm had never
  read its state before, for example because the NUT exporter had been quiet
  since JagHelm started. A quiet exporter during a power cut still sends no
  second alert and no false "back on mains".
- When JagHelm starts without its saved alert state (a first run, or a missing
  or damaged file), the phone now gets one alert for each problem that is
  already open, instead of none.
- On a new install with nothing set up yet, the header and the Alerts page say
  "Nothing monitored yet" as a quiet line, instead of a grey "No signal" alarm
  about nothing being wrong.
- A new install that can't reach Prometheus (a wrong `PROMETHEUS_URL`) says
  "Prometheus unreachable" in the header, not that nothing is monitored.
- A reading is written the same way everywhere: rounded down, so a disk at
  94.6 % reads "94 %" beside its 95 % line on the new Overview's meters, as it
  already did in the status and in push notifications, never "95 %". With a
  line set to a fraction under `pushThresholds` (`0.875`), the readings beside
  it show its decimals ("87.6 %" over an 87.5 % line, no longer "87 %"), and
  the UPS charge in a status reason or push is rounded down too.
- A reading exactly on a warning or critical line set with a decimal under
  `pushThresholds` (`0.913`, a 91.3 % line) now counts as on it. For about one
  such line in eight, rounding inside the server judged it just under, so no
  warning and no push.
- `env.example` no longer sets the two required URLs to `localhost`, which a
  container on the default bridge network can't reach; it now uses placeholders
  and says which addresses work.
- When JagHelm starts without its saved alert state (a first run, or a missing
  or damaged file), the phone gets its alerts from the first minute again. It
  used to send nothing until Prometheus and the UPS reading both answered, so
  a service going down or a job failing in that time was never sent, and if
  only the UPS reading kept failing, nothing was sent at all.
- Starting during a Prometheus outage without the saved alert state now sends
  the "Monitoring source down" alert after a minute, and one when Prometheus is
  back; the nodes then alert once if they are in trouble.
- A node reading that misses a cycle, such as a temperature sensor that answers
  only some of the time, no longer ends its alert and starts a new one: a
  temperature at 78 °C, then no reading, then 73 °C and 76 °C sends one alert
  and no "back to normal". While there is no reading, the node keeps its
  warning, and its reason says there is no reading instead of showing a number.
  CPU's two cycles over its line also count across a missed cycle. A reading
  that never comes back keeps its warning until it is read again, the node is
  removed from `services.yaml`, or 24 hours pass.
- An editor that empties `services.yaml` for a moment while saving it no
  longer clears the board for one refresh and then pages every open problem
  again as new. A `services.yaml` that can't be parsed, or reads empty or as
  something other than a mapping, keeps the last good config until the file
  changes again.
- A `services.yaml` that can't be parsed when JagHelm starts is no longer
  taken for a first boot, so discovery no longer writes a new file over it.
  The board starts empty, and fixing the file brings it back.
- A Proxmox storage pool over its line no longer sends a false "back to normal"
  and a second alert when the Proxmox integration fails for a while: 93 %, a
  failed fetch, 88 % and 93 % again is one alert. While the fetch fails, the node
  keeps its warning, and its reason says the pool has no reading instead of
  showing a number. This holds across a restart of JagHelm.
- A pool that Proxmox lists with no size, such as inactive storage, is no
  longer read as 0 %, so it never ends a warning.
- A pool over its line that Proxmox no longer lists now sends one "back to
  normal" and leaves the node's warning, once a fetch succeeds without it. So
  does a pool whose Proxmox integration is removed, disabled or pointed at
  another node.
- A node reading that stops reporting while over its line, such as a sensor
  that was removed, no longer keeps its node at warning forever. After 24 hours
  with no reading, the warning leaves the board quietly, with no "back to
  normal" notification since nothing was read. The same goes for a Proxmox
  storage pool listed with no size. If the reading later comes back over its
  line, it alerts once, as new. The 24 hours count from the first missed
  reading, across restarts of JagHelm. A reading whose query or Proxmox read
  keeps failing is not cut off this way: it keeps its warning while the
  failure lasts, which the board shows as its own problem, and its "back to
  normal" is sent once it reads normal again.
- JagHelm starting while Prometheus has just started and not collected
  anything yet (both coming up after a host reboot) no longer alerts that
  every node is unreachable and then that each one recovered. That includes a
  node Prometheus has read only in part, such as one whose container
  collector it reached before that was listening. Each such node shows "No
  signal" with the reason "not scraped by Prometheus yet" until Prometheus has
  read it. A node Prometheus doesn't monitor at all still sends its "Host
  unreachable" alert, once, and a node that is really down sends it at most
  one Prometheus scrape later than before.
- Prometheus collecting but storing nothing (its disk full) alerts once that
  Prometheus is failing, naming the nodes, and not that every node is
  unreachable, even right after JagHelm restarts.
- When a node has no reachability data, or reads as down, JagHelm now also
  reads Prometheus's list of targets. A proxy in front of Prometheus that
  blocks that list makes Prometheus show as failing, with the reason, instead
  of a node with no data alerting; a node Prometheus reads as down still
  alerts.
- A node whose Prometheus target never gets its first scrape (a stuck scrape
  pool, a target that never resolves) no longer shows "No signal" forever with
  no alert. After 3 of the target's scrape intervals Prometheus shows as
  failing, naming the target, and sends one "Monitoring source down" alert and
  one recovery, also across a JagHelm restart. Only that node waits for
  Prometheus: a container that stops on another node still shows as
  missing, and a node or service you remove still goes.
- With a Prometheus-compatible backend that gets its series through
  federation or remote write (Thanos, Mimir, a federating Prometheus),
  losing every node's data alerts once that Prometheus is
  failing, not that every host is unreachable. The README lists the supported
  Prometheus setups.
- A signed-out tab stops polling and asks you to sign in. When a session ends
  (24 hours after signing in, or when the server restarts), an open dashboard
  kept asking the server for data every 30 seconds and was refused each time,
  for as long as the tab stayed open. It now shows the sign-in screen once and
  asks nothing more until you sign in again, which brings the dashboard back.
- A board panel fits its content again when the content changes without the
  panel moving: when the fonts load late on a slow device, data arrives, or a
  line goes. A panel could stay a row too tall, or too short, cutting off its
  last line (the Checklist, on a phone).
- Under "No signal", "last known 3 min ago" now says how old the status
  really is, counting from when the server built it, not from when the page
  last heard from the server, and the header's "Updated" time says the same.
  When the server's own status had gone out of date, the header and the
  attention panel said it was younger than it was. A clock on the server or
  on your device that is off no longer shifts the age.
- Switching Settings tabs, or leaving Settings, right after an edit to Nodes
  or Services no longer loses your next edit. The next change used to be
  refused with "Settings changed elsewhere; reloaded" although nothing had
  changed elsewhere. Now both edits are saved, and a real change elsewhere is
  still caught.
- Closing the browser tab within a moment of a Nodes or Services edit now
  asks first instead of losing the edit, and a save the server never answers
  gives up after 15 seconds and says so instead of holding up every later
  save.
- A `services.yaml` that doesn't parse no longer looks like an empty, healthy
  board. The header and the attention panel say "services.yaml doesn't parse
  (line 4)", with the line, the phone gets one "JagHelm config broken" alert
  after about a minute (whatever your category switches say) and one "JagHelm
  config fixed" when the file loads again, and `/api/health` has a `config`
  field: `unparseable` with the line while it lasts, `ok` otherwise. The same
  goes for a `services.yaml` that is empty or isn't a mapping. None of it
  quotes the file.
- A custom group in Settings → Sections now holds each service on its own
  node: grouping AdGuard Home on one Pi no longer takes the other Pi's too.
  The list shows every service by name and node, and a Kuma monitor with no
  container can now be grouped. A group made before keeps the services it
  showed, and is saved the new way the next time you change it.
- A merged change now always reaches the server, even when its image is built
  late. A check every five minutes deploys the newest merge whenever the server
  runs something else. A deploy that only waited for an image no longer fails:
  a failure now means a build that never came, or a deploy that broke.
- A `services.yaml` JagHelm can't read (its permissions, a directory in its
  place, a disk error) no longer looks like an empty, healthy board. The
  header and the attention panel say "services.yaml can't be read
  (permission denied)", the phone gets one "JagHelm config broken" alert,
  `/api/health` says `unreadable`, and Settings saves nothing over it. Fix
  the permissions and JagHelm reads it again within 30 seconds, no restart
  needed, with one "JagHelm config fixed".
- A broken `services.yaml` that gets deleted no longer leaves the board
  saying it doesn't parse until a restart: the warning clears within a few
  seconds, and the next save in Settings writes a new file.
- If the file was already broken when JagHelm started, deleting it leaves an
  empty board; restart JagHelm and it discovers your nodes again.
- A word in a strip tile no longer breaks in the middle ("maintena-nce") in
  windows 1024 to 1440 px wide.
- At the 10 s refresh interval, a board panel could now and then say
  "updated 20s ago" while its source was answering every poll.
- After the computer wakes from sleep, a board panel's "updated 5m ago" now
  goes as soon as its source answers, not one refresh later.
- A browser or tab left open from before a change to the display settings
  can no longer undo it. Hiding an Overview section on one device and then
  changing anything on another that hadn't reloaded used to bring the
  section back, since the second device saved its whole old copy. Now the
  second device's save is checked against what is stored: JagHelm keeps the
  other device's changes, adds only what you changed, and says "Merged with
  changes from another device". If it is refused twice in a row, it shows
  what is stored and says "Settings changed on another device; reloaded".
- A change to the display settings made just before closing the tab is no
  longer lost when its save didn't get through: it is saved the next time
  JagHelm opens in that browser, keeping what other devices changed since.
- A `display-config.json` broken by a hand edit (one stray comma) no longer
  reads as empty: a device's next change saves its whole copy over it, never
  just that change. A file JagHelm can't read keeps each device's settings
  as they are, and saving says why.
- A value edited by hand into `display-config.json` that Settings can't save
  (a `javascript:` link, a reserved key, an Overview section switch that
  isn't true or false) no longer makes every later save fail: that value
  alone is left out, the log names where it was, and the next save removes
  it from the file.
- When `services.yaml` can't be read, a Settings save now says why at once,
  as it does for a file that doesn't parse, instead of reloading the page
  first.
- On a phone, while the web's view of JagHelm is out of date, the UPS sheet no
  longer shows a runtime left from back then.
- Widening or narrowing the window, or turning a tablet, no longer shows the
  board's panels cut short for a moment: each panel is drawn at its content's
  height in the first frame at the new width, not at its saved height or the
  height it had at the old width. Panels still glide to a new place, but take
  a new size at once.
- A first start while Prometheus is down, or before it has scraped any host,
  no longer leaves an empty board for good. JagHelm saves no `services.yaml`
  until it has found a node, asks Prometheus again every refresh, and adds
  the nodes as soon as there are some, with no restart or hand edit. A
  `services.yaml` that is already there, or that you save in Settings
  meanwhile, is yours and is never rediscovered over. `/api/health` says
  `discovering` while it waits, and the board's empty state ("Waiting for
  your first node") and Settings → Nodes say the nodes will come by
  themselves.
- When the server can't reach Google, the dashboard keeps updating and
  `/api/health` stays healthy. Before, every refresh waited for its phone
  notifications to be sent, which could take minutes with the internet down:
  the board stopped updating and `/api/health` answered 503, which could fail a
  deploy's health check.
- A notification Google doesn't take (no internet, Google failing, the
  service-account key refused) is no longer lost. The server keeps it, with
  any that follow, and sends each phone its notifications in order once Google
  answers, also after a restart. One phone Google keeps failing no longer holds
  up the others. A problem that cleared before its alert went out sends
  neither the alert nor its "recovered". The server keeps at most 100 waiting
  alerts; past that it drops the oldest and logs which, but never a
  "recovered" for an alert the phone already shows.
- When the server can't reach Google, Arcane polling and the weekly
  vulnerability digest no longer stall, and an Arcane notification is no
  longer lost. They wait with JagHelm's other notifications and go out in
  order once Google answers, also after a restart. A restart or crash no
  longer drops one, nor makes Arcane news found before it be announced again.
  An agent that disconnects and reconnects before either notification went
  out sends neither.

### Security
- The access token the server gets from Google with the service-account key can
  now only send notifications; before, it was also valid for the Google Cloud
  APIs the service account could use. The key never leaves the server, and
  neither it nor the tokens made with it are ever logged.
- Sessions are kept in `data/sessions.json`, readable only by the user
  JagHelm runs as. It holds a SHA-256 of each session token, never the token,
  so a copy of the file (a backup, say) signs nobody in. Logging out and
  changing the password in Settings are saved at once and still hold after a
  restart; on a disk that can't save a log-out, it answers an error until it
  can, and the Android app sends it again. Changing `DASH_PASS`, `DASH_USER`
  or `DASH_SECRET`, or removing `data/auth.json`, signs every device out at
  the next start. To sign every device out without changing the password,
  stop JagHelm, delete `data/sessions.json` and start it again.
- Signing in with a user name or password that is not text is refused.
- Failed sign-ins no longer lock everyone out. Before, 50 failures from
  anywhere blocked every sign-in for 15 minutes, so anyone on the network could
  lock you out. Now failures slow down only the address they come from: after
  5 in a row it waits 30 seconds, doubling with each further failure up to 15
  minutes, and a sign-in clears it. Guesses from many addresses at once share
  one budget, at most 130 an hour. During such an attack a brand-new address
  can be kept waiting for as long as it lasts, and a restart doesn't help; the
  16 addresses you signed in from most recently, kept across restarts, and
  those in `LOGIN_TRUSTED_NETS` skip that wait. The sign-in page and the
  Android app say how long to wait.
- A `PROMETHEUS_URL`, `KUMA_URL` or `GITEA_URL` with a user name or password
  in it, however written, is now refused at boot. JagHelm never requests or
  logs it, warns once without the value, and the board shows that source as
  off ("Kuma off") with the variable named and where the credential goes
  instead (`KUMA_API_KEY`, `GITEA_TOKEN`; Prometheus takes none).
  `/api/health` lists it under `sourceUrls`. Such a URL never worked, so no
  working setup changes, unless a path held a raw `@` after a port (write it
  `%40`).
- An integration's URL from its `.env` variable or its stored `url` secret
  is checked the same way as one typed into Settings. One carrying a
  credential is never requested, and the integration's error names the
  variable or the secret, never the value. `ARCANE_URL` is refused the same
  way, and Settings now also refuses a password of digits followed by a raw
  `/`, `#` or `?` (`http://user:1234/x@host`).
- The server log now also hides a password made of digits followed by a raw
  `#`, `/` or `?` (`http://user:1234#x@host`), which the URL parser reads as a
  host and port.
- A field in Settings → Integrations can no longer name a stored secret. A
  username such as `$secret:<another integration's key>`, with the URL
  pointed elsewhere, sent that secret there, on Test at once and after Save
  at the next refresh. A `$secret:` reference in any field is now refused,
  unless it is the one already stored in that field.
- An integration's URL can no longer carry a user name, password or key
  (`https://user:pass@host`, `?key=`, `?apikey=`, `?token=` and the like).
  Such a URL never worked; it was stored, sent back to the browser and
  logged. Save and Test now refuse it, with a message beside the URL field
  that says which field the credential goes in. One already in
  `services.yaml` is not requested: its card says where to move the
  credential, and Settings shows the URL empty, to be entered again without
  it.
- A `services.yaml` that doesn't parse is no longer logged with the lines
  around the bad one, so a password or token written near it no longer
  reaches the log (and Loki). The log and Settings now say why it doesn't
  parse and where (line and column), without quoting the file. The same goes
  for a damaged `secrets.json`, `auth.json` or `display-config.json`.
- Logging out now ends the session on the server as well as in the browser.
  Before, a copy of the session token (from a shared computer, a HAR file, a
  proxy log or a screenshot) kept working after you logged out, until it
  expired 24 hours after sign-in or the server restarted. Your other sessions,
  such as the Android app, stay signed in. The dashboard logs out at once, even
  when the server can't be reached.
- A stored password or token now goes only to the address it was entered
  for. A signed-in session could send any stored credential to another
  host, by changing an integration's URL and keeping its stored credential,
  or by naming another integration's `$secret:` in the config. Now an
  integration whose stored credential isn't for its address sends nothing,
  and its card says to re-enter the credential for this address. At the
  first start after updating, each stored credential is bound to the
  addresses of the integrations that use it; one no integration uses is
  bound to none. Credentials in `.env`, or typed into `services.yaml` by
  hand, go wherever the URL points, as before.
- Every request an integration makes now stays on its URL's host and port.
  An endpoint in `services.yaml` that leads onto another host is not
  requested, and its card says so. A login session is kept per
  integration, so another integration on the same address no longer reads
  with its token.

## [3.0.0] — 2026-10-20

Push alerts and the new `/api/status` now come from one status model, so a Prometheus restart no longer floods the phone; JagHelm asks Prometheus 14 queries per refresh instead of 90, runs on Node 26, and has the redesign's building blocks in place, not yet on screen.

### Breaking changes
- Running the server from a checkout (`node server/index.js` or `npm start`)
  instead of the image now needs Node 26, the version in `.nvmrc`. Under Node 22
  the Proxmox integration fails every request with `fetch failed`. The image
  ships its own Node, so a Docker deployment needs nothing.

### Added
- `/api/services` gives each container's network traffic as a rate:
  `docker.rxBytesPerSec` and `docker.txBytesPerSec`, bytes per second over the
  last 5 minutes. `docker.rxMB` and `docker.txMB` stay as they were, the
  cumulative total in MiB, until the old endpoints are retired. A rate reads
  high for up to 5 minutes after a container is recreated.
- `/api/integrations` gives each integration a `_status`: `state` (`ok`,
  `backing_off` or `auth_failed`), `since` (when that state began),
  `failures` (failed attempts in a row) and `nextAttemptAt` (when it will be
  tried again; null when it is fetched every refresh, or waits for a settings
  change). Times are milliseconds since the epoch. The dashboard does not read
  it yet.
- `services.yaml` can map a container to a different Uptime Kuma monitor on
  each machine, with `monitor_per_node:` under its entry (keyed by the node
  keys under `nodes:`), and `monitor: false` gives a container no monitor at
  all. `monitor_per_node` wins over `monitor` on its node. JagHelm logs one
  warning for a `monitor_per_node` key that is no node.
- DEMO_SCENARIO=healthy serves the demo board with nothing down. The default,
  incident, has one service down and a failed backup job.
- `JAGHELM_ICON_CACHE_MAX_MB` sets how much the icon cache (`icon-cache/` in the
  data dir) keeps, in MB. It defaults to 50. Past it the least recently used icon
  is deleted, and it is fetched again the next time it is shown.
- `JAGHELM_HOST` sets the address the server listens on. It defaults to `0.0.0.0`,
  every IPv4 interface, as before, so nothing changes unless you set it. With
  `network_mode: host`, `127.0.0.1` keeps JagHelm to its own host, for a reverse
  proxy there; in a bridge-network container keep the default (see `env.example`).
  An address the server can't listen on stops it with a `cannot listen` error.
- The redesign's controls are built, in the signed-off look, in light and dark:
  buttons, icon buttons, text fields, selects, switches, checkboxes, fields with
  their help and error text, segmented pickers and tabs, each usable by keyboard
  and screen reader. Nothing on screen uses them yet, and today's screens look as
  before; the stylesheet the browser downloads grows by about 0.45 KB compressed.
- The redesign's containers are built, in the signed-off look, in light and
  dark: panels, dialogs, a detail drawer, a confirm that names what it removes
  by its display name, popovers, tooltips, toasts that screen readers announce,
  cause-naming banners, empty states and loading placeholders. Each works by
  keyboard and screen reader and respects reduced motion. Nothing on screen
  uses them yet, and today's screens look as before; the stylesheet the browser
  downloads grows by about 1 KB compressed.
- The redesign's status components are built, in the signed-off look, in light
  and dark: status lamps with a shape for each state (a filled disc for OK, a
  slashed disc for a warning, a disc with a bar for critical, a hollow ring for
  no signal and a wrench for maintenance), status words and badges, issue rows,
  the subsystem strip and the attention panel. A status is always a shape and a
  word as well as a colour, and screen readers say it. The banners and toasts
  show their status with the same lamps. Nothing on screen uses them yet, and
  today's screens look as before; the stylesheet the browser downloads grows by
  about 1.2 KB compressed.
- The redesign's data components are built, in the signed-off look, in light
  and dark and both densities: usage meters that stay in the accent colour
  until a threshold and then turn amber or red, with the threshold marked on
  the bar; a one-line trend chart whose value and time show under the pointer
  or with the arrow keys; a heartbeat strip where only failures light up; rows
  for services and nodes whose name is never cut short before the rest; a
  list of an item's facts; and a table for the keyboard and screen readers,
  with numbers lined up on the right. Nothing on screen uses them yet, and
  today's screens look as before; the stylesheet the browser downloads grows
  by about 0.6 KB compressed.
- Backups are their own area in `/api/status`, beside Jobs, once you say which
  jobs are backups: list them in `display-config.json` as `backupJobs`, for
  example `["pve:proxmox-backup"]` for the Proxmox backups the PVE webhook
  reports. A backup whose last run failed is critical, and one that missed its
  schedule a warning. Their push notifications are unchanged. Jobs not in the
  list stay jobs, as before.
- An Arcane agent that goes offline now shows in `/api/status` as a warning
  under Integrations, and clears when it is back. Its push notification is
  unchanged.
- `GET /api/status` serves the server's view of everything JagHelm watches:
  one overall sentence, the ranked list of issues, a summary per area
  (Services, Nodes, Power, Jobs, Backups, Integrations), every service, node,
  UPS, job and integration with its state and the reason for it, and whether
  Prometheus, Uptime Kuma and the NUT exporter are answering. It sends an ETag
  and answers 304 while nothing has changed. It sits beside `/api/services`,
  `/api/ups` and `/api/cron/status`, which keep their shape and meaning, so
  installed Android apps keep working.
- When Prometheus, Uptime Kuma or the NUT exporter stops answering for two
  refreshes in a row (about a minute), one "Monitoring source down" push says
  so, and one "Monitoring source recovered" push follows when it answers again.
  Nothing it watches sends a push while it is down. It follows the Hosts,
  Services or UPS notification toggle respectively.
- The redesign's chart colours are defined, as signed off: six colours for the
  lines and bars of different nodes or disks (azure, rose, lime, plum, orange
  and teal), and a scale of blues for amounts, in dark and light. They stay
  apart for people with red-green colour blindness, never look like a status
  colour, and don't change with the accent. Nothing on screen uses them yet;
  the stylesheet the browser downloads grows by about 0.2 KB compressed.
- `PATCH /api/integrations/<key>` with `{ "enabled": true }` or
  `{ "enabled": false }` enables or disables an integration and changes
  nothing else in its `services.yaml` entry. The Enable and Disable buttons in
  Settings use it.

### Changed
- The server image is smaller: 235 MB unpacked instead of 270 MB, and 69 MB to pull instead of 75 MB. It now runs on plain Alpine with only the Node binary and its licence notices taken from the Node image, so npm, npx, yarn and corepack are no longer in it (the server and its health check only ever run `node`), and the image build fails if one comes back. Dropping npm also drops the 13 fixable high and critical findings in the packages it bundles, so they leave Arcane's weekly vulnerability digest for JagHelm's image too; the 2 left are in Alpine's `libssl3` and `libcrypto3` (there before too), which Node doesn't use, since it carries its own OpenSSL. The Arcane dry run (`scripts/arcane-poll-once.js`) is left out of the image too; it runs from a checkout, as `docs/arcane/SETUP.md` describes.
- The server no longer writes two log lines on every refresh cycle, which were most of what it logged. "background cycle complete" and "Loaded monitors from Kuma" are now debug lines (set `LOG_LEVEL=debug` to see them; see `env.example`). A cycle is still logged at info when it takes 5 seconds or more, or when the set of refreshes that failed in it changes (Gitea or an integration starting or stopping failing, for example), so a new failure and its recovery each get one line; a refresh that keeps failing still logs its own error every cycle. Loading Kuma's monitors is logged at info when the number of monitors or where they are read from changes, and on the first load after a failed one. Kuma answering with no monitors (for example an error status from its status page) now logs one warning per outage; a Kuma that can't be reached still logs an error every cycle. Containers with no matching Kuma monitor are listed in one line per boot instead of one line each.
- JagHelm now asks Prometheus 14 queries per refresh instead of 90 with six
  hosts, and the number no longer grows with each host added: each reading is
  one query for every host. A host without a `/` filesystem, such as a NAS, is
  no longer asked for one every refresh before its largest filesystem is read.
- The web dashboard no longer polls the server while nobody can see it: a hidden browser tab, the Settings page or an iframe tab pauses it, and coming back to the dashboard refreshes it at once. Each refresh now makes 4 requests instead of 7. The header health dot reads the dashboard's own `/api/services` result instead of fetching it a second time, so it holds its last value while polling is paused and updates on return; the first load no longer fetches everything twice. Sparkline history, cron job status and Gitea activity refresh in turn, each every third refresh (every 90 seconds at the default 30-second interval), and the cron and Gitea panels show the "updated … ago" stale note after 3 minutes without an update instead of 1 minute. Weather refreshes every 10 minutes instead of on every refresh.
- `/api/history` now sends an `ETag` and answers a matching `If-None-Match` with `304 Not Modified`, and `/api/cron/status` sends `Cache-Control: private, max-age=60`.
- An integration that fails is no longer fetched every refresh. It is retried
  after 30 seconds, then 1, 2, 4 and 8 minutes, then every 10 minutes until it
  answers, and shows its last error in between. A failing integration no longer
  slows the refresh of the others while it waits.
- Each Uptime Kuma monitor now marks one container, the best match by name,
  instead of every container whose name resembles it. "Gitea" goes to `gitea`
  and no longer to `gitea-runner` too; "Immich" goes to `immich-server` and no
  longer to its Redis, Postgres and machine-learning containers; a container
  running on two machines gets the monitor on the first machine in the board's
  order. The containers that lose a monitor show their Docker status and the
  "unmonitored" label. To have a monitor mark several containers, map each of
  them to it; to keep it on one machine's copy, use `monitor_per_node`.
- A monitor named in a mapping now goes only to the containers mapped to it,
  also while they are stopped or gone, and a container mapped to a monitor that
  Kuma does not have (renamed, deleted or paused) shows no monitor, instead of
  taking whichever monitor its name resembled. JagHelm logs one warning per
  such mapping after it starts.
- A stopped container keeps its monitor only while the monitor is down. Once
  the monitor is up, a running container can have it, and the stopped one
  leaves a grey "last seen" card, as a stopped container with no monitor of its
  own does.
- JagHelm no longer rewrites files in its data dir on every refresh cycle when nothing has changed, which wore SD-card and eMMC storage. The push alert snapshot (`push-snapshot.json`) is now written when an alert state changes (a service, cron job or UPS status, a host's reachability, or a host metric crossing its threshold) and on shutdown. The container registry behind the "last seen X ago" cards of containers that disappeared (`container-registry.json`) is written when a container appears, moves to another node, has run for a minute or is dropped, and otherwise at most every 5 minutes and on shutdown. Neither it nor `service-registry.json` is rewritten every cycle any more for a container that runs on several hosts. Push alerts across a restart work as before: an incident already sent is not sent again, and a change while JagHelm was down is still sent.
- A hand edit of `refreshInterval` in `display-config.json` now takes effect at the next refresh cycle, as the push alert thresholds in that file already did, instead of at the next restart. A `display-config.json` that fails to parse is now logged as a warning; JagHelm still uses the default refresh interval and push alert thresholds until it is fixed.
- JagHelm no longer downloads the icon picker's index from GitHub every time it starts. It fetched 12.4 MB from the GitHub API on each start, which took its peak memory from about 100 MB to about 160 MB and used two of the 60 requests an hour GitHub allows without a token. The index is now kept in `icon-index.json` in the data dir: starting only reads it, and the first icon search when it is missing or a day old fetches the icon repositories' `svg/` listings (2.5 MB, about 0.5 MB compressed), or only checks that they are unchanged. If GitHub can't be reached or refuses the request, the picker keeps the index it has and tries again an hour later, or 5 minutes later if it has no index yet. On a new install, and once after upgrading, the first icon search takes a moment while the index is built.
- A board without a saved layout lays itself out from the nodes it finds: the
  nodes first, up to three side by side, then the panels in pairs of about the
  same height (Pipeline beside Scheduled Jobs, UPS beside the Checklist), then
  Quick Launch. The nodes used to stack full width below the other panels. A
  saved layout is unchanged.
- A first boot names each discovered node by its Prometheus label. The labels
  pi1, pi2, vm103 and vm101 used to get the names "Gateway Primary", "Gateway
  Secondary", "Production" and "Staging". An existing services.yaml is
  unchanged.
- The startup "listening" log line gives the port bound, so PORT=0 shows the
  one picked.
- The server no longer serializes and hashes the `/api/services`, `/api/integrations`, `/api/ups` and `/api/gitea/activity` responses on every request, and no longer keeps a second, unused copy of each of them. A value is serialized and its ETag computed once, on the first request after the background refresh stores it, and later requests, a `200` or a `304 Not Modified`, send what is already in memory: about 145 µs less work for each of them with a 72 KiB payload. A value nobody requests is never serialized. The ETags themselves are unchanged. A `304` now carries the `ETag` header, as HTTP requires. An exact tag in `If-None-Match` got a `304` before and still does; a weak tag (`W/"…"`), a list of tags or `*` now gets one too, where a browser used to get the full `200`.
- Only Dashboard Icons and selfh.st icons go through the icon cache now: their
  SVG, PNG and WebP files on jsDelivr (no version, `@latest` or `@main`) or on
  raw.githubusercontent.com (`main` or `HEAD`). Any other icon URL on jsDelivr or
  raw.githubusercontent.com, such as another repository or a pinned version, is
  now loaded by the browser straight from there, so it still shows. An icon over
  512 KB is not cached either: the browser is sent to the CDN for it, where one
  over 2 MB used to show nothing. So is one the cache can't store, such as when
  writing to the data dir fails, where it used to be served without being kept.
- An embedded tab stays loaded when you switch to another tab, Settings or the
  dashboard, and is where you left it when you come back. It used to load again
  from the start on every switch. Deleting the tab in Settings unloads it, and
  an address edited in Settings loads the next time you open the tab.
- The UPS and Pipeline panels show only when their source is set up. The UPS
  panel shows when Prometheus has the UPS from the NUT exporter, and stays,
  reading "Unknown", while the exporter has been quiet for up to 7 days. The
  Pipeline panel shows when GITEA_URL is set, with a banner while Gitea is
  unreachable. A fresh install without them no longer shows a UPS panel
  reading "Unknown" or a Pipeline panel reading "Gitea unreachable", and an
  existing board drops either panel when its source is not set up, even if
  its saved layout has it. Switching a panel off in Settings → Sections still
  hides it.
- Set GITEA_URL to keep the Pipeline panel. JagHelm no longer falls back to
  http://localhost:3060 when it is unset: it polls no Gitea, shows no Pipeline
  panel and logs "Gitea panel off: GITEA_URL is not set" once at startup.
- The UPS panel's subtitle defaults to the UPS model the NUT exporter reports,
  or "Battery backup" without one, and the dashboard title to "JAGHELM" when
  it is left empty. Set your own in Settings → Sections and Settings → General.
- The web app now builds with Tailwind CSS v4, and shadcn/ui and Lucide icons are
  set up for the redesign's shared component library, which the Android app will
  use too. Every screen looks as it did: the new styles reach only components built
  on the new stack, and none are on screen yet. The stylesheet the browser
  downloads grows by about 3 KB compressed, and nothing is loaded from a new
  third-party address.
- The redesign's colours, type sizes, spacing and shapes are now defined, as signed
  off: graphite with a violet accent, in dark and light, with fuchsia and cyan to
  choose from later. Every text colour is checked for readable contrast against the
  backgrounds it sits on, and no accent can look like a status colour. Nothing on
  screen changes yet; the stylesheet the browser downloads grows by about 1.3 KB
  compressed.
- Fonts are now served by JagHelm itself instead of Google Fonts, so the
  dashboard no longer contacts Google (which saw each visitor's address), no
  longer waits on Google's stylesheet before it first draws, and keeps its fonts
  offline and on networks without internet access. Today's screens look exactly
  as before, in every Typography preset. The Typography settings now preview each
  preset in its own font. The redesign's typefaces ship too, Manrope by default
  with Plus Jakarta Sans and Montserrat to choose from later, along with its type
  sizes; nothing on screen uses them yet.
- Push notifications now say what the dashboard says: the text names the
  service, host, UPS or job and gives the same reason the dashboard shows, for
  example "Gitea on vm103 · Kuma: down" or "pve · Disk 94 % (warning above
  90 %)". Titles are as before, except host readings, which now read "Host CPU
  high", "Host memory high", "Host disk critical" and so on.
- Host alerts follow the dashboard's thresholds: a host's temperature (from
  75 °C, critical from 85 °C) and its Proxmox storage pools now send alerts too,
  a disk or pool reaching 95 % sends a second, critical alert, and a CPU alert
  waits until CPU has been over 90 % for two refreshes in a row.
- A service that Uptime Kuma reports as pending or in maintenance keeps its last
  state for push: a service that goes down, pending, then up now sends its
  "Service recovered", and one that goes down, pending, then down again no
  longer sends a second "Service down".
- A Kuma monitor that `services.yaml` maps to a container running on several
  hosts now sends one "Service down" and one "Service recovered" per outage,
  naming every host, instead of one per container.
- The image runs on Node 26 instead of Node 22, which leaves support on
  2027-04-30. Node 26 is supported until 2029-04-30.
- The `listening` line the server logs at startup now names the Node version it
  runs on, as `node`.
- The redesign's typefaces now draw accented letters outside basic Latin, such as
  the Ł and ź in a node named Łódź, in the chosen typeface instead of the device's
  own font. The extra font file downloads only when such a letter is on screen, so
  pages with plain Latin text download exactly what they did. Nothing on screen
  uses the redesign's typefaces yet.
- The warning about an invalid CSP_CONNECT_EXTRA entry is now a JSON log line
  like every other server log line, with the entry in its `entry` field.

### Removed
- The server no longer serves `/dashboard.jpg` and `/settings.jpg`, two README screenshots that nothing in the app uses. They moved to `docs/images/`.
- A new `services.yaml` no longer gets the `display`, `custom_integrations`, `links`, `tabs`, `grid_layout` and `grid_columns` keys. JagHelm never read them from it: the dashboard's display settings, links, tabs and grid are in `display-config.json` (Settings), and custom integrations are entries under `integrations`. A `services.yaml` that still has them loads and saves as before, and JagHelm logs one warning naming them the first time it loads them; delete them from the file to clear it.
- `GET /api/integrations/:type`, which returned one integration's data along with the whole response from its app's API. Neither the web app nor the Android app called it: the dashboard reads every integration from `GET /api/integrations`, which is unchanged, as are `/api/integrations/presets`, `/test`, `/save` and `DELETE /api/integrations/:type`. The server also drops its second, per-integration cache of poll results, which only that endpoint read: it held each integration's full API response, and an integration removed from the config stayed in it until a restart. What the dashboard shows is still cached as before.
- `GET /api/uptime/monitors`, `GET /api/prometheus/query`, `GET /api/adguard/stats`,
  `GET /api/npm/stats` and `GET /api/docker/containers`, which passed raw Uptime Kuma,
  Prometheus, AdGuard Home, Nginx Proxy Manager and Docker data through. Neither the web
  app nor the Android app called them, and they now return `404`. If a script of yours
  used one: AdGuard Home and Nginx Proxy Manager stats come from their integration
  presets in `GET /api/integrations`, each service's Uptime Kuma status and its
  container's CPU and memory come with it in `GET /api/services`, and an ad-hoc PromQL
  query goes to Prometheus itself. `JAGHELM_ALLOW_OPEN_INFRA`, which only opened these
  endpoints on a dashboard without a password, no longer does anything and can be
  removed from your environment, and so can `ADGUARD_URL`, `ADGUARD_USER` and
  `ADGUARD_PASS`, which only `/api/adguard/stats` read (the AdGuard Home preset reads
  `JAGHELM_ADGUARD_*`).

### Fixed
- A request redirected with `307` or `308` now keeps its method and body, as those codes require, instead of being turned into a `GET` without a body. A session login (Nginx Proxy Manager, Portainer, PhotoPrism) behind such a redirect on the same host and port, or from `http://` to `https://` on it, now works. A login redirected to another origin (host, port or scheme, apart from that upgrade) is refused instead of being re-sent there. `301` and `302` still turn any method but `GET` and `HEAD` into a `GET` without a body, and `303` turns every method, `HEAD` included, into one.
- The server's access log now records API requests. It logged each request's path as seen from inside the router that answered it (`/gitea/activity` for `/api/gitea/activity`), so no routed API request was logged at info and error lines showed a shortened path. Each request now logs one line with its full path, without the query string: at error for a `5xx`, at info for a `4xx` or a request that took 300 ms or more, and at debug otherwise. `/metrics` and the `/api/health` and `/api/readyz` probes are not logged unless they fail with a `5xx`; before, the probes were also logged at debug when healthy.
- The server no longer loads the integration presets' test files as presets at startup, so it no longer logs two "Skipping invalid preset" errors (for `gitlab.test.js` and `nextcloud.test.js`) or prints their test output in its logs. Test files are also left out of the image.
- A phone that receives push alerts but where the JagHelm app had not been opened for 30 days no longer silently stops getting them. The server used to forget a device 30 days after the app last started; now a push Firebase accepts also counts as a sign of life. A device is dropped only when Firebase names its token as unregistered or invalid, or after 270 days with neither an app start nor an accepted push, no sooner than Firebase's own expiry for an inactive device. A device that gets no pushes (every category muted) can still age out if the app is not opened for 270 days.
- A push Firebase rejected for a problem with the message itself (too large, a bad field) or with a non-JSON `400` response no longer deletes the device's registration. Before, every device that push was sent to was dropped, and got no more pushes until the app was next opened. The server now keeps the device and logs Firebase's reason.
- One damaged entry in `data/push-tokens.json` (not an object, or missing its preferences) no longer stops push delivery to every device: it is dropped or given the default preferences when the file is loaded. An entry whose `lastSeenAt` cannot be read is kept, with its clock restarted, instead of deleted.
- Edits in Settings → Nodes and Settings → Services now save on a `services.yaml` that JagHelm generated on first boot. Since the config check added in June 2026, every such save was rejected because the file's `links` was not a list, and the Settings page did not show the error.
- A Prometheus restart, reload or timeout no longer sends a "Host unreachable"
  push for every host, followed by a "Host recovered" for each when Prometheus
  answers again. Uptime Kuma being unreachable for more than 5 minutes no longer
  sends a "Service recovered" for each service it had down, then "Service down"
  again when it is back. While either fails, push alerts keep the last known
  state of the hosts and services it watches, and Kuma keeps alerting about
  services through a Prometheus outage. A UPS that goes on battery while
  Prometheus is failing is still alerted once Prometheus answers.
- Only what a failed Prometheus query reads is held: one query that keeps
  failing on one host (a temperature or container query, say) no longer holds
  back a "Host unreachable" for another host, or that host's other readings.
- A Prometheus that has just started and not scraped anything yet no longer
  reads as every host being unreachable.
- Nothing is re-sent after JagHelm restarts, or after its refresh fails for more
  than 2 minutes: hosts are no longer reported recovered, nor services down
  again, on the next good refresh.
- JagHelm starting while Prometheus is down no longer sends a "Host recovered"
  for every host when Prometheus comes back.
- A host is now reported unreachable as soon as Prometheus can no longer scrape
  it (`up` is 0 for every target with its `node` label), instead of minutes later
  when its CPU reading runs out.
- While Prometheus fails, the dashboard no longer turns containers that are
  still running into grey "last seen" cards.
- A Prometheus or Uptime Kuma outage is now logged once: one warning when it
  starts failing, with the error, and one info line when it answers again. Kuma
  being unreachable used to log an error every refresh.
- A host's temperature is now its hottest sensor. It used to be whichever sensor
  Prometheus listed first, which on a host with several (CPU, NVMe, network
  card) was not the one that matters.
- A container's memory now leaves out page cache the kernel can reclaim
  (cAdvisor's working set), so it no longer reads high for containers that
  read or write a lot of files.
- A container's network RX and TX now count all of its own interfaces, and
  leave out Docker bridges, VPN tunnels and VLAN subinterfaces. They used to
  show the counter of one interface, the alphabetically last, so a container on
  several Docker networks showed only one of them.
- A container on the host network now shows "—" for RX and TX, and
  `/api/services` gives it `docker.networkMode: "host"` with all four RX/TX
  fields null. It has no traffic of its own: cAdvisor reports the host's
  interfaces for it, so each such container would show the host's traffic. Its
  RX and TX used to read 0 MB: the counter of tailscale0, the alphabetically
  last of the host's interfaces, which cAdvisor reports as 0.
- Adding a task to the dashboard checklist works again when JagHelm is opened over plain `http://` on a LAN address, as the default compose serves it, instead of failing with `crypto.randomUUID is not a function`. A task's due date now shows the day that was picked rather than the day before west of UTC (the Americas), and the task turns overdue the day after its due date, not on it. A config export is also named after your local day, not the UTC one. When a checklist change can't be saved, a "Couldn't save the checklist" message appears and the list goes back to what the server holds, instead of the unsaved change staying on screen until a reload.
- A wrong password or token is no longer sent every 30 seconds forever, which
  could get JagHelm's address banned by an app that bans after failed logins.
  An integration whose login is refused twice in a row (HTTP 401 or 403) is
  not retried until its settings change, and its card's error says how to
  retry it: saving it in Settings, even unchanged, retries it at the next
  refresh. Editing its entry in `services.yaml` or restarting JagHelm does
  too.
- One Kuma monitor going down no longer paints every container that shares a
  word with it red, on every machine, with a push notification for each. It
  marks one card and sends one notification.
- When a monitored container stops and its monitor goes down, the red card is
  the stopped container's, and no longer a running container with a similar
  name.
- Monitors that share a word with another monitor are matched to their own
  containers; they used to be left unmatched.
- The containers of Gitea Actions jobs (`GITEA-ACTIONS-TASK-…`) no longer show
  on the board while a job runs, take a monitor, or leave a grey "last seen"
  card after it, which turned the global status to degraded.
- JagHelm no longer rewrites `service-registry.json` on cycles where the
  matching has not changed but the containers were listed in a different
  order.
- The README's icon credits now list the two collections the icon picker uses, with their actual licences: Dashboard Icons (homarr-labs) under Apache-2.0 and selfh.st icons under CC BY 4.0, with the attribution CC BY requires. They listed a third collection the picker doesn't use, linked the old `walkxcode` Dashboard Icons, and gave both licences as MIT.
- The read-only demo (DEMO_MODE=true) shows a populated board: three nodes
  with their services, the UPS, Pipeline, Scheduled Jobs and Checklist panels,
  Quick Launch links with their icons, and "Service Disruption" while its demo
  service is down. It showed nodes with no services, panels stuck on
  "Loading…", a green status and a "Couldn't save settings" error.
- The demo server makes no outbound request and writes no file. It no longer
  runs node discovery or the refresh loop's Prometheus, Kuma, UPS and Gitea
  polls, and no longer writes services.yaml or makes its data directory at
  startup. The browser still loads the board's icons from the icon CDN.
- In the demo, ticking, adding or removing a checklist item, removing a
  scheduled job, editing a node or service, or uploading a logo or background
  applies in the browser for the visit, with no "Couldn't save" error.
- A dashboard panel fits its content again after its width or content
  changes. It kept the height measured when it first appeared, so a panel made
  wider kept empty space at its bottom.
- A panel switched off in Settings no longer leaves an empty space at the
  bottom of the board.
- The dashboard's own data (services, integrations, UPS, Gitea activity) is no longer the first thing dropped from the server's cache when it fills up. The cache holds 500 entries and dropped the oldest-created first, so a burst of distinct Prometheus queries or weather locations evicted those entries, which were created first at startup. The next request then had to wait for a fresh fetch, and an eviction in the middle of a refresh cycle made push alerts lose track of what was already down, so the next cycle sent a second "down" alert for it. The cache now drops the entry written longest ago, and the background refresh rewrites those entries every cycle.
- The web app's offline cache no longer grows with every deploy of the same
  version. When a new build's service worker takes over, it deletes cached
  bundles from earlier builds; the current build's files, including the
  Settings and iframe views, stay cached, as do the app shell, your uploaded
  logo and the app icons.
- A browser tab still open on an older build no longer gets the dashboard page
  back when it asks for a file that a deploy removed. The server now answers
  `404 Not Found` for a missing file under `/assets/`, and the service worker
  never caches an HTML page or an error under a bundle's address.
- The icon cache now follows `JAGHELM_DATA_DIR`, like every other file JagHelm
  keeps; it was always written to `data/icon-cache/` next to the server. With
  `JAGHELM_DATA_DIR` unset (the shipped compose) or set to that same `data/`
  (`/app/data` in the image), the cache stays where it is and is used as before.
  With it set to another directory, the cache starts there empty: icons are fetched
  from the CDN once more as they are shown, and the old `data/icon-cache/` can be
  deleted. A container with its data volume at that other directory now keeps the
  cache on the volume, where before it was lost whenever the container was
  recreated, or kept the container from starting on a read-only root filesystem.
- A port already in use no longer leaves the server running with nothing
  listening. It now logs `cannot listen` and exits, so Docker's restart policy
  tries again.
- An embedded tab that takes more than 8 seconds to load now says it is slow to
  load and offers Retry, and shows as soon as it loads. It used to say
  "Embedding Blocked" and blame the service's headers.
- An embedded tab whose server refuses to be shown inside another site
  (X-Frame-Options or a CSP frame-ancestors list that leaves JagHelm out) says
  it won't open inside JagHelm, names the header, and offers "Open in new tab"
  and how to allow embedding. JagHelm's server reads the service's headers to
  find this out, so it has to be able to reach the tab's URL; when it can't,
  the tab shows what the browser shows. Retry, and "Check again", reload only
  that tab.
- A fresh install shows the "Connect your first node" screen instead of three
  panels stuck on "Loading gateway…", "Loading production…" and "Loading
  staging…" for nodes it does not have. A saved layout that names those nodes
  is unchanged.
- On a phone-width browser, a board without a saved phone layout lists every
  node right after Quick Launch, in its desktop order. Nodes not named pi1,
  pi2, vm103, vm101, pve or nas used to come last.
- Screen readers no longer hear outages of a source whose panel is not on the
  dashboard.
- A host reading that drifts back down through the 5-point band below its alert
  line now sends "back to normal" once it is below the band, and one that dips
  into the band and rises again no longer sends a second alert. This holds
  across a restart of JagHelm.
- A Kuma monitor mapped to containers on several hosts no longer leaves a
  "Service down" without its "Service recovered" when one of those containers
  stops during the outage, and no longer repeats "Service down" when it comes
  back.
- A browser tab left open across a deploy now reloads itself once when you open
  Settings or an app tab, and comes back on the new version with that tab open,
  instead of showing "Something went wrong". Each version gets one such reload:
  if the view fails again on the version the reload brought up, the error screen
  shows as before, so a broken build can't keep reloading the page.
- The web dashboard no longer gets stuck showing old data after a broken response. When the server's answer arrived with an `ETag` but an empty, malformed or cut-off body (a truncated response, or a proxy's error page), the dashboard kept that `ETag` although it had no data for it. Its next poll sent it as `If-None-Match`, the server answered `304 Not Modified`, and the dashboard showed its old data (or, on first load, nothing) until the server's data changed again. The dashboard now keeps a response's `ETag` only together with a body that parsed, so the next poll after a broken response fetches the current data. A response without an `ETag` also clears the old one, so the next poll is a full fetch.
- An Uptime Kuma monitor that no container has (a ping of the NAS or a switch,
  or a check of a web UI on another machine) now sends a "Service recovered"
  push when it comes back up, for the same service as its "Service down" push.
  It used to send only the "Service down". The board is unchanged: such a
  monitor still shows a card only while it is down. A paused monitor, or one
  deleted from Kuma, sends nothing.
- A monitor that comes back up while its stopped container still shows a grey
  card now sends its "Service recovered" push too, and one that comes back up
  while Prometheus is failing sends it right away instead of once Prometheus
  answers again.
- A Kuma monitor whose service moves to another card while it is down now sends
  one "Service down" and one "Service recovered" push per outage. A container
  that took a down monitor (or the monitor of a service you renamed, such as
  nextcloud to nextcloud-app) used to send a second "Service down", or lose the
  "Service recovered" when it took over in the cycle the monitor came back up.
  The recovery is sent for the card the monitor has when it comes back up,
  which can differ from the one the down push named. Updating sends no push.
- When every copy of a container that runs on several nodes stops and its
  monitor goes down, the red card is drawn on the node the monitor last ran on,
  not on another copy's node, and its "Service recovered" push is no longer
  lost.
- Pausing or deleting a Kuma monitor while it is down no longer sends a
  "Service recovered" push for its container's card.
- When Gitea answers the repository search with an error instead of a list of
  repositories (a refused or missing GITEA_TOKEN, or Gitea restarting behind a
  proxy), the server log now says so in one line with the HTTP status and the
  message Gitea sent, such as "Only signed in user is allowed to call APIs.".
  It used to log a JavaScript error instead, such as "filter is not a
  function" or "is not valid JSON". The Pipeline panel shows its Gitea banner
  as before.
- When Gitea answers the repository search but every request for a
  repository's commits fails (Gitea restarting in between, or a proxy page
  instead of JSON), the Pipeline panel shows its Gitea banner and the server
  log says why in one line. It used to show an empty list with nothing logged.
  When only some of those requests fail, the other repositories are still
  listed, as before.
- Saving an integration in Settings no longer drops what its form doesn't
  show. The save used to rebuild the integration's `services.yaml` entry from
  the form, so a custom integration written by hand lost its endpoint, auth,
  header and fields, and a password or token stored under a name Settings
  doesn't use was lost. Now only the fields on the form change, a password or
  token left blank keeps the stored one, and a save that changes nothing
  leaves `services.yaml` untouched.
- The Enable and Disable buttons on an integration's row change only whether
  it is enabled. They used to rebuild the entry the same way, dropping its
  target container and URL parameters, and turning a second instance such as
  `adguard_primary` into a custom integration that no longer worked.
- An integration stored under a key Settings would not give it (such as
  `my_npm`) stays under that key when it is saved in Settings, as long as its
  instance name is not changed. It used to move to the key Settings derives,
  replacing any integration already stored there.
- Changing an integration's instance name in Settings keeps its stored
  password and token: they move with it to the new name. They used to stay
  under the old name, so the renamed integration lost its credential, or
  picked up one left there by an integration removed earlier.
- A Settings form left open no longer undoes an Enable or Disable made since
  in another tab: saving it changes whether the integration is enabled only
  when its own Enabled box was changed. Saving the form of an integration
  removed in the meantime is refused with a message to reload, instead of
  overwriting another integration.
- A stored value of 0 (an account ID, for example) is shown in its Settings
  form and kept when the form is saved. It used to show as empty and be
  removed.
- A Nodes or Services save in Settings that the server refuses or that fails
  now says why in a message, and the screen shows what is stored again. It
  used to look saved and quietly go back on the next visit.
- Changing an integration's instance name in Settings to a name another
  integration already uses is refused, with a message beside the Instance
  Name field that names that integration, and nothing is changed. The save
  used to remove the edited integration and write it over the other one, whose
  URL, target container and stored credentials were lost. Adding a new
  integration under an instance name in use is refused the same way, instead
  of replacing that integration's settings, and so is a second custom
  integration from the custom builder, which used to replace the first one.
- A custom integration whose endpoint puts the token in the URL, such as
  `/api/stats?key={token}`, now sends the token itself when it is stored as a
  `$secret:` reference, which is how Settings saves it. It used to send the
  reference instead, so the integration stopped authenticating as soon as its
  token was saved in Settings. `{password}` is filled in the same way.
- A username written in `services.yaml` as a `$secret:` reference is now
  resolved like a password or token, for an endpoint's `{username}`, basic
  auth and session logins. It used to be sent as the reference itself.
- When a stored token or password that goes in the URL can't be read (its
  secret is missing, or `DASH_SECRET` is not set), the request is no longer
  sent with a `$secret:` reference, or without the key, in its place. It is
  not sent at all, and the card's error says the stored credential couldn't
  be resolved: for a token, to enter it again in Settings, and for anything
  else, to check the integration's entry in `services.yaml`. This covers a
  custom endpoint's `{token}`, `{password}` or `{username}` and the key of
  SABnzbd, Tautulli and Emby. The reference is not shown or logged.

### Security
- An integration whose key is in the URL (SABnzbd, Tautulli and Emby, or a custom integration with `{token}`, `{password}` or `{username}` in its endpoint) no longer follows a redirect to another origin (host, port or scheme), which could take the key there in the redirect's query string. Its connection test and dashboard card instead report that it was redirected to another origin and is not following because the credential is in the URL: set the integration's URL to the address it redirects to. A redirect from `http://` to `https://` on the same host and port is still followed. Once per pair of origins, JagHelm logs a warning, without the key, when it refuses such a redirect, and when it follows that upgrade, since the key went out in clear text first.
- Outbound requests now forward only `Accept`, `Accept-Encoding`, `Content-Type` and `User-Agent` when a server redirects to a different origin, and drop every other header. Before, only `Authorization`, cookies, `X-API-Key` and `X-Api-Token` were dropped, so the Gotify, Plex, Jellyfin, GitLab, Nextcloud, Pi-hole and PhotoPrism credentials, and a custom integration's own auth header, followed the redirect. A redirect from `http://` to `https://` on the same host and port (a reverse proxy's force-SSL) keeps every header, since they were already sent to that host; this also restores integrations behind such a redirect that authenticate with `X-API-Key` (broken since 2.1.0) or `Authorization` (broken since 1.4.0). Once per pair of origins, JagHelm logs a warning when it drops headers on a redirect or follows such an upgrade, naming the headers but never their values; for an upgrade, configure the integration's `https://` URL so its credential is not sent in clear text first.
- Anyone who could reach JagHelm's port could fill its disk through the icon
  cache, `/api/icons/cached`, which needs no login so that icons load as images.
  It fetched and kept any file up to 2 MB from jsDelivr or
  raw.githubusercontent.com, with no limit on the total, and kept the same file
  again for each different query string. It now fetches only icons of the two
  icon repositories, builds the URL it fetches itself, so query strings and other
  spellings of one icon share one file, follows a redirect only to another such
  icon, refuses a response that is not the image type its name says, and keeps
  at most 512 KB per icon and 50 MB in all. It fetches at most 8 icons at a time
  with 256 more waiting, and answers `503` past that, and holds an icon in
  memory only until it is on disk, so a flood of requests for icons not yet
  cached can no longer run it out of memory. The icons already in the cache stay
  and count toward the 50 MB.
- The server's outbound URL check now refuses the cloud metadata address
  (169.254.169.254) and 0.0.0.0/8 when they are written as IPv6, such as
  http://[::ffff:169.254.169.254]/, which the server connected to as IPv4. An
  IPv6 address that carries an IPv4 address is checked as that IPv4 address,
  in strict mode too.
- The Content Security Policy no longer allows stylesheets or fonts from Google
  Fonts: both now load from JagHelm's own address only.
- When GITEA_URL contains a user name and password, the line the server logs
  when it cannot reach Gitea no longer includes the password. Node refuses
  such a URL, and its error message, which named the full URL, was logged
  every refresh. The token and URL credentials are now taken out of every
  Gitea error the server logs.
- A save whose password or token is not text is refused. Its value used to be
  written to the server log in the error.
- When PROMETHEUS_URL or KUMA_URL contains a user name and password, the server
  log no longer includes the password. Node refuses such a URL, and its error
  message, which named the full URL, was logged on every failed refresh, and
  the startup lines printed both URLs as they are. The server now takes the
  password out of every URL in every line it logs, whatever the URL's scheme,
  and a user name given without a password too. A password with a character
  such as # or / that makes the URL invalid is taken out with the user name.
  The line keeps the URL's host, so it still says where the request was going.
- Settings no longer receives the credentials in `services.yaml`. Reading it
  for the Nodes, Services and Integrations screens used to send the whole file
  to the browser, so a password or token written into it by hand as plain
  text, a `$secret:` reference, a key under another name (`apikey`, `secret`,
  `cookie`), a header value under `extraHeaders`, a login body, an endpoint
  with a key in its query string and a value an endpoint fills in through a
  `{name}` placeholder were all in the page. Each one that is set now comes
  back as `{ "$stored": true }`, and saving the Nodes or Services screen keeps
  the stored value in its place; a save that changes nothing leaves the file
  untouched. A save that sends that marker where nothing is stored, or in
  place of anything but a credential, is refused and writes nothing.
- Plex's `X-Plex-Token` in a URL's query string is now taken out of log lines,
  as other keys are.
- A token or password filled into a custom integration's endpoint path, such
  as `/api/{token}/status`, no longer shows in the card's error or the server
  log when the request fails with an error that quotes the URL (a typo in the
  URL, such as an invalid port). The error shows the URL with `{token}` in
  the credential's place.

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

[Unreleased]: https://github.com/jagbhandal/jaghelm/compare/v3.0.0...HEAD
[3.0.0]: https://github.com/jagbhandal/jaghelm/compare/v2.3.0...v3.0.0
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
