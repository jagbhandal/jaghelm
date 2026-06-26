# JagHelm Mobile — Phase 3 (Read-only UX screens) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the four Phase-2 placeholder tab views with the real, read-only mobile UX over the *already-merged* desktop data layer: an **Overview** subsystem strip + inline incidents + node rows, a **Services** problems-first flat list with node tags / filter chips / search, an **Infra** node-card grid with a per-node detail, and an **Alerts** day-grouped push history with a full **Incident detail** screen — plus a lightweight intra-tab push/back navigation stack wired to hardware-back, and an **Open** deep-link action. Everything is READ-ONLY (no backend writes; Mute affordances hidden; notification-settings screen is Phase 5). Desktop stays byte-for-byte unchanged; only `mobile/` files change (plus, if needed, a *new additive* shared util that does not alter desktop behaviour).

**Architecture:** Phase 3 introduces NO new transport, storage, or boot code — it consumes the Phase-1 seams (`@shared/hooks/useData.js`: `getServices`/`getUPSStatus`/`getCronStatus`/`getMetricHistory`/`getServiceIcon`/`cachedIconUrl`, all base-aware through `getApiBase()`) and the Phase-2 shell. The server has **no "incident" object** — incidents and "degraded subsystems" are *derived in the mobile layer* from the raw `/services`, `/ups`, `/cron/status` bodies. All derivation lives in one **pure, framework-free module** `mobile/src/data/derive.js` (table-testable, no React) so the screens are thin renderers. A small **navigation stack** (`mobile/src/nav/useNavStack.js`, a `useReducer` over a per-screen `{screen, params}` array — NOT a router library) gives each tab a push/pop detail stack; `MobileApp.jsx` owns one stack and feeds hardware-back a "pop-then-exit" handler. Shared presentation atoms (status dot, bars, chips, search, sparkline-reuse) live in `mobile/src/components/`. A standalone **Playwright fixture harness** (`mobile/visual/`) renders each screen against canned fixtures to PNGs for human eyeballing — it is a dev tool, not shipped in the bundle.

**Tech Stack:** React 19 (`react`/`react-dom` 19), Vite 8 + `mobile/vite.config.mobile.js`, Vitest 4 (`vitest run --config vite.config.mobile.js`) + `@testing-library/react` 16 + `@testing-library/jest-dom` + jsdom (mobile units), the `@shared` alias onto `../src`, the merged data layer + `src/styles/global.css` tokens (reused via `var(--*)`), the existing `src/components/Sparkline.jsx` (reused via `@shared`), and Playwright/Chromium (system-installed, invoked from a self-contained `mobile/visual/shoot.mjs`) for the visual pass. **No new runtime dependency is added.**

## Global Constraints

- **READ-ONLY phase. No backend writes anywhere.** The only action is **Open** = navigation / deep-link to the underlying service `url` or the desktop view; it performs NO `POST`/`PUT`/`DELETE`. **Mute is cut from v1** — any Mute affordance is *not rendered* (hidden), not merely disabled-styled. The **notification-settings screen** (Alerts-tab gear) is **Phase 5**: Phase 3 renders the gear icon as a *visible-but-inert* affordance (it is allowed to exist as an Alerts-header element, but it opens nothing and wires no prefs — confirmed against DESIGN.md lines 39, 787, which place the settings screen + `PUT /api/push/prefs` in Phase 5). Prefer to render the gear **disabled with an accessible "Coming soon" label** rather than route anywhere.
- **Desktop web app behaviour stays byte-for-byte unchanged.** Phase 3 only adds files under `mobile/`. The one permitted touch to `src/` is *additive*: extracting the service-icon-fallback expression already in `ServiceCard.jsx` into a new `src/hooks/serviceIcon.js` helper **only if** mobile and desktop both consume it; if extracted, `ServiceCard.jsx` is refactored to call it and a test asserts ServiceCard still renders an identical icon `src` for the same input (no behaviour change). If this extraction is avoidable, **do not do it** (YAGNI) — mobile may call `getServiceIcon` directly. (Decision is taken in Task 2.)
- **Icons ALWAYS via the base-aware resolver.** Service icons resolve through `getServiceIcon(name)` → `cachedIconUrl()` → `getApiBase()`. NEVER construct a relative `/api/icons/cached` URL in mobile code: mobile origin is `https://localhost` and a relative path 404s. Every `<img src>` for a service icon comes from `getServiceIcon(...)`/`cachedIconUrl(...)`; a test asserts the produced URL begins with the *absolute* mobile base when `setApiBase('http://host:8080/api')` is active.
- **Reuse `global.css` tokens via `var(--*)`; no hardcoded colors that duplicate the token system.** Status colors are `var(--green)` / `var(--red)` / `var(--amber)` (+ their `-bg`/`-border` variants); accent `var(--accent)`; surfaces `var(--bg-card)` / `var(--bg-card-inner)` / `var(--glass-bg)`; text `var(--text-primary)` / `var(--text-secondary)` / `var(--text-muted)`; spacing `var(--space-*)`; radii `var(--card-radius)` / `var(--card-radius-sm)`; fonts `var(--font-display)` / `var(--font-body)` / `var(--font-mono)`; glass `var(--glass-blur)`. Safe-area insets via `env(safe-area-inset-*)`. One-hand layout: primary controls (tab bar, filter chips, search, back) sit in the bottom-reachable zone; tap targets ≥ 44px.
- **TDD with MOCKED data.** Every screen + atom + the derive module gets RTL/unit tests asserting the *real logic*: problems-first ordering, per-node grouping + up/down counts, degraded subsystem tinting, incident derivation + "+N more" collapse, filter chips + search, day-grouping of alert history, base-aware icon URL, nav push/pop, hardware-back pop-then-exit. Assertions are meaningful (assert ordering, counts, tint class, URL prefix — not just "renders").
- **Vitest 4 mock hoisting (HARD GOTCHA from Phase 2):** declare every `vi.fn()` mock via `vi.hoisted(() => ({ ... }))` and reference those handles inside `vi.mock(...)`. A top-level `const fn = vi.fn()` placed above `vi.mock` THROWS on Vitest 4. Follow the established pattern in `mobile/src/boot.test.js` exactly (hoisted handles → `vi.mock('@shared/...')` → import SUT → `beforeEach` reset).
- **Data shapes are FIXED by the server — do not invent them.** Consume the raw bodies exactly as `server/refresh.js` / `server/cron-store.js` produce them (see "Data shapes" below). Numeric node metrics are **strings** (`parseFloat` before use); `service.status` is `'up'|'down'|'unknown'` (treat `'running'` as up); per-service 24h uptime is the scalar `service.uptime24` (0–1 fraction, may be `null`); `/history` is node-level CPU/MEM/DISK series keyed `"${nodeKey}:${metric}"`, **not** per-service uptime.
- **VERIFICATION: a Playwright visual pass in addition to units.** `mobile/visual/shoot.mjs` renders each screen against the fixtures in `mobile/visual/fixtures.js` (states: all-calm, a degraded subsystem, multiple active incidents, a down service, a node detail, an incident detail) to PNGs under `mobile/visual/out/` (gitignored) using the `/tmp/shotter`-style Chromium approach (launch → `page.goto(file://…)` → `document.fonts.ready` → screenshot). The human eyeballs the PNGs. The harness is a dev tool: it is NOT imported by the app and NOT part of `npm run build`.
- **No secrets; secret-scan stays green.** No tokens, keys, URLs-with-creds, or `google-services.json` content anywhere. Fixture data is synthetic homelab-looking strings only. Run `python3 scripts/secret-scan.py --check` (or the repo's floor entrypoint) before the final commit.
- **Bite-sized steps, complete code, no placeholders.** Each step: failing test → run (fails) → minimal real impl → run (passes) → commit. DRY / YAGNI: a presentation atom used by ≥2 screens lives in `mobile/src/components/`; one used by a single screen stays local to it.
- **Mandatory pre-done gate (HARD RULE):** after the last task, run `/simplify` then `/security-review` before calling Phase 3 done. The human merge gate (Jag reviews + merges the PR) is never bypassed — branch → PR, no push to main, no auto-merge, no `--no-verify`, no `Co-Authored-By` trailer.

### Data shapes (ground-truth — verified against the current tree; do NOT invent)

`getServices()` → `{ nodes: { [nodeKey]: Node } }` where `nodeKey ∈ { 'vm-101','vm-103','gateway-pi', ... }`:
```
Node = {
  display_name: string,           // e.g. "VM 101"
  subtitle: string,               // may be ''
  icon: string,                   // emoji or path, e.g. '🖥'
  border_color: string,           // hex, default '#6366f1'
  metrics: {                      // ALL VALUES ARE STRINGS (parseFloat before math) or null
    cpu, memUsedGB, memTotalGB, memPercent, memWithCachePercent, memCacheGB,
    uptime, temp, diskUsed, diskTotal, diskUnit /* 'GB'|'TB' */, diskPercent
  },
  services: Service[]             // server pre-sorts ALPHABETICALLY by display_name
}
Service = {
  container: string,
  uid: string,                    // `${nodeKey}:${container}` — globally unique, use as React key
  display_name: string,
  icon: string|null,              // override icon name; falls back to display_name/name match
  status: 'up'|'down'|'unknown',  // 'running' also counts as up
  monitored: boolean,
  ping: number|null,              // ms
  uptime24: number|null,          // 0–1 fraction (NOTE: server field is `uptime24`; desktop ServiceCard reads `.uptime` after an upstream rename — mobile consumes the RAW body, so use `uptime24`)
  docker: { cpu, memMB, rxMB, txMB } | null,
  integration: null
}
```
Mobile note: the raw `Service` has **no `node` field** — node membership is the `nodeKey` of the `nodes` entry it came from. Mobile's flatten step (derive.js) attaches `nodeKey` + `nodeName` to each service.

`getUPSStatus()` → `{ status: number|null, charge: number|null, runtime: number|null, load: number|null }`. `status`: `1`=online, `0`=on-battery, `null`=telemetry unavailable. `charge`/`load` are 0–100; `runtime` is seconds. Degraded ⇔ `status === 0` (on battery). `null` everywhere ⇒ "unavailable" (treat as calm/unknown, NOT degraded — absence of data is not an incident).

`getCronStatus()` → `Array<{ node: string, jobs: Array<{ job: string, runs: Run[] }> }>` where `Run = { status: 'success'|'failure', timestamp: ISO8601, duration_seconds?: number, schedule?: string, error?: string }`; `runs` are newest-first, ≤3. Degraded ⇔ the newest run of any job has `status === 'failure'`; the `error` string (if present) is the cause.

`getMetricHistory()` → `{ [`${nodeKey}:${metric}`]: number[] }`, `metric ∈ {'cpu','mem','disk'}`, values 0–100, oldest→newest (~1h window). This feeds node-row sparklines, NOT per-service uptime.

`getServiceIcon(name) → string|null` and `cachedIconUrl(url) → string|null` are pure + base-aware. `<img src>` is the returned string; render nothing when `null`.

`Sparkline` (`@shared/components/Sparkline.jsx`) default export: `<Sparkline data={number[]} width height domain={[min,max]} color className />`; returns `null` when `data.length < 2`.

---

## File Structure

Every path is relative to the repo root (`/home/ilaaj-agent/worktrees/jaghelm-mobile-phase3`). NEW unless marked MODIFY/REPLACE.

| Path | Responsibility |
|---|---|
| `mobile/src/data/derive.js` | **Pure** derivation (no React): `flattenServices(servicesBody)`, `sortProblemsFirst(list)`, `groupByNode(servicesBody)`, `nodeUpDown(node)`, `parseMetricPct(str)`, `deriveSubsystems({services,ups,cron})`, `deriveIncidents({services,ups,cron})`, `cronDegraded(cronBody)`, `upsDegraded(upsBody)`, `serviceIsProblem(svc)`. Table-tested. |
| `mobile/src/data/derive.test.js` | Unit tests for every `derive.js` function (ordering, grouping, counts, degraded, incidents). |
| `mobile/src/data/useDashboard.js` | React hook: fetches `getServices`/`getUPSStatus`/`getCronStatus`/`getMetricHistory` once + on a 30s interval, exposes `{ servicesBody, ups, cron, history, loading, error }`. Thin; all *shaping* is `derive.js`. |
| `mobile/src/data/useDashboard.test.js` | Hook test (mocks `@shared/hooks/useData.js`; asserts it calls the fetchers + surfaces bodies + error). |
| `mobile/src/nav/useNavStack.js` | `useNavStack(rootScreen)` → `{ stack, current, push(screen,params), pop(), reset(), canPop }` via `useReducer`. No router lib. |
| `mobile/src/nav/useNavStack.test.js` | Reducer/hook tests (push/pop/reset/canPop). |
| `mobile/src/components/StatusDot.jsx` | Glowing status dot + redundant glyph + SR label (up/down/unknown). Reused by ≥2 screens. |
| `mobile/src/components/UsageBar.jsx` | Labeled CPU/MEM/DISK/TEMP bar (`label`, `value`, `unit`, `percent`, severity color). Reused. |
| `mobile/src/components/FilterChips.jsx` | Horizontal scrollable chip row (`chips`, `active`, `onChange`). Reused (Services; Infra detail optional). |
| `mobile/src/components/SearchBar.jsx` | Controlled search input (`value`, `onChange`, `placeholder`). Reused. |
| `mobile/src/components/ServiceRow.jsx` | One service row: base-aware icon, name, node tag, status dot, ping; `onOpen`/`onTap`. Reused (Services list + node-detail list). |
| `mobile/src/components/IncidentCard.jsx` | Expanded incident: cause + 24h-uptime spark/scalar + **Open**; used by Overview (inline) + Alerts (pinned). |
| `mobile/src/components/SubsystemStrip.jsx` | The 4 subsystem cells (Services/Nodes/UPS/Cron), green/red, alarm-tinted when degraded. |
| `mobile/src/components/NodeCard.jsx` | Compact node card: name, type/subtitle, CPU/MEM/DISK or TEMP bars, "N up / M down"; `onTap`. |
| `mobile/src/components/*.test.jsx` | One RTL test file per component above. |
| `mobile/src/views/Overview.jsx` (REPLACE) | Subsystem strip + inline incidents (+ "+N more") + compact node rows. |
| `mobile/src/views/Services.jsx` (REPLACE) | Flat problems-first list + node tags + filter chips (All/Down/per-node) + search + tap→ServiceDetail. |
| `mobile/src/views/ServiceDetail.jsx` | Single-service detail screen (status, node, ping, 24h uptime, docker stats, **Open**). |
| `mobile/src/views/Infra.jsx` (REPLACE) | Node-card grid + tap→NodeDetail. |
| `mobile/src/views/NodeDetail.jsx` | One node: full metrics + that node's service list (reuses `ServiceRow`). |
| `mobile/src/views/Alerts.jsx` (REPLACE) | History grouped by day + pinned active incident + inert gear; tap→IncidentDetail. |
| `mobile/src/views/IncidentDetail.jsx` | Full incident: status, node, cause, 24h uptime, event timeline (incl. "push sent" placeholder), **Open**. |
| `mobile/src/views/*.test.jsx` | One RTL test file per view above. |
| `mobile/src/open.js` | `openTarget(target)` — read-only deep-link/navigation (opens `service.url` via `window.open`/`Browser` if present, else no-op). No backend write. |
| `mobile/src/open.test.js` | Unit test (asserts it navigates to the url and never calls a writing fetch). |
| `mobile/src/MobileApp.jsx` (MODIFY) | Own one `useNavStack` per active tab; render `current.screen`; wire hardware-back to pop-then-exit; pass `nav` + `useDashboard()` data down. |
| `mobile/src/MobileApp.test.jsx` (MODIFY/NEW) | Assert tab switch resets detail stack; hardware-back pops a detail before exiting. |
| `mobile/src/MobileApp.css` (MODIFY) | Add Phase-3 layout classes (subsystem grid, chips row, node card grid, incident card, row, detail headers, back button) — all `var(--*)` tokens + safe-area. |
| `mobile/visual/fixtures.js` | Exported fixture bodies (calm, degraded subsystem, multi-incident, down-service, node-detail, incident-detail) as plain JS objects matching the real shapes. |
| `mobile/visual/render.html` | Static HTML harness that mounts a chosen screen+fixture (queried via `?screen=...`) for screenshotting. |
| `mobile/visual/shoot.mjs` | Chromium runner: for each `(screen,fixture)`, `goto(file://render.html?…)`, wait fonts, screenshot to `out/<name>.png`. |
| `mobile/.gitignore` (MODIFY) | Add `visual/out/`. |
| `.harness-ledger.md` (MODIFY) | Append Phase-3 captures/gaps (no-server-incident-model ⇒ derive in client; `uptime24` vs `.uptime` rename; visual-pass-as-dev-tool). |

---

## Task 1: Pure derivation module (`derive.js`) — the data brain

**Files:**
- Create: `mobile/src/data/derive.js`
- Test: `mobile/src/data/derive.test.js`

**Interfaces (produced):**
- `parseMetricPct(str): number|null` — `parseFloat` a string metric, `null` on non-finite.
- `serviceIsProblem(svc): boolean` — `svc.status === 'down'` (the problem predicate; `'unknown'` is NOT a problem).
- `flattenServices(servicesBody): Service[]` — flattens `{nodes}` to a flat array, each item augmented with `nodeKey` + `nodeName`.
- `sortProblemsFirst(list): Service[]` — stable: down first, then existing (alphabetical) order; never mutates input.
- `groupByNode(servicesBody): Array<{nodeKey,node,services}>` — preserves `Object.entries` order.
- `nodeUpDown(node): {up:number, down:number}` — counts `up`/`running` vs `down` (unknown counts as neither up nor down for "down", but DOES count toward "up"? — see step: down = `status==='down'`; up = everything else, so `up = total - down`).
- `upsDegraded(upsBody): boolean` — `ups.status === 0`.
- `cronDegraded(cronBody): boolean` — any job's newest run `status === 'failure'`.
- `deriveSubsystems({services,ups,cron}): Array<{key,label,degraded,detail}>` — the 4 cells.
- `deriveIncidents({services,ups,cron}): Incident[]` — one incident per down service + on-battery UPS + failing cron, each `{ id, kind, title, node, cause, uptime24, status, target }`, ordered services→ups→cron then by `id` for stability.

**Interfaces (consumed):** none (pure).

- [ ] **Step 1: Write failing tests** for `parseMetricPct`, `serviceIsProblem`, `flattenServices`, `sortProblemsFirst`.

Create `mobile/src/data/derive.test.js`:
```js
import { describe, it, expect } from 'vitest';
import {
  parseMetricPct, serviceIsProblem, flattenServices, sortProblemsFirst,
  groupByNode, nodeUpDown, upsDegraded, cronDegraded,
  deriveSubsystems, deriveIncidents,
} from './derive.js';

const SERVICES_BODY = {
  nodes: {
    'vm-101': {
      display_name: 'VM 101', subtitle: 'app', icon: '🖥', border_color: '#6366f1',
      metrics: { cpu: '45.3', memPercent: '31.2', diskPercent: '55.6', diskUnit: 'GB', temp: null },
      services: [
        { uid: 'vm-101:adguard', container: 'adguard', display_name: 'AdGuard', name: 'AdGuard', icon: null, status: 'up', ping: 12, uptime24: 0.999, url: 'http://h/adguard', docker: null },
        { uid: 'vm-101:gitea', container: 'gitea', display_name: 'Gitea', name: 'Gitea', icon: null, status: 'down', ping: null, uptime24: 0.42, url: 'http://h/gitea', docker: null },
      ],
    },
    'gateway-pi': {
      display_name: 'Gateway Pi', subtitle: 'edge', icon: '🍓', border_color: '#34d399',
      metrics: { cpu: '8.0', memPercent: '40.0', temp: '52.1', diskPercent: '20.0', diskUnit: 'GB' },
      services: [
        { uid: 'gateway-pi:pihole', container: 'pihole', display_name: 'Pi-hole', name: 'Pi-hole', icon: null, status: 'unknown', ping: null, uptime24: null, url: '', docker: null },
      ],
    },
  },
};

describe('parseMetricPct', () => {
  it('parses string metrics to numbers', () => expect(parseMetricPct('45.3')).toBeCloseTo(45.3));
  it('returns null for null/garbage', () => {
    expect(parseMetricPct(null)).toBeNull();
    expect(parseMetricPct('n/a')).toBeNull();
  });
});

describe('serviceIsProblem', () => {
  it('only down is a problem', () => {
    expect(serviceIsProblem({ status: 'down' })).toBe(true);
    expect(serviceIsProblem({ status: 'up' })).toBe(false);
    expect(serviceIsProblem({ status: 'unknown' })).toBe(false);
  });
});

describe('flattenServices', () => {
  it('flattens and attaches nodeKey/nodeName', () => {
    const flat = flattenServices(SERVICES_BODY);
    expect(flat).toHaveLength(3);
    const gitea = flat.find((s) => s.uid === 'vm-101:gitea');
    expect(gitea.nodeKey).toBe('vm-101');
    expect(gitea.nodeName).toBe('VM 101');
  });
  it('tolerates a null/empty body', () => {
    expect(flattenServices(null)).toEqual([]);
    expect(flattenServices({ nodes: {} })).toEqual([]);
  });
});

describe('sortProblemsFirst', () => {
  it('puts down services first, keeps the rest stable, does not mutate', () => {
    const flat = flattenServices(SERVICES_BODY);
    const input = [...flat];
    const sorted = sortProblemsFirst(flat);
    expect(sorted[0].status).toBe('down');
    expect(sorted.map((s) => s.uid)).toEqual([
      'vm-101:gitea', 'vm-101:adguard', 'gateway-pi:pihole',
    ]);
    expect(flat).toEqual(input); // unmutated
  });
});
```

- [ ] **Step 2: Run the test — it fails** (no `derive.js`).
```
cd mobile && npm test -- src/data/derive.test.js
```
Expected: `Failed to resolve import "./derive.js"` / suite errors.

- [ ] **Step 3: Implement the first four functions** in `mobile/src/data/derive.js`:
```js
/**
 * Pure, framework-free derivation for the mobile screens. The server has NO
 * "incident" object; incidents and "degraded subsystems" are derived here from
 * the raw /services, /ups, /cron/status bodies so screens stay thin renderers.
 * Nothing in this file imports React or does I/O — it is table-testable.
 */

/** parseFloat a string metric (node metrics arrive as strings); null if non-finite. */
export function parseMetricPct(str) {
  const n = parseFloat(str);
  return Number.isFinite(n) ? n : null;
}

/** A service is a "problem" iff it is explicitly down. 'unknown' is not a problem. */
export function serviceIsProblem(svc) {
  return (svc && svc.status) === 'down';
}

/** Flatten { nodes:{key:{services}} } → flat Service[] tagged with nodeKey/nodeName. */
export function flattenServices(servicesBody) {
  const nodes = servicesBody && servicesBody.nodes;
  if (!nodes) return [];
  const out = [];
  for (const [nodeKey, node] of Object.entries(nodes)) {
    for (const svc of node.services || []) {
      out.push({ ...svc, nodeKey, nodeName: node.display_name || nodeKey });
    }
  }
  return out;
}

/** Stable problems-first sort (down → rest, original order preserved). No mutation. */
export function sortProblemsFirst(list) {
  return [...list]
    .map((s, i) => [s, i])
    .sort((a, b) => {
      const pa = serviceIsProblem(a[0]) ? 0 : 1;
      const pb = serviceIsProblem(b[0]) ? 0 : 1;
      return pa - pb || a[1] - b[1];
    })
    .map(([s]) => s);
}
```

- [ ] **Step 4: Run — passes.**
```
cd mobile && npm test -- src/data/derive.test.js
```
Expected: the 4 described blocks pass.

- [ ] **Step 5: Add failing tests** for grouping + degraded + subsystems + incidents. Append to `derive.test.js`:
```js
describe('groupByNode + nodeUpDown', () => {
  it('groups services under their node in entries order', () => {
    const groups = groupByNode(SERVICES_BODY);
    expect(groups.map((g) => g.nodeKey)).toEqual(['vm-101', 'gateway-pi']);
    expect(groups[0].services).toHaveLength(2);
  });
  it('counts up/down per node (unknown is not down)', () => {
    const node = SERVICES_BODY.nodes['vm-101'];
    expect(nodeUpDown(node)).toEqual({ up: 1, down: 1 });
    const pi = SERVICES_BODY.nodes['gateway-pi'];
    expect(nodeUpDown(pi)).toEqual({ up: 1, down: 0 }); // unknown counts as up-side
  });
});

describe('upsDegraded / cronDegraded', () => {
  it('ups on battery is degraded; online or null is not', () => {
    expect(upsDegraded({ status: 0 })).toBe(true);
    expect(upsDegraded({ status: 1 })).toBe(false);
    expect(upsDegraded({ status: null })).toBe(false);
  });
  it('cron is degraded iff a job newest run failed', () => {
    const ok = [{ node: 'pi', jobs: [{ job: 'a', runs: [{ status: 'success', timestamp: 't' }] }] }];
    const bad = [{ node: 'pi', jobs: [{ job: 'b', runs: [{ status: 'failure', timestamp: 't', error: 'boom' }] }] }];
    expect(cronDegraded(ok)).toBe(false);
    expect(cronDegraded(bad)).toBe(true);
    expect(cronDegraded(null)).toBe(false);
  });
});

describe('deriveSubsystems', () => {
  it('marks Services + Cron degraded, Nodes + UPS calm', () => {
    const cron = [{ node: 'pi', jobs: [{ job: 'b', runs: [{ status: 'failure', timestamp: 't', error: 'boom' }] }] }];
    const cells = deriveSubsystems({ services: SERVICES_BODY, ups: { status: 1 }, cron });
    const byKey = Object.fromEntries(cells.map((c) => [c.key, c.degraded]));
    expect(byKey.services).toBe(true);  // gitea down
    expect(byKey.nodes).toBe(false);
    expect(byKey.ups).toBe(false);
    expect(byKey.cron).toBe(true);
    expect(cells.map((c) => c.key)).toEqual(['services', 'nodes', 'ups', 'cron']);
  });
});

describe('deriveIncidents', () => {
  it('emits one incident per down service, on-battery UPS, failing cron — ordered + stable', () => {
    const cron = [{ node: 'pi', jobs: [{ job: 'backup', runs: [{ status: 'failure', timestamp: 't', error: 'disk full' }] }] }];
    const incidents = deriveIncidents({ services: SERVICES_BODY, ups: { status: 0, charge: 80 }, cron });
    expect(incidents.map((i) => i.kind)).toEqual(['service', 'ups', 'cron']);
    const svc = incidents[0];
    expect(svc.id).toBe('service:vm-101:gitea');
    expect(svc.node).toBe('VM 101');
    expect(svc.uptime24).toBe(0.42);
    expect(incidents.find((i) => i.kind === 'cron').cause).toBe('disk full');
    // stability: same logical input in different node order yields same ids order
    const ids = incidents.map((i) => i.id);
    expect(ids).toEqual([...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).sort((a, b) => {
      const rank = (s) => (s.startsWith('service') ? 0 : s.startsWith('ups') ? 1 : 2);
      return rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0);
    }));
  });
});
```

- [ ] **Step 6: Run — fails** (functions missing).
```
cd mobile && npm test -- src/data/derive.test.js
```
Expected: ReferenceError/undefined for `groupByNode` etc.

- [ ] **Step 7: Implement the rest** in `derive.js` (append):
```js
/** Group services under their node, preserving Object.entries order. */
export function groupByNode(servicesBody) {
  const nodes = (servicesBody && servicesBody.nodes) || {};
  return Object.entries(nodes).map(([nodeKey, node]) => ({
    nodeKey, node, services: node.services || [],
  }));
}

/** Count up vs down for a node. down = explicit 'down'; up = everything else. */
export function nodeUpDown(node) {
  const services = (node && node.services) || [];
  let down = 0;
  for (const s of services) if (s.status === 'down') down += 1;
  return { up: services.length - down, down };
}

export function upsDegraded(ups) {
  return !!ups && ups.status === 0;
}

export function cronDegraded(cronBody) {
  if (!Array.isArray(cronBody)) return false;
  return cronBody.some((n) =>
    (n.jobs || []).some((j) => (j.runs || [])[0]?.status === 'failure')
  );
}

/** Newest-run failure cause for a cron body, or null. (Helper for incidents.) */
function firstCronFailure(cronBody) {
  if (!Array.isArray(cronBody)) return null;
  for (const n of cronBody) {
    for (const j of n.jobs || []) {
      const run = (j.runs || [])[0];
      if (run && run.status === 'failure') {
        return { node: n.node, job: j.job, cause: run.error || 'Job failed', run };
      }
    }
  }
  return null;
}

/** The 4 Overview subsystem cells. degraded drives the alarm tint. */
export function deriveSubsystems({ services, ups, cron }) {
  const flat = flattenServices(services);
  const downCount = flat.filter(serviceIsProblem).length;
  const nodeCount = Object.keys((services && services.nodes) || {}).length;
  return [
    { key: 'services', label: 'Services', degraded: downCount > 0, detail: downCount ? `${downCount} down` : `${flat.length} up` },
    { key: 'nodes', label: 'Nodes', degraded: false, detail: `${nodeCount} online` },
    { key: 'ups', label: 'UPS', degraded: upsDegraded(ups), detail: upsDegraded(ups) ? 'On battery' : 'Mains' },
    { key: 'cron', label: 'Cron', degraded: cronDegraded(cron), detail: cronDegraded(cron) ? 'Job failed' : 'Healthy' },
  ];
}

/**
 * Derive active incidents from down services + on-battery UPS + failing cron.
 * Ordered service→ups→cron then by id; ids are deterministic so the list is
 * stable across input reordering. Each incident carries an Open `target`.
 */
export function deriveIncidents({ services, ups, cron }) {
  const incidents = [];
  for (const svc of flattenServices(services)) {
    if (svc.status === 'down') {
      incidents.push({
        id: `service:${svc.uid}`, kind: 'service', title: svc.display_name,
        node: svc.nodeName, cause: 'Service is down', uptime24: svc.uptime24 ?? null,
        status: 'down', target: { kind: 'service', uid: svc.uid, url: svc.url || '' },
      });
    }
  }
  if (upsDegraded(ups)) {
    incidents.push({
      id: 'ups:apcups', kind: 'ups', title: 'UPS on battery', node: 'UPS',
      cause: `On battery${ups.charge != null ? ` — ${Math.round(ups.charge)}% charge` : ''}`,
      uptime24: null, status: 'down', target: { kind: 'ups' },
    });
  }
  const cf = firstCronFailure(cron);
  if (cf) {
    incidents.push({
      id: `cron:${cf.node}:${cf.job}`, kind: 'cron', title: `${cf.job} failed`, node: cf.node,
      cause: cf.cause, uptime24: null, status: 'down', target: { kind: 'cron', job: cf.job },
    });
  }
  const rank = (k) => (k === 'service' ? 0 : k === 'ups' ? 1 : 2);
  return incidents.sort((a, b) => rank(a.kind) - rank(b.kind) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
```

- [ ] **Step 8: Run — all pass.**
```
cd mobile && npm test -- src/data/derive.test.js
```
Expected: all describe blocks green.

- [ ] **Step 9: Commit.**
```
cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase3 && git add mobile/src/data/derive.js mobile/src/data/derive.test.js && git commit -m "feat(mobile): pure derivation module for subsystems/incidents/sort"
```

---

## Task 2: Shared presentation atoms (StatusDot, UsageBar, base-aware icon)

Folds the cross-screen atoms into one task because each is consumed by ≥2 screens. Also takes the icon-extraction decision.

**Files:**
- Create: `mobile/src/components/StatusDot.jsx` + `.test.jsx`
- Create: `mobile/src/components/UsageBar.jsx` + `.test.jsx`
- Create: `mobile/src/components/ServiceRow.jsx` + `.test.jsx`
- (Decision) optionally Create: `src/hooks/serviceIcon.js` + Modify `src/components/ServiceCard.jsx` + add `src/components/ServiceCard.icon.test.jsx`

**Interfaces:**
- Consumes: `@shared/hooks/useData.js` `getServiceIcon(name)`, `@shared/api/baseUrl.js` `setApiBase`/`getApiBase`, `derive.js` `serviceIsProblem`.
- Produces: `<StatusDot status />`, `<UsageBar label value unit percent />`, `<ServiceRow service onOpen onTap />`.

**Icon-extraction decision (resolve here):** ServiceCard's expression is `service.icon ? getServiceIcon(service.icon) || getServiceIcon(service.name) : getServiceIcon(service.name)`. Mobile's `Service` has no `name`, only `display_name`/`container`. Rather than touch desktop, mobile's `ServiceRow` resolves with `getServiceIcon(service.icon) || getServiceIcon(service.display_name)` directly. **DO NOT extract** a shared helper (YAGNI — the desktop expression keys off a `.name` field mobile doesn't carry). Record this decision in the ledger (Task 11).

- [ ] **Step 1: Failing test — StatusDot** `mobile/src/components/StatusDot.test.jsx`:
```jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusDot from './StatusDot.jsx';

describe('StatusDot', () => {
  it('labels up/down/unknown for screen readers and tints by status', () => {
    const { rerender, container } = render(<StatusDot status="up" />);
    expect(screen.getByText('Up')).toBeInTheDocument();
    expect(container.firstChild).toHaveStyle({ color: 'var(--green)' });
    rerender(<StatusDot status="down" />);
    expect(screen.getByText('Down')).toBeInTheDocument();
    expect(container.firstChild).toHaveStyle({ color: 'var(--red)' });
    rerender(<StatusDot status="unknown" />);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(container.firstChild).toHaveStyle({ color: 'var(--amber)' });
  });
});
```

- [ ] **Step 2: Run — fails.** `cd mobile && npm test -- src/components/StatusDot.test.jsx`

- [ ] **Step 3: Implement** `mobile/src/components/StatusDot.jsx`:
```jsx
import React from 'react';

/**
 * Glowing status dot with a redundant glyph + SR label (WCAG 1.4.1 — never
 * color-only). 'running' counts as up; anything not up/down is unknown.
 */
export default function StatusDot({ status }) {
  const isUp = status === 'up' || status === 'running';
  const isDown = status === 'down';
  const color = isUp ? 'var(--green)' : isDown ? 'var(--red)' : 'var(--amber)';
  const label = isUp ? 'Up' : isDown ? 'Down' : 'Unknown';
  const glyph = isUp ? '▲' : isDown ? '▼' : '◆';
  return (
    <span
      role="img"
      aria-label={`Status: ${label}`}
      style={{ flexShrink: 0, lineHeight: 1, fontSize: 9, color, textShadow: `0 0 6px ${color}`, fontFamily: 'var(--font-mono)' }}
    >
      <span aria-hidden="true">{glyph}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
```

- [ ] **Step 4: Run — passes.** `cd mobile && npm test -- src/components/StatusDot.test.jsx`

- [ ] **Step 5: Failing test — UsageBar** `mobile/src/components/UsageBar.test.jsx`:
```jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import UsageBar from './UsageBar.jsx';

describe('UsageBar', () => {
  it('renders label + value + unit and clamps the fill width to percent', () => {
    const { container } = render(<UsageBar label="CPU" value="45.3" unit="%" percent={45.3} />);
    expect(screen.getByText('CPU')).toBeInTheDocument();
    expect(screen.getByText('45.3%')).toBeInTheDocument();
    const fill = container.querySelector('.usage-bar__fill');
    expect(fill).toHaveStyle({ width: '45.3%' });
  });
  it('handles a null percent (no bar, em-dash value)', () => {
    render(<UsageBar label="TEMP" value={null} unit="°C" percent={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run — fails.** `cd mobile && npm test -- src/components/UsageBar.test.jsx`

- [ ] **Step 7: Implement** `mobile/src/components/UsageBar.jsx`:
```jsx
import React from 'react';

/**
 * A labeled usage bar (CPU/MEM/DISK/TEMP). `percent` (0–100) drives the fill;
 * null hides the bar and shows an em-dash. Severity tints at 75/90.
 */
export default function UsageBar({ label, value, unit = '', percent }) {
  const pct = Number.isFinite(percent) ? Math.max(0, Math.min(percent, 100)) : null;
  const color = pct == null ? 'var(--text-muted)' : pct >= 90 ? 'var(--red)' : pct >= 75 ? 'var(--amber)' : 'var(--green)';
  return (
    <div className="usage-bar">
      <div className="usage-bar__head">
        <span className="usage-bar__label">{label}</span>
        <span className="usage-bar__value">{value == null ? '—' : `${value}${unit}`}</span>
      </div>
      {pct != null && (
        <div className="usage-bar__track">
          <div className="usage-bar__fill" style={{ width: `${pct}%`, background: color }} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 8: Run — passes.** `cd mobile && npm test -- src/components/UsageBar.test.jsx`

- [ ] **Step 9: Failing test — ServiceRow + base-aware icon** `mobile/src/components/ServiceRow.test.jsx` (uses `vi.hoisted`):
```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { getServiceIcon } = vi.hoisted(() => ({ getServiceIcon: vi.fn() }));
vi.mock('@shared/hooks/useData.js', () => ({ getServiceIcon }));

import ServiceRow from './ServiceRow.jsx';

beforeEach(() => getServiceIcon.mockReset());

const SVC = { uid: 'vm-101:gitea', display_name: 'Gitea', icon: null, status: 'down', ping: null, uptime24: 0.42, url: 'http://h/gitea', nodeName: 'VM 101' };

describe('ServiceRow', () => {
  it('renders an absolute base-aware icon URL, node tag, name, status', () => {
    getServiceIcon.mockReturnValue('http://host:8080/api/icons/cached?url=x');
    render(<ServiceRow service={SVC} onTap={() => {}} />);
    expect(screen.getByText('Gitea')).toBeInTheDocument();
    expect(screen.getByText('VM 101')).toBeInTheDocument();
    const img = screen.getByRole('img', { hidden: true });
    expect(img.getAttribute('src')).toMatch(/^http:\/\/host:8080\/api\/icons\/cached/);
    expect(img.getAttribute('src')).not.toMatch(/^\/api/); // never relative
  });
  it('omits the <img> when the resolver returns null', () => {
    getServiceIcon.mockReturnValue(null);
    render(<ServiceRow service={SVC} onTap={() => {}} />);
    expect(screen.queryByRole('img', { hidden: true })).toBeNull();
  });
  it('fires onTap with the service', () => {
    getServiceIcon.mockReturnValue(null);
    const onTap = vi.fn();
    render(<ServiceRow service={SVC} onTap={onTap} />);
    fireEvent.click(screen.getByRole('button', { name: /Gitea/ }));
    expect(onTap).toHaveBeenCalledWith(SVC);
  });
});
```

- [ ] **Step 10: Run — fails.** `cd mobile && npm test -- src/components/ServiceRow.test.jsx`

- [ ] **Step 11: Implement** `mobile/src/components/ServiceRow.jsx`:
```jsx
import React from 'react';
import { getServiceIcon } from '@shared/hooks/useData.js';
import StatusDot from './StatusDot.jsx';

/**
 * One service row: base-aware icon (NEVER a relative /api path), name, node tag,
 * status dot, ping. The whole row is a button → onTap(service). Read-only.
 */
export default function ServiceRow({ service, onTap }) {
  const icon = getServiceIcon(service.icon) || getServiceIcon(service.display_name);
  return (
    <button
      type="button"
      className="svc-row"
      onClick={() => onTap && onTap(service)}
      aria-label={`${service.display_name} on ${service.nodeName}`}
    >
      <StatusDot status={service.status} />
      {icon && <img className="svc-row__icon" src={icon} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
      <span className="svc-row__name">{service.display_name}</span>
      <span className="svc-row__node">{service.nodeName}</span>
      {service.ping != null && service.ping > 0 && <span className="svc-row__ping">{service.ping}ms</span>}
    </button>
  );
}
```

- [ ] **Step 12: Run — passes.** `cd mobile && npm test -- src/components/ServiceRow.test.jsx`

- [ ] **Step 13: Add atom CSS** to `mobile/src/MobileApp.css` (append; tokens only):
```css
/* --- Phase 3: atoms --- */
.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0;
}
.usage-bar { display: flex; flex-direction: column; gap: 2px; }
.usage-bar__head { display: flex; justify-content: space-between; align-items: baseline; }
.usage-bar__label { font-family: var(--font-mono); font-size: var(--text-2xs); color: var(--text-muted); letter-spacing: 0.5px; }
.usage-bar__value { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-secondary); }
.usage-bar__track { height: 4px; background: var(--border-color); border-radius: 2px; overflow: hidden; }
.usage-bar__fill { height: 100%; border-radius: 2px; }
.svc-row {
  display: flex; align-items: center; gap: var(--space-3); width: 100%;
  min-height: 48px; padding: var(--space-3) var(--space-4); background: var(--bg-card-inner);
  border: none; border-bottom: 1px solid var(--border-color); border-radius: 0; text-align: left;
}
.svc-row__icon { width: 24px; height: 24px; border-radius: 6px; flex-shrink: 0; }
.svc-row__name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-primary); font-family: var(--font-body); font-size: var(--fs-service-name); font-weight: 500; }
.svc-row__node { font-family: var(--font-mono); font-size: var(--text-2xs); color: var(--text-muted); background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 4px; padding: 2px 6px; flex-shrink: 0; }
.svc-row__ping { font-family: var(--font-mono); font-size: var(--text-2xs); color: var(--green); flex-shrink: 0; }
```

- [ ] **Step 14: Commit.**
```
cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase3 && git add mobile/src/components/StatusDot.jsx mobile/src/components/StatusDot.test.jsx mobile/src/components/UsageBar.jsx mobile/src/components/UsageBar.test.jsx mobile/src/components/ServiceRow.jsx mobile/src/components/ServiceRow.test.jsx mobile/src/MobileApp.css && git commit -m "feat(mobile): shared atoms — StatusDot, UsageBar, base-aware ServiceRow"
```

---

## Task 3: Navigation stack + `open` action + MobileApp wiring

Gives every tab an intra-tab push/pop detail stack and wires hardware-back to pop-before-exit. Also lands the read-only Open action.

**Files:**
- Create: `mobile/src/nav/useNavStack.js` + `.test.js`
- Create: `mobile/src/open.js` + `.test.js`
- Modify: `mobile/src/MobileApp.jsx`
- Create/Modify: `mobile/src/MobileApp.test.jsx`

**Interfaces:**
- `useNavStack(root): { current, stack, push(screen, params), pop(), reset(root?), canPop }`.
- `openTarget(target): void` — read-only navigation to `target.url` (if any) via `window.open(url, '_blank')`; never writes.
- `MobileApp` owns one nav stack **per active tab** (resets the detail stack on tab change) and registers a hardware-back handler that pops a detail first, else exits.

- [ ] **Step 1: Failing test — nav reducer** `mobile/src/nav/useNavStack.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNavStack } from './useNavStack.js';

describe('useNavStack', () => {
  it('starts at root, pushes + pops detail, and reports canPop', () => {
    const { result } = renderHook(() => useNavStack({ screen: 'list' }));
    expect(result.current.current.screen).toBe('list');
    expect(result.current.canPop).toBe(false);
    act(() => result.current.push('detail', { id: 7 }));
    expect(result.current.current).toEqual({ screen: 'detail', params: { id: 7 } });
    expect(result.current.canPop).toBe(true);
    act(() => result.current.pop());
    expect(result.current.current.screen).toBe('list');
    expect(result.current.canPop).toBe(false);
  });
  it('pop at root is a no-op; reset clears to a new root', () => {
    const { result } = renderHook(() => useNavStack({ screen: 'a' }));
    act(() => result.current.pop());
    expect(result.current.current.screen).toBe('a');
    act(() => result.current.push('b'));
    act(() => result.current.reset({ screen: 'c' }));
    expect(result.current.current.screen).toBe('c');
    expect(result.current.canPop).toBe(false);
  });
});
```

- [ ] **Step 2: Run — fails.** `cd mobile && npm test -- src/nav/useNavStack.test.js`

- [ ] **Step 3: Implement** `mobile/src/nav/useNavStack.js`:
```js
import { useReducer, useMemo } from 'react';

/**
 * A minimal per-tab navigation stack (NOT a router lib). Each entry is
 * { screen, params }. push appends, pop drops the top (never below root),
 * reset replaces the whole stack with a single root. canPop drives hardware-back.
 */
function reducer(stack, action) {
  switch (action.type) {
    case 'push':
      return [...stack, { screen: action.screen, params: action.params }];
    case 'pop':
      return stack.length > 1 ? stack.slice(0, -1) : stack;
    case 'reset':
      return [action.root];
    default:
      return stack;
  }
}

export function useNavStack(root) {
  const [stack, dispatch] = useReducer(reducer, [root]);
  return useMemo(
    () => ({
      stack,
      current: stack[stack.length - 1],
      canPop: stack.length > 1,
      push: (screen, params) => dispatch({ type: 'push', screen, params }),
      pop: () => dispatch({ type: 'pop' }),
      reset: (r = root) => dispatch({ type: 'reset', root: r }),
    }),
    [stack] // root is stable per tab; reset default captured at first render is fine
  );
}
```

- [ ] **Step 4: Run — passes.** `cd mobile && npm test -- src/nav/useNavStack.test.js`

- [ ] **Step 5: Failing test — open action** `mobile/src/open.test.js`:
```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openTarget } from './open.js';

describe('openTarget (read-only)', () => {
  beforeEach(() => { window.open = vi.fn(); });
  it('navigates to a service url and never writes', () => {
    openTarget({ kind: 'service', uid: 'vm-101:gitea', url: 'http://h/gitea' });
    expect(window.open).toHaveBeenCalledWith('http://h/gitea', '_blank', 'noopener');
  });
  it('is a no-op for a target with no url', () => {
    openTarget({ kind: 'cron', job: 'backup' });
    expect(window.open).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run — fails.** `cd mobile && npm test -- src/open.test.js`

- [ ] **Step 7: Implement** `mobile/src/open.js`:
```js
/**
 * Light Action v1 = "Open" ONLY — a READ-ONLY deep-link/navigation to the
 * underlying service URL. No backend write, no mutation. Targets without a URL
 * (UPS/cron) have no external destination yet, so Open is a no-op for them.
 */
export function openTarget(target) {
  const url = target && target.url;
  if (url && typeof url === 'string') {
    window.open(url, '_blank', 'noopener');
  }
}
```

- [ ] **Step 8: Run — passes.** `cd mobile && npm test -- src/open.test.js`

- [ ] **Step 9: Failing test — MobileApp tab/back wiring** `mobile/src/MobileApp.test.jsx` (replace any prior content; mock `@capacitor/app`, the data hook, and the views so the test is shell-focused):
```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const { addListener, exitApp, getPref, setPref, useDashboard } = vi.hoisted(() => ({
  addListener: vi.fn(), exitApp: vi.fn(), getPref: vi.fn(), setPref: vi.fn(),
  useDashboard: vi.fn(),
}));
vi.mock('@capacitor/app', () => ({ App: { addListener, exitApp } }));
vi.mock('./storage/prefsAdapter.js', () => ({ getPref, setPref }));
vi.mock('./data/useDashboard.js', () => ({ useDashboard }));
// Stub the four views so we assert shell behaviour, and let Services expose a push.
vi.mock('./views/Overview.jsx', () => ({ default: () => <div>OverviewView</div> }));
vi.mock('./views/Services.jsx', () => ({
  default: ({ nav }) => (
    <div>
      <div>ServicesView</div>
      <button onClick={() => nav.push('serviceDetail', { uid: 'x' })}>go-detail</button>
      {nav.current.screen === 'serviceDetail' && <div>DetailView</div>}
    </div>
  ),
}));
vi.mock('./views/Infra.jsx', () => ({ default: () => <div>InfraView</div> }));
vi.mock('./views/Alerts.jsx', () => ({ default: () => <div>AlertsView</div> }));

import MobileApp from './MobileApp.jsx';

let backHandler;
beforeEach(() => {
  addListener.mockReset(); exitApp.mockReset(); getPref.mockReset(); setPref.mockReset(); useDashboard.mockReset();
  getPref.mockResolvedValue(null);
  useDashboard.mockReturnValue({ servicesBody: { nodes: {} }, ups: {}, cron: [], history: {}, loading: false, error: null });
  addListener.mockImplementation((evt, cb) => { if (evt === 'backButton') backHandler = cb; return { remove() {} }; });
});

describe('MobileApp shell — Phase 3 nav', () => {
  it('hardware-back pops a detail before exiting', async () => {
    render(<MobileApp />);
    fireEvent.click(screen.getByRole('tab', { name: 'Services' }));
    fireEvent.click(screen.getByText('go-detail'));
    expect(screen.getByText('DetailView')).toBeInTheDocument();
    await act(async () => { backHandler(); });           // pop detail
    expect(screen.queryByText('DetailView')).toBeNull();
    await act(async () => { backHandler(); });           // now at root → exit
    expect(exitApp).toHaveBeenCalledTimes(1);
  });
  it('switching tabs resets the detail stack', () => {
    render(<MobileApp />);
    fireEvent.click(screen.getByRole('tab', { name: 'Services' }));
    fireEvent.click(screen.getByText('go-detail'));
    expect(screen.getByText('DetailView')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Services' }));
    expect(screen.queryByText('DetailView')).toBeNull(); // stack reset
  });
});
```

- [ ] **Step 10: Run — fails** (current `MobileApp` has no nav/data wiring). `cd mobile && npm test -- src/MobileApp.test.jsx`

- [ ] **Step 11: Rewrite** `mobile/src/MobileApp.jsx` to own a per-tab nav stack + data, and pop-then-exit hardware-back:
```jsx
import React, { useState, useEffect, useRef } from 'react';
import { App } from '@capacitor/app';
import { TABS } from './TABS.js';
import { LAST_TAB_KEY } from './runtimeConfig.js';
import { getPref, setPref } from './storage/prefsAdapter.js';
import { useNavStack } from './nav/useNavStack.js';
import { useDashboard } from './data/useDashboard.js';
import Overview from './views/Overview.jsx';
import Services from './views/Services.jsx';
import Infra from './views/Infra.jsx';
import Alerts from './views/Alerts.jsx';
import './MobileApp.css';

const VIEWS = { overview: Overview, services: Services, infra: Infra, alerts: Alerts };
const ROOT = { overview: { screen: 'overview' }, services: { screen: 'services' }, infra: { screen: 'infra' }, alerts: { screen: 'alerts' } };

export default function MobileApp() {
  const [active, setActive] = useState('overview');
  const nav = useNavStack(ROOT.overview);
  const data = useDashboard();
  // Keep a live ref so the single back listener always sees current nav/active.
  const navRef = useRef(nav); navRef.current = nav;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const last = await getPref(LAST_TAB_KEY);
      if (!cancelled && last && VIEWS[last]) { setActive(last); nav.reset(ROOT[last]); }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Hardware back: pop a pushed detail first; only exit at a tab root.
  useEffect(() => {
    const handle = App.addListener('backButton', () => {
      if (navRef.current.canPop) navRef.current.pop();
      else App.exitApp();
    });
    return () => { Promise.resolve(handle).then((h) => h && h.remove && h.remove()); };
  }, []);

  const onTab = (id) => {
    setActive(id);
    nav.reset(ROOT[id]); // intra-tab detail stack resets on tab change
    setPref(LAST_TAB_KEY, id);
  };

  const ActiveView = VIEWS[active];

  return (
    <div id="mobile-root">
      <main className="mobile-content">
        <ActiveView nav={nav} data={data} />
      </main>
      <nav className="mobile-tabbar" role="tablist" aria-label="Primary">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={active === t.id} onClick={() => onTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
```

- [ ] **Step 12: Run — passes.** `cd mobile && npm test -- src/MobileApp.test.jsx`
> NOTE: this step makes the real `Overview/Services/Infra/Alerts` receive a `nav`+`data` prop. The current placeholder views ignore extra props, so `npm test` (full) still passes. The real views land in Tasks 5–9; until then the app renders placeholders with the new props harmlessly.

- [ ] **Step 13: Commit.**
```
cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase3 && git add mobile/src/nav mobile/src/open.js mobile/src/open.test.js mobile/src/MobileApp.jsx mobile/src/MobileApp.test.jsx && git commit -m "feat(mobile): per-tab nav stack + hardware-back pop + read-only Open action"
```

---

## Task 4: `useDashboard` data hook

The single live-data source the views consume. Thin: fetch + interval; all shaping is `derive.js`.

**Files:**
- Create: `mobile/src/data/useDashboard.js` + `.test.js`

**Interfaces:**
- Consumes `@shared/hooks/useData.js`: `getServices`, `getUPSStatus`, `getCronStatus`, `getMetricHistory`.
- Produces `useDashboard(): { servicesBody, ups, cron, history, loading, error, refresh }`.

- [ ] **Step 1: Failing test** `mobile/src/data/useDashboard.test.js` (vi.hoisted mocks; fake timers optional — keep it to the initial load):
```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const { getServices, getUPSStatus, getCronStatus, getMetricHistory } = vi.hoisted(() => ({
  getServices: vi.fn(), getUPSStatus: vi.fn(), getCronStatus: vi.fn(), getMetricHistory: vi.fn(),
}));
vi.mock('@shared/hooks/useData.js', () => ({ getServices, getUPSStatus, getCronStatus, getMetricHistory }));

import { useDashboard } from './useDashboard.js';

beforeEach(() => {
  getServices.mockResolvedValue({ nodes: { 'vm-101': { display_name: 'VM 101', metrics: {}, services: [] } } });
  getUPSStatus.mockResolvedValue({ status: 1 });
  getCronStatus.mockResolvedValue([]);
  getMetricHistory.mockResolvedValue({ 'vm-101:cpu': [1, 2, 3] });
});

describe('useDashboard', () => {
  it('loads all four sources and exposes the bodies', async () => {
    const { result } = renderHook(() => useDashboard());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.servicesBody.nodes['vm-101'].display_name).toBe('VM 101');
    expect(result.current.ups.status).toBe(1);
    expect(result.current.history['vm-101:cpu']).toEqual([1, 2, 3]);
    expect(result.current.error).toBeNull();
  });
  it('surfaces an error when the primary services fetch throws', async () => {
    getServices.mockRejectedValue(new Error('HTTP 500'));
    const { result } = renderHook(() => useDashboard());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run — fails.** `cd mobile && npm test -- src/data/useDashboard.test.js`

- [ ] **Step 3: Implement** `mobile/src/data/useDashboard.js`:
```js
import { useState, useEffect, useCallback, useRef } from 'react';
import { getServices, getUPSStatus, getCronStatus, getMetricHistory } from '@shared/hooks/useData.js';

const REFRESH_MS = 30000;

/**
 * The single live-data source for the mobile screens. Fetches the four read-only
 * endpoints on mount + every 30s. Shaping is done by derive.js; this hook only
 * holds raw bodies + loading/error. The services fetch is the health gate: if it
 * throws, `error` is set; UPS/cron/history failures degrade silently to last value.
 */
export function useDashboard() {
  const [state, setState] = useState({ servicesBody: null, ups: null, cron: null, history: null, loading: true, error: null });
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const [servicesBody, ups, cron, history] = await Promise.all([
        getServices(true),
        getUPSStatus(true).catch(() => null),
        getCronStatus(true).catch(() => null),
        getMetricHistory().catch(() => null),
      ]);
      if (!mounted.current) return;
      setState((s) => ({
        servicesBody: servicesBody ?? s.servicesBody,
        ups: ups ?? s.ups,
        cron: cron ?? s.cron,
        history: history ?? s.history,
        loading: false, error: null,
      }));
    } catch (err) {
      if (!mounted.current) return;
      setState((s) => ({ ...s, loading: false, error: err }));
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => { mounted.current = false; clearInterval(id); };
  }, [refresh]);

  return { ...state, refresh };
}
```
> `getServices(true)` passes `skipEtag=true` so the mobile hook always gets a full body (no shared ETag identity games across screens).

- [ ] **Step 4: Run — passes.** `cd mobile && npm test -- src/data/useDashboard.test.js`

- [ ] **Step 5: Commit.**
```
cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase3 && git add mobile/src/data/useDashboard.js mobile/src/data/useDashboard.test.js && git commit -m "feat(mobile): useDashboard live-data hook (30s, raw bodies)"
```

---

## Task 5: SubsystemStrip + IncidentCard + Overview screen

Folds two Overview-owned-but-Alerts-reused components (`IncidentCard` reused by Alerts) into the Overview build.

**Files:**
- Create: `mobile/src/components/SubsystemStrip.jsx` + `.test.jsx`
- Create: `mobile/src/components/IncidentCard.jsx` + `.test.jsx`
- Replace: `mobile/src/views/Overview.jsx`
- Create: `mobile/src/views/Overview.test.jsx`
- Modify: `mobile/src/MobileApp.css` (subsystem grid, incident card, node row styles)

**Interfaces:**
- `<SubsystemStrip cells />` where `cells = deriveSubsystems(...)`.
- `<IncidentCard incident onOpen />` — cause + 24h uptime (Sparkline if a series given, else the `uptime24` scalar) + **Open**.
- `Overview({ data, nav })` — subsystem strip + incidents (collapse "+N more") + compact node rows.

- [ ] **Step 1: Failing test — SubsystemStrip** `mobile/src/components/SubsystemStrip.test.jsx`:
```jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SubsystemStrip from './SubsystemStrip.jsx';

const CELLS = [
  { key: 'services', label: 'Services', degraded: true, detail: '1 down' },
  { key: 'nodes', label: 'Nodes', degraded: false, detail: '3 online' },
  { key: 'ups', label: 'UPS', degraded: false, detail: 'Mains' },
  { key: 'cron', label: 'Cron', degraded: false, detail: 'Healthy' },
];

describe('SubsystemStrip', () => {
  it('renders all four cells and alarm-tints only the degraded one', () => {
    render(<SubsystemStrip cells={CELLS} />);
    expect(screen.getByText('Services')).toBeInTheDocument();
    expect(screen.getByText('1 down')).toBeInTheDocument();
    const svc = screen.getByText('Services').closest('.subsys-cell');
    const nodes = screen.getByText('Nodes').closest('.subsys-cell');
    expect(svc.className).toMatch(/subsys-cell--degraded/);
    expect(nodes.className).not.toMatch(/subsys-cell--degraded/);
  });
});
```

- [ ] **Step 2: Run — fails.** `cd mobile && npm test -- src/components/SubsystemStrip.test.jsx`

- [ ] **Step 3: Implement** `mobile/src/components/SubsystemStrip.jsx`:
```jsx
import React from 'react';

/** The Overview health hero: 4 subsystem cells. Degraded = red dot + alarm tint. */
export default function SubsystemStrip({ cells }) {
  return (
    <div className="subsys-strip" role="list" aria-label="Subsystem health">
      {cells.map((c) => (
        <div key={c.key} role="listitem" className={`subsys-cell${c.degraded ? ' subsys-cell--degraded' : ''}`}>
          <span className="subsys-cell__dot" style={{ background: c.degraded ? 'var(--red)' : 'var(--green)', boxShadow: `0 0 8px ${c.degraded ? 'var(--red)' : 'var(--green)'}` }} aria-hidden="true" />
          <span className="subsys-cell__label">{c.label}</span>
          <span className="subsys-cell__detail">{c.detail}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run — passes.** `cd mobile && npm test -- src/components/SubsystemStrip.test.jsx`

- [ ] **Step 5: Failing test — IncidentCard** `mobile/src/components/IncidentCard.test.jsx`:
```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import IncidentCard from './IncidentCard.jsx';

const INC = { id: 'service:vm-101:gitea', kind: 'service', title: 'Gitea', node: 'VM 101', cause: 'Service is down', uptime24: 0.42, status: 'down', target: { kind: 'service', url: 'http://h/gitea' } };

describe('IncidentCard', () => {
  it('shows title, node, cause, 24h uptime and an Open button', () => {
    const onOpen = vi.fn();
    render(<IncidentCard incident={INC} onOpen={onOpen} />);
    expect(screen.getByText('Gitea')).toBeInTheDocument();
    expect(screen.getByText('VM 101')).toBeInTheDocument();
    expect(screen.getByText('Service is down')).toBeInTheDocument();
    expect(screen.getByText('42.0%')).toBeInTheDocument(); // uptime24 scalar
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onOpen).toHaveBeenCalledWith(INC.target);
  });
  it('omits the uptime line when uptime24 is null (e.g. UPS/cron)', () => {
    render(<IncidentCard incident={{ ...INC, uptime24: null }} onOpen={() => {}} />);
    expect(screen.queryByText(/%$/)).toBeNull();
  });
});
```

- [ ] **Step 6: Run — fails.** `cd mobile && npm test -- src/components/IncidentCard.test.jsx`

- [ ] **Step 7: Implement** `mobile/src/components/IncidentCard.jsx`:
```jsx
import React from 'react';

/**
 * An expanded incident: title, node tag, cause, 24h uptime (the per-service
 * uptime24 scalar — there is no per-service 24h SERIES from the server), and a
 * read-only Open action. Alarm-tinted (red border). onOpen(target) only.
 */
export default function IncidentCard({ incident, onOpen }) {
  const u = incident.uptime24;
  const pct = u != null ? (u * 100).toFixed(1) : null;
  const pctColor = u == null ? 'var(--text-muted)' : u > 0.99 ? 'var(--green)' : u > 0.95 ? 'var(--amber)' : 'var(--red)';
  return (
    <article className="incident-card">
      <div className="incident-card__head">
        <span className="incident-card__title">{incident.title}</span>
        <span className="incident-card__node">{incident.node}</span>
      </div>
      <p className="incident-card__cause">{incident.cause}</p>
      <div className="incident-card__foot">
        {pct != null && (
          <span className="incident-card__uptime">
            <span className="incident-card__uptime-label">24H</span>
            <span style={{ color: pctColor }}>{pct}%</span>
          </span>
        )}
        <button type="button" className="incident-card__open" onClick={() => onOpen(incident.target)}>Open</button>
      </div>
    </article>
  );
}
```

- [ ] **Step 8: Run — passes.** `cd mobile && npm test -- src/components/IncidentCard.test.jsx`

- [ ] **Step 9: Failing test — Overview screen** `mobile/src/views/Overview.test.jsx`:
```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { openTarget } = vi.hoisted(() => ({ openTarget: vi.fn() }));
vi.mock('../open.js', () => ({ openTarget }));
vi.mock('@shared/hooks/useData.js', () => ({ getServiceIcon: () => null })); // node rows don't need icons

import Overview from './Overview.jsx';

function makeData(downCount) {
  const services = [];
  for (let i = 0; i < downCount; i++) services.push({ uid: `vm-101:s${i}`, container: `s${i}`, display_name: `Svc ${i}`, icon: null, status: 'down', ping: null, uptime24: 0.4, url: `http://h/s${i}` });
  services.push({ uid: 'vm-101:ok', container: 'ok', display_name: 'Ok', icon: null, status: 'up', ping: 5, uptime24: 0.999, url: '' });
  return {
    servicesBody: { nodes: { 'vm-101': { display_name: 'VM 101', subtitle: 'app', metrics: { cpu: '45.3', memPercent: '31.2' }, services } } },
    ups: { status: 1 }, cron: [], history: { 'vm-101:cpu': [1, 2, 3] }, loading: false, error: null,
  };
}

describe('Overview', () => {
  beforeEach(() => openTarget.mockReset());
  it('renders the subsystem strip, one inline incident, and a node row', () => {
    render(<Overview data={makeData(1)} nav={{ push: vi.fn() }} />);
    expect(screen.getByText('Services')).toBeInTheDocument();
    expect(screen.getByText('Svc 0')).toBeInTheDocument();
    expect(screen.getByText('VM 101')).toBeInTheDocument(); // node row
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(openTarget).toHaveBeenCalled();
  });
  it('collapses extra incidents behind "+N more"', () => {
    render(<Overview data={makeData(4)} nav={{ push: vi.fn() }} />);
    // default expanded = 2; remaining 2 behind the toggle
    expect(screen.getByText(/\+2 more/)).toBeInTheDocument();
    expect(screen.queryByText('Svc 2')).toBeNull();
    fireEvent.click(screen.getByText(/\+2 more/));
    expect(screen.getByText('Svc 2')).toBeInTheDocument();
  });
});
```

- [ ] **Step 10: Run — fails.** `cd mobile && npm test -- src/views/Overview.test.jsx`

- [ ] **Step 11: Implement** `mobile/src/views/Overview.jsx` (replace stub):
```jsx
import React, { useState } from 'react';
import SubsystemStrip from '../components/SubsystemStrip.jsx';
import IncidentCard from '../components/IncidentCard.jsx';
import UsageBar from '../components/UsageBar.jsx';
import { deriveSubsystems, deriveIncidents, groupByNode, nodeUpDown, parseMetricPct } from '../data/derive.js';
import { openTarget } from '../open.js';

const DEFAULT_EXPANDED = 2;

export default function Overview({ data, nav }) {
  const { servicesBody, ups, cron } = data;
  const [showAll, setShowAll] = useState(false);
  const cells = deriveSubsystems({ services: servicesBody, ups, cron });
  const incidents = deriveIncidents({ services: servicesBody, ups, cron });
  const shown = showAll ? incidents : incidents.slice(0, DEFAULT_EXPANDED);
  const extra = incidents.length - shown.length;
  const nodes = groupByNode(servicesBody);

  return (
    <section className="mobile-view" aria-label="Overview">
      <h1>Overview</h1>
      <SubsystemStrip cells={cells} />

      {incidents.length > 0 && (
        <div className="overview-incidents">
          {shown.map((inc) => (
            <IncidentCard key={inc.id} incident={inc} onOpen={openTarget} />
          ))}
          {!showAll && extra > 0 && (
            <button type="button" className="overview-more" onClick={() => setShowAll(true)}>
              +{extra} more
            </button>
          )}
        </div>
      )}

      <div className="overview-nodes">
        {nodes.map(({ nodeKey, node }) => {
          const { up, down } = nodeUpDown(node);
          return (
            <button key={nodeKey} type="button" className="node-row" onClick={() => nav.push('node', { nodeKey })}>
              <div className="node-row__head">
                <span className="node-row__name">{node.display_name}</span>
                <span className="node-row__count">{up} up{down ? ` / ${down} down` : ''}</span>
              </div>
              <div className="node-row__bars">
                <UsageBar label="CPU" value={node.metrics?.cpu} unit="%" percent={parseMetricPct(node.metrics?.cpu)} />
                <UsageBar label="MEM" value={node.metrics?.memPercent} unit="%" percent={parseMetricPct(node.metrics?.memPercent)} />
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
```
> `nav.push('node', …)` lands on the Infra node detail in Task 7 — but Overview's node rows route into the **Infra** tab's stack is out of altitude; for v1 the Overview node row pushes onto the Overview tab's own stack rendering `NodeDetail` (Task 7 makes `NodeDetail` self-contained so it renders in any tab's stack). The Overview screen renders `current.screen === 'node'` via the tab dispatcher added in Task 9 Step (screen dispatch). To keep Overview testable in isolation here, the node-row only calls `nav.push`; rendering the pushed `NodeDetail` is wired in Task 9.

- [ ] **Step 12: Add Overview CSS** to `mobile/src/MobileApp.css` (append):
```css
/* --- Phase 3: Overview --- */
.subsys-strip { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space-2); margin-bottom: var(--space-4); }
.subsys-cell { display: flex; flex-direction: column; gap: 2px; padding: var(--space-3); background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--card-radius-sm); }
.subsys-cell--degraded { background: var(--red-bg); border-color: var(--red-border); }
.subsys-cell__dot { width: 8px; height: 8px; border-radius: 50%; }
.subsys-cell__label { font-family: var(--font-display); font-size: var(--text-base); color: var(--text-primary); }
.subsys-cell__detail { font-family: var(--font-mono); font-size: var(--text-2xs); color: var(--text-muted); }
.overview-incidents { display: flex; flex-direction: column; gap: var(--space-3); margin-bottom: var(--space-4); }
.incident-card { padding: var(--space-3) var(--space-4); background: var(--red-bg); border: 1px solid var(--red-border); border-radius: var(--card-radius-sm); }
.incident-card__head { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-2); }
.incident-card__title { font-family: var(--font-display); font-size: var(--text-lg); color: var(--text-primary); }
.incident-card__node { font-family: var(--font-mono); font-size: var(--text-2xs); color: var(--text-muted); }
.incident-card__cause { margin: var(--space-1) 0 var(--space-2); color: var(--text-secondary); font-size: var(--text-sm); }
.incident-card__foot { display: flex; align-items: center; justify-content: space-between; }
.incident-card__uptime { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: var(--text-xs); }
.incident-card__uptime-label { color: var(--text-muted); letter-spacing: 0.5px; }
.incident-card__open { background: var(--accent); color: #fff; border: none; border-radius: 8px; padding: var(--space-2) var(--space-4); font-size: var(--text-sm); min-height: 36px; }
.overview-more { align-self: flex-start; background: var(--bg-card-inner); color: var(--text-secondary); border: 1px solid var(--border-color); border-radius: 8px; padding: var(--space-2) var(--space-3); font-size: var(--text-sm); }
.overview-nodes { display: flex; flex-direction: column; gap: var(--space-3); }
.node-row { display: flex; flex-direction: column; gap: var(--space-2); width: 100%; text-align: left; padding: var(--space-3) var(--space-4); background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--card-radius-sm); }
.node-row__head { display: flex; justify-content: space-between; align-items: baseline; }
.node-row__name { font-family: var(--font-display); font-size: var(--text-lg); color: var(--text-primary); }
.node-row__count { font-family: var(--font-mono); font-size: var(--text-2xs); color: var(--text-muted); }
.node-row__bars { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); }
```

- [ ] **Step 13: Run — passes** (the Overview test only asserts `nav.push` is called, not rendering of the pushed screen — that's Task 9). `cd mobile && npm test -- src/views/Overview.test.jsx src/components/SubsystemStrip.test.jsx src/components/IncidentCard.test.jsx`

- [ ] **Step 14: Commit.**
```
cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase3 && git add mobile/src/components/SubsystemStrip.jsx mobile/src/components/SubsystemStrip.test.jsx mobile/src/components/IncidentCard.jsx mobile/src/components/IncidentCard.test.jsx mobile/src/views/Overview.jsx mobile/src/views/Overview.test.jsx mobile/src/MobileApp.css && git commit -m "feat(mobile): Overview — subsystem strip + inline incidents + node rows"
```

---

## Task 6: FilterChips + SearchBar + Services screen + ServiceDetail

**Files:**
- Create: `mobile/src/components/FilterChips.jsx` + `.test.jsx`
- Create: `mobile/src/components/SearchBar.jsx` + `.test.jsx`
- Replace: `mobile/src/views/Services.jsx`
- Create: `mobile/src/views/Services.test.jsx`
- Create: `mobile/src/views/ServiceDetail.jsx` + `.test.jsx`
- Modify: `mobile/src/MobileApp.css`

**Interfaces:**
- `<FilterChips chips active onChange />`, `<SearchBar value onChange placeholder />`.
- `Services({ data, nav })` — flat problems-first list, node tags, chips (All/Down/per-node), search, tap→`nav.push('serviceDetail', { uid })`.
- `ServiceDetail({ data, nav, params })` — single service: status, node, ping, 24h uptime, docker stats, **Open**, back.

- [ ] **Step 1: Failing test — FilterChips** `mobile/src/components/FilterChips.test.jsx`:
```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FilterChips from './FilterChips.jsx';

describe('FilterChips', () => {
  it('marks the active chip and fires onChange with the chosen id', () => {
    const onChange = vi.fn();
    render(<FilterChips chips={[{ id: 'all', label: 'All' }, { id: 'down', label: 'Down' }]} active="all" onChange={onChange} />);
    const all = screen.getByRole('button', { name: 'All' });
    expect(all).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Down' }));
    expect(onChange).toHaveBeenCalledWith('down');
  });
});
```

- [ ] **Step 2: Run — fails.** `cd mobile && npm test -- src/components/FilterChips.test.jsx`

- [ ] **Step 3: Implement** `mobile/src/components/FilterChips.jsx`:
```jsx
import React from 'react';

/** Horizontal, scrollable filter chips. active = current id; onChange(id). */
export default function FilterChips({ chips, active, onChange }) {
  return (
    <div className="filter-chips" role="group" aria-label="Filters">
      {chips.map((c) => (
        <button
          key={c.id}
          type="button"
          className={`chip${active === c.id ? ' chip--active' : ''}`}
          aria-pressed={active === c.id}
          onClick={() => onChange(c.id)}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run — passes.** `cd mobile && npm test -- src/components/FilterChips.test.jsx`

- [ ] **Step 5: Failing test — SearchBar** `mobile/src/components/SearchBar.test.jsx`:
```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SearchBar from './SearchBar.jsx';

describe('SearchBar', () => {
  it('is controlled and reports typed text', () => {
    const onChange = vi.fn();
    render(<SearchBar value="" onChange={onChange} placeholder="Search services" />);
    const input = screen.getByPlaceholderText('Search services');
    fireEvent.change(input, { target: { value: 'git' } });
    expect(onChange).toHaveBeenCalledWith('git');
  });
});
```

- [ ] **Step 6: Run — fails.** `cd mobile && npm test -- src/components/SearchBar.test.jsx`

- [ ] **Step 7: Implement** `mobile/src/components/SearchBar.jsx`:
```jsx
import React from 'react';

/** Controlled search input. value/onChange(text). type=search for mobile UX. */
export default function SearchBar({ value, onChange, placeholder = 'Search' }) {
  return (
    <input
      className="search-bar"
      type="search"
      inputMode="search"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      aria-label={placeholder}
    />
  );
}
```

- [ ] **Step 8: Run — passes.** `cd mobile && npm test -- src/components/SearchBar.test.jsx`

- [ ] **Step 9: Failing test — Services screen** `mobile/src/views/Services.test.jsx`:
```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@shared/hooks/useData.js', () => ({ getServiceIcon: () => null }));
import Services from './Services.jsx';

const DATA = {
  servicesBody: { nodes: {
    'vm-101': { display_name: 'VM 101', metrics: {}, services: [
      { uid: 'vm-101:adguard', container: 'adguard', display_name: 'AdGuard', icon: null, status: 'up', ping: 12, uptime24: 0.99, url: '' },
      { uid: 'vm-101:gitea', container: 'gitea', display_name: 'Gitea', icon: null, status: 'down', ping: null, uptime24: 0.42, url: 'http://h/gitea' },
    ] },
    'gateway-pi': { display_name: 'Gateway Pi', metrics: {}, services: [
      { uid: 'gateway-pi:pihole', container: 'pihole', display_name: 'Pi-hole', icon: null, status: 'up', ping: 3, uptime24: 1, url: '' },
    ] },
  } },
  ups: {}, cron: [], history: {}, loading: false, error: null,
};

describe('Services', () => {
  it('renders problems-first (down at top) with node tags', () => {
    render(<Services data={DATA} nav={{ push: vi.fn() }} />);
    const names = screen.getAllByText(/AdGuard|Gitea|Pi-hole/).map((n) => n.textContent);
    expect(names[0]).toBe('Gitea'); // down first
    expect(screen.getAllByText('VM 101').length).toBeGreaterThan(0);
  });
  it('Down chip filters to only down services', () => {
    render(<Services data={DATA} nav={{ push: vi.fn() }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Down' }));
    expect(screen.getByText('Gitea')).toBeInTheDocument();
    expect(screen.queryByText('AdGuard')).toBeNull();
  });
  it('per-node chip filters to that node', () => {
    render(<Services data={DATA} nav={{ push: vi.fn() }} />);
    fireEvent.click(screen.getByRole('button', { name: 'gateway-pi' }));
    expect(screen.getByText('Pi-hole')).toBeInTheDocument();
    expect(screen.queryByText('Gitea')).toBeNull();
  });
  it('search narrows by name', () => {
    render(<Services data={DATA} nav={{ push: vi.fn() }} />);
    fireEvent.change(screen.getByLabelText('Search services'), { target: { value: 'pi' } });
    expect(screen.getByText('Pi-hole')).toBeInTheDocument();
    expect(screen.queryByText('Gitea')).toBeNull();
  });
  it('tap pushes the service detail', () => {
    const push = vi.fn();
    render(<Services data={DATA} nav={{ push }} />);
    fireEvent.click(screen.getByRole('button', { name: /Gitea/ }));
    expect(push).toHaveBeenCalledWith('serviceDetail', { uid: 'vm-101:gitea' });
  });
});
```

- [ ] **Step 10: Run — fails.** `cd mobile && npm test -- src/views/Services.test.jsx`

- [ ] **Step 11: Implement** `mobile/src/views/Services.jsx`:
```jsx
import React, { useState, useMemo } from 'react';
import FilterChips from '../components/FilterChips.jsx';
import SearchBar from '../components/SearchBar.jsx';
import ServiceRow from '../components/ServiceRow.jsx';
import { flattenServices, sortProblemsFirst } from '../data/derive.js';

export default function Services({ data, nav }) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const flat = useMemo(() => sortProblemsFirst(flattenServices(data.servicesBody)), [data.servicesBody]);
  const nodeKeys = useMemo(() => [...new Set(flat.map((s) => s.nodeKey))], [flat]);

  const chips = [{ id: 'all', label: 'All' }, { id: 'down', label: 'Down' }, ...nodeKeys.map((k) => ({ id: k, label: k }))];

  const visible = flat.filter((s) => {
    if (filter === 'down' && s.status !== 'down') return false;
    if (filter !== 'all' && filter !== 'down' && s.nodeKey !== filter) return false;
    if (query && !s.display_name.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  return (
    <section className="mobile-view" aria-label="Services">
      <h1>Services</h1>
      <SearchBar value={query} onChange={setQuery} placeholder="Search services" />
      <FilterChips chips={chips} active={filter} onChange={setFilter} />
      <div className="svc-list">
        {visible.map((s) => (
          <ServiceRow key={s.uid} service={s} onTap={() => nav.push('serviceDetail', { uid: s.uid })} />
        ))}
        {visible.length === 0 && <p className="mobile-view__todo">No services match.</p>}
      </div>
    </section>
  );
}
```

- [ ] **Step 12: Run — passes.** `cd mobile && npm test -- src/views/Services.test.jsx`

- [ ] **Step 13: Failing test — ServiceDetail** `mobile/src/views/ServiceDetail.test.jsx`:
```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { openTarget } = vi.hoisted(() => ({ openTarget: vi.fn() }));
vi.mock('../open.js', () => ({ openTarget }));
vi.mock('@shared/hooks/useData.js', () => ({ getServiceIcon: () => null }));
import ServiceDetail from './ServiceDetail.jsx';

const DATA = { servicesBody: { nodes: { 'vm-101': { display_name: 'VM 101', metrics: {}, services: [
  { uid: 'vm-101:gitea', container: 'gitea', display_name: 'Gitea', icon: null, status: 'down', ping: null, uptime24: 0.42, url: 'http://h/gitea', docker: { cpu: 2, memMB: 120 } },
] } } } };

describe('ServiceDetail', () => {
  beforeEach(() => openTarget.mockReset());
  it('shows the service status/node/uptime and Open + back', () => {
    const pop = vi.fn();
    render(<ServiceDetail data={DATA} nav={{ pop }} params={{ uid: 'vm-101:gitea' }} />);
    expect(screen.getByText('Gitea')).toBeInTheDocument();
    expect(screen.getByText('VM 101')).toBeInTheDocument();
    expect(screen.getByText('42.0%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(openTarget).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(pop).toHaveBeenCalled();
  });
  it('renders a not-found state for a stale uid', () => {
    render(<ServiceDetail data={DATA} nav={{ pop: vi.fn() }} params={{ uid: 'gone:x' }} />);
    expect(screen.getByText(/no longer/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 14: Run — fails.** `cd mobile && npm test -- src/views/ServiceDetail.test.jsx`

- [ ] **Step 15: Implement** `mobile/src/views/ServiceDetail.jsx`:
```jsx
import React from 'react';
import StatusDot from '../components/StatusDot.jsx';
import BackHeader from '../components/BackHeader.jsx';
import { flattenServices } from '../data/derive.js';
import { openTarget } from '../open.js';

export default function ServiceDetail({ data, nav, params }) {
  const svc = flattenServices(data.servicesBody).find((s) => s.uid === params.uid);
  if (!svc) {
    return (
      <section className="mobile-view" aria-label="Service detail">
        <BackHeader title="Service" onBack={nav.pop} />
        <p className="mobile-view__todo">This service is no longer reported.</p>
      </section>
    );
  }
  const u = svc.uptime24;
  return (
    <section className="mobile-view" aria-label="Service detail">
      <BackHeader title={svc.display_name} onBack={nav.pop} />
      <div className="detail-head">
        <StatusDot status={svc.status} />
        <span className="detail-head__node">{svc.nodeName}</span>
        {svc.ping != null && svc.ping > 0 && <span className="detail-head__ping">{svc.ping}ms</span>}
      </div>
      {u != null && (
        <p className="detail-uptime"><span>24H uptime</span> <strong>{(u * 100).toFixed(1)}%</strong></p>
      )}
      {svc.docker && (
        <div className="detail-docker">
          {svc.docker.cpu != null && <span>CPU {svc.docker.cpu}%</span>}
          {svc.docker.memMB != null && <span>MEM {svc.docker.memMB} MB</span>}
        </div>
      )}
      {svc.url && <button type="button" className="incident-card__open" onClick={() => openTarget({ kind: 'service', uid: svc.uid, url: svc.url })}>Open</button>}
    </section>
  );
}
```

- [ ] **Step 16: Create the shared `BackHeader`** (used by every detail screen) `mobile/src/components/BackHeader.jsx` + a quick test `mobile/src/components/BackHeader.test.jsx`:
```jsx
// BackHeader.jsx
import React from 'react';
/** Detail-screen header: a bottom-reachable back button + a title. */
export default function BackHeader({ title, onBack }) {
  return (
    <div className="back-header">
      <button type="button" className="back-header__btn" onClick={onBack} aria-label="Back">‹ Back</button>
      <h1 className="back-header__title">{title}</h1>
    </div>
  );
}
```
```jsx
// BackHeader.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BackHeader from './BackHeader.jsx';
describe('BackHeader', () => {
  it('renders a title and fires onBack', () => {
    const onBack = vi.fn();
    render(<BackHeader title="Gitea" onBack={onBack} />);
    expect(screen.getByText('Gitea')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(onBack).toHaveBeenCalled();
  });
});
```

- [ ] **Step 17: Run — passes.** `cd mobile && npm test -- src/views/ServiceDetail.test.jsx src/components/BackHeader.test.jsx`

- [ ] **Step 18: Add Services/detail CSS** to `mobile/src/MobileApp.css` (append):
```css
/* --- Phase 3: Services + detail --- */
.search-bar { width: 100%; box-sizing: border-box; padding: var(--space-3) var(--space-4); margin-bottom: var(--space-3); background: var(--bg-card-inner); border: 1px solid var(--border-color); border-radius: var(--card-radius-sm); color: var(--text-primary); font-family: var(--font-body); font-size: var(--text-base); }
.filter-chips { display: flex; gap: var(--space-2); overflow-x: auto; padding-bottom: var(--space-2); margin-bottom: var(--space-3); -webkit-overflow-scrolling: touch; }
.chip { flex-shrink: 0; min-height: 36px; padding: var(--space-2) var(--space-4); background: var(--bg-card-inner); border: 1px solid var(--border-color); border-radius: 999px; color: var(--text-secondary); font-size: var(--text-sm); white-space: nowrap; }
.chip--active { background: var(--accent-glow); border-color: var(--accent); color: var(--accent); }
.svc-list { display: flex; flex-direction: column; border-radius: var(--card-radius-sm); overflow: hidden; }
.back-header { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-3); }
.back-header__btn { background: none; border: none; color: var(--accent); font-size: var(--text-base); min-height: 44px; padding: 0 var(--space-2); }
.back-header__title { font-family: var(--font-display); font-size: var(--text-xl); margin: 0; }
.detail-head { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-3); }
.detail-head__node { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-muted); background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 4px; padding: 2px 6px; }
.detail-head__ping { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--green); }
.detail-uptime { display: flex; justify-content: space-between; font-family: var(--font-mono); font-size: var(--text-sm); color: var(--text-secondary); }
.detail-docker { display: flex; gap: var(--space-4); font-family: var(--font-mono); font-size: var(--text-sm); color: var(--text-secondary); margin-bottom: var(--space-3); }
```

- [ ] **Step 19: Commit.**
```
cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase3 && git add mobile/src/components/FilterChips.jsx mobile/src/components/FilterChips.test.jsx mobile/src/components/SearchBar.jsx mobile/src/components/SearchBar.test.jsx mobile/src/components/BackHeader.jsx mobile/src/components/BackHeader.test.jsx mobile/src/views/Services.jsx mobile/src/views/Services.test.jsx mobile/src/views/ServiceDetail.jsx mobile/src/views/ServiceDetail.test.jsx mobile/src/MobileApp.css && git commit -m "feat(mobile): Services problems-first list + chips/search + ServiceDetail"
```

---

## Task 7: NodeCard + Infra screen + NodeDetail

**Files:**
- Create: `mobile/src/components/NodeCard.jsx` + `.test.jsx`
- Replace: `mobile/src/views/Infra.jsx`
- Create: `mobile/src/views/Infra.test.jsx`
- Create: `mobile/src/views/NodeDetail.jsx` + `.test.jsx`
- Modify: `mobile/src/MobileApp.css`

**Interfaces:**
- `<NodeCard nodeKey node onTap />` — name, subtitle/type, CPU/MEM/DISK or TEMP (Pi) bars, "N up / M down".
- `Infra({ data, nav })` — node-card grid; tap→`nav.push('node', { nodeKey })`.
- `NodeDetail({ data, nav, params })` — full node metrics + that node's service list (`ServiceRow`), back; tapping a service pushes `serviceDetail`.

- [ ] **Step 1: Failing test — NodeCard** `mobile/src/components/NodeCard.test.jsx`:
```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import NodeCard from './NodeCard.jsx';

const VM = { display_name: 'VM 101', subtitle: 'app', metrics: { cpu: '45.3', memPercent: '31.2', diskPercent: '55.6', diskUnit: 'GB', temp: null }, services: [{ status: 'up' }, { status: 'down' }] };
const PI = { display_name: 'Gateway Pi', subtitle: 'edge', metrics: { cpu: '8.0', memPercent: '40.0', temp: '52.1', diskPercent: '20.0' }, services: [{ status: 'up' }] };

describe('NodeCard', () => {
  it('shows up/down counts and CPU/MEM/DISK bars for a normal node', () => {
    render(<NodeCard nodeKey="vm-101" node={VM} onTap={() => {}} />);
    expect(screen.getByText('VM 101')).toBeInTheDocument();
    expect(screen.getByText(/1 up \/ 1 down/)).toBeInTheDocument();
    expect(screen.getByText('DISK')).toBeInTheDocument();
    expect(screen.queryByText('TEMP')).toBeNull();
  });
  it('shows TEMP instead of DISK when the node reports a temperature (the Pi)', () => {
    render(<NodeCard nodeKey="gateway-pi" node={PI} onTap={() => {}} />);
    expect(screen.getByText('TEMP')).toBeInTheDocument();
    expect(screen.getByText('52.1°C')).toBeInTheDocument();
  });
  it('fires onTap with the nodeKey', () => {
    const onTap = vi.fn();
    render(<NodeCard nodeKey="vm-101" node={VM} onTap={onTap} />);
    fireEvent.click(screen.getByRole('button', { name: /VM 101/ }));
    expect(onTap).toHaveBeenCalledWith('vm-101');
  });
});
```

- [ ] **Step 2: Run — fails.** `cd mobile && npm test -- src/components/NodeCard.test.jsx`

- [ ] **Step 3: Implement** `mobile/src/components/NodeCard.jsx`:
```jsx
import React from 'react';
import UsageBar from './UsageBar.jsx';
import { nodeUpDown, parseMetricPct } from '../data/derive.js';

/**
 * Compact node card. Shows CPU + MEM always; the third bar is TEMP when the node
 * reports a temperature (the Pi), else DISK. Tap → onTap(nodeKey).
 */
export default function NodeCard({ nodeKey, node, onTap }) {
  const { up, down } = nodeUpDown(node);
  const m = node.metrics || {};
  const hasTemp = parseMetricPct(m.temp) != null;
  return (
    <button type="button" className="node-card" onClick={() => onTap(nodeKey)} aria-label={`${node.display_name} detail`}>
      <div className="node-card__head">
        <span className="node-card__name">{node.display_name}</span>
        {node.subtitle ? <span className="node-card__type">{node.subtitle}</span> : null}
      </div>
      <div className="node-card__count">{up} up{down ? ` / ${down} down` : ''}</div>
      <div className="node-card__bars">
        <UsageBar label="CPU" value={m.cpu} unit="%" percent={parseMetricPct(m.cpu)} />
        <UsageBar label="MEM" value={m.memPercent} unit="%" percent={parseMetricPct(m.memPercent)} />
        {hasTemp
          ? <UsageBar label="TEMP" value={m.temp} unit="°C" percent={parseMetricPct(m.temp)} />
          : <UsageBar label="DISK" value={m.diskPercent} unit="%" percent={parseMetricPct(m.diskPercent)} />}
      </div>
    </button>
  );
}
```

- [ ] **Step 4: Run — passes.** `cd mobile && npm test -- src/components/NodeCard.test.jsx`

- [ ] **Step 5: Failing test — Infra screen** `mobile/src/views/Infra.test.jsx`:
```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Infra from './Infra.jsx';

const DATA = { servicesBody: { nodes: {
  'vm-101': { display_name: 'VM 101', subtitle: 'app', metrics: { cpu: '45', memPercent: '31', diskPercent: '55' }, services: [{ status: 'up' }] },
  'gateway-pi': { display_name: 'Gateway Pi', subtitle: 'edge', metrics: { cpu: '8', memPercent: '40', temp: '52' }, services: [{ status: 'up' }] },
} } };

describe('Infra', () => {
  it('renders a card per node and pushes node detail on tap', () => {
    const push = vi.fn();
    render(<Infra data={DATA} nav={{ push }} />);
    expect(screen.getByText('VM 101')).toBeInTheDocument();
    expect(screen.getByText('Gateway Pi')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Gateway Pi/ }));
    expect(push).toHaveBeenCalledWith('node', { nodeKey: 'gateway-pi' });
  });
});
```

- [ ] **Step 6: Run — fails.** `cd mobile && npm test -- src/views/Infra.test.jsx`

- [ ] **Step 7: Implement** `mobile/src/views/Infra.jsx`:
```jsx
import React from 'react';
import NodeCard from '../components/NodeCard.jsx';
import { groupByNode } from '../data/derive.js';

export default function Infra({ data, nav }) {
  const nodes = groupByNode(data.servicesBody);
  return (
    <section className="mobile-view" aria-label="Infra">
      <h1>Infra</h1>
      <div className="node-grid">
        {nodes.map(({ nodeKey, node }) => (
          <NodeCard key={nodeKey} nodeKey={nodeKey} node={node} onTap={(k) => nav.push('node', { nodeKey: k })} />
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 8: Run — passes.** `cd mobile && npm test -- src/views/Infra.test.jsx`

- [ ] **Step 9: Failing test — NodeDetail** `mobile/src/views/NodeDetail.test.jsx`:
```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
vi.mock('@shared/hooks/useData.js', () => ({ getServiceIcon: () => null }));
import NodeDetail from './NodeDetail.jsx';

const DATA = { servicesBody: { nodes: { 'vm-101': {
  display_name: 'VM 101', subtitle: 'app', metrics: { cpu: '45', memPercent: '31', diskPercent: '55', diskUnit: 'GB' },
  services: [
    { uid: 'vm-101:adguard', display_name: 'AdGuard', icon: null, status: 'up', ping: 12, uptime24: 0.99, url: '' },
    { uid: 'vm-101:gitea', display_name: 'Gitea', icon: null, status: 'down', ping: null, uptime24: 0.42, url: 'http://h/gitea' },
  ],
} } } };

describe('NodeDetail', () => {
  it('shows the node metrics and its full service list, problems-first', () => {
    render(<NodeDetail data={DATA} nav={{ pop: vi.fn(), push: vi.fn() }} params={{ nodeKey: 'vm-101' }} />);
    expect(screen.getByText('VM 101')).toBeInTheDocument();
    const names = screen.getAllByText(/AdGuard|Gitea/).map((n) => n.textContent);
    expect(names[0]).toBe('Gitea'); // down first
  });
  it('tapping a service pushes its detail', () => {
    const push = vi.fn();
    render(<NodeDetail data={DATA} nav={{ pop: vi.fn(), push }} params={{ nodeKey: 'vm-101' }} />);
    fireEvent.click(screen.getByRole('button', { name: /Gitea/ }));
    expect(push).toHaveBeenCalledWith('serviceDetail', { uid: 'vm-101:gitea' });
  });
  it('back pops the stack', () => {
    const pop = vi.fn();
    render(<NodeDetail data={DATA} nav={{ pop, push: vi.fn() }} params={{ nodeKey: 'vm-101' }} />);
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(pop).toHaveBeenCalled();
  });
});
```

- [ ] **Step 10: Run — fails.** `cd mobile && npm test -- src/views/NodeDetail.test.jsx`

- [ ] **Step 11: Implement** `mobile/src/views/NodeDetail.jsx`:
```jsx
import React from 'react';
import BackHeader from '../components/BackHeader.jsx';
import UsageBar from '../components/UsageBar.jsx';
import ServiceRow from '../components/ServiceRow.jsx';
import { sortProblemsFirst, parseMetricPct } from '../data/derive.js';

export default function NodeDetail({ data, nav, params }) {
  const node = data.servicesBody?.nodes?.[params.nodeKey];
  if (!node) {
    return (
      <section className="mobile-view" aria-label="Node detail">
        <BackHeader title="Node" onBack={nav.pop} />
        <p className="mobile-view__todo">This node is no longer reported.</p>
      </section>
    );
  }
  const m = node.metrics || {};
  const services = sortProblemsFirst((node.services || []).map((s) => ({ ...s, nodeKey: params.nodeKey, nodeName: node.display_name })));
  const hasTemp = parseMetricPct(m.temp) != null;
  return (
    <section className="mobile-view" aria-label="Node detail">
      <BackHeader title={node.display_name} onBack={nav.pop} />
      <div className="node-detail__bars">
        <UsageBar label="CPU" value={m.cpu} unit="%" percent={parseMetricPct(m.cpu)} />
        <UsageBar label="MEM" value={m.memPercent} unit="%" percent={parseMetricPct(m.memPercent)} />
        {hasTemp
          ? <UsageBar label="TEMP" value={m.temp} unit="°C" percent={parseMetricPct(m.temp)} />
          : <UsageBar label="DISK" value={m.diskPercent} unit="%" percent={parseMetricPct(m.diskPercent)} />}
      </div>
      <div className="svc-list">
        {services.map((s) => (
          <ServiceRow key={s.uid} service={s} onTap={() => nav.push('serviceDetail', { uid: s.uid })} />
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 12: Run — passes.** `cd mobile && npm test -- src/views/NodeDetail.test.jsx`

- [ ] **Step 13: Add Infra CSS** to `mobile/src/MobileApp.css` (append):
```css
/* --- Phase 3: Infra --- */
.node-grid { display: grid; grid-template-columns: 1fr; gap: var(--space-3); }
.node-card { width: 100%; text-align: left; display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-4); background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--card-radius-sm); }
.node-card__head { display: flex; align-items: baseline; gap: var(--space-2); }
.node-card__name { font-family: var(--font-display); font-size: var(--text-lg); color: var(--text-primary); }
.node-card__type { font-family: var(--font-mono); font-size: var(--text-2xs); color: var(--text-muted); }
.node-card__count { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-secondary); }
.node-card__bars, .node-detail__bars { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-3); }
.node-detail__bars { margin-bottom: var(--space-4); }
```

- [ ] **Step 14: Commit.**
```
cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase3 && git add mobile/src/components/NodeCard.jsx mobile/src/components/NodeCard.test.jsx mobile/src/views/Infra.jsx mobile/src/views/Infra.test.jsx mobile/src/views/NodeDetail.jsx mobile/src/views/NodeDetail.test.jsx mobile/src/MobileApp.css && git commit -m "feat(mobile): Infra node cards + NodeDetail with per-node service list"
```

---

## Task 8: Alerts screen + IncidentDetail (day-grouping + pinned active)

The server has no push-history store yet (push is Phase 4/5). For Phase 3 the **active** incidents are the live-derived ones (pinned red at top); the "history grouped by day" section renders from whatever derived incidents exist, grouped under a "Today" heading, with the day-grouping helper unit-tested against multi-day fixture input so it is ready for the Phase-5 real history feed. This is the resolved scope (see Self-Review).

**Files:**
- Create: `mobile/src/data/groupByDay.js` + `.test.js`
- Replace: `mobile/src/views/Alerts.jsx`
- Create: `mobile/src/views/Alerts.test.jsx`
- Create: `mobile/src/views/IncidentDetail.jsx` + `.test.jsx`
- Modify: `mobile/src/MobileApp.css`

**Interfaces:**
- `groupByDay(items, getDate): Array<{ day: string, items: T[] }>` — pure, newest-day first.
- `Alerts({ data, nav })` — pinned active incident(s) at top + day-grouped list + inert gear; tap→`nav.push('incident', { id })`.
- `IncidentDetail({ data, nav, params })` — full incident: status, node, cause, 24h uptime, event timeline (incl. a "push sent" placeholder row), **Open**, back.

- [ ] **Step 1: Failing test — groupByDay** `mobile/src/data/groupByDay.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { groupByDay } from './groupByDay.js';

describe('groupByDay', () => {
  it('groups items by calendar day, newest day first', () => {
    const items = [
      { id: 'a', at: '2026-06-26T10:00:00Z' },
      { id: 'b', at: '2026-06-26T18:00:00Z' },
      { id: 'c', at: '2026-06-25T09:00:00Z' },
    ];
    const groups = groupByDay(items, (i) => new Date(i.at));
    expect(groups).toHaveLength(2);
    expect(groups[0].items.map((i) => i.id).sort()).toEqual(['a', 'b']);
    expect(groups[1].items.map((i) => i.id)).toEqual(['c']);
    expect(new Date(groups[0].day) >= new Date(groups[1].day)).toBe(true);
  });
  it('returns [] for empty input', () => expect(groupByDay([], () => new Date())).toEqual([]));
});
```

- [ ] **Step 2: Run — fails.** `cd mobile && npm test -- src/data/groupByDay.test.js`

- [ ] **Step 3: Implement** `mobile/src/data/groupByDay.js`:
```js
/**
 * Group items by calendar day (local), newest day first. `getDate(item)` returns
 * a Date. `day` is the YYYY-MM-DD key. Pure; ready for the Phase-5 push-history
 * feed but used in Phase 3 against live-derived incidents.
 */
export function groupByDay(items, getDate) {
  const byDay = new Map();
  for (const item of items) {
    const d = getDate(item);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(item);
  }
  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([day, list]) => ({ day, items: list }));
}
```

- [ ] **Step 4: Run — passes.** `cd mobile && npm test -- src/data/groupByDay.test.js`

- [ ] **Step 5: Failing test — Alerts screen** `mobile/src/views/Alerts.test.jsx`:
```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
const { openTarget } = vi.hoisted(() => ({ openTarget: vi.fn() }));
vi.mock('../open.js', () => ({ openTarget }));
import Alerts from './Alerts.jsx';

const DATA = {
  servicesBody: { nodes: { 'vm-101': { display_name: 'VM 101', metrics: {}, services: [
    { uid: 'vm-101:gitea', display_name: 'Gitea', icon: null, status: 'down', ping: null, uptime24: 0.42, url: 'http://h/gitea' },
  ] } } },
  ups: { status: 1 }, cron: [], history: {}, loading: false, error: null,
};

describe('Alerts', () => {
  it('pins the active incident at top and shows a day section', () => {
    render(<Alerts data={DATA} nav={{ push: vi.fn() }} />);
    expect(screen.getByText(/Active/i)).toBeInTheDocument();
    expect(screen.getByText('Gitea')).toBeInTheDocument();
    expect(screen.getByText(/Today/i)).toBeInTheDocument();
  });
  it('renders a disabled, inert notification gear (Phase 5)', () => {
    render(<Alerts data={DATA} nav={{ push: vi.fn() }} />);
    const gear = screen.getByRole('button', { name: /notification settings/i });
    expect(gear).toBeDisabled();
  });
  it('tapping an incident pushes its detail', () => {
    const push = vi.fn();
    render(<Alerts data={DATA} nav={{ push }} />);
    fireEvent.click(screen.getByRole('button', { name: /Gitea/ }));
    expect(push).toHaveBeenCalledWith('incident', { id: 'service:vm-101:gitea' });
  });
  it('shows an empty state when nothing is wrong', () => {
    const calm = { ...DATA, servicesBody: { nodes: {} }, ups: { status: 1 }, cron: [] };
    render(<Alerts data={calm} nav={{ push: vi.fn() }} />);
    expect(screen.getByText(/All clear/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run — fails.** `cd mobile && npm test -- src/views/Alerts.test.jsx`

- [ ] **Step 7: Implement** `mobile/src/views/Alerts.jsx`:
```jsx
import React from 'react';
import { deriveIncidents } from '../data/derive.js';
import { groupByDay } from '../data/groupByDay.js';

/**
 * Alerts: the active (live-derived) incidents are pinned at top; below, the same
 * incidents are grouped by day (Phase 3 has no persisted push history yet — the
 * real history feed lands in Phase 5; the day-grouping is wired + tested now).
 * The notification-settings gear is rendered DISABLED/inert (Phase 5 owns it).
 */
export default function Alerts({ data, nav }) {
  const incidents = deriveIncidents({ services: data.servicesBody, ups: data.ups, cron: data.cron });
  // Phase 3: derived incidents are "now"; tag each with a timestamp for grouping.
  const now = new Date();
  const dated = incidents.map((i) => ({ ...i, at: now }));
  const groups = groupByDay(dated, (i) => i.at);

  return (
    <section className="mobile-view" aria-label="Alerts">
      <div className="alerts-head">
        <h1>Alerts</h1>
        <button type="button" className="alerts-gear" aria-label="Notification settings (coming soon)" disabled title="Coming soon">⚙</button>
      </div>

      {incidents.length === 0 && <p className="alerts-clear">All clear — nothing is on fire.</p>}

      {incidents.length > 0 && (
        <>
          <h2 className="alerts-section alerts-section--active">Active</h2>
          {incidents.map((inc) => (
            <button key={inc.id} type="button" className="alert-row alert-row--active" onClick={() => nav.push('incident', { id: inc.id })} aria-label={`${inc.title} on ${inc.node}`}>
              <span className="alert-row__title">{inc.title}</span>
              <span className="alert-row__node">{inc.node}</span>
            </button>
          ))}
          {groups.map((g) => (
            <div key={g.day}>
              <h2 className="alerts-section">Today</h2>
              {g.items.map((inc) => (
                <button key={`h-${inc.id}`} type="button" className="alert-row" onClick={() => nav.push('incident', { id: inc.id })} aria-label={`${inc.title} history`}>
                  <span className="alert-row__title">{inc.title}</span>
                  <span className="alert-row__cause">{inc.cause}</span>
                </button>
              ))}
            </div>
          ))}
        </>
      )}
    </section>
  );
}
```
> The duplicate `aria-label` for the active row matching `/Gitea/` satisfies the test's "push detail" click; the history rows use a distinct label so the active row is the one matched.

- [ ] **Step 8: Run — passes.** `cd mobile && npm test -- src/views/Alerts.test.jsx`

- [ ] **Step 9: Failing test — IncidentDetail** `mobile/src/views/IncidentDetail.test.jsx`:
```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
const { openTarget } = vi.hoisted(() => ({ openTarget: vi.fn() }));
vi.mock('../open.js', () => ({ openTarget }));
import IncidentDetail from './IncidentDetail.jsx';

const DATA = {
  servicesBody: { nodes: { 'vm-101': { display_name: 'VM 101', metrics: {}, services: [
    { uid: 'vm-101:gitea', display_name: 'Gitea', icon: null, status: 'down', ping: null, uptime24: 0.42, url: 'http://h/gitea' },
  ] } } },
  ups: { status: 1 }, cron: [], history: {}, loading: false, error: null,
};

describe('IncidentDetail', () => {
  beforeEach(() => openTarget.mockReset());
  it('shows status/node/cause/uptime + a timeline + Open + back', () => {
    const pop = vi.fn();
    render(<IncidentDetail data={DATA} nav={{ pop }} params={{ id: 'service:vm-101:gitea' }} />);
    expect(screen.getByText('Gitea')).toBeInTheDocument();
    expect(screen.getByText('VM 101')).toBeInTheDocument();
    expect(screen.getByText('Service is down')).toBeInTheDocument();
    expect(screen.getByText('42.0%')).toBeInTheDocument();
    expect(screen.getByText(/timeline/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(openTarget).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(pop).toHaveBeenCalled();
  });
  it('handles a resolved/stale incident id gracefully', () => {
    render(<IncidentDetail data={DATA} nav={{ pop: vi.fn() }} params={{ id: 'service:gone:x' }} />);
    expect(screen.getByText(/resolved/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 10: Run — fails.** `cd mobile && npm test -- src/views/IncidentDetail.test.jsx`

- [ ] **Step 11: Implement** `mobile/src/views/IncidentDetail.jsx`:
```jsx
import React from 'react';
import BackHeader from '../components/BackHeader.jsx';
import StatusDot from '../components/StatusDot.jsx';
import { deriveIncidents } from '../data/derive.js';
import { openTarget } from '../open.js';

export default function IncidentDetail({ data, nav, params }) {
  const incident = deriveIncidents({ services: data.servicesBody, ups: data.ups, cron: data.cron }).find((i) => i.id === params.id);
  if (!incident) {
    return (
      <section className="mobile-view" aria-label="Incident detail">
        <BackHeader title="Incident" onBack={nav.pop} />
        <p className="mobile-view__todo">This incident has resolved.</p>
      </section>
    );
  }
  const u = incident.uptime24;
  // Phase 3 timeline: derived "detected" event now; "push sent" is a placeholder
  // row (the real push-sent events arrive with the Phase-4/5 push pipeline).
  const events = [
    { label: 'Detected', detail: incident.cause },
    { label: 'Push sent', detail: 'Pending — push pipeline lands in Phase 5' },
  ];
  return (
    <section className="mobile-view" aria-label="Incident detail">
      <BackHeader title={incident.title} onBack={nav.pop} />
      <div className="detail-head">
        <StatusDot status={incident.status} />
        <span className="detail-head__node">{incident.node}</span>
      </div>
      <p className="detail-cause">{incident.cause}</p>
      {u != null && <p className="detail-uptime"><span>24H uptime</span> <strong>{(u * 100).toFixed(1)}%</strong></p>}
      <h2 className="detail-section">Event timeline</h2>
      <ul className="timeline">
        {events.map((e, i) => (
          <li key={i} className="timeline__item"><span className="timeline__label">{e.label}</span><span className="timeline__detail">{e.detail}</span></li>
        ))}
      </ul>
      {incident.target?.url && <button type="button" className="incident-card__open" onClick={() => openTarget(incident.target)}>Open</button>}
    </section>
  );
}
```

- [ ] **Step 12: Run — passes.** `cd mobile && npm test -- src/views/IncidentDetail.test.jsx`

- [ ] **Step 13: Add Alerts/IncidentDetail CSS** to `mobile/src/MobileApp.css` (append):
```css
/* --- Phase 3: Alerts + incident detail --- */
.alerts-head { display: flex; align-items: center; justify-content: space-between; }
.alerts-gear { background: none; border: none; color: var(--text-muted); font-size: var(--text-xl); min-height: 44px; min-width: 44px; opacity: 0.5; }
.alerts-clear { color: var(--text-muted); }
.alerts-section { font-family: var(--font-display); font-size: var(--text-base); color: var(--text-secondary); margin: var(--space-4) 0 var(--space-2); }
.alerts-section--active { color: var(--red); }
.alert-row { display: flex; flex-direction: column; gap: 2px; width: 100%; text-align: left; padding: var(--space-3) var(--space-4); background: var(--bg-card-inner); border: 1px solid var(--border-color); border-radius: var(--card-radius-sm); margin-bottom: var(--space-2); }
.alert-row--active { background: var(--red-bg); border-color: var(--red-border); }
.alert-row__title { font-family: var(--font-display); font-size: var(--text-base); color: var(--text-primary); }
.alert-row__node, .alert-row__cause { font-family: var(--font-mono); font-size: var(--text-2xs); color: var(--text-muted); }
.detail-cause { color: var(--text-secondary); font-size: var(--text-sm); }
.detail-section { font-family: var(--font-display); font-size: var(--text-base); color: var(--text-secondary); margin: var(--space-4) 0 var(--space-2); }
.timeline { list-style: none; padding: 0; margin: 0 0 var(--space-4); }
.timeline__item { display: flex; flex-direction: column; gap: 2px; padding: var(--space-2) 0; border-left: 2px solid var(--border-color); padding-left: var(--space-3); }
.timeline__label { font-family: var(--font-body); font-size: var(--text-sm); color: var(--text-primary); }
.timeline__detail { font-family: var(--font-mono); font-size: var(--text-2xs); color: var(--text-muted); }
```

- [ ] **Step 14: Commit.**
```
cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase3 && git add mobile/src/data/groupByDay.js mobile/src/data/groupByDay.test.js mobile/src/views/Alerts.jsx mobile/src/views/Alerts.test.jsx mobile/src/views/IncidentDetail.jsx mobile/src/views/IncidentDetail.test.jsx mobile/src/MobileApp.css && git commit -m "feat(mobile): Alerts day-grouped + pinned active + IncidentDetail timeline"
```

---

## Task 9: Per-tab screen dispatch (wire detail screens into each tab's stack)

The views call `nav.push('serviceDetail'|'node'|'incident', …)` but a tab currently always renders its root view. This task adds a per-tab **screen dispatcher** so the pushed detail actually renders (and back/hardware-back pops it), completing the navigation loop.

**Files:**
- Modify: `mobile/src/MobileApp.jsx`
- Modify: `mobile/src/MobileApp.test.jsx`

**Interfaces:** the active tab renders `current.screen` via a `SCREENS` map → `{ overview, services, infra, alerts, serviceDetail, node, incident }`.

- [ ] **Step 1: Failing test** — extend `mobile/src/MobileApp.test.jsx` to assert a pushed detail renders the real detail view (replace the `Services` stub mock so it pushes `serviceDetail` and assert `ServiceDetail` renders). Add:
```jsx
// Replace the Services stub's behaviour and add a ServiceDetail spy mock at top:
vi.mock('./views/ServiceDetail.jsx', () => ({ default: ({ nav }) => <div>SERVICE_DETAIL<button onClick={nav.pop}>back</button></div> }));
// ...and a new case inside the describe:
it('renders the pushed serviceDetail screen, and back returns to the list', () => {
  render(<MobileApp />);
  fireEvent.click(screen.getByRole('tab', { name: 'Services' }));
  fireEvent.click(screen.getByText('go-detail')); // Services stub pushes serviceDetail
  expect(screen.getByText('SERVICE_DETAIL')).toBeInTheDocument();
  fireEvent.click(screen.getByText('back'));
  expect(screen.queryByText('SERVICE_DETAIL')).toBeNull();
});
```
> Adjust the existing `Services` stub mock so `go-detail` pushes `serviceDetail` (not the ad-hoc screen used in Task 3) and remove the inline `DetailView` branch — the dispatcher now renders the real (mocked) `ServiceDetail`.

- [ ] **Step 2: Run — fails** (MobileApp still renders only the tab root). `cd mobile && npm test -- src/MobileApp.test.jsx`

- [ ] **Step 3: Implement the dispatcher** in `mobile/src/MobileApp.jsx` — import the detail views and render by `current.screen`:
```jsx
// add imports:
import ServiceDetail from './views/ServiceDetail.jsx';
import NodeDetail from './views/NodeDetail.jsx';
import IncidentDetail from './views/IncidentDetail.jsx';
// add a screen map (root screens + detail screens):
const SCREENS = {
  overview: Overview, services: Services, infra: Infra, alerts: Alerts,
  serviceDetail: ServiceDetail, node: NodeDetail, incident: IncidentDetail,
};
// replace the <ActiveView .../> render with a dispatch on nav.current.screen:
//   const Screen = SCREENS[nav.current.screen] || VIEWS[active];
//   <Screen nav={nav} data={data} params={nav.current.params} />
```
Concretely, the `return` becomes:
```jsx
  const Screen = SCREENS[nav.current.screen] || VIEWS[active];
  return (
    <div id="mobile-root">
      <main className="mobile-content">
        <Screen nav={nav} data={data} params={nav.current.params} />
      </main>
      <nav className="mobile-tabbar" role="tablist" aria-label="Primary">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={active === t.id} onClick={() => onTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
```
> `VIEWS`/`ROOT` stay; the root screen ids (`overview`/`services`/`infra`/`alerts`) live in BOTH maps so a tab root resolves through `SCREENS` too. The tab bar always stays mounted (it is part of the one-hand IA; detail screens have their own in-content Back).

- [ ] **Step 4: Run — passes.** `cd mobile && npm test -- src/MobileApp.test.jsx`

- [ ] **Step 5: Full suite green.**
```
cd mobile && npm test
```
Expected: all Phase-2 + Phase-3 suites pass; no unhandled errors.

- [ ] **Step 6: Build smoke** (catches shared-import/alias breakage):
```
cd mobile && npm run build
```
Expected: Vite build completes, `mobile/dist/` produced.

- [ ] **Step 7: Commit.**
```
cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase3 && git add mobile/src/MobileApp.jsx mobile/src/MobileApp.test.jsx && git commit -m "feat(mobile): per-tab screen dispatcher wires detail screens into nav stack"
```

---

## Task 10: Playwright visual pass (fixtures → PNGs)

A dev-tool harness rendering each screen against canned fixtures to PNGs for human eyeballing. NOT shipped, NOT in `npm run build`, NOT imported by the app.

**Files:**
- Create: `mobile/visual/fixtures.js`
- Create: `mobile/visual/render.html`
- Create: `mobile/visual/shoot.mjs`
- Modify: `mobile/.gitignore` (add `visual/out/`)

**Fixtures (the states the human must eyeball):**
1. `calm` — all services up, UPS online, no cron failures (Overview all-green strip, no incidents).
2. `degradedSubsystem` — one down service (Services cell red + tinted) + cron failure.
3. `multiIncident` — ≥3 down services + on-battery UPS (Overview "+N more" collapse).
4. `downService` — Services screen with a problems-first down row at top.
5. `nodeDetail` — a node with mixed up/down services (NodeDetail).
6. `incidentDetail` — a single incident (IncidentDetail timeline).

- [ ] **Step 1: Create `mobile/visual/fixtures.js`** — export plain objects matching the real shapes (synthetic homelab strings only, NO secrets):
```js
// Synthetic fixtures for the visual pass. Plain data; no secrets, no real hosts.
export const calm = {
  services: { nodes: {
    'vm-101': { display_name: 'VM 101', subtitle: 'app', metrics: { cpu: '22.4', memPercent: '38.1', diskPercent: '41.0', diskUnit: 'GB', temp: null }, services: [
      { uid: 'vm-101:gitea', container: 'gitea', display_name: 'Gitea', icon: null, status: 'up', ping: 8, uptime24: 0.999, url: 'http://example/gitea', docker: { cpu: 2, memMB: 180 } },
      { uid: 'vm-101:grafana', container: 'grafana', display_name: 'Grafana', icon: null, status: 'up', ping: 11, uptime24: 0.998, url: 'http://example/grafana', docker: { cpu: 1, memMB: 90 } },
    ] },
    'gateway-pi': { display_name: 'Gateway Pi', subtitle: 'edge', metrics: { cpu: '6.0', memPercent: '30.0', temp: '48.2', diskPercent: '18.0' }, services: [
      { uid: 'gateway-pi:pihole', container: 'pihole', display_name: 'Pi-hole', icon: null, status: 'up', ping: 3, uptime24: 1, url: 'http://example/pihole', docker: null },
    ] },
  } },
  ups: { status: 1, charge: 100, runtime: 3600, load: 22 },
  cron: [{ node: 'vm-101', jobs: [{ job: 'backup', runs: [{ status: 'success', timestamp: '2026-06-26T03:00:00Z' }] }] }],
  history: { 'vm-101:cpu': [20, 22, 21, 23, 22], 'gateway-pi:cpu': [5, 6, 6, 7, 6] },
};
export const degradedSubsystem = {
  ...calm,
  services: { nodes: { ...calm.services.nodes, 'vm-101': { ...calm.services.nodes['vm-101'], services: [
    { ...calm.services.nodes['vm-101'].services[0], status: 'down', uptime24: 0.44 },
    calm.services.nodes['vm-101'].services[1],
  ] } } },
  cron: [{ node: 'vm-101', jobs: [{ job: 'backup', runs: [{ status: 'failure', timestamp: '2026-06-26T03:00:00Z', error: 'Disk full on /backups' }] }] }],
};
export const multiIncident = {
  ...calm,
  services: { nodes: { 'vm-101': { ...calm.services.nodes['vm-101'], services: [
    { uid: 'vm-101:gitea', container: 'gitea', display_name: 'Gitea', icon: null, status: 'down', ping: null, uptime24: 0.42, url: 'http://example/gitea', docker: null },
    { uid: 'vm-101:grafana', container: 'grafana', display_name: 'Grafana', icon: null, status: 'down', ping: null, uptime24: 0.61, url: 'http://example/grafana', docker: null },
    { uid: 'vm-101:nextcloud', container: 'nextcloud', display_name: 'Nextcloud', icon: null, status: 'down', ping: null, uptime24: 0.73, url: 'http://example/nc', docker: null },
  ] } } },
  ups: { status: 0, charge: 76, runtime: 1200, load: 40 },
};
```

- [ ] **Step 2: Create `mobile/visual/render.html`** — a static page that mounts a chosen screen + fixture. It imports the built ESM via Vite dev or a small inline bundler. To keep it dependency-free, render via a tiny mount script that imports the source modules through Vite's dev server is heavy; instead the harness uses `vite build` output is also heavy. SIMPLEST: `shoot.mjs` runs `vite` preview of a dedicated `visual` entry. Implement `render.html` as the Vite entry that reads `?screen=&fixture=` and mounts:
```html
<!doctype html>
<html data-theme="">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <link rel="stylesheet" href="/src/styles/global.css" />
    <style>html,body{margin:0;background:#282c34} #app{width:390px;margin:0 auto;min-height:844px}</style>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./mount.jsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Create `mobile/visual/mount.jsx`** — reads query params, builds the `data` prop from a fixture, and renders the chosen screen inside a fake `nav`:
```jsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import '@shared/styles/global.css';
import * as fx from './fixtures.js';
import Overview from '../src/views/Overview.jsx';
import Services from '../src/views/Services.jsx';
import Infra from '../src/views/Infra.jsx';
import Alerts from '../src/views/Alerts.jsx';
import ServiceDetail from '../src/views/ServiceDetail.jsx';
import NodeDetail from '../src/views/NodeDetail.jsx';
import IncidentDetail from '../src/views/IncidentDetail.jsx';

const SCREENS = { overview: Overview, services: Services, infra: Infra, alerts: Alerts, serviceDetail: ServiceDetail, node: NodeDetail, incident: IncidentDetail };
const params = new URLSearchParams(location.search);
const fixture = fx[params.get('fixture') || 'calm'];
const data = { servicesBody: fixture.services, ups: fixture.ups, cron: fixture.cron, history: fixture.history, loading: false, error: null };
const nav = { push() {}, pop() {}, reset() {}, canPop: false, current: { screen: params.get('screen'), params: {} } };
const Screen = SCREENS[params.get('screen') || 'overview'];
const detailParams = { uid: params.get('uid') || '', nodeKey: params.get('nodeKey') || '', id: params.get('id') || '' };
createRoot(document.getElementById('app')).render(<Screen data={data} nav={nav} params={detailParams} />);
```
> Note: visual `mount.jsx` mocks the base-aware icon by leaving `getApiBase()` at its `/api` default (icons may 404 in the harness — acceptable; the screenshot is for layout/design, and `ServiceRow` hides a broken `<img>` via `onError`). No network is required for the layout pass.

- [ ] **Step 4: Create `mobile/visual/shoot.mjs`** — start a Vite dev server on the `mobile/` root, then drive Chromium over each `(screen,fixture)`:
```js
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';

const OUT = fileURLToPath(new URL('./out/', import.meta.url));
const SHOTS = [
  ['overview', 'calm', 'overview-calm'],
  ['overview', 'degradedSubsystem', 'overview-degraded'],
  ['overview', 'multiIncident', 'overview-multi'],
  ['services', 'degradedSubsystem', 'services-down'],
  ['node', 'degradedSubsystem', 'node-detail', { nodeKey: 'vm-101' }],
  ['incident', 'multiIncident', 'incident-detail', { id: 'service:vm-101:gitea' }],
  ['alerts', 'multiIncident', 'alerts-multi'],
  ['infra', 'calm', 'infra-calm'],
];

const server = await createServer({ configFile: fileURLToPath(new URL('../vite.config.mobile.js', import.meta.url)), root: fileURLToPath(new URL('..', import.meta.url)), server: { port: 5199 } });
await server.listen();
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
for (const [screenName, fixture, name, extra = {}] of SHOTS) {
  const qs = new URLSearchParams({ screen: screenName, fixture, ...extra }).toString();
  await page.goto(`http://localhost:5199/visual/render.html?${qs}`, { waitUntil: 'networkidle' });
  try { await page.evaluate(() => document.fonts.ready); } catch {}
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}${name}.png`, fullPage: true });
  console.log('shot', name);
}
await browser.close();
await server.close();
console.log('SHOTS_DONE');
```

- [ ] **Step 5: Gitignore the output** — add to `mobile/.gitignore`:
```
visual/out/
```

- [ ] **Step 6: Run the visual pass** (Chromium/Playwright is system-installed):
```
cd mobile && node visual/shoot.mjs
```
Expected: prints `shot overview-calm` … `SHOTS_DONE`; PNGs land in `mobile/visual/out/`.
> If `playwright` is not resolvable from `mobile/`, run with the system Playwright (e.g. `node --experimental-vm-modules` is not needed; if the import fails, install transient `npm i -D playwright` is FORBIDDEN here — instead invoke via the system path used by `/tmp/shotter`, or document the exact node invocation that resolves the system `playwright`). The harness exists to be run by hand; CI does not run it.

- [ ] **Step 7: Eyeball + commit the harness** (not the PNGs):
```
cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase3 && git add mobile/visual/fixtures.js mobile/visual/render.html mobile/visual/mount.jsx mobile/visual/shoot.mjs mobile/.gitignore && git commit -m "test(mobile): Playwright visual pass — fixtures + screen renderer for human review"
```

---

## Task 11: Ledger, full-suite + secret-scan + build verification, pre-done gate

**Files:**
- Modify: `.harness-ledger.md`

- [ ] **Step 1: Append Phase-3 captures** to `.harness-ledger.md` (honest notes; no secrets): (a) the server has **no incident model** → incidents/degraded derived client-side in `mobile/src/data/derive.js`; (b) the server field is **`uptime24`** while desktop `ServiceCard` reads `.uptime` (upstream rename) — mobile consumes the RAW body field `uptime24`; (c) `/history` is node-level CPU/MEM/DISK series, **not** per-service uptime → incident "24h" is the `uptime24` scalar, not a series; (d) the **icon-extraction was deliberately NOT done** (YAGNI — desktop keys off `.name`, mobile off `display_name`); (e) the **visual pass is a dev tool** (not shipped, not in CI); (f) **notification-settings gear is inert** (Phase 5 owns the screen).

- [ ] **Step 2: Full test suite green.**
```
cd mobile && npm test
```
Expected: all suites pass.

- [ ] **Step 3: Build green.**
```
cd mobile && npm run build
```
Expected: `mobile/dist/` produced, no shared-import/alias errors.

- [ ] **Step 4: Secret-scan green** (run the repo's floor entrypoint from the worktree root):
```
cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase3 && python3 scripts/secret-scan.py --check
```
Expected: scan passes (no secrets in fixtures/components). If the repo exposes a different floor entrypoint (`scan.py --check`), run that instead.

- [ ] **Step 5: Confirm desktop untouched** — the only `src/` change permitted (icon extraction) was NOT taken, so `git diff --stat main -- src/` shows no behavioural `src/` changes (only `mobile/` + `docs/` + `.harness-ledger.md`):
```
cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase3 && git diff --stat main -- src/
```
Expected: empty (no desktop source touched).

- [ ] **Step 6: Commit the ledger.**
```
cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase3 && git add .harness-ledger.md && git commit -m "docs(harness): Phase 3 captures — client-derived incidents, uptime24, visual-pass-as-tool"
```

- [ ] **Step 7: Mandatory pre-done gate (HARD RULE).** Run `/simplify` then `/security-review` over the Phase-3 diff; address findings; re-run `cd mobile && npm test`. Then open the PR (branch `feat/mobile-phase3-ux` → `main`) for Jag to review + merge. NEVER push to main, auto-merge, use `--no-verify`, or add a `Co-Authored-By` trailer.

---

## Self-Review

**Spec coverage vs the Phase 3 bullet (DESIGN.md line 785) + the UX/IA (lines 29–44):**

| Spec requirement | Where delivered |
|---|---|
| Overview subsystem strip (Services/Nodes/UPS/Cron; green/red; alarm-tint when degraded) | Task 5 `SubsystemStrip` + `deriveSubsystems` (Task 1) |
| Overview active incidents EXPANDED INLINE (cause + 24h uptime spark + Open; "+N more") | Task 5 `IncidentCard` + Overview "+N more" collapse |
| Overview compact node rows with CPU/MEM bars | Task 5 Overview node rows + `UsageBar` (Task 2) |
| Services FLAT problems-first list, node tags, chips (All/Down/per-node), search, tap→detail | Task 6 Services + `sortProblemsFirst` (Task 1) + `FilterChips`/`SearchBar`/`ServiceRow` |
| Services base-aware icons (never relative `/api/icons/cached`) | Task 2 `ServiceRow` via `getServiceIcon` + its base-aware test |
| Infra compact node cards (name, type, CPU/MEM/DISK or TEMP for Pi, N up/M down) | Task 7 `NodeCard` (TEMP-vs-DISK branch) |
| Infra node detail with that node's full service list | Task 7 `NodeDetail` |
| Alerts history grouped by day + pinned active incident + tap→incident detail | Task 8 Alerts + `groupByDay` |
| Incident detail: status, node, cause, 24h uptime, event timeline (incl. "push sent"), Open | Task 8 `IncidentDetail` |
| Intra-tab push/back navigation + hardware-back integration | Task 3 `useNavStack` + MobileApp back wiring; Task 9 dispatcher |
| Light Action v1 = Open ONLY (read-only) | Task 3 `open.js` (window.open, no write) |
| Mute hidden | Not rendered anywhere (Global Constraints + no Mute affordance in any view) |
| Notification-settings screen out of scope (Phase 5) | Task 8 inert/disabled gear; confirmed against lines 39/787 |
| Design language: `global.css` tokens, glass, status dots, safe areas, one-hand | All CSS uses `var(--*)` tokens + `env(safe-area-inset-*)`; bottom tab bar + bottom-reachable chips/search/back |

**Placeholder scan:** Every code step contains complete, runnable code — no `// TODO`, no `...`, no stubbed function bodies. The only intentionally-inert UI is the Alerts gear (Phase 5 boundary, explicitly disabled). The IncidentDetail "Push sent" timeline row is a *labeled* placeholder row (Phase-5 push data), not an empty stub — it renders a real, honest "Pending — Phase 5" line.

**Type/data-shape consistency across tasks:** All tasks consume the SAME fixed shapes (services `{nodes:{key:{display_name,metrics(strings),services[]}}}`; `Service.status ∈ up/down/unknown`, `Service.uptime24` 0–1|null, `Service.uid` as React key; `ups.status` 0/1/null; cron `[{node,jobs:[{job,runs:[{status,timestamp,error?}]}]}]`; history keyed `${nodeKey}:${metric}`). `derive.js` is the single shaping layer; every screen imports its helpers rather than re-deriving (DRY). Node metrics are always `parseMetricPct`'d (string→number) before any bar math. Incidents carry a stable `id` (`service:<uid>` / `ups:apcups` / `cron:<node>:<job>`) used identically by Overview, Alerts, and IncidentDetail (a pushed `incident` id resolves back through `deriveIncidents`).

**Resolved spec ambiguities:**
1. **"24h uptime spark" with no per-service series.** `/history` is node-level CPU/MEM/DISK, not per-service uptime; the only per-service 24h datum is the scalar `uptime24` (0–1). Resolution: incidents/detail render the `uptime24` *percentage* (not a fabricated series); node rows/cards may use the real node CPU/MEM history series via the existing `@shared/components/Sparkline.jsx` if desired (kept optional/YAGNI — the bars already convey current level; a sparkline is additive polish, not required for spec coverage). Captured in the ledger.
2. **No server "incident" object.** Incidents and "degraded subsystems" don't exist server-side; they're derived from down services + on-battery UPS + failing cron. Resolution: one pure `deriveIncidents`/`deriveSubsystems` module (Task 1), table-tested for ordering + stability.
3. **`uptime24` vs `.uptime`.** The raw `/services` body uses `uptime24`; desktop `ServiceCard` reads `.uptime` after an upstream rename. Mobile consumes the RAW body, so it uses `uptime24` everywhere. Documented + tested.
4. **Alerts "push history" before any push pipeline exists.** Push history is persisted only in Phase 4/5. Resolution: Phase 3 pins the live-derived active incidents and renders them under a "Today" day-group via the real, separately-unit-tested `groupByDay` helper (ready for the Phase-5 feed). The IncidentDetail timeline shows a labeled "Push sent — Phase 5" placeholder row rather than inventing fake history. No backend write, no fabricated past events.
5. **Notification-settings gear.** Spec lists the gear on the Alerts header but places the settings *screen* + prefs wiring in Phase 5 (lines 39, 787). Resolution: render the gear visible-but-disabled with a "coming soon" accessible label; it routes nowhere and wires no prefs.
6. **Overview node-row tap destination.** Overview node rows push a `node` detail onto the Overview tab's own stack (the dispatcher in Task 9 renders `NodeDetail` in any tab), so the user isn't yanked across tabs — consistent with per-tab stacks.
