# Watchtower Update Notifications — Design

**Date:** 2026-06-28
**Status:** Approved (pending spec review)
**Author:** Tej (for Jag)

## Problem

Watchtower runs on four nodes (`vm-101`, `vm103`, `gateway-pi`, `failover-pi`) and
auto-updates non-pinned containers when a new image is published. Critical containers
are pinned to a specific version tag, so Watchtower leaves them alone. Today, when
Watchtower updates a container there is **no visibility** — Jag finds out by noticing a
container changed, or not at all.

**Ask:** whenever Watchtower updates any container, notify in (1) the `daily-health`
Discord channel and (2) as a JagHelm mobile push notification.

## Scope

**In scope**
- Notify on **successful updates** (a container was updated to a new image).
- Notify on **failed updates** (Watchtower tried and the pull/restart failed — a failed
  auto-update can leave a service down, so this is real visibility).
- **One digest per Watchtower run**: a poll that updates 3 containers on a node produces
  **one** push + **one** Discord line summarizing all 3 (plus a failures section if any).
- Mobile **toggle** for the new notification category (Notification Settings screen),
  shipped as part of this work (combined change + signed-APK release).

**Out of scope (explicitly not building — YAGNI)**
- **Pinned-update-available** ("a newer version exists for a pinned container"). Jag pins
  by **specific version tag** (e.g. `postgres:15.2`), so Watchtower only re-checks that
  exact tag's digest — it has no concept of "15.3 is available." Not recoverable without a
  separate registry-version-watcher, which is a much bigger build and a possible future
  project.
- JagHelm UI history view / dashboard card of past updates. The ask is notifications.
- Any change to Watchtower's update behavior (what it updates, schedule, pinning).

## Architecture — hub-and-spoke

```
vm-101       ┐
vm103        ├─ Watchtower (per-node)  ──POST──▶  JagHelm (vm103)   ──┬──▶ FCM push (phone)
gateway-pi   │   structured report                /api/watchtower/   └──▶ Discord webhook
failover-pi  ┘                                         event              (daily-health channel)
```

Each Watchtower is a **dumb sender**. JagHelm — which already runs the deterministic
push pipeline and is the monitoring surface — is the single hub that authenticates,
parses, dedups, and fans out. Adding a fifth node later is just the same Watchtower env
block; no hub change.

**Why JagHelm is the hub** (decided): it already owns FCM push and is the natural
monitoring surface; one new endpoint + one Discord webhook URL; Watchtower stays dumb.
Rejected alternatives: routing through the nanoclaw/Arnav host (more cross-system
coupling, two services to touch) and two independent native Watchtower notifiers
(formatting/filtering split across four nodes, hard to keep consistent).

## Component 1 — The source (per-node Watchtower config)

The key to keeping this deterministic (parse by fixed grammar, not regex on free-text
logs) is making Watchtower emit structured data. Per node:

- `WATCHTOWER_NOTIFICATION_REPORT=true` so the notification fires once per run with the
  full session report.
- A custom notification **template** (`WATCHTOWER_NOTIFICATION_TEMPLATE`) that renders a
  **compact, escaping-safe structured text body** — one line per container:
  - `updated|<name>|<fromImageShortID>|<toImageShortID>`
  - `failed|<name>|<error-with-newlines-stripped>`
- shoutrrr **generic webhook** transport wraps the rendered body as JSON
  (`{"message": "...", "node": "vm-101"}`) and POSTs to JagHelm. **Node identity** comes
  from a per-node `$node` query param on the shoutrrr URL — so the template is identical
  across nodes and only the URL differs.

**Why a text body inside shoutrrr's JSON, not hand-rolled JSON in the template:** Go
templates make JSON escaping (quotes/newlines in image names or error strings) fragile.
Letting the template emit plain structured text and letting shoutrrr do the JSON wrapping
sidesteps the escaping problem entirely. JagHelm parses the inner text by fixed grammar.

> Implementation note: the exact Watchtower report fields (`.Report.Updated`,
> `.Report.Failed`, `.Name`, `.ImageName`, `.CurrentImageID.ShortID`,
> `.LatestImageID.ShortID`, `.Error`) and the available template funcs must be validated
> against the Watchtower version in use (consult-first). The template grammar is the
> contract between Watchtower and the JagHelm parser; it is pinned in the rollout runbook.

## Component 2 — JagHelm server (vm103)

New endpoint **`POST /api/watchtower/event`**:

1. **Auth** via a shared secret `JAGHELM_WATCHTOWER_SECRET` (Bearer header), mirroring the
   existing cron-report secret pattern. Reject unauthenticated requests with 401.
2. **Parse** the structured `message` → `{ node, updated: [{name, from, to}], failed:
   [{name, error}] }`. Built defensively against a **fixed schema** with an allowlisted
   set of fields and line types; **no external string is ever used as an object key**
   (this exact pipeline previously had a prototype-pollution bug caught in security
   review — the parser must not regress it).
3. **Dedup guard**: compute a hash of `(node + sorted container set + image IDs)` and skip
   if the same digest was seen within a short window (e.g. 5 min). shoutrrr retries and
   network blips must not double-buzz the phone. Window state is in-memory (last-N), which
   is sufficient — a missed dedup across a server restart is harmless.
4. **Fan out** — one digest per run:
   - **Push**: build a single event `{ type: 'watchtower_update', node, title, body,
     severity }` and call the existing `dispatchEvents()`. A **new push category
     `watchtower`** routes it through the same per-token preference filter. Severity:
     updates = `info`, any failures present = `warning`.
   - **Discord**: POST to `JAGHELM_WATCHTOWER_DISCORD_WEBHOOK` (incoming webhook on the
     `daily-health` channel). All Watchtower-supplied strings escaped for Discord markdown.

Both fan-out legs are independent: a failure of one (e.g. Discord webhook 500) must not
prevent the other, and must be logged, not crash the request.

**Message shapes**
- **Push** — title `Watchtower · vm-101`, body `2 updated: immich-server, radarr`
  (append `· 1 failed` when failures present).
- **Discord** —
  `🔄 **Watchtower · vm-101** — Updated: immich-server (1a2b→9f8e), radarr (v5.3.6→v5.4.0)`
  and, when present, a second line `⚠️ Failed: sonarr (pull error)`.

## Component 3 — Mobile app

Add the `watchtower` category to the **Notification Settings** screen as an on/off toggle,
alongside the existing service/host/ups/cron categories. Defaults **on**. This flows
through the existing per-token prefs mechanism (`PUT /api/push/prefs`), so no new mobile
data path — just the new category in the settings model + UI row. Ships as a mobile
rebuild + signed-APK release (the existing Phase 6 pipeline).

## Data flow (end to end)

1. Watchtower poll on a node updates/handles containers → renders structured report.
2. shoutrrr generic webhook POSTs `{message, node}` to `/api/watchtower/event` with the
   shared-secret Bearer header.
3. JagHelm authenticates → parses → dedups.
4. Builds one digest event → `dispatchEvents()` (FCM, pref-filtered by category) **and**
   POSTs the formatted line to the Discord webhook.
5. Phone shows a push (if the token's `watchtower` category is enabled); the line appears
   in the `daily-health` channel under a distinct "Watchtower" webhook identity.

## Security

- Endpoint requires `JAGHELM_WATCHTOWER_SECRET`; unauthenticated → 401. Secret lives in
  prod env (vm103 `/opt/stacks/jaghelm`), never committed.
- All Watchtower-supplied strings (container names, image tags, error text) are **escaped**
  before reaching Discord or the push body.
- Fixed-schema parser, **no dynamic object keys** (prototype-pollution guard).
- Basic abuse guard: the endpoint is auth'd and does bounded work per request; malformed
  bodies are rejected, not partially processed.
- The Discord webhook URL is a secret (it grants posting to the channel) — env var, not
  committed.

## Testing

- **Parser**: well-formed report, malformed/garbage body, empty report (zero updates →
  no notification), injection-y container names (`__proto__`, markdown, quotes, newlines).
- **Dedup**: identical payload within window → single fan-out; outside window → fires again.
- **Fan-out**: push `dispatchEvents()` called exactly once per run; Discord webhook called
  exactly once; one leg failing does not block the other.
- **Auth**: missing/wrong secret → 401, no fan-out.
- **Category filter**: token with `watchtower` disabled receives no push; enabled does.
- **Mobile**: Notification Settings renders the new toggle; pref round-trips via the API.
- Post-implementation: `/simplify` then `/security-review` before done.

## Rollout (operator steps — Jag)

1. **Connectivity check (open item):** confirm each of the 4 nodes can reach JagHelm on
   vm103 over the LAN/tailnet. The rollout includes a per-node `curl` to
   `/api/watchtower/event` (with the secret) expecting a 2xx/known response before relying
   on it. If a node is isolated, flag it — may need a relay or alternate hub address.
2. Set `JAGHELM_WATCHTOWER_SECRET` and `JAGHELM_WATCHTOWER_DISCORD_WEBHOOK` in the prod
   JagHelm env (vm103); restart the service.
3. Create the incoming Discord webhook on the `daily-health` channel; put its URL in the
   env var above.
4. Add the Watchtower env block (report flag + template + shoutrrr generic URL with the
   per-node `$node` and the shared secret) to each node's Watchtower; recreate the
   container. Pin the exact template grammar from the runbook.
5. Verify end to end: trigger a Watchtower run (or wait for a real update) → confirm one
   push + one Discord line per run, correct node label.

## Open items

- **Reachability** of all 4 nodes to vm103 — to be verified during rollout (step 1).
- Exact Watchtower template field names / funcs — validated against the running Watchtower
  version during implementation.
