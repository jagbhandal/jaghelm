# JagHelm Improvement Plan (skill-mapped)

> Produced 2026-06-17 by a multi-agent audit: 8 recon agents (one per dimension) read the **actual current code** (not the stale v6.1 `ARCHITECTURE.md`) and tagged each finding with the specific Claude Code skill that would drive it; a synthesis pass built the roadmap; an adversarial critic verified the load-bearing claims against the source and caught what the recon agents missed. 61 grounded opportunities → the prioritized plan below. **53 of the ~100+ available skills map to real JagHelm work** (coverage table at the end); the rest (regulatory/QMS, cloud/k8s, payments, ML/data, AI-security) are genuinely N/A to a single-container self-hosted dashboard with no DB/LLM.

## The honest big picture

JagHelm is a **mature post-refactor codebase, not a hobby sketch**. The backend is cleanly decomposed (`routes/`, `auth/`, `integrations/`, `util/`), the crypto/auth primitives are *correct* (scrypt + timing-safe compare, AES-256-GCM w/ per-encrypt IV + auth tag, header-token sessions immune to CSRF), the SSRF guard + per-request scoped TLS bypass show real security intent, atomic writes and ETag caching exist, and the frontend data layer + 473-line custom grid engine reflect deliberate engineering. The product is genuinely differentiated too — **live-data integrations (42 presets) + a drag-resize grid** set it apart from the Homepage/Homarr/Dashy "bookmarks" crowd.

The leverage is that **this per-file diligence is real but unenforced and uneven.** Three structural multipliers undercut everything else:

1. **No quality floor.** No ESLint/Prettier/TypeScript anywhere (two `eslint-disable` comments suppress a linter that isn't installed). 7 well-written `node:test` suites exist but **nothing runs them** — no `test` script, no CI step — and **2 of 7 are currently RED** (undici import) and nobody noticed. Every safety property the authors built can silently regress.
2. **Two dangerous security defaults** despite the careful primitives: the app **ships fully open** (no `DASH_PASS` ⇒ `/api/secrets` and `/api/services/config` are world-readable, on `network_mode: host`), and the **SSRF guard is bypassed** on the entire session-auth + infrastructure-proxy fetch paths (incl. Proxmox) because `assertSafeUrl` is called per-site instead of at the fetch chokepoint.
3. **Almost no growth surface:** no live demo, a brutal hard-Prometheus onboarding cliff, broken trust links (`KNOWN-ISSUES.md` + PWA icons referenced but absent), no OG/SEO tags, canonical repo on Gitea while external links point at a GitHub mirror.

**Almost nothing here is a rewrite — it's enforcement, default-hardening, and finishing.** Sequence: install the floor → ship cheap structural security fixes → then the larger architecture and growth work.

---

## ▶ Do now — zero-dependency / highest-leverage (mostly S)

These have no dependency on later phases and several are *losing users or leaking data today*. Ship as small, individually-reviewed PRs.

| # | Fix | Why | Skills |
|---|-----|-----|--------|
| 1 | `test` script + CI job (`npm ci && node --test`) gating build/deploy — **report-only first** | 7 suites exist, nothing runs them, 2 RED. Highest-leverage change in the repo. | senior-qa, ci-cd-pipeline-builder, senior-devops |
| 2 | Fix the 2 RED suites (decouple pure `assertSafeUrl`/session tests from the heavy undici import) + assert `pass==total` | Makes the gate meaningful. | senior-qa, tdd-guide |
| 3 | Gate `/api/secrets` + `/api/services/config` behind `authEnabled()` (403 when auth off) | Stops anonymous credential read/write on the default-open deploy. | senior-security, senior-backend, senior-secops |
| 4 | **`redactUrl()` before logging/returning integration errors** ⚠️*critic-found* | `auth:'query'` presets put the API key in the URL; the catch block logs **and returns** `err.message`, which can embed the full URL ⇒ key leak to the browser. | security-pen-testing, senior-backend, adversarial-reviewer |
| 5 | Fix integration response-cache key collision (key by `_storageKey`, not preset `type`) | Two instances of one preset (`adguard_primary/secondary`) share a key and serve each other's data. | senior-backend, api-design-reviewer |
| 6 | Add the missing global Express error-handler before the SPA fallback | Self-documented TODO; async failures return HTML 500 and break every frontend `await res.json()`. | senior-backend, senior-qa |
| 7 | Route `secrets.js`, `passwords.js`, `cron-store.js` through `atomicWriteFileSync` (mode `0o600`) | Helper already exists but is bypassed for the 3 highest-stakes files; a kill mid-write corrupts the credential store / admin hash. | senior-backend, secrets-vault-manager |
| 8 | `npm audit fix` + bump **multer → 2.x** (own PR, see ⚠️) + `npm audit --audit-level=high` CI gate + Renovate | Live HIGH path-to-regexp ReDoS (reachable via `app.get('*')`) + EOL multer 1.x, no gate. | dependency-auditor, senior-secops, senior-devops |
| 9 | Global `:focus-visible` ring on the accent token | Zero focus indicators anywhere (WCAG 2.4.7) — one `:where()` rule fixes all 10 themes. | senior-frontend, ui-design-system |
| 10 | `prefers-reduced-motion` block + non-color status cue (glyph/aria-label) on status dots | Infinite pulse/shimmer (2.3.3); up/down by color alone (1.4.1). | senior-frontend, ux-researcher-designer |
| 11 | Associate settings labels (`useId`/`htmlFor`) in the shared `Field` helper | 0 `htmlFor` across all 13 tabs; one change propagates everywhere. | senior-frontend, ux-researcher-designer |
| 12 | **Pulled forward from "growth" ⚠️*critic*:** write `KNOWN-ISSUES.md`, add missing PWA icons (`icon-512.png`, `apple-touch-icon.png`), add OG/Twitter + meta-description to `index.html`, reconcile `compose.yaml` ↔ documented quickstart | Broken PWA install + blank link unfurls + the #1 "empty dashboard" support driver — all byte-level, no refactor dependency. | seo-audit, landing-page-generator, roadmap-communicator, free-tool-strategy |
| 13 | **Quote/`jq`-encode the head-commit message in `.gitea/auto-pr.yml` ⚠️*critic*** | Raw interpolation into a JSON body ⇒ a `"` or `${...}` in a commit msg breaks PR creation / is a CI injection surface. | senior-devops, ci-cd-pipeline-builder |

---

## Phased roadmap

Skills listed per phase. ⚠️ = correction applied from the adversarial critique.

### Phase 1 — Install the quality & supply-chain floor *(enables safe iteration; must precede the refactors)*
`senior-qa` `tdd-guide` `ci-cd-pipeline-builder` `senior-devops` `senior-frontend` `dependency-auditor` `migration-architect` `tech-stack-evaluator`*(new)*
- `test`/`test:watch` (`node --test`) + CI (`.github` + `.gitea`) with build/deploy `needs: test` — **report-only**, not required yet.
- Fix the 2 RED suites; add `pass==total` smoke assertion.
- ESLint flat config (react, react-hooks, react-refresh) + Prettier + `lint`/`format:check`, report-only; resolve/justify the 2 dead `exhaustive-deps` disables.
- JSDoc/`checkJs` `tsconfig` (no source rewrite) + `typecheck` + a shared `types.d.ts` for the `Config`/`ServiceData` shapes. ⚠️ Use **tech-stack-evaluator** to right-size *checkJs-via-JSDoc vs full `.ts`* and *node:test vs Vitest* rather than choosing by assertion.
- `npm audit --audit-level=high` gate + Renovate/Dependabot (deps, base image, **Actions pinned to SHAs**); `npm audit fix`. ⚠️ **multer 2.x is a breaking major on the only upload path — its own PR, with upload tests written first**, not folded into the audit sweep.
- Vitest + jsdom + Testing Library scaffolding; first unit tests on the **pure `gridMath.js`** exports (`resolveOverlaps`, `autoFitWidth`, `layoutsEqual`, px↔grid round-trips) — cheapest, highest-value coverage.

### Phase 2 — Fail-closed security defaults & SSRF chokepoint
`senior-security` `senior-backend` `senior-secops` `security-pen-testing` `adversarial-reviewer` `secrets-vault-manager` `senior-qa` `api-test-suite-builder` `env-secrets-manager`*(new)* `feature-flags-architect`*(new)*
- **Secure first-run:** no password ⇒ auto-generate+log a one-time admin password *or* bind `127.0.0.1` + mandatory setup screen; minimum bar = gate secrets/config-write routes behind `authEnabled()`; document host-network exposure.
- ⚠️ **Single SSRF chokepoint — NOT a 1-line "S".** Moving `assertSafeUrl` into `lib/http.js`/`httpClient.js` `safeFetch` changes behavior on the **entire outbound surface** (login POST, Proxmox, weather→public API, icon-cache→CDN, Kuma→LAN). Needs **per-caller `skipGuard`/intent flags + the full regression matrix written BEFORE the migration** (the critic flagged the plan originally scheduled those tests *after*). Add the untested bypass vectors: hex-mapped IPv4-in-IPv6, decimal/hex IPv4; documented skipped DNS-rebinding TODO.
- Real **CSP** (nonce/hash for theme inline styles; `default-src 'self'`, `object-src 'none'`, scoped connect/img). ⚠️ **Realistically M/L, not S/M** (touches how every themed component renders) — ship **report-only with a scheduled enforce milestone** so it doesn't sit half-landed forever. Serve cached SVG icons with `default-src 'none'` + `Content-Disposition`.
- Per-install **random KDF salt** (+ legacy-salt fallback) and **low-entropy `DASH_SECRET` rejection**. ⚠️ Use **env-secrets-manager** to audit the whole env contract (required-vs-optional, fail-fast-in-prod, `.env`-vs-systemd precedence) — distinct from the at-rest crypto work.
- **Bound + validate** the per-query caches (LRU cap; numeric-range lat/lon; length/shape cap on PromQL) — kills the memory-exhaustion DoS.
- ⚠️ **Prometheus proxy is an open PromQL passthrough ⚠️*critic*** — in no-auth mode it's an unauthenticated read of the *entire* monitoring backend. Add a real **query allowlist + upstream timeout budget**, not just a cache cap.
- ⚠️ **`/api/integrations/test` is a deliberate SSRF/port-scan oracle ⚠️*critic*** even after the chokepoint — **rate-limit + audit-log** it; note in the STRIDE model.
- Harden the login limiter: **global** failed-attempt counter + account lockout + failed-login delay floor, with a structured log/metric.
- Tests: `secrets.test.js` (AES-GCM round-trip, tamper⇒null, wrong secret, precedence) + auth-HTTP-layer tests (noauth bypass, 5→429+reset, expiry, 401) via supertest.
- One-page **STRIDE** threat model of the real boundaries (LAN-facing, host-networked, user-supplied URLs, secrets-at-rest). ⚠️ Pair with an **incident-response***(new)* mini-runbook: what to do if `secrets.json` is exposed / how to rotate `DASH_SECRET` and re-wrap.
- ⚠️ Use **feature-flags-architect** to give CSP report-only→enforce, the lint/audit report-only→required gate, and later DEMO_MODE **one coherent staged-rollout strategy** instead of ad-hoc env checks.
- ⚠️ **Note the CORS nuance ⚠️*critic*:** `cors({origin:false})` only omits the ACAO header; it's *not* server-side authorization (browser-enforced; API uses a header token). Document so nobody mistakes it for access control.

> **Gate-flip rule ⚠️*critic*:** runner report-only (P1) → fix RED suites → land SSRF chokepoint + its new tests (P2) → **then flip CI to required.** Don't arm a required gate the P2 refactor will immediately turn red.

### Phase 3 — Crash-safe persistence, API contract & backend correctness
`senior-backend` `senior-architect` `api-design-reviewer` `secrets-vault-manager` `senior-qa` `tdd-guide` `chaos-engineering`
- Atomic `0o600` writes for secrets/passwords/cron-store + a **mid-write-kill survival test** (chaos-engineering).
- Strip `result.raw` from `GET /api/integrations/:type` (gate behind `?debug=1`).
- One **response envelope** (`{data}` / `{error,code}`); settle cold-start on `503` everywhere; capture in `API.md`/OpenAPI stub.
- **One guarded outbound HTTP client** (timeout + `assertSafeUrl` + no-follow-to-blocked + explicit `skipTls`); migrate the 4 infra routes + 4 raw-`fetch` modules onto it.
- **Coordinate config persistence:** `getConfig()` returns a `structuredClone`/frozen object; mutating routes operate on a clone; serialize writes through one async mutation queue. ⚠️ **The hard part ⚠️*critic* is the file-watcher ↔ queue interaction** — make the 5s debounced watcher queue-aware / suppressed during self-writes, or you reintroduce torn state with false confidence.
- **Schema-validate `services.yaml`** in `loadConfig` (zod or light validator): on mismatch keep last-good + log path-level error; cap `POST /config` body + key allowlist.
- Backfill cheap pure-function backend coverage (`extract.js` operators, `format.js` boundaries, `discovery.js` math); enable **ratcheting coverage**.

### Phase 4 — Accessibility, responsive & UX finishing
`senior-frontend` `ux-researcher-designer` `ui-design-system` `browser-automation` `frontend-design`
- `aria-current`/`selected` on nav + 13-tab sidebar; convert the `IconPicker` trigger `div`→`button`; dnd-kit `KeyboardSensor` + announcements for keyboard reordering.
- Redundant non-color status cue in dot/minimal modes; darken `--text-muted` on the 4 light themes to ≥4.5:1 + a contrast-check note for future themes.
- **Mobile:** nav affordance under 600px (the tabs currently just vanish); lower the single-column collapse to the `md` band; validate with a **real device-width Playwright pass** (browser-automation).
- **Per-panel `ErrorBoundary`** with a compact inline fallback (one bad panel currently blanks the whole dashboard); keep root boundary as last resort.
- Dashboard **empty-state** ("Connect your first node" CTA) when `nodes` is empty & not loading; replace the 2 blocking `alert()` calls with an inline themed toast.

### Phase 5 — Frontend architecture & render efficiency *(after a11y, so component churn happens once, with tests in place)*
`senior-frontend` `senior-architect` `senior-qa` `performance-profiler` `simplify`
- ⚠️ **Write RTL coverage of the prop-drilled components BEFORE the migration ⚠️*critic*** (the original plan built the safety net in the same phase as the riskiest refactor).
- Introduce **`ConfigContext`** (or display/server/data contexts); leaves subscribe to narrow slices; remove `setConfig` prop-drilling so the existing `React.memo` on `NodeCard`/`NavBar`/`ServiceCard` actually engages.
- Replace `JSON.parse(JSON.stringify)` path-setter with an immutable `setIn(obj, path, value)` (or immer); consolidate the **3 duplicated clone sites** (`simplify`).
- Replace the global `window.fetch` monkeypatch with an explicit, testable `apiFetch()` reading the token from a small auth store.
- `React.lazy` `SettingsView` (+13-tab tree), `IframeView`, `IconPicker` behind Suspense; `manualChunks` for the dnd-kit/react-colorful vendor split; **measure with `vite build --report`** (performance-profiler).

### Phase 6 — Deploy reliability, observability & docs/ADRs
`senior-devops` `ci-cd-pipeline-builder` `cloud-security` `observability-designer` `senior-architect` `codebase-onboarding` `runbook-generator` `changelog-generator` `chaos-engineering` `slo-architect`*(promoted from optional)*
- ⚠️ **Couple build→deploy properly** (`workflow_run`/`repository_dispatch`/webhook, not `sleep 120`); pass the **immutable image digest/SHA** from build to deploy; pin compose to the digest so **rollback is real**; add `:sha-<short>` alongside `:latest`.
- **Make the deploy "Verify" step actually gate** (poll `docker inspect Health.Status==healthy` + assert `curl -fsS .../api/health | grep status:ok`; fail/auto-rollback otherwise) — today it can't fail (chaos-engineering for the failure-injection test).
- ⚠️ **Service-worker stale-shell ⚠️*critic*:** `public/sw.js` uses a hardcoded `CACHE_NAME='jaghelm-v1'` that never changes ⇒ users can be served a stale shell indefinitely after a deploy. **Stamp the SW cache key with the build SHA/version** (same single-source as below).
- **Harden the published compose** (`read_only`+tmpfs, `cap_drop ALL`, `no-new-privileges`, mem/pids limits, explicit non-root); document `network_mode: host` as opt-in with a bridge+publish default (cloud-security).
- **Structured logging** (pino/JSON, per-request line) replacing the 66 ad-hoc `console.*`; **`prom-client /metrics`** (req/duration, refresh-loop errors, integration-fetch duration, auth failures) + `/readyz` checking Prometheus/Kuma reachability — *on-brand for an observability tool* (observability-designer). ⚠️ Once `/metrics` exists, **define a minimal availability/error-rate SLO for the dashboard itself** (slo-architect) — completes the "monitor the monitor" story.
- **Single-source the version** from `package.json` into `/api/health` + boot log + image label (fix the `8.0.0-alpha.1` vs `1.0.0` drift); semver tags + generated **CHANGELOG** from the conventional-commit PR titles already in use (changelog-generator).
- Add `stopBackgroundRefresh()` called from `shutdown()` (close the leaking-interval TODO); document the single-instance constraint as an **ADR**.
- ⚠️ **Supply-chain table-stakes ⚠️*critic*:** `npm ci` with lockfile-integrity in the Docker build + **cosign image signing + SBOM/provenance** for the public GHCR image (not just CVE-gating).
- Regenerate `ARCHITECTURE.md` from the current tree + Mermaid data-flow + short ADRs (atomic writes, scoped TLS bypass, in-memory single-instance); CI link/asset-existence check (codebase-onboarding, runbook-generator for deploy/rollback + secrets-recovery).

### Phase 7 — Growth: onboarding, demo, positioning & community *(the cheapest conversion leverage; benefits from the fixed empty-state + hardened defaults + accurate docs)*
`competitive-teardown` `ux-researcher-designer` `landing-page-generator` `free-tool-strategy` `launch-strategy` `seo-audit` `schema-markup` `copywriting` `roadmap-communicator` `product-strategist` `changelog-generator` `product-analytics`*(new)* `experiment-designer`*(new)* `content-strategy`*(new)*
- **Kill the Prometheus onboarding cliff:** standalone-usable dashboard (links/integrations) with **Prometheus opt-in** (metrics become depth, not a prerequisite); guided empty-state CTA (built P4); self-monitoring `/metrics` fallback so a single-node user sees real numbers on first boot. ⚠️ Frame opt-in-vs-gate as an **experiment-designer** hypothesis, not a foregone conclusion.
- **Read-only public demo** (`DEMO_MODE` + canned fixtures; client-side drag/resize/themes) as the first README badge + a 30s GIF above the fold. ⚠️ **`DEMO_MODE` is a new security-sensitive ingress ⚠️*critic*** — must guarantee no write routes / no secrets endpoints / no outbound fetch reachable; give it its own security review (it's the default-open class again).
- **Reposition the README** around the real wedge ("**live data, not just links**") with a JagHelm-vs-Homepage-vs-Dashy table; themes/PWA below the fold (competitive-teardown, copywriting).
- **Pick one public home:** authoritative GitHub mirror (push-mirror from Gitea) with Issues + Releases matching image tags + topics; verify every `github.com` link resolves; `awesome-selfhosted` + one r/selfhosted launch post (launch-strategy).
- Landing page + `schema.org SoftwareApplication` (seo-audit, schema-markup, landing-page-generator).
- Community-health set: bug template (forces JagHelm/Prometheus/deploy versions), `CONTRIBUTING.md`, PR template, `CODE_OF_CONDUCT`, `FUNDING.yml`, `CHANGELOG`.
- ⚠️ **Instrument it ⚠️*critic*:** define the activation funnel (install → first node → first integration → retained) with **product-analytics**, and a sustaining **content-strategy** (changelog-as-content, "how I monitor my homelab" posts) so discovery outlives launch day — the original growth phase was launch-moment-only.

### Phase 8 — Quality gates *(hard rule at the end of EVERY phase)*
`simplify` `code-review` `verify` `ship-gate` `self-eval` `pr-review-expert` `focused-fix` `spec-driven-workflow` `adversarial-reviewer`
- After each phase: **`/simplify` then `/security-review`** before "done" (your standing hard rule).
- `code-review` the diff (medium/high) for correctness + reuse; `pr-review-expert` on the PR; `verify` by running app/tests; `ship-gate`/`self-eval` pre-merge.
- `spec-driven-workflow` to pin scope for the multi-file items (CSP, ConfigContext, response-envelope, JS→TS, single-instance) before coding; `focused-fix` for the tightly-scoped single-file fixes.

---

## Skills the audit added (critic-surfaced, not in the original mapping)
`tech-stack-evaluator` (right-size the TS/test-runner choices) · `env-secrets-manager` (full env-var contract audit) · `product-analytics` (activation funnel + events) · `experiment-designer` (test the onboarding/positioning bets) · `content-strategy` (sustain discovery) · `feature-flags-architect` (coherent staged rollouts) · `slo-architect` (promote to a named P6 deliverable) · `incident-response` (secrets-exposure/SSRF runbook).

## Not applicable (so the inventory is honest)
`ra-qm-skills:*` (ISO 13485 / MDR / FDA / GDPR / SOC2 / EU AI Act) · `database-designer`/`sql-database-assistant` (no DB — JSON/YAML + in-memory Maps) · `ai-security` (no LLM/ML) · `aws/azure/gcp-cloud-architect`, `kubernetes-operator` (single Docker container) · `stripe-integration-expert`, `email-template-builder` (no payments/email) · `senior-data-engineer`/`data-scientist`/`ml-engineer`/`computer-vision`/`prompt-engineer` (no data/ML/prompt surfaces).
