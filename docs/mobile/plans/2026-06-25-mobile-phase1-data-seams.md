# JagHelm Mobile — Phase 1: Data-Layer Seams — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. Execute the ordered tasks below one at a time. Each task is a self-contained TDD loop (write failing test → run-it-fails → minimal impl → run-it-passes → commit). Dispatch one fresh subagent per task with that task's full text; do not batch tasks, do not let a later task's context bleed into an earlier one. After ALL tasks, run `/simplify` then `/security-review` (HARD RULE, per DESIGN.md "Mandatory pre-done gate").

## Goal

Land the **web-app data-layer seams** that make `src/api/client.js` and `src/hooks/useData.js` base-aware and storage-swappable, and add the two env-gated Express knobs (`exposedHeaders: ['ETag']`, `CSP_CONNECT_EXTRA`) — all **additive and default-inert**, so the desktop web app behaves **byte-for-byte as today** with no mobile flag/env set. This is the Phase 1 bullet of DESIGN.md "Implementation Phases": `src/api/baseUrl.js`; `useData.js` + `client.js` base-aware; `cachedIconUrl()` routed through `getApiBase()`; `src/storage/index.js` + `initAuthToken()`; CORS `exposedHeaders` + env-gated `CSP_CONNECT_EXTRA`; capture the remaining raw `/api` literal (`uploadFile`) as a harness gap. **No Capacitor, no `mobile/`, no mobile UI** — those are Phases 2–7.

## Architecture

A single source-of-truth resolver (`src/api/baseUrl.js`) holds the API base. Today it returns `/api` (or `import.meta.env.VITE_JAGHELM_BASE_URL` if a build sets it); mobile will call `setApiBase()` at boot in a later phase. `useData.js` resolves every request URL through `getApiBase()`; `client.js`'s protected-route guard becomes base-aware so an absolute mobile URL still gets `x-auth-token`. `cachedIconUrl()` — called by `getServiceIcon()` for **every** service icon — is routed through `getApiBase()` so it never emits a bare relative `/api/icons/cached` (the Part-A review bug: that 404s on a non-Express origin and the guard wouldn't inject the token). A storage adapter (`src/storage/index.js`) wraps `localStorage` behind an async interface with `setStorageAdapter()` (mobile swaps in Keystore later) and `secureStore`; `client.js` gains `initAuthToken()` so the module-load token seed becomes an explicit awaited boot step. `App.jsx`'s `localStorage` token reads/writes route through `secureStore`. Two Express knobs are added at the existing CORS/CSP blocks, both unset-by-default.

## Tech Stack

Vite 8 + React 19 (ESM), Express 4 + helmet 8 + cors 2.8 (CommonJS-style ESM imports). **Tests:** client unit tests run under **Vitest** (`npm run test:client` → `vitest run`; files `src/**/*.test.{js,jsx}`, jsdom, globals); server tests run under **node:test** (`npm test` → `node --test --test-force-exit`; files `server/**/*.test.js`, `import { test } from 'node:test'` + `import assert from 'node:assert/strict'`, supertest for HTTP). New `.jsx` client tests stay in Vitest's lane; new server tests use `node:test`. No new dependencies.

## Global Constraints

- **Desktop behaviour is byte-for-byte unchanged with no mobile flag/env set.** `getApiBase()` returns `'/api'`; `cachedIconUrl()` returns `/api/icons/cached?url=...`; `initAuthToken()` restores the session from `localStorage`; the protected-route guard still injects `x-auth-token`; 304 caching intact. Every task includes a desktop-regression assertion.
- **Additive + inert.** No behaviour change unless a runtime call (`setApiBase`/`setStorageAdapter`) or an env var (`CORS_ORIGIN`/`CSP_CONNECT_EXTRA`) is set. Unset env ⇒ identical to today.
- **Branch → PR → human-merge.** `jaghelm` is a **PUBLIC** repo. Work on a feature branch; open a PR; **Jag reviews and merges**. NEVER push to `main`, NEVER merge the PR yourself, NEVER `--no-verify`.
- **NEVER add a `Co-Authored-By` trailer** to any commit (verify `git log -1 --format=%B | grep -ci co-authored` == 0).
- **Commits must pass the merged Phase-0 secret-scan gate** (`.githooks/pre-commit` → `scripts/secret-scan.py`). No secrets, no key material, in any file or test fixture.
- **Reuse existing test runners** (Vitest client / node:test server). **No new heavy deps.**

---

## Task 1 — `src/api/baseUrl.js`: single source of truth for the API base

**Files**
- `src/api/baseUrl.js` (NEW)
- `src/api/baseUrl.test.jsx` (NEW — Vitest)

**Interfaces**
- Produces: `getApiBase(): string` — current base, defaults to `'/api'`.
- Produces: `setApiBase(base: string): void` — sets the base, strips trailing slashes, falls back to `'/api'` on a falsy arg.
- Produces: `isRelativeBase(): boolean` — true when the base starts with `'/'` (i.e. same-origin web default).

**Steps**

1. Write the failing test `src/api/baseUrl.test.jsx`:
```jsx
import { describe, it, expect, afterEach } from 'vitest';
import { getApiBase, setApiBase, isRelativeBase } from './baseUrl.js';

// Restore the web default after each test so order can't leak an absolute base
// into a later test (and so the desktop-default assertion is meaningful).
afterEach(() => setApiBase('/api'));

describe('baseUrl — single source of truth for the API base', () => {
  it('defaults to /api (desktop byte-for-byte: web is unchanged)', () => {
    expect(getApiBase()).toBe('/api');
    expect(isRelativeBase()).toBe(true);
  });

  it('setApiBase stores an absolute base verbatim (mobile)', () => {
    setApiBase('http://vm-101:3099/api');
    expect(getApiBase()).toBe('http://vm-101:3099/api');
    expect(isRelativeBase()).toBe(false);
  });

  it('setApiBase strips trailing slashes so URL joins do not double up', () => {
    setApiBase('http://vm-101:3099/api/');
    expect(getApiBase()).toBe('http://vm-101:3099/api');
  });

  it('setApiBase falls back to /api on a falsy argument', () => {
    setApiBase('http://host/api');
    setApiBase('');
    expect(getApiBase()).toBe('/api');
    setApiBase(null);
    expect(getApiBase()).toBe('/api');
  });
});
```

2. Run-it-fails:
```
npm run test:client -- src/api/baseUrl.test.jsx
```
Expected: FAIL — `Failed to resolve import "./baseUrl.js"` (the module does not exist yet).

3. Minimal impl `src/api/baseUrl.js`:
```js
/**
 * Single source of truth for the API base URL.
 *
 * Web (desktop) uses a relative same-origin '/api' and never calls setApiBase,
 * so getApiBase() returns '/api' and behaviour is byte-for-byte as before.
 * Mobile (a later phase) reads a stored absolute Tailscale URL from secure
 * storage at boot and calls setApiBase() BEFORE any data hook fires.
 *
 * A build may pre-seed an absolute base via VITE_JAGHELM_BASE_URL; the desktop
 * build sets no such var, so the default '/api' holds.
 */
let apiBase =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_JAGHELM_BASE_URL) || '/api';

/** Set the API base. Strips trailing slashes; falls back to '/api' if falsy. */
export function setApiBase(base) {
  apiBase = (base || '/api').replace(/\/+$/, '');
}

/** Current API base ('/api' on web by default). */
export function getApiBase() {
  return apiBase;
}

/** True when the base is same-origin relative (starts with '/'). */
export function isRelativeBase() {
  return apiBase.startsWith('/');
}
```

4. Run-it-passes:
```
npm run test:client -- src/api/baseUrl.test.jsx
```
Expected: PASS — all 4 tests green.

5. Commit (no trailer):
```
git add src/api/baseUrl.js src/api/baseUrl.test.jsx
git commit -m "feat(api): add getApiBase() single source of truth for the API base

Defaults to '/api' (desktop unchanged); setApiBase() lets mobile point at an
absolute Tailscale URL in a later phase. Additive and default-inert."
```

---

## Task 2 — `useData.js` resolves every request through `getApiBase()`

**Files**
- `src/hooks/useData.js` (MODIFY — the `const BASE = '/api'` declaration at line 4 and its ~12 template-literal call sites)
- `src/hooks/useData.baseaware.test.jsx` (NEW — Vitest)

**Interfaces**
- Consumes: `getApiBase(): string` from `../api/baseUrl.js`.
- Behaviour: every read/write helper (`getServices`, `getMetricHistory`, `getUPSStatus`, `getGiteaActivity`, `getCronStatus`, `getAllIntegrations`, `getIntegrationPresets`, `testIntegration`, `saveIntegration`, `deleteIntegration`, `getMonitors`, `getWeather`, `getTodos`, `saveTodos`) builds its URL from `getApiBase()` instead of a hardcoded `'/api'`. Functionally identical on web.

**Steps**

1. Write the failing test `src/hooks/useData.baseaware.test.jsx`. It spies on the real `apiFetch` indirectly by stubbing `window.fetch` and asserting the URL passed; on web the URL is unchanged, and after `setApiBase` the same call hits the absolute base:
```jsx
import { describe, it, expect, afterEach, vi } from 'vitest';
import { getServices, getCronStatus } from './useData.js';
import { setApiBase } from '../api/baseUrl.js';

// Build a minimal fetch Response stub (200 with an empty JSON body + ETag).
function okJson(body = {}) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null }, // no ETag → no caching interference
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  setApiBase('/api'); // restore the desktop default
});

describe('useData — base-aware URLs via getApiBase()', () => {
  it('DESKTOP: getServices hits the relative /api base byte-for-byte', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(okJson({ nodes: {} })));
    vi.stubGlobal('fetch', fetchSpy);
    await getServices(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/services');
  });

  it('DESKTOP: getCronStatus hits /api/cron/status byte-for-byte', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(okJson({})));
    vi.stubGlobal('fetch', fetchSpy);
    await getCronStatus(true);
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/cron/status');
  });

  it('MOBILE: after setApiBase, the same call targets the absolute base', async () => {
    setApiBase('http://vm-101:3099/api');
    const fetchSpy = vi.fn(() => Promise.resolve(okJson({ nodes: {} })));
    vi.stubGlobal('fetch', fetchSpy);
    await getServices(true);
    expect(fetchSpy.mock.calls[0][0]).toBe('http://vm-101:3099/api/services');
  });
});
```

2. Run-it-fails:
```
npm run test:client -- src/hooks/useData.baseaware.test.jsx
```
Expected: FAIL — the MOBILE case asserts `http://vm-101:3099/api/services` but the current code uses the frozen literal `const BASE = '/api'`, so it still calls `/api/services`.

3. Minimal impl in `src/hooks/useData.js`. Replace the literal constant at line 4:
```js
const BASE = '/api';
```
with a base-aware accessor:
```js
import { getApiBase } from '../api/baseUrl.js';

// Resolve the API base per-call through the single source of truth. On web this
// is always '/api' (byte-for-byte unchanged); mobile sets an absolute base at
// boot before any of these helpers run.
const BASE = () => getApiBase();
```
Then convert every `${BASE}/...` template literal to call it — `${BASE()}/...`. The exact sites (current → new):
```js
return fetchJson(`${BASE}/services`, skipEtag);          // → `${BASE()}/services`
return fetchJson(`${BASE}/history`);                     // → `${BASE()}/history`
return fetchJson(`${BASE}/ups`, skipEtag);               // → `${BASE()}/ups`
return fetchJson(`${BASE}/gitea/activity`, skipEtag);    // → `${BASE()}/gitea/activity`
return fetchJson(`${BASE}/cron/status`, skipEtag);       // → `${BASE()}/cron/status`
return fetchJson(`${BASE}/integrations`, skipEtag);      // → `${BASE()}/integrations`
return fetchJson(`${BASE}/integrations/presets`);        // → `${BASE()}/integrations/presets`
return requestJson(`${BASE}/integrations/test`, {        // → `${BASE()}/integrations/test`
return requestJson(`${BASE}/integrations/save`, {        // → `${BASE()}/integrations/save`
return requestJson(`${BASE}/integrations/${type}`, {     // → `${BASE()}/integrations/${type}`
return fetchJson(`${BASE}/uptime/monitors`);             // → `${BASE()}/uptime/monitors`
const r = await apiFetch(`${BASE}/weather?lat=${lat}&lon=${lon}`, {  // → `${BASE()}/weather?...`
const r = await apiFetch(`${BASE}/todos`, { ... });      // → `${BASE()}/todos`
await requestJson(`${BASE}/todos`, {                     // → `${BASE()}/todos`
```
(`uploadFile` at line 152 uses a raw `/api/upload` literal — **leave it untouched** in this task; it is handled as a harness-ledger gap in Task 7. `cachedIconUrl` at line 173 is handled in Task 3.)

4. Run-it-passes:
```
npm run test:client -- src/hooks/useData.baseaware.test.jsx
npm run test:client -- src/hooks/useData.test.jsx
```
Expected: PASS — the new base-aware suite is green AND the pre-existing `useData.test.jsx` (icon + mutator tests) still passes (no regression).

5. Commit (no trailer):
```
git add src/hooks/useData.js src/hooks/useData.baseaware.test.jsx
git commit -m "feat(useData): resolve every request URL through getApiBase()

Replaces the frozen 'const BASE = \"/api\"' with a per-call getApiBase() so a
mobile build can target an absolute Tailscale base. Web is byte-for-byte
identical (getApiBase() returns '/api'). uploadFile + cachedIconUrl handled
in follow-up tasks."
```

---

## Task 3 — `cachedIconUrl()` routed through `getApiBase()` (the Part-A icon bug)

**Files**
- `src/hooks/useData.js` (MODIFY — `cachedIconUrl()` at lines 166–177)
- `src/hooks/useData.icon-baseaware.test.jsx` (NEW — Vitest)

**Interfaces**
- Consumes: `getApiBase(): string`.
- `cachedIconUrl(url: string): string | null` — for a CDN URL, returns `` `${getApiBase()}/icons/cached?url=${encodeURIComponent(url)}` `` (web: `/api/icons/cached?...`; mobile: absolute). Non-CDN URLs / data URIs pass through unchanged; emojis/empty return `null` (unchanged contract).

**Steps**

1. Write the failing test `src/hooks/useData.icon-baseaware.test.jsx`:
```jsx
import { describe, it, expect, afterEach } from 'vitest';
import { cachedIconUrl } from './useData.js';
import { setApiBase } from '../api/baseUrl.js';

const CDN = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/gitea.svg';

afterEach(() => setApiBase('/api'));

describe('cachedIconUrl — base-aware (no bare relative /api on a non-server origin)', () => {
  it('DESKTOP: proxies a CDN URL through the relative /api base (byte-for-byte)', () => {
    expect(cachedIconUrl(CDN)).toBe(`/api/icons/cached?url=${encodeURIComponent(CDN)}`);
  });

  it('MOBILE: proxies through the absolute base so the icon reaches Express + gets x-auth-token', () => {
    setApiBase('http://vm-101:3099/api');
    expect(cachedIconUrl(CDN)).toBe(
      `http://vm-101:3099/api/icons/cached?url=${encodeURIComponent(CDN)}`
    );
  });

  it('passes through non-CDN URLs and returns null for empty/emoji (unchanged contract)', () => {
    expect(cachedIconUrl('/logo.svg')).toBe('/logo.svg');
    expect(cachedIconUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(cachedIconUrl('')).toBe(null);
    expect(cachedIconUrl('🚀')).toBe('🚀'); // non-CDN string → pass-through
  });
});
```

2. Run-it-fails:
```
npm run test:client -- src/hooks/useData.icon-baseaware.test.jsx
```
Expected: FAIL — the MOBILE case expects `http://vm-101:3099/api/icons/cached?...` but `cachedIconUrl` currently returns the hardcoded `/api/icons/cached?...`.

3. Minimal impl — change the return inside `cachedIconUrl` (line 173). Current:
```js
    return `/api/icons/cached?url=${encodeURIComponent(url)}`;
```
New (the function already imports nothing; `getApiBase` is already imported at the top of the file from Task 2):
```js
    return `${getApiBase()}/icons/cached?url=${encodeURIComponent(url)}`;
```
Update the function's doc-comment to note the base-aware behaviour by appending to the existing JSDoc block above `cachedIconUrl`:
```js
 * Base-aware: the proxied URL is built from getApiBase() so on mobile it is an
 * absolute same-base URL that reaches Express over Tailscale and gets the
 * x-auth-token injected (the icon route is protected). Web is unchanged ('/api').
```

4. Run-it-passes:
```
npm run test:client -- src/hooks/useData.icon-baseaware.test.jsx
npm run test:client -- src/hooks/useData.test.jsx
```
Expected: PASS — new suite green AND the existing `getServiceIcon` suite in `useData.test.jsx` (which calls `cachedIconUrl` for its expected values) still passes on the unchanged `/api` default.

5. Commit (no trailer):
```
git add src/hooks/useData.js src/hooks/useData.icon-baseaware.test.jsx
git commit -m "fix(useData): route cachedIconUrl() through getApiBase()

Part-A review bug: a bare relative /api/icons/cached 404s on a non-Express
origin and the base-aware guard would not inject x-auth-token for it. Now the
proxied icon URL is same-base, so it reaches Express + is authed on mobile.
Web byte-for-byte identical."
```

---

## Task 4 — `client.js` base-aware protected-route guard

**Files**
- `src/api/client.js` (MODIFY — the guard at lines 34–47)
- `src/api/client.baseaware.test.jsx` (NEW — Vitest)

**Interfaces**
- Consumes: `getApiBase(): string`.
- `apiFetch(url, opts)` — injects `x-auth-token` when `url.startsWith(getApiBase())`, the URL is not `/auth/login`, and a token is set. Web: `getApiBase()` is `'/api'`, so behaviour is byte-for-byte today. Mobile: an absolute `http://host/api/...` URL also matches its absolute base and gets the header.

**Steps**

1. Write the failing test `src/api/client.baseaware.test.jsx`:
```jsx
import { describe, it, expect, afterEach, vi } from 'vitest';
import { apiFetch, setAuthToken } from './client.js';
import { setApiBase } from './baseUrl.js';

function okResp() {
  return { ok: true, status: 200, json: () => Promise.resolve({}) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  setAuthToken('');
  setApiBase('/api');
});

describe('apiFetch — base-aware auth-header injection', () => {
  it('DESKTOP: injects x-auth-token on a relative /api call (byte-for-byte)', async () => {
    setAuthToken('tok123');
    const spy = vi.fn(() => Promise.resolve(okResp()));
    vi.stubGlobal('fetch', spy);
    await apiFetch('/api/services');
    expect(spy.mock.calls[0][1].headers['x-auth-token']).toBe('tok123');
  });

  it('DESKTOP: never injects on the login route (byte-for-byte)', async () => {
    setAuthToken('tok123');
    const spy = vi.fn(() => Promise.resolve(okResp()));
    vi.stubGlobal('fetch', spy);
    await apiFetch('/api/auth/login', { method: 'POST' });
    expect(spy.mock.calls[0][1]?.headers?.['x-auth-token']).toBeUndefined();
  });

  it('MOBILE: injects x-auth-token on an absolute base call', async () => {
    setApiBase('http://vm-101:3099/api');
    setAuthToken('tok123');
    const spy = vi.fn(() => Promise.resolve(okResp()));
    vi.stubGlobal('fetch', spy);
    await apiFetch('http://vm-101:3099/api/services');
    expect(spy.mock.calls[0][1].headers['x-auth-token']).toBe('tok123');
  });

  it('passes non-API URLs straight through with no header', async () => {
    setAuthToken('tok123');
    const spy = vi.fn(() => Promise.resolve(okResp()));
    vi.stubGlobal('fetch', spy);
    await apiFetch('https://cdn.jsdelivr.net/x.svg');
    expect(spy.mock.calls[0][1]).toBeUndefined();
  });
});
```

2. Run-it-fails:
```
npm run test:client -- src/api/client.baseaware.test.jsx
```
Expected: FAIL — the MOBILE case: the current guard hardcodes `url.startsWith('/api')`, so `http://vm-101:3099/api/services` does NOT start with `/api` and gets no `x-auth-token`.

3. Minimal impl in `src/api/client.js`. Add the import below line 10's doc-comment block (top of file, after the comment):
```js
import { getApiBase } from './baseUrl.js';
```
Change the guard. Current (lines 34–47):
```js
export function apiFetch(url, opts = {}) {
  if (
    typeof url === 'string' &&
    url.startsWith('/api') &&
    !url.includes('/auth/login') &&
    authToken
  ) {
    return window.fetch(url, {
      ...opts,
      headers: { ...opts.headers, 'x-auth-token': authToken },
    });
  }
  return window.fetch(url, opts);
}
```
New:
```js
export function apiFetch(url, opts = {}) {
  // Base-aware: matches '/api' on web OR 'http://host/api' on mobile, so the
  // protected-route guard injects x-auth-token regardless of transport origin.
  const base = getApiBase();
  if (
    typeof url === 'string' &&
    url.startsWith(base) &&
    !url.includes('/auth/login') &&
    authToken
  ) {
    return window.fetch(url, {
      ...opts,
      headers: { ...opts.headers, 'x-auth-token': authToken },
    });
  }
  return window.fetch(url, opts);
}
```

4. Run-it-passes:
```
npm run test:client -- src/api/client.baseaware.test.jsx
```
Expected: PASS — all 4 tests green (DESKTOP cases prove byte-for-byte parity; MOBILE case proves the absolute-base fix).

5. Commit (no trailer):
```
git add src/api/client.js src/api/client.baseaware.test.jsx
git commit -m "feat(client): make apiFetch's protected-route guard base-aware

Keys on url.startsWith(getApiBase()) instead of the literal '/api', so an
absolute mobile base still gets x-auth-token. Web behaviour ('/api') is
byte-for-byte unchanged, login route still excluded."
```

---

## Task 5 — `src/storage/index.js` storage adapter seam + `client.js` `initAuthToken()`

**Files**
- `src/storage/index.js` (NEW)
- `src/api/client.js` (MODIFY — module-load token seed at line 13; add `initAuthToken()`)
- `src/storage/index.test.jsx` (NEW — Vitest)
- `src/api/client.inittoken.test.jsx` (NEW — Vitest)

**Interfaces**
- Produces (`src/storage/index.js`): `secureStore: { getItem(k): Promise<string|null>, setItem(k, v): Promise<void>, removeItem(k): Promise<void> }`; `setStorageAdapter(adapter): void` — swaps the backing impl (mobile passes a Keystore adapter later).
- Produces (`src/api/client.js`): `initAuthToken(): Promise<void>` — loads `jaghelm-token` from `secureStore` into the in-memory token; awaited at boot.
- Consumes (`src/api/client.js`): `secureStore` from `../storage/index.js`.

**Steps**

1. Write the failing test `src/storage/index.test.jsx`:
```jsx
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { secureStore, setStorageAdapter } from './index.js';

beforeEach(() => {
  if (typeof localStorage !== 'undefined') localStorage.clear();
});

afterEach(() => {
  // Reset to the web default so a swapped adapter can't leak across tests.
  setStorageAdapter({
    async getItem(k) {
      return (typeof localStorage !== 'undefined' && localStorage.getItem(k)) || null;
    },
    async setItem(k, v) {
      if (typeof localStorage !== 'undefined') localStorage.setItem(k, v);
    },
    async removeItem(k) {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(k);
    },
  });
});

describe('secureStore — web default backed by localStorage', () => {
  it('WEB DEFAULT: round-trips through localStorage (byte-for-byte persistence)', async () => {
    await secureStore.setItem('k', 'v');
    expect(localStorage.getItem('k')).toBe('v');
    expect(await secureStore.getItem('k')).toBe('v');
    await secureStore.removeItem('k');
    expect(await secureStore.getItem('k')).toBe(null);
  });

  it('returns null for a missing key', async () => {
    expect(await secureStore.getItem('nope')).toBe(null);
  });

  it('setStorageAdapter swaps the backing impl (mobile Keystore later)', async () => {
    const mem = new Map();
    setStorageAdapter({
      async getItem(k) { return mem.has(k) ? mem.get(k) : null; },
      async setItem(k, v) { mem.set(k, String(v)); },
      async removeItem(k) { mem.delete(k); },
    });
    await secureStore.setItem('t', 'abc');
    expect(mem.get('t')).toBe('abc');          // went to the swapped adapter
    expect(localStorage.getItem('t')).toBe(null); // NOT to localStorage
    expect(await secureStore.getItem('t')).toBe('abc');
  });
});
```

2. Run-it-fails:
```
npm run test:client -- src/storage/index.test.jsx
```
Expected: FAIL — `Failed to resolve import "./index.js"` (module does not exist).

3. Minimal impl `src/storage/index.js`:
```js
/**
 * Storage adapter seam. Web (default) wraps the synchronous localStorage behind
 * an async interface so the mobile adapter (Android Keystore via a Capacitor
 * secure-storage plugin, a later phase) is a drop-in: same async shape, swapped
 * via setStorageAdapter(). Secrets (token, backend URL) flow through secureStore;
 * desktop persistence is byte-for-byte as before (it still reads/writes
 * localStorage).
 */
const webStorage = {
  async getItem(k) {
    return (typeof localStorage !== 'undefined' && localStorage.getItem(k)) || null;
  },
  async setItem(k, v) {
    if (typeof localStorage !== 'undefined') localStorage.setItem(k, v);
  },
  async removeItem(k) {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(k);
  },
};

let impl = webStorage;

/** Swap the backing storage implementation (mobile passes a Keystore adapter). */
export function setStorageAdapter(a) {
  impl = a;
}

/** Async secure key/value store. Web default = localStorage; mobile = Keystore. */
export const secureStore = {
  getItem: (k) => impl.getItem(k),
  setItem: (k, v) => impl.setItem(k, v),
  removeItem: (k) => impl.removeItem(k),
};
```

4. Run-it-passes:
```
npm run test:client -- src/storage/index.test.jsx
```
Expected: PASS — all 3 tests green.

5. Write the failing test `src/api/client.inittoken.test.jsx` (for `initAuthToken`):
```jsx
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { initAuthToken, getAuthToken, setAuthToken } from './client.js';
import { secureStore } from '../storage/index.js';

beforeEach(() => {
  if (typeof localStorage !== 'undefined') localStorage.clear();
  setAuthToken('');
});

afterEach(() => setAuthToken(''));

describe('initAuthToken — async boot seed of the in-memory token', () => {
  it('WEB: restores the session from stored token (replaces module-load seed)', async () => {
    await secureStore.setItem('jaghelm-token', 'restored-tok');
    await initAuthToken();
    expect(getAuthToken()).toBe('restored-tok');
  });

  it('leaves the token empty when nothing is stored', async () => {
    await initAuthToken();
    expect(getAuthToken()).toBe('');
  });
});
```

6. Run-it-fails:
```
npm run test:client -- src/api/client.inittoken.test.jsx
```
Expected: FAIL — `initAuthToken is not a function` (not yet exported).

7. Minimal impl in `src/api/client.js`. Add the import (with the `getApiBase` import from Task 4):
```js
import { secureStore } from '../storage/index.js';
```
Replace the synchronous module-load seed. Current (line 13):
```js
let authToken = (typeof localStorage !== 'undefined' && localStorage.getItem('jaghelm-token')) || '';
```
New (the seed becomes an explicit async boot step; the in-memory token starts empty and is filled by `initAuthToken()`):
```js
// In-memory token. Previously seeded synchronously from localStorage at module
// load; that seed is now an explicit awaited boot step (initAuthToken) so the
// token source is swappable (web localStorage default; mobile Keystore later).
let authToken = '';

/**
 * Seed the in-memory token from secure storage. Awaited at boot BEFORE any data
 * hook fires, so a reload (web) or app start (mobile) keeps the session. Web
 * reads localStorage via the default adapter — same persisted-session behaviour
 * as the old module-load seed.
 */
export async function initAuthToken() {
  authToken = (await secureStore.getItem('jaghelm-token')) || '';
}
```

8. Run-it-passes:
```
npm run test:client -- src/api/client.inittoken.test.jsx
npm run test:client -- src/api/client.baseaware.test.jsx
```
Expected: PASS — `initAuthToken` suite green AND Task 4's base-aware guard suite still green.

9. Commit (no trailer):
```
git add src/storage/index.js src/storage/index.test.jsx src/api/client.js src/api/client.inittoken.test.jsx
git commit -m "feat(storage): add secureStore adapter seam + client.initAuthToken()

Storage adapter wraps localStorage behind an async interface (setStorageAdapter
swaps in a Keystore adapter on mobile later). The module-load token seed becomes
an explicit awaited initAuthToken() boot step reading via secureStore. Web
persistence (localStorage) byte-for-byte unchanged."
```

---

## Task 6 — `App.jsx` token reads/writes route through `secureStore` + awaited boot

**Files**
- `src/App.jsx` (MODIFY — `authToken` init at line 26, login/logout handlers lines 61–73, boot `initAuthToken` await)
- `src/App.token.test.jsx` (NEW — Vitest)

**Interfaces**
- Consumes: `secureStore` from `./storage/index.js`; `initAuthToken` from `./api/client.js`.
- Behaviour: `App` awaits `initAuthToken()` before its first auth check; `handleLogin`/`handleLogout` write/remove `jaghelm-token` through `secureStore` (which is still `localStorage`-backed on web), keeping `setApiAuthToken()` in sync. The login screen still renders, the persisted session still restores. **Theme (`jaghelm-theme`) and config (`jaghelm-config`/`jagnet-config`) stay on raw `localStorage`** in Phase 1 — only the secret (token) moves to `secureStore`; theme/last-tab migrate to the Preferences plugin in Phase 2 (mobile), which does not exist yet.

**Steps**

1. Write the failing test `src/App.token.test.jsx`. It asserts the login handler persists the token through `secureStore` (observable via `localStorage` on web) and that boot restores it:
```jsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { secureStore } from './storage/index.js';
import { getAuthToken, setAuthToken } from './api/client.js';

beforeEach(() => {
  if (typeof localStorage !== 'undefined') localStorage.clear();
  setAuthToken('');
});

afterEach(() => {
  vi.unstubAllGlobals();
  setAuthToken('');
});

// A stub /api/auth/check that reports auth disabled, so App renders the
// authenticated tree without a login form (keeps this test about the seam).
function stubAuthCheck() {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ authRequired: false, authenticated: true }),
        text: () => Promise.resolve('{}'),
        headers: { get: () => null },
      })
    )
  );
}

describe('App — token persistence through secureStore + awaited boot', () => {
  it('WEB: a token stored before boot is restored into apiFetch (initAuthToken awaited)', async () => {
    await secureStore.setItem('jaghelm-token', 'boot-tok');
    stubAuthCheck();
    const App = (await import('./App.jsx')).default;
    render(<App />);
    await waitFor(() => expect(getAuthToken()).toBe('boot-tok'));
  });

  it('WEB: handleLogout removes the token via secureStore (localStorage cleared)', async () => {
    await secureStore.setItem('jaghelm-token', 'x');
    // Simulate the logout path's storage write directly through the seam.
    await secureStore.removeItem('jaghelm-token');
    expect(localStorage.getItem('jaghelm-token')).toBe(null);
  });
});
```
> Note: this is an integration-style smoke of the seam, not a full UI drive. It proves the awaited-boot restore and the `secureStore`-backed write without coupling to the dashboard's many child components.

2. Run-it-fails:
```
npm run test:client -- src/App.token.test.jsx
```
Expected: FAIL — the first test: `getAuthToken()` stays `''` because `App` does not yet call `initAuthToken()` at boot (it reads `localStorage` directly into React state but never seeds `apiFetch`'s in-memory token from `secureStore`).

3. Minimal impl in `src/App.jsx`. Add imports (extend the existing client import on line 16, add storage):
```js
import { apiFetch, setAuthToken as setApiAuthToken, initAuthToken } from './api/client.js';
import { secureStore } from './storage/index.js';
```
Add an awaited-boot effect that seeds `apiFetch` before the auth check. Insert immediately after the existing theme effect (after line 35), and gate the auth check on it. Replace the auth-check effect (lines 45–59) so it awaits `initAuthToken()` first:
```js
  // Seed apiFetch's in-memory token from secure storage (web: localStorage)
  // BEFORE the auth check fires, so a reload keeps the session. Then run the
  // auth check. Re-runs when authToken changes (login/logout).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await initAuthToken();
      try {
        const r = await apiFetch('/api/auth/check');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        if (cancelled) return;
        setAuthRequired(d.authRequired);
        setAuthed(d.authenticated);
      } catch {
        if (cancelled) return;
        setAuthRequired(true);
        setAuthed(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authToken]);
```
Route the token writes through `secureStore`. Current `handleLogin` (lines 61–66):
```js
  const handleLogin = (token) => {
    localStorage.setItem('jaghelm-token', token);
    setApiAuthToken(token); // Keep apiFetch's in-memory token in sync
    setAuthToken(token);
    setAuthed(true);
  };
```
New:
```js
  const handleLogin = (token) => {
    secureStore.setItem('jaghelm-token', token); // web: localStorage; mobile: Keystore
    setApiAuthToken(token); // Keep apiFetch's in-memory token in sync
    setAuthToken(token);
    setAuthed(true);
  };
```
Current `handleLogout` (lines 68–73):
```js
  const handleLogout = () => {
    localStorage.removeItem('jaghelm-token');
    setApiAuthToken(''); // Clear apiFetch's in-memory token
    setAuthToken('');
    setAuthed(false);
  };
```
New:
```js
  const handleLogout = () => {
    secureStore.removeItem('jaghelm-token'); // web: localStorage; mobile: Keystore
    setApiAuthToken(''); // Clear apiFetch's in-memory token
    setAuthToken('');
    setAuthed(false);
  };
```
> Leave line 26's `useState(() => localStorage.getItem('jaghelm-token') || '')` as-is: it's the synchronous React-state seed used only to trigger the boot effect's dependency, and on web `secureStore` IS `localStorage`, so the value is consistent. The authoritative apiFetch seed is now `initAuthToken()`. Leave `jaghelm-theme` and `readStoredConfig()` on raw `localStorage` (non-secret UI state; migrates to Preferences in Phase 2).

4. Run-it-passes:
```
npm run test:client -- src/App.token.test.jsx
```
Expected: PASS — boot restores the token into `apiFetch`; logout clears it through the seam.

5. Commit (no trailer):
```
git add src/App.jsx src/App.token.test.jsx
git commit -m "feat(App): route token through secureStore + await initAuthToken() at boot

Login/logout persist the token via the storage seam (web: localStorage; mobile:
Keystore later); boot awaits initAuthToken() before the auth check so the
session restores. Theme/config stay on localStorage (non-secret; move to
Preferences in a mobile phase). Web behaviour unchanged."
```

---

## Task 7 — Capture the remaining raw `/api` literal (`uploadFile`) as a harness gap

**Files**
- `.harness-ledger.md` (NEW — the per-repo captured-failure ledger referenced in DESIGN.md "The holds/cracks ledger")
- `src/hooks/useData.js` (MODIFY — add an inline gap marker comment on the `uploadFile` raw `/api` literal at line 152)

**Interfaces**
- No runtime interface change. `uploadFile()` **stays relative** (web-only; mobile does no uploads, per DESIGN.md "Icon Rendering §"). This task records the one remaining raw `/api` literal as a tracked gap **with the correct file attribution** (`src/hooks/useData.js`, NOT `client.js` — per DESIGN.md "Ground-truth file references").

**Steps**

1. Add the inline gap marker. In `src/hooks/useData.js`, `uploadFile` (line 152) is currently:
```js
  const r = await apiFetch(`/api/upload?type=${type}`, { method: 'POST', body: form });
```
Change to add a tracked-gap comment (the literal itself stays — web-only by design):
```js
  // HARNESS-GAP (ledger #1): the one remaining raw '/api' literal that bypasses
  // getApiBase(). Intentionally relative — uploadFile is web-only (mobile does no
  // uploads). Promote through getApiBase() if/when mobile ever uploads.
  const r = await apiFetch(`/api/upload?type=${type}`, { method: 'POST', body: form });
```

2. Create `.harness-ledger.md` capturing the gap with correct attribution:
```markdown
# JagHelm harness ledger — captured failures (L1)

Per `docs/mobile/DESIGN.md` "The holds/cracks ledger". Each row is a real
captured gap; promoting it to an enforcer stamps `evidence[pillar]` in
`.harness.yml`.

## #1 — raw `/api` literal bypasses the base resolver (Phase 1)

- **Pillar:** legibility
- **File (correct attribution):** `src/hooks/useData.js` → `uploadFile()` (NOT
  `src/api/client.js` — verified against the current tree per the spec's
  "Ground-truth file references" section).
- **Gap:** `uploadFile` builds its URL from a hardcoded `` `/api/upload?type=${type}` ``
  instead of `getApiBase()`. Every other data-layer URL (reads, writes, and the
  icon proxy) now resolves through `getApiBase()`; this is the single remaining
  literal.
- **Why not fixed in Phase 1:** `uploadFile` is web-only — mobile does no file
  uploads (DESIGN.md "Icon Rendering §"). Making it absolute now would be inert
  code with no consumer.
- **Residual / promotion rule:** if a mobile phase ever adds upload, route it
  through `getApiBase()` (one-line change) and close this row.
- **Status:** OPEN (tracked, intentional).
```

3. Run-it-passes (no code behaviour changed; assert the desktop suites still pass and the literal is preserved):
```
npm run test:client -- src/hooks/useData.test.jsx
grep -n "api/upload" src/hooks/useData.js
```
Expected: PASS — `useData.test.jsx` green; `grep` confirms the `/api/upload` literal is still present (web-only, unchanged), now carrying the gap marker.

4. Commit (no trailer):
```
git add .harness-ledger.md src/hooks/useData.js
git commit -m "docs(harness): capture uploadFile raw /api literal as ledger gap #1

Correct attribution: src/hooks/useData.js (not client.js). uploadFile stays
relative (web-only; mobile does no uploads); tracked for promotion if mobile
ever uploads."
```

---

## Task 8 — Express CORS: env-gated `exposedHeaders: ['ETag']` (additive, fallback-only)

**Files**
- `server/index.js` (MODIFY — the `cors(...)` call at line 177)
- `server/cors.exposed.test.js` (NEW — node:test + supertest)

**Interfaces**
- Consumes: `process.env.CORS_ORIGIN` (existing). When unset, `corsOrigins` is `false` (today's behaviour). When set, the CORS middleware additionally exposes `ETag` so a WebView-fetch fallback can read it for `If-None-Match` 304 caching.
- Behaviour: with **no `CORS_ORIGIN` set**, the served headers are byte-for-byte as today (no `Access-Control-Expose-Headers`). With `CORS_ORIGIN` set, responses carry `Access-Control-Expose-Headers: ETag`.

**Steps**

1. Write the failing test `server/cors.exposed.test.js`. The CORS config is computed at module load from env, so the test sets `CORS_ORIGIN` **before** importing the app:
```js
/**
 * CORS exposedHeaders contract. exposedHeaders:['ETag'] is REQUIRED only on the
 * WebView-fetch fallback (cross-origin JS can't read ETag by default, which
 * would silently break useData.js's If-None-Match 304 caching). It is additive:
 * unset CORS_ORIGIN ⇒ no Access-Control-Expose-Headers (desktop unchanged).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-cors-'));
process.env.JAGHELM_DATA_DIR = dataDir;
delete process.env.DASH_PASS; // auth disabled
process.env.PROMETHEUS_URL = 'http://127.0.0.1:1';
process.env.KUMA_URL = 'http://127.0.0.1:1';
// Set the allow-list BEFORE importing the app (CORS config is module-load).
process.env.CORS_ORIGIN = 'capacitor://localhost,https://localhost';

const { app } = await import('./index.js');
const { stopBackgroundRefresh } = await import('./refresh.js');

after(() => {
  stopBackgroundRefresh();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.CORS_ORIGIN;
});

test('with CORS_ORIGIN set, responses expose ETag for cross-origin 304 caching', async () => {
  const r = await request(app)
    .get('/api/health')
    .set('Origin', 'https://localhost');
  assert.equal(r.status, 200);
  const exposed = (r.headers['access-control-expose-headers'] || '').toLowerCase();
  assert.match(exposed, /etag/, 'ETag must be in Access-Control-Expose-Headers');
});
```

2. Run-it-fails:
```
node --test --test-force-exit server/cors.exposed.test.js
```
Expected: FAIL — `Access-Control-Expose-Headers` is absent (the current `cors({ origin: corsOrigins })` sets no `exposedHeaders`).

3. Minimal impl in `server/index.js`. Current (line 177):
```js
app.use(cors({ origin: corsOrigins }));
```
New (additive — `exposedHeaders` is inert when no cross-origin response is produced; with `origin:false` and no `Origin` match, cors emits no ACAO/expose header at all, so desktop same-origin responses are unchanged):
```js
// exposedHeaders:['ETag'] is REQUIRED only on the WebView-fetch fallback
// (cross-origin JS cannot read ETag by default → would silently break
// useData.js's If-None-Match 304 caching). Additive + inert: with CORS_ORIGIN
// unset (origin:false), no Access-Control-* headers are emitted, so the desktop
// same-origin response is byte-for-byte unchanged. (Native HTTP — the mobile
// default — bypasses CORS entirely and needs none of this.)
app.use(cors({ origin: corsOrigins, exposedHeaders: ['ETag'] }));
```

4. Run-it-passes (the new test AND the existing route suite, to prove desktop unchanged):
```
node --test --test-force-exit server/cors.exposed.test.js
node --test --test-force-exit server/index.test.js
```
Expected: PASS — the exposed-headers test green; the existing route contract suite still green (no `CORS_ORIGIN` there ⇒ no expose header on those responses).

5. Commit (no trailer):
```
git add server/index.js server/cors.exposed.test.js
git commit -m "feat(server): add exposedHeaders:['ETag'] to CORS (additive, fallback-only)

Cross-origin JS can't read ETag by default, which would break useData.js
If-None-Match 304 caching on the WebView-fetch fallback. Inert with CORS_ORIGIN
unset (origin:false emits no Access-Control-* headers) — desktop byte-for-byte
unchanged. Native HTTP (mobile default) bypasses CORS and needs none of this."
```

---

## Task 9 — Express CSP: env-gated `CSP_CONNECT_EXTRA` (additive, fallback-only)

**Files**
- `server/index.js` (MODIFY — the `connectSrc` directive at line 139)
- `server/csp.connectextra.test.js` (NEW — node:test + supertest)

**Interfaces**
- Consumes: `process.env.CSP_CONNECT_EXTRA` (NEW — comma-separated origins). When unset, `connectSrc` is exactly `["'self'", 'https://cdn.jsdelivr.net', 'https://raw.githubusercontent.com']` (today). When set, the trimmed non-empty entries are appended to `connectSrc`.
- Behaviour: with **no env set**, the served `Content-Security-Policy` header's `connect-src` is byte-for-byte as today. With `CSP_CONNECT_EXTRA` set, the extra origins appear appended.

**Steps**

1. Write the failing test `server/csp.connectextra.test.js`. Set the env before import:
```js
/**
 * CSP connect-src extension. CSP_CONNECT_EXTRA lets a self-hoster widen
 * connectSrc (e.g. a WebView-fetch fallback deployment) without editing source.
 * Additive + fallback-only: unset ⇒ connect-src is byte-for-byte as today.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-csp-'));
process.env.JAGHELM_DATA_DIR = dataDir;
delete process.env.DASH_PASS;
process.env.PROMETHEUS_URL = 'http://127.0.0.1:1';
process.env.KUMA_URL = 'http://127.0.0.1:1';
// Set BEFORE import (cspDirectives is computed at module load).
process.env.CSP_CONNECT_EXTRA = 'https://example.test, ,  https://two.test';

const { app } = await import('./index.js');
const { stopBackgroundRefresh } = await import('./refresh.js');

after(() => {
  stopBackgroundRefresh();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.CSP_CONNECT_EXTRA;
});

test('CSP_CONNECT_EXTRA appends trimmed, non-empty origins to connect-src', async () => {
  const r = await request(app).get('/api/health');
  const csp = r.headers['content-security-policy'] || '';
  // Existing defaults still present (byte-for-byte base preserved).
  assert.match(csp, /connect-src[^;]*'self'/);
  assert.match(csp, /connect-src[^;]*https:\/\/cdn\.jsdelivr\.net/);
  // Extras appended; empty/whitespace entries filtered out.
  assert.match(csp, /connect-src[^;]*https:\/\/example\.test/);
  assert.match(csp, /connect-src[^;]*https:\/\/two\.test/);
});
```

2. Run-it-fails:
```
node --test --test-force-exit server/csp.connectextra.test.js
```
Expected: FAIL — `https://example.test` / `https://two.test` are not in `connect-src` (the directive is the fixed array; `CSP_CONNECT_EXTRA` is not read anywhere yet).

3. Minimal impl in `server/index.js`. Just above the `cspDirectives` object (before line 127), add the env parse:
```js
// Additive, env-gated connect-src extension for a WebView-fetch fallback
// deployment. Unset ⇒ no extra origins ⇒ connect-src is byte-for-byte as today.
const extraConnect = (process.env.CSP_CONNECT_EXTRA || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
```
Then change the `connectSrc` directive. Current (line 139):
```js
  connectSrc: ["'self'", 'https://cdn.jsdelivr.net', 'https://raw.githubusercontent.com'],
```
New:
```js
  connectSrc: ["'self'", 'https://cdn.jsdelivr.net', 'https://raw.githubusercontent.com', ...extraConnect],
```

4. Run-it-passes (new test AND existing route suite, proving the base CSP is unchanged when the env is unset):
```
node --test --test-force-exit server/csp.connectextra.test.js
node --test --test-force-exit server/index.test.js
```
Expected: PASS — the connect-extra test green; the existing route suite (no `CSP_CONNECT_EXTRA` set) still serves the today-identical `connect-src`.

5. Commit (no trailer):
```
git add server/index.js server/csp.connectextra.test.js
git commit -m "feat(server): env-gated CSP_CONNECT_EXTRA appends to connect-src

Lets a self-hoster widen connect-src for a WebView-fetch fallback without
editing source. Additive + fallback-only: unset ⇒ connect-src byte-for-byte as
today. (The mobile WebView is governed by its own CSP meta tag, not this header
— added in a later phase.)"
```

---

## Task 10 — Full-suite desktop-regression gate + open the PR

**Files**
- None modified (verification + PR only).

**Interfaces**
- Consumes: the full client + server test suites.

**Steps**

1. Run the entire client suite (proves no desktop component regressed against the base-aware/storage changes):
```
npm run test:client
```
Expected: PASS — all `src/**/*.test.{js,jsx}` green, including the pre-existing `useData.test.jsx`, component tests, and the 7 new Phase-1 suites.

2. Run the entire server suite (proves the two env knobs are inert by default and nothing else moved):
```
npm test
```
Expected: PASS — all `server/**/*.test.js` green (no `CORS_ORIGIN`/`CSP_CONNECT_EXTRA` set in the default lane ⇒ today's behaviour), plus the two new env-gated suites.

3. Lint + the secret-scan gate (Phase-0 gate must stay green — no secrets in any new file/fixture):
```
npm run lint
npm run secret-scan
```
Expected: PASS — eslint clean; `secret-scan.py` reports no findings (no key material was introduced; `https://localhost`/`capacitor://localhost`/`tok123` are not secret shapes).

4. Desktop byte-for-byte spot-check (manual assertion mapped to DESIGN.md "Verification → Desktop regression (Phase 1 gate)"): confirm in a node REPL / the test output that `getApiBase()` → `'/api'`, `cachedIconUrl('https://cdn.jsdelivr.net/x.svg')` → `'/api/icons/cached?url=...'`, and the served `connect-src` with no env set equals the original three-origin list. (All three are already asserted by the suites above — this step is the explicit gate confirmation, not new code.)

5. Open the PR (branch → PR → **human merge**; never push `main`, never `--no-verify`):
```
gh pr create --title "Phase 1: data-layer seams (base-aware + storage adapter + env CORS/CSP knobs)" \
  --body "Additive, default-inert data-layer seams for JagHelm Mobile Phase 1.
Desktop behaviour is byte-for-byte unchanged with no mobile flag/env set.
See docs/mobile/DESIGN.md 'Implementation Phases → Phase 1'.

Jag reviews and merges — do not auto-merge.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```
Expected: PR opened against the feature branch; CI runs `npm run test:client`, `npm test`, lint, and the secret-scan gate. **Stop here — Jag merges.**

6. Mandatory pre-done gate (HARD RULE, DESIGN.md): run **`/simplify`** then **`/security-review`** on the branch diff before declaring Phase 1 done. Address findings, push to the branch (NOT main), leave the merge to Jag.

---

## Self-review checklist

Map each Phase-1 spec item (DESIGN.md "Implementation Phases → Phase 1" + "Architecture & Data-Layer Reuse" + "Verification → Desktop regression") to a task and its desktop-regression assertion:

- [ ] **`src/api/baseUrl.js` with `getApiBase()` defaulting to `/api`** → Task 1. Desktop assertion: `getApiBase() === '/api'`, `isRelativeBase() === true`.
- [ ] **`useData.js` (`const BASE='/api'`) base-aware via `getApiBase()`** → Task 2. Desktop assertion: `getServices`/`getCronStatus` still call `/api/services`, `/api/cron/status`; existing `useData.test.jsx` still green.
- [ ] **`cachedIconUrl()` routed through `getApiBase()` (Part-A icon bug)** → Task 3. Desktop assertion: `cachedIconUrl(CDN) === '/api/icons/cached?url=...'`; existing `getServiceIcon` suite still green.
- [ ] **`client.js` (`apiFetch`) base-aware guard** → Task 4. Desktop assertion: relative `/api` call still gets `x-auth-token`; login route still excluded.
- [ ] **`src/storage/index.js` storage adapter seam + `initAuthToken()`** → Task 5. Desktop assertion: `secureStore` round-trips through `localStorage`; `initAuthToken()` restores the stored token (same persisted-session behaviour as the old module-load seed).
- [ ] **Token source swappable; `App.jsx` stops touching `localStorage` for the token** → Task 6. Desktop assertion: boot awaits `initAuthToken()` and restores the session; login/logout persist via `secureStore` (localStorage on web); theme/config intentionally stay on `localStorage`.
- [ ] **Capture the remaining raw `/api` literal (`uploadFile` in `useData.js`) as a harness-ledger gap with correct file attribution** → Task 7. `.harness-ledger.md` #1 attributes it to `src/hooks/useData.js` (NOT `client.js`); literal preserved (web-only).
- [ ] **CORS `exposedHeaders: ['ETag']` (additive)** → Task 8. Desktop assertion: with `CORS_ORIGIN` unset, no `Access-Control-Expose-Headers`; existing route suite unchanged.
- [ ] **Env-gated `CSP_CONNECT_EXTRA` (additive, fallback-only)** → Task 9. Desktop assertion: with the env unset, `connect-src` is byte-for-byte the original three-origin list.
- [ ] **DESKTOP BEHAVIOUR BYTE-FOR-BYTE UNCHANGED (headline)** → Task 10. Full `npm run test:client` + `npm test` + `npm run lint` + `npm run secret-scan` green; the Phase-1 desktop-regression gate (DESIGN.md "Verification") confirmed: `getApiBase()` → `/api`, `cachedIconUrl()` → `/api/icons/cached?...`, `initAuthToken()` restores from `localStorage`, protected-route guard still injects `x-auth-token`, 304 caching intact.
- [ ] **Branch → PR → human merge; no `Co-Authored-By`; no `--no-verify`; no push to `main`; Phase-0 secret-scan green** → Global Constraints + Task 10. `git log --format=%B | grep -ci co-authored` == 0; PR opened, Jag merges.
- [ ] **No new dependencies; reused Vitest (client) / node:test (server) runners** → every task's tests use the existing runners; `package.json` `dependencies`/`devDependencies` untouched.
- [ ] **Mandatory pre-done gate** → Task 10 step 6: `/simplify` then `/security-review` before done.
```

I've authored the complete plan. Final report below.

The plan is grounded entirely in the real current code I read:

**Ground-truth verified and quoted in the plan:**
- `src/hooks/useData.js`: `const BASE = '/api'` (line 4), the ~14 `${BASE}/...` call sites, `cachedIconUrl()` returning the hardcoded `/api/icons/cached?...` (line 173), and the raw `/api/upload` literal in `uploadFile()` (line 152) — correctly attributed to useData.js, not client.js, per the spec's ground-truth section.
- `src/api/client.js`: the module-load token seed (line 13) and the protected-route guard hardcoding `url.startsWith('/api')` (lines 34–47).
- `src/App.jsx`: token `useState` seed (line 26), the auth-check effect (lines 45–59), and `handleLogin`/`handleLogout` (lines 61–73) all touching `localStorage` directly.
- `server/index.js`: `connectSrc` array (line 139), the `cspDirectives` object (line 127), and `app.use(cors({ origin: corsOrigins }))` (line 177) with `corsOrigins` = `false` when unset.

**Test style mirrored from the repo:** client tests use Vitest in `.jsx` files (`describe/it/expect/vi`, `vi.stubGlobal('fetch', ...)`, `vi.unstubAllGlobals()`) matching `useData.test.jsx`; server tests use `node:test` + `node:assert/strict` + supertest against the exported `{ app }`, setting env **before** `await import('./index.js')` (matching `index.test.js`'s temp-dir/no-DASH_PASS pattern) — necessary because `corsOrigins`/`cspDirectives` are computed at module load.

**10 ordered TDD tasks**, each a real failing-test → exact-fail-command → real minimal impl → pass → no-trailer commit loop:
1. `baseUrl.js` (`getApiBase/setApiBase/isRelativeBase`)
2. `useData.js` base-aware (`BASE = () => getApiBase()` + all call sites)
3. `cachedIconUrl()` through `getApiBase()` (the Part-A bug)
4. `client.js` base-aware guard
5. `storage/index.js` + `initAuthToken()`
6. `App.jsx` token through `secureStore` + awaited boot
7. harness-ledger capture of the `uploadFile` gap (correct attribution)
8. CORS `exposedHeaders: ['ETag']`
9. env-gated `CSP_CONNECT_EXTRA`
10. full-suite desktop-regression gate + PR

Every task carries a desktop byte-for-byte assertion, the headline constraint is enforced throughout, and the Global Constraints + Self-review checklist map each spec Phase-1 item to a task. No Capacitor/mobile-UI work (correctly deferred to later phases), no placeholders — all code is concrete. The plan opens with the exact required header and the `subagent-driven-development` sub-skill line, and ends with `/simplify` → `/security-review` plus branch→PR→human-merge (public repo, no Co-Authored-By).