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

- **Single instance only — state is in-memory.** Sessions are held in memory
  and in `data/sessions.json`, and the background metric-refresh loop runs
  in-process. There is no shared session store, no clustering, and no
  horizontal scaling. Run exactly one container. If you put two behind a load
  balancer, logins and caches won't be shared between them, and each would
  overwrite the other's `sessions.json`.
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
  sensitive endpoint is fail-closed even in this mode — the standalone secrets
  API refuses to serve until a password is set, unless you explicitly opt back
  in with `JAGHELM_ALLOW_OPEN_SECRETS=true`. Aggregated/benign endpoints stay
  open. Still: set `DASH_USER` / `DASH_PASS` (and ideally a reverse proxy with
  its own auth) before exposing it. **Do not put a no-password instance on the
  public internet.**
- **The icon cache is public, even with a password set.** Icons are `<img>`
  tags, which can't send the login token, so `/api/icons/cached` needs none. It
  only fetches icons of the two icon repositories the picker uses (Dashboard
  Icons and selfh.st), keeps at most 50 MB of them (`JAGHELM_ICON_CACHE_MAX_MB`)
  and drops the least recently used past that, and fetches at most 8 at a time
  with 256 more waiting (a `503` past that), holding at most 4 MB of icons in
  memory. So anyone who can reach the port can make it fetch those icons, churn
  the cache, keep the fetch queue full so new icons fail to load for a while,
  and see which icons are cached (and so roughly which services you run), but
  not fill the disk or memory or fetch anything else.
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
- **Failed sign-ins slow down the address they come from, not everyone.**
  After 5 failed sign-ins in a row an address waits 30 s before its next try,
  and each further failure doubles the wait, up to 15 minutes. A sign-in from
  it clears that; its failures are forgotten an hour after the last one.
  Failures from one address never make another address wait. Every attempt,
  whatever user name it carries, also draws on one budget for the account: 10
  attempts, one more every 30 s. So an attacker with any number of addresses
  (many devices, IPv6, or an `X-Forwarded-For` that can be spoofed) gets at
  most 130 guesses in any hour, 120 an hour after the first. While that budget
  is empty, a sign-in from a new address waits up to 30 s, and an attacker
  racing it can keep a new address waiting; the 16 addresses that signed in
  most recently since the last restart skip that wait until they fail once
  (so a spoofed one buys a single guess). Every failure still takes at least
  0.4 s, jittered, so the response time isn't a credential oracle. The state
  is in memory and bounded (at most 1,000 address records). Behind a proxy
  this relies on `TRUST_PROXY` (see below): without it every client has the
  proxy's address, and one client's failures make them all wait. A reverse
  proxy is still recommended.
  **If you're made to wait:** the sign-in form says how long. Devices already
  signed in carry on, as the limit is on signing in. Sign in from an address
  you signed in from before, or wait (at most 15 minutes), or restart JagHelm,
  which clears every wait; sessions survive the restart, so nobody else is
  signed out.
- **A sign-in lasts up to 90 days and survives restarts.** A session ends
  after 30 days without use, and 90 days after sign-in in any case.
  `data/sessions.json` (readable only by JagHelm's user) holds a SHA-256 of
  each session token, not the token, so a backup of `data/` signs nobody in.
  A use is saved at most once an hour, so after a crash a session can end up
  to an hour sooner than it would have. If the disk refuses a write, the
  sessions in memory carry on: one signed in meanwhile ends at the next
  restart, and after a log-out or password change that couldn't be saved,
  every device signs in again after the next restart. On a disk that can't
  even remove `sessions.json` (read-only), logging out answers an error until
  it can be saved, and the Android app sends it again. Changing `DASH_PASS`,
  `DASH_USER` or `DASH_SECRET` signs every device out at the next start. To
  sign every other device out, change the password in Settings; to sign every
  device out, stop JagHelm, delete `data/sessions.json` and start it.
- **CORS is default-deny.** Cross-origin requests are blocked entirely unless
  you allow-list origins via the `CORS_ORIGIN` env var — JagHelm serves its own
  SPA same-origin, so this is the safe homelab default. The API uses a header
  token rather than cookies, so it isn't a CSRF vector regardless.

## Integrations

JagHelm ships 35+ integration presets. They depend on each upstream app's API,
which changes independently — expect occasional drift.

- **Nextcloud** can show dashes for FILES / USERS / STORAGE on some setups —
  may need additional auth or an endpoint that varies by version.
- **PhotoPrism** preset auth was corrected recently; if metrics don't appear,
  re-save the integration in Settings to pick up the fix.
- **A refused login is not retried on its own.** An integration whose login
  is refused twice in a row (HTTP 401 or 403) waits until its settings change,
  so an app that bans an address after failed logins doesn't ban JagHelm's.
  Its card's error note says so. If you fix the password on the app's side
  instead, save the integration in Settings (no change needed) and it is
  retried at the next refresh. That works however the integration was added:
  the save keeps what the form doesn't show, such as a custom integration's
  endpoint, auth and fields (#402). Editing its entry in `services.yaml` (any
  change counts) or restarting JagHelm retries it too.
- **Custom integrations** point at a JSON endpoint and extract paths you choose.
  If the upstream JSON shape changes, the card will show blanks until you update
  the extraction paths.

## Quality & testing

Honest about where the engineering floor sits today:

- **CI gates tests, lint, and type-check on every change.** The Gitea
  workflow (`.gitea/workflows/check.yml`) runs a secret scan, then `npm run
  lint`, `npm run typecheck`, the server suite (`npm run test:ci`: `npm test`
  plus a minimum-test-count floor, so a run that silently drops tests fails),
  the client suite (`npm run test:client`), and the mobile suite — all required
  before merge.
  Node 26 is the validated toolchain (matching the Docker base image and
  `.nvmrc`), and `package.json` declares it in `engines`. Node 25 and later
  ship their own `localStorage` global, which hides jsdom's, so both Vitest
  configs turn it off in their test workers (`--no-experimental-webstorage`).
- **Accessibility gaps.** Focus indicators, reduced-motion handling, form-label
  associations, and keyboard-driven panel reordering are incomplete. Tracked in
  Phase 4 of the plan.

## Known rough edges / cleanup candidates

Lower-stakes items the maintainer is aware of:

- A `SERVICE_ICONS` constant hardcodes 40+ CDN icon URLs in the frontend —
  should move to config.
- The Settings live-preview spins up a second dashboard instance with its own
  state and fetch cycle, which is wasteful.

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
