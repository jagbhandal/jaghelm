# Watchtower Update Notifications — Operator Setup

JagHelm (vm103) hosts `POST /api/watchtower/event`. Each node's Watchtower POSTs a
structured report there; JagHelm fans out to mobile push + the daily-health Discord channel.

## 1. JagHelm server (vm103, /opt/stacks/jaghelm)
Set in the prod env and restart the service:
- `JAGHELM_WATCHTOWER_SECRET` — a long random shared secret (e.g. `openssl rand -hex 24`).
- `JAGHELM_WATCHTOWER_DISCORD_WEBHOOK` — incoming webhook URL for the daily-health channel
  (Discord → channel → Edit → Integrations → Webhooks → New Webhook → Copy URL).

## 2. Per-node connectivity check (do this FIRST — open item from the spec)
From EACH node (vm-101, vm103, gateway-pi, failover-pi), confirm it can reach JagHelm and the
secret works. Replace HOST/SECRET:
```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  http://HOST:PORT/api/watchtower/event \
  -H 'content-type: application/json' \
  -d '{"secret":"SECRET","node":"connectivity-check","message":"scanned|0"}'
```
Expect `200` (body `{"ok":true,"skipped":"empty"}` — the check sends no updates, so nothing is
notified). `401` = wrong/missing secret; connection refused/timeout = node can't reach vm103
(flag it — may need a relay or tailnet address).

## 3. Watchtower config per node
Add to each node's Watchtower (compose env or `docker run -e`). The template renders the exact
pipe-delimited grammar the JagHelm parser expects. The shoutrrr generic URL injects `node` and
`secret` into the JSON body via `$`-prefixed params.

```yaml
environment:
  WATCHTOWER_NOTIFICATIONS: "shoutrrr"
  WATCHTOWER_NOTIFICATION_REPORT: "true"
  WATCHTOWER_NOTIFICATION_URL: "generic://HOST:PORT/api/watchtower/event?$node=vm-101&$secret=SECRET&disabletls=yes"
  WATCHTOWER_NOTIFICATION_TEMPLATE: |
    {{- if .Report -}}
    {{- range .Report.Updated }}updated|{{ .Name }}|{{ .CurrentImageID.ShortID }}|{{ .LatestImageID.ShortID }}
    {{ end -}}
    {{- range .Report.Failed }}failed|{{ .Name }}|{{ .Error }}
    {{ end -}}
    {{- end -}}
```
Notes:
- Set `$node` to that node's name (`vm-101`, `vm103`, `gateway-pi`, `failover-pi`).
- Use `disabletls=yes` only for plain-HTTP intra-LAN; drop it if JagHelm is HTTPS.
- **Validate the template field names against your Watchtower version** before relying on it —
  field paths (`.Report.Updated`, `.CurrentImageID.ShortID`, `.Error`) are from the containrrr
  notification template API and can differ across versions. Run a manual Watchtower cycle and
  confirm a clean line appears (see step 4).

## 4. End-to-end verification
Trigger a Watchtower run (`docker exec <watchtower> /watchtower --run-once` on a node with a
floating-tag container, or wait for a real update). Confirm:
- one push on the phone (`Watchtower · <node>`), and
- one line in the daily-health Discord channel,
per run. If several containers update in one run, they appear in a single digest.

## Notes / limits
- Pinned-by-version-tag containers never trigger (Watchtower can't see "a newer version exists"
  for a fixed tag). That's expected and out of scope.
- Duplicate suppression: identical reports within ~5 min are de-duped server-side.
