# Known Issues & Limitations

JagHelm is a single-maintainer hobby project, used daily for one homelab. This
page lists the things that are missing, rough, or deliberately out of scope — so
you can decide whether it fits *your* setup before you install it, and so a bug
report doesn't tell you something we already know.

Nothing here is hidden in the issue tracker; it's collected up front on purpose.
If you hit something not listed, please open an issue (see the bug-report
template — it asks for your JagHelm version, Prometheus version, deployment
method, and browser).

Last reviewed: 2026-07-09.

---

## Architecture & scope limitations

These are design choices, not bugs. They won't be "fixed" — they define what
JagHelm is.

- **Single instance only — state is in-memory.** Sessions are stored in an
  in-memory `Map`, and the background metric-refresh loop runs in-process. There
  is no shared session store, no clustering, and no horizontal scaling. Run
  exactly one container. If you put two behind a load balancer, logins and
  caches won't be shared between them.
- **Single user, single tenant.** One set of credentials, one config. There are
  no per-user dashboards, roles, or teams. It's built for an individual
  homelab, not a shared/multi-user deployment.
- **Hard Prometheus dependency.** JagHelm reads *all* node metrics (CPU, RAM,
  disk, temperature, uptime) from Prometheus. Without a reachable Prometheus
  instance, the node panels stay empty — there is no built-in collector and no
  standalone "links only" mode yet. cAdvisor (container stats), Uptime Kuma
  (health), and a NUT exporter (UPS) are optional, but Prometheus is currently
  required for the core experience. (Reducing this onboarding cliff is on the
  roadmap; see `docs/IMPROVEMENT-PLAN.md` Phase 7.)
- **Not a monitoring backend.** JagHelm visualises what Prometheus / cAdvisor /
  Uptime Kuma collect. It does not scrape, store, or alert. If those upstreams
  are down or misconfigured, JagHelm shows nothing useful — that's expected.

## Responsive / mobile

- **Phone layout is functional, not bespoke.** JagHelm is responsive on small
  screens — the grid collapses to a single column, the top-nav tabs fold into a
  hamburger menu (44px touch targets), drag/resize is disabled under 480px, the
  settings sidebar stacks, and overlays/popovers clamp to the viewport. It is
  installable as a PWA. It is still **primarily designed for a desktop or
  wall-mounted display**, so it's tuned for glance-ability rather than a native
  phone app feel (no swipe gestures, no bottom-tab navigation). Device QA across
  real phones is recommended before relying on it as your primary mobile surface.

## Security defaults (read before exposing it)

JagHelm is built for a LAN behind a reverse proxy. Read this before putting it
anywhere reachable from outside your network.

- **Ships open by default.** If you leave `DASH_PASS` empty, login is disabled
  and the dashboard is reachable by anyone who can reach the port. The most
  sensitive endpoints are fail-closed even in this mode — the standalone secrets
  API and the raw infrastructure passthroughs (PromQL query, Docker-socket
  container list) refuse to serve until a password is set, unless you explicitly
  opt back in with `JAGHELM_ALLOW_OPEN_SECRETS=true` / `JAGHELM_ALLOW_OPEN_INFRA=true`.
  Aggregated/benign endpoints stay open. Still: set `DASH_USER` / `DASH_PASS`
  (and ideally a reverse proxy with its own auth) before exposing it. **Do not
  put a no-password instance on the public internet.**
- **Bridge network by default; host networking is opt-in.** The published
  `compose.yaml` uses a bridge network and publishes only the app port — the
  safer, isolated default. If JagHelm can't reach LAN exporters/services that
  the bridge won't route to, an opt-in `network_mode: host` block is provided
  (commented) in `compose.yaml`; host mode removes network isolation, so prefer
  the bridge unless a missing-exporter symptom forces it.
- **Outbound TLS validation is on by default; the self-signed bypass is
  per-request.** Certificate validation is enabled for all outbound requests.
  The one exception is presets that talk to services with self-signed certs
  (currently only Proxmox), which opt in via a per-request, dedicated undici
  dispatcher (`rejectUnauthorized=false` scoped to that single call). The
  process-global `NODE_TLS_REJECT_UNAUTHORIZED=0` approach — which disabled cert
  checks for *every* outbound request — has been removed.
- **Login rate limiting is in place.** Failed logins are throttled by a per-IP
  sliding window (5 attempts / 15 min), a global failure counter that trips
  during a distributed brute force, and a jittered floor delay on every failure
  (which also dulls the response-time credential oracle). Behind a proxy this
  relies on `TRUST_PROXY` being configured correctly (see below) so `req.ip`
  isn't spoofable via `X-Forwarded-For`. A reverse proxy is still recommended.
- **CORS is default-deny.** Cross-origin requests are blocked entirely unless
  you allow-list origins via the `CORS_ORIGIN` env var — JagHelm serves its own
  SPA same-origin, so this is the safe homelab default. The API uses a header
  token rather than cookies, so it isn't a CSRF vector regardless.

## Integrations

JagHelm ships 42 integration presets. They depend on each upstream app's API,
which changes independently — expect occasional drift.

- **Nextcloud** can show dashes for FILES / USERS / STORAGE on some setups —
  may need additional auth or an endpoint that varies by version.
- **PhotoPrism** preset auth was corrected recently; if metrics don't appear,
  re-save the integration in Settings to pick up the fix.
- **Two instances of the same preset** (e.g. a primary and secondary AdGuard)
  can collide in the response cache under some builds and serve each other's
  data. Fixing the cache key is tracked in `docs/IMPROVEMENT-PLAN.md`.
- **Custom integrations** point at a JSON endpoint and extract paths you choose.
  If the upstream JSON shape changes, the card will show blanks until you update
  the extraction paths.

## Quality & testing

Honest about where the engineering floor sits today:

- **CI gates tests, lint, and type-check on every change.** The Gitea
  workflow (`.gitea/workflows/check.yml`) runs a secret scan, then `npm run
  lint`, `npm run typecheck`, the server suite (`npm test`), the client suite
  (`npm run test:client`), and the mobile suite — all required before merge.
  Node 22 is the validated toolchain (matching the Docker base image); newer
  Node majors can break the jsdom-based client tests, which is why
  `package.json` now declares a supported `engines` range.
- **Accessibility gaps.** Focus indicators, reduced-motion handling, form-label
  associations, and keyboard-driven panel reordering are incomplete. Tracked in
  Phase 4 of the plan.

## Known rough edges / cleanup candidates

Lower-stakes items the maintainer is aware of:

- A `SERVICE_ICONS` constant hardcodes 40+ CDN icon URLs in the frontend —
  should move to config.
- A legacy `/api/docker/containers` endpoint duplicates the discovery logic and
  is a removal candidate.
- The Settings live-preview spins up a second dashboard instance with its own
  state and fetch cycle, which is wasteful.
- The version string reported by the app and the docs/image labels can drift;
  single-sourcing the version is on the roadmap (Phase 6).

---

## Reporting something not on this list

Open an issue with:

- JagHelm version (image tag, e.g. `1.0.0` or `latest`)
- Prometheus version
- Deployment method (Docker Compose / `docker run` / other)
- Browser + version (for UI issues)

The bug-report template asks for all of the above — please fill it in, it saves
a round-trip. See `CONTRIBUTING.md` for the dev setup if you'd like to send a
fix.
