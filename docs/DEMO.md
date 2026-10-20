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

- **Three nodes** side by side (a Raspberry Pi edge box, an app server VM and
  a NAS) with CPU, memory, disk, temperature, uptime and sparklines, and their
  services with Docker stats and Uptime Kuma ping and uptime.
- **One service down** (its health check failing while its container runs), so
  the header reads "Service Disruption" and its card is red, as a live board
  shows an outage.
- The **UPS**, **Pipeline** (recent commits), **Scheduled Jobs** (one failed
  backup) and **Checklist** panels, and **Quick Launch** links.

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
- The fixtures are shaped by the live server's own code: `/api/services` is
  built by the same `assembleServices()` that builds a live board, and the
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
"couldn't save" error: moving a panel; Settings → General, Appearance and
Links; ticking, adding or removing a checklist item; removing a scheduled job;
editing a node or service in Settings; a new logo or background. A reload
brings back the demo's own board, apart from where the panels were moved.
Integrations and the password are held by the server alone, so there is
nothing to change in the browser: testing or saving an integration, or
changing the password, shows the demo's "This is a read-only demo" answer in
the form. A render test (`src/demo.render.test.jsx`) renders the whole app
against the demo's answers on every CI run.

It's a demo, not a dashboard — there is no persistence and no live data.

## Prometheus is opt-in, not required

You do **not** need Prometheus to use JagHelm. Without it, the metrics panels are
simply empty and the dashboard still gives you:

- **Quick-launch links** and the **35+ app integrations** (AdGuard, Proxmox,
  Grafana, *arr stack, …) — these talk to each app's own API, independent of
  Prometheus.
- Service **status** via Uptime Kuma (also optional).
- Themes, the drag-resize grid, todos, and embedded service tabs.

On first boot with no Prometheus reachable, node discovery just returns an empty
set and you land on the **"Connect your first node"** empty state — add links and
integrations from Settings and you have a working dashboard. Point
`PROMETHEUS_URL` at a Prometheus later and the live metrics light up — depth you
opt into, not a prerequisite. `GET /api/readyz` reports whether the optional
backends are currently reachable.
