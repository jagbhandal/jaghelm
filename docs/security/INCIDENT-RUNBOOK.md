# JagHelm — incident-response runbook

Short, practical steps for the homelab operator. JagHelm is single-instance, so
"recovery" is mostly: rotate the affected secret, re-wrap the store, redeploy.

## 1. `data/secrets.json` (or `DASH_SECRET`) was exposed

The credential store is AES-256-GCM with a key derived (scrypt) from `DASH_SECRET`
+ a per-install random salt (`data/.secrets-salt`). Exposure of the **ciphertext
alone** is not immediately game-over, but treat every stored credential as
compromised and rotate.

1. **Rotate the real credentials first** (the third-party app passwords/API tokens
   that JagHelm stored — Proxmox, AdGuard, Grafana, etc.). This is the thing that
   actually matters; the JagHelm store is just a copy.
2. **Rotate `DASH_SECRET`**: the old store can't be re-keyed in place (it decrypts
   with the old secret). Easiest clean path:
   - Stop the container.
   - Delete `data/secrets.json` **and** `data/.secrets-salt`.
   - Set a new strong `DASH_SECRET` (≥16 chars; the server warns on weak ones) via
     the systemd drop-in / compose env, not a committed `.env`.
   - Start the container and **re-enter each integration's credentials** in
     Settings → Integrations (they re-encrypt under the new key + fresh salt).
3. If `DASH_SECRET` itself leaked (not just the file), the above is mandatory, not
   optional — anyone with the secret + the file can decrypt everything.

## 2. The admin password / `data/auth.json` was exposed

It's a scrypt hash (not reversible), but rotate anyway:
- Change the password in Settings → Security (or set a new `DASH_PASS` and restart).
- Changing the password invalidates all other sessions (`deleteAllSessionsExcept`).

## 3. Suspected brute-force / unexpected probing

- Check the structured logs (`journalctl --user -u jaghelm` / container stdout):
  - `module:auth msg:"global login lock engaged"` → distributed brute force; the
    global limiter is already refusing logins for the window.
  - `module:integrations msg:"integration connection test"` with unfamiliar hosts →
    someone is using the test endpoint as a probe (it's rate-limited + audited).
- Check `jaghelm_auth_failures_total` in `/metrics` for the failure rate.
- If exposed to an untrusted network: set `DASH_PASS`, move off `network_mode: host`
  to a bridge + published port, and put it behind your reverse proxy + `TRUST_PROXY`.

## 4. Bad config pushed / dashboard wedged

- `data/services.yaml` is atomic-written and schema-validated on save; a bad
  external edit keeps the last-good in memory and logs a path-level error.
- Roll back the running image to the immutable tag: `ghcr.io/jagbhandal/jaghelm:sha-<short>`
  (or `@sha256:<digest>`) — see the deploy notes in `compose.yaml`.
- `/api/health` returns 503 when the refresh loop is wedged (stale); the Docker
  HEALTHCHECK + deploy verify gate use it.

## Prevention checklist

- [ ] `DASH_PASS` set (dashboard not open).
- [ ] Strong `DASH_SECRET` (≥16 chars), provided via systemd drop-in / compose env, never committed.
- [ ] Not exposed beyond a trusted LAN; if it must be, reverse proxy + `TRUST_PROXY` + bridge network.
- [ ] `data/` backed up (so a rotation/redeploy doesn't lose config) — but back up `secrets.json` + `.secrets-salt` together or not at all.
