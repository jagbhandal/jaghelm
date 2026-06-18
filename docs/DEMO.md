# Running JagHelm without a backend — demo & standalone mode

JagHelm shows **live data** when you point it at Prometheus/cAdvisor/Uptime-Kuma,
but neither a backend nor a public demo requires exposing anything writable.

## Read-only public demo (`DEMO_MODE`)

Set `DEMO_MODE=true` to serve a **fully self-contained, read-only** instance —
ideal for a public link, a screenshot, or kicking the tyres:

```bash
docker run -e DEMO_MODE=true -p 3099:3099 ghcr.io/jagbhandal/jaghelm:latest
# or: DEMO_MODE=true npm start
```

In demo mode a guard owns the entire `/api` surface (`server/demo.js`):

- **Every write is refused** (`POST/PUT/DELETE/PATCH` → `403`).
- Reads return **canned fixtures**; the request never reaches a real route, so
  there is **no outbound fetch, no backend dependency, and the secrets API is
  unreachable**. It is safe to expose publicly.
- A loud demo banner is logged at boot.

It's a demo, not a dashboard — there is no persistence and no live data.

## Prometheus is opt-in, not required

You do **not** need Prometheus to use JagHelm. Without it, the metrics panels are
simply empty and the dashboard still gives you:

- **Quick-launch links** and the **42 app integrations** (AdGuard, Proxmox,
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
