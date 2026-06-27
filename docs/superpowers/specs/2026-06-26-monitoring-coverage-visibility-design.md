# Monitoring-Coverage Visibility & Vanished-Container Breadcrumb — Design

**Date:** 2026-06-26
**Branch:** `feat/down-service-visibility`
**Builds on:** [`2026-06-26-down-service-visibility-design.md`](./2026-06-26-down-service-visibility-design.md) — the Kuma down-card synthesis. Read that first; this design *extends* it within the same branch/PR.

## Problem

The base down-service work makes Kuma-**monitored** services visible as a red card when they go down, even after their container vanishes from cAdvisor. But many containers — postgres, redis, other backing services — have **no Kuma monitor at all**. The discovery layer is pure cAdvisor/Prometheus (`server/discovery.js`, seeded from `container_last_seen`), which is **running-only by metric semantics** and hardcodes `status: 'running'`. So an untracked container is a blind spot in *both* directions:

1. **While running** it renders as a plain green card — implying "verified healthy" when nothing actually checked the service inside the container (the process can be up while the service is broken).
2. **When it stops** it disappears from cAdvisor and, having no monitor to synthesise from, **vanishes silently** — the original bug, un-fixed for this subset.

## Goal

**Coverage honesty + a nudge.** Make a service's *tracking state* visible so the operator can choose to add a Kuma monitor for true health. We never fake a health signal we don't have, and we never claim an untracked thing is "broken." The monitor is the source of truth for health; our job is to surface the *gap* and nudge it closed — not to infer health from container presence.

## Behavior Model

Every service card resolves to exactly one state:

| Situation | Card | Drives global health |
|---|---|---|
| Tracked (Kuma), up | green | no |
| Tracked, **down** (active monitor reports down) | **red** "down" | red |
| Tracked, monitor paused/deleted | hidden | — |
| **Untracked, running** | **green + "unmonitored" tag** + nudge tooltip | no |
| **Untracked, vanished** (was *established*) | **grey "Unknown — last seen {age}"** | amber/degraded |

> **Global health is computed SERVER-SIDE** (user-approved refinement, 2026-06-27). `assembleServices` derives one `overallHealth` value from the whole assembled board and returns it in the `/api/services` payload; **both** frontends read that single field for their global dot (web NavBar, mobile Overview) instead of each re-deriving it. The "Drives global health" column above is therefore symmetric across web + mobile and deterministic: `down` if any card is down; else `degraded` if any card is `unknown` (this **includes** presence breadcrumbs, which are `status:'unknown'`); else `up` if there are any cards; else `unknown`.

### Invariants

- **DOWN (red)** iff an **active Kuma monitor reports `down`**. (base spec — unchanged)
- **UNMONITORED tag** iff the card matched no monitor (`monitored === false`). Orthogonal to status: a running untracked card stays **green** (it *is* running per cAdvisor) but wears the tag so green never masquerades as "verified."
- **UNKNOWN / breadcrumb (grey)** iff an **established, unmatched** container has been **absent ≥ grace and ≤ TTL**. Never amber, never red — we are not claiming it broke.
- **Kuma owns tracked services entirely.** A container that matches *any* monitor never becomes a breadcrumb; its fate is decided by the base spec's logic (down-active → red synth, up → nothing, paused → hidden).
- **Fail-safe** carries over: prefer a *missed* breadcrumb to a *false* one (the establish-guard and grace window enforce this).
- **Global health is server-computed, not client-derived.** One `overallHealth` value is calculated in `assembleServices` from every assembled card and shipped in the `/api/services` payload; both dots consume it verbatim, so web + mobile stay symmetric and no derivation is duplicated client-side.

The grey breadcrumb **reuses the existing `'unknown'` status** that both frontends already render — no new status string. It is distinguished by `source: 'presence'` + a `lastSeenAt` timestamp.

## Components

### 1. Shared presence-store core + two registries

Task 1 already shipped `server/serviceRegistry.js` (monitor-id → last-seen node, persisted, corruption-safe, atomic-write, injectable `now`). The vanished-container breadcrumb needs the *same* persistence shape keyed by **container name**. To avoid two near-identical files we **extract the shared core** `createPresenceStore({ path, now })` (persisted `key → record` map: corruption-safe load, dirty-flag `save()` via `atomicWriteFileSync`, `snapshot()`), then build both registries on it. This refactors the already-green Task 1 file, which is the clean structural move on an unmerged branch (re-tested as part of the task).

- **`serviceRegistry`** — `monitorId → { lastSeenNode, lastSeenAt }`. Behavior unchanged; now a thin wrapper over the core. Persists to `data/service-registry.json`.
- **`containerRegistry`** (new, `server/containerRegistry.js`) — `containerName → { lastSeenNode, firstSeenAt, lastSeenAt }`. Persists to `data/container-registry.json`. Keyed by container **name globally** (so a container that legitimately moves nodes is never falsely "missing" — running *anywhere* ⇒ present). Adds:
  - `recordSeen(name, nodeKey, now)` — set `firstSeenAt` on first sight; always update `lastSeenNode`/`lastSeenAt`.
  - `getMissing({ now, graceMs, ttlMs, establishMs }) → Array<{ container, lastSeenNode, lastSeenAt, ageMs }>` — entries that are **established** (`lastSeenAt − firstSeenAt ≥ establishMs`) and **in the absent window** (`graceMs ≤ now − lastSeenAt ≤ ttlMs`).
  - `prune(ttlMs, now)` — drop entries absent longer than `ttlMs` (decommission cleanup); invoked on `save()`.

### 2. `assembleServices` — third synthesis pass

After the existing (a) container cards [Kuma overlays status] and (b) down-monitor synthesis, add (c) the breadcrumb pass:

1. Record every running container this cycle: `containerRegistry.recordSeen(name, nodeKey, now)`.
2. `const candidates = containerRegistry.getMissing({ now, graceMs, ttlMs, establishMs })`.
3. For each candidate: **skip if running anywhere** this cycle (defensive — `getMissing` already excludes fresh records via grace); **skip if `matchMonitor(name, null, monitors)` is truthy** (Kuma owns it); else synthesise a grey card on `lastSeenNode` (fallback: first node).
4. Final per-node order becomes **down → unknown → up** (extend the existing comparator).
5. **Compute global health** from the fully-assembled board (after sorting): `overallHealth = 'down'` if any card is `down`; else `'degraded'` if any card is `unknown` (this includes presence breadcrumbs); else `'up'` if there are any cards; else `'unknown'`. Return it alongside the nodes — the cache payload becomes `{ nodes, overallHealth }` — so both frontends read one server truth (user-approved refinement, 2026-06-27).

Breadcrumb card shape (mirrors the existing card contract + two new fields):
```js
{
  container: name, uid: `${nodeKey}:${name}`, display_name, icon: null,
  status: 'unknown', monitored: false, source: 'presence', lastSeenAt,
  ping: null, uptime24: null, docker: null, integration: null,
}
```
`save()` both registries after recording.

### 3. Frontend (web + mobile, symmetric)

- **Unmonitored tag:** render the existing `monitored === false` flag as a subtle tag/indicator + a nudge tooltip — *"No Uptime Kuma monitor — add one to track this service's true status."* Subtle, never alarming.
- **Breadcrumb:** `source === 'presence'` → grey card with a **"last seen {age} ago"** subtitle (a small relative-time helper formats `lastSeenAt`).
- **Sort:** down → unknown → up (inherits the backend order; confirm each client renders in backend order or sorts identically).
- **Global health (server-computed, symmetric):** both dots read the single `overallHealth` field from the `/api/services` payload — the web NavBar via `getServices()` (replacing the old `getMonitors()`-derived dot) and the mobile Overview via `servicesBody.overallHealth` (replacing the client `deriveGlobalHealth`). A presence breadcrumb (status `'unknown'`) makes `overallHealth === 'degraded'`, so it shows as a heads-up (amber) on **both** dots — **not** a red alarm. No client re-derivation.

## Defaults (deterministic constants, env-overridable)

| Constant | Default | Meaning |
|---|---|---|
| `PRESENCE_GRACE_MS` | `90_000` (90s, ≈3 refreshes) | absent-for-this-long before a breadcrumb appears — kills single-scrape blips |
| `PRESENCE_TTL_MS` | `86_400_000` (24h) | decommission window — breadcrumb fades after this; card always shows its age |
| `PRESENCE_ESTABLISH_MS` | `60_000` (60s) | min run span before a container is breadcrumb-eligible — kills ephemeral/one-shot job noise |

**Clear mechanism = TTL auto-fade only** for v1. No dismiss button / API / persisted dismissals.

## Edge Cases

- **Ephemeral / one-shot containers** (cron, build): the establish-guard means a container that ran <60s and exited clean **never** becomes a breadcrumb. The existing `hide`-list still suppresses anything hidden.
- **Container migration across nodes:** keyed by name globally; present anywhere ⇒ not missing.
- **Server restart:** persisted registry → a container running before a restart that vanished during downtime surfaces as a breadcrumb (age = downtime).
- **Flapping:** the grace window absorbs transient cAdvisor scrape gaps.
- **Monitored container vanished:** owned by the Kuma path; never a breadcrumb (`matchMonitor` skip).

## Testing Strategy

- **`containerRegistry`** unit tests: record + firstSeen/lastSeen, `getMissing` window boundaries (below grace, in window, past TTL), establish-guard, `prune`, persistence round-trip, corrupt-file → empty.
- **`assembleServices`** tests: breadcrumb synthesis on last-seen node; skip-if-monitored; skip-if-running; establish-guard exclusion; down→unknown→up ordering; grey `'unknown'` + `source:'presence'` shape; **server-computed `overallHealth`** (down / unknown-breadcrumb → degraded / all-up / empty → unknown).
- **Frontend** tests: unmonitored-tag render on `monitored:false`; breadcrumb grey + "last seen" subtitle on `source:'presence'`; sort order. (Global health is no longer derived client-side, so it is covered by the backend `assembleServices` test above; both dots simply read the `overallHealth` field.)

## Out of Scope (v1)

- Dismiss / decommission action + API + persisted dismissals.
- Docker-socket crash detection (`exited`/`dead`/`unhealthy` via `?all=1` + inspect) — a separate, heavier project requiring per-node Docker API access the current architecture lacks.
- Auto-creating Kuma monitors.

## Relationship to the Base Plan

| Task | Change |
|---|---|
| Task 1 (serviceRegistry) | ✅ done; gets the shared-core refactor |
| Task 2 (Kuma `active` flag) | unchanged |
| Task 3 (assembleServices) | gains the third (breadcrumb) synthesis pass + `containerRegistry` + **server-computed `overallHealth`** in the payload |
| Task 4 (mobile dot) | **reads the server `overallHealth`** (client `deriveGlobalHealth` **dropped**) + unmonitored tag + breadcrumb + down→unknown→up sort |
| **New web-frontend task** | unmonitored tag + breadcrumb rendering + sort, **and repoints the NavBar dot to the server `overallHealth`** via `getServices()` (the old `getMonitors()`-derived dot is removed) |
