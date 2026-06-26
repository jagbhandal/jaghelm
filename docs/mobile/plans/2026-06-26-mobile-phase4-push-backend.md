# JagHelm Mobile Phase 4 — Server-Side FCM Push Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deterministic, server-side push pipeline (snapshot → differ → dispatch → FCM) plus device-token registration and per-category notification preferences, all gracefully disabled when no FCM creds are present.

**Architecture:** A pure, clock-free core (buildSnapshot, diffSnapshots, shouldDeliver) wrapped by an I/O shell (tokenStore persistence, firebase-admin send via an injectable seam, runPushCycle wired into the existing 30s background refresh). State changes across Uptime Kuma services, host reachability/metrics, UPS power, and cron produce edge-triggered events; per-token preferences filter delivery; firebase-admin is lazily used only when a service-account JSON exists.

**Tech Stack:** Node 22 (ESM), Express 4, node:test, firebase-admin (lazy/injectable), atomicWriteFileSync persistence under `data/`.

## Global Constraints
- Node 22, ESM, Express 4. Backend tests use `node:test` (`import { test } from 'node:test'; import assert from 'node:assert/strict'`), run via `node --test <file>` and the root `npm test`.
- DETERMINISM LAW: `buildSnapshot`, `diffSnapshots`, and `shouldDeliver` are PURE, CLOCK-FREE, byte-deterministic. Any clock (Date.now/lastSeenAt) or I/O lives in tokenStore / runPushCycle and is injected as a parameter in tests.
- The differ's returned event array MUST be canonically sorted by `(type, id)` and this MUST be asserted by a dedicated test (two insertion-order-different inputs → byte-identical output).
- GRACEFUL DISABLE: with no FCM creds, `initPush` leaves push disabled, `isPushEnabled()` → false, `runPushCycle` no-ops, `GET /api/push/status` → `{enabled:false}`, `POST /api/push/register` still returns `{stored:true, deliveryEnabled:false}`. Server boots and serves normally. The entire pipeline is unit-testable with NO real creds (firebase-admin reached only via an injectable `messagingFactory`).
- Desktop behavior unchanged: all push code is purely additive; no existing route or behavior changes except the additive `await runPushCycle()` inside the refresh loop and `initPush()` at boot.
- SECRETS: never commit the FCM service-account JSON. Only `fcm-service-account.json.example` is tracked. Persistence files (`data/push-tokens.json`, `data/push-snapshot.json`) live under the gitignored `data/`.
- COMMITS: conventional-commit messages, NO `Co-Authored-By` trailer (or any AI attribution).
- PRE-DONE CI GATE (durable lesson from Phase 2/3): verify via the ROOT pipeline commands — `npm test` AND `npm run lint` AND `npm run test:client` from repo root — not just `node --test server/push/...`. The root `node --test` and `eslint .` sweep the whole repo.
- OUT OF SCOPE (do NOT implement): mobile client / Capacitor push registration / Notification Settings UI (Phase 5), Mute (deferred), real FCM project creation (Jag handoff).

---


> **Build order (resolves the cross-module dependency chain):** tasks are renumbered into a single contiguous 1..36 stream in dependency order. Build the modules in this order — **snapshot (Tasks 1-5) + differ (Tasks 6-13) + tokenStore (Tasks 14-19) + fcm (Tasks 20-25)** are independent leaves; then **dispatch (Tasks 26-30)** (imports `RECOVERY_TYPES` from differ, `diffSnapshots` from differ, snapshot/tokenStore/fcm at the cycle/boot tasks); then **routes (Tasks 31-36)** (mounts the router, imports tokenStore + fcm). The refresh-loop wiring (Task 29) and boot wiring (Tasks 30/31) come last. Follow the task numbers — they already encode this order.

---

The codebase has no canonical UPS numeric-status decode and the monitor `status` strings come from Kuma (`up`/`down`) merged with container `status` (`running`/`unknown`). The contract is authoritative on normalization: anything unrecognized → "unknown". My snapshot module must therefore be defensive and normalize via explicit maps, which is exactly what the contract spec dictates.

Key grounding decisions locked for the plan:
- Services source: `getCached('services').nodes[node].services[].{ uid, status }`. Snapshot id = the `uid` (already `"NODE:ID"`). Normalize `status`: `"up"`→up, `"down"`→down, else `"unknown"` (including `"running"`, null).
- Hosts source: `getCached('services').nodes[node].metrics.{ cpu, memPercent, diskPercent }` — **strings, 0..100 percentages** → divide by 100 to 0..1 fractions; `null`/non-finite → 0. Reachability: a node present in `services.nodes` with at least one finite metric is `reachable:true`; a node whose metrics are all null/absent → `reachable:false`. (Per contract: unrecognized → `reachable:false`.)
- UPS source: `getCached('ups').status` is a **number** (raw `nut_status`). NUT canonical (per the codebase's own decoder, `src/components/Widgets.jsx`): **0=Unknown, 1=Online (OL), 2=On Battery (OB), 3=Low Battery (LB)**; null/unrecognized → unknown. Low Battery (3) folds into `on_battery` so an Online→LowBattery jump still pages — a monitor must never drop the most urgent power event. Make the numeric→state map explicit and defensive.
- Cron source: `getAllCronStatuses()` → latest run `runs[0].status` normalized (`success`/`failure`/else `unknown`).

Now drafting the TDD task blocks for `server/push/snapshot.js`.

---

### Task 1: Snapshot normalizers — service/cron status and host metric coercion

**Files:**
- Create: `server/push/snapshot.js` (new file; first ~70 lines — internal normalizer helpers + exports)
- Test: `server/push/snapshot.test.js` (new file)

**Interfaces:**
- Produces (internal, exported for unit coverage): `normalizeServiceStatus(raw) -> "up"|"down"|"unknown"`, `normalizeCronStatus(raw) -> "success"|"failure"|"unknown"`, `normalizeUpsStatus(raw) -> "online"|"on_battery"|"unknown"`, `coerceFraction(raw) -> number` (0..1; non-finite/null/out-of-range string-percent → 0).
- Consumes: nothing (PURE, clock-free). Service status strings originate from `refresh.js` (`monitor?.status || c.status || 'unknown'` → `'up'|'down'|'running'|'unknown'`). Host metrics originate from `discovery.js` as **percentage strings 0..100** (`cpu:"12.3"`, `memPercent`, `diskPercent`, possibly `null`). UPS status originates from `refresh.js` as a **raw numeric** `nut_status` (or `null`).

- [ ] **Step 1: Write failing test** — create `server/push/snapshot.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeServiceStatus,
  normalizeCronStatus,
  normalizeUpsStatus,
  coerceFraction,
} from './snapshot.js';

test('normalizeServiceStatus: up/down recognized, everything else unknown', () => {
  assert.equal(normalizeServiceStatus('up'), 'up');
  assert.equal(normalizeServiceStatus('down'), 'down');
  assert.equal(normalizeServiceStatus('UP'), 'up'); // case-insensitive
  assert.equal(normalizeServiceStatus('running'), 'unknown');
  assert.equal(normalizeServiceStatus('unknown'), 'unknown');
  assert.equal(normalizeServiceStatus(null), 'unknown');
  assert.equal(normalizeServiceStatus(undefined), 'unknown');
  assert.equal(normalizeServiceStatus(''), 'unknown');
});

test('normalizeCronStatus: success/failure recognized, else unknown', () => {
  assert.equal(normalizeCronStatus('success'), 'success');
  assert.equal(normalizeCronStatus('failure'), 'failure');
  assert.equal(normalizeCronStatus('FAILURE'), 'failure');
  assert.equal(normalizeCronStatus('pending'), 'unknown');
  assert.equal(normalizeCronStatus(null), 'unknown');
  assert.equal(normalizeCronStatus(undefined), 'unknown');
});

test('normalizeUpsStatus: numeric nut_status mapped, else unknown', () => {
  // Canonical NUT decode (matches src/components/Widgets.jsx:22):
  // 0=Unknown, 1=Online (OL), 2=On Battery (OB), 3=Low Battery (LB).
  assert.equal(normalizeUpsStatus(1), 'online'); // OL
  assert.equal(normalizeUpsStatus(2), 'on_battery'); // OB
  assert.equal(normalizeUpsStatus(0), 'unknown'); // Unknown
  assert.equal(normalizeUpsStatus(3), 'on_battery'); // Low Battery folds into on_battery
  assert.equal(normalizeUpsStatus('online'), 'online'); // string passthrough
  assert.equal(normalizeUpsStatus('on_battery'), 'on_battery');
  assert.equal(normalizeUpsStatus(7), 'unknown'); // unrecognized code
  assert.equal(normalizeUpsStatus(null), 'unknown');
  assert.equal(normalizeUpsStatus(undefined), 'unknown');
  assert.equal(normalizeUpsStatus('garbage'), 'unknown');
});

test('coerceFraction: percent-string 0..100 -> 0..1 fraction, clamped, junk -> 0', () => {
  assert.equal(coerceFraction('45.6'), 0.456);
  assert.equal(coerceFraction('100'), 1);
  assert.equal(coerceFraction('0'), 0);
  assert.equal(coerceFraction(90), 0.9); // bare number percent
  assert.equal(coerceFraction(null), 0);
  assert.equal(coerceFraction(undefined), 0);
  assert.equal(coerceFraction('NaN'), 0);
  assert.equal(coerceFraction('150'), 1); // clamp high
  assert.equal(coerceFraction('-5'), 0); // clamp low
});
```

- [ ] **Step 2: Run it — Expected: FAIL** (`Cannot find module './snapshot.js'`):
  `node --test server/push/snapshot.test.js`

- [ ] **Step 3: Minimal impl** — create `server/push/snapshot.js`:
```js
/**
 * Pure push-snapshot builder. Reads the warm in-memory caches and the cron
 * store and projects them into the canonical, byte-deterministic Snapshot
 * consumed by the differ. PURE given its injected inputs: no clock, no I/O.
 *
 * Snapshot shape (every map's keys inserted in ascending sorted order):
 *   services: "NODE:ID" -> "up" | "down" | "unknown"
 *   hosts:    "NODE"    -> { reachable, cpu, mem, disk }  (metrics 0..1 fractions)
 *   ups:      { state: "online" | "on_battery" | "unknown" }
 *   cron:     "NODE:JOB" -> "success" | "failure" | "unknown"
 *
 * Normalization law: anything unrecognized => "unknown" (services/cron),
 * "unknown" ups, or reachable:false (hosts). "unknown" never produces an event.
 */

/** Kuma/container service status -> canonical up|down|unknown. */
export function normalizeServiceStatus(raw) {
  if (typeof raw !== 'string') return 'unknown';
  const s = raw.toLowerCase();
  if (s === 'up') return 'up';
  if (s === 'down') return 'down';
  return 'unknown';
}

/** Cron run status -> canonical success|failure|unknown. */
export function normalizeCronStatus(raw) {
  if (typeof raw !== 'string') return 'unknown';
  const s = raw.toLowerCase();
  if (s === 'success') return 'success';
  if (s === 'failure') return 'failure';
  return 'unknown';
}

// nut_status (Prometheus, per src/components/Widgets.jsx): 0=Unknown, 1=Online(OL),
// 2=On Battery(OB), 3=Low Battery(LB). LB folds into on_battery so an Online->LowBattery
// jump still pages — a monitor must never drop the most urgent power event.
const UPS_NUMERIC = new Map([
  [1, 'online'],
  [2, 'on_battery'],
  [3, 'on_battery'],
]);

/** UPS status (raw nut_status numeric, or a canonical string) -> canonical state. */
export function normalizeUpsStatus(raw) {
  if (typeof raw === 'string') {
    const s = raw.toLowerCase();
    if (s === 'online') return 'online';
    if (s === 'on_battery') return 'on_battery';
    return 'unknown';
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return UPS_NUMERIC.get(raw) ?? 'unknown';
  }
  return 'unknown';
}

/**
 * Coerce a host metric (percentage string "0".."100" or bare number) into a
 * 0..1 fraction, clamped. Non-finite / null / junk => 0.
 */
export function coerceFraction(raw) {
  const n = typeof raw === 'number' ? raw : parseFloat(raw);
  if (!Number.isFinite(n)) return 0;
  const frac = n / 100;
  if (frac < 0) return 0;
  if (frac > 1) return 1;
  return frac;
}
```

- [ ] **Step 4: Run it — Expected: PASS**:
  `node --test server/push/snapshot.test.js`

- [ ] **Step 5: Commit**:
  `git add server/push/snapshot.js server/push/snapshot.test.js && git commit -m "feat(push): add pure snapshot normalizers for service/cron/ups/host metrics"`

---

### Task 2: buildServices + buildCron — canonical sorted "NODE:ID" maps

**Files:**
- Modify: `server/push/snapshot.js` (add `buildServices(servicesCache)` and `buildCron(cronStatuses)` after the normalizers, ~line 70+)
- Test: `server/push/snapshot.test.js` (append tests)

**Interfaces:**
- Produces: `buildServices(servicesCache) -> { "NODE:ID": "up"|"down"|"unknown" }` (keys ascending-sorted), `buildCron(cronStatuses) -> { "NODE:JOB": "success"|"failure"|"unknown" }` (keys ascending-sorted).
- Consumes: `servicesCache` = the `getCached('services')` value `{ nodes: { [node]: { services: [{ uid, status }] } } }` (uid already `"NODE:ID"`); `cronStatuses` = `getAllStatuses()` value `[{ node, jobs: [{ job, runs: [{ status }] }] }]` (latest run is `runs[0]`).

- [ ] **Step 1: Write failing test** — append to `server/push/snapshot.test.js`:
```js
import { buildServices, buildCron } from './snapshot.js';

test('buildServices: flattens nodes->services to NODE:ID map, sorted, normalized', () => {
  const cache = {
    nodes: {
      vm103: {
        services: [
          { uid: 'vm103:zoo', status: 'up' },
          { uid: 'vm103:abc', status: 'down' },
        ],
      },
      pi2: {
        services: [{ uid: 'pi2:ntp', status: 'running' }], // unrecognized -> unknown
      },
    },
  };
  const out = buildServices(cache);
  assert.deepEqual(out, {
    'pi2:ntp': 'unknown',
    'vm103:abc': 'down',
    'vm103:zoo': 'up',
  });
  // canonical ascending key order
  assert.deepEqual(Object.keys(out), ['pi2:ntp', 'vm103:abc', 'vm103:zoo']);
});

test('buildServices: missing/empty cache -> empty map', () => {
  assert.deepEqual(buildServices(null), {});
  assert.deepEqual(buildServices({}), {});
  assert.deepEqual(buildServices({ nodes: {} }), {});
  assert.deepEqual(buildServices({ nodes: { pi: {} } }), {});
});

test('buildServices: byte-identical regardless of insertion order', () => {
  const a = { nodes: { pi: { services: [{ uid: 'pi:b', status: 'up' }, { uid: 'pi:a', status: 'down' }] } } };
  const b = { nodes: { pi: { services: [{ uid: 'pi:a', status: 'down' }, { uid: 'pi:b', status: 'up' }] } } };
  assert.equal(JSON.stringify(buildServices(a)), JSON.stringify(buildServices(b)));
});

test('buildCron: latest run per NODE:JOB, sorted, normalized', () => {
  const statuses = [
    {
      node: 'vm103',
      jobs: [
        { job: 'sync', runs: [{ status: 'failure' }, { status: 'success' }] }, // latest = failure
        { job: 'backup', runs: [{ status: 'success' }] },
      ],
    },
    { node: 'pi2', jobs: [{ job: 'prune', runs: [{ status: 'weird' }] }] }, // -> unknown
  ];
  const out = buildCron(statuses);
  assert.deepEqual(out, {
    'pi2:prune': 'unknown',
    'vm103:backup': 'success',
    'vm103:sync': 'failure',
  });
  assert.deepEqual(Object.keys(out), ['pi2:prune', 'vm103:backup', 'vm103:sync']);
});

test('buildCron: empty runs / empty input -> unknown or empty map', () => {
  assert.deepEqual(buildCron([]), {});
  assert.deepEqual(buildCron(null), {});
  assert.deepEqual(buildCron([{ node: 'pi', jobs: [{ job: 'j', runs: [] }] }]), { 'pi:j': 'unknown' });
});
```

- [ ] **Step 2: Run it — Expected: FAIL** (`buildServices is not a function` / not exported):
  `node --test server/push/snapshot.test.js`

- [ ] **Step 3: Minimal impl** — append to `server/push/snapshot.js`:
```js
/** Build the sorted ascending object from entries [key, value]. */
function sortedObject(entries) {
  const out = {};
  for (const [k, v] of entries.sort(([a], [b]) => a.localeCompare(b))) {
    out[k] = v;
  }
  return out;
}

/**
 * Project the cached /api/services payload into the snapshot services map.
 * Keys are the per-service `uid` ("NODE:ID"); values are normalized statuses.
 */
export function buildServices(servicesCache) {
  const nodes = servicesCache?.nodes;
  if (!nodes || typeof nodes !== 'object') return {};
  const entries = [];
  for (const node of Object.values(nodes)) {
    const services = node?.services;
    if (!Array.isArray(services)) continue;
    for (const svc of services) {
      if (!svc || typeof svc.uid !== 'string') continue;
      entries.push([svc.uid, normalizeServiceStatus(svc.status)]);
    }
  }
  return sortedObject(entries);
}

/**
 * Project getAllStatuses() into the snapshot cron map. Key is "NODE:JOB";
 * value is the latest run's normalized status (runs[0]; missing -> unknown).
 */
export function buildCron(cronStatuses) {
  if (!Array.isArray(cronStatuses)) return {};
  const entries = [];
  for (const nodeEntry of cronStatuses) {
    const node = nodeEntry?.node;
    const jobs = nodeEntry?.jobs;
    if (typeof node !== 'string' || !Array.isArray(jobs)) continue;
    for (const jobEntry of jobs) {
      const job = jobEntry?.job;
      if (typeof job !== 'string') continue;
      const latest = Array.isArray(jobEntry.runs) ? jobEntry.runs[0] : null;
      entries.push([`${node}:${job}`, normalizeCronStatus(latest?.status)]);
    }
  }
  return sortedObject(entries);
}
```

- [ ] **Step 4: Run it — Expected: PASS**:
  `node --test server/push/snapshot.test.js`

- [ ] **Step 5: Commit**:
  `git add server/push/snapshot.js server/push/snapshot.test.js && git commit -m "feat(push): build canonical sorted service + cron snapshot maps"`

---

### Task 3: buildHosts + buildUps — host metric fractions and UPS state

**Files:**
- Modify: `server/push/snapshot.js` (add `buildHosts(servicesCache)` and `buildUps(upsCache)`)
- Test: `server/push/snapshot.test.js` (append tests)

**Interfaces:**
- Produces: `buildHosts(servicesCache) -> { "NODE": { reachable: bool, cpu: number, mem: number, disk: number } }` (keys ascending-sorted; metrics 0..1 fractions), `buildUps(upsCache) -> { state: "online"|"on_battery"|"unknown" }`.
- Consumes: `servicesCache.nodes[node].metrics` = `{ cpu, memPercent, diskPercent }` (percentage **strings** 0..100 or `null` from `discovery.js`); `upsCache` = `getCached('ups')` value `{ status, charge, runtime, load }` where `status` is a raw numeric (or null). Reachability: a node with at least one finite metric is `reachable:true`; all-null/absent metrics → `reachable:false`.

- [ ] **Step 1: Write failing test** — append to `server/push/snapshot.test.js`:
```js
import { buildHosts, buildUps } from './snapshot.js';

test('buildHosts: percent-string metrics -> 0..1 fractions, reachable, sorted', () => {
  const cache = {
    nodes: {
      vm103: { metrics: { cpu: '12.0', memPercent: '45.0', diskPercent: '78.0' } },
      pi2: { metrics: { cpu: '90.0', memPercent: '90.0', diskPercent: '5.0' } },
    },
  };
  const out = buildHosts(cache);
  assert.deepEqual(out, {
    pi2: { reachable: true, cpu: 0.9, mem: 0.9, disk: 0.05 },
    vm103: { reachable: true, cpu: 0.12, mem: 0.45, disk: 0.78 },
  });
  assert.deepEqual(Object.keys(out), ['pi2', 'vm103']);
});

test('buildHosts: all-null metrics -> reachable:false, zeroed; partial -> reachable:true', () => {
  const cache = {
    nodes: {
      dead: { metrics: { cpu: null, memPercent: null, diskPercent: null } },
      half: { metrics: { cpu: '50.0', memPercent: null, diskPercent: null } },
      bare: {}, // no metrics key at all
    },
  };
  const out = buildHosts(cache);
  assert.deepEqual(out.dead, { reachable: false, cpu: 0, mem: 0, disk: 0 });
  assert.deepEqual(out.half, { reachable: true, cpu: 0.5, mem: 0, disk: 0 });
  assert.deepEqual(out.bare, { reachable: false, cpu: 0, mem: 0, disk: 0 });
});

test('buildHosts: missing cache -> empty map', () => {
  assert.deepEqual(buildHosts(null), {});
  assert.deepEqual(buildHosts({ nodes: {} }), {});
});

test('buildUps: numeric status mapped to state; missing -> unknown', () => {
  assert.deepEqual(buildUps({ status: 1 }), { state: 'online' });       // OL
  assert.deepEqual(buildUps({ status: 2 }), { state: 'on_battery' });   // OB
  assert.deepEqual(buildUps({ status: 0 }), { state: 'unknown' });      // Unknown
  assert.deepEqual(buildUps({ status: 3 }), { state: 'unknown' });      // Low Battery
  assert.deepEqual(buildUps({ status: 9 }), { state: 'unknown' });
  assert.deepEqual(buildUps({ status: null }), { state: 'unknown' });
  assert.deepEqual(buildUps(null), { state: 'unknown' });
  assert.deepEqual(buildUps({}), { state: 'unknown' });
});
```

- [ ] **Step 2: Run it — Expected: FAIL** (`buildHosts is not a function`):
  `node --test server/push/snapshot.test.js`

- [ ] **Step 3: Minimal impl** — append to `server/push/snapshot.js`:
```js
/**
 * Project the cached /api/services node metrics into the snapshot hosts map.
 * A node is `reachable` iff at least one of its three metrics parses finite;
 * an all-null/absent-metrics node is treated as unreachable (per the
 * normalization law). Metrics are 0..1 fractions.
 */
export function buildHosts(servicesCache) {
  const nodes = servicesCache?.nodes;
  if (!nodes || typeof nodes !== 'object') return {};
  const entries = [];
  for (const [node, data] of Object.entries(nodes)) {
    const m = data?.metrics || {};
    const hasMetric = (v) => Number.isFinite(typeof v === 'number' ? v : parseFloat(v));
    const reachable = hasMetric(m.cpu) || hasMetric(m.memPercent) || hasMetric(m.diskPercent);
    entries.push([
      node,
      {
        reachable,
        cpu: coerceFraction(m.cpu),
        mem: coerceFraction(m.memPercent),
        disk: coerceFraction(m.diskPercent),
      },
    ]);
  }
  return sortedObject(entries);
}

/** Project the cached UPS payload into the snapshot ups state. */
export function buildUps(upsCache) {
  return { state: normalizeUpsStatus(upsCache?.status) };
}
```

- [ ] **Step 4: Run it — Expected: PASS**:
  `node --test server/push/snapshot.test.js`

- [ ] **Step 5: Commit**:
  `git add server/push/snapshot.js server/push/snapshot.test.js && git commit -m "feat(push): build host-metric fraction map and ups state for snapshot"`

---

### Task 4: buildSnapshot(caches) — composed PURE snapshot via injectable seam

**Files:**
- Modify: `server/push/snapshot.js` (add the top-level `buildSnapshot(caches)` export + a `_defaultCaches` seam that reads `server/cache.js` + `server/cron-store.js`)
- Test: `server/push/snapshot.test.js` (append tests)

**Interfaces:**
- Produces: `buildSnapshot(caches) -> Snapshot` (4 keys `{ services, hosts, ups, cron }`, each sub-map ascending-sorted; PURE given injected `caches`).
- Consumes: `caches = { getCached, getAllCronStatuses }` — `getCached(key)` returns the warm cache value for `"services"`/`"ups"` (matches `server/cache.js` accessor); `getAllCronStatuses()` returns `getAllStatuses()` (matches `server/cron-store.js`). When called with no arg, falls back to the real `getCached` from `server/cache.js` and `getAllStatuses` from `server/cron-store.js` (thin seam so production wiring needs no params; tests always inject fakes — no real polling).

- [ ] **Step 1: Write failing test** — append to `server/push/snapshot.test.js`:
```js
import { buildSnapshot } from './snapshot.js';

function fakeCaches({ services, ups, cron }) {
  return {
    getCached: (key) => (key === 'services' ? services : key === 'ups' ? ups : null),
    getAllCronStatuses: () => cron ?? [],
  };
}

test('buildSnapshot: composes all four sub-maps from injected caches', () => {
  const caches = fakeCaches({
    services: {
      nodes: {
        vm103: {
          metrics: { cpu: '20.0', memPercent: '30.0', diskPercent: '40.0' },
          services: [{ uid: 'vm103:db', status: 'up' }, { uid: 'vm103:web', status: 'down' }],
        },
      },
    },
    ups: { status: 2 }, // 2 = On Battery (OB) per the NUT decode
    cron: [{ node: 'vm103', jobs: [{ job: 'backup', runs: [{ status: 'failure' }] }] }],
  });
  const snap = buildSnapshot(caches);
  assert.deepEqual(snap, {
    services: { 'vm103:db': 'up', 'vm103:web': 'down' },
    hosts: { vm103: { reachable: true, cpu: 0.2, mem: 0.3, disk: 0.4 } },
    ups: { state: 'on_battery' },
    cron: { 'vm103:backup': 'failure' },
  });
});

test('buildSnapshot: top-level keys are exactly the four, in fixed order', () => {
  const snap = buildSnapshot(fakeCaches({ services: null, ups: null, cron: [] }));
  assert.deepEqual(Object.keys(snap), ['services', 'hosts', 'ups', 'cron']);
  assert.deepEqual(snap, {
    services: {},
    hosts: {},
    ups: { state: 'unknown' },
    cron: {},
  });
});

test('buildSnapshot: PURE — same input twice is byte-identical', () => {
  const caches = fakeCaches({
    services: { nodes: { b: { services: [{ uid: 'b:y', status: 'up' }] }, a: { services: [{ uid: 'a:x', status: 'down' }] } } },
    ups: { status: 1 }, // 1 = Online (OL)
    cron: [{ node: 'b', jobs: [{ job: 'j', runs: [{ status: 'success' }] }] }],
  });
  assert.equal(JSON.stringify(buildSnapshot(caches)), JSON.stringify(buildSnapshot(caches)));
});
```

- [ ] **Step 2: Run it — Expected: FAIL** (`buildSnapshot is not a function`):
  `node --test server/push/snapshot.test.js`

- [ ] **Step 3: Minimal impl** — add imports at the TOP of `server/push/snapshot.js` (after the file header comment) and the composed export at the bottom:
```js
// At top of file (after header comment), for the default production seam only.
// Tests NEVER hit this path — they inject `caches`.
import { getCached } from '../cache.js';
import { getAllStatuses } from '../cron-store.js';
```
```js
// Default seam: real warm caches + cron store. Kept thin so production wiring
// is parameterless; every test injects fakes instead.
const _defaultCaches = {
  getCached,
  getAllCronStatuses: getAllStatuses,
};

/**
 * Build the canonical, byte-deterministic Snapshot from the warm caches.
 * PURE given its injected `caches`. The four top-level keys are emitted in a
 * fixed order; every sub-map is ascending-sorted by key.
 *
 * @param {{ getCached: (key: string) => *, getAllCronStatuses: () => * }} [caches]
 */
export function buildSnapshot(caches = _defaultCaches) {
  const servicesCache = caches.getCached('services');
  const upsCache = caches.getCached('ups');
  const cronStatuses = caches.getAllCronStatuses();
  return {
    services: buildServices(servicesCache),
    hosts: buildHosts(servicesCache),
    ups: buildUps(upsCache),
    cron: buildCron(cronStatuses),
  };
}
```

- [ ] **Step 4: Run it — Expected: PASS**:
  `node --test server/push/snapshot.test.js`

- [ ] **Step 5: Commit**:
  `git add server/push/snapshot.js server/push/snapshot.test.js && git commit -m "feat(push): compose buildSnapshot from injectable cache seam"`

---

### Task 5: Determinism + normalization-law guard tests (no new code)

**Files:**
- Test: `server/push/snapshot.test.js` (append hardening tests only — proves the contract's determinism law and "unrecognized → unknown / reachable:false" law hold across the whole module; no production code change expected)

**Interfaces:**
- Consumes/Produces: same `buildSnapshot` signature; this task is pure assertion coverage to lock the DETERMINISM LAW and the normalization law against regression.

- [ ] **Step 1: Write the guard tests** — append to `server/push/snapshot.test.js`:
```js
test('LAW: top-level snapshot is byte-identical under reordered node/service/cron insertion', () => {
  const mk = (order) => fakeCaches({
    services: {
      nodes: order === 'fwd'
        ? { alpha: { metrics: { cpu: '10.0', memPercent: '10.0', diskPercent: '10.0' }, services: [{ uid: 'alpha:s2', status: 'down' }, { uid: 'alpha:s1', status: 'up' }] },
            beta: { metrics: { cpu: '20.0', memPercent: '20.0', diskPercent: '20.0' }, services: [{ uid: 'beta:s1', status: 'up' }] } }
        : { beta: { metrics: { cpu: '20.0', memPercent: '20.0', diskPercent: '20.0' }, services: [{ uid: 'beta:s1', status: 'up' }] },
            alpha: { metrics: { cpu: '10.0', memPercent: '10.0', diskPercent: '10.0' }, services: [{ uid: 'alpha:s1', status: 'up' }, { uid: 'alpha:s2', status: 'down' }] } },
    },
    ups: { status: 1 }, // Online (OL)
    cron: order === 'fwd'
      ? [{ node: 'alpha', jobs: [{ job: 'b', runs: [{ status: 'success' }] }, { job: 'a', runs: [{ status: 'failure' }] }] }]
      : [{ node: 'alpha', jobs: [{ job: 'a', runs: [{ status: 'failure' }] }, { job: 'b', runs: [{ status: 'success' }] }] }],
  });
  assert.equal(JSON.stringify(buildSnapshot(mk('fwd'))), JSON.stringify(buildSnapshot(mk('rev'))));
});

test('LAW: every unrecognized value collapses to unknown / reachable:false', () => {
  const snap = buildSnapshot(fakeCaches({
    services: {
      nodes: {
        ghost: { metrics: { cpu: 'NaN', memPercent: null, diskPercent: undefined },
                 services: [{ uid: 'ghost:x', status: 'flapping' }] },
      },
    },
    ups: { status: 'bogus' },
    cron: [{ node: 'ghost', jobs: [{ job: 'j', runs: [{ status: 'maybe' }] }] }],
  }));
  assert.equal(snap.services['ghost:x'], 'unknown');
  assert.equal(snap.cron['ghost:j'], 'unknown');
  assert.equal(snap.ups.state, 'unknown');
  assert.deepEqual(snap.hosts.ghost, { reachable: false, cpu: 0, mem: 0, disk: 0 });
});

test('LAW: empty/cold caches yield a well-formed baseline snapshot', () => {
  const snap = buildSnapshot(fakeCaches({ services: null, ups: null, cron: null }));
  assert.deepEqual(snap, { services: {}, hosts: {}, ups: { state: 'unknown' }, cron: {} });
});
```

- [ ] **Step 2: Run it — Expected: PASS** (locks the laws; if any FAIL, fix the offending builder, then re-run):
  `node --test server/push/snapshot.test.js`

- [ ] **Step 3: Run the full backend suite to confirm no regression — Expected: PASS**:
  `npm test`

- [ ] **Step 4: Commit**:
  `git add server/push/snapshot.test.js && git commit -m "test(push): lock snapshot determinism + unrecognized-to-unknown laws"`


---

I have everything needed: ESM, `import { test } from 'node:test'`, `import assert from 'node:assert/strict'`, relative `./` imports within `server/push/`, `npm test` runs `node --test --test-force-exit`. The differ is pure with no I/O so no atomicWrite needed here. Now drafting the tasks.

### Task 6: Scaffold `differ.js` with SEVERITY map, RECOVERY_TYPES set, and the baseline contract

**Files:**
- Create: `server/push/differ.js`
- Test: `server/push/differ.test.js`

**Interfaces:**
- Produces: `diffSnapshots(prev, next, thresholds) -> Event[]` (PURE, clock-free, no I/O). `prev` may be `null` (baseline). Exports `RECOVERY_TYPES` (Set) and `SEVERITY` (map of `type -> "critical"|"warning"|"info"`).
- Consumes: a `Snapshot` = `{ services, hosts, ups, cron }` (per CONTRACT SNAPSHOT SHAPE) and `thresholds = { cpu, mem, disk, hysteresis }`.
- `Event` = `{ type, id, node, title, body, severity, prev, next }`.

Steps:

- [ ] **Step 1: Write failing test for module surface + baseline.** Create `server/push/differ.test.js`:
  ```js
  import { test } from 'node:test';
  import assert from 'node:assert/strict';

  import { diffSnapshots, RECOVERY_TYPES, SEVERITY } from './differ.js';

  const EMPTY = { services: {}, hosts: {}, ups: { state: 'unknown' }, cron: {} };
  const THRESHOLDS = { cpu: 0.9, mem: 0.9, disk: 0.9, hysteresis: 0.05 };

  test('exports SEVERITY map covering all event types', () => {
    assert.equal(SEVERITY.service_down, 'critical');
    assert.equal(SEVERITY.service_recovered, 'info');
    assert.equal(SEVERITY.host_unreachable, 'critical');
    assert.equal(SEVERITY.host_recovered, 'info');
    assert.equal(SEVERITY.host_threshold, 'warning');
    assert.equal(SEVERITY.host_threshold_cleared, 'info');
    assert.equal(SEVERITY.ups_on_battery, 'critical');
    assert.equal(SEVERITY.ups_restored, 'info');
    assert.equal(SEVERITY.cron_failed, 'warning');
    assert.equal(SEVERITY.cron_recovered, 'info');
  });

  test('RECOVERY_TYPES is exactly the info-severity types', () => {
    assert.ok(RECOVERY_TYPES instanceof Set);
    const expected = [
      'service_recovered',
      'host_recovered',
      'host_threshold_cleared',
      'ups_restored',
      'cron_recovered',
    ].sort();
    assert.deepEqual([...RECOVERY_TYPES].sort(), expected);
    for (const [type, sev] of Object.entries(SEVERITY)) {
      assert.equal(RECOVERY_TYPES.has(type), sev === 'info');
    }
  });

  test('baseline: prev=null returns [] regardless of next', () => {
    assert.deepEqual(diffSnapshots(null, EMPTY, THRESHOLDS), []);
    const populated = {
      services: { 'n1:web': 'down' },
      hosts: { n1: { reachable: false, cpu: 0.99, mem: 0.99, disk: 0.99 } },
      ups: { state: 'on_battery' },
      cron: { 'n1:backup': 'failure' },
    };
    assert.deepEqual(diffSnapshots(null, populated, THRESHOLDS), []);
  });

  test('no change: identical prev/next returns []', () => {
    const snap = {
      services: { 'n1:web': 'up' },
      hosts: { n1: { reachable: true, cpu: 0.1, mem: 0.1, disk: 0.1 } },
      ups: { state: 'online' },
      cron: { 'n1:backup': 'success' },
    };
    assert.deepEqual(diffSnapshots(snap, snap, THRESHOLDS), []);
  });
  ```
- [ ] **Step 2: Run it — Expected: FAIL** (module does not exist).
  `node --test server/push/differ.test.js`
- [ ] **Step 3: Minimal impl — create the module skeleton.** Create `server/push/differ.js`:
  ```js
  /**
   * Pure incident differ — the determinism centerpiece of the push pipeline.
   *
   * diffSnapshots(prev, next, thresholds) compares two normalized snapshots and
   * returns a canonically-sorted, byte-deterministic array of incident events.
   * It is PURE and CLOCK-FREE: no Date.now, no I/O, no module-level mutable
   * state. Same input => same output, same order, every time. All clock/I/O
   * (tokenStore, runPushCycle) lives OUTSIDE this file.
   *
   * "unknown" (services/cron) and reachable:false-from-absent are normalized
   * upstream in buildSnapshot; here "unknown" NEVER produces an event, and the
   * first cycle (prev=null) is a silent baseline.
   */

  /** event.type -> severity. */
  export const SEVERITY = {
    service_down: 'critical',
    service_recovered: 'info',
    host_unreachable: 'critical',
    host_recovered: 'info',
    host_threshold: 'warning',
    host_threshold_cleared: 'info',
    ups_on_battery: 'critical',
    ups_restored: 'info',
    cron_failed: 'warning',
    cron_recovered: 'info',
  };

  /** Recovery/info types — equivalent to severity==="info", exported explicitly. */
  export const RECOVERY_TYPES = new Set(
    Object.keys(SEVERITY).filter((type) => SEVERITY[type] === 'info'),
  );

  export function diffSnapshots(prev, next, thresholds) {
    // Baseline: first cycle has no prior state, so nothing has "changed" yet.
    if (prev === null || prev === undefined) return [];
    const events = [];
    // (transition detection added in subsequent tasks)
    return sortEvents(events);
  }

  /**
   * Canonical sort: ascending by (type, id) via string compare, id as tiebreak.
   * Guarantees two logically-equivalent inputs in different insertion order
   * produce a byte-identical event array.
   */
  function sortEvents(events) {
    return events.sort((a, b) => {
      const t = a.type < b.type ? -1 : a.type > b.type ? 1 : 0;
      if (t !== 0) return t;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  }
  ```
- [ ] **Step 4: Run it — Expected: PASS.**
  `node --test server/push/differ.test.js`
- [ ] **Step 5: Commit.**
  `git add server/push/differ.js server/push/differ.test.js && git commit -m "feat(push): scaffold pure diffSnapshots with SEVERITY map and baseline"`

---

### Task 7: Service transitions — `service_down` / `service_recovered`

**Files:**
- Modify: `server/push/differ.js` (`diffSnapshots`, add `diffServices` helper; line ref: extend the body before `sortEvents`)
- Test: `server/push/differ.test.js`

**Interfaces:**
- Consumes: `snapshot.services` = map `"NODE:ID" -> "up"|"down"|"unknown"`.
- Produces: events `{ type: "service_down"|"service_recovered", id, node, title, body, severity, prev, next }`. `id` = the full `"NODE:ID"` key, `node` = the `NODE` portion (substring before first `:`).
- Transition: `up`/`unknown` -> `down` = `service_down` (critical); `down` -> `up` = `service_recovered` (info). `unknown` target NEVER emits.

Steps:

- [ ] **Step 1: Write failing tests.** Append to `server/push/differ.test.js`:
  ```js
  function svc(map) {
    return { services: map, hosts: {}, ups: { state: 'unknown' }, cron: {} };
  }

  test('service up->down emits service_down(critical)', () => {
    const prev = svc({ 'n1:web': 'up' });
    const next = svc({ 'n1:web': 'down' });
    const events = diffSnapshots(prev, next, THRESHOLDS);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], {
      type: 'service_down',
      id: 'n1:web',
      node: 'n1',
      title: 'Service down',
      body: 'web on n1 is down',
      severity: 'critical',
      prev: 'up',
      next: 'down',
    });
  });

  test('service unknown->down emits service_down', () => {
    const events = diffSnapshots(svc({ 'n1:web': 'unknown' }), svc({ 'n1:web': 'down' }), THRESHOLDS);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'service_down');
    assert.equal(events[0].prev, 'unknown');
  });

  test('service down->up emits service_recovered(info)', () => {
    const events = diffSnapshots(svc({ 'n1:web': 'down' }), svc({ 'n1:web': 'up' }), THRESHOLDS);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], {
      type: 'service_recovered',
      id: 'n1:web',
      node: 'n1',
      title: 'Service recovered',
      body: 'web on n1 is back up',
      severity: 'info',
      prev: 'down',
      next: 'up',
    });
  });

  test('service down->unknown emits nothing (unknown never emits)', () => {
    assert.deepEqual(diffSnapshots(svc({ 'n1:web': 'down' }), svc({ 'n1:web': 'unknown' }), THRESHOLDS), []);
  });

  test('service up->up and down->down emit nothing', () => {
    assert.deepEqual(diffSnapshots(svc({ 'n1:web': 'up' }), svc({ 'n1:web': 'up' }), THRESHOLDS), []);
    assert.deepEqual(diffSnapshots(svc({ 'n1:web': 'down' }), svc({ 'n1:web': 'down' }), THRESHOLDS), []);
  });

  test('service new key in next (no prev entry) treated as prev=unknown', () => {
    // absent in prev => undefined => treated as "unknown"; unknown->down emits
    const events = diffSnapshots(svc({}), svc({ 'n1:web': 'down' }), THRESHOLDS);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'service_down');
    assert.equal(events[0].prev, 'unknown');
  });
  ```
- [ ] **Step 2: Run it — Expected: FAIL** (no service diffing yet; events array empty).
  `node --test server/push/differ.test.js`
- [ ] **Step 3: Minimal impl.** In `server/push/differ.js`, wire `diffServices` into `diffSnapshots` and add the helper. Replace the body of `diffSnapshots`:
  ```js
  export function diffSnapshots(prev, next, thresholds) {
    if (prev === null || prev === undefined) return [];
    const events = [];
    diffServices(prev.services || {}, next.services || {}, events);
    return sortEvents(events);
  }

  /** "NODE:ID" -> the NODE portion (substring before the first colon). */
  function nodeOf(key) {
    const i = key.indexOf(':');
    return i === -1 ? key : key.slice(0, i);
  }

  /** "NODE:ID" -> the ID portion (substring after the first colon). */
  function idPart(key) {
    const i = key.indexOf(':');
    return i === -1 ? key : key.slice(i + 1);
  }

  function diffServices(prev, next, events) {
    for (const key of Object.keys(next)) {
      const before = prev[key] === undefined ? 'unknown' : prev[key];
      const after = next[key];
      if (after === 'unknown') continue; // unknown never emits
      const wentDown = (before === 'up' || before === 'unknown') && after === 'down';
      const recovered = before === 'down' && after === 'up';
      if (wentDown) {
        events.push({
          type: 'service_down',
          id: key,
          node: nodeOf(key),
          title: 'Service down',
          body: `${idPart(key)} on ${nodeOf(key)} is down`,
          severity: SEVERITY.service_down,
          prev: before,
          next: after,
        });
      } else if (recovered) {
        events.push({
          type: 'service_recovered',
          id: key,
          node: nodeOf(key),
          title: 'Service recovered',
          body: `${idPart(key)} on ${nodeOf(key)} is back up`,
          severity: SEVERITY.service_recovered,
          prev: before,
          next: after,
        });
      }
    }
  }
  ```
- [ ] **Step 4: Run it — Expected: PASS.**
  `node --test server/push/differ.test.js`
- [ ] **Step 5: Commit.**
  `git add server/push/differ.js server/push/differ.test.js && git commit -m "feat(push): diff service_down/service_recovered transitions"`

---

### Task 8: Host reachability transitions — `host_unreachable` / `host_recovered`

**Files:**
- Modify: `server/push/differ.js` (add `diffHosts` reachability branch; wire into `diffSnapshots`)
- Test: `server/push/differ.test.js`

**Interfaces:**
- Consumes: `snapshot.hosts` = map `"NODE" -> { reachable: bool, cpu, mem, disk }`. Absent host => treated as `reachable: false` baseline (normalized upstream; defend here too).
- Produces: `{ type: "host_unreachable"|"host_recovered", id: NODE, node: NODE, ... }`. `id` and `node` are both the NODE key.
- Transition: reachable `true -> false` = `host_unreachable` (critical); `false -> true` = `host_recovered` (info).

Steps:

- [ ] **Step 1: Write failing tests.** Append:
  ```js
  function host(map) {
    return { services: {}, hosts: map, ups: { state: 'unknown' }, cron: {} };
  }
  const OK = { reachable: true, cpu: 0.1, mem: 0.1, disk: 0.1 };
  const DOWN = { reachable: false, cpu: 0, mem: 0, disk: 0 };

  test('host reachable true->false emits host_unreachable(critical)', () => {
    const events = diffSnapshots(host({ n1: OK }), host({ n1: DOWN }), THRESHOLDS);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], {
      type: 'host_unreachable',
      id: 'n1',
      node: 'n1',
      title: 'Host unreachable',
      body: 'n1 is unreachable',
      severity: 'critical',
      prev: true,
      next: false,
    });
  });

  test('host reachable false->true emits host_recovered(info)', () => {
    const events = diffSnapshots(host({ n1: DOWN }), host({ n1: OK }), THRESHOLDS);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], {
      type: 'host_recovered',
      id: 'n1',
      node: 'n1',
      title: 'Host recovered',
      body: 'n1 is reachable again',
      severity: 'info',
      prev: false,
      next: true,
    });
  });

  test('host reachable unchanged emits nothing', () => {
    assert.deepEqual(diffSnapshots(host({ n1: OK }), host({ n1: OK }), THRESHOLDS), []);
    assert.deepEqual(diffSnapshots(host({ n1: DOWN }), host({ n1: DOWN }), THRESHOLDS), []);
  });

  test('host absent in prev defaults to reachable:false (no false unreachable)', () => {
    // prev missing host => reachable:false; next OK => false->true => host_recovered
    const events = diffSnapshots(host({}), host({ n1: OK }), THRESHOLDS);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'host_recovered');
  });
  ```
- [ ] **Step 2: Run it — Expected: FAIL.**
  `node --test server/push/differ.test.js`
- [ ] **Step 3: Minimal impl.** Wire `diffHosts` into `diffSnapshots`:
  ```js
    diffServices(prev.services || {}, next.services || {}, events);
    diffHosts(prev.hosts || {}, next.hosts || {}, thresholds, events);
  ```
  Add the helper (reachability branch only; metrics added in Task 9):
  ```js
  function diffHosts(prev, next, thresholds, events) {
    for (const node of Object.keys(next)) {
      const before = prev[node] || { reachable: false };
      const after = next[node];
      const beforeReach = before.reachable === true;
      const afterReach = after.reachable === true;
      if (beforeReach && !afterReach) {
        events.push({
          type: 'host_unreachable',
          id: node,
          node,
          title: 'Host unreachable',
          body: `${node} is unreachable`,
          severity: SEVERITY.host_unreachable,
          prev: true,
          next: false,
        });
        continue; // unreachable supersedes metric crossings this cycle
      }
      if (!beforeReach && afterReach) {
        events.push({
          type: 'host_recovered',
          id: node,
          node,
          title: 'Host recovered',
          body: `${node} is reachable again`,
          severity: SEVERITY.host_recovered,
          prev: false,
          next: true,
        });
      }
    }
  }
  ```
- [ ] **Step 4: Run it — Expected: PASS.**
  `node --test server/push/differ.test.js`
- [ ] **Step 5: Commit.**
  `git add server/push/differ.js server/push/differ.test.js && git commit -m "feat(push): diff host reachability transitions"`

---

### Task 9: Host metric thresholds with hysteresis — `host_threshold` / `host_threshold_cleared`

**Files:**
- Modify: `server/push/differ.js` (extend `diffHosts` with per-metric crossing logic + `metricThreshold` lookup)
- Test: `server/push/differ.test.js`

**Interfaces:**
- Consumes: `thresholds = { cpu, mem, disk, hysteresis }`; host metrics are `0..1` fractions on `{ cpu, mem, disk }`.
- Produces: `{ type: "host_threshold", id: "NODE:METRIC", node: NODE, ... severity: warning }` on rising cross; `{ type: "host_threshold_cleared", ... severity: info }` on falling clear. The `id` is `"NODE:METRIC"` (e.g. `"n1:cpu"`) so multiple metrics on one host are distinct events.
- Transition: metric crosses `>= threshold` (was below) = `host_threshold` (warning); falls below `(threshold - hysteresis)` = `host_threshold_cleared` (info). Staying in the band `[threshold - hysteresis, threshold)` emits nothing. Only evaluated when both prev and next are reachable.

Steps:

- [ ] **Step 1: Write failing tests.** Append:
  ```js
  function hostM(prevM, nextM) {
    const p = { reachable: true, cpu: 0.1, mem: 0.1, disk: 0.1, ...prevM };
    const n = { reachable: true, cpu: 0.1, mem: 0.1, disk: 0.1, ...nextM };
    return [host({ n1: p }), host({ n1: n })];
  }

  test('cpu rises below->above threshold emits host_threshold(warning)', () => {
    const [prev, next] = hostM({ cpu: 0.5 }, { cpu: 0.95 });
    const events = diffSnapshots(prev, next, THRESHOLDS);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], {
      type: 'host_threshold',
      id: 'n1:cpu',
      node: 'n1',
      title: 'Host cpu high',
      body: 'n1 cpu at 95% (threshold 90%)',
      severity: 'warning',
      prev: 0.5,
      next: 0.95,
    });
  });

  test('cpu exactly at threshold (0.90) counts as crossed (>=)', () => {
    const [prev, next] = hostM({ cpu: 0.5 }, { cpu: 0.9 });
    const events = diffSnapshots(prev, next, THRESHOLDS);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'host_threshold');
  });

  test('cpu falls below (threshold - hysteresis) clears => host_threshold_cleared(info)', () => {
    // already above, drop to 0.84 (< 0.90-0.05=0.85)
    const [prev, next] = hostM({ cpu: 0.95 }, { cpu: 0.84 });
    const events = diffSnapshots(prev, next, THRESHOLDS);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], {
      type: 'host_threshold_cleared',
      id: 'n1:cpu',
      node: 'n1',
      title: 'Host cpu normal',
      body: 'n1 cpu back to 84% (threshold 90%)',
      severity: 'info',
      prev: 0.95,
      next: 0.84,
    });
  });

  test('hysteresis band: above, drops to 0.87 (between 0.85 and 0.90) emits nothing', () => {
    const [prev, next] = hostM({ cpu: 0.95 }, { cpu: 0.87 });
    assert.deepEqual(diffSnapshots(prev, next, THRESHOLDS), []);
  });

  test('hysteresis band: below, rises to 0.87 (between 0.85 and 0.90) emits nothing', () => {
    const [prev, next] = hostM({ cpu: 0.5 }, { cpu: 0.87 });
    assert.deepEqual(diffSnapshots(prev, next, THRESHOLDS), []);
  });

  test('clear at exactly threshold-hysteresis (0.85) does NOT clear (must be below)', () => {
    const [prev, next] = hostM({ cpu: 0.95 }, { cpu: 0.85 });
    assert.deepEqual(diffSnapshots(prev, next, THRESHOLDS), []);
  });

  test('mem and disk crossings are independent events with NODE:METRIC ids', () => {
    const [prev, next] = hostM({ mem: 0.5, disk: 0.5 }, { mem: 0.95, disk: 0.99 });
    const events = diffSnapshots(prev, next, THRESHOLDS);
    assert.equal(events.length, 2);
    // canonically sorted by (type,id): both host_threshold, id mem < disk? "n1:disk" < "n1:mem"
    assert.deepEqual(events.map((e) => e.id), ['n1:disk', 'n1:mem']);
  });

  test('threshold crossings skipped when host not reachable in next', () => {
    const [prev] = hostM({ cpu: 0.5 }, {});
    const next = host({ n1: { reachable: false, cpu: 0.99, mem: 0.99, disk: 0.99 } });
    const events = diffSnapshots(prev, next, THRESHOLDS);
    // only host_unreachable, no host_threshold despite high cpu
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'host_unreachable');
  });
  ```
- [ ] **Step 2: Run it — Expected: FAIL.**
  `node --test server/push/differ.test.js`
- [ ] **Step 3: Minimal impl.** Add the metric loop inside `diffHosts`, after the reachability branch, guarded on both-reachable. Replace `diffHosts` with:
  ```js
  const HOST_METRICS = ['cpu', 'disk', 'mem']; // iterate sorted so insertion order is deterministic

  function pct(fraction) {
    return `${Math.round(fraction * 100)}%`;
  }

  function diffHosts(prev, next, thresholds, events) {
    for (const node of Object.keys(next)) {
      const before = prev[node] || { reachable: false };
      const after = next[node];
      const beforeReach = before.reachable === true;
      const afterReach = after.reachable === true;
      if (beforeReach && !afterReach) {
        events.push({
          type: 'host_unreachable',
          id: node,
          node,
          title: 'Host unreachable',
          body: `${node} is unreachable`,
          severity: SEVERITY.host_unreachable,
          prev: true,
          next: false,
        });
        continue;
      }
      if (!beforeReach && afterReach) {
        events.push({
          type: 'host_recovered',
          id: node,
          node,
          title: 'Host recovered',
          body: `${node} is reachable again`,
          severity: SEVERITY.host_recovered,
          prev: false,
          next: true,
        });
      }
      // Metric thresholds only meaningful when reachable both cycles.
      if (!beforeReach || !afterReach) continue;
      for (const metric of HOST_METRICS) {
        const limit = thresholds[metric];
        const clearAt = limit - thresholds.hysteresis;
        const b = before[metric];
        const a = after[metric];
        const wasHigh = b >= limit;
        const isHigh = a >= limit;
        if (!wasHigh && isHigh) {
          events.push({
            type: 'host_threshold',
            id: `${node}:${metric}`,
            node,
            title: `Host ${metric} high`,
            body: `${node} ${metric} at ${pct(a)} (threshold ${pct(limit)})`,
            severity: SEVERITY.host_threshold,
            prev: b,
            next: a,
          });
        } else if (wasHigh && a < clearAt) {
          events.push({
            type: 'host_threshold_cleared',
            id: `${node}:${metric}`,
            node,
            title: `Host ${metric} normal`,
            body: `${node} ${metric} back to ${pct(a)} (threshold ${pct(limit)})`,
            severity: SEVERITY.host_threshold_cleared,
            prev: b,
            next: a,
          });
        }
        // staying in [clearAt, limit) band: emit nothing (hysteresis).
      }
    }
  }
  ```
- [ ] **Step 4: Run it — Expected: PASS.**
  `node --test server/push/differ.test.js`
- [ ] **Step 5: Commit.**
  `git add server/push/differ.js server/push/differ.test.js && git commit -m "feat(push): diff host metric thresholds with hysteresis band"`

---

### Task 10: UPS transitions — `ups_on_battery` / `ups_restored`

**Files:**
- Modify: `server/push/differ.js` (add `diffUps`; wire into `diffSnapshots`)
- Test: `server/push/differ.test.js`

**Interfaces:**
- Consumes: `snapshot.ups` = `{ state: "online"|"on_battery"|"unknown" }`.
- Produces: `{ type: "ups_on_battery"|"ups_restored", id: "ups", node: "ups", ... }`. UPS is a singleton, so `id`/`node` are the literal `"ups"`.
- Transition: `online -> on_battery` = `ups_on_battery` (critical); `on_battery -> online` = `ups_restored` (info). Any transition to/from `unknown` NEVER emits.

Steps:

- [ ] **Step 1: Write failing tests.** Append:
  ```js
  function ups(state) {
    return { services: {}, hosts: {}, ups: { state }, cron: {} };
  }

  test('ups online->on_battery emits ups_on_battery(critical)', () => {
    const events = diffSnapshots(ups('online'), ups('on_battery'), THRESHOLDS);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], {
      type: 'ups_on_battery',
      id: 'ups',
      node: 'ups',
      title: 'UPS on battery',
      body: 'UPS switched to battery power',
      severity: 'critical',
      prev: 'online',
      next: 'on_battery',
    });
  });

  test('ups on_battery->online emits ups_restored(info)', () => {
    const events = diffSnapshots(ups('on_battery'), ups('online'), THRESHOLDS);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], {
      type: 'ups_restored',
      id: 'ups',
      node: 'ups',
      title: 'UPS restored',
      body: 'UPS back on line power',
      severity: 'info',
      prev: 'on_battery',
      next: 'online',
    });
  });

  test('ups transitions to/from unknown emit nothing', () => {
    assert.deepEqual(diffSnapshots(ups('unknown'), ups('on_battery'), THRESHOLDS), []);
    assert.deepEqual(diffSnapshots(ups('online'), ups('unknown'), THRESHOLDS), []);
    assert.deepEqual(diffSnapshots(ups('unknown'), ups('online'), THRESHOLDS), []);
  });

  test('ups unchanged emits nothing', () => {
    assert.deepEqual(diffSnapshots(ups('online'), ups('online'), THRESHOLDS), []);
    assert.deepEqual(diffSnapshots(ups('on_battery'), ups('on_battery'), THRESHOLDS), []);
  });
  ```
- [ ] **Step 2: Run it — Expected: FAIL.**
  `node --test server/push/differ.test.js`
- [ ] **Step 3: Minimal impl.** Wire into `diffSnapshots`:
  ```js
    diffHosts(prev.hosts || {}, next.hosts || {}, thresholds, events);
    diffUps(prev.ups || { state: 'unknown' }, next.ups || { state: 'unknown' }, events);
  ```
  Add helper:
  ```js
  function diffUps(prev, next, events) {
    const before = prev.state;
    const after = next.state;
    if (before === 'online' && after === 'on_battery') {
      events.push({
        type: 'ups_on_battery',
        id: 'ups',
        node: 'ups',
        title: 'UPS on battery',
        body: 'UPS switched to battery power',
        severity: SEVERITY.ups_on_battery,
        prev: before,
        next: after,
      });
    } else if (before === 'on_battery' && after === 'online') {
      events.push({
        type: 'ups_restored',
        id: 'ups',
        node: 'ups',
        title: 'UPS restored',
        body: 'UPS back on line power',
        severity: SEVERITY.ups_restored,
        prev: before,
        next: after,
      });
    }
    // any state involving "unknown" => no event.
  }
  ```
- [ ] **Step 4: Run it — Expected: PASS.**
  `node --test server/push/differ.test.js`
- [ ] **Step 5: Commit.**
  `git add server/push/differ.js server/push/differ.test.js && git commit -m "feat(push): diff ups on_battery/restored transitions"`

---

### Task 11: Cron transitions — `cron_failed` / `cron_recovered`

**Files:**
- Modify: `server/push/differ.js` (add `diffCron`; wire into `diffSnapshots`)
- Test: `server/push/differ.test.js`

**Interfaces:**
- Consumes: `snapshot.cron` = map `"NODE:JOB" -> "success"|"failure"|"unknown"`.
- Produces: `{ type: "cron_failed"|"cron_recovered", id: "NODE:JOB", node: NODE, ... }`. `id` = full key, `node` = NODE portion, job label = ID portion.
- Transition: `success`/new(unknown) -> `failure` = `cron_failed` (warning); `failure` -> `success` = `cron_recovered` (info). `unknown` target NEVER emits.

Steps:

- [ ] **Step 1: Write failing tests.** Append:
  ```js
  function cron(map) {
    return { services: {}, hosts: {}, ups: { state: 'unknown' }, cron: map };
  }

  test('cron success->failure emits cron_failed(warning)', () => {
    const events = diffSnapshots(cron({ 'n1:backup': 'success' }), cron({ 'n1:backup': 'failure' }), THRESHOLDS);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], {
      type: 'cron_failed',
      id: 'n1:backup',
      node: 'n1',
      title: 'Cron job failed',
      body: 'backup on n1 failed',
      severity: 'warning',
      prev: 'success',
      next: 'failure',
    });
  });

  test('cron new (no prev) ->failure emits cron_failed with prev=unknown', () => {
    const events = diffSnapshots(cron({}), cron({ 'n1:backup': 'failure' }), THRESHOLDS);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'cron_failed');
    assert.equal(events[0].prev, 'unknown');
  });

  test('cron failure->success emits cron_recovered(info)', () => {
    const events = diffSnapshots(cron({ 'n1:backup': 'failure' }), cron({ 'n1:backup': 'success' }), THRESHOLDS);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], {
      type: 'cron_recovered',
      id: 'n1:backup',
      node: 'n1',
      title: 'Cron job recovered',
      body: 'backup on n1 succeeded',
      severity: 'info',
      prev: 'failure',
      next: 'success',
    });
  });

  test('cron failure->unknown and unchanged emit nothing', () => {
    assert.deepEqual(diffSnapshots(cron({ 'n1:backup': 'failure' }), cron({ 'n1:backup': 'unknown' }), THRESHOLDS), []);
    assert.deepEqual(diffSnapshots(cron({ 'n1:backup': 'success' }), cron({ 'n1:backup': 'success' }), THRESHOLDS), []);
    assert.deepEqual(diffSnapshots(cron({ 'n1:backup': 'failure' }), cron({ 'n1:backup': 'failure' }), THRESHOLDS), []);
  });
  ```
- [ ] **Step 2: Run it — Expected: FAIL.**
  `node --test server/push/differ.test.js`
- [ ] **Step 3: Minimal impl.** Wire into `diffSnapshots`:
  ```js
    diffUps(prev.ups || { state: 'unknown' }, next.ups || { state: 'unknown' }, events);
    diffCron(prev.cron || {}, next.cron || {}, events);
  ```
  Add helper:
  ```js
  function diffCron(prev, next, events) {
    for (const key of Object.keys(next)) {
      const before = prev[key] === undefined ? 'unknown' : prev[key];
      const after = next[key];
      if (after === 'unknown') continue; // unknown never emits
      const failed = (before === 'success' || before === 'unknown') && after === 'failure';
      const recovered = before === 'failure' && after === 'success';
      if (failed) {
        events.push({
          type: 'cron_failed',
          id: key,
          node: nodeOf(key),
          title: 'Cron job failed',
          body: `${idPart(key)} on ${nodeOf(key)} failed`,
          severity: SEVERITY.cron_failed,
          prev: before,
          next: after,
        });
      } else if (recovered) {
        events.push({
          type: 'cron_recovered',
          id: key,
          node: nodeOf(key),
          title: 'Cron job recovered',
          body: `${idPart(key)} on ${nodeOf(key)} succeeded`,
          severity: SEVERITY.cron_recovered,
          prev: before,
          next: after,
        });
      }
    }
  }
  ```
- [ ] **Step 4: Run it — Expected: PASS.**
  `node --test server/push/differ.test.js`
- [ ] **Step 5: Commit.**
  `git add server/push/differ.js server/push/differ.test.js && git commit -m "feat(push): diff cron_failed/cron_recovered transitions"`

---

### Task 12: Canonical-sort determinism + cross-category mixed-event ordering

**Files:**
- Modify: `server/push/differ.js` (no impl change expected — `sortEvents` already canonical; this task PROVES it and locks it with a regression test)
- Test: `server/push/differ.test.js`

**Interfaces:**
- Consumes: full `Snapshot` across all 4 categories.
- Produces: `Event[]` sorted ascending by `(type, id)` (string compare on `type`, tiebreak `id`), byte-identical across insertion-order permutations.

Steps:

- [ ] **Step 1: Write failing/locking tests.** Append:
  ```js
  test('canonical sort: two insertion-order permutations produce byte-identical arrays', () => {
    // Same logical changes, keys inserted in different order in `next`.
    const prevA = {
      services: { 'n1:web': 'up', 'n2:db': 'up' },
      hosts: { n1: { reachable: true, cpu: 0.1, mem: 0.1, disk: 0.1 } },
      ups: { state: 'online' },
      cron: { 'n1:backup': 'success' },
    };
    const nextA = {
      services: { 'n1:web': 'down', 'n2:db': 'down' },
      hosts: { n1: { reachable: false, cpu: 0.1, mem: 0.1, disk: 0.1 } },
      ups: { state: 'on_battery' },
      cron: { 'n1:backup': 'failure' },
    };
    // Permutation: same data, different object key insertion order.
    const prevB = {
      cron: { 'n1:backup': 'success' },
      ups: { state: 'online' },
      services: { 'n2:db': 'up', 'n1:web': 'up' },
      hosts: { n1: { disk: 0.1, mem: 0.1, cpu: 0.1, reachable: true } },
    };
    const nextB = {
      cron: { 'n1:backup': 'failure' },
      ups: { state: 'on_battery' },
      services: { 'n2:db': 'down', 'n1:web': 'down' },
      hosts: { n1: { disk: 0.1, mem: 0.1, cpu: 0.1, reachable: false } },
    };
    const a = diffSnapshots(prevA, nextA, THRESHOLDS);
    const b = diffSnapshots(prevB, nextB, THRESHOLDS);
    assert.equal(JSON.stringify(a), JSON.stringify(b)); // byte-identical
  });

  test('canonical sort: ascending by (type, id) with id tiebreak', () => {
    const prev = {
      services: { 'n1:a': 'up', 'n2:z': 'up' },
      hosts: {},
      ups: { state: 'online' },
      cron: { 'n1:job': 'success' },
    };
    const next = {
      services: { 'n1:a': 'down', 'n2:z': 'down' },
      hosts: {},
      ups: { state: 'on_battery' },
      cron: { 'n1:job': 'failure' },
    };
    const events = diffSnapshots(prev, next, THRESHOLDS);
    // types: cron_failed, service_down, service_down, ups_on_battery
    // sorted by type then id: cron_failed(n1:job) < service_down(n1:a) < service_down(n2:z) < ups_on_battery(ups)
    assert.deepEqual(
      events.map((e) => [e.type, e.id]),
      [
        ['cron_failed', 'n1:job'],
        ['service_down', 'n1:a'],
        ['service_down', 'n2:z'],
        ['ups_on_battery', 'ups'],
      ],
    );
    // explicit determinism guard: re-running yields byte-identical output
    assert.equal(JSON.stringify(diffSnapshots(prev, next, THRESHOLDS)), JSON.stringify(events));
  });

  test('canonical sort: same type, id ordering uses string compare (n1:cpu < n1:disk < n1:mem)', () => {
    const base = { reachable: true, cpu: 0.5, mem: 0.5, disk: 0.5 };
    const hot = { reachable: true, cpu: 0.95, mem: 0.95, disk: 0.95 };
    const events = diffSnapshots(host({ n1: base }), host({ n1: hot }), THRESHOLDS);
    assert.deepEqual(events.map((e) => e.id), ['n1:cpu', 'n1:disk', 'n1:mem']);
  });
  ```
- [ ] **Step 2: Run it — Expected: PASS** (the canonical `sortEvents` from Task 6 already guarantees this; these tests lock the behavior against regression). If any fails, the sort is the bug — fix `sortEvents`, not the test.
  `node --test server/push/differ.test.js`
- [ ] **Step 3: (If green, no impl change.)** Confirm `sortEvents` is the single sort chokepoint and `diffSnapshots` calls it exactly once on the fully-assembled `events` array (it does, from Task 6). No code change.
- [ ] **Step 4: Run full module suite once more — Expected: PASS.**
  `node --test server/push/differ.test.js`
- [ ] **Step 5: Commit.**
  `git add server/push/differ.test.js && git commit -m "test(push): lock canonical (type,id) sort determinism for differ"`

---

### Task 13: Full-suite green + isolation guards (clock-free / pure / no cross-talk)

**Files:**
- Modify: `server/push/differ.test.js` (final purity assertions)
- Test: `server/push/differ.test.js`

**Interfaces:**
- Consumes/Produces: as above. This task proves the DETERMINISM LAW holds: no clock, no mutation of inputs, no module-level state leakage between calls.

Steps:

- [ ] **Step 1: Write failing/locking purity tests.** Append:
  ```js
  test('purity: diffSnapshots does not mutate prev or next', () => {
    const prev = Object.freeze({
      services: Object.freeze({ 'n1:web': 'up' }),
      hosts: Object.freeze({ n1: Object.freeze({ reachable: true, cpu: 0.1, mem: 0.1, disk: 0.1 }) }),
      ups: Object.freeze({ state: 'online' }),
      cron: Object.freeze({ 'n1:backup': 'success' }),
    });
    const next = Object.freeze({
      services: Object.freeze({ 'n1:web': 'down' }),
      hosts: Object.freeze({ n1: Object.freeze({ reachable: true, cpu: 0.95, mem: 0.1, disk: 0.1 }) }),
      ups: Object.freeze({ state: 'on_battery' }),
      cron: Object.freeze({ 'n1:backup': 'failure' }),
    });
    // Frozen inputs => any write attempt throws in strict mode; this passing proves no mutation.
    assert.doesNotThrow(() => diffSnapshots(prev, next, THRESHOLDS));
  });

  test('purity: repeated identical calls return deep-equal, byte-identical results (no module state)', () => {
    const prev = { services: { 'n1:web': 'up' }, hosts: {}, ups: { state: 'online' }, cron: {} };
    const next = { services: { 'n1:web': 'down' }, hosts: {}, ups: { state: 'online' }, cron: {} };
    const r1 = diffSnapshots(prev, next, THRESHOLDS);
    const r2 = diffSnapshots(prev, next, THRESHOLDS);
    const r3 = diffSnapshots(prev, next, THRESHOLDS);
    assert.deepEqual(r1, r2);
    assert.equal(JSON.stringify(r1), JSON.stringify(r2));
    assert.equal(JSON.stringify(r2), JSON.stringify(r3));
  });

  test('clock-free: result independent of wall time (no Date.now in output)', () => {
    const prev = { services: { 'n1:web': 'up' }, hosts: {}, ups: { state: 'online' }, cron: {} };
    const next = { services: { 'n1:web': 'down' }, hosts: {}, ups: { state: 'online' }, cron: {} };
    const before = diffSnapshots(prev, next, THRESHOLDS);
    const realNow = Date.now;
    Date.now = () => 1234567890; // tamper the clock
    try {
      const after = diffSnapshots(prev, next, THRESHOLDS);
      assert.equal(JSON.stringify(before), JSON.stringify(after)); // unaffected
    } finally {
      Date.now = realNow;
    }
  });

  test('cross-category: all 10 event types can co-occur in one cycle, sorted', () => {
    const prev = {
      services: { 'n1:web': 'up', 'n1:api': 'down' },
      hosts: {
        n1: { reachable: true, cpu: 0.95, mem: 0.1, disk: 0.1 }, // will clear
        n2: { reachable: true, cpu: 0.5, mem: 0.5, disk: 0.5 },
        n3: { reachable: false, cpu: 0, mem: 0, disk: 0 }, // will recover
      },
      ups: { state: 'online' },
      cron: { 'n1:b1': 'success', 'n1:b2': 'failure' },
    };
    const next = {
      services: { 'n1:web': 'down', 'n1:api': 'up' }, // down + recovered
      hosts: {
        n1: { reachable: true, cpu: 0.5, mem: 0.95, disk: 0.5 }, // cpu cleared + mem threshold
        n2: { reachable: false, cpu: 0, mem: 0, disk: 0 }, // unreachable
        n3: { reachable: true, cpu: 0.5, mem: 0.5, disk: 0.5 }, // recovered
      },
      ups: { state: 'on_battery' }, // on_battery
      cron: { 'n1:b1': 'failure', 'n1:b2': 'success' }, // failed + recovered
    };
    const events = diffSnapshots(prev, next, THRESHOLDS);
    const types = [...new Set(events.map((e) => e.type))].sort();
    assert.deepEqual(types, [
      'cron_failed',
      'cron_recovered',
      'host_recovered',
      'host_threshold',
      'host_threshold_cleared',
      'host_unreachable',
      'service_down',
      'service_recovered',
      'ups_on_battery',
    ]);
    // fully sorted by (type,id), and re-run is byte-identical
    const sorted = [...events].sort((a, b) =>
      a.type < b.type ? -1 : a.type > b.type ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
    assert.deepEqual(events, sorted);
    assert.equal(JSON.stringify(events), JSON.stringify(diffSnapshots(prev, next, THRESHOLDS)));
  });
  ```
- [ ] **Step 2: Run it — Expected: PASS** (purity/clock-freedom are guaranteed by Tasks 3–8; these lock the DETERMINISM LAW). If the frozen-input test throws, find the offending mutation and remove it.
  `node --test server/push/differ.test.js`
- [ ] **Step 3: (If green, no impl change.)** No code change — the pure helpers never mutate inputs nor read a clock. If red, fix the helper that wrote to an input.
- [ ] **Step 4: Run the WHOLE backend suite to confirm no regressions — Expected: PASS.**
  `npm test`
- [ ] **Step 5: Commit.**
  `git add server/push/differ.test.js && git commit -m "test(push): lock determinism-law purity and clock-freedom for differ"`


---

I now have everything I need: the `atomicWriteFileSync` + try/catch `load()` idiom, `DATA_DIR` resolution, the `createLogger` pattern, and the `node:test` + `mkdtempSync` test idiom. The contract specifies a factory `createTokenStore({path, now})` with injectable `now` (not the module-singleton pattern of cron-store), so tests pass `path` directly rather than via `JAGHELM_DATA_DIR`. Drafting the tasks now.

### Task 14: tokenStore — construct + register a new token (seed DEFAULT_PREFS + timestamps via injected now)

**Files:**
- Create `server/push/tokenStore.js` (new module)
- Test: `server/push/tokenStore.test.js`

**Interfaces:**
- Produces: `createTokenStore({ path, now }) -> store`; `store.registerToken(token, { platform, appVersion }) -> record`; `store.getToken(token) -> record|null`
- Consumes: `atomicWriteFileSync(targetPath, data)` from `../util/atomicWrite.js`; `DATA_DIR` from `../util/dataDir.js`
- Constants produced: `DEFAULT_PREFS = { categories: { service: true, host: true, ups: true, cron: true }, notifyRecoveries: true, enabled: true }`
- Record shape: `{ platform, appVersion, registeredAt, lastSeenAt, prefs }` where `registeredAt`/`lastSeenAt` are `now()` **epoch-ms NUMBERS** (NOT ISO-8601 strings). DESIGN.md §433-436/§507 shows ISO strings, but that is superseded: `pruneStale` does `now() - maxAgeMs` numeric arithmetic and the injected-clock determinism requires numbers. Do NOT change the store to emit ISO strings.

Steps:

- [ ] **Step 1: Write the failing test.** Create `server/push/tokenStore.test.js`:
  ```js
  /**
   * Push token store — registration upsert, prefs, prune, persistence round-trip.
   * Pure-ish store: the only clock is the injected `now`, so every assertion uses
   * a FIXED fake clock (never real Date.now). Each test gets its own mkdtemp path.
   */
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { mkdtempSync, rmSync } from 'node:fs';
  import { tmpdir } from 'node:os';
  import { join } from 'node:path';
  import { createTokenStore, DEFAULT_PREFS } from './tokenStore.js';

  /** Fresh temp dir + store with a settable fake clock. */
  function freshStore(startMs = 1_000_000) {
    const dir = mkdtempSync(join(tmpdir(), 'jaghelm-tokens-'));
    const path = join(dir, 'push-tokens.json');
    let clock = startMs;
    const now = () => clock;
    const store = createTokenStore({ path, now });
    return { dir, path, store, setNow: (ms) => { clock = ms; }, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  }

  test('registerToken seeds DEFAULT_PREFS and stamps registeredAt/lastSeenAt from injected now', () => {
    const { store, setNow, cleanup } = freshStore(5000);
    setNow(5000);
    const rec = store.registerToken('tok-a', { platform: 'android', appVersion: '1.2.3' });
    assert.equal(rec.platform, 'android');
    assert.equal(rec.appVersion, '1.2.3');
    assert.equal(rec.registeredAt, 5000);
    assert.equal(rec.lastSeenAt, 5000);
    assert.deepEqual(rec.prefs, DEFAULT_PREFS);
    // DEFAULT_PREFS must be a copy, not a shared mutable reference.
    rec.prefs.enabled = false;
    assert.equal(DEFAULT_PREFS.enabled, true);
    assert.deepEqual(store.getToken('tok-a').prefs, { ...DEFAULT_PREFS, enabled: false });
    cleanup();
  });

  test('getToken returns null for an unknown token', () => {
    const { store, cleanup } = freshStore();
    assert.equal(store.getToken('nope'), null);
    cleanup();
  });
  ```

- [ ] **Step 2: Run it — Expected: FAIL** (module does not exist yet).
  `node --test server/push/tokenStore.test.js`

- [ ] **Step 3: Minimal impl.** Create `server/push/tokenStore.js`:
  ```js
  /**
   * Push-token store for FCM delivery (Phase 4).
   *
   * Mirrors the cron-store persistence idiom: a tolerant JSON load() that never
   * throws on a missing/corrupt file, and atomicWriteFileSync on every mutation.
   * Unlike cron-store this is a FACTORY (createTokenStore) with an injectable
   * `now` so the clock stays out of the determinism-sensitive callers and tests
   * can pin time. Persisted shape: { [token]: record }.
   */
  import { readFileSync, existsSync, mkdirSync } from 'fs';
  import { dirname, join } from 'path';
  import { atomicWriteFileSync } from '../util/atomicWrite.js';
  import { DATA_DIR } from '../util/dataDir.js';
  import { createLogger } from '../util/logger.js';

  const log = createLogger('push-tokens');

  const DEFAULT_PATH = join(DATA_DIR, 'push-tokens.json');
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

  /** Default notification preferences seeded for every newly-registered token. */
  export const DEFAULT_PREFS = Object.freeze({
    categories: Object.freeze({ service: true, host: true, ups: true, cron: true }),
    notifyRecoveries: true,
    enabled: true,
  });

  /** Deep, plain (unfrozen) clone of DEFAULT_PREFS so callers can mutate safely. */
  function defaultPrefs() {
    return {
      categories: { ...DEFAULT_PREFS.categories },
      notifyRecoveries: DEFAULT_PREFS.notifyRecoveries,
      enabled: DEFAULT_PREFS.enabled,
    };
  }

  export function createTokenStore({ path = DEFAULT_PATH, now = Date.now } = {}) {
    /** @type {Record<string, any>} Tolerant load: missing/corrupt => empty map. */
    function load() {
      try {
        if (!existsSync(path)) return {};
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        return parsed && typeof parsed === 'object' ? parsed : {};
      } catch {
        return {};
      }
    }

    function save(store) {
      try {
        const dir = dirname(path);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        atomicWriteFileSync(path, JSON.stringify(store, null, 2));
      } catch (err) {
        log.error({ err }, 'Failed to save push tokens');
      }
    }

    let store = load();

    function registerToken(token, { platform, appVersion } = {}) {
      const ts = now();
      const existing = store[token];
      if (existing) {
        existing.lastSeenAt = ts;
        if (platform !== undefined) existing.platform = platform;
        if (appVersion !== undefined) existing.appVersion = appVersion;
        save(store);
        return { ...existing };
      }
      const record = {
        platform: platform ?? null,
        appVersion: appVersion ?? null,
        registeredAt: ts,
        lastSeenAt: ts,
        prefs: defaultPrefs(),
      };
      store[token] = record;
      save(store);
      return { ...record, prefs: { ...record.prefs, categories: { ...record.prefs.categories } } };
    }

    function getToken(token) {
      const rec = store[token];
      if (!rec) return null;
      return { ...rec, prefs: { ...rec.prefs, categories: { ...rec.prefs.categories } } };
    }

    return { registerToken, getToken };
  }
  ```

- [ ] **Step 4: Run it — Expected: PASS.**
  `node --test server/push/tokenStore.test.js`

- [ ] **Step 5: Commit.**
  `git add server/push/tokenStore.js server/push/tokenStore.test.js && git commit -m "feat(push): token store register + getToken with seeded default prefs"`

### Task 15: tokenStore — register upsert refreshes lastSeenAt and keeps existing prefs

**Files:**
- Modify `server/push/tokenStore.js` (no code change expected — upsert path already in `registerToken`; this task locks the behavior with tests)
- Test: `server/push/tokenStore.test.js` (append)

**Interfaces:**
- Consumes/Produces: `store.registerToken(token, { platform, appVersion }) -> record` (upsert semantics: existing token refreshes `lastSeenAt` via injected `now`, preserves `prefs`, updates platform/appVersion when supplied)

Steps:

- [ ] **Step 1: Write the failing test.** Append to `server/push/tokenStore.test.js`:
  ```js
  test('registerToken upsert refreshes lastSeenAt, keeps registeredAt + prefs', () => {
    const { store, setNow, cleanup } = freshStore();
    setNow(1000);
    store.registerToken('tok-x', { platform: 'android', appVersion: '1.0.0' });
    // Snapshot the seeded default prefs so we can prove the upsert preserves them
    // WITHOUT depending on setPrefs (which lands in Task 17) — keeps Task 15
    // red->green in isolation. (The setPrefs-mutated preservation case is
    // covered in Task 17.)
    const seededPrefs = store.getToken('tok-x').prefs;

    setNow(9000);
    const rec = store.registerToken('tok-x', { platform: 'android', appVersion: '1.4.0' });
    assert.equal(rec.registeredAt, 1000, 'registeredAt is immutable across re-registration');
    assert.equal(rec.lastSeenAt, 9000, 'lastSeenAt refreshed from injected now');
    assert.equal(rec.appVersion, '1.4.0', 'appVersion updated on re-register');
    assert.deepEqual(store.getToken('tok-x').prefs, seededPrefs, 'prefs preserved across upsert');
    cleanup();
  });

  test('registerToken upsert without platform/appVersion leaves prior values intact', () => {
    const { store, setNow, cleanup } = freshStore();
    setNow(1000);
    store.registerToken('tok-y', { platform: 'android', appVersion: '2.0.0' });
    setNow(2000);
    const rec = store.registerToken('tok-y');
    assert.equal(rec.platform, 'android');
    assert.equal(rec.appVersion, '2.0.0');
    assert.equal(rec.lastSeenAt, 2000);
    cleanup();
  });
  ```
  *(Both tests are self-contained: they prove the upsert path (lastSeenAt refresh, registeredAt immutability, platform/appVersion update, prefs preservation) using only `registerToken` + `getToken` from Task 14. The deeper setPrefs-mutated-then-preserved case lands in Task 17.)*

- [ ] **Step 2: Run it — Expected: PASS** (the upsert path is already correct from Task 14; these tests only LOCK its behavior — they depend on nothing past Task 14). Run:
  `node --test server/push/tokenStore.test.js`
  If either upsert assertion FAILS, that is a real defect in `registerToken`'s upsert branch — fix it minimally before proceeding.

- [ ] **Step 3: Minimal impl.** No production change expected — the upsert path (lastSeenAt refresh + prefs/registeredAt preservation + platform/appVersion update) is already implemented in Task 14's `registerToken`. This task is a behavior-lock; only edit `registerToken` if Step 2 surfaced a real bug.

- [ ] **Step 4: Run it — Expected: PASS.**
  `node --test server/push/tokenStore.test.js`

- [ ] **Step 5: Commit.**
  `git add server/push/tokenStore.test.js && git commit -m "test(push): lock register upsert lastSeenAt-refresh + prefs-preservation"`

### Task 16: tokenStore — removeToken + getAllTokens

**Files:**
- Modify `server/push/tokenStore.js` (add `removeToken`, `getAllTokens` to the returned store; export from the factory's return object)
- Test: `server/push/tokenStore.test.js` (append)

**Interfaces:**
- Produces: `store.removeToken(token) -> boolean` (true if a token was deleted, false if absent); `store.getAllTokens() -> Array<{ token, ...record }>` (each entry merges the token string into its record)

Steps:

- [ ] **Step 1: Write the failing test.** Append:
  ```js
  test('removeToken deletes a token and reports whether it existed', () => {
    const { store, setNow, cleanup } = freshStore();
    setNow(1000);
    store.registerToken('tok-1', { platform: 'android', appVersion: '1.0.0' });
    assert.equal(store.removeToken('tok-1'), true);
    assert.equal(store.getToken('tok-1'), null);
    assert.equal(store.removeToken('tok-1'), false, 'second removal returns false');
    assert.equal(store.removeToken('never-seen'), false);
    cleanup();
  });

  test('getAllTokens returns every token with its record merged under `token`', () => {
    const { store, setNow, cleanup } = freshStore();
    setNow(1000);
    store.registerToken('tok-a', { platform: 'android', appVersion: '1.0.0' });
    store.registerToken('tok-b', { platform: 'android', appVersion: '1.1.0' });
    const all = store.getAllTokens();
    assert.equal(all.length, 2);
    const byToken = Object.fromEntries(all.map((r) => [r.token, r]));
    assert.equal(byToken['tok-a'].appVersion, '1.0.0');
    assert.equal(byToken['tok-b'].appVersion, '1.1.0');
    assert.equal(byToken['tok-a'].registeredAt, 1000);
    assert.ok(byToken['tok-a'].prefs, 'record carries prefs');
    cleanup();
  });
  ```

- [ ] **Step 2: Run it — Expected: FAIL** (`store.removeToken is not a function`).
  `node --test server/push/tokenStore.test.js`

- [ ] **Step 3: Minimal impl.** In `server/push/tokenStore.js`, add the two functions inside `createTokenStore` and include them in the returned object:
  ```js
    function removeToken(token) {
      if (!Object.prototype.hasOwnProperty.call(store, token)) return false;
      delete store[token];
      save(store);
      return true;
    }

    function getAllTokens() {
      return Object.keys(store).map((token) => {
        const rec = store[token];
        return {
          token,
          ...rec,
          prefs: { ...rec.prefs, categories: { ...rec.prefs.categories } },
        };
      });
    }
  ```
  Update the return statement:
  ```js
    return { registerToken, getToken, removeToken, getAllTokens };
  ```

- [ ] **Step 4: Run it — Expected: PASS.**
  `node --test server/push/tokenStore.test.js`

- [ ] **Step 5: Commit.**
  `git add server/push/tokenStore.js server/push/tokenStore.test.js && git commit -m "feat(push): token store removeToken + getAllTokens"`

### Task 17: tokenStore — getPrefs + setPrefs (validate, normalize, coerce, reject unknown keys)

**Files:**
- Modify `server/push/tokenStore.js` (add `getPrefs`, `setPrefs`, and a pure `normalizePrefs` helper)
- Test: `server/push/tokenStore.test.js` (append)

**Interfaces:**
- Produces: `store.getPrefs(token) -> prefs` (returns a clone of `DEFAULT_PREFS` when the token is unknown or has no stored prefs); `store.setPrefs(token, prefs) -> record` (normalizes the input against the PREFS SHAPE — coerces booleans, drops unknown keys, fills missing keys from defaults — then persists and returns the updated record)
- PREFS SHAPE (from contract): `{ categories: { service, host, ups, cron }, notifyRecoveries, enabled }`, all booleans.

Steps:

- [ ] **Step 1: Write the failing test.** Append:
  ```js
  test('getPrefs returns DEFAULT_PREFS for a token with no overrides', () => {
    const { store, setNow, cleanup } = freshStore();
    setNow(1000);
    store.registerToken('tok-p', { platform: 'android', appVersion: '1.0.0' });
    assert.deepEqual(store.getPrefs('tok-p'), DEFAULT_PREFS);
    cleanup();
  });

  test('getPrefs returns DEFAULT_PREFS for an unknown token', () => {
    const { store, cleanup } = freshStore();
    assert.deepEqual(store.getPrefs('ghost'), DEFAULT_PREFS);
    cleanup();
  });

  test('setPrefs normalizes: coerces booleans, drops unknown keys, fills missing from defaults', () => {
    const { store, setNow, cleanup } = freshStore();
    setNow(1000);
    store.registerToken('tok-q', { platform: 'android', appVersion: '1.0.0' });
    const rec = store.setPrefs('tok-q', {
      categories: { service: false, host: 1, bogus: true }, // host coerces true, bogus dropped, ups/cron default
      notifyRecoveries: 0, // coerces false
      enabled: 'yes',      // coerces true
      junk: 'ignored',     // unknown top-level key dropped
    });
    assert.deepEqual(rec.prefs, {
      categories: { service: false, host: true, ups: true, cron: true },
      notifyRecoveries: false,
      enabled: true,
    });
    assert.equal(Object.prototype.hasOwnProperty.call(rec.prefs, 'junk'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(rec.prefs.categories, 'bogus'), false);
    // Persisted and reflected by getPrefs.
    assert.deepEqual(store.getPrefs('tok-q'), rec.prefs);
    cleanup();
  });

  test('setPrefs with an empty/garbage object yields full DEFAULT_PREFS', () => {
    const { store, setNow, cleanup } = freshStore();
    setNow(1000);
    store.registerToken('tok-r', { platform: 'android', appVersion: '1.0.0' });
    assert.deepEqual(store.setPrefs('tok-r', {}).prefs, DEFAULT_PREFS);
    assert.deepEqual(store.setPrefs('tok-r', null).prefs, DEFAULT_PREFS);
    cleanup();
  });
  ```

- [ ] **Step 2: Run it — Expected: FAIL** (`store.getPrefs is not a function`).
  `node --test server/push/tokenStore.test.js`

- [ ] **Step 3: Minimal impl.** In `server/push/tokenStore.js`, add a module-level pure normalizer above `createTokenStore`:
  ```js
  const CATEGORY_KEYS = ['service', 'host', 'ups', 'cron'];

  /**
   * Coerce arbitrary input into a valid PREFS object. Unknown keys are dropped,
   * missing keys fall back to DEFAULT_PREFS, all flags coerce to boolean. Pure.
   */
  function normalizePrefs(input) {
    const src = input && typeof input === 'object' ? input : {};
    const srcCats = src.categories && typeof src.categories === 'object' ? src.categories : {};
    const categories = {};
    for (const k of CATEGORY_KEYS) {
      categories[k] = k in srcCats ? Boolean(srcCats[k]) : DEFAULT_PREFS.categories[k];
    }
    return {
      categories,
      notifyRecoveries: 'notifyRecoveries' in src ? Boolean(src.notifyRecoveries) : DEFAULT_PREFS.notifyRecoveries,
      enabled: 'enabled' in src ? Boolean(src.enabled) : DEFAULT_PREFS.enabled,
    };
  }
  ```
  Then inside `createTokenStore` add:
  ```js
    function getPrefs(token) {
      const rec = store[token];
      if (!rec || !rec.prefs) return defaultPrefs();
      return normalizePrefs(rec.prefs);
    }

    function setPrefs(token, prefs) {
      const rec = store[token];
      if (!rec) return null;
      rec.prefs = normalizePrefs(prefs);
      save(store);
      return { ...rec, prefs: { ...rec.prefs, categories: { ...rec.prefs.categories } } };
    }
  ```
  Add both to the return object:
  ```js
    return { registerToken, getToken, removeToken, getAllTokens, getPrefs, setPrefs };
  ```

- [ ] **Step 4: Run it — Expected: PASS.** This also makes the Task-6 `setPrefs`-dependent assertion pass.
  `node --test server/push/tokenStore.test.js`

- [ ] **Step 5: Commit.**
  `git add server/push/tokenStore.js server/push/tokenStore.test.js && git commit -m "feat(push): token store getPrefs/setPrefs with shape normalization"`

### Task 18: tokenStore — pruneStale(maxAgeMs=30d) via injected now

**Files:**
- Modify `server/push/tokenStore.js` (add `pruneStale`)
- Test: `server/push/tokenStore.test.js` (append)

**Interfaces:**
- Produces: `store.pruneStale(maxAgeMs = 30 * 24 * 60 * 60 * 1000) -> number` (deletes every token whose `lastSeenAt < now() - maxAgeMs`, persists once, returns the count removed). Boundary: a token exactly at the cutoff (`lastSeenAt === now() - maxAgeMs`) is KEPT (strictly-older is pruned).

Steps:

- [ ] **Step 1: Write the failing test.** Append:
  ```js
  test('pruneStale removes tokens older than maxAge using the injected now', () => {
    const { store, setNow, cleanup } = freshStore();
    const DAY = 24 * 60 * 60 * 1000;
    setNow(1000);
    store.registerToken('fresh', { platform: 'android', appVersion: '1.0.0' }); // lastSeenAt 1000

    setNow(1000 + 40 * DAY);
    store.registerToken('recent', { platform: 'android', appVersion: '1.0.0' }); // lastSeenAt now

    // now = 1000 + 40d. Default maxAge 30d => cutoff = 1000 + 10d. `fresh` (1000) is older => pruned.
    const removed = store.pruneStale();
    assert.equal(removed, 1);
    assert.equal(store.getToken('fresh'), null);
    assert.ok(store.getToken('recent'), 'recent token survives');
    cleanup();
  });

  test('pruneStale keeps a token exactly at the cutoff (strictly-older is pruned)', () => {
    const { store, setNow, cleanup } = freshStore();
    setNow(10_000);
    store.registerToken('edge', { platform: 'android', appVersion: '1.0.0' }); // lastSeenAt 10_000
    // Set now so that now - maxAge === 10_000 exactly.
    const maxAge = 5_000;
    setNow(15_000); // cutoff = 15_000 - 5_000 = 10_000 === lastSeenAt => KEEP
    assert.equal(store.pruneStale(maxAge), 0);
    assert.ok(store.getToken('edge'));
    // One ms later, it is strictly older than the cutoff => pruned.
    setNow(15_001);
    assert.equal(store.pruneStale(maxAge), 1);
    assert.equal(store.getToken('edge'), null);
    cleanup();
  });

  test('pruneStale returns 0 and persists nothing surprising on an empty store', () => {
    const { store, setNow, cleanup } = freshStore();
    setNow(99_999_999);
    assert.equal(store.pruneStale(), 0);
    cleanup();
  });
  ```

- [ ] **Step 2: Run it — Expected: FAIL** (`store.pruneStale is not a function`).
  `node --test server/push/tokenStore.test.js`

- [ ] **Step 3: Minimal impl.** In `server/push/tokenStore.js`, add inside `createTokenStore`:
  ```js
    function pruneStale(maxAgeMs = THIRTY_DAYS_MS) {
      const cutoff = now() - maxAgeMs;
      let removed = 0;
      for (const token of Object.keys(store)) {
        const rec = store[token];
        // Defensive: a record with a non-numeric lastSeenAt is treated as stale.
        const seen = typeof rec.lastSeenAt === 'number' ? rec.lastSeenAt : -Infinity;
        if (seen < cutoff) {
          delete store[token];
          removed += 1;
        }
      }
      if (removed > 0) save(store);
      return removed;
    }
  ```
  Add to the return object:
  ```js
    return { registerToken, getToken, removeToken, getAllTokens, getPrefs, setPrefs, pruneStale };
  ```

- [ ] **Step 4: Run it — Expected: PASS.**
  `node --test server/push/tokenStore.test.js`

- [ ] **Step 5: Commit.**
  `git add server/push/tokenStore.js server/push/tokenStore.test.js && git commit -m "feat(push): token store pruneStale with injected-clock cutoff"`

### Task 19: tokenStore — persistence round-trip + tolerant load of missing/corrupt file

**Files:**
- Modify `server/push/tokenStore.js` (no code change expected — persistence already wired via `save()`/`load()`; this task verifies it and the corrupt-file tolerance)
- Test: `server/push/tokenStore.test.js` (append)

**Interfaces:**
- Consumes: `atomicWriteFileSync` (already used by `save`); tolerant `load()` (missing file => `{}`, unparseable => `{}`)
- Verifies: a fresh `createTokenStore({ path, now })` over the same `path` observes all prior writes byte-for-byte; a corrupt file does not throw on construct.

Steps:

- [ ] **Step 1: Write the failing test.** Append:
  ```js
  test('persistence round-trip: a fresh store over the same path sees prior writes', () => {
    const { path, store, setNow, cleanup } = freshStore();
    const now = () => 4242;
    setNow(4242);
    store.registerToken('persist-me', { platform: 'android', appVersion: '3.0.0' });
    store.setPrefs('persist-me', { ...DEFAULT_PREFS, enabled: false });

    // Re-open from disk — no shared in-memory state.
    const reopened = createTokenStore({ path, now });
    const rec = reopened.getToken('persist-me');
    assert.ok(rec, 'token survived reload');
    assert.equal(rec.platform, 'android');
    assert.equal(rec.appVersion, '3.0.0');
    assert.equal(rec.registeredAt, 4242);
    assert.equal(rec.prefs.enabled, false);
    assert.equal(reopened.getAllTokens().length, 1);
    cleanup();
  });

  test('construct tolerates a missing file (empty store, no throw)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jaghelm-tokens-'));
    const path = join(dir, 'does-not-exist.json');
    const store = createTokenStore({ path, now: () => 1 });
    assert.deepEqual(store.getAllTokens(), []);
    assert.equal(store.getToken('x'), null);
    rmSync(dir, { recursive: true, force: true });
  });

  test('construct tolerates a corrupt JSON file (falls back to empty store)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jaghelm-tokens-'));
    const path = join(dir, 'push-tokens.json');
    // Write garbage that is not valid JSON.
    writeFileSync(path, '{ this is not json', 'utf8');
    const store = createTokenStore({ path, now: () => 1 });
    assert.deepEqual(store.getAllTokens(), []);
    // And it can recover by registering anew.
    store.registerToken('recover', { platform: 'android', appVersion: '1.0.0' });
    assert.equal(createTokenStore({ path, now: () => 1 }).getToken('recover').platform, 'android');
    rmSync(dir, { recursive: true, force: true });
  });
  ```
  Add `writeFileSync` to the test's `node:fs` import line:
  ```js
  import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
  ```

- [ ] **Step 2: Run it — Expected: PASS** (persistence + tolerant load already implemented in Tasks 5/8). If any assertion FAILS, that surfaces a real defect in `load`/`save` — fix it minimally before proceeding.
  `node --test server/push/tokenStore.test.js`

- [ ] **Step 3: Minimal impl (only if Step 2 revealed a gap).** Expected: no production change. If the corrupt-file test threw, harden `load()` to guard `JSON.parse` inside the existing try/catch (already present) — confirm no edit needed.

- [ ] **Step 4: Run it — Expected: PASS.**
  `node --test server/push/tokenStore.test.js`

- [ ] **Step 5: Commit.**
  `git add server/push/tokenStore.test.js && git commit -m "test(push): token store persistence round-trip + corrupt-file tolerance"`


---

I have enough grounding. The logger interface is `{ debug, info, warn, error, child }` from `createLogger(module)`. Now I'll draft the fcm.js module tasks (Task 20+). I have all needed conventions: `atomicWriteFileSync` (not used here), `createLogger`, `node:test` with `import { test } from 'node:test'; import assert from 'node:assert/strict'`, test command `node --test server/push/fcm.test.js`, and the test runner force-exits.

### Task 20: fcm.js graceful-disable + isPushEnabled (no creds path => disabled, never throws)

**Files:**
- Create: `server/push/fcm.js`
- Create (test): `server/push/fcm.test.js`

**Interfaces:**
- Produces: `initPush({ credsPath, env, messagingFactory, logger }) -> void` — reads `credsPath || env.FCM_SERVICE_ACCOUNT || env.GOOGLE_APPLICATION_CREDENTIALS`; if missing/unreadable/invalid the module stays disabled, logs at info/warn, and NEVER throws.
- Produces: `isPushEnabled() -> bool`.
- NOTE (production race, acceptable): the default `messagingFactory` is ASYNC (lazy firebase-admin import) and `initPush` assigns `messaging` in a `.then()` it does not await. So with valid creds, `isPushEnabled()` can briefly be `false` between `initPush()` returning and the promise resolving — the first refresh cycle(s) may no-op. This SELF-HEALS on the next 30s cycle and never affects tests (which inject SYNC factories). If eager readiness is ever required, make `initPush` awaitable.
- Consumes: `createLogger` from `server/util/logger.js` (interface `{ debug, info, warn, error, child }`) as the default logger.

Steps:

- [ ] **Step 1: Write failing test for graceful-disable.** Create `server/push/fcm.test.js`:
  ```js
  import { test } from 'node:test';
  import assert from 'node:assert/strict';

  import { initPush, isPushEnabled } from './fcm.js';

  // A logger that records calls so we can assert "logged, never threw".
  function makeLogger() {
    const calls = { info: [], warn: [], error: [], debug: [] };
    return {
      info: (...a) => calls.info.push(a),
      warn: (...a) => calls.warn.push(a),
      error: (...a) => calls.error.push(a),
      debug: (...a) => calls.debug.push(a),
      child() { return this; },
      _calls: calls,
    };
  }

  test('graceful disable: no credsPath and empty env => disabled, no throw', () => {
    const logger = makeLogger();
    assert.doesNotThrow(() => {
      initPush({ credsPath: undefined, env: {}, messagingFactory: () => { throw new Error('factory must not be called'); }, logger });
    });
    assert.equal(isPushEnabled(), false);
    // It should announce the disabled state at info level, not throw or error.
    assert.equal(logger._calls.error.length, 0);
    assert.ok(logger._calls.info.length >= 1, 'expected an info log explaining push is disabled');
  });
  ```

- [ ] **Step 2: Run it — Expected: FAIL** (module does not exist yet).
  `node --test server/push/fcm.test.js`

- [ ] **Step 3: Minimal impl — create `server/push/fcm.js` with the disabled path only.**
  ```js
  /**
   * Firebase Cloud Messaging (FCM) push adapter for JagHelm mobile.
   *
   * Design constraints (Phase 4):
   *  - GRACEFUL DISABLE: with no service-account creds, the whole pipeline
   *    silently no-ops. initPush() never throws; isPushEnabled() returns false.
   *  - INJECTABLE SEAM: messagingFactory(serviceAccount) -> messaging is injected
   *    so unit tests NEVER load firebase-admin. The default factory lazy-imports
   *    firebase-admin (getMessaging) and is only reached when valid creds exist.
   *  - buildMessage is PURE (no I/O, no clock) and independently testable.
   */
  import { readFileSync } from 'fs';

  import { createLogger } from '../util/logger.js';

  // Module-level state. Set by initPush(); read by isPushEnabled()/sendToToken().
  let messaging = null;
  let log = createLogger('push:fcm');

  /**
   * Default messaging factory. Lazy-imports firebase-admin ONLY when valid creds
   * exist, so the graceful-disable path (and all unit tests) never touch the dep.
   * Tests inject their own messagingFactory and never reach this.
   */
  async function defaultMessagingFactory(serviceAccount) {
    const { initializeApp, cert } = await import('firebase-admin/app');
    const { getMessaging } = await import('firebase-admin/messaging');
    const app = initializeApp({ credential: cert(serviceAccount) });
    return getMessaging(app);
  }

  /**
   * Resolve the service-account creds path from explicit arg or env.
   * @returns {string|null}
   */
  function resolveCredsPath(credsPath, env) {
    return (
      credsPath ||
      env.FCM_SERVICE_ACCOUNT ||
      env.GOOGLE_APPLICATION_CREDENTIALS ||
      null
    );
  }

  /**
   * Initialize push. NEVER throws — on any missing/unreadable/invalid creds the
   * module stays disabled and logs. messagingFactory is sync-or-async; when the
   * default async firebase-admin factory is used, initPush resolves messaging
   * eagerly but tolerates a non-promise return from injected sync factories.
   */
  export function initPush({ credsPath, env = process.env, messagingFactory = defaultMessagingFactory, logger } = {}) {
    if (logger) log = logger;
    messaging = null;

    const path = resolveCredsPath(credsPath, env);
    if (!path) {
      log.info('push disabled: no FCM service-account creds configured');
      return;
    }

    let serviceAccount;
    try {
      const raw = readFileSync(path, 'utf8');
      serviceAccount = JSON.parse(raw);
    } catch (err) {
      log.warn({ err, path }, 'push disabled: FCM creds unreadable or invalid JSON');
      return;
    }

    try {
      const built = messagingFactory(serviceAccount);
      // Injected sync factories return messaging directly; the default async
      // factory returns a promise we resolve and assign when ready.
      if (built && typeof built.then === 'function') {
        built
          .then((m) => {
            messaging = m;
            log.info('push enabled: FCM messaging initialized');
          })
          .catch((err) => {
            messaging = null;
            log.warn({ err }, 'push disabled: messaging factory rejected');
          });
      } else {
        messaging = built;
        log.info('push enabled: FCM messaging initialized');
      }
    } catch (err) {
      messaging = null;
      log.warn({ err }, 'push disabled: messaging factory threw');
    }
  }

  /** @returns {boolean} whether push delivery is live (messaging built). */
  export function isPushEnabled() {
    return messaging != null;
  }
  ```

- [ ] **Step 4: Run it — Expected: PASS.**
  `node --test server/push/fcm.test.js`

- [ ] **Step 5: Commit.**
  `git add server/push/fcm.js server/push/fcm.test.js && git commit -m "feat(push): fcm graceful-disable + isPushEnabled"`

---

### Task 21: fcm.js invalid creds path => disabled, never throws

**Files:**
- Modify (test): `server/push/fcm.test.js` — add invalid-path case.
- No impl change expected (the `readFileSync`/`JSON.parse` try/catch from Task 20 already covers this); this task PROVES it with a red-then-green guard and only patches `fcm.js` if the assertion fails.

**Interfaces:**
- Consumes: `initPush({ credsPath, env, messagingFactory, logger })`, `isPushEnabled()`.

Steps:

- [ ] **Step 1: Write failing/guard test for invalid creds path.** Append to `server/push/fcm.test.js`:
  ```js
  import { mkdtempSync, writeFileSync, rmSync } from 'fs';
  import { tmpdir } from 'os';
  import { join } from 'path';

  test('invalid creds path: nonexistent file => disabled, no throw', () => {
    const logger = makeLogger();
    assert.doesNotThrow(() => {
      initPush({
        credsPath: '/definitely/not/a/real/path/sa.json',
        env: {},
        messagingFactory: () => { throw new Error('factory must not be called'); },
        logger,
      });
    });
    assert.equal(isPushEnabled(), false);
    assert.equal(logger._calls.error.length, 0);
    assert.ok(logger._calls.warn.length >= 1, 'expected a warn log for unreadable creds');
  });

  test('invalid creds content: malformed JSON => disabled, no throw', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jaghelm-fcm-'));
    const bad = join(dir, 'sa.json');
    writeFileSync(bad, '{ this is not json ');
    try {
      const logger = makeLogger();
      assert.doesNotThrow(() => {
        initPush({
          credsPath: bad,
          env: {},
          messagingFactory: () => { throw new Error('factory must not be called'); },
          logger,
        });
      });
      assert.equal(isPushEnabled(), false);
      assert.ok(logger._calls.warn.length >= 1, 'expected a warn log for malformed JSON');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  ```

- [ ] **Step 2: Run it — Expected: PASS** (Task 20's try/catch already disables on both branches). If either case unexpectedly FAILS, that is the red signal — then apply the minimal fix in Step 3.
  `node --test server/push/fcm.test.js`

- [ ] **Step 3: Minimal impl (only if Step 2 failed).** Ensure the `readFileSync`/`JSON.parse` block in `fcm.js` is wrapped exactly as in Task 20 Step 3 (single try/catch around both the read and the parse, `log.warn(...)` then `return`). No edit if Step 2 already passed.

- [ ] **Step 4: Run it — Expected: PASS.**
  `node --test server/push/fcm.test.js`

- [ ] **Step 5: Commit.**
  `git add server/push/fcm.test.js server/push/fcm.js && git commit -m "test(push): fcm disabled on invalid/malformed creds"`

---

### Task 22: fcm.js valid creds => isPushEnabled() true via injected messagingFactory

**Files:**
- Modify (test): `server/push/fcm.test.js` — add valid-creds case with a fake service-account JSON file + fake messagingFactory returning a fake messaging with a `.send` spy.
- Modify: `server/push/fcm.js` — no new code expected beyond Task 20 (sync-factory branch already assigns `messaging`); patch only if the assertion fails.

**Interfaces:**
- Produces: behavior — after `initPush` with a readable+valid JSON creds file and an injected `messagingFactory(serviceAccount)` returning `{ send }`, `isPushEnabled()` returns `true` and `messagingFactory` was called once with the parsed service account.

Steps:

- [ ] **Step 1: Write failing test for valid creds enabling push.** Append to `server/push/fcm.test.js`:
  ```js
  function fakeServiceAccountFile() {
    const dir = mkdtempSync(join(tmpdir(), 'jaghelm-fcm-'));
    const path = join(dir, 'sa.json');
    const sa = { project_id: 'jaghelm-test', client_email: 'svc@example.com', private_key: 'PEM' };
    writeFileSync(path, JSON.stringify(sa));
    return { dir, path, sa };
  }

  test('valid creds: injected factory => enabled, factory got parsed service account', () => {
    const { dir, path, sa } = fakeServiceAccountFile();
    try {
      const logger = makeLogger();
      const sendCalls = [];
      const fakeMessaging = { send: (msg) => { sendCalls.push(msg); return Promise.resolve('mock-msg-id'); } };
      const factoryArgs = [];
      const messagingFactory = (serviceAccount) => { factoryArgs.push(serviceAccount); return fakeMessaging; };

      initPush({ credsPath: path, env: {}, messagingFactory, logger });

      assert.equal(isPushEnabled(), true);
      assert.equal(factoryArgs.length, 1, 'factory called exactly once');
      assert.deepEqual(factoryArgs[0], sa, 'factory received the parsed service account');
      assert.equal(logger._calls.error.length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('FCM_SERVICE_ACCOUNT env resolves when credsPath absent', () => {
    const { dir, path } = fakeServiceAccountFile();
    try {
      initPush({ env: { FCM_SERVICE_ACCOUNT: path }, messagingFactory: () => ({ send: () => Promise.resolve('id') }), logger: makeLogger() });
      assert.equal(isPushEnabled(), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  ```

- [ ] **Step 2: Run it — Expected: PASS** (Task 20's sync-factory branch assigns `messaging`; env resolution covered by `resolveCredsPath`). If it FAILS, that is the red signal.
  `node --test server/push/fcm.test.js`

- [ ] **Step 3: Minimal impl (only if Step 2 failed).** Confirm `initPush` in `fcm.js` assigns `messaging = built` for a non-thenable factory return and that `resolveCredsPath` checks `env.FCM_SERVICE_ACCOUNT` before `env.GOOGLE_APPLICATION_CREDENTIALS`. No edit if Step 2 passed.

- [ ] **Step 4: Run it — Expected: PASS.**
  `node --test server/push/fcm.test.js`

- [ ] **Step 5: Commit.**
  `git add server/push/fcm.test.js server/push/fcm.js && git commit -m "test(push): fcm enables on valid creds via injected factory"`

---

### Task 23: fcm.js buildMessage — PURE message shape (severity => android.priority, channelId)

**Files:**
- Modify (test): `server/push/fcm.test.js` — add buildMessage purity + exact-shape cases.
- Modify: `server/push/fcm.js` — add `export function buildMessage(token, event)`.

**Interfaces:**
- Produces: `buildMessage(token, event) -> object` (PURE, no I/O, no clock). Exact shape:
  ```
  {
    token,
    notification: { title: event.title, body: event.body },
    data: { type: event.type, id: event.id, node: event.node, severity: event.severity },
    android: {
      priority: event.severity === 'critical' ? 'high' : 'normal',
      notification: { channelId: 'jaghelm-incidents' },
    },
  }
  ```
- Consumes: EVENT SHAPE `{ type, id, node, title, body, severity, prev, next }` (only `type/id/node/title/body/severity` are read).

Steps:

- [ ] **Step 1: Write failing test for buildMessage.** Append to `server/push/fcm.test.js` (add `buildMessage` to the top import: `import { initPush, isPushEnabled, buildMessage } from './fcm.js';`):
  ```js
  test('buildMessage: critical event => exact shape, android.priority high', () => {
    const event = {
      type: 'service_down', id: 'web', node: 'vm-101',
      title: 'Service down: web', body: 'web on vm-101 is down',
      severity: 'critical', prev: 'up', next: 'down',
    };
    const msg = buildMessage('tok-123', event);
    assert.deepEqual(msg, {
      token: 'tok-123',
      notification: { title: 'Service down: web', body: 'web on vm-101 is down' },
      data: { type: 'service_down', id: 'web', node: 'vm-101', severity: 'critical' },
      android: {
        priority: 'high',
        notification: { channelId: 'jaghelm-incidents' },
      },
    });
  });

  test('buildMessage: warning event => android.priority normal', () => {
    const event = { type: 'cron_failed', id: 'backup', node: 'vm-103', title: 'Cron failed', body: 'backup failed', severity: 'warning' };
    const msg = buildMessage('tok-9', event);
    assert.equal(msg.android.priority, 'normal');
    assert.equal(msg.android.notification.channelId, 'jaghelm-incidents');
  });

  test('buildMessage: info event => android.priority normal', () => {
    const event = { type: 'service_recovered', id: 'web', node: 'vm-101', title: 'Recovered', body: 'web up', severity: 'info' };
    assert.equal(buildMessage('t', event).android.priority, 'normal');
  });

  test('buildMessage is PURE: same input => byte-identical output, no input mutation', () => {
    const event = { type: 'ups_on_battery', id: 'ups', node: 'pdu', title: 'On battery', body: 'mains lost', severity: 'critical' };
    const frozen = Object.freeze({ ...event });
    const a = buildMessage('t', frozen);
    const b = buildMessage('t', frozen);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    // data carries ONLY the four contract keys — not prev/next/title/body.
    assert.deepEqual(Object.keys(a.data).sort(), ['id', 'node', 'severity', 'type']);
  });
  ```

- [ ] **Step 2: Run it — Expected: FAIL** (`buildMessage` is not exported yet).
  `node --test server/push/fcm.test.js`

- [ ] **Step 3: Minimal impl — add `buildMessage` to `server/push/fcm.js`** (place after `isPushEnabled`):
  ```js
  /**
   * Build the FCM message payload for an event. PURE: no I/O, no clock, no
   * module state. `data` fields are strings per FCM's data-message contract and
   * carry ONLY type/id/node/severity (no title/body/prev/next).
   * @param {string} token
   * @param {{type:string,id:string,node:string,title:string,body:string,severity:string}} event
   * @returns {object}
   */
  export function buildMessage(token, event) {
    return {
      token,
      notification: { title: event.title, body: event.body },
      data: {
        type: event.type,
        id: event.id,
        node: event.node,
        severity: event.severity,
      },
      android: {
        priority: event.severity === 'critical' ? 'high' : 'normal',
        notification: { channelId: 'jaghelm-incidents' },
      },
    };
  }
  ```

- [ ] **Step 4: Run it — Expected: PASS.**
  `node --test server/push/fcm.test.js`

- [ ] **Step 5: Commit.**
  `git add server/push/fcm.js server/push/fcm.test.js && git commit -m "feat(push): pure buildMessage with severity-mapped android priority"`

---

### Task 24: fcm.js sendToToken — success / prune / transient classification

**Files:**
- Modify (test): `server/push/fcm.test.js` — add success, prune (two prune codes), and transient cases.
- Modify: `server/push/fcm.js` — add `export async function sendToToken(token, event)`.

**Interfaces:**
- Produces: `sendToToken(token, event) -> Promise<{ ok, prune, error? }>`. Calls `messaging.send(buildMessage(token, event))`. On resolve: `{ ok: true, prune: false }`. On reject: `prune: true` ONLY when the firebase error `code` is `messaging/registration-token-not-registered` or `messaging/invalid-argument`; any other (transient) error => `{ ok: false, prune: false, error }`. When push is disabled (`messaging == null`) => `{ ok: false, prune: false }` (no throw).
- Consumes: module `messaging` (set by `initPush` via injected factory in tests), `buildMessage`.

Steps:

- [ ] **Step 1: Write failing test for sendToToken.** Append to `server/push/fcm.test.js` (extend top import: `import { initPush, isPushEnabled, buildMessage, sendToToken } from './fcm.js';`):
  ```js
  // Helper: enable push with a fake messaging whose send() is driven per-test.
  function enableWithSend(sendImpl) {
    const { dir, path } = fakeServiceAccountFile();
    const sent = [];
    const messagingFactory = () => ({
      send: (msg) => { sent.push(msg); return sendImpl(msg); },
    });
    initPush({ credsPath: path, env: {}, messagingFactory, logger: makeLogger() });
    return { dir, sent };
  }

  const sampleEvent = {
    type: 'service_down', id: 'web', node: 'vm-101',
    title: 'Service down: web', body: 'web is down', severity: 'critical',
  };

  test('sendToToken success: send resolves => {ok:true, prune:false} and got buildMessage payload', async () => {
    const { dir, sent } = enableWithSend(() => Promise.resolve('msg-id-1'));
    try {
      const res = await sendToToken('tok-ok', sampleEvent);
      assert.deepEqual(res, { ok: true, prune: false });
      assert.equal(sent.length, 1);
      assert.deepEqual(sent[0], buildMessage('tok-ok', sampleEvent));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('sendToToken prune: registration-token-not-registered => {ok:false, prune:true}', async () => {
    const { dir } = enableWithSend(() => Promise.reject(Object.assign(new Error('gone'), { code: 'messaging/registration-token-not-registered' })));
    try {
      const res = await sendToToken('tok-dead', sampleEvent);
      assert.equal(res.ok, false);
      assert.equal(res.prune, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('sendToToken prune: invalid-argument => {ok:false, prune:true}', async () => {
    const { dir } = enableWithSend(() => Promise.reject(Object.assign(new Error('bad'), { code: 'messaging/invalid-argument' })));
    try {
      const res = await sendToToken('tok-bad', sampleEvent);
      assert.equal(res.ok, false);
      assert.equal(res.prune, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('sendToToken transient: internal-error => {ok:false, prune:false}', async () => {
    const { dir } = enableWithSend(() => Promise.reject(Object.assign(new Error('try later'), { code: 'messaging/internal-error' })));
    try {
      const res = await sendToToken('tok-x', sampleEvent);
      assert.equal(res.ok, false);
      assert.equal(res.prune, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('sendToToken when disabled: => {ok:false, prune:false}, no throw', async () => {
    initPush({ env: {}, messagingFactory: () => { throw new Error('unused'); }, logger: makeLogger() });
    assert.equal(isPushEnabled(), false);
    const res = await sendToToken('tok', sampleEvent);
    assert.deepEqual(res, { ok: false, prune: false });
  });
  ```

- [ ] **Step 2: Run it — Expected: FAIL** (`sendToToken` not exported yet).
  `node --test server/push/fcm.test.js`

- [ ] **Step 3: Minimal impl — add `sendToToken` to `server/push/fcm.js`** (after `buildMessage`):
  ```js
  // FCM error codes that mean the token is permanently dead and should be
  // pruned from the store. Everything else (network/quota/internal) is transient.
  const PRUNE_CODES = new Set([
    'messaging/registration-token-not-registered',
    'messaging/invalid-argument',
  ]);

  /**
   * Send one event to one token. NEVER throws — classifies the outcome:
   *  - resolve            => { ok: true,  prune: false }
   *  - reject + prune code => { ok: false, prune: true, error }
   *  - reject (transient) => { ok: false, prune: false, error }
   *  - push disabled       => { ok: false, prune: false }
   * @param {string} token
   * @param {object} event
   * @returns {Promise<{ok:boolean, prune:boolean, error?:string}>}
   */
  export async function sendToToken(token, event) {
    if (messaging == null) return { ok: false, prune: false };
    try {
      await messaging.send(buildMessage(token, event));
      return { ok: true, prune: false };
    } catch (err) {
      const prune = PRUNE_CODES.has(err && err.code);
      log.warn({ err, token: token.slice(0, 12), code: err && err.code, prune }, 'fcm send failed');
      return { ok: false, prune, error: err && err.message };
    }
  }
  ```

- [ ] **Step 4: Run it — Expected: PASS.**
  `node --test server/push/fcm.test.js`

- [ ] **Step 5: Commit.**
  `git add server/push/fcm.js server/push/fcm.test.js && git commit -m "feat(push): sendToToken with prune-vs-transient error classification"`

---

### Task 25: fcm.js full-suite green + run under root `npm test`

**Files:**
- No new files. Verification + cleanup task ensuring `server/push/fcm.test.js` passes in isolation and under the repo runner (`node --test --test-force-exit`), and that the graceful-disable path imports zero firebase-admin.

**Interfaces:**
- Consumes: all of `server/push/fcm.js` (`initPush`, `isPushEnabled`, `buildMessage`, `sendToToken`).

Steps:

- [ ] **Step 1: Run the fcm suite in isolation — Expected: PASS (all cases from Tasks 7–11).**
  `node --test server/push/fcm.test.js`

- [ ] **Step 2: Assert the disabled path never loads firebase-admin.** Add a guard test appended to `server/push/fcm.test.js` that fails loudly if a real firebase-admin import were ever reached on the disabled path (the default factory is never invoked without creds):
  ```js
  test('no creds => default messagingFactory never invoked (firebase-admin untouched)', () => {
    let factoryInvoked = false;
    initPush({ env: {}, messagingFactory: () => { factoryInvoked = true; return {}; }, logger: makeLogger() });
    assert.equal(factoryInvoked, false);
    assert.equal(isPushEnabled(), false);
  });
  ```
  Run — Expected: PASS.
  `node --test server/push/fcm.test.js`

- [ ] **Step 3: Run under the repo test runner to confirm force-exit cleanliness — Expected: PASS, process exits 0.**
  `node --test --test-force-exit server/push/fcm.test.js`

- [ ] **Step 4: Lint the new module — Expected: clean.**
  `npx eslint server/push/fcm.js server/push/fcm.test.js`

- [ ] **Step 5: Commit.**
  `git add server/push/fcm.test.js && git commit -m "test(push): fcm disabled path never loads firebase-admin"`


---

I now have everything I need: the exact `runBackgroundRefresh` try/finally block, the boot sequence, router export idiom (`export { router as cronRoutes }`), `authMiddleware` import path, supertest test transport, and persistence/cache idioms. Drafting the tasks.

### Task 26: `categoryOf` + `shouldDeliver` pure pref-filter (dispatch.js core)

**Files:**
- Create `/home/ilaaj-agent/jaghelm/server/push/dispatch.js` (new file; will also house `dispatchEvents` in Task 27 and `runPushCycle` in Task 28)
- Test: `/home/ilaaj-agent/jaghelm/server/push/dispatch.test.js`

**Interfaces:**
- Consumes `RECOVERY_TYPES` (Set) from `./differ.js` (built in Task 6)
- Produces `categoryOf(type) -> "service"|"host"|"ups"|"cron"` and `shouldDeliver(event, prefs) -> bool`. Pure, no clock, no I/O. Contract: `shouldDeliver` returns `false` if `!prefs.enabled`; `false` if `prefs.categories[categoryOf(event.type)]===false`; `false` if `RECOVERY_TYPES.has(event.type) && !prefs.notifyRecoveries`; else `true`. `DEFAULT_PREFS` is NOT defined here — it has a single owner, `server/push/tokenStore.js` (Task 14); the test imports it from there. `shouldDeliver` receives already-resolved prefs.

**Steps:**

- [ ] **Step 1: Write the failing test for `categoryOf` + `shouldDeliver` truth-table.** Create `/home/ilaaj-agent/jaghelm/server/push/dispatch.test.js`:
  ```js
  import { test } from 'node:test';
  import assert from 'node:assert/strict';

  import { categoryOf, shouldDeliver } from './dispatch.js';
  // DEFAULT_PREFS has a single owner (tokenStore.js); import it from there.
  import { DEFAULT_PREFS } from './tokenStore.js';

  test('categoryOf maps every event type to its category', () => {
    assert.equal(categoryOf('service_down'), 'service');
    assert.equal(categoryOf('service_recovered'), 'service');
    assert.equal(categoryOf('host_unreachable'), 'host');
    assert.equal(categoryOf('host_threshold'), 'host');
    assert.equal(categoryOf('host_threshold_cleared'), 'host');
    assert.equal(categoryOf('host_recovered'), 'host');
    assert.equal(categoryOf('ups_on_battery'), 'ups');
    assert.equal(categoryOf('ups_restored'), 'ups');
    assert.equal(categoryOf('cron_failed'), 'cron');
    assert.equal(categoryOf('cron_recovered'), 'cron');
  });

  test('DEFAULT_PREFS is all-on', () => {
    assert.deepEqual(DEFAULT_PREFS, {
      categories: { service: true, host: true, ups: true, cron: true },
      notifyRecoveries: true,
      enabled: true,
    });
  });

  test('shouldDeliver passes a normal critical event under default prefs', () => {
    const ev = { type: 'service_down', severity: 'critical' };
    assert.equal(shouldDeliver(ev, DEFAULT_PREFS), true);
  });

  test('shouldDeliver: enabled=false suppresses ALL events', () => {
    const prefs = { ...DEFAULT_PREFS, enabled: false };
    assert.equal(shouldDeliver({ type: 'service_down' }, prefs), false);
    assert.equal(shouldDeliver({ type: 'host_recovered' }, prefs), false);
    assert.equal(shouldDeliver({ type: 'cron_failed' }, prefs), false);
  });

  test('shouldDeliver: a single category off suppresses ONLY that category', () => {
    const prefs = {
      categories: { service: false, host: true, ups: true, cron: true },
      notifyRecoveries: true,
      enabled: true,
    };
    assert.equal(shouldDeliver({ type: 'service_down' }, prefs), false);
    assert.equal(shouldDeliver({ type: 'service_recovered' }, prefs), false);
    // other categories untouched
    assert.equal(shouldDeliver({ type: 'host_unreachable' }, prefs), true);
    assert.equal(shouldDeliver({ type: 'ups_on_battery' }, prefs), true);
    assert.equal(shouldDeliver({ type: 'cron_failed' }, prefs), true);
  });

  test('shouldDeliver: notifyRecoveries=false suppresses recovery events only', () => {
    const prefs = { ...DEFAULT_PREFS, notifyRecoveries: false };
    // recoveries suppressed
    assert.equal(shouldDeliver({ type: 'service_recovered' }, prefs), false);
    assert.equal(shouldDeliver({ type: 'host_recovered' }, prefs), false);
    assert.equal(shouldDeliver({ type: 'host_threshold_cleared' }, prefs), false);
    assert.equal(shouldDeliver({ type: 'ups_restored' }, prefs), false);
    assert.equal(shouldDeliver({ type: 'cron_recovered' }, prefs), false);
    // incidents still delivered
    assert.equal(shouldDeliver({ type: 'service_down' }, prefs), true);
    assert.equal(shouldDeliver({ type: 'host_threshold' }, prefs), true);
    assert.equal(shouldDeliver({ type: 'cron_failed' }, prefs), true);
  });
  ```

- [ ] **Step 2: Run it — Expected: FAIL** (`dispatch.js` does not exist / has no exports).
  `node --test server/push/dispatch.test.js`

- [ ] **Step 3: Minimal impl — create `dispatch.js` with the pure core.** Create `/home/ilaaj-agent/jaghelm/server/push/dispatch.js`:
  ```js
  /**
   * Push dispatch: the pure pref-filter (shouldDeliver/categoryOf), the
   * fan-out (dispatchEvents), and the per-cycle orchestrator (runPushCycle).
   *
   * shouldDeliver + categoryOf are PURE and clock-free (determinism law).
   * dispatchEvents + runPushCycle own the I/O (fcm.send, snapshot file) and
   * are the only places a clock or side effect lives.
   */
  // Import ONLY what this task uses, so `eslint .` (no-unused-vars) stays green
  // between tasks. readFileSync / atomicWriteFileSync / diffSnapshots are added
  // in Task 28 (runPushCycle), which re-states the full import block at the top.
  import { createLogger } from '../util/logger.js';
  import { RECOVERY_TYPES } from './differ.js';

  const defaultLog = createLogger('push-dispatch');

  // DEFAULT_PREFS has a single owner: server/push/tokenStore.js. shouldDeliver
  // receives already-resolved prefs, so dispatch.js does not redefine it.

  /** Map an event type to its preference category. */
  export function categoryOf(type) {
    if (type.startsWith('service_')) return 'service';
    if (type.startsWith('host_')) return 'host';
    if (type.startsWith('ups_')) return 'ups';
    if (type.startsWith('cron_')) return 'cron';
    return 'service'; // unreachable for contract types; conservative default
  }

  /**
   * Pure pref filter. Returns true iff this event should be delivered under
   * the given per-token prefs. No clock, no I/O.
   */
  export function shouldDeliver(event, prefs) {
    if (!prefs.enabled) return false;
    if (prefs.categories[categoryOf(event.type)] === false) return false;
    if (RECOVERY_TYPES.has(event.type) && !prefs.notifyRecoveries) return false;
    return true;
  }
  ```

- [ ] **Step 4: Run it — Expected: PASS.**
  `node --test server/push/dispatch.test.js`

- [ ] **Step 5: Commit.**
  `git add server/push/dispatch.js server/push/dispatch.test.js && git commit -m "feat(push): pure pref-filter shouldDeliver + categoryOf"`

---

### Task 27: `dispatchEvents` — fan event × tokens, suppress per prefs, prune dead tokens

**Files:**
- Modify `/home/ilaaj-agent/jaghelm/server/push/dispatch.js` (append `dispatchEvents`)
- Test: `/home/ilaaj-agent/jaghelm/server/push/dispatch.test.js` (append)

**Interfaces:**
- Consumes injected `{ store, fcm, logger }`. `store.getAllTokens() -> [{token,...}]`, `store.getPrefs(token) -> prefs`, `store.removeToken(token) -> bool`. `fcm.sendToToken(token, event) -> Promise<{ok, prune, error?}>`.
- Produces `dispatchEvents(events, { store, fcm, logger }) -> Promise<{ sent, suppressed, pruned }>`. For each event × each token: if `shouldDeliver(event, store.getPrefs(token))` then `await fcm.sendToToken(token, event)`; collect tokens whose result `prune===true`; `store.removeToken` each **once** at the end; return counts (`sent` = deliveries attempted that resolved `ok:true`-or-not but were sent; `suppressed` = filtered-out (event×token) pairs; `pruned` = distinct tokens removed).

**Steps:**

- [ ] **Step 6: Write the failing test for `dispatchEvents`.** Append to `/home/ilaaj-agent/jaghelm/server/push/dispatch.test.js`:
  ```js
  import { dispatchEvents } from './dispatch.js';

  // Minimal fake store: in-memory token list + prefs map + remove tracking.
  function fakeStore({ tokens, prefsByToken }) {
    const removed = [];
    return {
      removed,
      getAllTokens: () => tokens.map((t) => ({ token: t })),
      getPrefs: (t) => prefsByToken[t] ?? DEFAULT_PREFS,
      removeToken: (t) => {
        removed.push(t);
        return true;
      },
    };
  }

  // Fake fcm whose send result is keyed by token (lets us force prune/ok).
  function fakeFcm(resultByToken) {
    const calls = [];
    return {
      calls,
      sendToToken: async (token, event) => {
        calls.push({ token, type: event.type });
        return resultByToken[token] ?? { ok: true, prune: false };
      },
    };
  }

  const silentLog = { info() {}, warn() {}, error() {}, debug() {} };

  test('dispatchEvents fans every delivered event across every token', async () => {
    const store = fakeStore({ tokens: ['a', 'b'], prefsByToken: {} });
    const fcm = fakeFcm({});
    const events = [
      { type: 'service_down', id: 'x' },
      { type: 'host_unreachable', id: 'y' },
    ];
    const res = await dispatchEvents(events, { store, fcm, logger: silentLog });
    // 2 events × 2 tokens = 4 sends, none suppressed, none pruned
    assert.equal(fcm.calls.length, 4);
    assert.deepEqual(res, { sent: 4, suppressed: 0, pruned: 0 });
  });

  test('dispatchEvents suppresses per-token prefs (no send for filtered pairs)', async () => {
    const store = fakeStore({
      tokens: ['a', 'b'],
      prefsByToken: {
        // token a: service category off
        a: { categories: { service: false, host: true, ups: true, cron: true }, notifyRecoveries: true, enabled: true },
        // token b: fully disabled
        b: { ...DEFAULT_PREFS, enabled: false },
      },
    });
    const fcm = fakeFcm({});
    const events = [{ type: 'service_down', id: 'x' }];
    const res = await dispatchEvents(events, { store, fcm, logger: silentLog });
    // a: service off -> suppressed; b: disabled -> suppressed. Zero sends.
    assert.equal(fcm.calls.length, 0);
    assert.deepEqual(res, { sent: 0, suppressed: 2, pruned: 0 });
  });

  test('dispatchEvents prunes a token whose send returns prune:true, once', async () => {
    const store = fakeStore({ tokens: ['dead', 'live'], prefsByToken: {} });
    const fcm = fakeFcm({
      dead: { ok: false, prune: true, error: 'registration-token-not-registered' },
      live: { ok: true, prune: false },
    });
    // Two events so 'dead' returns prune twice — must still removeToken once.
    const events = [
      { type: 'service_down', id: 'x' },
      { type: 'cron_failed', id: 'y' },
    ];
    const res = await dispatchEvents(events, { store, fcm, logger: silentLog });
    assert.equal(fcm.calls.length, 4); // both tokens, both events
    assert.deepEqual(store.removed, ['dead']); // pruned exactly once
    assert.deepEqual(res, { sent: 4, suppressed: 0, pruned: 1 });
  });

  test('dispatchEvents with no events returns all-zero counts and never touches fcm', async () => {
    const store = fakeStore({ tokens: ['a'], prefsByToken: {} });
    const fcm = fakeFcm({});
    const res = await dispatchEvents([], { store, fcm, logger: silentLog });
    assert.equal(fcm.calls.length, 0);
    assert.deepEqual(res, { sent: 0, suppressed: 0, pruned: 0 });
  });
  ```

- [ ] **Step 7: Run it — Expected: FAIL** (`dispatchEvents` not exported).
  `node --test server/push/dispatch.test.js`

- [ ] **Step 8: Minimal impl — append `dispatchEvents` to `dispatch.js`.** Add after `shouldDeliver` in `/home/ilaaj-agent/jaghelm/server/push/dispatch.js`:
  ```js
  /**
   * Fan a list of events across every registered token, honoring each token's
   * prefs. A token whose send asks to be pruned (dead/invalid registration) is
   * removed exactly once at the end. Returns delivery counts.
   *
   * @param {Array} events  events from diffSnapshots (already canonically sorted)
   * @param {object} deps   { store, fcm, logger }
   * @returns {Promise<{sent:number, suppressed:number, pruned:number}>}
   */
  export async function dispatchEvents(events, { store, fcm, logger = defaultLog }) {
    let sent = 0;
    let suppressed = 0;
    const toPrune = new Set();

    const tokens = store.getAllTokens();
    for (const event of events) {
      for (const { token } of tokens) {
        const prefs = store.getPrefs(token);
        if (!shouldDeliver(event, prefs)) {
          suppressed += 1;
          continue;
        }
        const result = await fcm.sendToToken(token, event);
        sent += 1;
        if (result && result.prune) toPrune.add(token);
      }
    }

    for (const token of toPrune) {
      try {
        store.removeToken(token);
      } catch (err) {
        logger.warn({ err }, 'failed to prune dead push token');
      }
    }

    return { sent, suppressed, pruned: toPrune.size };
  }
  ```

- [ ] **Step 9: Run it — Expected: PASS.**
  `node --test server/push/dispatch.test.js`

- [ ] **Step 10: Commit.**
  `git add server/push/dispatch.js server/push/dispatch.test.js && git commit -m "feat(push): dispatchEvents fan-out with per-token prefs + dead-token pruning"`

---

### Task 28: `runPushCycle` — orchestrate snapshot diff → dispatch → persist, with total error isolation

**Files:**
- Modify `/home/ilaaj-agent/jaghelm/server/push/dispatch.js` (append `runPushCycle`; ensure `readFileSync`, `existsSync`, `atomicWriteFileSync`, `diffSnapshots` are imported)
- Test: `/home/ilaaj-agent/jaghelm/server/push/cycle.test.js` (separate file — it does real temp-file I/O, so it stays out of the pure `dispatch.test.js`)

**Interfaces:**
- Consumes `{ buildSnapshotFn, store, fcm, snapshotPath, thresholds, logger }`. `fcm.isPushEnabled() -> bool`. `buildSnapshotFn() -> Snapshot`. `diffSnapshots(prev, next, thresholds) -> Event[]` from `./differ.js`. `dispatchEvents(...)` (Task 27). Persists snapshot via `atomicWriteFileSync(snapshotPath, JSON.stringify(snap))`.
- Produces `runPushCycle({...}) -> Promise<void>`. Behavior: if `!fcm.isPushEnabled()` return immediately (no read, no write). Else `snap = buildSnapshotFn()`; `prev` = JSON-parse of `snapshotPath` or `null` if absent/unreadable; if `prev !== null`, `events = diffSnapshots(prev, snap, thresholds)` then `await dispatchEvents(events, {store, fcm, logger})`. **Always** persist `snap` via `atomicWriteFileSync` (even on baseline) so the next cycle has a `prev`. Whole body wrapped in `try/catch` that logs and **swallows** — never rejects.

**Steps:**

- [ ] **Step 11: Write the failing test for `runPushCycle`.** Create `/home/ilaaj-agent/jaghelm/server/push/cycle.test.js`:
  ```js
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from 'fs';
  import { tmpdir } from 'os';
  import { join } from 'path';

  import { runPushCycle } from './dispatch.js';

  const silentLog = { info() {}, warn() {}, error() {}, debug() {} };

  // A minimal snapshot pair: baseline has a service up, next has it down.
  const SNAP_UP = { services: { 'n1:svc': 'up' }, hosts: {}, ups: { state: 'online' }, cron: {} };
  const SNAP_DOWN = { services: { 'n1:svc': 'down' }, hosts: {}, ups: { state: 'online' }, cron: {} };
  const THRESHOLDS = { cpu: 0.9, mem: 0.9, disk: 0.9, hysteresis: 0.05 };

  function tmpSnapshotPath() {
    const dir = mkdtempSync(join(tmpdir(), 'jaghelm-push-'));
    return { dir, path: join(dir, 'snapshot.json') };
  }

  function enabledFcm() {
    const calls = [];
    return {
      calls,
      isPushEnabled: () => true,
      sendToToken: async (token, event) => {
        calls.push({ token, type: event.type });
        return { ok: true, prune: false };
      },
    };
  }

  function oneTokenStore() {
    return {
      getAllTokens: () => [{ token: 'a' }],
      getPrefs: () => ({
        categories: { service: true, host: true, ups: true, cron: true },
        notifyRecoveries: true,
        enabled: true,
      }),
      removeToken: () => true,
    };
  }

  test('runPushCycle BASELINE: no prev file => persists snapshot, dispatches nothing', async () => {
    const { dir, path } = tmpSnapshotPath();
    const fcm = enabledFcm();
    try {
      await runPushCycle({
        buildSnapshotFn: () => SNAP_UP,
        store: oneTokenStore(),
        fcm,
        snapshotPath: path,
        thresholds: THRESHOLDS,
        logger: silentLog,
      });
      assert.equal(fcm.calls.length, 0, 'no dispatch on baseline');
      assert.ok(existsSync(path), 'snapshot persisted so next cycle has a prev');
      assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), SNAP_UP);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('runPushCycle WITH PREV: diffs, dispatches the change, persists new snapshot', async () => {
    const { dir, path } = tmpSnapshotPath();
    writeFileSync(path, JSON.stringify(SNAP_UP)); // prev = service up
    const fcm = enabledFcm();
    try {
      await runPushCycle({
        buildSnapshotFn: () => SNAP_DOWN, // now down
        store: oneTokenStore(),
        fcm,
        snapshotPath: path,
        thresholds: THRESHOLDS,
        logger: silentLog,
      });
      // up -> down => one service_down dispatched to the one token
      assert.equal(fcm.calls.length, 1);
      assert.equal(fcm.calls[0].type, 'service_down');
      // snapshot advanced to the new state
      assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), SNAP_DOWN);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('runPushCycle DISABLED: fcm.isPushEnabled false => no-op, no file write, no build', async () => {
    const { dir, path } = tmpSnapshotPath();
    let built = false;
    const fcm = { isPushEnabled: () => false, sendToToken: async () => ({ ok: true, prune: false }) };
    try {
      await runPushCycle({
        buildSnapshotFn: () => {
          built = true;
          return SNAP_UP;
        },
        store: oneTokenStore(),
        fcm,
        snapshotPath: path,
        thresholds: THRESHOLDS,
        logger: silentLog,
      });
      assert.equal(built, false, 'snapshot not even built when push disabled');
      assert.equal(existsSync(path), false, 'no snapshot file written when disabled');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('runPushCycle ERROR ISOLATION: a throwing dep => resolves, never rejects', async () => {
    const { dir, path } = tmpSnapshotPath();
    const throwingFcm = {
      isPushEnabled: () => true,
      sendToToken: async () => {
        throw new Error('fcm exploded');
      },
    };
    try {
      // buildSnapshotFn itself throwing must also be swallowed.
      await assert.doesNotReject(
        runPushCycle({
          buildSnapshotFn: () => {
            throw new Error('snapshot build exploded');
          },
          store: oneTokenStore(),
          fcm: throwingFcm,
          snapshotPath: path,
          thresholds: THRESHOLDS,
          logger: silentLog,
        })
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  ```

- [ ] **Step 12: Run it — Expected: FAIL** (`runPushCycle` not exported).
  `node --test server/push/cycle.test.js`

- [ ] **Step 13: Minimal impl — append `runPushCycle` to `dispatch.js` and add the file/differ imports.** First ensure the import block at the top of `/home/ilaaj-agent/jaghelm/server/push/dispatch.js` reads (adjust if Task 26's optional note left them out):
  ```js
  import { existsSync, readFileSync } from 'fs';

  import { atomicWriteFileSync } from '../util/atomicWrite.js';
  import { createLogger } from '../util/logger.js';
  import { diffSnapshots, RECOVERY_TYPES } from './differ.js';
  ```
  Then append at the end of the file:
  ```js
  /**
   * One push cycle: build the current snapshot, diff it against the persisted
   * previous snapshot, dispatch the resulting events, then persist the new
   * snapshot (ALWAYS — even on baseline — so the next cycle has a prev).
   *
   * Total error isolation: the entire body is wrapped so it can NEVER reject.
   * It runs inside the background refresh loop and must never break that loop.
   * Graceful-disable: if push has no FCM creds it returns immediately and does
   * not even read or write the snapshot file.
   *
   * @param {object} deps
   * @param {Function} deps.buildSnapshotFn  () => Snapshot (injected; fakeable)
   * @param {object}   deps.store            token store
   * @param {object}   deps.fcm              fcm module
   * @param {string}   deps.snapshotPath     path to the persisted prev snapshot
   * @param {object}   deps.thresholds       diff thresholds
   * @param {object}   [deps.logger]
   * @returns {Promise<void>}
   */
  export async function runPushCycle({ buildSnapshotFn, store, fcm, snapshotPath, thresholds, logger = defaultLog }) {
    try {
      if (!fcm.isPushEnabled()) return;

      const snap = buildSnapshotFn();

      let prev = null;
      if (existsSync(snapshotPath)) {
        try {
          prev = JSON.parse(readFileSync(snapshotPath, 'utf8'));
        } catch (err) {
          // Corrupt/partial snapshot => treat as baseline rather than crash.
          logger.warn({ err }, 'unreadable push snapshot, treating as baseline');
          prev = null;
        }
      }

      if (prev !== null) {
        const events = diffSnapshots(prev, snap, thresholds);
        if (events.length > 0) {
          const counts = await dispatchEvents(events, { store, fcm, logger });
          logger.info({ ...counts, events: events.length }, 'push cycle dispatched');
        }
      }

      // Always advance the persisted snapshot so the next cycle has a prev.
      atomicWriteFileSync(snapshotPath, JSON.stringify(snap));
    } catch (err) {
      // Swallow EVERYTHING. This runs inside the refresh loop; it must never
      // reject or the loop's allSettled accounting / health gate could be hurt.
      logger.error({ err }, 'push cycle error (swallowed)');
    }
  }
  ```

- [ ] **Step 14: Run it — Expected: PASS.**
  `node --test server/push/cycle.test.js`

- [ ] **Step 15: Run the whole push suite to confirm no regression.** Expected: PASS.
  `node --test server/push/`

- [ ] **Step 16: Commit.**
  `git add server/push/dispatch.js server/push/cycle.test.js && git commit -m "feat(push): runPushCycle orchestrator with always-persist + total error isolation"`

---

### Task 29: Wire `runPushCycle` into the background refresh loop

**Files:**
- Modify `/home/ilaaj-agent/jaghelm/server/refresh.js` — `runBackgroundRefresh` (the `try { … } finally { … }` block, currently lines ~330–353; the `try` does `Promise.allSettled([...])` then `log.info(...)`, the `finally` sets `bgRefreshRunning=false`, `lastRefreshComplete=Date.now()`, then `recordRefreshCycle(...)`). Add imports for `runPushCycle`, `createTokenStore`, the `fcm` module, `buildSnapshot`, `getThresholds`/defaults, and a module-level lazily-constructed `pushStore` + `pushSnapshotPath`.
- Test: `/home/ilaaj-agent/jaghelm/server/push/refresh-integration.test.js`

**Interfaces:**
- Consumes `runPushCycle` from `./push/dispatch.js`, `buildSnapshot` from `./push/snapshot.js`, `createTokenStore` from `./push/tokenStore.js`, the `fcm` singleton from `./push/fcm.js`, `DATA_DIR` from `./util/dataDir.js`.
- Produces an edited `runBackgroundRefresh` that calls `await runPushCycle({...})` **inside the `try`, after the `Promise.allSettled` + its `log.info`, and necessarily before `recordRefreshCycle(...)`** (which lives in `finally`, so simply being inside `try` satisfies "before recordRefreshCycle"). Because `runPushCycle` can never reject, it cannot flip `ok` to false or break the loop.

**Steps:**

- [ ] **Step 17: Write the failing integration test (a throwing push cycle does not break the refresh loop).** Create `/home/ilaaj-agent/jaghelm/server/push/refresh-integration.test.js`. This tests `runPushCycle`'s isolation contract at the seam the loop relies on, using fakes (the loop itself is hard to unit-drive; the wiring guarantee is "the call is awaited inside `try` and cannot reject"):
  ```js
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { mkdtempSync, rmSync } from 'fs';
  import { tmpdir } from 'os';
  import { join } from 'path';

  import { runPushCycle } from './dispatch.js';

  const silentLog = { info() {}, warn() {}, error() {}, debug() {} };

  // Mirror the refresh-loop body shape: allSettled of domain refreshes, then
  // an awaited runPushCycle, then recordRefreshCycle in finally. Prove that a
  // push cycle whose every dep throws leaves `ok` true and the loop intact.
  test('refresh-loop shape: a throwing push cycle keeps the cycle ok and reaches finally', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jaghelm-refresh-'));
    const path = join(dir, 'snapshot.json');
    let recorded = null;
    const recordRefreshCycle = (ms, ok) => {
      recorded = { ms, ok };
    };

    const throwingFcm = {
      isPushEnabled: () => true,
      sendToToken: async () => {
        throw new Error('boom');
      },
    };
    const store = {
      getAllTokens: () => [{ token: 'a' }],
      getPrefs: () => ({ categories: { service: true, host: true, ups: true, cron: true }, notifyRecoveries: true, enabled: true }),
      removeToken: () => true,
    };

    // The actual loop body, transcribed.
    const start = Date.now();
    let ok = true;
    try {
      await Promise.allSettled([Promise.resolve('services'), Promise.resolve('ups')]);
      await runPushCycle({
        buildSnapshotFn: () => {
          throw new Error('snapshot boom');
        },
        store,
        fcm: throwingFcm,
        snapshotPath: path,
        thresholds: { cpu: 0.9, mem: 0.9, disk: 0.9, hysteresis: 0.05 },
        logger: silentLog,
      });
    } catch (err) {
      ok = false; // must NOT happen — runPushCycle swallows
    } finally {
      recordRefreshCycle(Date.now() - start, ok);
    }

    assert.equal(ok, true, 'throwing push cycle did not flip the cycle to failed');
    assert.ok(recorded, 'finally still ran recordRefreshCycle');
    assert.equal(recorded.ok, true);

    rmSync(dir, { recursive: true, force: true });
  });
  ```

- [ ] **Step 18: Run it — Expected: PASS already** (it imports the real `runPushCycle`, which already swallows). This test is the **regression lock** on the wiring contract: it would FAIL if a future edit makes `runPushCycle` able to reject. Confirm it passes now, then proceed to the source edit (which has no separate red phase — it is a pure wiring change guarded by this lock + the existing refresh tests).
  `node --test server/push/refresh-integration.test.js`

- [ ] **Step 19: Edit `server/refresh.js` — add imports.** In the import block (after `import { recordRefreshCycle } from './metrics.js';`), add:
  ```js
  import { DATA_DIR } from './util/dataDir.js';
  import { runPushCycle } from './push/dispatch.js';
  import { buildSnapshot } from './push/snapshot.js';
  import { createTokenStore } from './push/tokenStore.js';
  import * as fcm from './push/fcm.js';
  ```
  (Note: `DATA_DIR` is already imported in `refresh.js` for `DISPLAY_CONFIG_PATH` — reuse the existing import; do **not** add a duplicate. Verify with `grep "DATA_DIR" server/refresh.js` before editing.)

- [ ] **Step 20: Edit `server/refresh.js` — add the lazily-constructed push store + snapshot path + thresholds helper** near the other module-level state (after `let lastRefreshComplete = 0;`):
  ```js
  // ── Push pipeline wiring ─────────────────────────────────────────────────
  // Snapshot of the prev cycle's state lives beside the other data/ stores.
  const PUSH_SNAPSHOT_PATH = join(DATA_DIR, 'push-snapshot.json');
  const DEFAULT_PUSH_THRESHOLDS = { cpu: 0.9, mem: 0.9, disk: 0.9, hysteresis: 0.05 };

  // Token store is constructed lazily on first cycle (after initPush has run at
  // boot) and reused thereafter.
  let pushStore = null;
  function getPushStore() {
    if (!pushStore) pushStore = createTokenStore({});
    return pushStore;
  }

  // Thresholds come from display-config when present, else the defaults. Read
  // through the same cached file the loop already touches.
  function getPushThresholds() {
    try {
      if (existsSync(DISPLAY_CONFIG_PATH)) {
        const data = JSON.parse(readFileSync(DISPLAY_CONFIG_PATH, 'utf8'));
        const t = data?.pushThresholds;
        if (t && typeof t === 'object') {
          return {
            cpu: typeof t.cpu === 'number' ? t.cpu : DEFAULT_PUSH_THRESHOLDS.cpu,
            mem: typeof t.mem === 'number' ? t.mem : DEFAULT_PUSH_THRESHOLDS.mem,
            disk: typeof t.disk === 'number' ? t.disk : DEFAULT_PUSH_THRESHOLDS.disk,
            hysteresis: typeof t.hysteresis === 'number' ? t.hysteresis : DEFAULT_PUSH_THRESHOLDS.hysteresis,
          };
        }
      }
    } catch {
      // fall through to defaults
    }
    return DEFAULT_PUSH_THRESHOLDS;
  }
  ```

- [ ] **Step 21: Edit `runBackgroundRefresh` — insert the awaited push cycle inside the `try`, after the `log.info(...)` and before the `finally`.** Change this exact block:
  ```js
    try {
      await Promise.allSettled([
        refreshServices(),
        refreshUPS(),
        refreshGitea(),
        refreshIntegrations(),
      ]);
      log.info({ ms: Date.now() - start }, 'background cycle complete');
    } catch (err) {
  ```
  to:
  ```js
    try {
      await Promise.allSettled([
        refreshServices(),
        refreshUPS(),
        refreshGitea(),
        refreshIntegrations(),
      ]);
      log.info({ ms: Date.now() - start }, 'background cycle complete');

      // Push cycle: diff this cycle's state vs the last and notify mobile
      // tokens. Self-contained — it can NEVER reject (see runPushCycle), so it
      // cannot flip `ok` or break the loop. No-ops when push is disabled.
      await runPushCycle({
        buildSnapshotFn: buildSnapshot,
        store: getPushStore(),
        fcm,
        snapshotPath: PUSH_SNAPSHOT_PATH,
        thresholds: getPushThresholds(),
        logger: log,
      });
    } catch (err) {
  ```
  (`recordRefreshCycle(...)` remains untouched in `finally`, so the push call is provably before it.)

- [ ] **Step 22: Run the integration lock + existing refresh tests + push suite — Expected: PASS.**
  `node --test server/push/refresh-integration.test.js && node --test server/push/ && (test -f server/refresh.test.js && node --test server/refresh.test.js || echo "no refresh.test.js")`

- [ ] **Step 23: Commit.**
  `git add server/refresh.js server/push/refresh-integration.test.js && git commit -m "feat(push): wire runPushCycle into background refresh loop (isolated, never breaks the loop)"`

---

### Task 30: Boot wiring — `initPush` in `server/index.js` + add `firebase-admin` to package.json

**Files:**
- Modify `/home/ilaaj-agent/jaghelm/server/index.js` — import `initPush` from `./push/fcm.js`; call `initPush({...})` inside `boot()` alongside the other `init*()` calls. (The push router factory + its mount are owned by the ROUTES task, Task 31 — NOT here.)
- Modify `/home/ilaaj-agent/jaghelm/package.json` — add `firebase-admin` to `dependencies`.
- Test: `/home/ilaaj-agent/jaghelm/server/push/boot-wiring.test.js` (asserts the app mounts `/api/push/status` and that with no creds it reports `enabled:false` — graceful-disable end to end through the real app, no firebase loaded). The mount itself is Task 31's; this test confirms boot does not break it.

**Interfaces:**
- Consumes `initPush({ credsPath, env, messagingFactory, logger }) -> void` and `isPushEnabled()` from `./push/fcm.js` (Task 20).
- Produces: `boot()` calls `initPush({ env: process.env, logger: log })` (no `messagingFactory` => default firebase-admin path, which stays disabled when no creds, never throwing); `firebase-admin` declared as a dependency (lazily loaded only via the default `messagingFactory`; the graceful-disable path never imports it). The router mount (`app.use('/api/push', authMiddleware, createPushRoutes({ store, fcm }))`) is owned by Task 31.

**Steps:**

- [ ] **Step 24: Write the failing boot-wiring test (graceful-disable through the real app).** Create `/home/ilaaj-agent/jaghelm/server/push/boot-wiring.test.js`:
  ```js
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import request from 'supertest';

  // Import the route-mounted app WITHOUT booting (per index.js: importing does
  // not bind a port or start loops). With no FCM creds in env, push must be
  // mounted but report disabled — and the desktop surface is untouched.
  import { app } from '../index.js';

  test('GET /api/push/status is mounted and reports enabled:false with no creds', async () => {
    const res = await request(app).get('/api/push/status');
    // 200 with {enabled:false}; if status sits behind auth and auth is enabled
    // in this env it may 401 — accept either, but never 404 (must be mounted).
    assert.notEqual(res.status, 404, '/api/push/status must be mounted');
    if (res.status === 200) {
      assert.equal(res.body.enabled, false, 'push disabled without creds');
    }
  });

  test('POST /api/push/register keeps the token even when delivery is disabled', async () => {
    const res = await request(app)
      .post('/api/push/register')
      .send({ token: 'tok-test', platform: 'android', appVersion: '1.0.0' });
    assert.notEqual(res.status, 404, '/api/push/register must be mounted');
    if (res.status === 200) {
      assert.equal(res.body.stored, true);
      assert.equal(res.body.deliveryEnabled, false);
    }
  });
  ```
  (Note for the implementer: if `authMiddleware` returns 401 for these in the test env, that still proves mounting — the `assert.notEqual(404)` is the load-bearing assertion. The status/register routes are behind `authMiddleware` per the contract; the graceful-disable *values* are additionally unit-tested in the Task-8 route tests where auth is stubbed.)

- [ ] **Step 25: Run it — Expected: FAIL** (router not mounted yet => 404; or import error because `./routes/push.js` / `initPush` import added in the next step doesn't exist — run BEFORE editing index.js so the failure is the missing mount).
  `node --test server/push/boot-wiring.test.js`

- [ ] **Step 26: Edit `server/index.js` — add imports.** After `import { startBackgroundRefresh, stopBackgroundRefresh } from './refresh.js';` add to the subsystem-initializers group:
  ```js
  import { initPush, isPushEnabled } from './push/fcm.js';
  ```
  (The `createPushRoutes` import and the router mount are added by Task 31, the ROUTES task — do NOT add a router import or mount here.)

- [ ] **Step 28: Edit `server/index.js` — call `initPush` in `boot()`.** In `boot()`, alongside the other `init*()` calls (after `initIconCache(dataDir);`, before `await initRegistry();`), add:
  ```js
    // Push (FCM) — graceful-disable when no service-account creds are present.
    // Never throws; isPushEnabled() stays false and the pipeline no-ops.
    initPush({ env: process.env, logger: log });
  ```

- [ ] **Step 29: Edit `package.json` — add `firebase-admin` to `dependencies`.** Add the entry to the `dependencies` object (keep the object alpha-sorted to match the file's convention):
  ```json
      "firebase-admin": "^13.0.0",
  ```
  Then install so the lockfile updates: `npm install firebase-admin@^13.0.0 --save`. (The graceful-disable path never imports it; it loads lazily only via the default `messagingFactory` when real creds exist.)

- [ ] **Step 30: Run the boot-wiring test + full push suite — Expected: PASS.**
  `node --test server/push/boot-wiring.test.js && node --test server/push/`

- [ ] **Step 31: Run the whole server test suite to confirm desktop is byte-unchanged (no regressions).** Expected: PASS.
  `npm test`

- [ ] **Step 32: Commit.**
  `git add server/index.js package.json package-lock.json server/push/boot-wiring.test.js && git commit -m "feat(push): boot wiring — initPush + firebase-admin dependency"`


---

Both patterns exist: most routes export a singleton router; `createUploadRoutes(upload)` is a factory that receives an injected dependency. Since the push router needs `fcm` and `store` singletons (which need test injection of a temp data dir / disabled push), the factory pattern `createPushRoutes({ store, fcm })` is the right, testable choice — matching `createUploadRoutes`. The push module singletons (`pushStore`, `pushFcm`) are created in earlier Phase 4 tasks and passed in at mount.

I have all conventions confirmed. Drafting the tasks now.

---

### Task 31: Push routes factory — module skeleton + GET /api/push/status

**Files:**
- Create `server/routes/push.js` (new — factory `createPushRoutes({ store, fcm })` returning an Express `Router`; mirrors the `createUploadRoutes(upload)` factory in `server/routes/upload.js:20`)
- Test: `server/routes/push.test.js` (new — `supertest` against the imported `app`, copying the harness from `server/index.test.js:1-29`: temp `JAGHELM_DATA_DIR`, `delete process.env.DASH_PASS` so auth is disabled, refused Prometheus/Kuma ports, `stopBackgroundRefresh()` in `after`)

**Interfaces:**
- Consumes: `fcm.isPushEnabled() -> bool` (from `server/push/fcm.js`, Task 22); `store` (token store from `server/push/tokenStore.js`, Task 17). Both injected into the factory so tests pass a stub `fcm`/`store` and never touch real FCM creds.
- Produces: `createPushRoutes({ store, fcm }) -> Router`. Route: `GET /api/push/status -> { enabled: fcm.isPushEnabled() }`.

Steps:

- [ ] **Step 1: Write the failing test for the status route + harness.** Create `server/routes/push.test.js`. This file owns the no-auth harness reused by Tasks 31-35; the 401 auth test gets its own file in Task 36 (auth is frozen at module load, so it needs a separate import).

```js
/**
 * Push API route contract (auth-disabled harness). Drives the imported app with
 * supertest against an isolated temp data dir, mirroring server/index.test.js.
 * Push is disabled (no FCM creds) — deliveryEnabled/enabled are therefore false,
 * which is exactly the graceful-disable path Phase 4 must keep unit-testable.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-push-'));
process.env.JAGHELM_DATA_DIR = dataDir;
delete process.env.DASH_PASS; // auth disabled
delete process.env.FCM_SERVICE_ACCOUNT; // push disabled (no creds)
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
process.env.PROMETHEUS_URL = 'http://127.0.0.1:1';
process.env.KUMA_URL = 'http://127.0.0.1:1';

const { app } = await import('../index.js');
const { stopBackgroundRefresh } = await import('../refresh.js');

after(() => {
  stopBackgroundRefresh();
  rmSync(dataDir, { recursive: true, force: true });
});

test('GET /api/push/status → 200 { enabled:false } when push is disabled', async () => {
  const r = await request(app).get('/api/push/status');
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /json/);
  assert.equal(r.body.enabled, false);
});
```

- [ ] **Step 2: Run it — fails.** `node --test server/routes/push.test.js` — Expected: FAIL (`server/routes/push.js` does not exist → import in `server/index.js` throws once wired, OR the route 404s before wiring). Run after Step 3's mount is in place if the import error blocks the suite; the intended red is the 404/`enabled` assertion. Expected: FAIL.

- [ ] **Step 3: Minimal impl — factory + status route.** Create `server/routes/push.js`:

```js
/**
 * Push notification API — token registration, delivery status, per-token prefs.
 *
 *   POST   /api/push/register  → register/refresh an FCM token
 *   DELETE /api/push/register  → remove a token
 *   GET    /api/push/status    → { enabled } delivery-availability probe
 *   GET    /api/push/prefs     → per-token notification prefs (defaults if unset)
 *   PUT    /api/push/prefs     → replace a token's prefs (400 on malformed)
 *
 * A factory (like createUploadRoutes) so the token store + fcm singletons are
 * injected — tests pass stubs and never load firebase-admin or real creds.
 * Mounted behind authMiddleware in server/index.js.
 */

import { Router } from 'express';
import { apiError } from '../errors.js';

export function createPushRoutes({ store, fcm }) {
  const router = Router();

  router.get('/status', (req, res) => {
    res.json({ enabled: fcm.isPushEnabled() });
  });

  return router;
}
```

Then wire it into `server/index.js`. Add the import alongside the other domain-route imports (after line 70, `import { systemRoutes } from './routes/system.js';`):

```js
import { createPushRoutes } from './routes/push.js';
```

Add push singleton construction in `boot()` is NOT needed here — the store/fcm singletons come from the Phase-4 push modules. Construct them at module scope alongside the router mount (the mount needs them synchronously, like `createUploadMiddleware`). Add, just below `const upload = createUploadMiddleware(uploadsDir);` (line 183) — note the store takes NO `path` arg so it resolves the env-aware `DATA_DIR` default (see the IMPORTANT comment below):

```js
// Push pipeline singletons. tokenStore persists under data/; fcm stays disabled
// until creds exist (initPush in boot()). Both injected into the router + cycle.
import { createTokenStore } from './push/tokenStore.js';
import * as fcm from './push/fcm.js';
// IMPORTANT: do NOT pass `path: join(dataDir, ...)` — index.js's local `dataDir`
// (join(__dirname,'..','data')) is env-UNAWARE and ignores JAGHELM_DATA_DIR,
// which would break route/auth/boot test isolation AND split the two push state
// files (tokens vs snapshot) under a relocated deploy. Use the factory default,
// whose DEFAULT_PATH = join(DATA_DIR, 'push-tokens.json') honors JAGHELM_DATA_DIR
// (same env-aware DATA_DIR refresh.js's getPushStore() uses — they stay unified).
const pushStore = createTokenStore();
```

(Move those two imports up to the import block with the others; shown inline here for locality.) Then add the mount alongside the other authed routers, immediately after the `/api/todos` mount (line 233):

```js
app.use('/api/push', authMiddleware, createPushRoutes({ store: pushStore, fcm }));
```

This is the exact mount line added to `server/index.js`.

- [ ] **Step 4: Run it — passes.** `node --test server/routes/push.test.js` — Expected: PASS.

- [ ] **Step 5: Commit.** `git add server/routes/push.js server/routes/push.test.js server/index.js && git commit -m "feat(push): add push routes factory + GET /api/push/status, mount behind auth"`

---

### Task 32: POST /api/push/register

**Files:**
- Modify `server/routes/push.js` (add `POST /` handler; the router from Task 31)
- Test: `server/routes/push.test.js` (add cases)

**Interfaces:**
- Consumes: `store.registerToken(token, { platform, appVersion }) -> record` (upsert, seeds DEFAULT_PREFS, refreshes lastSeenAt; from `server/push/tokenStore.js`); `fcm.isPushEnabled() -> bool`.
- Produces: `POST /api/push/register {token,platform,appVersion} -> { stored:true, deliveryEnabled: fcm.isPushEnabled() }`. Malformed (missing/empty `token`) → 400.

Steps:

- [ ] **Step 1: Write failing tests.** Append to `server/routes/push.test.js`:

```js
test('POST /api/push/register → { stored:true, deliveryEnabled:false } and persists the token', async () => {
  const r = await request(app)
    .post('/api/push/register')
    .send({ token: 'tok-aaa', platform: 'android', appVersion: '1.0.0' });
  assert.equal(r.status, 200);
  assert.equal(r.body.stored, true);
  assert.equal(r.body.deliveryEnabled, false); // push disabled in this harness
  // A second register (upsert) still succeeds and stays stored — proves the
  // route persists without depending on any not-yet-built endpoint. The
  // prefs-seeded-on-register readback is asserted in Task 34 (GET /prefs),
  // which is the producer of that endpoint, so Task 32 stays green standalone.
  const again = await request(app)
    .post('/api/push/register')
    .send({ token: 'tok-aaa', platform: 'android', appVersion: '1.1.0' });
  assert.equal(again.status, 200);
  assert.equal(again.body.stored, true);
});

test('POST /api/push/register → 400 when token is missing or blank', async () => {
  for (const body of [{}, { token: '' }, { token: '   ' }, { platform: 'android' }]) {
    const r = await request(app).post('/api/push/register').send(body);
    assert.equal(r.status, 400, `body ${JSON.stringify(body)} should 400`);
  }
});
```

- [ ] **Step 2: Run it — fails.** `node --test server/routes/push.test.js` — Expected: FAIL (no `POST /register` handler → JSON 404; and `/prefs` not yet implemented).

- [ ] **Step 3: Minimal impl.** In `server/routes/push.js`, inside `createPushRoutes`, before `return router;`:

```js
  router.post('/register', (req, res) => {
    const { token, platform, appVersion } = req.body || {};
    if (typeof token !== 'string' || token.trim() === '') {
      return apiError(res, 400, 'token required');
    }
    store.registerToken(token, { platform, appVersion });
    res.json({ stored: true, deliveryEnabled: fcm.isPushEnabled() });
  });
```

(Task 32's test is now self-contained — it no longer reads any endpoint built in a later task, so it goes red→green on its own. The prefs-seeded-on-register readback is asserted in Task 34, the producer of `GET /api/push/prefs`.)

- [ ] **Step 4: Run it — passes.** `node --test server/routes/push.test.js` — Expected: PASS (all register cases green in isolation; no later-task endpoint is read).

- [ ] **Step 5: Commit.** `git add server/routes/push.js server/routes/push.test.js && git commit -m "feat(push): POST /api/push/register stores token, returns deliveryEnabled"`

---

### Task 33: DELETE /api/push/register

**Files:**
- Modify `server/routes/push.js` (add `DELETE /` handler)
- Test: `server/routes/push.test.js` (add cases)

**Interfaces:**
- Consumes: `store.removeToken(token) -> bool` (from `server/push/tokenStore.js`).
- Produces: `DELETE /api/push/register {token} -> { removed: bool }`. Missing/blank `token` → 400.

Steps:

- [ ] **Step 1: Write failing tests.** Append to `server/routes/push.test.js`:

```js
test('DELETE /api/push/register → { removed:true } for a known token, false for unknown', async () => {
  await request(app).post('/api/push/register').send({ token: 'tok-del', platform: 'android' });
  const hit = await request(app).delete('/api/push/register').send({ token: 'tok-del' });
  assert.equal(hit.status, 200);
  assert.equal(hit.body.removed, true);
  const miss = await request(app).delete('/api/push/register').send({ token: 'tok-del' });
  assert.equal(miss.status, 200);
  assert.equal(miss.body.removed, false);
});

test('DELETE /api/push/register → 400 when token is missing', async () => {
  const r = await request(app).delete('/api/push/register').send({});
  assert.equal(r.status, 400);
});
```

- [ ] **Step 2: Run it — fails.** `node --test server/routes/push.test.js` — Expected: FAIL (no `DELETE /register` handler → JSON 404).

- [ ] **Step 3: Minimal impl.** In `server/routes/push.js`, before `return router;`:

```js
  router.delete('/register', (req, res) => {
    const { token } = req.body || {};
    if (typeof token !== 'string' || token.trim() === '') {
      return apiError(res, 400, 'token required');
    }
    res.json({ removed: store.removeToken(token) });
  });
```

- [ ] **Step 4: Run it — passes.** `node --test server/routes/push.test.js` — Expected: PASS.

- [ ] **Step 5: Commit.** `git add server/routes/push.js server/routes/push.test.js && git commit -m "feat(push): DELETE /api/push/register removes a token"`

---

### Task 34: GET /api/push/prefs

**Files:**
- Modify `server/routes/push.js` (add `GET /prefs` handler)
- Test: `server/routes/push.test.js` (add cases)

**Interfaces:**
- Consumes: `store.getPrefs(token) -> prefs` (returns `DEFAULT_PREFS` if unset; from `server/push/tokenStore.js`). `DEFAULT_PREFS = { categories: { service:true, host:true, ups:true, cron:true }, notifyRecoveries:true, enabled:true }`.
- Produces: `GET /api/push/prefs?token=T -> { prefs }`. Missing/blank `token` query → 400.

Steps:

- [ ] **Step 1: Write failing tests.** Append to `server/routes/push.test.js`:

```js
test('GET /api/push/prefs → defaults for an unknown token', async () => {
  const r = await request(app).get('/api/push/prefs').query({ token: 'never-seen' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.prefs, {
    categories: { service: true, host: true, ups: true, cron: true },
    notifyRecoveries: true,
    enabled: true,
  });
});

test('GET /api/push/prefs → 400 when token query param is missing', async () => {
  const r = await request(app).get('/api/push/prefs');
  assert.equal(r.status, 400);
});

test('GET /api/push/prefs → DEFAULT_PREFS for a freshly-registered token (seeded on register)', async () => {
  // Moved here from Task 32: GET /prefs is the producer of this endpoint, so the
  // register-then-read assertion belongs in this task (keeps Task 32 standalone).
  await request(app)
    .post('/api/push/register')
    .send({ token: 'tok-aaa', platform: 'android', appVersion: '1.0.0' });
  const p = await request(app).get('/api/push/prefs').query({ token: 'tok-aaa' });
  assert.equal(p.status, 200);
  assert.equal(p.body.prefs.enabled, true);
});
```

- [ ] **Step 2: Run it — fails.** `node --test server/routes/push.test.js` — Expected: FAIL (no `GET /prefs` handler → JSON 404).

- [ ] **Step 3: Minimal impl.** In `server/routes/push.js`, before `return router;`:

```js
  router.get('/prefs', (req, res) => {
    const token = req.query.token;
    if (typeof token !== 'string' || token.trim() === '') {
      return apiError(res, 400, 'token query param required');
    }
    res.json({ prefs: store.getPrefs(token) });
  });
```

- [ ] **Step 4: Run it — passes.** `node --test server/routes/push.test.js` — Expected: PASS (and the register-readback line from Task 32 Step 1 is now green).

- [ ] **Step 5: Commit.** `git add server/routes/push.js server/routes/push.test.js && git commit -m "feat(push): GET /api/push/prefs returns per-token prefs with defaults"`

---

### Task 35: PUT /api/push/prefs (validate + 400 on malformed)

**Files:**
- Modify `server/routes/push.js` (add `PUT /prefs` handler)
- Test: `server/routes/push.test.js` (add cases)

**Interfaces:**
- Consumes: `store.setPrefs(token, prefs) -> record` (validates + normalizes the prefs shape, persists; from `server/push/tokenStore.js`). PREFS SHAPE: `{ categories: { service:bool, host:bool, ups:bool, cron:bool }, notifyRecoveries:bool, enabled:bool }`.
- Produces: `PUT /api/push/prefs {token,prefs} -> { prefs }` (the normalized stored prefs). Missing `token` → 400; malformed `prefs` (not an object, wrong-typed fields, non-bool category) → 400.

Steps:

- [ ] **Step 1: Write failing tests.** Append to `server/routes/push.test.js`. The route validates the prefs shape locally before delegating to `store.setPrefs` (the store also validates, but the route owns the 400 contract so a malformed body never reaches persistence):

```js
test('PUT /api/push/prefs → stores + echoes the normalized prefs', async () => {
  const prefs = {
    categories: { service: true, host: false, ups: true, cron: false },
    notifyRecoveries: false,
    enabled: true,
  };
  const r = await request(app).put('/api/push/prefs').send({ token: 'tok-prefs', prefs });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.prefs, prefs);
  // Round-trips through the store on a subsequent GET.
  const g = await request(app).get('/api/push/prefs').query({ token: 'tok-prefs' });
  assert.deepEqual(g.body.prefs, prefs);
});

test('PUT /api/push/prefs → 400 on a missing token', async () => {
  const r = await request(app)
    .put('/api/push/prefs')
    .send({ prefs: { categories: { service: true, host: true, ups: true, cron: true }, notifyRecoveries: true, enabled: true } });
  assert.equal(r.status, 400);
});

test('PUT /api/push/prefs → 400 on malformed prefs', async () => {
  const bad = [
    undefined,
    null,
    'nope',
    {},                                              // no categories
    { categories: {}, notifyRecoveries: true, enabled: true },        // empty categories
    { categories: { service: 'yes', host: true, ups: true, cron: true }, notifyRecoveries: true, enabled: true }, // non-bool category
    { categories: { service: true, host: true, ups: true, cron: true }, notifyRecoveries: 1, enabled: true },     // non-bool flag
    { categories: { service: true, host: true, ups: true }, notifyRecoveries: true, enabled: true },              // missing cron
  ];
  for (const prefs of bad) {
    const r = await request(app).put('/api/push/prefs').send({ token: 'tok-bad', prefs });
    assert.equal(r.status, 400, `prefs ${JSON.stringify(prefs)} should 400`);
  }
});
```

- [ ] **Step 2: Run it — fails.** `node --test server/routes/push.test.js` — Expected: FAIL (no `PUT /prefs` handler → JSON 404).

- [ ] **Step 3: Minimal impl.** In `server/routes/push.js`, before `return router;`. Add a pure local validator (the route's 400 contract) above the factory or inside it:

```js
const CATEGORY_KEYS = ['service', 'host', 'ups', 'cron'];

function validPrefsShape(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return false;
  if (typeof p.notifyRecoveries !== 'boolean') return false;
  if (typeof p.enabled !== 'boolean') return false;
  const c = p.categories;
  if (!c || typeof c !== 'object' || Array.isArray(c)) return false;
  if (Object.keys(c).length !== CATEGORY_KEYS.length) return false;
  return CATEGORY_KEYS.every((k) => typeof c[k] === 'boolean');
}
```

Then the handler:

```js
  router.put('/prefs', (req, res) => {
    const { token, prefs } = req.body || {};
    if (typeof token !== 'string' || token.trim() === '') {
      return apiError(res, 400, 'token required');
    }
    if (!validPrefsShape(prefs)) {
      return apiError(res, 400, 'malformed prefs');
    }
    const record = store.setPrefs(token, prefs);
    res.json({ prefs: record.prefs ?? record });
  });
```

(`store.setPrefs` returns the record; the contract says it returns `record`. The stored prefs live on `record.prefs` per the tokenStore record shape — echo that. If Task 17 defined `setPrefs` to return the prefs object directly, the `?? record` fallback covers it; pin to one form when Task 17's signature is final.)

- [ ] **Step 4: Run it — passes.** `node --test server/routes/push.test.js` — Expected: PASS.

- [ ] **Step 5: Commit.** `git add server/routes/push.js server/routes/push.test.js && git commit -m "feat(push): PUT /api/push/prefs validates shape, 400 on malformed"`

---

### Task 36: Auth gate — every push route is 401 without a valid token

**Files:**
- Test: `server/routes/push.auth.test.js` (new — a SEPARATE file because `authEnabled()` is frozen at module load via `const AUTH_PASS_ENV = process.env.DASH_PASS` in `server/auth/passwords.js:26`; the no-auth harness in `push.test.js` already imported the app with auth disabled, so the 401 path needs its own import with `DASH_PASS` set *before* import)
- No production code change (the mount in `server/index.js` from Task 31 already places the router behind `authMiddleware`).

**Interfaces:**
- Consumes: `authMiddleware` (from `server/auth/middleware.js`) — returns 401 via `apiError` when auth is enabled and the `x-auth-token` header is absent/invalid. JagHelm auth is token=session via the `x-auth-token` header; there is NO username/password login. When no dashboard password is configured, `authEnabled()` is false and `authMiddleware` passes every request through (that is the no-auth harness Tasks 31–35 use). This task instead enables auth via the real env var `DASH_PASS` (per `server/auth/passwords.js`) and asserts a tokenless request is 401 — that alone proves the gate.
- Produces: every `/api/push/*` route → 401 without an `x-auth-token` header when auth is enabled.

Steps:

- [ ] **Step 1: Write failing test.** Create `server/routes/push.auth.test.js`. `DASH_PASS` is set BEFORE importing the app so `authEnabled()` is true for this module; a tokenless request to each route must 401:

```js
/**
 * Push routes sit behind authMiddleware. With auth ENABLED (DASH_PASS set), every
 * /api/push/* route rejects a request with NO x-auth-token header with 401 — that
 * alone proves the gate. JagHelm auth is token=session via x-auth-token; there is
 * no username/password login to perform here. Auth is frozen at module load
 * (DASH_PASS is read once in passwords.js), so this MUST be a separate file from
 * push.test.js — set DASH_PASS before importing the app.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-push-auth-'));
process.env.JAGHELM_DATA_DIR = dataDir;
process.env.DASH_PASS = 'test-pass-1234'; // auth ENABLED (set before import)
delete process.env.FCM_SERVICE_ACCOUNT;
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
process.env.PROMETHEUS_URL = 'http://127.0.0.1:1';
process.env.KUMA_URL = 'http://127.0.0.1:1';

const { app } = await import('../index.js');
const { stopBackgroundRefresh } = await import('../refresh.js');

after(() => {
  stopBackgroundRefresh();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DASH_PASS;
});

const ROUTES = [
  ['get', '/api/push/status'],
  ['get', '/api/push/prefs?token=t'],
  ['put', '/api/push/prefs'],
  ['post', '/api/push/register'],
  ['delete', '/api/push/register'],
];

test('every /api/push/* route → 401 without an x-auth-token header', async () => {
  for (const [method, path] of ROUTES) {
    const r = await request(app)[method](path).send({});
    assert.equal(r.status, 401, `${method.toUpperCase()} ${path} should 401 without a token`);
    assert.match(r.headers['content-type'], /json/);
  }
});
```

- [ ] **Step 2: Run it — fails or passes-by-accident; confirm red first.** `node --test server/routes/push.auth.test.js` — Expected: FAIL if the mount in Task 31 used the wrong middleware order or a route slipped outside `authMiddleware`. If Task 31's mount is correct, this is a guard test that should already be green; run it to PROVE the auth gate, and treat a green run as the passing state. To force a genuine red-first, temporarily mount push without `authMiddleware`, confirm FAIL, then restore. Expected (with correct mount): PASS.

- [ ] **Step 3: Minimal impl — none required.** The contract is satisfied by the Task 31 mount line `app.use('/api/push', authMiddleware, createPushRoutes({ store: pushStore, fcm }))`. If Step 2's red was forced by removing `authMiddleware`, restore it now.

- [ ] **Step 4: Run it — passes.** `node --test server/routes/push.auth.test.js` — Expected: PASS.

- [ ] **Step 5: Run the full push suite + commit.** `node --test server/routes/push.test.js server/routes/push.auth.test.js` — Expected: PASS. Then `git add server/routes/push.auth.test.js && git commit -m "test(push): assert all push routes are 401 without a valid token"`

---

Key grounding notes for the implementer (verified against the real repo):
- Harness is `supertest` against the imported `app` (no spawned port) — `server/index.test.js` / `server/cors.exposed.test.js` are the exact templates. Test files live at `server/routes/push.test.js` and `server/routes/push.auth.test.js`.
- `authEnabled()` reads `DASH_PASS` once at module load (`server/auth/passwords.js:26`) — the 401 file MUST set `DASH_PASS` before `await import('../index.js')`, hence a second test file.
- The router is a factory `createPushRoutes({ store, fcm })`, mirroring `createUploadRoutes(upload)` (`server/routes/upload.js:20`), so the `store`/`fcm` singletons are injectable and tests need no real FCM creds.
- Exact mount line added to `server/index.js` (alongside the other authed routers, after the `/api/todos` mount at line 233): `app.use('/api/push', authMiddleware, createPushRoutes({ store: pushStore, fcm }));`
- 400s use `apiError(res, 400, msg)` (`server/errors.js:17`); auth 401 comes from `authMiddleware` (`server/auth/middleware.js:18`). Run command: `node --test server/routes/push.test.js server/routes/push.auth.test.js`; full suite is root `npm test` (`node --test --test-force-exit`). No `Co-Authored-By` trailer on commits.


---

## Resolved design decisions (controller, 2026-06-26)

These were previously flagged for review; the controller has decided them. The tasks above already reflect each resolution.

1. **UPS `nut_status` map — Low Battery (3) folds into `on_battery`.** Per `src/components/Widgets.jsx`: `0=Unknown, 1=Online(OL), 2=On Battery(OB), 3=Low Battery(LB)`. `UPS_NUMERIC` maps `3 -> on_battery` (NOT `unknown`) so an Online→LowBattery jump still pages — a monitor must never drop the most urgent power event. `0`/unrecognized/null still fall through to `unknown`. `normalizeUpsStatus` impl + Task-1 tests + the grounding bullet updated accordingly.

2. **`DEFAULT_PREFS` has a single owner: `server/push/tokenStore.js`.** The dispatch module (Task 26) no longer defines or exports its own copy; `shouldDeliver` receives already-resolved prefs, and the dispatch test imports `DEFAULT_PREFS` from `./tokenStore.js`. No shared-constants module needed; the drift hazard is removed.

3. **Router factory + mount ownership belongs to the ROUTES task (Task 31).** Task 31 owns `createPushRoutes({ store, fcm })` and the mount `app.use('/api/push', authMiddleware, createPushRoutes({ store, fcm }))` (importing `authMiddleware` from `./auth/middleware.js`). The dispatch boot-wiring task (Task 30) owns ONLY `initPush(...)` at boot, the `firebase-admin` dependency, and (Task 29) the `await runPushCycle(...)` insertion before `recordRefreshCycle(...)`. The stale `pushRoutes` singleton shape was removed; `createPushRoutes` is the single router-factory name.

4. **Auth model in route tests is token=session via `x-auth-token` — no username/password login.** Positive route tests (Tasks 31–35) spawn the app with NO dashboard password (auth disabled, `authEnabled()` false → all requests pass, no header needed). The auth-gate test (Task 36) spawns WITH `DASH_PASS` set (the real env var per `server/auth/passwords.js`) and asserts a request with NO `x-auth-token` header returns 401 — that alone proves the gate. The username/password login flow was removed.
