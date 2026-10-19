# JagHelm — STRIDE threat model

A one-page model of JagHelm's real trust boundaries. JagHelm is a **single-user,
single-instance** homelab dashboard: a React SPA served by an Express server that
proxies Prometheus/cAdvisor/Kuma and 35+ third-party app APIs, persists config to
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
| **R**epudiation | "I didn't probe that host / change that" | Structured JSON access log (`accessLog.js`): 5xx, 4xx and slow requests at the default `LOG_LEVEL=info`; other requests, successful writes included, only at `LOG_LEVEL=debug`; `/metrics`, `/api/health` and `/api/readyz` only when they fail. Config saves (`config.js`, which covers integration save and delete) and password changes (`auth/routes.js`) log their own info line; audit log on the integration test probe (host + result); `jaghelm_auth_failures_total` metric | Single-user, so attribution is coarse. At the default `LOG_LEVEL=info`, other successful writes (a secret set or deleted, display config, todos, uploads, push registration, a cron job deleted) leave no log line, and a config save logs only that `services.yaml` was saved |
| **I**nfo disclosure | Leak credentials in logs/errors; read secrets/config unauthenticated; an integration target redirects to another origin to collect its credential (a header, a key in the URL, or a login body) | `redactSecrets()` at the fetch egress + in error logs; the access log records only the path, without the query string, fragment or an absolute-form URL's userinfo (`accessLog.js`); a redirect to another origin forwards only an allowlist of non-credential headers (`CROSS_ORIGIN_SAFE_HEADERS` in `util/safeFetchCore.js`), and a request whose URL carries the credential (query-auth presets such as SABnzbd, Tautulli and Emby; a `{token}`, `{password}` or `{username}` endpoint placeholder) follows no redirect to another origin at all (`credentialInUrl`, set where the URL is built); a `307`/`308` keeps a request's body but never re-sends it (a session login's username and password) to another origin; all three make one exception, an `http://` to `https://` upgrade on the same host and port, which re-sends to that host what was just sent to it; fail-closed `/api/secrets` (403 until a password is set); per-install KDF salt; secrets never returned (only key names) | `/metrics` is public (counts/timings, no secrets) — Prometheus must reach it. A key written into a custom integration's URL or endpoint by hand, or filled from a placeholder other than `{token}`/`{password}`/`{username}`, is not known to be a credential, so such a request still follows a redirect to another origin |
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
- **Global login lock = a small lockout-DoS surface**: an attacker who can reach
  `/login` can deliberately trip the global failure lock (50/15min) to deny the
  real admin for the window. For a single-user app this is the right tradeoff —
  far better than letting an IP-rotating brute force through — and it self-clears
  in 15 min, but on an internet-exposed instance prefer a reverse-proxy WAF/IP
  allowlist in front of `/login`.

See `docs/security/INCIDENT-RUNBOOK.md` for what to do if a secret is exposed.
