# Known Issues & Limitations

JagHelm is a single-maintainer hobby project, used daily for one homelab. This
page lists the things that are missing, rough, or deliberately out of scope — so
you can decide whether it fits *your* setup before you install it, and so a bug
report doesn't tell you something we already know.

Nothing here is hidden in the issue tracker; it's collected up front on purpose.
If you hit something not listed, please open an issue (see the bug-report
template — it asks for your JagHelm version, Prometheus version, deployment
method, and browser).

Last reviewed: 2026-06-17.

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

- **No dedicated mobile layout yet.** Below the mobile breakpoint the grid
  collapses panels into a single column, but the experience is not tuned for
  small screens, and the top-nav tabs can disappear at narrow widths. JagHelm is
  installable as a PWA, but it's primarily designed for a desktop or
  wall-mounted display. A proper responsive pass (mobile nav affordance, tuned
  breakpoints) is planned.

## Security defaults (read before exposing it)

JagHelm is built for a LAN behind a reverse proxy. Read this before putting it
anywhere reachable from outside your network.

- **Ships open by default.** If you leave `DASH_PASS` empty, login is disabled
  and the dashboard — including some config/secrets endpoints — is reachable by
  anyone who can reach the port. Set `DASH_USER` / `DASH_PASS` (and ideally a
  reverse proxy with its own auth) before exposing it. **Do not put a
  no-password instance on the public internet.**
- **`network_mode: host` in the shipped compose.** The published `compose.yaml`
  runs on the host network so JagHelm can reach LAN services and exporters
  directly. That means it binds to the host's interfaces, not an isolated
  Docker bridge. If you'd rather isolate it, a bridge + published-port variant
  is shown in the README quickstart / `docs/GET-STARTED.md`.
- **TLS validation is disabled for outbound requests.** The compose sets
  `NODE_TLS_REJECT_UNAUTHORIZED=0` so JagHelm can talk to internal services with
  self-signed certs (e.g. Proxmox). This disables certificate validation for
  *all* outbound requests, not just the ones that need it. A scoped, per-request
  bypass is planned.
- **No login rate limiting yet.** Failed-login throttling / lockout is planned
  but not implemented. Another reason to keep it behind a reverse proxy and off
  the public internet.
- **CORS allows all origins.** Acceptable for a homelab behind a reverse proxy;
  the API uses a header token rather than cookies, so this is not a CSRF vector,
  but be aware of it if you adapt the deployment.

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

- **No CI gate on tests yet.** Several `node:test` suites exist in the repo, but
  there is no automated job running them on every change, so a regression can
  land unnoticed. Wiring a report-only-then-required CI gate is the first item
  in the improvement plan (`docs/IMPROVEMENT-PLAN.md` Phase 1).
- **No linter / formatter / type-check enforced** in CI yet. Config for ESLint,
  Prettier, and a JSDoc/`checkJs` pass is planned but not gating.
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
