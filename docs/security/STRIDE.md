# JagHelm — STRIDE threat model

A one-page model of JagHelm's real trust boundaries. JagHelm is a **single-user,
single-instance** homelab dashboard: a React SPA served by an Express server that
proxies Prometheus/cAdvisor/Kuma and ~42 third-party app APIs, persists config to
YAML/JSON files, and stores credentials AES-256-GCM-encrypted. It is designed to
run on a **trusted LAN**; several defaults assume that (see KNOWN-ISSUES.md).

## Trust boundaries / assets

1. **Browser ↔ server** — header-token sessions (`x-auth-token`), no cookies (CSRF-immune).
2. **Server ↔ disk** — `data/services.yaml`, `data/display-config.json`,
   `data/secrets.json` (encrypted), `data/auth.json` (scrypt hash), cron history.
3. **Server ↔ backends** — Prometheus/Kuma (operator-configured, trusted) and
   user-configured integration URLs (untrusted target).
4. **Assets**: the admin password hash, the at-rest credential store + its KDF
   salt + `DASH_SECRET`, and the metrics/config the dashboard exposes.

## STRIDE

| Threat | Vector | Mitigation (in code) | Residual / notes |
|---|---|---|---|
| **S**poofing | Forge a session; brute-force the admin password | scrypt + timing-safe compare (`auth/passwords.js`, `auth/routes.js`); per-IP **and** global login limiter + failure-delay floor (`auth/rateLimit.js`) | Open-by-default when no `DASH_PASS` — loud boot warning; LAN-only assumption |
| **T**ampering | Corrupt config/secrets store; torn write on crash | Atomic temp→fsync→rename writes (`util/atomicWrite.js`); copy-on-read config so a route can't mutate shared state; zod validation + reserved-key reject on config writes | External edits to `services.yaml` are intentionally honored (watcher) |
| **R**epudiation | "I didn't probe that host / change that" | Structured JSON access log (per request) + audit log on the integration test probe (host + result) + `jaghelm_auth_failures_total` metric | Single-user, so attribution is coarse |
| **I**nfo disclosure | Leak credentials in logs/errors; read secrets/config unauthenticated | `redactSecrets()` at the fetch egress + in error logs; fail-closed `/api/secrets` (403 until a password is set); per-install KDF salt; secrets never returned (only key names) | `/metrics` is public (counts/timings, no secrets) — Prometheus must reach it |
| **D**oS | Unbounded caches/maps; oversized bodies; refresh wedge | FIFO-bounded caches (`cache.js`) + rate-limiter keys; 1MB body limit + per-route size caps (zod 512KB, secrets 8KB, cron field caps); refresh-loop liveness in `/api/health`/`/readyz` | Single instance — a determined LAN attacker can still load it |
| **E**levation | SSRF via an integration URL → reach internal services / cloud metadata | `assertSafeUrl` enforced **inside** both `safeFetch` clients (blocks metadata IP, decimal/hex/octal IPv4, IPv4-mapped IPv6, private nets in strict mode); operator infra is `trusted` and exempt only from the private-net block | `/api/integrations/test` is a deliberate reachability oracle — now rate-limited + audited; DNS-rebinding is a documented TODO |

## The deliberate sharp edges (accepted, documented)

- **Open by default** (no password ⇒ unauthenticated) and **`network_mode: host`**
  in the published compose — both are LAN-convenience defaults with loud warnings.
  Set `DASH_PASS` and/or a bridge network + published port to close them.
- **`/api/integrations/test`** can probe any host the server can reach. It's behind
  auth, rate-limited (10/min/IP), and audit-logged, but remains an oracle by design
  (you have to be able to test a connection before saving it).
- **`/metrics`** is public by convention so Prometheus can scrape it; it exposes
  request counts/timings and refresh health, never secrets or config values.

See `docs/security/INCIDENT-RUNBOOK.md` for what to do if a secret is exposed.
