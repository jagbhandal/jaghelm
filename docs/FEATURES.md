# Features

What JagHelm shows and does, once it is running. To set it up, start with the [README](../README.md). The numbers come from Prometheus, cAdvisor and your apps; see [CONFIGURATION.md](CONFIGURATION.md) for the `.env` side.

- [The Overview](#the-overview)
- [Nodes](#multi-node-infrastructure-monitoring)
- [Containers](#per-container-resource-stats)
- [Integrations](#integrations)
- [Embedded apps](#embedded-apps)
- [Themes](#themes-and-typography)
- [UPS](#ups-power-monitoring)
- [Settings](#settings-and-files)
- [Alerts on your phone](#alerts-on-your-phone)

## The Overview

The Overview leads with what is wrong: the issues, worst first, or one quiet line when all is well, and a strip of subsystems (Services, Nodes, Power, Jobs, Backups, Integrations) whose tiles filter the page. Under them, the nodes as cards or a table, the UPS, every scheduled job and backup, and every service in one list, by node or by custom group. Each row, card and issue opens its detail in a panel at the side (a full-screen sheet on a phone): its state, why and since when, its readings, and a link to where it is set up in Settings. Everything JagHelm watches has its own address (`/?entity=services/apps:jellyfin`), so a link, a bookmark or a reload opens the same detail. From 1440px wide, Quick Launch, Pipeline and the Checklist sit beside them; narrower, they are on the Launch page. The sections grow with their content and never clip it, from a phone to a 4K screen; Settings → Appearance can hide any of them. Edit layout, a button in the header, opens a panel to reorder the sections, show or hide them, pin services to the top of Services and put services in custom groups. Every move has a button as well as dragging, and it is saved with your other settings, so your other devices follow. A fresh install with no node yet says so where the nodes will be, and how to add one. Below 768px the browser shows the phone screens instead, with tabs for Overview, Services, Infrastructure, Alerts and More.

Beyond the sections above, the Overview can also show:

- **Config drift**, **Expiry** and **Pending host steps** rows, each only when it is set up: drift needs `JAGHELM_CRON_SECRET` ([REPORTING.md](REPORTING.md)); Expiry needs hosts to watch or a Tailscale key ([CONFIGURATION.md](CONFIGURATION.md#environment-variables)); host steps need Gitea and an open tracking list.
- **Recent errors** in a node's or container's panel: the last 20 error and warning log lines from the last 6 hours, read from Loki, each marked Fatal, Error or Warn when the line states its level (the list scrolls inside the panel, so long logs don't lengthen it) once `LOKI_URL` is set. Logs show only once a dashboard password is set.
- **Remove** on a container that is missing on purpose, which clears its "Missing" warning at once. It comes back by itself if the container returns. Like the log peek, it needs a dashboard password.

The Alerts page lists what needs attention now, worst first. Under it, JagHelm keeps a history of its alerts for 30 days (up to 1000), with phone notifications set up or not, each with when, what, why and whether it went to your phones. The page groups it by day and filters it by severity, kind and search. `GET /api/events` serves the same history, newest first, a page at a time.

## Multi-node infrastructure monitoring

Real-time CPU, RAM, disk, temperature, and uptime per node, pulled from Prometheus. Nodes auto-discovered from labels on first boot, as soon as Prometheus has some — no manual config for the hosts it already scrapes. A node's card opens its detail: its readings, uptime, memory and disk, and for a Proxmox host with the Proxmox integration set up, its virtual machines, storage pools (coloured by the disk thresholds) and last backup.

The Infrastructure page (`/infrastructure`, in the sidebar) lists every node as cards or a table, with a search (name, key or role) and filters for state and role, and each Proxmox host's virtual machines and storage pools under them. Each node's Disk meter says how many days are left before the disk fills, from a line through the last week (amber under 14 days, red under 3; Settings → Nodes & Services → Disk forecast moves the lines), and nothing when the disk is stable or the history too short to say. It sends no alert. The filters are in the address: Back undoes one, and a link opens the page filtered.

## Per-container resource stats

CPU, memory, network RX/TX for every Docker container via cAdvisor. The Overview's Services section lists every service in one line each, grouped by node or by your own groups: its state (from Uptime Kuma, or the container), its ping latency, one number from its app integration and, with a Kuma monitor, its last 30 checks as a heartbeat strip (each check's time and latency under the pointer; the detail shows the last 50). The per-container numbers are left off the Overview: a service's row opens its detail, with its container's CPU, memory and network rates and all of its integration's numbers. A detail links to the service, Proxmox and Uptime Kuma through your own apps and Quick Launch links of those names.

The Services page (`/services`, in the sidebar) lists every service as that list or as a table, with a search (name, node, custom group or container) and filters for state and node, in the address as on the Infrastructure page. On a phone the same addresses are the Services and Infrastructure tabs, so turning the phone keeps the page and its search.

## Integrations

35+ presets and a custom builder: connect AdGuard, Plex, Sonarr, Proxmox, Cloudflare, Vaultwarden and dozens more through Settings → Integrations. How credentials are stored, what happens when one fails, and the custom builder are in [INTEGRATIONS.md](INTEGRATIONS.md).

## Embedded apps

Add your existing monitoring tools as embedded apps — Uptime Kuma, Portainer, Proxmox, anything web-accessible. Each has its own entry in the sidebar's Apps group (under More on a phone), its own address, and an "Open" command in the command palette, and opens inside JagHelm under the status header rather than in a new browser tab. Configurable per app from Settings → Apps & links. An app you have opened stays loaded when you switch away, so it is where you left it when you come back; a dot marks it, and Unload frees it. At most five stay loaded at once, the least recently used unloading first. A bar over the open app shows its address, with Reload (that app only) and "Open in new tab". An app that is slow to start says so, with a Retry; one whose server refuses to be shown inside another site says that instead, with "Open in new tab" and how to allow embedding.

## Themes and typography

Dark and light themes, or System to follow your device as it switches, with one violet accent; the header's sun and moon button flips between dark and light. A Font family setting (Manrope by default, Plus Jakarta Sans or Montserrat), with JetBrains Mono for code.

## Installable (PWA)

`manifest.json` and a service worker make JagHelm installable to a phone or tablet home screen. Useful if you have a wall-mounted dashboard or just want it as a "real app" on mobile.

## UPS power monitoring

If you run [NUT](https://networkupstools.org/) with the Prometheus exporter, JagHelm shows the UPS in the Overview's Power section: on mains or on battery, its charge, and on battery the minutes left; its row opens the battery percentage, runtime, load and model. It shows the UPS the exporter reports, whatever its name; with several, the first by name that has a reading, unless `JAGHELM_UPS_NAME` names one (its name in NUT's `ups.conf`). The UPS shows once Prometheus has it, and stays, with no signal, while its exporter has been quiet for up to 7 days; without one the Overview has no Power section. The Pipeline panel (recent Gitea commits and their CI results) shows when `JAGHELM_GITEA_URL` is set (see [CONFIGURATION.md](CONFIGURATION.md#environment-variables)), with a banner while Gitea is unreachable.

## Settings and files

Settings UI handles the day-to-day work: Sources (whether Prometheus, Uptime Kuma, NUT, Gitea and the cron reporters are answering, why one isn't, and the `.env` variable that sets each; read-only), Nodes & Services (names, monitors, custom groups), Integrations, Apps & links (embedded apps, Quick Launch links, the web search), Notifications (the warning and critical thresholds, what pages your phones, the registered phones and a test push), Appearance (theme, accent, density, font, branding, Overview sections, weather and clock) and System (password, backup, data refresh, energy cost). An old Settings address, such as a bookmark of `/settings/links`, opens the section that holds it now, at the part that does. For the things you'd rather automate or template, everything lives in YAML/JSON on disk.

## Alerts on your phone

Browsers allow installing to the home screen and Web Push only on an https address (or on `localhost`), so a plain `http://192.168.x.x:3099` can show the dashboard but not install it or send alerts: put JagHelm behind a reverse proxy with a certificate first.

Install JagHelm to the home screen (on iPhone or iPad, Share, then Add to Home Screen; iOS 16.4 or later) and turn on alerts in Settings → Notifications. The server sends them over Web Push. It makes its own key the first time it starts and keeps it in the data folder as `vapid-keys.json` (back it up with `data/`), so there is no key step; `VAPID_*` variables in `.env` still win if you want your own ([GET-STARTED.md](GET-STARTED.md#alerts-on-your-phone-web-push)). Settings → Notifications lists each phone and browser that registered, with when it last got a push and why its last one failed, and sends a test push to one or all of them to prove the whole chain works. A burst of alerts arrives as one push ("5 services down on apps"), a notification has Snooze 1h and Ack buttons, quiet hours (in a time zone you pick, the server's by default) hold the night's alerts for one morning summary, and a known cause you name (Omada's upgrade reboot, say) is tagged on the push and on the Alerts page.
