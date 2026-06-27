# Changelog

All notable changes to JagHelm are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/).

## [1.5.0] — 2026-06-27

**JagHelm goes mobile — and gets loud when something breaks.** Where 1.4.0 was a
correctness pass, 1.5.0 ships the biggest new surface since the dashboard itself:
a native Android app that watches the board from your pocket over the tailnet and
**pushes a notification the moment a service, host, UPS, or cron job changes state**
— no open tab, no manual polling. Alongside it, the board stops lying by omission —
a service that goes down now *shows* as down instead of silently vanishing, overall
health is computed once on the server, and Kuma can read every monitor and its uptime
from the authenticated `/metrics` endpoint. **389 server tests (up from 314), plus a
183-test web suite and a new 244-test mobile suite; the release's multi-agent security
review found no critical- or high-severity issues.**

### Mobile

- **A native Android app.** A Capacitor shell around the live dashboard, installable as
  a signed APK. Log in with username/password over the tailnet, with a keep-signed-in
  toggle that revalidates on launch.
- **Push notifications on real state changes.** The server diffs each refresh against the
  last and pushes via FCM only on genuine transitions: a service going **down/recovering**,
  a host going **unreachable**, a host metric **crossing a threshold** (with a hysteresis
  band so it doesn't flap on the edge), a **UPS dropping to battery / restored**, and a
  **cron job failing/recovering**. The snapshot → diff → dispatch core is deterministic.
- **Tap-to-incident deep links.** A notification opens the app straight to the relevant
  incident via a `jaghelm://` scheme.
- **Per-category notification settings + a real off switch.** Choose which event classes
  notify you; turning push off tears the device token down server-side, not just locally.
- **Signed-APK release pipeline.** A GitHub Actions workflow builds and signs the release
  APK (Capacitor 8 / JDK 21), gated on keystore secrets so it no-ops until they're set,
  with a keystore runbook.

### Monitoring

- **Down services show as down — they no longer disappear.** A stopped container's card
  used to vanish from the board entirely, which reads as "all clear." The board is now
  assembled from **running containers ∪ active Kuma monitors ∪ presence breadcrumbs**, so
  a down service stays on the board as a down card and a recently-vanished container leaves
  a grey breadcrumb instead of a silent gap.
- **Server-computed overall health** drives one status dot in the web NavBar and the mobile
  Overview, an **"unmonitored"** tag for services nothing is watching, and a
  **down → unknown → up** sort that floats trouble to the top.
- **Kuma can read the authenticated `/metrics` endpoint.** With `KUMA_API_KEY` set, one
  authenticated scrape replaces the two status-page calls and sees **every** monitor plus
  its 1-day uptime — keyed on `monitor_id`. It **degrades gracefully** back to the
  status-page path when the key is unset, wrong (a `401`), or the Kuma is too old to expose
  `monitor_id`, so a bad key never blanks the board.

### Fixed

- **One source of truth for the API base** across web and mobile (`getApiBase()`), with
  `ETag` added to the CORS exposed headers.
- A batch of mobile correctness fixes: push registration gated on build-time Firebase
  config, node-row navigation, ≥44px tap targets, and a tailnet-accurate URL placeholder.

### Security

- **Prototype pollution blocked in the new parsers and stores.** The Kuma `/metrics` parser
  and the push token/prefs store reject `__proto__` / `constructor` / `prototype` keys and
  validate their numeric inputs. Surfaced and fixed by this release's own multi-agent
  security review.
- **Mobile attack surface kept tight.** Cleartext HTTP is scoped to the tailnet only, the
  deep-link intent-filter drops `BROWSABLE`, `allowBackup` is off, and extra CSP connect
  entries are validated.
- **Dependency note.** Adding `firebase-admin` for FCM introduces **6 moderate** transitive
  advisories (via `@google-cloud/storage`); none are critical or high.

## [1.4.0] — 2026-06-22

**Correctness and clarity.** Where 1.3.0 added the glance layer, 1.4.0 is a deep
cleanup pass — a whole-codebase map → fix → review. No new features: it squashes
27+ real bugs (including a Kuma-outage board freeze and a class of "a real 0 reads
as no-data" drops), fixes an icon picker that showed a chosen icon's filename
instead of the icon, converges the icon pipeline onto a single resolver, trims
~370 lines of comment bloat, and closes a gap where an "unsupported" integration
could still be reached server-side. **314 automated tests (up from 256); 0 known
vulnerabilities.**

### Fixed

- **A Kuma outage no longer freezes the board.** A sustained status-page `5xx`
  was serving indefinitely-old "up" statuses past the 5-minute stale ceiling — the
  exact freeze the ceiling exists to prevent. Failure now drops to "unknown".
- **A real `0` is no longer mistaken for "no data."** A 0% CPU container, an idle
  `0°` sensor, a `0` UPS reading, or `0 MB` used previously coerced to a blank —
  fixed across ~10 metric-extraction sites (node discovery, refresh, and the Docker
  containers view).
- **Picking an icon now shows the icon, not a filename.** A panel/quick-link icon
  set to a bare Dashboard-Icons slug or filename (`gitea`, `gitea.svg`) was printed
  as text by some renderers; every renderer now resolves icon values the same way.
- **Proxmox child panels show on any node**, not only one literally named `pve` —
  the VM/storage/backup panels were gated on a hardcoded node key.
- **Quieter failures got louder.** Integration delete confirms before navigating
  away; a failed delete/toggle/refetch now raises a toast instead of silently
  leaving stale UI; the auth check fails closed (login gate) on a network/5xx
  instead of rendering a shell that then 401s.
- **Exact-match service hide/unhide** — hiding `redis` no longer also hides
  `redis-backup`, and un-hiding can't remove an unrelated rule.
- A batch of smaller correctness fixes: caddy/frigate count fields, an honest
  GitLab tile (version, not a meaningless project id), demo trailing-slash routes,
  the iframe **Retry** timer, weather lat/lon re-sync on config import, NavBar
  Enter-vs-dropdown agreement, and deterministic app-data matching.

### Changed

- **Whole-codebase structural cleanup.** De-duplicated primitives that had already
  *drifted* (error redaction, emoji detection, constant-time compare, login-body
  construction, color picker, field rows, the service-card projection), extracted
  oversized components into hooks, and deleted dead code — behavior preserved.
- **One icon pipeline.** A single `iconImageSrc` resolver (URL / slug / filename /
  emoji) shared by every renderer, one CDN base, one slug builder; built-in service
  icons moved off the deprecated `walkxcode` CDN to the maintained `homarr-labs`
  one. Proxmox integrations are now identified by a server-stamped preset id rather
  than by sniffing their output fields.
- **~370 fewer lines of comment bloat** (ASCII banners, changelog-in-comments,
  essays restating the code) — every security/why rationale kept.

### Security

- **The "unsupported integration" gate is now enforced server-side.** A preset
  flagged unsupported (e.g. Watchtower, whose `/v1/update` is a side-effecting
  update *trigger*, not a read-only status endpoint) was only hidden from the
  gallery — a directly-saved or imported config could still reach it via save,
  test, or the refresh loop. It's now blocked at the save / test / resolve
  chokepoints. Surfaced and fixed by this release's own multi-agent security
  review, which found no critical or high-severity issues.

## [1.3.0] — 2026-06-18

The **glance layer gets smart.** Where 1.2.0 hardened and polished, 1.3.0 makes
the board *tell you things at a glance* — trends, trouble, and the "why" behind a
blank panel — plus a command palette, a keyboard-operable grid, offline PWA, and
a real mobile pass. **256 automated tests (up from 195); 0 known vulnerabilities.**

### Glance & insight

- **Sparklines.** The refresh loop now keeps a ~1h ring buffer of every node's
  CPU/RAM/disk usage (persisted to `data/history.json`, served from a new authed
  `/api/history`) and draws an inline trend line behind each metric — "94% **and
  climbing**." It's a fixed window, not a time-series database.
- **Pre-attentive tinting.** A metric value turns **red** when it crosses
  critical and the whole card gets a colored **halo**, so trouble jumps off the
  board before you read it — instead of hiding in a 4px bar. (Non-color cue too:
  an SR-only severity label; amber is kept off large text for contrast.)
- **"Why is this dashed?" integration doctor.** When an integration's last fetch
  failed, the card now shows a collapsible **⚠ No data — why?** with the
  redacted error (e.g. `HTTP 401`) instead of mystery blanks — the error was
  already captured server-side; we just stopped throwing it away.
- **⌘K command palette.** Fuzzy-jump to any tab, theme, or configured link and
  run actions (Settings, Log out) from anywhere — keyboard-first (combobox/listbox
  semantics), no backend.
- **Grid "Auto-arrange."** One button (Settings → Layout) packs every panel into
  a gapless grid in priority order — nodes, then widgets, then groups.

### Accessibility

- **Keyboard-operable dashboard grid.** Each panel gains a focus-revealed handle:
  arrow keys move it a cell, Shift+arrow resizes, with a polite live-region
  announcement and boundary feedback — the grid was previously pointer-only.

### Offline / PWA

- The service worker now **precaches the hashed first-paint bundles** (injected at
  build) so the app boots offline, serves immutable `/assets/` cache-first, and
  **single-sources its version** from `package.json` (no more manual SW edit).

### Mobile

- A real responsive pass: the nav declutters on phones (drops the clock/"updated"
  stamp), side-by-side settings fields stack, and the settings sidebar reflows —
  closing the gaps behind the old "no mobile layout" caveat.

### Fixes

- **Panel resize is now in sync with its guideline.** The panel followed the
  mouse smoothly while the dotted guideline snapped to the grid, so the guideline
  (and the resize handle) could run past the panel and the size snapped back on
  release. The live panel now renders at the exact snapped rectangle the guideline
  draws — one shape, snapping together cell-by-cell — and is bounded to the grid
  edge so it can't be dragged past the panel.

### Internal & quality

- **Shared settings primitives** (`Card`/`Toggle`/`ChoiceGroup`/`EmptyState`)
  replace ~120 lines duplicated across the 13 settings tabs.
- **Spacing & type scale tokens** (`--space-*`, `--text-*`) with 100+ exact-match
  migrations (provably render-identical), alongside the existing semantic `--fs-*`.
- **Regenerated `docs/ARCHITECTURE.md`** to reflect reality, with 5 Mermaid
  diagrams (topology, refresh/cache, integration engine, frontend tree, CI/CD).

### Deploy

- **Event-driven build→deploy trigger** ([ADR 0005](docs/adr/0005-event-driven-deploy.md)):
  the GitHub build can now dispatch the Gitea deploy when the image is ready,
  replacing a registry poll. Opt-in and fallback-preserving — off until configured.

### Notes

- A new `data/history.json` is created automatically for the sparkline ring buffer
  (bounded, best-effort, non-essential — safe to delete; it refills).

## [1.2.0] — 2026-06-18

Where 1.1.0 hardened the foundation, 1.2.0 builds on it: the planned improvement
program (observability, frontend architecture, deeper security, growth, and
deploy hardening) lands in full, alongside a comprehensive accessibility & UX
overhaul driven by a dedicated design audit. **195 automated tests (up from 83);
0 known vulnerabilities.**

### ⚠️ Upgrade notes — read before deploying

- **A Content-Security-Policy is sent in report-only mode.** It does not block
  anything yet — it only reports violations — so custom inline scripts keep
  working while the policy is observed. Enforcement is a later opt-in.
- **New optional env:** `DEMO_MODE=true` serves a read-only sample dashboard
  (for screenshots / the public demo) and refuses writes. Off by default.

### Observability

- Structured request/error logging with redaction (no secrets in logs) replacing
  ad-hoc `console.log`.
- Prometheus metrics at `/metrics` (request rate, latency histograms,
  refresh-loop health) via `prom-client`.
- A real readiness probe at `/api/readyz` (distinct from liveness `/api/health`)
  so orchestrators don't route traffic before the first refresh completes.

### Security

- **Content-Security-Policy** (via Helmet, report-only) plus the standard
  security-header set; the service-worker registration was moved out of an inline
  `<script>` so the eventual enforcing policy needs no `unsafe-inline`.
- **Rate limiting** — the auth login limiter was hardened against brute-force, and
  a reusable `createRateLimiter` utility now throttles the abuse-prone integration
  connection-test endpoint (10/min per key).
- **Tighter input bounds** on the cron, secrets, and integration routes.
- **Threat model & runbook** — a STRIDE threat model and an incident-response
  runbook added under `docs/security/` so the posture is written down, not folklore.

### Reliability & correctness

- **Schema-validated config** — the display config is validated (Zod) on read, so
  a malformed or partially-written `config.yaml` is rejected with a clear error
  instead of crashing a render deep in the UI.
- **Persistence coordination** — config is now copied-on-read and written
  atomically, with a kill-test (`SIGKILL` mid-write) proving a crash can't leave a
  half-written or interleaved config on disk.
- **Route tests** — the Express API routes gained direct coverage (the bulk of the
  jump from 83 → 195 tests), catching contract regressions before they ship.

### Frontend architecture

- **ConfigContext** — the display config flows through a context instead of being
  prop-drilled through every view and all 13 settings tabs; memo-friendly so
  unrelated subtrees stop re-rendering on every change.
- **Explicit `apiFetch`** replaces a global `window.fetch` monkey-patch for
  auth-token injection — no more action-at-a-distance on third-party fetches.
- **`setIn`** — an immutable structural-sharing deep-set powers config edits, so
  untouched branches keep their identity (memo-friendly) and edits never mutate.
- **Route-level code-splitting** trims the initial bundle; **Vitest + React
  Testing Library** add a real component-test net (10 suites, 70 cases).

### Accessibility & UX

A four-batch overhaul from a senior front-end / design audit
(`docs/UI-UX-ANALYSIS.md`):

- **Feedback loop** — non-blocking toast notifications (`role=status`/`alert`) and
  themed confirm modals (focus-trap, `Escape`, focus restore, reduced-motion)
  replace native `alert()`/`confirm()`; a save-state indicator plus a
  flush-on-unload (`sendBeacon`/`keepalive`) so edits aren't lost on a fast close.
- **Per-source health** — each data source shows its own error / stale / retry
  state with a one-click retry, instead of an all-or-nothing board — without
  breaking the 304-stable render path (an all-unchanged poll still triggers zero
  re-renders).
- **Theme picker popover** — the 🎨 control opens a swatch popover (pick any of the
  10 themes directly) instead of blind-cycling; full keyboard + screen-reader
  semantics.
- **Skeleton loaders, live regions, accessible mobile nav** (disclosure pattern),
  a collapsible settings live-preview with grouped sidebar labels, and
  **field-level validation** (e.g. weather coordinates) with
  `aria-invalid`/`aria-describedby`.
- **Real CSS fixes** — defined the previously-undefined `--teal`/`--blue` tokens,
  gave each theme its own glass background, and dropped a render-blocking 11-family
  webfont `@import` in favour of an on-demand loader.

### Growth

- **Demo mode** (`DEMO_MODE=true`) serves a read-only sample dashboard for the
  public demo / screenshots without exposing a writable instance.
- **schema.org JSON-LD** structured data for richer search/social presentation.

### Deploy & supply-chain

- **Cosign keyless signing is enabled** — release images are signed and verifiable
  (`cosign verify ghcr.io/jagbhandal/jaghelm:1.2.0`).
- The **deploy pipeline pins images by digest** (not a mutable tag), with ADRs
  (`docs/adr/`) recording the deploy/signing decisions and a CI asset-integrity
  check (`scripts/check-assets.mjs`).

## [1.1.0] — 2026-06-17

A large hardening release from a full multi-agent audit of the codebase: every
security, correctness, accessibility, and supply-chain issue that was safe to fix
in one pass, plus deploy-pipeline and observability groundwork. **0 known
vulnerabilities; 83 automated tests (up from 33).**

### ⚠️ Upgrade notes — read before deploying

- **Secrets API is now fail-closed.** With no dashboard password set, the
  standalone `/api/secrets` API returns `403` instead of being world-readable
  (the integration-save flow is unaffected, so no-auth setups still work).
  Override on a trusted LAN with `JAGHELM_ALLOW_OPEN_SECRETS=true`. A loud warning
  prints at boot when no password is configured.
- **`compose.yaml` default networking changed** from `network_mode: host` to a
  bridge network publishing `3099:3099`; the container now runs **read-only as
  `user: 1000:1000`** with dropped capabilities. **First deploy: ensure host
  `data/` and `uploads/` are owned by UID 1000**, or the (now-real) deploy health
  gate will roll back. `network_mode: host` remains a commented opt-in (needed to
  reach LAN exporters directly).
- **Removed hardcoded fallback endpoints** — the AdGuard/NPM panels no longer
  default to a baked-in `192.168.68.13` / `admin@example.com`; set `ADGUARD_URL`
  / `NPM_URL` to enable them.
- **`DASH_SECRET` is validated** — the example placeholder (`your-random-secret-here`,
  `changeme`, …) is refused as an encryption key; set a real one
  (`openssl rand -hex 32`). Existing encrypted data is unaffected (legacy-salt
  fallback).
- **`multer` upgraded 1.x → 2.x** (1.x is end-of-life). No config change needed.

### Security

- SSRF guard enforced at the fetch chokepoint — every integration and
  session-auth request (incl. Proxmox) is vetted by construction; closes a bypass
  where session-auth and infra proxies fetched unguarded. Operator infra
  (Prometheus/Kuma) is exempted from strict-mode private-blocking via a `trusted`
  flag.
- Credential redaction — API keys carried in query-auth URLs (`?apikey=…`) are
  stripped before any error is logged or returned to the browser.
- Atomic `0600` writes for the encrypted secrets store, admin password hash, and
  cron history — a crash mid-write can no longer truncate them.
- Per-install random KDF salt replaces the published static salt (legacy fallback
  retained); fail-loud guard against a corrupted salt file (prevents silent secret
  loss).
- All 10 dependency advisories resolved (`path-to-regexp` ReDoS, `qs`/`js-yaml`/
  `postcss`/`vite`) → 0 vulnerabilities; `npm audit --audit-level=high` is now a CI
  gate.
- CI workflow injection fixed (`auto-pr.yml` passes the commit message via env +
  `jq`-encodes the body); Prometheus query-length cap; bounded per-query caches.

### Reliability

- Global JSON error handler — async route failures return JSON, not an HTML 500.
- Dynamic `/api/health` — reflects refresh-loop liveness (`503 degraded` when the
  loop wedges); the Docker `HEALTHCHECK` and deploy gate no longer trust a static
  literal.
- Process-level `unhandledRejection` / `uncaughtException` handlers — one stray
  rejection no longer downs the app.
- Integration fetch errors are surfaced instead of rendering as silent zeros
  during an outage; Uptime-Kuma staleness ceiling (no more frozen all-green
  board); corrupt `services.yaml` no longer re-parsed every 5 s; refresh timer
  cancelled cleanly on shutdown.
- Fixed an integration response-cache key collision (two instances of one preset
  served each other's data).

### Accessibility & UX

- Global `:focus-visible` ring across all 10 themes (WCAG 2.4.7);
  `prefers-reduced-motion` support; non-color status cues (shape + screen-reader
  text, WCAG 1.4.1); proper label association (`useId`/`htmlFor`) on all settings
  tabs; `aria-current`/`aria-selected` on nav + sidebar; `aria-label`s on icon
  buttons; AA-contrast fixes for light-theme muted text.
- Per-panel error boundaries — one throwing panel degrades inline instead of
  blanking the dashboard.
- First-run empty state with a "Connect your first node" CTA; blocking `alert()`
  upload errors replaced with inline dismissible messages.

### Performance

- Immutable `Cache-Control` on content-hashed `/assets` (no revalidation
  round-trip per reload).

### Quality, CI & supply-chain

- Quality floor: ESLint (flat) + Prettier + TypeScript (`checkJs` foundation) +
  `node --test`, gated in CI so a red `main` can't ship an image; meaningful
  `typecheck` (`@types/node` + `// @ts-check` on the security utils).
- 83 tests (from 33) — new coverage for the AES-GCM secrets round-trip + tamper,
  the SSRF guard vectors, credential redaction, the upload allowlist, and the
  HelmGrid layout math.
- Supply-chain: immutable `:sha-<short>` image tags for real rollback, SBOM +
  provenance attestations, a Trivy scan, OCI image labels, and
  `npm ci --ignore-scripts` in the build (cosign signing wired, ready to enable).

### Deploy

- Deploy verify step now actually gates — polls container health + `/api/health`
  and auto-rolls-back to the previous image on failure (was previously unable to
  fail). Runtime-hardened `compose.yaml` (see upgrade notes); version
  single-sourced into `/api/health`, the boot log, and image labels.

### Docs

- README repositioned around the "live data, not just links" differentiator + a
  comparison table; `KNOWN-ISSUES.md` added; missing PWA + social icons (fixes
  broken install + blank link unfurls); OG/Twitter meta; versioned service-worker
  cache key.
- `docs/IMPROVEMENT-PLAN.md` (full audit roadmap) and `docs/slos/` (SLO
  definitions for the planned observability work).

## [1.0.0] — 2026-03-27

- Initial public release. Image-based deployment to GHCR; HelmGrid layout engine;
  integration engine (42 presets); Settings UI; 10 themes; AES-256-GCM secrets;
  scrypt auth.

[1.3.0]: https://github.com/jagbhandal/jaghelm/releases/tag/v1.3.0
[1.2.0]: https://github.com/jagbhandal/jaghelm/releases/tag/v1.2.0
[1.1.0]: https://github.com/jagbhandal/jaghelm/releases/tag/v1.1.0
[1.0.0]: https://github.com/jagbhandal/jaghelm/releases/tag/v1.0.0
