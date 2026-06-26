# Down-Service Visibility — Design Spec

- **Date:** 2026-06-26
- **Status:** Approved (design) — pending spec review
- **Branch:** `feat/down-service-visibility`
- **Author:** Tej (with Jag)

## 1. Problem

JagHelm's dashboard (web + mobile) silently **hides services that are down**. When a
container stops, its service card disappears from the node panel entirely, so the board
only ever shows services that are *up* — every visible card is green. A monitoring
dashboard that can't show an outage is misleading: Jag took Grafana down, Uptime Kuma
detected it and fired Discord alerts, but JagHelm kept showing it as present/green (or
dropped it). The metrics (CPU/mem/net) refresh fine every 30s; **only the service
up/down status is wrong** — specifically, *down* is unrepresentable.

### Root cause (confirmed by code + live evidence)

- `server/discovery.js:96` builds the container list from cAdvisor's Prometheus series
  (`container_last_seen{name!=""}`, plus cpu/mem/net). cAdvisor only exports metrics for
  **running** containers; once a container stops, its series goes stale and the instant
  query returns nothing for it.
- `server/discovery.js:186` then hardcodes `status: 'running'` on every discovered
  container. The discovery path produces **no "down" status at all**.
- `server/refresh.js:166` builds service cards **only** by mapping over that container
  list. The Kuma monitor (`server/refresh.js:170-171`,
  `status = monitor?.status || c.status || 'unknown'`) is layered on *afterward* as an
  overlay — it can flip an existing card to `down`, but it can never *create* a card.
- Therefore a fully-stopped container → absent from cAdvisor → absent from the list →
  **no card**. The one component that knows the service is down (Kuma) is never used as a
  *source* of cards.

Live evidence (prod `192.168.68.11:3099`, reachable over LAN from the dev box):
`/api/health` → `{"status":"ok","refresh":"ok","refreshAgeMs":7576,...}`. The background
refresh loop is healthy and recent — this is **not** a wedged-loop/stale-data bug. It is
a structural gap in how the service inventory is sourced.

### Why the earlier hypotheses are out

- **FCM-wedged loop (memory hypothesis #1):** refuted. Push is disabled in prod, so
  `dispatch.js:102` (`if (!fcm.isPushEnabled()) return;`) early-returns before the
  unbounded `messaging.send` at `push/fcm.js:174` is ever reached; and `/api/health`
  shows the loop ticking. (The unbounded send is a real *latent* bug — see §10 — but it
  is not this freeze.)
- **Kuma stale-serving / wrong-match (#2/#3):** these can make a *still-running*
  container show the wrong colour, but the dominant, reported symptom is **container
  gone → card vanishes**, which is the inventory-source gap above.

## 2. Goals / Non-goals

**Goals**
1. A service that is **down** (outage) is **visible** on web and mobile as a red card,
   even when its container has stopped and disappeared from cAdvisor.
2. A service that is **deliberately retired** (decommissioned) is **hidden** — no card.
3. Status indicators reflect reality: per-card status dot + left border go red on down;
   down services sort to the top of their panel; a global header dot goes red if
   anything is down. Mobile mirrors web.

**Non-goals**
- No change to the metrics pipeline (Prometheus/node/container stats) — it works.
- No new alerting/notification behaviour (push is a separate track).
- No general dashboard redesign; we reuse existing components and colour tokens.

## 3. Source of truth (decided)

**Uptime Kuma is the source of truth for "what services should be up."** Kuma already
holds a monitor per service, already knows up/down, already alerts, and Jag already
maintains it. Decommissioning a service = **pause or delete its Kuma monitor**.

Consequence (accepted): for a service to be shown as *down*, it must have a Kuma monitor.
A container-only service with no monitor keeps today's behaviour (shown green while
running, gone when stopped) — that's the residual gap, and it's acceptable because the
fix is "add a Kuma monitor," which is the system Jag already runs.

## 4. Design

### 4.1 Service inventory = union of containers and active monitors

`_refreshServices` (`server/refresh.js`) changes from "map over discovered containers" to
"reconcile discovered containers with active Kuma monitors." For each node we produce
cards from the **union**:

| Case | Container (cAdvisor) | Kuma monitor | Result |
|------|----------------------|--------------|--------|
| Normal up | running | matched, up | green card, metrics, status `up` (today) |
| HTTP/app outage | running | matched, **down** | **red** card, metrics, status `down` (works today *if* matched — see §4.4) |
| **Container gone** | absent | active, **down**, unmatched to any running container | **NEW: red `down` card** under last-seen node, no container metrics |
| Running, no monitor | running | none | green card (today's behaviour) |
| Retired | absent | **paused/deleted** | **no card** (hidden) |
| Pending/unknown monitor | absent | active, status `unknown`/`pending` | no card (we only synthesise cards for confirmed `down`; avoids phantom outages) |

**Dedup rule:** track which monitor ids are *consumed* by a matched running container
during the existing container loop. Only **unconsumed, active, `down`** monitors become
synthesised cards. A monitor matched to a running container never also produces a phantom
card.

### 4.2 Decommission semantics (paused vs deleted)

- **Deleted** monitor → absent from Kuma's status-page API → never emitted. Clean.
- **Paused** monitor → must be treated as retired (hidden), NOT as an outage.

  **Open item (verify against live Kuma — §10):** confirm exactly how a paused monitor
  appears on `/api/status-page/default` (does it still appear; what heartbeat status).
  If the public status-page payload does not expose an `active`/paused flag, read it from
  Kuma's authenticated monitor API instead. **Fail-safe default: if we cannot positively
  confirm a monitor is active, we do NOT synthesise a down card for it** (prefer a missed
  red card over a phantom outage on a service Jag retired). A *matched, running* container
  is unaffected by this — it always renders.

### 4.3 Node attribution via persisted last-seen registry

A gone container has no live node, but the UX model is "red card at the top of *its*
panel." So JagHelm maintains a small **service registry** keyed by service identity
(container/monitor name), recording `{ lastSeenNode, lastSeenAt }`, **persisted to the
existing writable `data/` mount** (survives JagHelm restarts).

- On every refresh, for each discovered running container, upsert
  `registry[name] = { lastSeenNode: nodeKey, lastSeenAt: now }`.
- When synthesising a down card for an unmatched down monitor, look up its last-seen node
  (by monitor name → registry, using the same normalisation `matchMonitor` uses) and
  place the card under that node, sorted to top.
- **Fallback** when there is no last-seen record (e.g. JagHelm restarted while the service
  was already down, and it has never been seen running since): place the card under a
  deterministic fallback so it is never silently dropped. Proposed fallback: the node the
  monitor is mapped to in `services.yaml` if present; else the first/primary node; the
  card still renders red and surfaces in the global header dot regardless of node.

Registry hygiene: entries are retained across restarts; an entry is only meaningful while
a matching active monitor exists. Stale entries (no monitor, not seen for a long window)
may be pruned, but pruning is best-effort and not required for correctness.

### 4.4 Tighten the matcher (prevent down→up mis-paint)

`matchMonitor` (`server/monitors.js:130`) uses loose fuzzy strategies (containment, word
overlap). A risk: a *down* service's container gets mis-matched to a *different, up*
monitor, painting it green. This is secondary to the main fix but in-scope because it is
the same "down is hidden" failure. Minimal change: when the explicit mapping
(`services.yaml` `monitor:`) is present but not found, do **not** fall through to fuzzy
matching for status colour (the explicit miss already warns). Keep fuzzy matching only
for services with no explicit mapping. (Detailed rule finalised in the plan; this is a
guard, not a rewrite of the 5-strategy matcher.)

### 4.5 Status values

No new status string is required: the synthesised card uses the existing `status: 'down'`,
which both frontends already render red (`ServiceCard.jsx:24-27`, mobile
`StatusDot.jsx:8-10`). The synthesised card carries `monitored: true`, `ping`/`uptime24`
from Kuma when available, and `docker: null`/no container stats (it has none). Frontends
already treat `docker` as optional.

## 5. Backend changes

- `server/refresh.js` — `_refreshServices`: implement the union/reconcile + dedup; emit
  synthesised down cards; upsert the last-seen registry; attribute synthesised cards to a
  node. Keep `Promise.all`/`allSettled` resilience intact.
- `server/monitors.js` — expose enough monitor detail to know `active`/paused (per §4.2),
  and a helper to list "active down monitors." Tighten explicit-mapping fall-through
  (§4.4).
- New small module `server/serviceRegistry.js` (name TBD in plan) — load/save the
  last-seen registry to `data/`, with atomic write and corruption-safe load (empty on
  parse failure). Mirrors existing `data/`-persistence patterns (see `cache.js`/config
  store).
- `server/routes/services.js` — no shape change required beyond what `_refreshServices`
  already emits; synthesised cards flow through the same cache + route.

## 6. Web frontend changes

- `src/views/DashboardView/NodePanel.jsx:139-141` — add **down-first sort** before
  `.map(toServiceCard...)` (stable: down first, otherwise preserve API order).
- `src/components/ServiceCard.jsx` — **no change** for the down state itself (already red
  dot + red border for `status === 'down'`). Verify a card with `docker: null` renders
  cleanly (no metrics row / graceful empty).
- Header dot (`src/components/NavBar.jsx`, fed by `App.jsx` health from `getMonitors()`)
  — verify it goes red when a service is down. Since both the dot and the down-cards
  derive from Kuma monitors, it should already flip; if `getMonitors()` health does not
  account for down monitors, extend that calculation minimally. No new component.

## 7. Mobile frontend changes

- Down→red and down-first sort already work (`mobile/src/data/derive.js`
  `sortProblemsFirst`/`serviceIsProblem`, `mobile/src/components/StatusDot.jsx`). Verify
  synthesised cards (with `docker: null`) render in `ServiceRow.jsx`.
- **New:** add the **global status dot** to the top of the Overview screen
  (`mobile/src/views/Overview.jsx`), mirroring web semantics (green = all up, red = any
  down, amber = degraded/unknown). Reuse the same health derivation source as web for
  consistency.

## 8. Data shape

The per-service object (`serviceCard.js:11-24`) gains nothing required; synthesised cards
reuse existing fields (`status`, `display_name`, `container`, `monitored`, `ping`,
`uptime24`, `icon`, `docker:null`). If useful for UI affordances we MAY add an optional
`source: 'container' | 'monitor'` flag (purely additive, ignored by old clients) — decide
in the plan; not required for the core behaviour.

## 9. Edge cases & failure modes

- **Flapping** (container restarting): card may briefly appear/disappear; the registry
  smooths node attribution. Acceptable.
- **Kuma unreachable:** `fetchMonitors` returns `staleOrEmpty()` (≤5min last map, then
  empty). With no monitors we cannot synthesise down cards — board degrades to today's
  behaviour (running containers only). The global dot reflects monitor health as today.
  We must NOT crash or wedge the loop; synthesis is best-effort inside existing try/catch.
- **Service with neither container nor monitor:** invisible by definition — out of scope
  (add a monitor).
- **Double-counting:** prevented by the consumed-monitor dedup (§4.1).
- **Phantom outage on a retired service:** prevented by §4.2 fail-safe (only confirmed
  active+down monitors synthesise).

## 10. Open item to verify during implementation

Confirm Kuma's paused-monitor representation on the live instance (need `KUMA_URL` /
access — it lives in prod's compose `.env`, not the repo). Determine whether
`/api/status-page/default` exposes active/paused, or whether we read the authenticated
monitor API. Encode the §4.2 fail-safe regardless. (Unrelated latent bug noted for a
separate change: bound `messaging.send` at `push/fcm.js:174` with a timeout so a hung FCM
call can never wedge the refresh loop once push is enabled.)

## 11. Testing

- **Backend unit tests** (node:test, alongside existing `server/**/*.test.js`):
  - `_refreshServices` reconcile: running+up, running+down(matched), **gone+active+down →
    synthesised card**, running+no-monitor, **paused → no card**, pending/unknown → no
    card, dedup (matched monitor not double-emitted).
  - Registry: upsert on seen, lookup for synthesised card, persistence round-trip,
    corruption-safe load, fallback when no record.
  - Matcher guard (§4.4): explicit-miss does not fuzzy-mis-paint.
- **Frontend tests:** web NodePanel down-first sort; ServiceCard with `docker:null`;
  mobile already has `derive` tests — extend for synthesised shape; mobile Overview global
  dot.
- **Manual/live verification:** against prod or staging — stop a monitored container,
  confirm a red card appears at the top of its panel and the header dot goes red; pause
  its monitor, confirm the card disappears.

## 12. Rollout & safety

- Pure additive behaviour; if monitors are unavailable the board falls back to today's
  output (no regression).
- Ship via branch → PR → Jag reviews & merges → CI builds image → event-driven deploy
  (existing pipeline, `compose.yaml` + `.gitea/workflows/deploy.yml`). Health gate
  (`/api/health` status:ok + Docker healthcheck) backstops the deploy.
- Post-implementation: `/simplify` then `/security-review` before calling it done.
