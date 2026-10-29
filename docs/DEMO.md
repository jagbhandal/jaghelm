# Running JagHelm without a backend — demo & standalone mode

JagHelm shows **live data** when you point it at Prometheus/cAdvisor/Uptime-Kuma,
but neither a backend nor a public demo requires exposing anything writable.

## Read-only public demo (`DEMO_MODE`)

Set `DEMO_MODE=true` to serve a **self-contained, read-only** instance (apart
from the board's icons, which the browser loads from the icon CDN) — ideal for
a public link, a screenshot, or kicking the tyres:

```bash
docker run -e DEMO_MODE=true -p 3099:3099 ghcr.io/jagbhandal/jaghelm:latest
# or: DEMO_MODE=true npm start
```

### What it shows

A small made-up homelab, laid out the way a new install lays out its own:

- **Three nodes** (a Raspberry Pi edge box, an app server VM and a NAS): in
  the Infrastructure section, as cards or a table, their CPU, memory, disk and
  temperature meters, uptime and an hour of CPU; under it, the Services
  section, their services grouped by node, each with its Uptime Kuma latency.
- **One service down** (its health check failing while its container runs), so
  the header reads "Critical" and its row in the Services section is red, as a
  live board shows an outage.
- The **UPS** in the Power section (on mains, 100 % charge), and from 1440px
  wide the utilities rail's **Quick Launch** links, **Pipeline** (recent
  commits with their CI results: one running, one failed on a branch, a repo
  without CI) and **Checklist** (all three on the Launch page at any width).
- **Drives** (#727): the storage node reads an NVMe and three drives, one of
  them remapping sectors, so in `incident` that node is in warning and the
  headline adds "1 node in warning".
- The **Jobs** section (#578): four jobs, one a failed backup, whose runs fall on their schedules,
  which the demo's reporters keep in UTC and say so ("daily at 02:00 (UTC)");
  run times are shown in your browser's time zone.

`DEMO_SCENARIO=healthy` serves the same board with nothing down. The default is
`DEMO_SCENARIO=incident`.

Every name, host and link is generic (`*.example.com`); none is taken from a
real install.

### How it stays self-contained

In demo mode a guard owns the entire `/api` surface (`server/demo.js`):

- **Every write is refused** (`POST/PUT/DELETE/PATCH` → `403`).
- Reads return the demo's fixtures (`server/demoFixtures.js`); the request
  never reaches a real route, so there is **no backend dependency, and the
  secrets API is unreachable**. It is safe to expose publicly.
- Every read the web app sends has a demo answer (a test walks
  both apps' source for them). Any other `/api` path is a `404`, as on a live
  server, so a new endpoint can't quietly answer the demo with an empty object.
- The fixtures are shaped by the live server's own code: `/api/services` is
  built by the same `assembleServices()` that builds a live board,
  `/api/status` by the same status model from the demo's own payloads and
  display config (which marks the nightly backup as a backup, so the
  `incident` headline is "1 service down · 1 backup failed · 1 node in warning"), as a board that
  has been running for 15 minutes (its down service has been down that long,
  not "since now"), and the
  parts written by hand are tested against the live code's output, so the demo
  can't drift into a stale shape.
- An icon is a redirect to its URL on the icon CDN, which the browser loads; the
  server neither fetches nor stores it. Only the icon URLs the live icon cache
  would fetch are redirected.
- Startup runs none of the subsystems: no node discovery, refresh loop, Kuma,
  Gitea, UPS or Arcane polling, push, icon index or icon cache, and no
  `services.yaml`. The **server** makes no outbound request and writes no
  file, not even its data directory (the browser loads the board's icons from
  the icon CDN, above). A test boots the real server under network and
  file-system spies, with its timers run fast enough to cover a day, to keep
  it that way (`server/demo.boot.test.js`).
- A loud demo banner is logged at boot.

The web app learns it is the demo from `/api/auth/check` and sends it no
save. What a visitor changes is kept in that browser for the visit, with no
"couldn't save" error: Settings → Appearance and Apps & links;
ticking, adding or removing a checklist item; removing a scheduled job;
editing a node or service in Settings; a new logo or background. A reload
brings back the demo's own board.
Integrations and the password are held by the server alone, so there is
nothing to change in the browser: testing or saving an integration, or
changing the password, shows the demo's "This is a read-only demo" answer in
the form. A render test (`src/demo.render.test.jsx`) renders the whole app
against the demo's answers on every CI run.

It's a demo, not a dashboard — there is no persistence and no live data.

## Without Prometheus

Node readings need Prometheus: without it the nodes have no readings, and with
`PROMETHEUS_URL` unset the board says "Prometheus is not set". The rest does
not, and the dashboard still gives you:

- **Quick-launch links** and the **35+ app integrations** (AdGuard, Proxmox,
  Grafana, *arr stack, …) — these talk to each app's own API, independent of
  Prometheus.
- Service **status** via Uptime Kuma (also optional).
- Themes, the Overview's sections, todos, and embedded service tabs.

With `PROMETHEUS_URL` unset, a first boot saves nothing, asks nothing and says
so in the log and on the setup page: set it in `.env` and restart. With one that
nothing answers at, node discovery finds no node, saves nothing, and you land on
the **"Waiting for your first node"** empty state: JagHelm asks again every
refresh, so once a Prometheus answers and has scraped a host, the live metrics
light up with no further step. Links from Settings work meanwhile. An
integration saved in Settings writes `services.yaml`, and from then on its nodes
are yours: discovery doesn't run again, and a node goes into the file by hand.
`GET /api/readyz` reports whether Prometheus and Kuma currently answer; it is
ready when Prometheus does.
