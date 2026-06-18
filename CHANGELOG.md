# Changelog

All notable changes to JagHelm are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/).

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

[1.2.0]: https://github.com/jagbhandal/jaghelm/releases/tag/v1.2.0
[1.1.0]: https://github.com/jagbhandal/jaghelm/releases/tag/v1.1.0
[1.0.0]: https://github.com/jagbhandal/jaghelm/releases/tag/v1.0.0
