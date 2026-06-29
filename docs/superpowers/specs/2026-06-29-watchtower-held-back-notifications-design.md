# Watchtower held-back (monitor-only) notifications

**Date:** 2026-06-29
**Status:** Approved, ready to implement
**Branch:** `feat/watchtower-held-back-notifications`

## Problem

Containers labelled monitor-only (`com.centurylinklabs.watchtower.monitor-only=true`,
the CRITICAL/pinned ones) are protected from auto-update but **silent**: Watchtower
scans them, sees a newer image is available, and does *not* apply it — so the container
lands in `.Report.Stale`, never `.Report.Updated`. JagHelm's current notification
template only emits `updated|...` and `failed|...` lines, so stale containers are dropped
on the floor. You're protected but never told an update is waiting.

## Goal

Notify when a monitor-only container has an update **held back**, and confirm when one
is later **caught up** — without spamming, since a held-back container stays stale on
*every* poll cycle until manually pulled (the known Watchtower footgun, issue #1962).

## Key insight: held-back is STATE, not an EVENT

`updated`/`failed` are events — notify each occurrence (5-min content dedup covers
shoutrrr retries). "Held back" is a standing state that recurs every run. So it needs
**notify-on-change**, gated by a diff against persisted per-node state — not the
time-window dedup.

## Surfaces (delivers "on-change ping + standing digest" with NO new timer)

There is no scheduled daily-digest job in JagHelm; Watchtower posts on its own cadence
(the nodes run at 6am). We split the two surfaces:

- **Discord = the standing digest.** Every notification's Discord message carries a
  `⏸️ Held back (N): ...` section listing the **full current standing set** for that node.
  One message per Watchtower run → a daily view of the live backlog.
- **Mobile push (FCM) = on-change only.** A push fires only when the held-back set
  *changes*: `⏸️` for newly held-back, `✅` for cleared. No repeat-buzz for a static
  backlog. Cleared pings reuse the existing `notifyRecoveries` pref.
- **Hard skip rule.** If a run has no `updated`, no `failed` (or it's deduped), **and**
  no change to the held-back set → skip the entire fan-out (no Discord, no push). This
  is what prevents spam even under hourly polling.

## Components

All follow existing patterns in `server/watchtower/` and `server/push/`.

### 1. `server/watchtower/parse.js`
Add a third record grammar: `stale|<name>|<current>|<latest>` → `stale: [{ name, current, latest }]`.
- 4-part minimum, same shape as `updated`.
- Same proto-pollution guard (`__proto__`/`constructor`/`prototype` names rejected) and
  the shared `MAX_RECORDS` cap apply across all three lists.
- Return shape becomes `{ updated, failed, stale }`.

### 2. `server/watchtower/heldBackStore.js` (new)
JSON store at `data/held-back.json`, built on the `tokenStore` pattern:
null-prototype object, tolerant load, `atomicWriteFileSync` on every mutation.
- Shape: `{ [node]: Array<{ name, current, latest }> }`
- `diffAndSet(node, staleList)` → `{ newlyHeldBack, cleared, current }` and persists
  `current` as the node's new set.
  - `newlyHeldBack` = entries in `staleList` whose `name` was not previously held back,
    **or** whose `latest` changed (a newer image dropped on an already-stale container).
  - `cleared` = previously-held-back entries whose `name` is absent from `staleList`.
  - `current` = the new full set (`staleList`), used for the Discord standing section.
- Node names and container names are object keys → null-proto guard against pollution.
- **Persisted, not in-memory:** a JagHelm restart must not re-ping the standing backlog.

### 3. `server/watchtower/format.js`
- Extend `buildDiscordContent({ node, updated, failed, heldBack, cleared })`:
  - `⏸️ **Held back (N)**: name (current→latest), ...` (the full standing set)
  - `✅ Caught up: name, ...`
- `buildHeldBackPushEvent(node, newlyHeldBack)` → `type` mapped to the `watchtower`
  category, `severity: 'info'`, body `"N update(s) held back: <names>"`.
- `buildClearedPushEvent(node, cleared)` → recovery event (subject to `notifyRecoveries`),
  body `"N caught up: <names>"`.
- `buildPushEvent` (updated/failed) is unchanged.

### 4. `server/routes/watchtower.js`
- Parse `{ updated, failed, stale }`.
- Event leg: existing `dedup.isDuplicate({ node, updated, failed })` gates the
  updated/failed notification (unchanged semantics).
- State leg: `const { newlyHeldBack, cleared, current } = heldBackStore.diffAndSet(node, stale)`.
- **Skip rule:** if the event leg produced nothing new **and** `newlyHeldBack` and
  `cleared` are both empty → `return { ok: true, skipped: 'no-change' }`.
  (`diffAndSet` still runs first so persisted state stays current.)
- Push fan-out: array of `[updated/failed event?, held-back event?, cleared event?]`,
  only the non-empty ones.
- Discord fan-out: one message via `buildDiscordContent` with `heldBack: current` and
  `cleared`.
- Both legs stay independently isolated in `Promise.allSettled` as today.

### 5. `server/index.js`
Construct a `heldBackStore` singleton (mirror `getPushStore()`), inject into
`createWatchtowerRoutes`.

### 6. Docs — node-side template (the half you paste on the boxes)
Update the Watchtower notification-template runbook to emit `stale|...` lines:
```
{{range .Report.Stale}}stale|{{.Name}}|{{.CurrentImageID.ShortID}}|{{.LatestImageID.ShortID}}\n{{end}}
```
Provided in the single-line, single-quoted `printf`-`\n`, double-`$$` form the nickfedor
fork + Dockge require (per the documented shoutrrr gotchas), alongside the existing
`updated`/`failed` ranges. Requires `WATCHTOWER_NOTIFICATION_REPORT=true`.

## Edge cases (accepted, documented)

- **Deleted (not updated) held-back container** drops off the stale list → fires a
  spurious `✅ caught up`. Rare, harmless.
- Assumes each Watchtower run reports its **complete** stale set (Watchtower default;
  label filters keep the watched set stable). A partial scan could mis-fire `cleared`.

## Testing

- `parse.test.js` — `stale` grammar, mixed updated+failed+stale, proto guard, cap.
- `heldBackStore.test.js` — new/cleared/changed-latest diffs, persistence across
  reload, no-op on unchanged set, proto guard, multi-node isolation.
- `format.test.js` — held-back + cleared Discord sections, push event category/severity,
  cleared = recovery event.
- `routes/watchtower.test.js` — stale-only report notifies; no-change run skips;
  recovery ping on clear; mixed updated+stale fans both; auth + isolation unchanged.

## Non-goals

- No new scheduled/cron digest job (Discord-per-run is the digest surface).
- No change to the auto-update behaviour itself — purely notification.
