# Down-Service Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a service that is **down** (outage) visible as a red card on web + mobile even when its container has stopped and vanished from cAdvisor, while a **deliberately retired** service stays hidden.

**Architecture:** Today the board is built only from running containers (cAdvisor), so a stopped container produces no card and Uptime Kuma is used only to *paint* existing cards. This change builds the per-node service list from the **union** of running containers and **active Kuma monitors**: an active monitor reporting `down` that matches no running container becomes a synthesised red card, placed under the service's **last-seen node** (persisted to `data/`). Retirement = pause/delete the Kuma monitor. The frontends already render `status:'down'` as red and sort down-first; the backend is the bulk of the work.

**Tech Stack:** Node ESM backend (`node:test` for server tests), React 19 + Vite web app, Capacitor mobile app (Vitest + @testing-library/react).

## Global Constraints

- **THE INVARIANT — down vs inactive:** A service is shown **DOWN (red)** iff it has an **active Kuma monitor reporting `down`**. A service is **INACTIVE (hidden)** iff its monitor is **paused or deleted** in Kuma. The container's Docker state is NOT the differentiator — a stopped container is ambiguous (could be an outage or a decommission); only the Kuma monitor's active/paused state disambiguates intent. Every task preserves this invariant.
- **Fail-safe:** if we cannot positively confirm a monitor is active, do NOT synthesise a down card for it (prefer a missed red card over a phantom outage on a retired service). A matched, running container always renders regardless.
- No new status string — reuse the existing `status: 'down'` (both frontends already render it red).
- Persistence: data dir via `server/util/dataDir.js` (`DATA_DIR`); writes via `server/util/atomicWrite.js` (`atomicWriteFileSync`); corruption-safe load returns an empty store (mirror `server/push/tokenStore.js`).
- Branch: `feat/down-service-visibility`. NEVER push to `main`; NEVER add a `Co-Authored-By` trailer.
- Test commands: server/src → `npm test` (single file: `node --test server/<file>.test.js`); mobile → `npm run --prefix mobile test` (single file: `cd mobile && npx vitest run src/<path>.test.jsx`).

---

### Task 1: Service registry — last-seen node memory

**Files:**
- Create: `server/serviceRegistry.js`
- Test: `server/serviceRegistry.test.js`

**Interfaces:**
- Produces: `createServiceRegistry({ path?, now? }) → { recordSeen(monitorId, nodeKey), getLastSeenNode(monitorId) → string|null, save(), snapshot() → object }`; and a default singleton `export const serviceRegistry`.

- [ ] **Step 1: Write the failing test**

```javascript
// server/serviceRegistry.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { createServiceRegistry } from './serviceRegistry.js';

function tmpPath(name) {
  return join(tmpdir(), `jaghelm-registry-${process.pid}-${name}.json`);
}

test('registry: record then look up returns the last-seen node', () => {
  const path = tmpPath('lookup');
  try {
    const r = createServiceRegistry({ path, now: () => 1000 });
    r.recordSeen('42', 'vm103');
    assert.equal(r.getLastSeenNode('42'), 'vm103');
    assert.equal(r.getLastSeenNode('999'), null);
  } finally { if (existsSync(path)) rmSync(path); }
});

test('registry: persists across instances (save → reload)', () => {
  const path = tmpPath('persist');
  try {
    const a = createServiceRegistry({ path, now: () => 1 });
    a.recordSeen('7', 'pi1');
    a.save();
    const b = createServiceRegistry({ path });
    assert.equal(b.getLastSeenNode('7'), 'pi1');
  } finally { if (existsSync(path)) rmSync(path); }
});

test('registry: corrupt file loads as empty (no throw)', () => {
  const path = tmpPath('corrupt');
  try {
    writeFileSync(path, '{ this is not json');
    const r = createServiceRegistry({ path });
    assert.equal(r.getLastSeenNode('1'), null);
  } finally { if (existsSync(path)) rmSync(path); }
});

test('registry: re-recording the same node does not require a write', () => {
  const path = tmpPath('dirty');
  try {
    const r = createServiceRegistry({ path, now: () => 5 });
    r.recordSeen('1', 'vm103');
    r.save();                       // writes once
    rmSync(path);                   // delete the file
    r.recordSeen('1', 'vm103');     // same node → not dirty
    r.save();                       // should be a no-op, file stays absent
    assert.equal(existsSync(path), false);
  } finally { if (existsSync(path)) rmSync(path); }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/serviceRegistry.test.js`
Expected: FAIL — `Cannot find module './serviceRegistry.js'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// server/serviceRegistry.js
/**
 * Last-seen-node memory for the dashboard.
 *
 * When a service's container is running we record which node it was on. When
 * that container later disappears but its Uptime Kuma monitor reports DOWN, the
 * board synthesises a red "down" card and places it under this remembered node
 * (its panel), so an outage shows where the service normally lives. Source of
 * truth for up/down stays Kuma; this only answers "which panel".
 *
 * Persisted to data/ so a service already down at boot still lands on its panel.
 * Keyed by Kuma monitor id (stable). Mirrors push/tokenStore.js conventions.
 */
import { existsSync, readFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { atomicWriteFileSync } from './util/atomicWrite.js';
import { DATA_DIR } from './util/dataDir.js';
import { createLogger } from './util/logger.js';

const log = createLogger('serviceRegistry');
const DEFAULT_PATH = join(DATA_DIR, 'service-registry.json');

export function createServiceRegistry({ path = DEFAULT_PATH, now = Date.now } = {}) {
  function load() {
    try {
      if (!existsSync(path)) return Object.create(null);
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const safe = Object.create(null);
        for (const k of Object.keys(parsed)) {
          const v = parsed[k];
          if (v && typeof v === 'object' && typeof v.lastSeenNode === 'string') {
            safe[k] = { lastSeenNode: v.lastSeenNode, lastSeenAt: Number(v.lastSeenAt) || 0 };
          }
        }
        return safe;
      }
      return Object.create(null);
    } catch {
      return Object.create(null);
    }
  }

  let store = load();
  let dirty = false;

  function recordSeen(monitorId, nodeKey) {
    if (monitorId == null || !nodeKey) return;
    const key = String(monitorId);
    const prev = store[key];
    if (!prev || prev.lastSeenNode !== nodeKey) dirty = true;
    store[key] = { lastSeenNode: nodeKey, lastSeenAt: now() };
  }

  function getLastSeenNode(monitorId) {
    const e = store[String(monitorId)];
    return e ? e.lastSeenNode : null;
  }

  function save() {
    if (!dirty) return;
    try {
      const dir = dirname(path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      atomicWriteFileSync(path, JSON.stringify(store, null, 2));
      dirty = false;
    } catch (err) {
      log.error({ err }, 'Failed to save service registry');
    }
  }

  function snapshot() {
    return { ...store };
  }

  return { recordSeen, getLastSeenNode, save, snapshot };
}

export const serviceRegistry = createServiceRegistry();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/serviceRegistry.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/serviceRegistry.js server/serviceRegistry.test.js
git commit -m "feat(refresh): add persisted last-seen-node service registry"
```

---

### Task 2: Monitor outage selection + active flag

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

In `server/monitors.js`, inside `fetchMonitors`, change the monitor object built in the `for (const pub of monitorList)` loop (currently lines ~86-92) to add the `active` field:

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

### Task 3: Reconcile containers ∪ monitors and synthesise down cards

**Files:**
- Modify: `server/refresh.js` (extract a pure `assembleServices`, call it + the registry from `_refreshServices`)
- Test: `server/assembleServices.test.js`

**Interfaces:**
- Consumes: `selectOutageMonitors` (Task 2), `serviceRegistry` (Task 1), existing `matchMonitor` and `formatContainerName` (already in `refresh.js`).
- Produces: `export function assembleServices({ nodeResults, monitors, config, lastSeenNodeOf }) → { nodes, seen, outageCount }` where `nodeResults` is `Array<[nodeKey, nodeCfg, nodeData]>`, `nodeData` is `{ metrics, containers }`, `lastSeenNodeOf` is `(monitorId) => string|null`, `nodes` is the cache payload `{ [nodeKey]: { ..., services } }`, and `seen` is `Array<{ monitorId, nodeKey }>`.

- [ ] **Step 1: Write the failing test**

```javascript
// server/assembleServices.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleServices } from './refresh.js';

const nodeCfg = { display_name: 'Production' };
function nodeData(containers) { return { metrics: {}, containers }; }
function run({ nodeResults, monitors, lastSeen = {} }) {
  return assembleServices({
    nodeResults,
    monitors,
    config: { services: {} },
    lastSeenNodeOf: (id) => lastSeen[String(id)] ?? null,
  });
}

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

test('assemble: seen[] reports matched (container, node) pairs for the registry', () => {
  const { seen } = run({
    nodeResults: [['vm103', nodeCfg, nodeData([{ container: 'gitea', status: 'running', docker: {} }])]],
    monitors: { 1: { id: 1, name: 'gitea', status: 'up', active: true } },
  });
  assert.deepEqual(seen, [{ monitorId: 1, nodeKey: 'vm103' }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/assembleServices.test.js`
Expected: FAIL — `assembleServices is not a function` (not yet exported).

- [ ] **Step 3: Add imports + the pure `assembleServices` function to `server/refresh.js`**

Add to the import block at the top of `server/refresh.js`:

```javascript
import { fetchMonitors, matchMonitor, markMonitorLogDone, selectOutageMonitors } from './monitors.js';
import { serviceRegistry } from './serviceRegistry.js';
```

(The first line REPLACES the existing `import { fetchMonitors, matchMonitor, markMonitorLogDone } from './monitors.js';`.)

Add this exported function to `server/refresh.js` (place it directly above `async function _refreshServices()`):

```javascript
/**
 * Pure assembly of the services cache payload from discovered node data and
 * Kuma monitors. Extracted from _refreshServices so it can be unit-tested
 * without the network.
 *
 * Builds each node's cards from its running containers (Kuma overlays status),
 * then UNIONs in synthesised red "down" cards for active monitors that report
 * `down` but matched no running container (outages whose container vanished).
 * Synthesised cards are placed on the service's last-seen node (its panel), or
 * the first node as a fallback. Every node's cards are ordered down-first.
 *
 * @returns {{ nodes: object, seen: Array<{monitorId:any, nodeKey:string}>, outageCount: number }}
 */
export function assembleServices({ nodeResults, monitors, config, lastSeenNodeOf }) {
  const consumed = new Set();
  const seen = [];

  const nodeEntries = nodeResults.filter(Boolean).map(([nodeKey, nodeCfg, nodeData]) => {
    const metrics = nodeData.metrics;
    let containers = nodeData.containers;

    const hideList = (nodeCfg.hide || []).map((h) => h.toLowerCase());
    containers = containers.filter(
      (c) => !hideList.some((h) => c.container.toLowerCase().includes(h))
    );

    const services = containers.map((c) => {
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

  // UNION: synthesise red "down" cards for active, down, unmatched monitors —
  // outages whose container left cAdvisor. The down-vs-inactive invariant lives
  // in selectOutageMonitors (active !== false ⇒ not retired).
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

  // Canonical order per node: down first, then alphabetical by display_name. All
  // clients (web panel render order, mobile sort) inherit down-first from this.
  for (const node of Object.values(nodes)) {
    node.services.sort((a, b) => {
      const da = a.status === 'down' ? 0 : 1;
      const db = b.status === 'down' ? 0 : 1;
      return da - db || a.display_name.localeCompare(b.display_name);
    });
  }

  return { nodes, seen, outageCount: outages.length };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/assembleServices.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire `assembleServices` + the registry into `_refreshServices`**

In `server/refresh.js`, REPLACE the body of `_refreshServices` from the line `const nodeEntries = nodeResults.filter(Boolean).map(...)` through `setCache('services', result);` (the old inline container-mapping + node assembly, ~lines 147-201) with a call to the pure function plus registry persistence. The new `_refreshServices` from the `nodeResults` assembly onward becomes:

```javascript
    const { nodes, seen } = assembleServices({
      nodeResults,
      monitors,
      config,
      lastSeenNodeOf: (id) => serviceRegistry.getLastSeenNode(id),
    });

    // Remember where each running, monitored service lives so an outage that
    // later loses its container still lands on its panel.
    for (const { monitorId, nodeKey } of seen) serviceRegistry.recordSeen(monitorId, nodeKey);
    serviceRegistry.save();

    const result = { nodes };
    setCache('services', result);
```

The `recordSamples(...)` history-recording loop, `markMonitorLogDone()`, and `return result;` that follow stay exactly as they are (they already iterate `Object.entries(nodes)`).

- [ ] **Step 6: Run the full server suite to confirm the wiring + no regression**

Run: `npm test`
Expected: PASS — all server/src tests green, including the new `serviceRegistry`, `monitors.outage`, and `assembleServices` files.

- [ ] **Step 7: Commit**

```bash
git add server/refresh.js server/assembleServices.test.js
git commit -m "feat(refresh): surface down services as synthesised cards (containers ∪ active monitors)"
```

---

### Task 4: Mobile global status dot + global-health derivation

**Files:**
- Modify: `mobile/src/data/derive.js` (add `deriveGlobalHealth`)
- Modify: `mobile/src/views/Overview.jsx` (header with the dot)
- Modify: the mobile stylesheet that defines `.mobile-view` (add the header/dot rule — locate via `grep -rl "mobile-view" mobile/src/styles`)
- Test: `mobile/src/data/derive.test.js` (add cases; create the file if absent)

**Interfaces:**
- Produces: `export function deriveGlobalHealth(servicesBody) → 'up' | 'down' | 'degraded' | 'unknown'`.
- Consumes: existing `flattenServices` from `mobile/src/data/derive.js`.

- [ ] **Step 1: Write the failing test**

```javascript
// mobile/src/data/derive.test.js  (add these; keep any existing tests in the file)
import { describe, it, expect } from 'vitest';
import { deriveGlobalHealth } from './derive.js';

describe('deriveGlobalHealth', () => {
  const body = (services) => ({ nodes: { n1: { display_name: 'N1', services } } });

  it('is "down" if any service is down', () => {
    expect(deriveGlobalHealth(body([{ status: 'up' }, { status: 'down' }]))).toBe('down');
  });
  it('is "up" when every service is up/running', () => {
    expect(deriveGlobalHealth(body([{ status: 'up' }, { status: 'running' }]))).toBe('up');
  });
  it('is "degraded" when a service is unknown but none are down', () => {
    expect(deriveGlobalHealth(body([{ status: 'up' }, { status: 'unknown' }]))).toBe('degraded');
  });
  it('is "unknown" when there are no services', () => {
    expect(deriveGlobalHealth({ nodes: {} })).toBe('unknown');
    expect(deriveGlobalHealth(null)).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx vitest run src/data/derive.test.js`
Expected: FAIL — `deriveGlobalHealth is not a function`.

- [ ] **Step 3: Add `deriveGlobalHealth` to `mobile/src/data/derive.js`**

```javascript
/**
 * Overall mobile health for the Overview status dot. Mirrors the web NavBar:
 * any service down → 'down'; else any not-up/running → 'degraded'; all up →
 * 'up'; no services → 'unknown'.
 */
export function deriveGlobalHealth(servicesBody) {
  const flat = flattenServices(servicesBody);
  if (flat.length === 0) return 'unknown';
  if (flat.some((s) => s.status === 'down')) return 'down';
  if (flat.some((s) => s.status !== 'up' && s.status !== 'running')) return 'degraded';
  return 'up';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx vitest run src/data/derive.test.js`
Expected: PASS.

- [ ] **Step 5: Add the dot to the Overview header**

In `mobile/src/views/Overview.jsx`, add the import and compute health, then replace the bare `<h1>Overview</h1>` with a header carrying the dot.

Add to the imports:
```javascript
import { deriveSubsystems, deriveIncidents, groupByNode, nodeUpDown, parseMetricPct, deriveGlobalHealth } from '../data/derive.js';
```
(This REPLACES the existing `import { deriveSubsystems, deriveIncidents, groupByNode, nodeUpDown, parseMetricPct } from '../data/derive.js';`.)

Add inside the component, after the existing `const nodes = useMemo(...)` line:
```javascript
  const health = useMemo(() => deriveGlobalHealth(servicesBody), [servicesBody]);
  const healthColor = health === 'up' ? 'var(--green)' : health === 'down' ? 'var(--red)' : 'var(--amber)';
  const healthLabel =
    health === 'up' ? 'All systems operational'
    : health === 'down' ? 'Service disruption'
    : health === 'degraded' ? 'Degraded'
    : 'No data';
```

Replace `<h1>Overview</h1>` with:
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

- [ ] **Step 6: Add the stylesheet rule**

Locate the mobile stylesheet: `grep -rl "mobile-view" mobile/src/styles` (expected: a single CSS file). Append:
```css
.overview-header { display: flex; align-items: center; gap: 8px; }
.overview-health-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
```

- [ ] **Step 7: Run mobile tests + a build smoke check**

Run: `npm run --prefix mobile test`
Expected: PASS (including the new derive cases; existing StatusDot/NodeCard tests unaffected).

Run: `cd mobile && npx vite build --config vite.config.mobile.js`
Expected: builds without error (confirms the Overview JSX change compiles).

- [ ] **Step 8: Commit**

```bash
git add mobile/src/data/derive.js mobile/src/data/derive.test.js mobile/src/views/Overview.jsx mobile/src/styles
git commit -m "feat(mobile): global status dot on Overview header"
```

---

### Task 5: Verify paused-monitor handling against live Kuma (hardening)

> Requires the live Kuma URL (in prod's compose `.env`, not the repo) — get it from Jag. This closes the §10 open item from the spec. The feature already ships safely without it (the `active !== false` read + "only synthesise `status==='down'`" are the fail-safe); this confirms a *paused* monitor can never produce a phantom outage.

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

### Task 6: Whole-branch verification

- [ ] **Step 1: Full suites green**

Run: `npm run test:all`
Expected: PASS (server + web `test:client` + mobile).

- [ ] **Step 2: Live manual verification** (against staging or prod, with confirmation before touching prod)

1. `curl -s http://192.168.68.11:3099/api/health` → `refresh: ok` (loop healthy).
2. Stop a **monitored** container on a node. Within ~30s: its card appears **red at the top of its node panel** (web + mobile), and the web header dot + mobile Overview dot go **red**.
3. **Pause** that container's Kuma monitor. Within ~30s: the card **disappears** (down → inactive transition — THE invariant).
4. Restart the container + un-pause the monitor → card returns green.

- [ ] **Step 3: Quality + security gates** (rule #5)

Run `/simplify`, then `/security-review`, on the branch diff. Address findings.

- [ ] **Step 4: Push the branch and open a PR** for Jag to review and merge (NEVER merge yourself; NEVER push `main`).

```bash
git push -u origin feat/down-service-visibility
```
Open a PR `feat/down-service-visibility → main` summarising the down-vs-inactive behavior and the manual-verification results.
