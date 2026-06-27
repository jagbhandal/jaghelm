# Monitoring-Coverage Visibility & Vanished-Container Breadcrumb — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the base down-service work with *coverage honesty + a nudge*. (1) A running container that matches **no** Kuma monitor renders green but wears an **"unmonitored"** tag + nudge, so green never masquerades as "verified healthy." (2) An **established, unmonitored** container that **vanishes** (stops, leaves cAdvisor) surfaces as a **grey "Unknown — last seen {age}"** breadcrumb instead of silently disappearing. We never fake a health signal we don't have, and we never claim an untracked thing is "broken." Kuma stays the sole source of truth for *health*; this surfaces the *tracking gap*.

**Architecture:** This plan builds **on top of** [`2026-06-26-down-service-visibility.md`](./2026-06-26-down-service-visibility.md) (the Kuma down-card synthesis) inside the **same branch/PR** (`feat/down-service-visibility`). Task 1 of that base plan already shipped (`server/serviceRegistry.js`, 4/4 green). Here we (a) extract a **shared presence-store core** that both the existing service registry and a new **container registry** sit on; (b) add a **container registry** that remembers `firstSeenAt`/`lastSeenAt`/`lastSeenNode` per container name, with an establish-guard + grace + TTL window; (c) reuse the base plan's Kuma `active`/`selectOutageMonitors` work verbatim; (d) grow `assembleServices` to **three** synthesis passes — running cards (Kuma overlay) → down-monitor synthesis (base) → **breadcrumb synthesis** (new) — ordered **down → unknown → up**; (e) teach both frontends to render the **unmonitored tag** and the **grey breadcrumb** with a "last seen X ago" subtitle. The breadcrumb **reuses the existing `'unknown'` status** (no new status string); it is distinguished by `source: 'presence'` + a `lastSeenAt` timestamp.

**Tech Stack:** Node ESM backend (`node:test` for server tests), React 19 + Vite web app (Vitest + @testing-library/react), Capacitor mobile app (Vitest + @testing-library/react).

---

## Global Constraints

These are **binding invariants** copied from both design specs. Every task preserves them.

- **THE BASE INVARIANT — down vs inactive (carried over, unchanged):** A service is shown **DOWN (red)** iff it has an **active Kuma monitor reporting `down`**. A service is **INACTIVE (hidden)** iff its monitor is **paused or deleted** in Kuma. The container's Docker state is NOT the differentiator — only the Kuma monitor's active/paused state disambiguates intent.
- **UNMONITORED tag** iff the card matched no monitor (`monitored === false`). Orthogonal to status: a running untracked card stays **green** (it *is* running per cAdvisor) but wears the tag so green never masquerades as "verified."
- **UNKNOWN / breadcrumb (grey)** iff an **established, unmatched** container has been **absent ≥ grace and ≤ TTL**. Never amber, never red — we are not claiming it broke. It reuses the existing `'unknown'` status, distinguished by `source: 'presence'` + `lastSeenAt`.
- **Kuma owns tracked services entirely.** A container that matches *any* monitor never becomes a breadcrumb; its fate is decided by the base spec's logic (down-active → red synth, up → nothing, paused → hidden).
- **Fail-safe (carried over):** prefer a *missed* breadcrumb/red-card to a *false* one. If we cannot positively confirm a monitor is active, do NOT synthesise a down card for it. The establish-guard + grace window enforce the breadcrumb side. A *matched, running* container always renders regardless.
- **No new status string** — reuse the existing `status: 'down'` (red) and `status: 'unknown'` (the breadcrumb). Both frontends already render both.
- **Card contract — breadcrumb card shape (MUST stay consistent backend → frontend):**
  ```js
  {
    container: name, uid: `${nodeKey}:${name}`, display_name, icon: null,
    status: 'unknown', monitored: false, source: 'presence', lastSeenAt,
    ping: null, uptime24: null, docker: null, integration: null,
  }
  ```
  A *running untracked* card already carries `monitored: false` (no backend change for the tag — the frontends render the existing flag).
- **Sort order, every node, every client:** **down → unknown → up** (backend emits this canonical order; clients render in backend order or sort identically).
- **Defaults (deterministic constants, env-overridable via `JAGHELM_*`):** `PRESENCE_GRACE_MS = 90_000` (90s, ≈3 refreshes), `PRESENCE_TTL_MS = 86_400_000` (24h), `PRESENCE_ESTABLISH_MS = 60_000` (60s). Clear mechanism = **TTL auto-fade only** for v1 (no dismiss button/API/persisted dismissals).
- **Persistence:** data dir via `server/util/dataDir.js` (`DATA_DIR`); writes via `server/util/atomicWrite.js` (`atomicWriteFileSync`); corruption-safe load returns an empty store; prototype-free maps (`Object.create(null)`, skip `__proto__`).
- **Branch:** `feat/down-service-visibility`. NEVER push to `main`; NEVER merge the PR yourself; NEVER add a `Co-Authored-By` trailer.
- **Test commands:**
  - server single file: `node --test server/<file>.test.js`; server suite: `npm test`
  - web client suite: `npm run test:client`; single: `npx vitest run src/<path>.test.jsx`
  - mobile suite: `npm run --prefix mobile test`; single: `cd mobile && npx vitest run --config vite.config.mobile.js src/<path>.test.{js,jsx}`
  - everything: `npm run test:all` (`npm test && npm run test:client && npm --prefix mobile test`)

---

### Task 1: Shared presence-store core + refactor `serviceRegistry` onto it

The already-green `server/serviceRegistry.js` is a persisted `key → record` map (corruption-safe load, dirty-flag `save()` via `atomicWriteFileSync`, injectable `path`/`now`). The breadcrumb feature needs the *same* persistence shape keyed by container name. Extract the shared **core** `createPresenceStore({ path, now, sanitize })` and make `createServiceRegistry` a thin wrapper over it. The core is generic: store shape is decided by the caller's `sanitize` hook, not baked in. **The 4 existing `serviceRegistry.test.js` tests MUST still pass unchanged.**

**Files:**
- Create: `server/presenceStore.js`
- Create: `server/presenceStore.test.js`
- Modify: `server/serviceRegistry.js` (becomes a wrapper; its public API is identical)

**Interfaces:**
- Produces: `createPresenceStore({ path, now?, sanitize? }) → { now, get(key), set(key, record), delete(key), has(key), keys(), entries(), markDirty(), isDirty(), save(), snapshot() }`. `sanitize(rawValue) → record|null` is applied per entry on load; returning `null` drops the entry.
- Re-exports (unchanged public surface): `createServiceRegistry({ path?, now? }) → { recordSeen(monitorId, nodeKey), getLastSeenNode(monitorId) → string|null, save(), snapshot() }`; default singleton `export const serviceRegistry`.

- [ ] **Step 1: Write the failing test for the core**

```javascript
// server/presenceStore.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { createPresenceStore } from './presenceStore.js';

function tmpPath(name) {
  return join(tmpdir(), `jaghelm-presence-${process.pid}-${name}.json`);
}

// sanitize that keeps only { v: number } records.
const sanitizeNum = (raw) =>
  raw && typeof raw === 'object' && typeof raw.v === 'number' ? { v: raw.v } : null;

test('presenceStore: absent file loads as an empty store', () => {
  const path = tmpPath('empty');
  try {
    const s = createPresenceStore({ path, sanitize: sanitizeNum });
    assert.deepEqual(s.snapshot(), {});
    assert.equal(s.get('x'), undefined);
  } finally { if (existsSync(path)) rmSync(path); }
});

test('presenceStore: sanitize drops malformed entries on load', () => {
  const path = tmpPath('sanitize');
  try {
    writeFileSync(path, JSON.stringify({ good: { v: 7 }, bad: { nope: 1 }, alsoBad: 5 }));
    const s = createPresenceStore({ path, sanitize: sanitizeNum });
    assert.deepEqual(s.get('good'), { v: 7 });
    assert.equal(s.has('bad'), false);
    assert.equal(s.has('alsoBad'), false);
  } finally { if (existsSync(path)) rmSync(path); }
});

test('presenceStore: save is a no-op until markDirty', () => {
  const path = tmpPath('dirty-gate');
  try {
    const s = createPresenceStore({ path, sanitize: sanitizeNum });
    s.set('a', { v: 1 });   // mutate but DO NOT markDirty
    s.save();
    assert.equal(existsSync(path), false);
    s.markDirty();
    s.save();
    assert.equal(existsSync(path), true);
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { a: { v: 1 } });
  } finally { if (existsSync(path)) rmSync(path); }
});

test('presenceStore: markDirty + save persists; a fresh instance reloads it', () => {
  const path = tmpPath('roundtrip');
  try {
    const a = createPresenceStore({ path, sanitize: sanitizeNum });
    a.set('k', { v: 42 });
    a.markDirty();
    a.save();
    const b = createPresenceStore({ path, sanitize: sanitizeNum });
    assert.deepEqual(b.get('k'), { v: 42 });
  } finally { if (existsSync(path)) rmSync(path); }
});

test('presenceStore: corrupt file loads as empty (no throw)', () => {
  const path = tmpPath('corrupt');
  try {
    writeFileSync(path, '{ not json at all');
    const s = createPresenceStore({ path, sanitize: sanitizeNum });
    assert.deepEqual(s.snapshot(), {});
  } finally { if (existsSync(path)) rmSync(path); }
});

test('presenceStore: __proto__ key is ignored on load (no prototype pollution)', () => {
  const path = tmpPath('proto');
  try {
    writeFileSync(path, '{"__proto__":{"v":1},"safe":{"v":2}}');
    const s = createPresenceStore({ path, sanitize: sanitizeNum });
    assert.deepEqual(s.get('safe'), { v: 2 });
    assert.equal(s.has('__proto__'), false);
    assert.equal(({}).v, undefined); // global proto untouched
  } finally { if (existsSync(path)) rmSync(path); }
});

test('presenceStore: injected now is exposed for wrappers', () => {
  const path = tmpPath('now');
  try {
    const s = createPresenceStore({ path, now: () => 1234, sanitize: sanitizeNum });
    assert.equal(s.now(), 1234);
  } finally { if (existsSync(path)) rmSync(path); }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/presenceStore.test.js`
Expected: FAIL — `Cannot find module './presenceStore.js'`.

- [ ] **Step 3: Write the core implementation**

```javascript
// server/presenceStore.js
/**
 * Generic persisted key→record map shared by serviceRegistry + containerRegistry.
 *
 * Both registries are "last-seen memory" stores: a prototype-free map persisted
 * to data/ as JSON, loaded corruption-safely, written atomically. The only thing
 * that differs is the record SHAPE, so the per-entry `sanitize(raw) → record|null`
 * hook is supplied by the caller (returning null drops a malformed entry).
 *
 * Conventions preserved from the original serviceRegistry.js:
 *   - Object.create(null) prototype-free map (no __proto__ collision)
 *   - explicit dirty flag — save() is a no-op unless markDirty() was called, so
 *     unchanged cycles never touch the disk
 *   - atomicWriteFileSync for crash-safety
 *   - injectable `path` + `now` for test isolation
 */
import { existsSync, readFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { atomicWriteFileSync } from './util/atomicWrite.js';
import { createLogger } from './util/logger.js';

const log = createLogger('presenceStore');

export function createPresenceStore({ path, now = Date.now, sanitize = (v) => v } = {}) {
  function load() {
    try {
      if (!existsSync(path)) return Object.create(null);
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return Object.create(null);
      const safe = Object.create(null);
      for (const k of Object.keys(parsed)) {
        if (k === '__proto__') continue;
        const rec = sanitize(parsed[k]);
        if (rec) safe[k] = rec;
      }
      return safe;
    } catch {
      return Object.create(null);
    }
  }

  let store = load();
  let dirty = false;

  return {
    now,
    get(key) { return store[String(key)]; },
    set(key, record) { store[String(key)] = record; },
    delete(key) { delete store[String(key)]; },
    has(key) { return Object.prototype.hasOwnProperty.call(store, String(key)); },
    keys() { return Object.keys(store); },
    entries() { return Object.keys(store).map((k) => [k, store[k]]); },
    markDirty() { dirty = true; },
    isDirty() { return dirty; },
    save() {
      if (!dirty) return;
      try {
        const dir = dirname(path);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        atomicWriteFileSync(path, JSON.stringify(store, null, 2));
        dirty = false;
      } catch (err) {
        log.error({ err }, 'Failed to save presence store');
      }
    },
    snapshot() { return { ...store }; },
  };
}
```

- [ ] **Step 4: Run the core test to verify it passes**

Run: `node --test server/presenceStore.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Refactor `serviceRegistry.js` onto the core (public API unchanged)**

Replace the entire body of `server/serviceRegistry.js` with:

```javascript
// server/serviceRegistry.js
/**
 * Last-seen-node memory for the dashboard, keyed by Kuma monitor id.
 *
 * When a service's container is running we record which node it was on. When
 * that container later disappears but its Uptime Kuma monitor reports DOWN, the
 * board synthesises a red "down" card and places it under this remembered node
 * (its panel), so an outage shows where the service normally lives. Source of
 * truth for up/down stays Kuma; this only answers "which panel".
 *
 * Now a thin wrapper over the shared createPresenceStore core (persistence +
 * corruption-safe load + dirty-flag save), with a monitor-id record shape.
 */
import { join } from 'path';
import { createPresenceStore } from './presenceStore.js';
import { DATA_DIR } from './util/dataDir.js';

const DEFAULT_PATH = join(DATA_DIR, 'service-registry.json');

function sanitizeServiceEntry(v) {
  if (v && typeof v === 'object' && typeof v.lastSeenNode === 'string') {
    return { lastSeenNode: v.lastSeenNode, lastSeenAt: Number(v.lastSeenAt) || 0 };
  }
  return null;
}

export function createServiceRegistry({ path = DEFAULT_PATH, now = Date.now } = {}) {
  const core = createPresenceStore({ path, now, sanitize: sanitizeServiceEntry });

  function recordSeen(monitorId, nodeKey) {
    if (monitorId == null || !nodeKey) return;
    const key = String(monitorId);
    const prev = core.get(key);
    // Only the NODE changing is a meaningful write — a refreshed lastSeenAt for
    // the same node never dirties the store (keeps disk churn off the hot loop).
    if (!prev || prev.lastSeenNode !== nodeKey) core.markDirty();
    core.set(key, { lastSeenNode: nodeKey, lastSeenAt: core.now() });
  }

  function getLastSeenNode(monitorId) {
    const e = core.get(monitorId);
    return e ? e.lastSeenNode : null;
  }

  return { recordSeen, getLastSeenNode, save: core.save, snapshot: core.snapshot };
}

export const serviceRegistry = createServiceRegistry();
```

- [ ] **Step 6: Run the EXISTING serviceRegistry test to confirm zero behavior change**

Run: `node --test server/serviceRegistry.test.js`
Expected: PASS (the original 4 tests — record/lookup, persist-across-instances, corrupt→empty, re-record-same-node-no-write — all still green).

- [ ] **Step 7: Commit**

```bash
git add server/presenceStore.js server/presenceStore.test.js server/serviceRegistry.js
git commit -m "refactor(registry): extract shared presence-store core; serviceRegistry wraps it"
```

---

### Task 2: `containerRegistry` — vanished-container presence memory

A new registry on the shared core, keyed by container **name globally** (a container that legitimately moves nodes is never falsely "missing" — running *anywhere* ⇒ present). Tracks `firstSeenAt` (set once) + `lastSeenAt` + `lastSeenNode`. Surfaces only **established** (`lastSeenAt − firstSeenAt ≥ establishMs`) containers that have been **absent ≥ grace and ≤ TTL**.

**Files:**
- Create: `server/containerRegistry.js`
- Create: `server/containerRegistry.test.js`

**Interfaces:**
- Produces: `createContainerRegistry({ path?, now? }) → { recordSeen(name, nodeKey, now?), getMissing({ now?, graceMs?, ttlMs?, establishMs? }) → Array<{ container, lastSeenNode, lastSeenAt, ageMs }>, prune(ttlMs?, now?), save(), snapshot() }`; default singleton `export const containerRegistry`; exported constants `PRESENCE_GRACE_MS`, `PRESENCE_TTL_MS`, `PRESENCE_ESTABLISH_MS`.
- Consumes: `createPresenceStore` (Task 1).

- [ ] **Step 1: Write the failing test**

```javascript
// server/containerRegistry.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { createContainerRegistry } from './containerRegistry.js';

function tmpPath(name) {
  return join(tmpdir(), `jaghelm-cregistry-${process.pid}-${name}.json`);
}
const WINDOW = { graceMs: 90_000, ttlMs: 86_400_000, establishMs: 60_000 };

test('containerRegistry: recordSeen sets firstSeenAt once, updates lastSeen*', () => {
  const path = tmpPath('record');
  try {
    const r = createContainerRegistry({ path });
    r.recordSeen('redis', 'vm103', 0);
    r.recordSeen('redis', 'pi1', 60_000);
    const snap = r.snapshot();
    assert.equal(snap.redis.firstSeenAt, 0);
    assert.equal(snap.redis.lastSeenAt, 60_000);
    assert.equal(snap.redis.lastSeenNode, 'pi1');
  } finally { if (existsSync(path)) rmSync(path); }
});

test('containerRegistry: a container still within the grace window is NOT missing', () => {
  const path = tmpPath('grace');
  try {
    const r = createContainerRegistry({ path });
    r.recordSeen('redis', 'vm103', 0);
    r.recordSeen('redis', 'vm103', 60_000);          // established (span 60s)
    const missing = r.getMissing({ now: 60_000 + 30_000, ...WINDOW }); // absent 30s < grace
    assert.deepEqual(missing, []);
  } finally { if (existsSync(path)) rmSync(path); }
});

test('containerRegistry: an established container absent past grace and within TTL is missing', () => {
  const path = tmpPath('window');
  try {
    const r = createContainerRegistry({ path });
    r.recordSeen('redis', 'vm103', 0);
    r.recordSeen('redis', 'vm103', 60_000);
    const missing = r.getMissing({ now: 60_000 + 120_000, ...WINDOW }); // absent 120s
    assert.equal(missing.length, 1);
    assert.deepEqual(missing[0], { container: 'redis', lastSeenNode: 'vm103', lastSeenAt: 60_000, ageMs: 120_000 });
  } finally { if (existsSync(path)) rmSync(path); }
});

test('containerRegistry: past TTL it fades (not missing)', () => {
  const path = tmpPath('ttl');
  try {
    const r = createContainerRegistry({ path });
    r.recordSeen('redis', 'vm103', 0);
    r.recordSeen('redis', 'vm103', 60_000);
    const missing = r.getMissing({ now: 60_000 + 200_000, graceMs: 90_000, ttlMs: 100_000, establishMs: 60_000 });
    assert.deepEqual(missing, []);
  } finally { if (existsSync(path)) rmSync(path); }
});

test('containerRegistry: the establish-guard excludes an ephemeral one-shot container', () => {
  const path = tmpPath('establish');
  try {
    const r = createContainerRegistry({ path });
    r.recordSeen('build-job', 'vm103', 0);            // single sight, span 0 < 60s
    const missing = r.getMissing({ now: 200_000, ...WINDOW });
    assert.deepEqual(missing, []);
  } finally { if (existsSync(path)) rmSync(path); }
});

test('containerRegistry: prune drops entries absent longer than ttl', () => {
  const path = tmpPath('prune');
  try {
    const r = createContainerRegistry({ path });
    r.recordSeen('old', 'vm103', 0);
    r.recordSeen('old', 'vm103', 60_000);
    r.prune(100_000, 60_000 + 200_000);               // age 200s > ttl 100s → dropped
    assert.equal(r.snapshot().old, undefined);
  } finally { if (existsSync(path)) rmSync(path); }
});

test('containerRegistry: persists across instances (save → reload)', () => {
  const path = tmpPath('persist');
  try {
    const a = createContainerRegistry({ path });
    a.recordSeen('pg', 'pi1', 0);
    a.recordSeen('pg', 'pi1', 60_000);
    a.save();
    const b = createContainerRegistry({ path });
    const missing = b.getMissing({ now: 60_000 + 120_000, ...WINDOW });
    assert.equal(missing.length, 1);
    assert.equal(missing[0].lastSeenNode, 'pi1');
  } finally { if (existsSync(path)) rmSync(path); }
});

test('containerRegistry: corrupt file loads as empty (no throw)', () => {
  const path = tmpPath('corrupt');
  try {
    writeFileSync(path, 'definitely not json');
    const r = createContainerRegistry({ path });
    assert.deepEqual(r.getMissing({ now: 1e9, ...WINDOW }), []);
  } finally { if (existsSync(path)) rmSync(path); }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/containerRegistry.test.js`
Expected: FAIL — `Cannot find module './containerRegistry.js'`.

- [ ] **Step 3: Write the implementation**

```javascript
// server/containerRegistry.js
/**
 * Vanished-container presence memory for the breadcrumb feature.
 *
 * Keyed by container NAME globally (so a container that legitimately moves nodes
 * is never falsely "missing" — running anywhere ⇒ present). For each name we
 * remember when it was first seen (to gate out ephemeral one-shot jobs), when it
 * was last seen, and on which node (to place the breadcrumb under its panel).
 *
 * getMissing returns the names that are ESTABLISHED (ran long enough to matter)
 * and currently in the ABSENT WINDOW (gone long enough to not be a scrape blip,
 * but not so long they're a decommission). prune() decommission-cleans past TTL.
 *
 * Thin wrapper over the shared createPresenceStore core.
 */
import { join } from 'path';
import { createPresenceStore } from './presenceStore.js';
import { DATA_DIR } from './util/dataDir.js';

const DEFAULT_PATH = join(DATA_DIR, 'container-registry.json');

// Deterministic, env-overridable (JAGHELM_* convention; Number(x) || default).
export const PRESENCE_GRACE_MS = Number(process.env.JAGHELM_PRESENCE_GRACE_MS) || 90_000;        // 90s ≈ 3 refreshes
export const PRESENCE_TTL_MS = Number(process.env.JAGHELM_PRESENCE_TTL_MS) || 86_400_000;        // 24h decommission fade
export const PRESENCE_ESTABLISH_MS = Number(process.env.JAGHELM_PRESENCE_ESTABLISH_MS) || 60_000; // 60s min run span

function sanitizeContainerEntry(v) {
  if (v && typeof v === 'object' && typeof v.lastSeenNode === 'string') {
    return {
      lastSeenNode: v.lastSeenNode,
      firstSeenAt: Number(v.firstSeenAt) || 0,
      lastSeenAt: Number(v.lastSeenAt) || 0,
    };
  }
  return null;
}

export function createContainerRegistry({ path = DEFAULT_PATH, now = Date.now } = {}) {
  const core = createPresenceStore({ path, now, sanitize: sanitizeContainerEntry });

  function recordSeen(name, nodeKey, at = core.now()) {
    if (!name || !nodeKey) return;
    const key = String(name);
    const prev = core.get(key);
    const firstSeenAt = prev ? prev.firstSeenAt : at;
    core.set(key, { lastSeenNode: nodeKey, firstSeenAt, lastSeenAt: at });
    core.markDirty();
  }

  function getMissing({
    now: nowMs = core.now(),
    graceMs = PRESENCE_GRACE_MS,
    ttlMs = PRESENCE_TTL_MS,
    establishMs = PRESENCE_ESTABLISH_MS,
  } = {}) {
    const out = [];
    for (const [name, rec] of core.entries()) {
      const established = rec.lastSeenAt - rec.firstSeenAt >= establishMs;
      const ageMs = nowMs - rec.lastSeenAt;
      if (established && ageMs >= graceMs && ageMs <= ttlMs) {
        out.push({ container: name, lastSeenNode: rec.lastSeenNode, lastSeenAt: rec.lastSeenAt, ageMs });
      }
    }
    return out;
  }

  function prune(ttlMs = PRESENCE_TTL_MS, nowMs = core.now()) {
    for (const [name, rec] of core.entries()) {
      if (nowMs - rec.lastSeenAt > ttlMs) {
        core.delete(name);
        core.markDirty();
      }
    }
  }

  function save() {
    prune();          // decommission-clean on every persist
    core.save();
  }

  return { recordSeen, getMissing, prune, save, snapshot: core.snapshot };
}

export const containerRegistry = createContainerRegistry();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/containerRegistry.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add server/containerRegistry.js server/containerRegistry.test.js
git commit -m "feat(refresh): add container presence registry (establish-guard + grace/TTL window)"
```

---

### Task 3: Monitor outage selection + `active` flag (REUSED VERBATIM from the base plan)

> This is the base plan's Task 2, unchanged and **not yet implemented**. It ships the `active` flag on parsed monitors + the `selectOutageMonitors` helper that Task 4 consumes.

**Files:**
- Modify: `server/monitors.js` (add `active` to the parsed monitor object inside `fetchMonitors`; add `selectOutageMonitors` export)
- Test: `server/monitors.outage.test.js`

**Interfaces:**
- Consumes: monitor objects from `fetchMonitors` — `{ id, name, status, ping, uptime24, active }`.
- Produces: `export function selectOutageMonitors(monitors, consumedIds) → monitor[]` — monitors with `status === 'down'`, `active !== false`, and `id` not in the `consumedIds` Set.

- [ ] **Step 1: Write the failing test**

```javascript
// server/monitors.outage.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { initMonitors, fetchMonitors, selectOutageMonitors } = await import('./monitors.js');

test('selectOutageMonitors: down + active + unconsumed only', () => {
  const monitors = {
    1: { id: 1, name: 'grafana', status: 'down', active: true },
    2: { id: 2, name: 'gitea', status: 'up', active: true },
    3: { id: 3, name: 'plex', status: 'down', active: true },   // consumed
    4: { id: 4, name: 'old', status: 'down', active: false },   // paused/retired
    5: { id: 5, name: 'pending', status: 'unknown', active: true },
  };
  const consumed = new Set([3]);
  const out = selectOutageMonitors(monitors, consumed).map((m) => m.id);
  assert.deepEqual(out, [1]);
});

test('selectOutageMonitors: tolerates the empty-array fallback from a failed fetch', () => {
  assert.deepEqual(selectOutageMonitors([], new Set()), []);
});

function mockResponse({ ok, body }) {
  return { ok, status: ok ? 200 : 503, headers: { get: () => null }, body: null, json: async () => body };
}

test('fetchMonitors: carries active flag (false when Kuma marks inactive, true by default)', async () => {
  initMonitors('http://localhost:9999');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    mockResponse({
      ok: true,
      body: {
        publicGroupList: [{ monitorList: [
          { id: 10, name: 'paused-svc', active: false },
          { id: 11, name: 'live-svc' },           // no active field → defaults true
        ] }],
        heartbeatList: { 10: [{ status: 0, ping: 0 }], 11: [{ status: 0, ping: 1 }] },
        uptimeList: {},
      },
    });
  try {
    const m = await fetchMonitors(true);
    assert.equal(m[10].active, false);
    assert.equal(m[11].active, true);
    assert.equal(m[10].status, 'down');           // heartbeat 0 → down
  } finally {
    globalThis.fetch = realFetch;
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/monitors.outage.test.js`
Expected: FAIL — `selectOutageMonitors is not a function` (and `m[10].active` undefined).

- [ ] **Step 3: Write minimal implementation**

In `server/monitors.js`, inside `fetchMonitors`, change the monitor object built in the `for (const pub of monitorList)` loop to add the `active` field:

```javascript
      monitors[id] = {
        id,
        name: pub.name,
        status: latest?.status === 1 ? 'up' : latest?.status === 0 ? 'down' : 'unknown',
        ping: latest?.ping || 0,
        uptime24: uptimeList[`${id}_24`] || 0,
        active: pub.active !== false,
      };
```

Then add this exported helper near the bottom of `server/monitors.js` (after `markMonitorLogDone`):

```javascript
/**
 * Select the monitors that represent a live OUTAGE: reporting `down`, still
 * active (not paused/retired), and NOT already claimed by a running container
 * this cycle. These become synthesised red "down" cards on the board so an
 * outage stays visible after the container disappears from cAdvisor.
 *
 * `monitors` is the id→monitor map from fetchMonitors (or the `[]` fallback a
 * failed fetch returns — Object.values handles both). `consumedIds` is a Set of
 * monitor ids already rendered as a running container's card.
 */
export function selectOutageMonitors(monitors, consumedIds) {
  return Object.values(monitors).filter(
    (m) => m && m.status === 'down' && m.active !== false && !consumedIds.has(m.id)
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/monitors.outage.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the existing monitors test to confirm no regression**

Run: `node --test server/monitors.test.js`
Expected: PASS (unchanged).

- [ ] **Step 6: Commit**

```bash
git add server/monitors.js server/monitors.outage.test.js
git commit -m "feat(monitors): expose active flag + selectOutageMonitors helper"
```

---

### Task 4: `assembleServices` — down synthesis (base) + breadcrumb synthesis (new) + wire both registries

Extend the base plan's pure `assembleServices` with a **third pass**. Pass (a) builds running-container cards (Kuma overlays status) — and now ALSO records each running container into the `containerRegistry`. Pass (b) is the base down-monitor synthesis (active+down+unmatched → red card). Pass (c) is **new**: `getMissing()` from the container registry → for each candidate, skip if running anywhere this cycle, skip if any monitor matches it (Kuma owns it), else synthesise a **grey `unknown` `source:'presence'`** breadcrumb on its last-seen node. Final per-node order: **down → unknown → up**. Finally, **compute one `overallHealth`** from the whole assembled board and return it so the cache payload is `{ nodes, overallHealth }` — **both** frontends' global dots read this single server value (user-approved refinement, 2026-06-27: server-side health, no client re-derivation).

**Files:**
- Modify: `server/refresh.js` (extend imports; replace the inline assembly with the extended pure `assembleServices`; wire both registries into `_refreshServices`)
- Test: `server/assembleServices.test.js`

**Interfaces:**
- Consumes: `selectOutageMonitors` (Task 3), `serviceRegistry` (Task 1), `containerRegistry` (Task 2), existing `matchMonitor` + `formatContainerName` (module-private in `refresh.js`).
- Produces: `export function assembleServices({ nodeResults, monitors, config, lastSeenNodeOf, containerRegistry, now? }) → { nodes, seen, outageCount, breadcrumbCount, overallHealth }` where `nodeResults` is `Array<[nodeKey, nodeCfg, nodeData]>`, `nodeData` is `{ metrics, containers }`, `lastSeenNodeOf` is `(monitorId) => string|null`, `containerRegistry` is the Task-2 registry (or `null` to skip the breadcrumb pass), `now` is a `() => epochMs` clock, `nodes` is the cache payload `{ [nodeKey]: { ..., services } }`, `seen` is `Array<{ monitorId, nodeKey }>`, and `overallHealth` is the **server-computed** global dot value `'down' | 'degraded' | 'up' | 'unknown'` consumed verbatim by BOTH frontends (Task 5 web NavBar, Task 6 mobile Overview).

- [ ] **Step 1: Write the failing test**

```javascript
// server/assembleServices.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, rmSync } from 'node:fs';
import { assembleServices } from './refresh.js';
import { createContainerRegistry } from './containerRegistry.js';

const nodeCfg = { display_name: 'Production' };
function nodeData(containers) { return { metrics: {}, containers }; }

// A fake container registry: no-op record, returns a fixed missing list.
function fakeRegistry(missing = []) {
  return { recordSeen() {}, getMissing() { return missing; } };
}

function run({ nodeResults, monitors, lastSeen = {}, containerRegistry = null, now = () => 0 }) {
  return assembleServices({
    nodeResults,
    monitors,
    config: { services: {} },
    lastSeenNodeOf: (id) => lastSeen[String(id)] ?? null,
    containerRegistry,
    now,
  });
}

// ---- base down-synthesis (Task 3 of the base plan) ----

test('assemble: a down monitor with no running container becomes a synthesised red card on its last-seen node', () => {
  const { nodes } = run({
    nodeResults: [['vm103', nodeCfg, nodeData([{ container: 'gitea', status: 'running', docker: { cpu: 1 } }])]],
    monitors: {
      1: { id: 1, name: 'gitea', status: 'up', ping: 5, uptime24: 1, active: true },
      2: { id: 2, name: 'grafana', status: 'down', ping: 0, uptime24: 0.5, active: true },
    },
    lastSeen: { 2: 'vm103' },
  });
  const svcs = nodes.vm103.services;
  const grafana = svcs.find((s) => s.container === 'grafana');
  assert.ok(grafana, 'synthesised grafana card exists');
  assert.equal(grafana.status, 'down');
  assert.equal(grafana.monitored, true);
  assert.equal(grafana.docker, null);
  assert.equal(grafana.uid, 'vm103:grafana');
  assert.equal(grafana.source, 'monitor');
  assert.equal(svcs[0].status, 'down');           // down-first ordering
});

test('assemble: a down monitor matched to a RUNNING container is NOT double-counted', () => {
  const { nodes } = run({
    nodeResults: [['vm103', nodeCfg, nodeData([{ container: 'grafana', status: 'running', docker: { cpu: 2 } }])]],
    monitors: { 1: { id: 1, name: 'grafana', status: 'down', ping: 0, uptime24: 0, active: true } },
  });
  const grafanas = nodes.vm103.services.filter((s) => s.container === 'grafana');
  assert.equal(grafanas.length, 1);
  assert.equal(grafanas[0].status, 'down');        // Kuma overlay paints it down
  assert.equal(grafanas[0].monitored, true);
  assert.deepEqual(grafanas[0].docker, { cpu: 2 }); // keeps container stats
});

test('assemble: a PAUSED (inactive) down monitor is hidden — the down-vs-inactive invariant', () => {
  const { nodes } = run({
    nodeResults: [['vm103', nodeCfg, nodeData([{ container: 'gitea', status: 'running', docker: {} }])]],
    monitors: {
      1: { id: 1, name: 'gitea', status: 'up', active: true },
      2: { id: 2, name: 'retired', status: 'down', active: false },
    },
    lastSeen: { 2: 'vm103' },
  });
  assert.equal(nodes.vm103.services.some((s) => s.container === 'retired'), false);
});

test('assemble: with no last-seen record, a down monitor falls back to the first node', () => {
  const { nodes } = run({
    nodeResults: [['vm103', nodeCfg, nodeData([{ container: 'gitea', status: 'running', docker: {} }])]],
    monitors: {
      1: { id: 1, name: 'gitea', status: 'up', active: true },
      2: { id: 2, name: 'orphan', status: 'down', active: true },
    },
    lastSeen: {},
  });
  assert.ok(nodes.vm103.services.some((s) => s.container === 'orphan' && s.status === 'down'));
});

test('assemble: seen[] reports matched (monitorId, node) pairs for the registry', () => {
  const { seen } = run({
    nodeResults: [['vm103', nodeCfg, nodeData([{ container: 'gitea', status: 'running', docker: {} }])]],
    monitors: { 1: { id: 1, name: 'gitea', status: 'up', active: true } },
  });
  assert.deepEqual(seen, [{ monitorId: 1, nodeKey: 'vm103' }]);
});

// ---- breadcrumb synthesis (this plan) ----

test('assemble: an established, unmonitored, vanished container becomes a grey presence breadcrumb', () => {
  const { nodes, breadcrumbCount } = run({
    nodeResults: [['vm103', nodeCfg, nodeData([{ container: 'gitea', status: 'running', docker: {} }])]],
    monitors: { 1: { id: 1, name: 'gitea', status: 'up', active: true } },
    containerRegistry: fakeRegistry([
      { container: 'postgres', lastSeenNode: 'vm103', lastSeenAt: 1000, ageMs: 120_000 },
    ]),
  });
  const pg = nodes.vm103.services.find((s) => s.container === 'postgres');
  assert.ok(pg, 'breadcrumb card exists');
  assert.equal(pg.status, 'unknown');
  assert.equal(pg.monitored, false);
  assert.equal(pg.source, 'presence');
  assert.equal(pg.lastSeenAt, 1000);
  assert.equal(pg.icon, null);
  assert.equal(pg.ping, null);
  assert.equal(pg.uptime24, null);
  assert.equal(pg.docker, null);
  assert.equal(pg.integration, null);
  assert.equal(pg.uid, 'vm103:postgres');
  assert.equal(breadcrumbCount, 1);
});

test('assemble: a vanished container that MATCHES a monitor is NOT a breadcrumb (Kuma owns it)', () => {
  const { nodes, breadcrumbCount } = run({
    nodeResults: [['vm103', nodeCfg, nodeData([{ container: 'gitea', status: 'running', docker: {} }])]],
    monitors: { 1: { id: 1, name: 'postgres', status: 'up', active: true } },
    containerRegistry: fakeRegistry([
      { container: 'postgres', lastSeenNode: 'vm103', lastSeenAt: 1000, ageMs: 120_000 },
    ]),
  });
  assert.equal(nodes.vm103.services.some((s) => s.container === 'postgres' && s.source === 'presence'), false);
  assert.equal(breadcrumbCount, 0);
});

test('assemble: a candidate that is actually RUNNING this cycle is NOT a breadcrumb (defensive skip)', () => {
  const { nodes, breadcrumbCount } = run({
    nodeResults: [['vm103', nodeCfg, nodeData([{ container: 'postgres', status: 'running', docker: { cpu: 3 } }])]],
    monitors: {},
    containerRegistry: fakeRegistry([
      { container: 'postgres', lastSeenNode: 'vm103', lastSeenAt: 1000, ageMs: 120_000 },
    ]),
  });
  const pgs = nodes.vm103.services.filter((s) => s.container === 'postgres');
  assert.equal(pgs.length, 1);
  assert.equal(pgs[0].source, 'container');     // the live running card, not a breadcrumb
  assert.equal(breadcrumbCount, 0);
});

test('assemble: the establish-guard is honored end-to-end through a real registry', () => {
  const path = join(tmpdir(), `jaghelm-assemble-${process.pid}-establish.json`);
  try {
    const reg = createContainerRegistry({ path });
    reg.recordSeen('build-job', 'vm103', 0);        // single sight, span 0 < establish
    const { nodes, breadcrumbCount } = assembleServices({
      nodeResults: [['vm103', nodeCfg, nodeData([{ container: 'gitea', status: 'running', docker: {} }])]],
      monitors: {},
      config: { services: {} },
      lastSeenNodeOf: () => null,
      containerRegistry: reg,
      now: () => 200_000,
    });
    assert.equal(nodes.vm103.services.some((s) => s.container === 'build-job'), false);
    assert.equal(breadcrumbCount, 0);
  } finally { if (existsSync(path)) rmSync(path); }
});

test('assemble: final order per node is down → unknown → up', () => {
  const { nodes } = run({
    nodeResults: [['vm103', nodeCfg, nodeData([
      { container: 'alpha', status: 'running', docker: {} },   // up
      { container: 'gitea', status: 'running', docker: {} },   // down via monitor
    ])]],
    monitors: { 1: { id: 1, name: 'gitea', status: 'down', active: true } },
    containerRegistry: fakeRegistry([
      { container: 'postgres', lastSeenNode: 'vm103', lastSeenAt: 1000, ageMs: 120_000 }, // unknown breadcrumb
    ]),
  });
  assert.deepEqual(
    nodes.vm103.services.map((s) => s.status),
    ['down', 'unknown', 'up']
  );
});

// ---- server-computed global health (user-approved refinement 2026-06-27) ----

test('assemble: overallHealth is "down" when any card is down', () => {
  const { overallHealth } = run({
    nodeResults: [['vm103', nodeCfg, nodeData([{ container: 'gitea', status: 'running', docker: {} }])]],
    monitors: { 1: { id: 1, name: 'gitea', status: 'down', active: true } },
  });
  assert.equal(overallHealth, 'down');
});

test('assemble: overallHealth is "degraded" when a presence breadcrumb is unknown but nothing is down', () => {
  const { overallHealth } = run({
    nodeResults: [['vm103', nodeCfg, nodeData([{ container: 'gitea', status: 'running', docker: {} }])]],
    monitors: { 1: { id: 1, name: 'gitea', status: 'up', active: true } },
    containerRegistry: fakeRegistry([
      { container: 'postgres', lastSeenNode: 'vm103', lastSeenAt: 1000, ageMs: 120_000 },
    ]),
  });
  assert.equal(overallHealth, 'degraded');
});

test('assemble: overallHealth is "up" when every card is up/running', () => {
  const { overallHealth } = run({
    nodeResults: [['vm103', nodeCfg, nodeData([
      { container: 'gitea', status: 'running', docker: {} },
      { container: 'grafana', status: 'running', docker: {} },
    ])]],
    monitors: { 1: { id: 1, name: 'gitea', status: 'up', active: true } },
  });
  assert.equal(overallHealth, 'up');
});

test('assemble: overallHealth is "unknown" when there are no cards', () => {
  const { overallHealth } = run({
    nodeResults: [['vm103', nodeCfg, nodeData([])]],
    monitors: {},
  });
  assert.equal(overallHealth, 'unknown');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/assembleServices.test.js`
Expected: FAIL — `assembleServices is not a function` (not yet exported).

- [ ] **Step 3: Extend the imports in `server/refresh.js`**

REPLACE the existing line:
```javascript
import { fetchMonitors, matchMonitor, markMonitorLogDone } from './monitors.js';
```
with:
```javascript
import { fetchMonitors, matchMonitor, markMonitorLogDone, selectOutageMonitors } from './monitors.js';
import { serviceRegistry } from './serviceRegistry.js';
import { containerRegistry } from './containerRegistry.js';
```

- [ ] **Step 4: Add the extended pure `assembleServices` to `server/refresh.js`**

Place this directly above `async function _refreshServices()`:

```javascript
/**
 * Rank for the canonical per-node sort: down → unknown → up. Both frontends
 * inherit this order (web renders in array order, mobile re-sorts identically).
 */
function serviceRank(s) {
  if (s.status === 'down') return 0;
  if (s.status === 'unknown') return 1;
  return 2;
}

/**
 * Pure assembly of the services cache payload from discovered node data, Kuma
 * monitors, and the container presence registry. Extracted from _refreshServices
 * so it can be unit-tested without the network.
 *
 * Three passes:
 *  (a) Running-container cards — Kuma overlays status; each running container is
 *      recorded into the container registry (last-seen node + timing).
 *  (b) Down-monitor synthesis — active monitors reporting `down` that matched no
 *      running container become red cards on their last-seen node (base spec).
 *  (c) Breadcrumb synthesis — established, UNMONITORED containers that have
 *      vanished (absent past grace, within TTL) become grey `unknown`
 *      `source:'presence'` cards on their last-seen node. Skipped if the
 *      container is running anywhere this cycle, or if ANY monitor matches it
 *      (Kuma owns tracked services entirely).
 *
 * Every node's cards are ordered down → unknown → up.
 *
 * Finally it computes ONE `overallHealth` from the whole assembled board (after
 * sorting) — `down` if any card is down; else `degraded` if any card is unknown
 * (presence breadcrumbs included); else `up` if there are cards; else `unknown`.
 * BOTH frontends read this single server value for their global dot, so they are
 * symmetric and deterministic (no client re-derivation).
 *
 * @returns {{ nodes: object, seen: Array<{monitorId:any, nodeKey:string}>, outageCount: number, breadcrumbCount: number, overallHealth: 'down'|'degraded'|'up'|'unknown' }}
 */
export function assembleServices({ nodeResults, monitors, config, lastSeenNodeOf, containerRegistry, now = Date.now }) {
  const consumed = new Set();
  const seen = [];
  const runningNames = new Set();
  const nowMs = now();

  // (a) Running-container cards.
  const nodeEntries = nodeResults.filter(Boolean).map(([nodeKey, nodeCfg, nodeData]) => {
    const metrics = nodeData.metrics;
    let containers = nodeData.containers;

    const hideList = (nodeCfg.hide || []).map((h) => h.toLowerCase());
    containers = containers.filter(
      (c) => !hideList.some((h) => c.container.toLowerCase().includes(h))
    );

    const services = containers.map((c) => {
      runningNames.add(c.container);
      if (containerRegistry) containerRegistry.recordSeen(c.container, nodeKey, nowMs);
      const override = config.services?.[c.container] || {};
      const displayName = override.display_name || formatContainerName(c.container);
      const explicitMonitor = override.monitor || null;
      const monitor = matchMonitor(c.container, explicitMonitor, monitors);
      if (monitor) {
        consumed.add(monitor.id);
        seen.push({ monitorId: monitor.id, nodeKey });
      }
      const status = monitor?.status || c.status || 'unknown';

      return {
        container: c.container,
        uid: `${nodeKey}:${c.container}`,
        display_name: displayName,
        icon: override.icon || null,
        status,
        monitored: !!monitor,
        ping: monitor?.ping || null,
        uptime24: monitor?.uptime24 || null,
        docker: c.docker,
        integration: null,
        source: 'container',
      };
    });

    return [
      nodeKey,
      {
        display_name: nodeCfg.display_name || nodeKey,
        subtitle: nodeCfg.subtitle || '',
        icon: nodeCfg.icon || '🖥',
        border_color: nodeCfg.border_color || '#6366f1',
        metrics,
        services,
      },
    ];
  });

  const nodes = Object.fromEntries(nodeEntries.filter(Boolean));
  const nodeKeys = Object.keys(nodes);

  // (b) Down-monitor synthesis — outages whose container left cAdvisor. The
  // down-vs-inactive invariant lives in selectOutageMonitors (active !== false).
  const outages = selectOutageMonitors(monitors, consumed);
  for (const m of outages) {
    let nodeKey = lastSeenNodeOf(m.id);
    if (!nodeKey || !nodes[nodeKey]) nodeKey = nodeKeys[0];
    if (!nodeKey || !nodes[nodeKey]) continue; // no nodes to attach to
    const override = config.services?.[m.name] || {};
    nodes[nodeKey].services.push({
      container: m.name,
      uid: `${nodeKey}:${m.name}`,
      display_name: override.display_name || m.name,
      icon: override.icon || null,
      status: 'down',
      monitored: true,
      ping: m.ping || null,
      uptime24: m.uptime24 || null,
      docker: null,
      integration: null,
      source: 'monitor',
    });
  }

  // (c) Breadcrumb synthesis — vanished, established, UNMONITORED containers.
  let breadcrumbCount = 0;
  if (containerRegistry) {
    const candidates = containerRegistry.getMissing({ now: nowMs });
    for (const cand of candidates) {
      if (runningNames.has(cand.container)) continue;             // running somewhere this cycle
      if (matchMonitor(cand.container, null, monitors)) continue; // Kuma owns it
      let nodeKey = cand.lastSeenNode;
      if (!nodeKey || !nodes[nodeKey]) nodeKey = nodeKeys[0];
      if (!nodeKey || !nodes[nodeKey]) continue; // no nodes to attach to
      const override = config.services?.[cand.container] || {};
      nodes[nodeKey].services.push({
        container: cand.container,
        uid: `${nodeKey}:${cand.container}`,
        display_name: override.display_name || formatContainerName(cand.container),
        icon: null,
        status: 'unknown',
        monitored: false,
        source: 'presence',
        lastSeenAt: cand.lastSeenAt,
        ping: null,
        uptime24: null,
        docker: null,
        integration: null,
      });
      breadcrumbCount += 1;
    }
  }

  // Canonical order per node: down → unknown → up, then alphabetical.
  for (const node of Object.values(nodes)) {
    node.services.sort((a, b) => serviceRank(a) - serviceRank(b) || a.display_name.localeCompare(b.display_name));
  }

  // Server-computed global health for BOTH frontends' dot (web NavBar + mobile
  // Overview). Computed ONCE from every assembled card across all nodes so the
  // two clients are symmetric and deterministic — a presence breadcrumb (status
  // 'unknown') drives 'degraded', exactly as a tracked-unknown monitor would.
  let anyCard = false;
  let anyDown = false;
  let anyUnknown = false;
  for (const node of Object.values(nodes)) {
    for (const s of node.services) {
      anyCard = true;
      if (s.status === 'down') anyDown = true;
      else if (s.status === 'unknown') anyUnknown = true;
    }
  }
  const overallHealth = anyDown ? 'down' : anyUnknown ? 'degraded' : anyCard ? 'up' : 'unknown';

  return { nodes, seen, outageCount: outages.length, breadcrumbCount, overallHealth };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test server/assembleServices.test.js`
Expected: PASS (15 tests).

- [ ] **Step 6: Wire `assembleServices` + both registries into `_refreshServices`**

In `server/refresh.js`, REPLACE the inline assembly block in `_refreshServices` — from `const nodeEntries = nodeResults.filter(Boolean).map(...)` through `setCache('services', result);` — with a call to the pure function plus registry persistence. The `recordSamples(...)` history loop, `markMonitorLogDone()`, and `return result;` that follow STAY exactly as they are (they already iterate `Object.entries(nodes)`). The replacement:

```javascript
    const { nodes, seen, overallHealth } = assembleServices({
      nodeResults,
      monitors,
      config,
      lastSeenNodeOf: (id) => serviceRegistry.getLastSeenNode(id),
      containerRegistry,
      now: Date.now,
    });

    // Remember where each running, monitored service lives so an outage that
    // later loses its container still lands on its panel.
    for (const { monitorId, nodeKey } of seen) serviceRegistry.recordSeen(monitorId, nodeKey);
    serviceRegistry.save();
    // containerRegistry was updated in-pass (recordSeen) inside assembleServices;
    // persist + decommission-prune it here.
    containerRegistry.save();

    // overallHealth is server-computed once (above) and shipped in the payload so
    // BOTH frontends' global dots read one truth (web NavBar + mobile Overview).
    const result = { nodes, overallHealth };
    setCache('services', result);
```

- [ ] **Step 7: Run the full server suite to confirm the wiring + no regression**

Run: `npm test`
Expected: PASS — all server tests green, including `presenceStore`, `serviceRegistry`, `containerRegistry`, `monitors.outage`, and `assembleServices`.

- [ ] **Step 8: Commit**

```bash
git add server/refresh.js server/assembleServices.test.js
git commit -m "feat(refresh): synthesise down cards + vanished-container breadcrumbs + server-computed overallHealth (containers ∪ monitors ∪ presence)"
```

---

### Task 5: Web frontend — server-health NavBar dot, unmonitored tag, grey breadcrumb, sort, relative-time helper

Repoint the NavBar global dot to the **server-computed `overallHealth`** off the `/api/services` payload (replacing the old `getMonitors()`-derived dot); render the existing `monitored === false` flag as a subtle **"unmonitored"** tag + nudge tooltip on running untracked cards; render `source === 'presence'` cards **grey** with a **"last seen X ago"** subtitle; sort each panel **down → unknown → up**.

> **Grounded web data flow (verified in real code):** `App.jsx` (`AppMain`) owns the `overallHealth` state and passes it to `<NavBar health={overallHealth}>`. `doRefresh` bumps `refreshKey` (which makes `DashboardView`'s `useDashboardData(refreshKey)` call `getServices()` → `/api/services`) **and separately** fire-and-forgets `getMonitors()` (→ `/api/uptime/monitors`) used **only** to derive the dot. `getMonitors` has **no other consumer** anywhere (grep: App.jsx import + use only; `useData.js` definition; zero test references), so we **drop it** and read the dot from `getServices().overallHealth` instead. `App.jsx` does NOT have the services body in scope (it lives in the `DashboardView` child), so the minimal real change is to make `doRefresh`'s existing fire-and-forget call `getServices()` instead of `getMonitors()` — both that call and `useDashboardData`'s call go through the **same** `getServices()` in `useData.js`, which shares a module-level ETag/result cache keyed by URL, so this is the designed 304-stable-identity path, **not** a duplicate round-trip. NavBar already maps `up→green, down→red, else→amber`, so the backend vocab (`up/down/degraded/unknown`) renders correctly with no NavBar change.

**Files:**
- Create: `src/util/relativeTime.js` (shared web+mobile; mobile imports it via the `@shared` alias)
- Create: `src/util/relativeTime.test.js`
- Modify: `src/App.jsx` (NavBar dot reads server `overallHealth` via `getServices()`; drop the `getMonitors` import + the monitor-derived health block)
- Modify: `src/hooks/useData.js` (remove the now-dead `getMonitors` export — its sole consumer was App.jsx's dot)
- Modify: `src/views/DashboardView/serviceCard.js` (pass `monitored`/`source`/`lastSeenAt` through `toServiceCard`)
- Modify: `src/views/DashboardView/serviceCard.test.jsx` (assert the new pass-through)
- Modify: `src/views/DashboardView/NodePanel.jsx` (client-side down→unknown→up sort)
- Modify: `src/components/ServiceCard.jsx` (grey breadcrumb color + "last seen" subtitle + unmonitored tag)
- Modify: `src/components/ServiceCard.test.jsx` (new render cases)

**Interfaces:**
- Produces: `formatAge(ms) → string` ("45s"/"12m"/"3h"/"5d"); `lastSeenLabel(lastSeenAt, now?) → string` ("last seen 3m ago").
- Consumes: the backend card contract (`monitored`, `source`, `lastSeenAt`) + the server-computed `overallHealth` field on the `/api/services` payload (Task 4).

- [ ] **Step 1: Write the failing relative-time test**

```javascript
// src/util/relativeTime.test.js
import { describe, it, expect } from 'vitest';
import { formatAge, lastSeenLabel } from './relativeTime.js';

describe('formatAge', () => {
  it('formats seconds, minutes, hours, days compactly', () => {
    expect(formatAge(5_000)).toBe('5s');
    expect(formatAge(45_000)).toBe('45s');
    expect(formatAge(12 * 60_000)).toBe('12m');
    expect(formatAge(3 * 60 * 60_000)).toBe('3h');
    expect(formatAge(5 * 24 * 60 * 60_000)).toBe('5d');
  });
  it('clamps negatives to 0s', () => {
    expect(formatAge(-100)).toBe('0s');
  });
});

describe('lastSeenLabel', () => {
  it('renders "last seen N ago" relative to now', () => {
    expect(lastSeenLabel(1000, 1000 + 120_000)).toBe('last seen 2m ago');
  });
  it('falls back gracefully when lastSeenAt is missing', () => {
    expect(lastSeenLabel(0, 123)).toBe('last seen recently');
    expect(lastSeenLabel(null, 123)).toBe('last seen recently');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/util/relativeTime.test.js`
Expected: FAIL — cannot resolve `./relativeTime.js`.

- [ ] **Step 3: Write the relative-time helper**

```javascript
// src/util/relativeTime.js
/**
 * Shared compact relative-time helpers for the "last seen X ago" breadcrumb
 * subtitle. Imported by the web ServiceCard and (via the `@shared` Vite alias)
 * the mobile ServiceRow, so both clients format presence ages identically.
 */

/** Compact human age for a millisecond duration: 45s, 12m, 3h, 5d. */
export function formatAge(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** "last seen 3m ago" for a lastSeenAt epoch-ms, relative to now. */
export function lastSeenLabel(lastSeenAt, now = Date.now()) {
  if (!lastSeenAt) return 'last seen recently';
  return `last seen ${formatAge(now - lastSeenAt)} ago`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/util/relativeTime.test.js`
Expected: PASS.

- [ ] **Step 5: Pass `monitored`/`source`/`lastSeenAt` through `toServiceCard`**

In `src/views/DashboardView/serviceCard.js`, REPLACE the `toServiceCard` return object with:

```javascript
export function toServiceCard(nodeKey, s, appDataByContainer = {}) {
  return {
    name: s.display_name,
    container: s.container,
    uid: `${nodeKey}:${s.container}`,
    node: nodeKey,
    status: s.status,
    monitored: s.monitored,
    source: s.source,
    lastSeenAt: s.lastSeenAt,
    uptime: s.uptime24,
    ping: s.ping,
    icon: s.icon,
    docker: s.docker,
    appData: appDataByContainer[s.container] || null,
  };
}
```

- [ ] **Step 6: Add the pass-through test**

Append to `src/views/DashboardView/serviceCard.test.jsx` (inside the existing `describe('toServiceCard', ...)` block, before its closing `});`):

```javascript
  it('passes monitored / source / lastSeenAt through for the unmonitored tag + breadcrumb', () => {
    const presence = {
      display_name: 'Postgres', container: 'postgres', status: 'unknown',
      monitored: false, source: 'presence', lastSeenAt: 1000,
    };
    const card = toServiceCard('vm103', presence, {});
    expect(card.monitored).toBe(false);
    expect(card.source).toBe('presence');
    expect(card.lastSeenAt).toBe(1000);
  });
```

- [ ] **Step 7: Sort the web panel down → unknown → up**

In `src/views/DashboardView/NodePanel.jsx`, REPLACE the `const services = (node.services || [])...` assignment with:

```javascript
  const serviceRank = (c) => (c.status === 'down' ? 0 : c.status === 'unknown' ? 1 : 2);
  const services = (node.services || [])
    .filter((s) => !claimedContainers.has(`${nodeKey}:${s.container}`))
    .map((s) => toServiceCard(nodeKey, s, appDataByContainer))
    .sort((a, b) => serviceRank(a) - serviceRank(b) || (a.name || '').localeCompare(b.name || ''));
```

- [ ] **Step 8: Render the grey breadcrumb color + subtitle + unmonitored tag in `ServiceCard.jsx`**

8a. Add the import at the top of `src/components/ServiceCard.jsx` (after the existing `getServiceIcon` import):

```javascript
import { lastSeenLabel } from '../util/relativeTime.js';
```

8b. REPLACE the status-derivation block (currently `const st = service.status || 'unknown';` through `const statusColor = ...;`) with:

```javascript
  const st = service.status || 'unknown';
  const isUp = st === 'up' || st === 'running';
  const isDown = st === 'down';
  // A presence breadcrumb (vanished, unmonitored container) is GREY — never the
  // amber that a tracked 'unknown' monitor would get. We are not claiming it broke.
  const isBreadcrumb = service.source === 'presence';
  const statusColor = isBreadcrumb
    ? 'var(--text-muted)'
    : isUp ? 'var(--green)' : isDown ? 'var(--red)' : 'var(--amber)';
```

8c. REPLACE all three identical name spans (the `<span style={{ fontFamily: 'var(--font-body)', fontSize: 'var(--fs-service-name)', fontWeight: 500, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', }}>{service.name}</span>` in the list, row, and grid layouts) with the shared `NameBlock`:

```javascript
        <NameBlock service={service} />
```

8d. In each layout's primary row, the `<BadgeArea ... />` call must also pass the breadcrumb flag. REPLACE every `<BadgeArea service={service} statusStyle={statusStyle} statusColor={statusColor} isUp={isUp} isDown={isDown} st={st} ... />` occurrence so it includes `isBreadcrumb={isBreadcrumb}` — i.e.:
- list mode: `<BadgeArea service={service} statusStyle={statusStyle} statusColor={statusColor} isUp={isUp} isDown={isDown} st={st} isBreadcrumb={isBreadcrumb} />`
- row mode: `<BadgeArea service={service} statusStyle={statusStyle} statusColor={statusColor} isUp={isUp} isDown={isDown} st={st} isBreadcrumb={isBreadcrumb} />`
- grid mode: `<BadgeArea service={service} statusStyle={statusStyle} statusColor={statusColor} isUp={isUp} isDown={isDown} st={st} isBreadcrumb={isBreadcrumb} compact />`

8e. Add the `NameBlock` and `UnmonitoredTag` components, and REPLACE the `BadgeArea` function, near the other helper components at the bottom of the file:

```javascript
// Name + optional "last seen X ago" subtitle (presence breadcrumb). Stacks the
// two lines in a flex column so the subtitle sits directly under the name.
function NameBlock({ service }) {
  const showSubtitle = service.source === 'presence';
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
      <span style={{
        fontFamily: 'var(--font-body)', fontSize: 'var(--fs-service-name)', fontWeight: 500,
        color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{service.name}</span>
      {showSubtitle && (
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{lastSeenLabel(service.lastSeenAt)}</span>
      )}
    </div>
  );
}

// Subtle "unmonitored" pill + nudge tooltip — a running container that matched
// no Kuma monitor. Surfaces the coverage gap without alarming (muted, not amber).
function UnmonitoredTag() {
  return (
    <span
      title="No Uptime Kuma monitor — add one to track this service's true status."
      style={{
        fontFamily: 'var(--font-mono)', fontSize: 9, padding: '2px 6px', borderRadius: 4,
        textTransform: 'uppercase', fontWeight: 500, whiteSpace: 'nowrap',
        background: 'var(--bg-card)', color: 'var(--text-muted)', border: '1px solid var(--border-color)',
      }}
    >unmonitored</span>
  );
}

function BadgeArea({ service, statusStyle, statusColor, isUp, isDown, st, isBreadcrumb, compact }) {
  if (statusStyle === 'minimal') return null;
  // A running, untracked container wears the unmonitored tag. A presence
  // breadcrumb is inherently unmonitored — it shows the "last seen" subtitle
  // instead, so it never double-signals.
  const showUnmonitored = service.monitored === false && !isBreadcrumb;
  if (statusStyle === 'dot') {
    // Dot mode: ping on the right, plus the unmonitored tag if applicable.
    return (
      <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexShrink: 0 }}>
        {showUnmonitored && <UnmonitoredTag />}
        {service.ping != null && service.ping > 0 && (
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, padding: '2px 6px',
            borderRadius: 4, background: 'var(--green-bg)', color: 'var(--green)',
            border: '1px solid var(--green-border)', whiteSpace: 'nowrap',
          }}>{service.ping}ms</span>
        )}
      </div>
    );
  }
  // Badge mode
  return (
    <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexShrink: 0 }}>
      {showUnmonitored && <UnmonitoredTag />}
      {service.ping != null && service.ping > 0 && (
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: compact ? 9 : 10, padding: '2px 6px',
          borderRadius: 4, background: 'var(--green-bg)', color: 'var(--green)',
          border: '1px solid var(--green-border)', whiteSpace: 'nowrap',
        }}>{service.ping}ms</span>
      )}
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: compact ? 9 : 10, padding: '2px 6px',
        borderRadius: 4, textTransform: 'uppercase', fontWeight: 500, whiteSpace: 'nowrap',
        background: isBreadcrumb ? 'var(--bg-card)' : isUp ? 'var(--green-bg)' : isDown ? 'var(--red-bg)' : 'var(--amber-bg)',
        color: statusColor,
        border: `1px solid ${isBreadcrumb ? 'var(--border-color)' : isUp ? 'var(--green-border)' : isDown ? 'var(--red-border)' : 'var(--amber-border)'}`,
      }}>{st === 'up' ? 'running' : st}</span>
    </div>
  );
}
```

> Note: the original dot-mode `BadgeArea` returned just the ping pill (or null). The replacement keeps that ping pill and adds the unmonitored tag, so dot mode now also surfaces coverage. Behavior for monitored cards is unchanged (the tag only renders when `monitored === false`).

- [ ] **Step 9: Add the web ServiceCard render cases**

Append to `src/components/ServiceCard.test.jsx` (add a new `describe` block, or fold into the existing top-level describe — keep existing tests intact):

```javascript
  it('shows an "unmonitored" tag with a nudge tooltip for a running untracked service', () => {
    render(<ServiceCard service={{ name: 'Postgres', status: 'running', monitored: false, source: 'container' }} statusStyle="badge" cardLayout="row" />);
    const tag = screen.getByText('unmonitored');
    expect(tag).toBeInTheDocument();
    expect(tag).toHaveAttribute('title', expect.stringContaining('add one to track'));
  });

  it('does NOT show the unmonitored tag for a monitored service', () => {
    render(<ServiceCard service={{ name: 'Gitea', status: 'up', monitored: true, source: 'container' }} statusStyle="badge" cardLayout="row" />);
    expect(screen.queryByText('unmonitored')).toBeNull();
  });

  it('renders a presence breadcrumb grey with a "last seen X ago" subtitle and no unmonitored tag', () => {
    render(<ServiceCard service={{ name: 'Postgres', status: 'unknown', monitored: false, source: 'presence', lastSeenAt: Date.now() - 2 * 60_000 }} statusStyle="badge" cardLayout="row" />);
    expect(screen.getByText(/last seen .* ago/)).toBeInTheDocument();
    expect(screen.queryByText('unmonitored')).toBeNull();
  });
```

> If `src/components/ServiceCard.test.jsx` does not already import `render`/`screen` from `@testing-library/react`, add `import { render, screen } from '@testing-library/react';` at the top (the existing file already renders `<ServiceCard>` directly, so the import is present — confirm before adding to avoid a duplicate).

- [ ] **Step 10: Repoint the NavBar global dot to the server `overallHealth` (App.jsx + useData.js)**

10a. In `src/App.jsx`, REPLACE the import:

```javascript
import { getMonitors } from './hooks/useData';
```
with:
```javascript
import { getServices } from './hooks/useData';
```

10b. In `src/App.jsx`, REPLACE the entire `doRefresh` useCallback (the `getMonitors()`-derived health block) with the server-`overallHealth` read:

```javascript
  const doRefresh = useCallback(() => {
    // Bump refreshKey IMMEDIATELY so DashboardView starts fetching right away.
    // The health read runs in parallel — it updates the navbar health dot but
    // does NOT block the dashboard data load.
    setLastUpdated(new Date());
    setRefreshKey((k) => k + 1);

    // Navbar health dot — fire and forget, non-blocking. Read the SERVER-computed
    // overallHealth off the same /api/services payload the dashboard renders, so
    // the web header dot and the mobile Overview dot are symmetric (one server
    // truth, no client re-derivation). getServices shares useData's ETag/result
    // cache with DashboardView's fetch, so this is the 304-stable-identity path,
    // not a duplicate round-trip. A 304-no-body / missing field keeps the current
    // value; a thrown fetch flips to 'unknown'.
    getServices()
      .then((body) => {
        if (body && typeof body.overallHealth === 'string') setOverallHealth(body.overallHealth);
      })
      .catch(() => setOverallHealth('unknown'));
  }, []);
```

10c. In `src/hooks/useData.js`, REMOVE the now-dead `getMonitors` wrapper (its only consumer was App.jsx's dot; the `/api/uptime/monitors` server route is untouched). REPLACE:

```javascript
// Legacy functions (kept: getMonitors used by App.jsx health check).
export async function getMonitors() {
  return fetchJson(`${getApiBase()}/uptime/monitors`);
}

export async function getWeather(lat, lon) {
```
with:
```javascript
export async function getWeather(lat, lon) {
```

> No web unit test referenced `getMonitors` (there is no `App.test.jsx`), so nothing breaks; the dot is exercised by the Task 8 manual verification (item 2 web header dot goes red on a tracked down; item 5 goes amber on a presence breadcrumb — now symmetric with mobile).

- [ ] **Step 11: Run the web suite**

Run: `npm run test:client`
Expected: PASS — new `relativeTime`, `serviceCard` pass-through, and `ServiceCard` tag/breadcrumb cases green; existing web tests unaffected (no test imported `getMonitors`).

- [ ] **Step 12: Commit**

```bash
git add src/App.jsx src/hooks/useData.js src/util/relativeTime.js src/util/relativeTime.test.js src/views/DashboardView/serviceCard.js src/views/DashboardView/serviceCard.test.jsx src/views/DashboardView/NodePanel.jsx src/components/ServiceCard.jsx src/components/ServiceCard.test.jsx
git commit -m "feat(web): server-overallHealth NavBar dot + unmonitored tag + grey vanished-container breadcrumb + down→unknown→up sort"
```

---

### Task 6: Mobile — server-health Overview dot + unmonitored tag + breadcrumb + down→unknown→up sort

The Overview global dot reads the **server-computed `overallHealth`** directly off `servicesBody` (the raw `/api/services` payload `useDashboard` already holds) — the client `deriveGlobalHealth` is **dropped** since the server now computes it once for both clients. This task also extends `sortProblemsFirst` to **down → unknown → up**, plus the **unmonitored tag** + **grey breadcrumb** + **"last seen X ago"** subtitle in `ServiceRow`.

> **Grounded mobile data flow (verified in real code):** `useDashboard` (`mobile/src/data/useDashboard.js`) fetches `getServices(true)` and exposes the raw body as `servicesBody`; `Overview` receives it via `data.servicesBody`. So the dot reads `servicesBody?.overallHealth` directly — no derive helper, symmetric with the web NavBar dot (both read the same server field).

**Files:**
- Modify: `mobile/src/data/derive.js` (3-way `sortProblemsFirst` only — `deriveGlobalHealth` is **not** added; the server computes it)
- Modify: `mobile/src/data/derive.test.js` (3-way sort cases + update the existing sort assertion to the 3-way order)
- Modify: `mobile/src/views/Overview.jsx` (header + dot reading `servicesBody.overallHealth`)
- Modify: `mobile/src/components/StatusDot.jsx` (grey for `source==='presence'`)
- Modify: `mobile/src/components/ServiceRow.jsx` (name-col + subtitle + unmonitored tag)
- Create: `mobile/src/components/ServiceRow.test.jsx`
- Modify: `mobile/src/MobileApp.css` (header/dot + tag/subtitle rules)

**Interfaces:**
- Consumes: the server-computed `servicesBody.overallHealth` field (Task 4) for the Overview dot; existing `sortProblemsFirst`; the shared `lastSeenLabel` via the `@shared` alias.

- [ ] **Step 1: Write the failing tests**

In `mobile/src/data/derive.test.js`, add the new sort describe block (place at the end of the file, before the final newline). **No import change is needed** — `sortProblemsFirst` is already imported, and the client `deriveGlobalHealth` is **not** added (the server computes global health — Task 4):

```javascript
describe('sortProblemsFirst (down → unknown → up)', () => {
  it('orders down first, unknown/presence in the middle, up last', () => {
    const input = [
      { uid: 'a', status: 'up' },
      { uid: 'b', status: 'unknown', source: 'presence' },
      { uid: 'c', status: 'down' },
    ];
    expect(sortProblemsFirst(input).map((s) => s.uid)).toEqual(['c', 'b', 'a']);
  });
});
```

Also UPDATE the existing `sortProblemsFirst` assertion (currently expecting `['vm-101:gitea', 'vm-101:adguard', 'gateway-pi:pihole']`) to the new 3-way order — the fixture has gitea(down), adguard(up), pihole(unknown), so down → unknown → up becomes:

```javascript
    expect(sorted.map((s) => s.uid)).toEqual([
      'vm-101:gitea', 'gateway-pi:pihole', 'vm-101:adguard',
    ]);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mobile && npx vitest run --config vite.config.mobile.js src/data/derive.test.js`
Expected: FAIL — the new + updated `sortProblemsFirst` assertions fail against the current down-only sort.

- [ ] **Step 3: Implement in `mobile/src/data/derive.js`**

REPLACE `sortProblemsFirst` with the 3-way rank. This is the **only** `derive.js` change — `deriveGlobalHealth` is **NOT** added; the server computes global health once and ships it as `overallHealth` (Task 4), so both clients read that field instead of re-deriving:

```javascript
/** Rank for the down → unknown → up sort. Presence breadcrumbs rank as unknown. */
function serviceRank(s) {
  if (s && s.status === 'down') return 0;
  if (s && (s.status === 'unknown' || s.source === 'presence')) return 1;
  return 2;
}

/** Stable down → unknown → up sort (original order preserved within a rank). No mutation. */
export function sortProblemsFirst(list) {
  return [...list]
    .map((s, i) => [s, i])
    .sort((a, b) => serviceRank(a[0]) - serviceRank(b[0]) || a[1] - b[1])
    .map(([s]) => s);
}
```

> `serviceIsProblem` (only `'down'`) stays unchanged — `deriveSubsystems`/`deriveIncidents`/`nodeUpDown` keep counting only `'down'` as a problem. Only the *sort* gained the middle rank.

- [ ] **Step 4: Run derive tests to verify they pass**

Run: `cd mobile && npx vitest run --config vite.config.mobile.js src/data/derive.test.js`
Expected: PASS.

- [ ] **Step 5: Add the dot to the Overview header**

In `mobile/src/views/Overview.jsx`, **no derive-import change is needed** (`deriveGlobalHealth` is not used — the server computes it). Add inside the component, after `const nodes = useMemo(() => groupByNode(servicesBody), [servicesBody]);`:

```javascript
  // Server-computed global health off the /api/services payload — the same field
  // the web NavBar dot reads (Task 4), so both dots are symmetric. No client
  // re-derivation; a presence breadcrumb already makes this 'degraded' server-side.
  const health = servicesBody?.overallHealth || 'unknown';
  const healthColor = health === 'up' ? 'var(--green)' : health === 'down' ? 'var(--red)' : 'var(--amber)';
  const healthLabel =
    health === 'up' ? 'All systems operational'
    : health === 'down' ? 'Service disruption'
    : health === 'degraded' ? 'Degraded'
    : 'No data';
```

REPLACE `<h1>Overview</h1>` with:

```jsx
      <header className="overview-header">
        <span
          className="overview-health-dot"
          style={{ background: healthColor, boxShadow: `0 0 8px ${healthColor}` }}
          aria-hidden="true"
        />
        <h1>Overview</h1>
        <span className="sr-only" role="status" aria-live="polite">{healthLabel}</span>
      </header>
```

- [ ] **Step 6: Make `StatusDot` grey for presence breadcrumbs**

REPLACE the body of `mobile/src/components/StatusDot.jsx` with:

```jsx
export default function StatusDot({ status, source }) {
  const isUp = status === 'up' || status === 'running';
  const isDown = status === 'down';
  // A presence breadcrumb is grey (muted), never the amber a tracked 'unknown'
  // monitor would get — we are not claiming it broke.
  const isBreadcrumb = source === 'presence';
  const color = isBreadcrumb ? 'var(--text-muted)' : isUp ? 'var(--green)' : isDown ? 'var(--red)' : 'var(--amber)';
  const label = isUp ? 'Up' : isDown ? 'Down' : 'Unknown';
  const glyph = isUp ? '▲' : isDown ? '▼' : '◆';
  return (
    <span
      role="status"
      aria-label={`Status: ${label}`}
      style={{ flexShrink: 0, lineHeight: 1, fontSize: 9, color, textShadow: `0 0 6px ${color}`, fontFamily: 'var(--font-mono)' }}
    >
      <span aria-hidden="true">{glyph}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
```

> The existing `StatusDot.test.jsx` (up→green, down→red, unknown→amber, no `source`) stays green — `isBreadcrumb` is false when `source` is undefined.

- [ ] **Step 7: Add the name-col + subtitle + unmonitored tag to `ServiceRow`**

REPLACE the body of `mobile/src/components/ServiceRow.jsx` with:

```jsx
import React from 'react';
import { getServiceIcon } from '@shared/hooks/useData.js';
import { lastSeenLabel } from '@shared/util/relativeTime.js';
import StatusDot from './StatusDot.jsx';

/**
 * One service row: base-aware icon (NEVER a relative /api path), name (+ "last
 * seen X ago" subtitle for a vanished-container breadcrumb), an "unmonitored"
 * tag when no Kuma monitor matched, node tag, status dot, ping. The whole row is
 * a button → onTap(service). Read-only.
 */
export default function ServiceRow({ service, onTap }) {
  const icon = getServiceIcon(service.icon) || getServiceIcon(service.display_name);
  const isBreadcrumb = service.source === 'presence';
  const isUnmonitored = service.monitored === false && !isBreadcrumb;
  return (
    <button
      type="button"
      className="svc-row"
      onClick={() => onTap && onTap(service)}
      aria-label={`${service.display_name} on ${service.nodeName}`}
    >
      <StatusDot status={service.status} source={service.source} />
      {icon && <img role="img" className="svc-row__icon" src={icon} alt={service.display_name} onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
      <div className="svc-row__name-col">
        <span className="svc-row__name">{service.display_name}</span>
        {isBreadcrumb && <span className="svc-row__subtitle">{lastSeenLabel(service.lastSeenAt)}</span>}
      </div>
      {isUnmonitored && (
        <span className="svc-row__unmonitored" title="No Uptime Kuma monitor — add one to track this service's true status.">
          unmonitored
        </span>
      )}
      <span className="svc-row__node">{service.nodeName}</span>
      {service.ping != null && service.ping > 0 && <span className="svc-row__ping">{service.ping}ms</span>}
    </button>
  );
}
```

- [ ] **Step 8: Add the mobile CSS**

Append to `mobile/src/MobileApp.css`:

```css
/* C-lite: name column wrapper when a subtitle is present (name loses flex:1) */
.svc-row__name-col { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.svc-row__name-col .svc-row__name { flex: initial; }
.svc-row__subtitle { font-family: var(--font-mono); font-size: var(--text-2xs); color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* C-lite: unmonitored tag (mirrors .svc-row__node) */
.svc-row__unmonitored { font-family: var(--font-mono); font-size: var(--text-2xs); color: var(--text-muted); background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 4px; padding: 2px 6px; flex-shrink: 0; }
/* Task 4: overview-header dot */
.overview-header { display: flex; align-items: center; gap: 8px; }
.overview-health-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
```

- [ ] **Step 9: Write the ServiceRow test**

```jsx
// mobile/src/components/ServiceRow.test.jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ServiceRow from './ServiceRow.jsx';

describe('ServiceRow', () => {
  it('shows an "unmonitored" tag for a running untracked service', () => {
    render(<ServiceRow service={{ display_name: 'Postgres', nodeName: 'VM103', status: 'running', monitored: false, source: 'container' }} />);
    const tag = screen.getByText('unmonitored');
    expect(tag).toBeInTheDocument();
    expect(tag).toHaveAttribute('title', expect.stringContaining('add one to track'));
  });

  it('renders a presence breadcrumb with a "last seen X ago" subtitle and no unmonitored tag', () => {
    render(<ServiceRow service={{ display_name: 'Postgres', nodeName: 'VM103', status: 'unknown', monitored: false, source: 'presence', lastSeenAt: Date.now() - 2 * 60_000 }} />);
    expect(screen.getByText(/last seen .* ago/)).toBeInTheDocument();
    expect(screen.queryByText('unmonitored')).toBeNull();
  });

  it('does not show the tag or subtitle for a monitored, up service', () => {
    render(<ServiceRow service={{ display_name: 'Gitea', nodeName: 'VM103', status: 'up', monitored: true, source: 'container' }} />);
    expect(screen.queryByText('unmonitored')).toBeNull();
    expect(screen.queryByText(/last seen/)).toBeNull();
  });
});
```

- [ ] **Step 10: Run mobile tests + a build smoke check**

Run: `npm run --prefix mobile test`
Expected: PASS — the 3-way `sortProblemsFirst` and `ServiceRow` cases green; existing `StatusDot`/derive tests unaffected (the Overview dot reads `servicesBody.overallHealth` — no `deriveGlobalHealth` to test).

Run: `cd mobile && npx vite build --config vite.config.mobile.js`
Expected: builds without error (confirms the Overview + ServiceRow JSX compiles and `@shared/util/relativeTime.js` resolves).

- [ ] **Step 11: Commit**

```bash
git add mobile/src/data/derive.js mobile/src/data/derive.test.js mobile/src/views/Overview.jsx mobile/src/components/StatusDot.jsx mobile/src/components/ServiceRow.jsx mobile/src/components/ServiceRow.test.jsx mobile/src/MobileApp.css
git commit -m "feat(mobile): server-overallHealth Overview dot + unmonitored tag + breadcrumb + down→unknown→up sort"
```

---

### Task 7: Verify paused-monitor handling against live Kuma (REUSED from the base plan — BLOCKED on `KUMA_URL`)

> Requires the live Kuma URL (in prod's compose `.env`, not the repo) — **get it from Jag**. This closes the §10 open item from the base spec. The feature already ships safely without it (the `active !== false` read + "only synthesise `status==='down'`" are the fail-safe); this confirms a *paused* monitor can never produce a phantom outage. It does NOT touch the breadcrumb path (presence cards never derive from monitors).

**Files:**
- Possibly modify: `server/monitors.js` (only if the probe shows paused monitors leak through)
- Possibly add: a focused test mirroring the live shape

- [ ] **Step 1: Probe the live status-page API**

```bash
# KUMA_URL e.g. http://<kuma-host>:3001 — ask Jag.
curl -s "$KUMA_URL/api/status-page/default" \
  | jq '.publicGroupList[].monitorList[] | {id, name, active}'
```

- [ ] **Step 2: Pause a test monitor in Kuma, re-run the probe, and classify the result**

Decision rule:
- **Paused monitor disappears from `monitorList`** → already hidden; nothing to do. ✅
- **Paused monitor appears with `active: false`** → already hidden by `selectOutageMonitors` (`active !== false`). ✅
- **Paused monitor appears with `active` absent/true AND its heartbeat status is `0` (down)** → it would leak as a phantom outage. Apply Step 3.
- **Paused monitor appears but its heartbeat is not `0`** (no fresh down beat) → `status !== 'down'` so it is already excluded. ✅

- [ ] **Step 3 (only if Step 2 hit the leak case): exclude by the real signal**

Add the discovered paused/maintenance signal to the `active` derivation in `fetchMonitors`. Example if Kuma exposes `pub.maintenance === true` for paused monitors:

```javascript
        active: pub.active !== false && pub.maintenance !== true,
```

Add a `monitors.outage.test.js` case asserting a `{ maintenance: true, status: 'down' }` monitor yields `active: false` and is excluded by `selectOutageMonitors`. Run `node --test server/monitors.outage.test.js` → PASS. Commit:

```bash
git add server/monitors.js server/monitors.outage.test.js
git commit -m "fix(monitors): treat paused Kuma monitors as inactive (no phantom outage)"
```

- [ ] **Step 4: Record the finding** in `docs/superpowers/specs/2026-06-26-down-service-visibility-design.md` §10 (replace "Open item" with the confirmed behavior) and commit the doc.

---

### Task 8: Whole-branch verification + PR (REUSED from the base plan — updated)

- [ ] **Step 1: Full suites green**

Run: `npm run test:all`
Expected: PASS (server `npm test` + web `test:client` + mobile). This covers the new `presenceStore`, `containerRegistry`, extended `assembleServices`, `relativeTime`, web `ServiceCard`/`serviceCard`, and mobile `derive`/`ServiceRow` tests.

- [ ] **Step 2: Live manual verification** (against staging or prod — CONFIRM with Jag before touching prod)

1. `curl -s http://192.168.68.11:3099/api/health` → `refresh: ok` (loop healthy).
2. **Down (tracked):** stop a **monitored** container. Within ~30s its card appears **red at the top of its node panel** (web + mobile); web header dot + mobile Overview dot go **red**.
3. **Inactive (tracked):** **pause** that monitor → card **disappears** (the down-vs-inactive invariant).
4. **Unmonitored (running):** an untracked running container shows **green + "unmonitored" tag** + nudge tooltip.
5. **Breadcrumb (vanished, unmonitored):** stop an **unmonitored**, *established* container. After the grace window (~90s) a **grey "Unknown — last seen {age}"** card appears on its last-seen panel; **both** the web header dot and the mobile Overview dot go **amber/degraded**. Leave it past TTL (24h) → it fades.
6. Restart the container → the breadcrumb is replaced by the live green card.

> **Global-dot symmetry (server-computed health):** both dots now read the single server `overallHealth` field from `/api/services` — the web NavBar via `getServices()` and the mobile Overview via `servicesBody.overallHealth`. A *presence* breadcrumb makes `overallHealth === 'degraded'`, so it flips **both** the web header dot and the mobile Overview dot to **amber** (Step 5). This **resolves** the old web-vs-mobile asymmetry where the web dot (Kuma-only via `getMonitors()`) ignored breadcrumbs.

- [ ] **Step 3: Quality + security gates** (rule #5)

Run `/simplify`, then `/security-review`, on the branch diff. Address findings. Pay attention to: the shared `presenceStore` load path (prototype-pollution — `__proto__` is skipped + `Object.create(null)`), the `title` tooltip strings (static, no interpolation), the relative-time helper (no user input), and the new global-health read (`assembleServices` returns a server-side enum; the web dot consumes `body.overallHealth` type-guarded with `typeof === 'string'`, so no untrusted value reaches the dot).

- [ ] **Step 4: Relative-time helper note**

A shared helper `src/util/relativeTime.js` was introduced and is imported by BOTH the web `ServiceCard` (`../util/relativeTime.js`) and the mobile `ServiceRow` (`@shared/util/relativeTime.js`). Confirm the `@shared` Vite alias resolves it in the mobile build (Task 6 Step 10's `vite build` is the gate). Mention this shared module in the PR description so reviewers know a web-side file is a mobile dependency.

- [ ] **Step 5: Push the branch and open a PR** for Jag to review and merge (NEVER merge yourself; NEVER push `main`).

```bash
git push -u origin feat/down-service-visibility
```

Open a PR `feat/down-service-visibility → main` summarising: (1) the base down-vs-inactive behavior; (2) the new coverage-honesty layer (unmonitored tag + vanished-container breadcrumb); (3) the shared `presenceStore`/`relativeTime` modules; (4) the defaults + env overrides; (5) manual-verification results; (6) the **server-computed `overallHealth`** feeding both global dots symmetrically (web NavBar via `getServices()`, mobile Overview via `servicesBody.overallHealth`) — the prior web-vs-mobile asymmetry is now **resolved**, and the client `getMonitors()`/`deriveGlobalHealth` derivations are removed.

---

## Out of Scope (v1)

- Dismiss / decommission action + API + persisted dismissals (clear = TTL auto-fade only).
- Docker-socket crash detection (`exited`/`dead`/`unhealthy`) — separate, heavier project needing per-node Docker API access.
- Auto-creating Kuma monitors.
