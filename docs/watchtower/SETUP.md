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
`secret` into the JSON body via `$`-prefixed params — these are ONLY added to the body when
`template=json` is also present in the URL (without it shoutrrr silently drops them and the
server gets no secret → 401). `WATCHTOWER_NOTIFICATION_URL` is standalone; do NOT set
`WATCHTOWER_NOTIFICATIONS` (that legacy var is for named services like slack/email and has no
`shoutrrr` value).

```yaml
environment:
  WATCHTOWER_NOTIFICATION_REPORT: "true"
  WATCHTOWER_NOTIFICATION_URL: "generic://HOST:PORT/api/watchtower/event?template=json&$node=vm-101&$secret=SECRET&disabletls=yes"
  WATCHTOWER_NOTIFICATION_TEMPLATE: |
    {{- if .Report -}}
    {{- range .Report.Updated }}updated|{{ .Name }}|{{ .CurrentImageID.ShortID }}|{{ .LatestImageID.ShortID }}
    {{ end -}}
    {{- range .Report.Failed }}failed|{{ .Name }}|{{ .Error }}
    {{ end -}}
    {{- range .Report.Stale }}stale|{{ .Name }}|{{ .CurrentImageID.ShortID }}|{{ .LatestImageID.ShortID }}
    {{ end -}}
    {{- end -}}
```
Notes:
- The `.Report.Stale` range is what surfaces **held-back** containers — a monitor-only
  container with a newer image available that Watchtower deliberately did NOT update. Without
  this range, those containers are protected but silent. It is required for the held-back pings
  to work; the `updated`/`failed` ranges alone never see them.
- Set `$node` to that node's name (`vm-101`, `vm103`, `gateway-pi`, `failover-pi`).
- Use `disabletls=yes` only for plain-HTTP intra-LAN; drop it if JagHelm is HTTPS.
- **Validate the template field names against your Watchtower version** before relying on it —
  field paths (`.Report.Updated`, `.CurrentImageID.ShortID`, `.Error`) are from the containrrr
  notification template API and can differ across versions. Run a manual Watchtower cycle and
  confirm a clean line appears (see step 4).

## 4. Held-back (monitor-only) notifications
A container that Watchtower is set to **monitor only** — either the whole instance
(`WATCHTOWER_MONITOR_ONLY: "true"`) or per-container
(`com.centurylinklabs.watchtower.monitor-only=true`) — is protected from auto-update. When a
newer image appears for one, Watchtower reports it under `.Report.Stale` (NOT `.Updated`), and
JagHelm turns that into:
- `⏸️ Held back` — a mobile push **only when a container becomes newly held back** (or a newer
  image lands on one already held back). No repeat ping each poll cycle for a static backlog.
- A standing `⏸️ Held back (N): …` section in the Discord message, listing the full current
  backlog every time JagHelm posts — so it never falls off your radar.
- `✅ Caught up` — a recovery push (honors the per-device *recovery notifications* toggle) when a
  held-back container drops off the stale list, e.g. after you pull it manually.

A run with no updates, no failures, and no change to the held-back set is skipped entirely — no
push, no Discord — so monitor-only nodes stay quiet until something actually changes.

## 5. End-to-end verification
Trigger a Watchtower run (`docker exec <watchtower> /watchtower --run-once` on a node with a
floating-tag container, or wait for a real update). Confirm:
- one push on the phone (`Watchtower · <node>`), and
- one line in the daily-health Discord channel,
per run. If several containers update in one run, they appear in a single digest. For held-back
verification, label a floating-tag container `monitor-only=true`, run once, and confirm a
`⏸️ Held back` push + Discord line; run again unchanged and confirm **silence**.

## Notes / limits
- Pinned-by-version-tag containers never trigger (Watchtower can't see "a newer version exists"
  for a fixed tag). That's expected and out of scope — held-back only covers floating-tag
  monitor-only containers, where a newer image genuinely exists.
- Deleting (rather than updating) a held-back container makes it drop off the stale list and
  fires a one-off `✅ Caught up`. Harmless, and rare.
- Duplicate suppression: identical update/failure reports within ~5 min are de-duped
  server-side; held-back/caught-up are gated by state-change instead of the time window.
