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
| **I**nfo disclosure | Leak credentials in logs/errors; read secrets/config unauthenticated; an integration target redirects to another origin to collect its credential (a header, a key in the URL, or a login body) | `redactSecrets()` at the fetch egress + in error logs; the access log records only the path, without the query string, fragment or an absolute-form URL's userinfo (`accessLog.js`); a redirect to another origin forwards only an allowlist of non-credential headers (`CROSS_ORIGIN_SAFE_HEADERS` in `util/safeFetchCore.js`), and a request whose URL carries the credential (query-auth presets such as SABnzbd, Tautulli and Emby; a `{token}`, `{password}` or `{username}` endpoint placeholder) follows no redirect to another origin at all (`credentialInUrl`, set where the URL is built); a `307`/`308` keeps a request's body but never re-sends it (a session login's username and password) to another origin; all three make one exception, an `http://` to `https://` upgrade on the same host and port, which re-sends to that host what was just sent to it; fail-closed `/api/secrets` (403 until a password is set); per-install KDF salt; secrets never returned (only key names) | `/metrics` is public (counts/timings, no secrets) — Prometheus must reach it. `/api/icons/cached` is public, so anyone who can reach the port can tell which icons are already cached (the `X-Icon-Cache` header, or the time a response takes) and from that infer which services the dashboard shows; accepted, as the icons are public and the endpoint has to be. A key written into a custom integration's URL or endpoint by hand, or filled from a placeholder other than `{token}`/`{password}`/`{username}`, is not known to be a credential, so such a request still follows a redirect to another origin |
| **D**oS | Unbounded caches/maps; oversized bodies; refresh wedge; filling the disk through the public icon cache | FIFO-bounded caches (`cache.js`) + rate-limiter keys; 1MB body limit + per-route size caps (zod 512KB, secrets 8KB, cron field caps); refresh-loop liveness in `/api/health`/`/readyz`; `/api/icons/cached` fetches only icon-repository URLs, rebuilt from an allowlist so query-string variants share one file (`icon-sources.js`), caps each icon at 512 KB and the whole cache at 50 MB (`JAGHELM_ICON_CACHE_MAX_MB`) with least-recently-used eviction, counted from disk at boot; at most 8 fetches from the CDN run at once with 256 more waiting (a 503 with `Retry-After` past that), a body is held only until it is on disk and every response streams from the file, so icon bodies in memory stay under 4 MB however many misses arrive or however slowly clients read (`icon-cache.js`) | Single instance — a determined LAN attacker can still load it; memory still grows with the number of open connections, as for any route (measured: 4,000 concurrent requests for refused URLs take the process from 64 MB to about 130 MB RSS, the same number of icon misses to about 190 MB). Anyone who can reach the port can churn the icon cache (evicting the dashboard's icons, which are then fetched again), fill the fetch queue so other misses get a 503 for a while, and make the server fetch allowlisted icons from jsDelivr |
| **E**levation | SSRF via an integration URL → reach internal services / cloud metadata | `assertSafeUrl` enforced **inside** both `safeFetch` clients (blocks metadata IP, decimal/hex/octal IPv4, IPv4-mapped IPv6, private nets in strict mode); operator infra is `trusted` and exempt only from the private-net block. The app-tab embed check (`/api/embed-check/:tabId`, `embedCheck.js`) fetches only a URL saved as an app tab, looked up by tab id, with no cookie or credential, follows redirects only on the same hostname with `assertSafeUrl` on every hop, and returns two header values at most, never the body | `/api/integrations/test` is a deliberate reachability oracle — now rate-limited + audited; the embed check is a weaker one for a signed-in user who saves an app tab (it answers unreachable, timed out or a framing header), bounded by its cache and 30 reads a minute; DNS-rebinding is a documented TODO |

## The deliberate sharp edges (accepted, documented)

- **Open by default** (no password ⇒ unauthenticated) and **`network_mode: host`**
  in the published compose — both are LAN-convenience defaults with loud warnings.
  Set `DASH_PASS` and/or a bridge network + published port to close them.
- **`/api/integrations/test`** can probe any host the server can reach. It's behind
  auth, rate-limited (10/min/IP), and audit-logged, but remains an oracle by design
  (you have to be able to test a connection before saving it).
- **`/metrics`** is public by convention so Prometheus can scrape it; it exposes
  request counts/timings and refresh health, never secrets or config values.
- **`/api/icons/cached`** is public because an `<img>` can't send the header
  token. It fetches and serves only icon-repository icons (Dashboard Icons and
  selfh.st, SVG/PNG/WebP), never follows a redirect elsewhere, and serves them
  with `default-src 'none'; style-src 'unsafe-inline'; sandbox` and `nosniff`,
  so an SVG opened directly can't run script on JagHelm's origin.
- **Global login lock = a small lockout-DoS surface**: an attacker who can reach
  `/login` can deliberately trip the global failure lock (50/15min) to deny the
  real admin for the window. For a single-user app this is the right tradeoff —
  far better than letting an IP-rotating brute force through — and it self-clears
  in 15 min, but on an internet-exposed instance prefer a reverse-proxy WAF/IP
  allowlist in front of `/login`.

See `docs/security/INCIDENT-RUNBOOK.md` for what to do if a secret is exposed.
