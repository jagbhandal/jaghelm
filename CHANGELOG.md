# Changelog

All notable changes to JagHelm are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/).

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

[1.1.0]: https://github.com/jagbhandal/jaghelm/releases/tag/v1.1.0
[1.0.0]: https://github.com/jagbhandal/jaghelm/releases/tag/v1.0.0
