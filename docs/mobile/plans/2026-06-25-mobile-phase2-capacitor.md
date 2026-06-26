# JagHelm Mobile — Phase 2 (Capacitor scaffold + shell) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `jaghelm/mobile/` Capacitor + mobile-first React app — its own Vite build, an `@shared` alias onto the merged data layer, native-HTTP transport by default, a Keystore-backed secure-storage adapter, a bottom-tab shell over the locked IA, a first-run connect screen, and a buildable committed Android project — additive and leaving desktop byte-for-byte unchanged.

**Architecture:** Mobile is a sibling directory with its **own** Vite config (`mobile/vite.config.mobile.js → mobile/dist`, never server-served) that reuses `src/` by source via a single `@shared` resolve alias. Capacitor's native HTTP (`CapacitorHttp: { enabled: true }`) is the default transport (bypasses CORS, reads ETag); the Express CORS/CSP env path is fallback-only. At boot the app wires `setStorageAdapter(keystoreAdapter)` → `await initAuthToken()` → `setApiBase(storedBase)` → render; the auth token lives only in the Android Keystore (`capacitor-secure-storage-plugin`), while theme/last-tab/backend-URL-presence go through `@capacitor/preferences`. The native `android/` project is committed minus secrets (only `.example` placeholder templates ship), and every build is verified here with a DEBUG `assembleDebug` (release signing is Phase 6).

**Tech Stack:** Capacitor 8.4.1 (`@capacitor/core`, `@capacitor/cli`, `@capacitor/android`, `@capacitor/app`, `@capacitor/preferences`, `capacitor-secure-storage-plugin`), Vite 8, React 19 (`react`/`react-dom` 19), Vitest 4 + `@testing-library/react` 16 (JS units), `node:test` (pure logic units), JDK 21, Android SDK platforms 34/35 + build-tools 34.0.0/35.0.0, Gradle/AGP as pulled by `cap add android`.

## Global Constraints

- **Desktop web app behaviour stays byte-for-byte unchanged.** Phase 2 is purely additive: a new top-level `mobile/` dir + reuse of `src/`. Do NOT modify desktop `src/` behaviour except through the already-merged seams (`src/api/baseUrl.js`, `src/api/client.js`, `src/storage/index.js`, `src/hooks/useData.js`). The root `vite.config.js`, root `index.html`, and `src/main.jsx`/`src/App.jsx` are NOT touched.
- **Native HTTP is the default transport** (`CapacitorHttp: { enabled: true }`); the CORS allow-list (`CORS_ORIGIN`) and `CSP_CONNECT_EXTRA` env path are documented FALLBACK only. The mobile CSP `connect-src` stays tight (`'self'`).
- **No secrets committed (public OSS repo).** Only `.example` templates with literal `REPLACE_ME` placeholders. The auth token lives ONLY in the Android Keystore (via `capacitor-secure-storage-plugin`), NEVER `localStorage` or plain Preferences. Theme, last tab, and the backend URL (for the "already configured?" check) live in `@capacitor/preferences`. The backend URL + token are BOTH also written to the Keystore via the storage adapter to satisfy the "stored in Android Keystore" requirement.
- **All native-build verification steps prefix `source ~/.android-env`** (the shell does NOT auto-load `~/.bashrc`; `JAVA_HOME=~/jdk-21`, `ANDROID_HOME=~/android-sdk`). The Capacitor CLI is invoked via `npx @capacitor/cli ...` (no global `cap`).
- **Capacitor 8.4.1, JDK 21.** `appId: 'io.jaghelm.app'`, `appName: 'JagHelm'`. `androidScheme: 'https'`, `hostname: 'localhost'` (set explicitly — default is `http`). `webDir: 'dist'` (relative to `mobile/`, i.e. `mobile/dist`). Compile/target SDK = **36** (the Capacitor 8 scaffold default and the spec's preference; VERIFIED to build here — platforms android-36 + build-tools 36.0.0 are installed and `assembleDebug` builds clean with the full plugin set). Do NOT downgrade to 35. The explicit AGP/Gradle/Kotlin version pin in `android/variables.gradle` for reproducible *release* builds remains a Phase 6 follow-up. `minSdkVersion 24`. NEVER set `server.url`; leave `server.cleartext: false` and `server.allowNavigation` empty.
- **Native scaffold/build verification is by the build succeeding + the DEBUG APK existing** (`mobile/android/app/build/outputs/apk/debug/app-debug.apk`), NOT unit tests. On-device runtime + release signing are out of Phase 2 scope.
- **TDD for the JS units** (native-HTTP transport selection, the Keystore + Preferences adapters, first-run URL/token validation, config persistence, and the tab IA): write failing test → run it (fails) → minimal impl → run (passes) → commit. DRY / YAGNI.
- **Fonts are bundled locally** (downloaded `.woff2` + a `@font-face` CSS) — NO `fonts.googleapis.com` / `fonts.gstatic.com` CDN link in `mobile/index.html` — so `font-src 'self'` holds under the mobile CSP. (The desktop `index.html` keeps its CDN fonts, unchanged.)
- **Mobile is scored as part of the single `jaghelm` `web-app` manifest** — do NOT add a second `.git` under `mobile/`. The mobile track shares the parent CI host and ledger.
- **Mandatory pre-done gate (HARD RULE):** after implementation, run `/simplify` then `/security-review` before calling Phase 2 done. The human merge gate (Jag reviews + merges the PR) is never bypassed — no push to main, no auto-merge.

---

## File Structure

Every path below is relative to the repo root (`/home/ilaaj-agent/worktrees/jaghelm-mobile-phase2`). NEW unless marked MODIFY.

| Path | Responsibility |
|---|---|
| `mobile/package.json` | Mobile-only deps (`@capacitor/*`, secure-storage plugin, vite, react) + `dev`/`build`/`cap:*` scripts. The `mobile/` npm workspace root. |
| `mobile/vite.config.mobile.js` | Mobile Vite build → `mobile/dist`; `@shared` resolve alias onto `../src`; jsdom/vitest config for `mobile/src/**/*.test.{js,jsx}`. |
| `mobile/index.html` | Mobile WebView document: tight CSP `<meta>` (native-HTTP transport), local-font `<link>`, `#root`, `viewport-fit=cover` for edge-to-edge. |
| `mobile/capacitor.config.ts` | `appId`/`appName`/`webDir`; `androidScheme: https`+`hostname`; `CapacitorHttp.enabled: true`; `PushNotifications.presentationOptions` (declared for Phase 5); `insetsHandling` for safe-area correctness on old WebViews. |
| `mobile/src/main.jsx` | Mobile entry: imports global tokens CSS + local-font CSS, runs `bootMobile()` then mounts `<MobileApp/>`. |
| `mobile/src/boot.js` | `bootMobile()` — the wiring sequence: `setStorageAdapter(keystoreAdapter)` → `installNativeHttp()` → `await initAuthToken()` → resolve stored base → `setApiBase()`. Returns `{ configured }`. |
| `mobile/src/nativeHttp.js` | `installNativeHttp()` — default transport: ensures Capacitor's patched (native) `window.fetch` is active; `isNativeHttp()` reports whether native transport is in effect. |
| `mobile/src/storage/keystoreAdapter.js` | Keystore-backed secure-storage adapter (`getItem`/`setItem`/`removeItem`) over `capacitor-secure-storage-plugin`. For secrets (token, backend URL). |
| `mobile/src/storage/prefsAdapter.js` | `@capacitor/preferences` wrapper for NON-secret UI state: `getPref`/`setPref` for theme + last-tab + backend-URL-presence. |
| `mobile/src/runtimeConfig.js` | Pure helpers: `normalizeBaseUrl(input)` (validates + canonicalizes the backend URL), `BASE_URL_KEY`/`TOKEN_KEY`/`THEME_KEY`/`LAST_TAB_KEY` constants, `validateFirstRun({url,token})`. No I/O. |
| `mobile/src/MobileApp.jsx` | Bottom-tab shell (Overview / Services / Infra / Alerts), gates on first-run, restores theme + last tab, hardware-back handling, safe-area layout. |
| `mobile/src/TABS.js` | `TABS` — the locked IA array (`[{id,label}]` in order Overview, Services, Infra, Alerts). Single source of truth, importable by tests. |
| `mobile/src/FirstRun.jsx` | First-run screen: backend URL + token inputs, "Test & Connect" → `testConnection()` → on success write token+URL to Keystore, URL-presence to Preferences, `setApiBase()`, call `onConnected`. |
| `mobile/src/connect.js` | `testConnection({url, token})` — pings `${normalizedUrl}/auth/check` via `apiFetch` with the candidate token; returns `{ok, status, error}`. |
| `mobile/src/styles/fonts.css` | `@font-face` rules pointing at locally-bundled `.woff2` (Outfit / DM Sans / JetBrains Mono); replaces the CDN `<link>`. |
| `mobile/src/fonts/*.woff2` | Locally-bundled font files (no CDN). |
| `mobile/src/views/Overview.jsx` `Services.jsx` `Infra.jsx` `Alerts.jsx` | Minimal Phase-2 tab placeholders (heading + "wired in Phase 3" note) so the shell renders all four tabs over the reused data layer. Read-only UX is Phase 3. |
| `mobile/android/` | `npx cap add android` output — COMMITTED minus secrets (per spec: "committed, minus secrets"). |
| `mobile/google-services.json.example` | Placeholder FCM Android config template (`REPLACE_ME`), tracked. |
| `mobile/keystore.properties.example` | Placeholder signing template (`REPLACE_ME`), tracked. |
| `mobile/.env.example` | Placeholder mobile env template, tracked. |
| `mobile/.gitignore` | Mobile-scoped secret globs + build-output ignores + `.example` negations (belt over the repo-root `.gitignore`). |
| `.gitignore` (MODIFY) | Add `mobile/dist`, `mobile/node_modules`, `mobile/android/app/build/`, `mobile/android/.gradle/`, `mobile/android/local.properties`, `mobile/android/app/google-services.json`, `mobile/keystore.properties`, `mobile/android/key.properties` (negations already present from Phase 0). |
| `package.json` (MODIFY) | Add passthrough scripts only: `mobile:dev`, `mobile:build`, `mobile:sync`, `test:mobile`. No new root deps. |
| `.harness-ledger.md` (MODIFY) | Append Phase 2 captures/gaps with honest numbers (native-HTTP-default rationale; deferred SDK-36 pin; deferred `@shared`→workspace-package ADR; CDN→local font migration note). |

---

## Task 1: Mobile package + Vite config + `@shared` alias (build skeleton)

**Files:**
- Create: `mobile/package.json`
- Create: `mobile/vite.config.mobile.js`
- Create: `mobile/index.html`
- Create: `mobile/src/main.jsx`
- Create: `mobile/src/MobileApp.jsx` (stub for this task — replaced in Task 6)
- Create: `mobile/src/styles/fonts.css` (empty rules placeholder; real `@font-face` in Task 7)
- Modify: `package.json` (root — add passthrough scripts)
- Test: `mobile/src/aliasSmoke.test.jsx`

**Interfaces:**
- Consumes: `@shared/api/baseUrl.js` `getApiBase(): string` (default `'/api'`), `setApiBase(base: string): void`, `isRelativeBase(): boolean`; `@shared/hooks/useData.js` `cachedIconUrl(url: string): string|null`.
- Produces: an installable `mobile/` package with `npm run --prefix mobile build` (vite → `mobile/dist`) and `npm run --prefix mobile test` (vitest); the `@shared` alias resolving `../src`; root scripts `mobile:dev`/`mobile:build`/`mobile:sync`/`test:mobile`.

- [ ] **Step 1: Write the failing test** that proves the `@shared` alias resolves the merged data layer from inside `mobile/`.

Create `mobile/src/aliasSmoke.test.jsx`:
```jsx
import { describe, it, expect } from 'vitest';
import { getApiBase, setApiBase } from '@shared/api/baseUrl.js';
import { cachedIconUrl } from '@shared/hooks/useData.js';

describe('@shared alias → desktop data layer', () => {
  it('default base is /api (desktop-unchanged)', () => {
    setApiBase('/api'); // reset
    expect(getApiBase()).toBe('/api');
  });

  it('setApiBase makes cachedIconUrl base-aware for CDN urls', () => {
    setApiBase('http://vm-101:3099/api');
    const u = cachedIconUrl('https://cdn.jsdelivr.net/x/icon.svg');
    expect(u).toBe(
      'http://vm-101:3099/api/icons/cached?url=' +
        encodeURIComponent('https://cdn.jsdelivr.net/x/icon.svg')
    );
    setApiBase('/api'); // restore
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase2/mobile && npm install && npm test -- aliasSmoke`
Expected: FAIL — `mobile/package.json` / vite config don't exist yet (npm install or vitest cannot resolve `@shared`). (If `npm install` errors first, that is the expected initial failure.)

- [ ] **Step 3: Write minimal implementation**

Create `mobile/package.json`:
```json
{
  "name": "jaghelm-mobile",
  "version": "1.4.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --config vite.config.mobile.js",
    "build": "vite build --config vite.config.mobile.js",
    "test": "vitest run --config vite.config.mobile.js",
    "test:watch": "vitest --config vite.config.mobile.js",
    "cap:add:android": "cap add android",
    "cap:sync": "cap sync android"
  },
  "dependencies": {
    "@capacitor/android": "^8.4.1",
    "@capacitor/app": "^8.1.0",
    "@capacitor/core": "^8.4.1",
    "@capacitor/preferences": "^8.0.1",
    "capacitor-secure-storage-plugin": "^0.13.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@capacitor/cli": "^8.4.1",
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.2",
    "@vitejs/plugin-react": "^6.0.1",
    "jsdom": "^29.1.1",
    "vite": "^8.0.1",
    "vitest": "^4.1.9"
  }
}
```
> NOTE for the implementer: pin the `@capacitor/*` versions to the exact 8.4.1-compatible set the sandbox already smoke-proved. If `npm install` resolves a different patch, accept the resolved lockfile as long as `npx @capacitor/cli --version` reports 8.x and Task 8's `assembleDebug` passes. Do not downgrade below the smoke-proven set.

Create `mobile/vite.config.mobile.js`:
```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../src', import.meta.url)),
    },
  },
  // mobile/dist is the Capacitor webDir — NOT served by Express.
  build: { outDir: 'dist', assetsDir: 'assets', minify: true },
  server: { port: 5174 },
  test: {
    environment: 'jsdom',
    globals: true,
    unstubGlobals: true,
    setupFiles: ['./src/testing/setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
    css: false,
    restoreMocks: true,
  },
});
```

Create `mobile/src/testing/setup.js` (mirrors the desktop setup so RTL + jest-dom + inert browser stubs work):
```js
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (typeof window !== 'undefined' && window.Element) {
  window.Element.prototype.scrollIntoView = function scrollIntoView() {};
}
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() {
      return false;
    },
  });
}
```

Create `mobile/src/styles/fonts.css` (placeholder — real `@font-face` lands in Task 7):
```css
/* Local font faces are added in Task 7 (no CDN). */
```

Create `mobile/src/main.jsx`:
```jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import MobileApp from './MobileApp.jsx';
import '@shared/styles/global.css';
import './styles/fonts.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <MobileApp />
  </React.StrictMode>
);
```

Create `mobile/src/MobileApp.jsx` (stub — full shell in Task 6):
```jsx
import React from 'react';

export default function MobileApp() {
  return <div id="mobile-root">JagHelm Mobile</div>;
}
```

Create `mobile/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>JagHelm</title>
    <!-- CSP meta is added in Task 7 (tight connect-src 'self' for native HTTP). -->
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

Modify the root `package.json` `"scripts"` block — add these four lines (do NOT touch any existing script):
```json
    "mobile:dev": "npm run --prefix mobile dev",
    "mobile:build": "npm run --prefix mobile build",
    "mobile:sync": "npm run --prefix mobile build && npx --prefix mobile @capacitor/cli sync android --config mobile/capacitor.config.ts",
    "test:mobile": "npm run --prefix mobile test"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase2/mobile && npm install && npm test -- aliasSmoke`
Expected: PASS (2 passing). Then `npm run build` → produces `mobile/dist/index.html`.

- [ ] **Step 5: Verify desktop is untouched**

Run: `cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase2 && git status --short src vite.config.js index.html src/main.jsx`
Expected: no output (no desktop files modified).

- [ ] **Step 6: Commit**

```bash
cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase2
git add mobile/package.json mobile/package-lock.json mobile/vite.config.mobile.js mobile/index.html mobile/src/main.jsx mobile/src/MobileApp.jsx mobile/src/styles/fonts.css mobile/src/testing/setup.js mobile/src/aliasSmoke.test.jsx package.json
git commit -m "feat(mobile): scaffold mobile vite build with @shared alias onto data layer"
```

---

## Task 2: Runtime config helpers (pure: URL normalize, keys, validation)

**Files:**
- Create: `mobile/src/runtimeConfig.js`
- Test: `mobile/src/runtimeConfig.test.js`

**Interfaces:**
- Consumes: nothing (pure module, no I/O).
- Produces:
  - `BASE_URL_KEY = 'jaghelm-base-url'`, `TOKEN_KEY = 'jaghelm-token'`, `THEME_KEY = 'jaghelm-theme'`, `LAST_TAB_KEY = 'jaghelm-last-tab'`, `URL_PRESENT_KEY = 'jaghelm-base-url-present'` (string constants).
  - `normalizeBaseUrl(input: string): string` — trims, requires `http(s)://`, strips a trailing `/api` and any trailing slashes, then appends `/api` exactly once. Throws `Error('invalid url')` on empty/non-http input.
  - `validateFirstRun({ url, token }): { ok: boolean, errors: { url?: string, token?: string } }` — `url` must normalize without throwing; `token` must be a non-empty trimmed string.

> RATIONALE (resolved ambiguity): the spec stores `jaghelm-token` (matches `client.js` `initAuthToken()` key) in the Keystore. The backend URL is also stored in the Keystore (it is a secret per "Security & Secrets"), under `jaghelm-base-url`. `URL_PRESENT_KEY` is a NON-secret boolean breadcrumb in Preferences so the shell can answer "is this a first run?" without reading the Keystore on every cold start. The canonical base ALWAYS ends in `/api` so `apiFetch`'s `url.startsWith(getApiBase())` guard injects `x-auth-token` for absolute mobile URLs.

- [ ] **Step 1: Write the failing test**

Create `mobile/src/runtimeConfig.test.js`:
```js
import { describe, it, expect } from 'vitest';
import {
  normalizeBaseUrl,
  validateFirstRun,
  BASE_URL_KEY,
  TOKEN_KEY,
  URL_PRESENT_KEY,
} from './runtimeConfig.js';

describe('normalizeBaseUrl', () => {
  it('appends /api to a bare host', () => {
    expect(normalizeBaseUrl('http://vm-101:3099')).toBe('http://vm-101:3099/api');
  });
  it('is idempotent when /api already present', () => {
    expect(normalizeBaseUrl('http://vm-101:3099/api')).toBe('http://vm-101:3099/api');
  });
  it('strips trailing slashes and trailing /api/', () => {
    expect(normalizeBaseUrl('https://h/api/')).toBe('https://h/api');
    expect(normalizeBaseUrl('https://h/')).toBe('https://h/api');
  });
  it('trims surrounding whitespace', () => {
    expect(normalizeBaseUrl('  http://h  ')).toBe('http://h/api');
  });
  it('throws on empty or non-http input', () => {
    expect(() => normalizeBaseUrl('')).toThrow('invalid url');
    expect(() => normalizeBaseUrl('vm-101:3099')).toThrow('invalid url');
  });
});

describe('validateFirstRun', () => {
  it('accepts a good url + token', () => {
    expect(validateFirstRun({ url: 'http://h:3099', token: 'abc' })).toEqual({
      ok: true,
      errors: {},
    });
  });
  it('rejects a bad url', () => {
    const r = validateFirstRun({ url: 'nope', token: 'abc' });
    expect(r.ok).toBe(false);
    expect(r.errors.url).toBeTruthy();
  });
  it('rejects an empty token', () => {
    const r = validateFirstRun({ url: 'http://h', token: '   ' });
    expect(r.ok).toBe(false);
    expect(r.errors.token).toBeTruthy();
  });
});

describe('storage keys', () => {
  it('token key matches the data-layer initAuthToken key', () => {
    expect(TOKEN_KEY).toBe('jaghelm-token');
  });
  it('exposes base url + presence keys', () => {
    expect(BASE_URL_KEY).toBe('jaghelm-base-url');
    expect(URL_PRESENT_KEY).toBe('jaghelm-base-url-present');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase2/mobile && npm test -- runtimeConfig`
Expected: FAIL — `runtimeConfig.js` does not exist (`Cannot find module './runtimeConfig.js'`).

- [ ] **Step 3: Write minimal implementation**

Create `mobile/src/runtimeConfig.js`:
```js
/**
 * Pure runtime-config helpers for the mobile app. No I/O — storage is layered
 * on top by the adapters/boot. The canonical API base always ends in `/api`
 * so apiFetch's `url.startsWith(getApiBase())` guard injects x-auth-token for
 * the absolute mobile URL.
 */
export const BASE_URL_KEY = 'jaghelm-base-url'; // secret → Keystore
export const TOKEN_KEY = 'jaghelm-token'; // secret → Keystore (matches initAuthToken)
export const THEME_KEY = 'jaghelm-theme'; // non-secret → Preferences
export const LAST_TAB_KEY = 'jaghelm-last-tab'; // non-secret → Preferences
export const URL_PRESENT_KEY = 'jaghelm-base-url-present'; // non-secret breadcrumb → Preferences

/** Validate + canonicalize a backend URL to `<origin>/api`. Throws on bad input. */
export function normalizeBaseUrl(input) {
  const s = String(input || '').trim();
  if (!/^https?:\/\//i.test(s)) throw new Error('invalid url');
  // strip trailing slashes, then a trailing /api (any case), then trailing slashes again
  const stripped = s.replace(/\/+$/, '').replace(/\/api$/i, '').replace(/\/+$/, '');
  if (!/^https?:\/\/.+/i.test(stripped)) throw new Error('invalid url');
  return `${stripped}/api`;
}

/** First-run field validation. Returns { ok, errors } — never throws. */
export function validateFirstRun({ url, token }) {
  const errors = {};
  try {
    normalizeBaseUrl(url);
  } catch {
    errors.url = 'Enter a valid http(s) backend URL';
  }
  if (!String(token || '').trim()) {
    errors.token = 'Enter your access token';  <!-- pragma: allowlist secret -->
  }
  return { ok: Object.keys(errors).length === 0, errors };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase2/mobile && npm test -- runtimeConfig`
Expected: PASS (all `normalizeBaseUrl`, `validateFirstRun`, storage-key cases green).

- [ ] **Step 5: Commit**

```bash
cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase2
git add mobile/src/runtimeConfig.js mobile/src/runtimeConfig.test.js
git commit -m "feat(mobile): pure runtime-config helpers (url normalize, keys, validation)"
```

---

## Task 3: Keystore + Preferences storage adapters

**Files:**
- Create: `mobile/src/storage/keystoreAdapter.js`
- Create: `mobile/src/storage/prefsAdapter.js`
- Test: `mobile/src/storage/keystoreAdapter.test.js`
- Test: `mobile/src/storage/prefsAdapter.test.js`

**Interfaces:**
- Consumes: `capacitor-secure-storage-plugin` `SecureStoragePlugin.{get,set,remove}`; `@capacitor/preferences` `Preferences.{get,set}`.
- Produces:
  - `keystoreAdapter = { getItem(k): Promise<string|null>, setItem(k,v): Promise<void>, removeItem(k): Promise<void> }` — drop-in for `setStorageAdapter()` (same async shape as `@shared/storage/index.js` `webStorage`). `getItem` returns `null` (never throws) when the key is absent.
  - `getPref(k): Promise<string|null>`, `setPref(k, v): Promise<void>` over `@capacitor/preferences`.

- [ ] **Step 1: Write the failing tests**

Create `mobile/src/storage/keystoreAdapter.test.js`:
```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const get = vi.fn();
const set = vi.fn();
const remove = vi.fn();
vi.mock('capacitor-secure-storage-plugin', () => ({
  SecureStoragePlugin: { get, set, remove },
}));

import { keystoreAdapter } from './keystoreAdapter.js';

beforeEach(() => {
  get.mockReset();
  set.mockReset();
  remove.mockReset();
});

describe('keystoreAdapter', () => {
  it('getItem returns the stored value', async () => {
    get.mockResolvedValue({ value: 'tok123' });
    await expect(keystoreAdapter.getItem('jaghelm-token')).resolves.toBe('tok123');
    expect(get).toHaveBeenCalledWith({ key: 'jaghelm-token' });
  });

  it('getItem returns null (never throws) on a missing key', async () => {
    get.mockRejectedValue(new Error('Item with given key does not exist'));
    await expect(keystoreAdapter.getItem('missing')).resolves.toBeNull();
  });

  it('setItem coerces value to a string', async () => {
    set.mockResolvedValue({ value: true });
    await keystoreAdapter.setItem('k', 42);
    expect(set).toHaveBeenCalledWith({ key: 'k', value: '42' });
  });

  it('removeItem delegates to the plugin', async () => {
    remove.mockResolvedValue({ value: true });
    await keystoreAdapter.removeItem('k');
    expect(remove).toHaveBeenCalledWith({ key: 'k' });
  });
});
```

Create `mobile/src/storage/prefsAdapter.test.js`:
```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const get = vi.fn();
const set = vi.fn();
vi.mock('@capacitor/preferences', () => ({ Preferences: { get, set } }));

import { getPref, setPref } from './prefsAdapter.js';

beforeEach(() => {
  get.mockReset();
  set.mockReset();
});

describe('prefsAdapter', () => {
  it('getPref returns the stored value', async () => {
    get.mockResolvedValue({ value: 'dracula' });
    await expect(getPref('jaghelm-theme')).resolves.toBe('dracula');
    expect(get).toHaveBeenCalledWith({ key: 'jaghelm-theme' });
  });

  it('getPref returns null when unset', async () => {
    get.mockResolvedValue({ value: null });
    await expect(getPref('jaghelm-theme')).resolves.toBeNull();
  });

  it('setPref writes a string value', async () => {
    set.mockResolvedValue();
    await setPref('jaghelm-last-tab', 'infra');
    expect(set).toHaveBeenCalledWith({ key: 'jaghelm-last-tab', value: 'infra' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase2/mobile && npm test -- storage/`
Expected: FAIL — adapters don't exist (`Cannot find module './keystoreAdapter.js'` / `./prefsAdapter.js`).

- [ ] **Step 3: Write minimal implementation**

Create `mobile/src/storage/keystoreAdapter.js`:
```js
/**
 * Android Keystore-backed secure storage (EncryptedSharedPreferences via
 * capacitor-secure-storage-plugin). Drop-in for setStorageAdapter() — same
 * async shape as the desktop webStorage default. SECRETS ONLY (token, backend
 * URL). getItem returns null on a missing key (the plugin rejects), never throws.
 */
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';

export const keystoreAdapter = {
  async getItem(k) {
    try {
      const { value } = await SecureStoragePlugin.get({ key: k });
      return value ?? null;
    } catch {
      return null; // missing key → plugin rejects; treat as absent
    }
  },
  async setItem(k, v) {
    await SecureStoragePlugin.set({ key: k, value: String(v) });
  },
  async removeItem(k) {
    await SecureStoragePlugin.remove({ key: k });
  },
};
```

Create `mobile/src/storage/prefsAdapter.js`:
```js
/**
 * Capacitor Preferences wrapper for NON-secret UI state only (theme, last tab,
 * backend-URL-presence breadcrumb). Scheme-independent native storage, never
 * WebView localStorage. NEVER store secrets here — secrets go to keystoreAdapter.
 */
import { Preferences } from '@capacitor/preferences';

export async function getPref(k) {
  const { value } = await Preferences.get({ key: k });
  return value ?? null;
}

export async function setPref(k, v) {
  await Preferences.set({ key: k, value: String(v) });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase2/mobile && npm test -- storage/`
Expected: PASS (keystore + prefs suites green).

- [ ] **Step 5: Commit**

```bash
cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase2
git add mobile/src/storage/keystoreAdapter.js mobile/src/storage/prefsAdapter.js mobile/src/storage/keystoreAdapter.test.js mobile/src/storage/prefsAdapter.test.js
git commit -m "feat(mobile): Keystore secret adapter + Preferences non-secret adapter"
```

---

## Task 4: Native-HTTP transport + boot wiring

**Files:**
- Create: `mobile/src/nativeHttp.js`
- Create: `mobile/src/boot.js`
- Test: `mobile/src/nativeHttp.test.js`
- Test: `mobile/src/boot.test.js`

**Interfaces:**
- Consumes: `@shared/storage/index.js` `setStorageAdapter(adapter): void`; `@shared/api/client.js` `initAuthToken(): Promise<void>`; `@shared/api/baseUrl.js` `setApiBase(base): void`; `mobile/src/storage/keystoreAdapter.js` `keystoreAdapter`; `mobile/src/storage/prefsAdapter.js` `getPref`; `mobile/src/runtimeConfig.js` `BASE_URL_KEY`, `URL_PRESENT_KEY`.
- Produces:
  - `installNativeHttp(): void` — verifies/asserts the Capacitor native-HTTP transport is active (Capacitor patches `window.fetch` natively when `CapacitorHttp.enabled`); idempotent.
  - `isNativeHttp(): boolean` — true when `window.CapacitorHttp` (or the patched-fetch marker) is present.
  - `bootMobile(): Promise<{ configured: boolean }>` — runs `setStorageAdapter(keystoreAdapter)` → `installNativeHttp()` → `await initAuthToken()` → reads stored base from the Keystore (`keystoreAdapter.getItem(BASE_URL_KEY)`); if present, `setApiBase(base)` and returns `{ configured: true }`, else `{ configured: false }` (base stays `/api`).

> RATIONALE (resolved ambiguity): native HTTP is enabled declaratively in `capacitor.config.ts` (`CapacitorHttp.enabled: true`, Task 5) — Capacitor patches `window.fetch` at native runtime, so there is no JS API to "turn it on." `installNativeHttp()` is therefore a thin assertion/marker (and the seam where a future fallback toggle would live), keeping the default-transport decision explicit and testable rather than implicit. The `configured` flag drives the first-run gate.

- [ ] **Step 1: Write the failing tests**

Create `mobile/src/nativeHttp.test.js`:
```js
import { describe, it, expect, beforeEach } from 'vitest';
import { installNativeHttp, isNativeHttp } from './nativeHttp.js';

beforeEach(() => {
  delete window.CapacitorHttp;
});

describe('nativeHttp', () => {
  it('isNativeHttp is false when Capacitor native HTTP is absent', () => {
    expect(isNativeHttp()).toBe(false);
  });
  it('isNativeHttp is true once the native bridge is present', () => {
    window.CapacitorHttp = {};
    expect(isNativeHttp()).toBe(true);
  });
  it('installNativeHttp is idempotent and does not throw', () => {
    expect(() => {
      installNativeHttp();
      installNativeHttp();
    }).not.toThrow();
  });
});
```

Create `mobile/src/boot.test.js`:
```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const setStorageAdapter = vi.fn();
const initAuthToken = vi.fn().mockResolvedValue(undefined);
const setApiBase = vi.fn();
const getItem = vi.fn();

vi.mock('@shared/storage/index.js', () => ({ setStorageAdapter }));
vi.mock('@shared/api/client.js', () => ({ initAuthToken }));
vi.mock('@shared/api/baseUrl.js', () => ({ setApiBase }));
vi.mock('./storage/keystoreAdapter.js', () => ({ keystoreAdapter: { getItem } }));

import { bootMobile } from './boot.js';

beforeEach(() => {
  setStorageAdapter.mockClear();
  initAuthToken.mockClear();
  setApiBase.mockClear();
  getItem.mockReset();
});

describe('bootMobile', () => {
  it('wires keystore adapter, inits token, and reports unconfigured on first run', async () => {
    getItem.mockResolvedValue(null);
    const r = await bootMobile();
    expect(setStorageAdapter).toHaveBeenCalledTimes(1);
    expect(initAuthToken).toHaveBeenCalledTimes(1);
    expect(setApiBase).not.toHaveBeenCalled();
    expect(r).toEqual({ configured: false });
  });

  it('applies the stored base and reports configured', async () => {
    getItem.mockResolvedValue('http://vm-101:3099/api');
    const r = await bootMobile();
    expect(setApiBase).toHaveBeenCalledWith('http://vm-101:3099/api');
    expect(r).toEqual({ configured: true });
  });

  it('inits the token AFTER the storage adapter is swapped', async () => {
    getItem.mockResolvedValue(null);
    const order = [];
    setStorageAdapter.mockImplementation(() => order.push('adapter'));
    initAuthToken.mockImplementation(async () => order.push('token'));
    await bootMobile();
    expect(order).toEqual(['adapter', 'token']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase2/mobile && npm test -- nativeHttp boot`
Expected: FAIL — `nativeHttp.js` / `boot.js` do not exist.

- [ ] **Step 3: Write minimal implementation**

Create `mobile/src/nativeHttp.js`:
```js
/**
 * Default transport = Capacitor native HTTP. With `CapacitorHttp.enabled: true`
 * in capacitor.config.ts, Capacitor patches window.fetch at native runtime so
 * apiFetch leaves the WebView (bypassing CORS, reading ETag for 304s). There is
 * no JS API to enable it — this module asserts/markers the decision and is the
 * single seam where a WebView-fetch fallback toggle would live.
 */
let installed = false;

export function installNativeHttp() {
  // Idempotent marker. Native patching happens in the bridge; nothing to wire in
  // JS today. Kept explicit so the default-transport decision is testable.
  installed = true;
}

/** True when Capacitor's native HTTP bridge is present at runtime. */
export function isNativeHttp() {
  return typeof window !== 'undefined' && !!window.CapacitorHttp;
}

/** Test/diagnostic helper: whether installNativeHttp() has run this session. */
export function _isInstalled() {
  return installed;
}
```

Create `mobile/src/boot.js`:
```js
/**
 * Mobile boot sequence (must run before any data hook fires):
 *   setStorageAdapter(keystoreAdapter)  → swap secrets to the Keystore
 *   installNativeHttp()                 → default transport (native HTTP)
 *   await initAuthToken()               → seed apiFetch's in-memory token
 *   read stored base from Keystore      → setApiBase() if configured
 * Returns { configured } so the shell can route to FirstRun on a cold start.
 */
import { setStorageAdapter } from '@shared/storage/index.js';
import { initAuthToken } from '@shared/api/client.js';
import { setApiBase } from '@shared/api/baseUrl.js';
import { keystoreAdapter } from './storage/keystoreAdapter.js';
import { installNativeHttp } from './nativeHttp.js';
import { BASE_URL_KEY } from './runtimeConfig.js';

export async function bootMobile() {
  setStorageAdapter(keystoreAdapter);
  installNativeHttp();
  await initAuthToken();
  const base = await keystoreAdapter.getItem(BASE_URL_KEY);
  if (base) {
    setApiBase(base);
    return { configured: true };
  }
  return { configured: false };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase2/mobile && npm test -- nativeHttp boot`
Expected: PASS (transport + boot-ordering suites green).

- [ ] **Step 5: Commit**

```bash
cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase2
git add mobile/src/nativeHttp.js mobile/src/boot.js mobile/src/nativeHttp.test.js mobile/src/boot.test.js
git commit -m "feat(mobile): native-HTTP default transport + Keystore boot wiring"
```

---

## Task 5: Capacitor config (native HTTP default, scheme, insets)

**Files:**
- Create: `mobile/capacitor.config.ts`
- Test: `mobile/capacitor.config.test.js`

**Interfaces:**
- Consumes: `@capacitor/cli` `CapacitorConfig` type.
- Produces: a default-exported `CapacitorConfig` with `appId: 'io.jaghelm.app'`, `appName: 'JagHelm'`, `webDir: 'dist'`, `server: { androidScheme: 'https', hostname: 'localhost' }` (NO `url`, `cleartext: false`, empty `allowNavigation`), `plugins.CapacitorHttp.enabled: true`, `plugins.PushNotifications.presentationOptions` (declared for Phase 5), and `android.adjustMarginsForEdgeToEdge`/`insetsHandling` per Capacitor 8.

> RATIONALE (resolved ambiguity): the config is `.ts`, but the lint test runs under vitest (no TS toolchain in `mobile/`). The test asserts on the file's TEXT (a config lint that mirrors the spec's `check.yml` cap-config lint: no `server.url`, no `cleartext: true`, `androidScheme: 'https'`, `CapacitorHttp.enabled: true`, `webDir: 'dist'`). This is exactly the PR-check lane's intent and needs no `ts-node`.

- [ ] **Step 1: Write the failing test**

Create `mobile/capacitor.config.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cfg = readFileSync(
  fileURLToPath(new URL('./capacitor.config.ts', import.meta.url)),
  'utf8'
);

describe('capacitor.config.ts (cap-config lint — mirrors check.yml)', () => {
  it("appId is io.jaghelm.app (must equal the Firebase package name)", () => {
    expect(cfg).toMatch(/appId:\s*'io\.jaghelm\.app'/);
  });
  it('webDir is dist', () => {
    expect(cfg).toMatch(/webDir:\s*'dist'/);
  });
  it('androidScheme is https (explicit — default is http)', () => {
    expect(cfg).toMatch(/androidScheme:\s*'https'/);
  });
  it('enables CapacitorHttp (native transport default)', () => {
    expect(cfg).toMatch(/CapacitorHttp:\s*{\s*enabled:\s*true/);
  });
  it('NEVER sets server.url (live-reload escape hatch)', () => {
    expect(cfg).not.toMatch(/\burl:\s*'/);
  });
  it('does NOT enable cleartext', () => {
    expect(cfg).not.toMatch(/cleartext:\s*true/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase2/mobile && npm test -- capacitor.config`
Expected: FAIL — `capacitor.config.ts` does not exist (`ENOENT`).

- [ ] **Step 3: Write minimal implementation**

Create `mobile/capacitor.config.ts`:
```typescript
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.jaghelm.app', // MUST equal the Firebase Android package name (Phase 4/5)
  appName: 'JagHelm',
  webDir: 'dist', // mobile/dist — Capacitor webDir, NOT server-served
  server: {
    androidScheme: 'https', // explicit — Capacitor default is http://localhost
    hostname: 'localhost',
    // NO `url` (live-reload escape hatch — would point prod at a dev box).
    // `cleartext` left false: Tailscale already encrypts transport.
    // `allowNavigation` left empty: app talks to backend via native HTTP, not nav.
  },
  android: {
    // Capacitor 8 / Android 15 (SDK 35+) enforce edge-to-edge; inject correct
    // safe-area inset variables regardless of WebView version.
    adjustMarginsForEdgeToEdge: 'auto',
  },
  plugins: {
    CapacitorHttp: { enabled: true }, // native HTTP = default transport (bypasses CORS, reads ETag)
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] }, // declared for Phase 5
  },
};

export default config;
```
> NOTE: if `cap add android` (Task 8) or the resolved Capacitor minor rejects `adjustMarginsForEdgeToEdge` (renamed to the System Bars core plugin / `insetsHandling` in some 8.x patches), switch the `android` block to whatever the resolved `CapacitorConfig` type accepts for inset handling and update the comment — the test only asserts the load-bearing fields above, so this won't break the gate.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase2/mobile && npm test -- capacitor.config`
Expected: PASS (6 lint assertions green).

- [ ] **Step 5: Commit**

```bash
cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase2
git add mobile/capacitor.config.ts mobile/capacitor.config.test.js
git commit -m "feat(mobile): capacitor.config.ts — native HTTP default, https scheme, edge-to-edge"
```

---

## Task 6: Bottom-tab shell + tab IA + hardware back

**Files:**
- Create: `mobile/src/TABS.js`
- Create: `mobile/src/views/Overview.jsx`
- Create: `mobile/src/views/Services.jsx`
- Create: `mobile/src/views/Infra.jsx`
- Create: `mobile/src/views/Alerts.jsx`
- Modify: `mobile/src/MobileApp.jsx` (replace the Task-1 stub)
- Create: `mobile/src/MobileApp.css`
- Test: `mobile/src/TABS.test.js`
- Test: `mobile/src/MobileApp.test.jsx`

**Interfaces:**
- Consumes: `mobile/src/runtimeConfig.js` `LAST_TAB_KEY`; `mobile/src/storage/prefsAdapter.js` `getPref`/`setPref`; `@capacitor/app` `App.addListener('backButton', ...)`; the Task-4 `bootMobile` `{ configured }` result (passed in as a prop so the shell is render-testable without native boot).
- Produces:
  - `TABS = [{ id: 'overview', label: 'Overview' }, { id: 'services', label: 'Services' }, { id: 'infra', label: 'Infra' }, { id: 'alerts', label: 'Alerts' }]`.
  - `<MobileApp configured={boolean} onConnected={fn} />` — renders the active tab's view, a bottom tab bar with all four tabs, restores last tab from Preferences, persists tab changes, and registers a hardware-back listener that `exitApp()`s at a tab root.

> RATIONALE (resolved ambiguity): the locked IA (DESIGN.md line 31) is **Overview / Services / Infra / Alerts** in that order — confirmed and pinned in `TABS`. Phase 2 ships minimal placeholder views (heading + "Phase 3" note) so the shell renders all four tabs over the reused data layer; the read-only data UX is explicitly Phase 3. `configured`/`onConnected` are props so `MobileApp` is unit-testable in jsdom without invoking native boot.

- [ ] **Step 1: Write the failing tests**

Create `mobile/src/TABS.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { TABS } from './TABS.js';

describe('locked mobile IA', () => {
  it('is exactly Overview / Services / Infra / Alerts in order', () => {
    expect(TABS.map((t) => t.id)).toEqual(['overview', 'services', 'infra', 'alerts']);
    expect(TABS.map((t) => t.label)).toEqual(['Overview', 'Services', 'Infra', 'Alerts']);
  });
});
```

Create `mobile/src/MobileApp.test.jsx`:
```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const getPref = vi.fn().mockResolvedValue(null);
const setPref = vi.fn().mockResolvedValue(undefined);
vi.mock('./storage/prefsAdapter.js', () => ({ getPref, setPref }));

const addListener = vi.fn().mockReturnValue({ remove: vi.fn() });
const exitApp = vi.fn();
vi.mock('@capacitor/app', () => ({ App: { addListener, exitApp } }));

import MobileApp from './MobileApp.jsx';

beforeEach(() => {
  getPref.mockReset().mockResolvedValue(null);
  setPref.mockReset().mockResolvedValue(undefined);
  addListener.mockClear();
  exitApp.mockClear();
});

describe('MobileApp shell', () => {
  it('renders all four tabs and defaults to Overview', async () => {
    render(<MobileApp configured={true} onConnected={() => {}} />);
    for (const label of ['Overview', 'Services', 'Infra', 'Alerts']) {
      expect(screen.getByRole('tab', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  it('switches tab on tap and persists it to Preferences', async () => {
    render(<MobileApp configured={true} onConnected={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Infra' }));
    expect(screen.getByRole('tab', { name: 'Infra' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await waitFor(() =>
      expect(setPref).toHaveBeenCalledWith('jaghelm-last-tab', 'infra')
    );
  });

  it('restores the last tab from Preferences on mount', async () => {
    getPref.mockResolvedValue('alerts');
    render(<MobileApp configured={true} onConnected={() => {}} />);
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Alerts' })).toHaveAttribute(
        'aria-selected',
        'true'
      )
    );
  });

  it('registers a hardware-back listener', () => {
    render(<MobileApp configured={true} onConnected={() => {}} />);
    expect(addListener).toHaveBeenCalledWith('backButton', expect.any(Function));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase2/mobile && npm test -- TABS MobileApp`
Expected: FAIL — `TABS.js`/the four views don't exist; `MobileApp.jsx` stub has no tabs.

- [ ] **Step 3: Write minimal implementation**

Create `mobile/src/TABS.js`:
```js
/** Locked mobile IA (DESIGN.md UX §): bottom-tab order is fixed. */
export const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'services', label: 'Services' },
  { id: 'infra', label: 'Infra' },
  { id: 'alerts', label: 'Alerts' },
];
```

Create the four placeholder views (Phase 3 fills these). `mobile/src/views/Overview.jsx`:
```jsx
import React from 'react';
export default function Overview() {
  return (
    <section className="mobile-view" aria-label="Overview">
      <h1>Overview</h1>
      <p className="mobile-view__todo">Subsystem strip + incidents land in Phase 3.</p>
    </section>
  );
}
```
`mobile/src/views/Services.jsx`:
```jsx
import React from 'react';
export default function Services() {
  return (
    <section className="mobile-view" aria-label="Services">
      <h1>Services</h1>
      <p className="mobile-view__todo">Problems-first list + base-aware icons land in Phase 3.</p>
    </section>
  );
}
```
`mobile/src/views/Infra.jsx`:
```jsx
import React from 'react';
export default function Infra() {
  return (
    <section className="mobile-view" aria-label="Infra">
      <h1>Infra</h1>
      <p className="mobile-view__todo">Node cards + node detail land in Phase 3.</p>
    </section>
  );
}
```
`mobile/src/views/Alerts.jsx`:
```jsx
import React from 'react';
export default function Alerts() {
  return (
    <section className="mobile-view" aria-label="Alerts">
      <h1>Alerts</h1>
      <p className="mobile-view__todo">Push history + incident detail land in Phase 3.</p>
    </section>
  );
}
```

Create `mobile/src/MobileApp.css`:
```css
/* Edge-to-edge: content draws under the system bars (Android 15 / SDK 35+).
   Safe-area insets keep the tab bar and header clear of the status/nav bars. */
#mobile-root {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: var(--font-body);
}
.mobile-content {
  flex: 1;
  overflow-y: auto;
  padding: calc(env(safe-area-inset-top) + var(--space-4)) var(--space-4) var(--space-4);
}
.mobile-view h1 {
  font-family: var(--font-display);
  font-size: var(--text-2xl);
  margin: 0 0 var(--space-3);
}
.mobile-view__todo {
  color: var(--text-muted);
  font-size: var(--text-base);
}
.mobile-tabbar {
  display: flex;
  border-top: 1px solid var(--border-color);
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur));
  padding-bottom: env(safe-area-inset-bottom);
}
.mobile-tabbar button {
  flex: 1;
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: var(--text-sm);
  padding: var(--space-3) 0;
}
.mobile-tabbar button[aria-selected='true'] {
  color: var(--accent);
}
```

Replace `mobile/src/MobileApp.jsx` (the Task-1 stub) with the full shell:
```jsx
import React, { useState, useEffect } from 'react';
import { App } from '@capacitor/app';
import { TABS } from './TABS.js';
import { LAST_TAB_KEY } from './runtimeConfig.js';
import { getPref, setPref } from './storage/prefsAdapter.js';
import Overview from './views/Overview.jsx';
import Services from './views/Services.jsx';
import Infra from './views/Infra.jsx';
import Alerts from './views/Alerts.jsx';
import './MobileApp.css';

const VIEWS = { overview: Overview, services: Services, infra: Infra, alerts: Alerts };

export default function MobileApp({ configured }) {
  const [active, setActive] = useState('overview');

  // Restore the last tab from Preferences (non-secret UI state).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const last = await getPref(LAST_TAB_KEY);
      if (!cancelled && last && VIEWS[last]) setActive(last);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Hardware back: a tab root exits the app (the back stack is per-tab; deep
  // navigation arrives in Phase 3). Spec: exitApp() only at a tab root.
  useEffect(() => {
    const handle = App.addListener('backButton', () => {
      App.exitApp();
    });
    return () => {
      // listener handles return either a promise<{remove}> or {remove}
      Promise.resolve(handle).then((h) => h && h.remove && h.remove());
    };
  }, []);

  const onTab = (id) => {
    setActive(id);
    setPref(LAST_TAB_KEY, id);
  };

  const ActiveView = VIEWS[active];

  return (
    <div id="mobile-root">
      <main className="mobile-content">
        <ActiveView />
      </main>
      <nav className="mobile-tabbar" role="tablist" aria-label="Primary">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={active === t.id}
            onClick={() => onTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
```
> NOTE: `configured` is accepted (and consumed by Task 9's first-run gate) but the shell itself renders the same regardless; the gate logic lands in Task 9's `main.jsx` wiring. Keeping it as a prop here makes the shell render-testable in isolation.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase2/mobile && npm test -- TABS MobileApp`
Expected: PASS (tab IA + render/switch/restore/back-listener cases green).

- [ ] **Step 5: Commit**

```bash
cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase2
git add mobile/src/TABS.js mobile/src/TABS.test.js mobile/src/views/Overview.jsx mobile/src/views/Services.jsx mobile/src/views/Infra.jsx mobile/src/views/Alerts.jsx mobile/src/MobileApp.jsx mobile/src/MobileApp.css mobile/src/MobileApp.test.jsx
git commit -m "feat(mobile): bottom-tab shell (Overview/Services/Infra/Alerts) + hardware back"
```

---

## Task 7: Local fonts + tight mobile CSP meta

**Files:**
- Create: `mobile/src/fonts/outfit-latin.woff2`, `mobile/src/fonts/dmsans-latin.woff2`, `mobile/src/fonts/jetbrainsmono-latin.woff2` (downloaded; no CDN)
- Modify: `mobile/src/styles/fonts.css` (real `@font-face`)
- Modify: `mobile/index.html` (CSP `<meta>`, no CDN font `<link>`)
- Test: `mobile/index.html.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `mobile/index.html` carrying a tight CSP (`connect-src 'self'`, `font-src 'self'`, no `fonts.googleapis.com`/`fonts.gstatic.com`) and `fonts.css` declaring the three families (`Outfit`, `DM Sans`, `JetBrains Mono`) from local `.woff2` matching the desktop token names (`--font-display`/`--font-body`/`--font-mono`).

> RATIONALE (real gap found): the desktop `index.html` loads fonts from Google Fonts CDN. The spec REQUIRES mobile fonts bundled locally so `font-src 'self'` holds. So Phase 2 downloads the three families' latin `.woff2` into `mobile/src/fonts/` and declares them via `@font-face`. The font family NAMES match the desktop tokens exactly (`'Outfit'`, `'DM Sans'`, `'JetBrains Mono'`) so reused `global.css` `var(--font-*)` resolves with zero token change.

- [ ] **Step 1: Write the failing test**

Create `mobile/index.html.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync(
  fileURLToPath(new URL('./index.html', import.meta.url)),
  'utf8'
);
const fontsCss = readFileSync(
  fileURLToPath(new URL('./src/styles/fonts.css', import.meta.url)),
  'utf8'
);

describe('mobile index.html — tight CSP + local fonts', () => {
  it('has a CSP meta with connect-src self (native HTTP transport)', () => {
    expect(html).toMatch(/http-equiv="Content-Security-Policy"/);
    expect(html).toMatch(/connect-src 'self'/);
    expect(html).toMatch(/font-src 'self'/);
  });
  it('does NOT load fonts from a CDN', () => {
    expect(html).not.toMatch(/fonts\.googleapis\.com/);
    expect(html).not.toMatch(/fonts\.gstatic\.com/);
    expect(fontsCss).not.toMatch(/fonts\.googleapis\.com/);
    expect(fontsCss).not.toMatch(/fonts\.gstatic\.com/);
  });
  it('declares the three font families locally', () => {
    expect(fontsCss).toMatch(/font-family:\s*'Outfit'/);
    expect(fontsCss).toMatch(/font-family:\s*'DM Sans'/);
    expect(fontsCss).toMatch(/font-family:\s*'JetBrains Mono'/);
    expect(fontsCss).toMatch(/\.woff2/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase2/mobile && npm test -- index.html`
Expected: FAIL — no CSP meta, `fonts.css` still the placeholder.

- [ ] **Step 3: Write minimal implementation**

Download the three latin-subset `.woff2` files (no CDN at runtime; fetched once at build-authoring time). Run from `mobile/`:
```bash
cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase2/mobile && mkdir -p src/fonts
# Outfit 500, DM Sans 400, JetBrains Mono 400 — latin woff2 from the Google Fonts open-source repo (download, do NOT hotlink at runtime):
curl -fsSL -o src/fonts/outfit-latin.woff2 "https://raw.githubusercontent.com/google/fonts/main/ofl/outfit/Outfit%5Bwght%5D.ttf" || echo "FETCH OUTFIT MANUALLY"
# If the .ttf-only path is all upstream ships, convert to woff2 with fonttools, OR
# pull the ready woff2 from a fontsource package: npm pack @fontsource/outfit and extract files/*-latin-500-normal.woff2
```
> IMPLEMENTER NOTE (no-placeholder-compliant procedure): the reliable source for ready `.woff2` is the Fontsource packages. Run, from `mobile/`:
> ```bash
> npm pack @fontsource/outfit @fontsource/dm-sans @fontsource/jetbrains-mono
> for t in fontsource-outfit-*.tgz fontsource-dm-sans-*.tgz fontsource-jetbrains-mono-*.tgz; do tar xzf "$t"; done
> cp package/files/outfit-latin-500-normal.woff2 src/fonts/outfit-latin.woff2
> cp package/files/dm-sans-latin-400-normal.woff2 src/fonts/dmsans-latin.woff2
> cp package/files/jetbrains-mono-latin-400-normal.woff2 src/fonts/jetbrainsmono-latin.woff2
> rm -rf package fontsource-*.tgz
> ```
> These are SIL OFL / Apache-2.0 licensed (redistribution-safe in a public repo). Commit the three `.woff2` files. Do NOT add `@fontsource/*` as a runtime dep — only the extracted files ship.

Replace `mobile/src/styles/fonts.css`:
```css
/* Locally-bundled fonts (no CDN) so font-src 'self' holds under the mobile CSP.
   Family names match the desktop tokens in global.css (--font-display/body/mono)
   so reused styles resolve with zero token change. */
@font-face {
  font-family: 'Outfit';
  font-style: normal;
  font-weight: 300 800;
  font-display: swap;
  src: url('../fonts/outfit-latin.woff2') format('woff2');
}
@font-face {
  font-family: 'DM Sans';
  font-style: normal;
  font-weight: 300 600;
  font-display: swap;
  src: url('../fonts/dmsans-latin.woff2') format('woff2');
}
@font-face {
  font-family: 'JetBrains Mono';
  font-style: normal;
  font-weight: 400 500;
  font-display: swap;
  src: url('../fonts/jetbrainsmono-latin.woff2') format('woff2');
}
```

Replace `mobile/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <!-- Default (native-HTTP transport): connect-src stays tight; native calls bypass it.
         CSP is NOT the network boundary on mobile (token auth + Tailscale are);
         the backend host is runtime-configured and cannot be pinned here. -->
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
               font-src 'self' data:; img-src 'self' data: blob: https://cdn.jsdelivr.net;
               connect-src 'self';"
    />
    <title>JagHelm</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase2/mobile && npm test -- index.html && npm run build`
Expected: PASS (CSP + local-font assertions green); `npm run build` emits the `.woff2` into `mobile/dist/assets/`.

- [ ] **Step 5: Commit**

```bash
cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase2
git add mobile/src/fonts/outfit-latin.woff2 mobile/src/fonts/dmsans-latin.woff2 mobile/src/fonts/jetbrainsmono-latin.woff2 mobile/src/styles/fonts.css mobile/index.html mobile/index.html.test.js
git commit -m "feat(mobile): bundle fonts locally + tight CSP meta (font-src/connect-src 'self')"
```

---

## Task 8: Android native project + secret templates + .gitignore

**Files:**
- Create: `mobile/android/**` (`npx cap add android` output — committed minus secrets)
- Create: `mobile/google-services.json.example`
- Create: `mobile/keystore.properties.example`
- Create: `mobile/.env.example`
- Create: `mobile/.gitignore`
- Modify: `.gitignore` (repo root — add mobile build-output + secret paths)
- Test: `mobile/scaffold.test.js` (asserts the build artifacts + templates + no committed secrets)

**Interfaces:**
- Consumes: the Task-1..7 `mobile/dist` bundle + `mobile/capacitor.config.ts`.
- Produces: a committed `mobile/android/` Gradle project that builds a DEBUG APK; tracked `.example` placeholder templates; a `mobile/.gitignore` belt over the repo-root `.gitignore`; a passing `secret-scan.py`.

> RATIONALE (resolved ambiguity — committed vs gitignored `android/`): DESIGN.md monorepo layout line 77 says `android/` is **committed (minus secrets)**, and the Build §/CI never regenerate it from scratch — so Phase 2 COMMITS `mobile/android/`, with secrets (`google-services.json`, `*.keystore`, `keystore.properties`, `local.properties`, `app/build/`, `.gradle/`) gitignored. The committed `assembleDebug` is the verification artifact; release signing is Phase 6. SDK target is **36** — the Capacitor 8 scaffold writes `compileSdk`/`targetSdk` 36 and it builds clean here (platforms android-36 + build-tools 36.0.0 are installed). Keep 36; do NOT downgrade. The explicit AGP/Gradle version pin in `android/variables.gradle` is a tracked Phase-6 follow-up.

- [ ] **Step 1: Write the failing test**

Create `mobile/scaffold.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const p = (rel) => fileURLToPath(new URL(rel, import.meta.url));

describe('android scaffold + secret hygiene', () => {
  it('android Gradle project exists', () => {
    expect(existsSync(p('./android/settings.gradle'))).toBe(true);
    expect(existsSync(p('./android/app/build.gradle'))).toBe(true);
  });
  it('ships placeholder-only templates (REPLACE_ME, no key material)', () => {
    for (const t of [
      './google-services.json.example',
      './keystore.properties.example',
      './.env.example',
    ]) {
      expect(existsSync(p(t))).toBe(true);
      const body = readFileSync(p(t), 'utf8');
      expect(body).toMatch(/REPLACE_ME/);
      expect(body).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
      expect(body).not.toMatch(/"private_key"\s*:\s*"-----/);
    }
  });
  it('does NOT commit real secrets', () => {
    expect(existsSync(p('./android/app/google-services.json'))).toBe(false);
    expect(existsSync(p('./keystore.properties'))).toBe(false);
  });
  it('mobile/.gitignore ignores secrets and negates templates', () => {
    const gi = readFileSync(p('./.gitignore'), 'utf8');
    expect(gi).toMatch(/google-services\.json/);
    expect(gi).toMatch(/keystore\.properties/);
    expect(gi).toMatch(/!\*\*\/\*\.example/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase2/mobile && npm test -- scaffold`
Expected: FAIL — no `android/`, no templates, no `mobile/.gitignore`.

- [ ] **Step 3: Generate the native project + write templates/gitignore**

Generate `mobile/android/` (Capacitor CLI is local; native commands need the Android env):
```bash
cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase2/mobile
source ~/.android-env
npm run build                                   # ensure mobile/dist exists (webDir)
npx @capacitor/cli add android                  # creates ./android/
npx @capacitor/cli sync android                 # copy dist + plugins into android/
```

Create `mobile/google-services.json.example` (placeholder only):
```json
{
  "project_info": {
    "project_number": "REPLACE_ME",
    "project_id": "REPLACE_ME",
    "storage_bucket": "REPLACE_ME.appspot.com"
  },
  "client": [
    {
      "client_info": {
        "mobilesdk_app_id": "REPLACE_ME",
        "android_client_info": { "package_name": "io.jaghelm.app" }
      },
      "api_key": [{ "current_key": "REPLACE_ME" }],
      "services": { "appinvite_service": { "other_platform_oauth_client": [] } }
    }
  ],
  "configuration_version": "1"
}
```

Create `mobile/keystore.properties.example` (placeholder only):
```properties
# Copy to keystore.properties (gitignored) and fill in for a local signed build.
# CI injects these from GitHub Actions secrets instead (Phase 6).
storeFile=REPLACE_ME/jaghelm-release.jks
storePassword=REPLACE_ME
keyAlias=REPLACE_ME
keyPassword=REPLACE_ME
```

Create `mobile/.env.example` (placeholder only):
```dotenv
# Mobile build-time env (copy to mobile/.env, gitignored). No secrets here today;
# the backend URL + token are entered at first-run and stored in the Keystore.
VITE_JAGHELM_DEFAULT_BASE_URL=REPLACE_ME
```

Create `mobile/.gitignore`:
```gitignore
# Build output
dist/
node_modules/

# Capacitor / Android build artifacts
android/app/build/
android/build/
android/.gradle/
android/local.properties
android/capacitor-cordova-android-plugins/

# Secrets — NEVER commit (public repo). Templates negated below.
android/app/google-services.json
google-services.json
keystore.properties
android/key.properties
**/*.keystore
**/*.jks
.env

# Template negations — committed *.example placeholders MUST survive the globs
!**/*.example
!**/*.example.json
```

Append to the repo-root `.gitignore` (the Phase-0 negations already exist — only ADD the mobile build/secret paths; do not remove anything):
```gitignore

# mobile build artifacts + native secrets (Phase 2)
mobile/dist/
mobile/node_modules/
mobile/android/app/build/
mobile/android/build/
mobile/android/.gradle/
mobile/android/local.properties
mobile/android/app/google-services.json
mobile/keystore.properties
mobile/android/key.properties
```

- [ ] **Step 4: Verify the native build + run scaffold test + secret scan**

```bash
cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase2/mobile && source ~/.android-env
(cd android && ./gradlew assembleDebug)
ls -la android/app/build/outputs/apk/debug/app-debug.apk    # MUST exist
npm test -- scaffold
cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase2 && python3 scripts/secret-scan.py
```
Expected: `BUILD SUCCESSFUL`; `app-debug.apk` present; scaffold test PASS; `secret-scan.py` reports no findings (templates contain only `REPLACE_ME`).

- [ ] **Step 5: Stage only safe android files (exclude build output + secrets) and commit**

```bash
cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase2
# Confirm git is NOT about to track build output or secrets:
git add -n mobile/android | grep -E 'app/build/|\.gradle/|local\.properties|google-services\.json$|\.keystore$|\.jks$' && echo "ABORT: secret/build staged" || echo "clean"
git add mobile/android mobile/.gitignore mobile/google-services.json.example mobile/keystore.properties.example mobile/.env.example mobile/scaffold.test.js .gitignore
git status --short | grep -E 'google-services\.json$|\.keystore$|\.jks$|keystore\.properties$|app/build/' && echo "ABORT" || git commit -m "feat(mobile): committed android project + .example templates + .gitignore (no secrets)"
```
Expected: the grep guards print nothing (no secret/build files staged); commit succeeds.

---

## Task 9: First-run connect screen + boot gate

**Files:**
- Create: `mobile/src/connect.js`
- Create: `mobile/src/FirstRun.jsx`
- Create: `mobile/src/FirstRun.css`
- Modify: `mobile/src/main.jsx` (boot gate: `bootMobile()` → render `FirstRun` or `MobileApp`)
- Test: `mobile/src/connect.test.js`
- Test: `mobile/src/FirstRun.test.jsx`

**Interfaces:**
- Consumes: `@shared/api/client.js` `apiFetch`, `setAuthToken`; `@shared/api/baseUrl.js` `setApiBase`; `mobile/src/runtimeConfig.js` `normalizeBaseUrl`/`validateFirstRun`/`BASE_URL_KEY`/`TOKEN_KEY`/`URL_PRESENT_KEY`; `mobile/src/storage/keystoreAdapter.js` `keystoreAdapter`; `mobile/src/storage/prefsAdapter.js` `setPref`; `mobile/src/boot.js` `bootMobile`.
- Produces:
  - `testConnection({ url, token }): Promise<{ ok: boolean, status?: number, error?: string }>` — sets the candidate base + token, calls `apiFetch(`${base}/auth/check`)`, returns `ok` on a 2xx.
  - `<FirstRun onConnected={fn} />` — URL + token inputs, "Test & Connect" button; on success persists token+URL to the Keystore, URL-presence to Preferences, `setApiBase()`, then calls `onConnected()`.
  - `main.jsx` boot gate: render `<FirstRun/>` when `bootMobile()` returns `{ configured: false }`, else `<MobileApp configured/>`.

> RATIONALE (resolved ambiguity): "Test & Connect" validates against `${base}/auth/check` (the same endpoint desktop `App.jsx` uses for the auth probe) — a 2xx means the URL is reachable and the token is accepted (or auth is disabled). The token + URL are written to the Keystore (secrets), and a non-secret `URL_PRESENT_KEY` breadcrumb is written to Preferences so subsequent cold starts skip first-run without a Keystore read in the render path. `setAuthToken` keeps `apiFetch`'s in-memory token live for the rest of the session.

- [ ] **Step 1: Write the failing tests**

Create `mobile/src/connect.test.js`:
```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const apiFetch = vi.fn();
const setAuthToken = vi.fn();
const setApiBase = vi.fn();
vi.mock('@shared/api/client.js', () => ({ apiFetch, setAuthToken }));
vi.mock('@shared/api/baseUrl.js', () => ({ setApiBase }));

import { testConnection } from './connect.js';

beforeEach(() => {
  apiFetch.mockReset();
  setAuthToken.mockReset();
  setApiBase.mockReset();
});

describe('testConnection', () => {
  it('returns ok on a 2xx from /auth/check', async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200 });
    const r = await testConnection({ url: 'http://h:3099', token: 'tok' });
    expect(setApiBase).toHaveBeenCalledWith('http://h:3099/api');
    expect(setAuthToken).toHaveBeenCalledWith('tok');
    expect(apiFetch).toHaveBeenCalledWith('http://h:3099/api/auth/check');
    expect(r.ok).toBe(true);
  });
  it('returns not-ok with the status on a non-2xx', async () => {
    apiFetch.mockResolvedValue({ ok: false, status: 401 });
    const r = await testConnection({ url: 'http://h:3099', token: 'bad' });
    expect(r).toEqual({ ok: false, status: 401, error: 'HTTP 401' });
  });
  it('returns not-ok with an error on a network failure', async () => {
    apiFetch.mockRejectedValue(new Error('Network down'));
    const r = await testConnection({ url: 'http://h:3099', token: 'tok' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Network down/);
  });
  it('returns not-ok on an invalid url without calling fetch', async () => {
    const r = await testConnection({ url: 'nope', token: 'tok' });
    expect(r.ok).toBe(false);
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
```

Create `mobile/src/FirstRun.test.jsx`:
```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const testConnection = vi.fn();
vi.mock('./connect.js', () => ({ testConnection }));

const setItem = vi.fn().mockResolvedValue(undefined);
vi.mock('./storage/keystoreAdapter.js', () => ({ keystoreAdapter: { setItem } }));

const setPref = vi.fn().mockResolvedValue(undefined);
vi.mock('./storage/prefsAdapter.js', () => ({ setPref }));

import FirstRun from './FirstRun.jsx';

beforeEach(() => {
  testConnection.mockReset();
  setItem.mockReset().mockResolvedValue(undefined);
  setPref.mockReset().mockResolvedValue(undefined);
});

describe('FirstRun', () => {
  it('shows validation errors and does not test on bad input', async () => {
    render(<FirstRun onConnected={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /test & connect/i }));
    expect(await screen.findByText(/valid http/i)).toBeInTheDocument();
    expect(testConnection).not.toHaveBeenCalled();
  });

  it('on success writes token+URL to Keystore, URL-presence to Prefs, calls onConnected', async () => {
    testConnection.mockResolvedValue({ ok: true, status: 200 });
    const onConnected = vi.fn();
    render(<FirstRun onConnected={onConnected} />);
    fireEvent.change(screen.getByLabelText(/backend url/i), {
      target: { value: 'http://vm-101:3099' },
    });
    fireEvent.change(screen.getByLabelText(/access token/i), {
      target: { value: 'tok123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /test & connect/i }));

    await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1));
    expect(setItem).toHaveBeenCalledWith('jaghelm-token', 'tok123');
    expect(setItem).toHaveBeenCalledWith('jaghelm-base-url', 'http://vm-101:3099/api');
    expect(setPref).toHaveBeenCalledWith('jaghelm-base-url-present', 'true');
  });

  it('on failure shows an error and does NOT persist or proceed', async () => {
    testConnection.mockResolvedValue({ ok: false, status: 401, error: 'HTTP 401' });
    const onConnected = vi.fn();
    render(<FirstRun onConnected={onConnected} />);
    fireEvent.change(screen.getByLabelText(/backend url/i), {
      target: { value: 'http://vm-101:3099' },
    });
    fireEvent.change(screen.getByLabelText(/access token/i), {
      target: { value: 'bad' },
    });
    fireEvent.click(screen.getByRole('button', { name: /test & connect/i }));

    expect(await screen.findByText(/HTTP 401/)).toBeInTheDocument();
    expect(setItem).not.toHaveBeenCalled();
    expect(onConnected).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase2/mobile && npm test -- connect FirstRun`
Expected: FAIL — `connect.js` / `FirstRun.jsx` do not exist.

- [ ] **Step 3: Write minimal implementation**

Create `mobile/src/connect.js`:
```js
/**
 * Test & Connect: validates + canonicalizes the backend URL, sets it as the
 * active base + token, and probes ${base}/auth/check via apiFetch (native HTTP).
 * A 2xx means the host is reachable and the token is accepted (or auth disabled).
 */
import { apiFetch, setAuthToken } from '@shared/api/client.js';
import { setApiBase } from '@shared/api/baseUrl.js';
import { normalizeBaseUrl } from './runtimeConfig.js';

export async function testConnection({ url, token }) {
  let base;
  try {
    base = normalizeBaseUrl(url);
  } catch {
    return { ok: false, error: 'Enter a valid http(s) backend URL' };
  }
  setApiBase(base);
  setAuthToken(token);
  try {
    const r = await apiFetch(`${base}/auth/check`);
    if (!r.ok) return { ok: false, status: r.status, error: `HTTP ${r.status}` };
    return { ok: true, status: r.status };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}
```

Create `mobile/src/FirstRun.css`:
```css
.firstrun {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: calc(env(safe-area-inset-top) + var(--space-8)) var(--space-5) var(--space-5);
  min-height: 100vh;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: var(--font-body);
}
.firstrun h1 {
  font-family: var(--font-display);
  font-size: var(--text-2xl);
  margin: 0;
}
.firstrun label {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  font-size: var(--text-sm);
  color: var(--text-secondary);
}
.firstrun input {
  background: var(--bg-card-inner);
  border: 1px solid var(--border-color);
  border-radius: var(--card-radius-sm);
  color: var(--text-primary);
  padding: var(--space-3);
  font-size: var(--text-base);
}
.firstrun button {
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: var(--card-radius-sm);
  padding: var(--space-4);
  font-size: var(--text-lg);
}
.firstrun .err {
  color: var(--red);
  font-size: var(--text-sm);
}
.firstrun .note {
  color: var(--text-muted);
  font-size: var(--text-sm);
}
```

Create `mobile/src/FirstRun.jsx`:
```jsx
import React, { useState } from 'react';
import { testConnection } from './connect.js';
import { validateFirstRun, normalizeBaseUrl, BASE_URL_KEY, TOKEN_KEY, URL_PRESENT_KEY } from './runtimeConfig.js';
import { keystoreAdapter } from './storage/keystoreAdapter.js';
import { setPref } from './storage/prefsAdapter.js';
import './FirstRun.css';

export default function FirstRun({ onConnected }) {
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setServerError('');
    const v = validateFirstRun({ url, token });
    setErrors(v.errors);
    if (!v.ok) return;

    setBusy(true);
    const result = await testConnection({ url, token });
    setBusy(false);
    if (!result.ok) {
      setServerError(result.error || `HTTP ${result.status}`);
      return;
    }
    // Success: persist secrets to the Keystore, presence breadcrumb to Preferences.
    const base = normalizeBaseUrl(url);
    await keystoreAdapter.setItem(TOKEN_KEY, token.trim());
    await keystoreAdapter.setItem(BASE_URL_KEY, base);
    await setPref(URL_PRESENT_KEY, 'true');
    onConnected();
  };

  return (
    <form className="firstrun" onSubmit={onSubmit}>
      <h1>Connect to JagHelm</h1>
      <label>
        Backend URL
        <input
          type="url"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          placeholder="http://vm-101:3099"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </label>
      {errors.url && <span className="err">{errors.url}</span>}
      <label>
        Access token
        <input
          type="password"
          autoCapitalize="none"
          autoCorrect="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </label>
      {errors.token && <span className="err">{errors.token}</span>}
      <button type="submit" disabled={busy}>
        {busy ? 'Connecting…' : 'Test & Connect'}
      </button>
      {serverError && <span className="err">{serverError}</span>}
      <p className="note">
        Your backend must be reachable on the tailnet. The URL and token are stored
        in the Android Keystore — never in plain storage.
      </p>
    </form>
  );
}
```

Replace `mobile/src/main.jsx` (boot gate):
```jsx
import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import MobileApp from './MobileApp.jsx';
import FirstRun from './FirstRun.jsx';
import { bootMobile } from './boot.js';
import '@shared/styles/global.css';
import './styles/fonts.css';

function Root({ initialConfigured }) {
  const [configured, setConfigured] = useState(initialConfigured);
  if (!configured) return <FirstRun onConnected={() => setConfigured(true)} />;
  return <MobileApp configured={configured} />;
}

bootMobile().then(({ configured }) => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <Root initialConfigured={configured} />
    </React.StrictMode>
  );
});
```

- [ ] **Step 4: Run tests + full mobile suite + build**

```bash
cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase2/mobile
npm test -- connect FirstRun     # the new suites
npm test                          # ALL mobile units green
npm run build                     # vite build → mobile/dist
```
Expected: connect + FirstRun suites PASS; full mobile suite green; build succeeds.

- [ ] **Step 5: Re-verify the native build after the gate wiring**

```bash
cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase2/mobile && source ~/.android-env
npx @capacitor/cli sync android
(cd android && ./gradlew assembleDebug)
ls -la android/app/build/outputs/apk/debug/app-debug.apk
```
Expected: `BUILD SUCCESSFUL`; `app-debug.apk` exists.

- [ ] **Step 6: Commit**

```bash
cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase2
git add mobile/src/connect.js mobile/src/connect.test.js mobile/src/FirstRun.jsx mobile/src/FirstRun.css mobile/src/FirstRun.test.jsx mobile/src/main.jsx
git commit -m "feat(mobile): first-run Test & Connect screen + boot gate (token→Keystore)"
```

---

## Task 10: Harness ledger — Phase 2 captures (honest numbers)

**Files:**
- Modify: `.harness-ledger.md`
- Test: `mobile/ledger.test.js` (asserts the Phase 2 rows + honesty markers exist)

**Interfaces:**
- Consumes: nothing.
- Produces: an updated `.harness-ledger.md` with Phase 2 capture rows.

> RATIONALE: the existing ledger tracks data-layer gaps. Phase 2 adds: (1) the CDN→local-font migration (closes a `font-src 'self'` gap the desktop `index.html` still has — captured, not promoted, since desktop is out of mobile scope); (2) the deferred SDK-36/AGP-pin (built on SDK 35 — honest "built on 35, 36 deferred to Phase 6"); (3) the deferred `@shared`→workspace-package ADR; (4) native-HTTP-default rationale as `context`/`gc` evidence. All with honest numbers (e.g. "verified: `assembleDebug` produced app-debug.apk; release signing NOT verified — Phase 6").

- [ ] **Step 1: Write the failing test**

Create `mobile/ledger.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ledger = readFileSync(
  fileURLToPath(new URL('../.harness-ledger.md', import.meta.url)),
  'utf8'
);

describe('harness ledger — Phase 2 captures', () => {
  it('records the Phase 2 mobile scaffold section', () => {
    expect(ledger).toMatch(/Phase 2/);
  });
  it('records the SDK-36 build + deferred AGP/Gradle version pin', () => {
    expect(ledger).toMatch(/SDK 36/);
    expect(ledger).toMatch(/Phase 6/);
  });
  it('records the CDN→local-font migration', () => {
    expect(ledger).toMatch(/local/i);
    expect(ledger).toMatch(/font/i);
  });
  it('records the deferred @shared → workspace-package ADR', () => {
    expect(ledger).toMatch(/@shared/);
    expect(ledger).toMatch(/workspace package/i);
  });
  it('states verification was DEBUG-only (release signing not verified)', () => {
    expect(ledger).toMatch(/app-debug\.apk/);
    expect(ledger).toMatch(/release signing/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase2/mobile && npm test -- ledger`
Expected: FAIL — ledger has no Phase 2 section.

- [ ] **Step 3: Write minimal implementation — append to `.harness-ledger.md`**

Append this section to `.harness-ledger.md` (after the existing content; do not edit prior rows):
```markdown

---

# Phase 2 — Mobile scaffold + shell (captures)

Honest numbers: the mobile app builds a **DEBUG** APK here (`mobile/android/app/build/outputs/apk/debug/app-debug.apk` produced via `./gradlew assembleDebug`). **Release signing is NOT verified in Phase 2** — keystore + signed APK are Phase 6 (human secret). On-device runtime is the human's phone (no emulator here).

## #2 — desktop index.html still loads fonts from a CDN (context, not promoted)

- **Pillar:** legibility / autonomy
- **File:** `index.html` (desktop root) — `fonts.googleapis.com` + `fonts.gstatic.com` `<link>`.
- **Gap:** desktop fonts are CDN-hosted; mobile REQUIRES `font-src 'self'`, so Phase 2 **bundles the three families locally** (`mobile/src/fonts/*.woff2`, `mobile/src/styles/fonts.css`) and the mobile CSP is tight. The desktop CDN font link is intentionally untouched (desktop is out of mobile scope and its server CSP already allows the Google Fonts origins).
- **Residual:** if desktop ever wants offline/CSP-tight fonts, reuse `mobile/src/styles/fonts.css`.
- **Status:** OPEN (desktop), CLOSED for mobile.

## #3 — SDK 36 (scaffold default) builds here; AGP/Gradle version pin deferred to Phase 6

- **Pillar:** verification / enforcers
- **Note:** the Capacitor 8 scaffold writes compile/target **SDK 36** (matching DESIGN.md "Toolchain / SDK" preference). The build host has platforms android-36 + build-tools **36.0.0** installed, and `assembleDebug` builds clean on 36 with the full plugin set (`@capacitor/app`, `@capacitor/preferences`, `capacitor-secure-storage-plugin` → `androidx.security:security-crypto`). What remains is pinning explicit AGP / Gradle / Kotlin versions in `android/variables.gradle` for reproducible *release* builds — a tracked **Phase 6** follow-up.
- **Verified:** `assembleDebug` → `app-debug.apk` on SDK 36 (debug only; release signing is Phase 6).
- **Status:** OPEN (AGP/Gradle pin → Phase 6).

## #4 — @shared alias, not an extracted workspace package (deferred ADR)

- **Pillar:** gc / context
- **Gap:** mobile reuses `src/` via a single Vite `@shared` alias rather than an internal `@jaghelm/data-layer` workspace package. Promoting it forces a desktop-side import refactor for zero immediate benefit.
- **Promotion rule (ADR):** promote `@shared` → internal workspace package when a third consumer appears.
- **Status:** OPEN (tracked, intentional).

## #5 — native-HTTP-default transport (context/gc evidence)

- **Pillar:** context / autonomy
- **Note:** transport default is Capacitor native HTTP (`CapacitorHttp.enabled: true`) — bypasses CORS, reads ETag, needs ZERO server/CSP change. The Express `CORS_ORIGIN` + `CSP_CONNECT_EXTRA` env path is the documented FALLBACK only (and widens reachable origins — `https://localhost` is attacker-spoofable from non-browser clients; bounded by the custom `x-auth-token` header / non-credentialed CORS). Decision is explicit and testable via `mobile/src/nativeHttp.js`.
- **Status:** RESOLVED (documented decision).
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase2/mobile && npm test -- ledger`
Expected: PASS (all Phase 2 ledger-row assertions green).

- [ ] **Step 5: Final full-suite + secret-scan gate**

```bash
cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase2/mobile && npm test     # ALL mobile units green
cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase2 && python3 scripts/secret-scan.py   # no findings
git status --short    # no untracked secrets; templates tracked
```
Expected: full mobile suite green; `secret-scan.py` clean.

- [ ] **Step 6: Commit**

```bash
cd /home/ilaaj-agent/worktrees/jaghelm-mobile-phase2
git add .harness-ledger.md mobile/ledger.test.js
git commit -m "docs(harness): Phase 2 ledger captures (local fonts, SDK-35 pin, @shared ADR, native-HTTP)"
```

---

## Pre-Done Gate (HARD RULE — not optional)

After Task 10, before declaring Phase 2 done:

- [ ] Run `/simplify` over the Phase 2 diff; apply reuse/altitude cleanups.
- [ ] Run `/security-review` over the Phase 2 diff; address findings (focus: no secret committed, token never in `localStorage`/Preferences, CSP tight, no `server.url`/`cleartext`).
- [ ] Push the branch and open a PR to `main` for **Jag** to review + merge. NEVER push to main / merge the PR yourself.

---

## Self-Review

**1. Spec coverage (vs Phase 2 bullet, DESIGN.md line 784):**

| Phase 2 deliverable | Task(s) |
|---|---|
| `jaghelm/mobile/` own Vite config + package.json | Task 1 |
| `@shared` alias onto `src/` data layer | Task 1 (+ aliasSmoke test) |
| `capacitor.config.ts` with `CapacitorHttp` enabled, appId/name | Task 5 |
| `mobile/src/nativeHttp.js` default transport | Task 4 |
| boot: `setStorageAdapter` Keystore + `setApiBase` from stored config | Task 4 (`bootMobile`) |
| `MobileApp.jsx` bottom-tab shell (Overview/Services/Infra/Alerts) | Task 6 (IA pinned in `TABS.js`) |
| theme-token reuse from existing app | Task 1 (`@shared/styles/global.css`) + Task 6/9 CSS uses `var(--*)` |
| locally-bundled fonts (no CDN) | Task 7 |
| edge-to-edge + safe-area / `insetsHandling` | Task 5 (config) + Task 6 CSS (`env(safe-area-inset-*)`) |
| hardware-back handling | Task 6 |
| tight mobile CSP meta (`connect-src 'self'`) | Task 7 |
| First-run: URL + token + Test & Connect; token→Keystore; URL+theme+last-tab via Preferences | Task 9 (token+URL→Keystore; URL-presence/theme/last-tab→Preferences via Task 3/6) |
| `android/` via `cap add android`, committed-minus-secrets, verified `assembleDebug` | Task 8 |
| `.gitignore` + `.example` templates, placeholders only, template-tracked, no secrets | Task 8 |
| harness `.harness-ledger.md` Phase 2 captures, honest numbers | Task 10 |

No gaps: every sub-bullet of line 784 maps to a task. (Note: the spec lists theme/last-tab/backend-URL via Preferences AND token+URL via Keystore — resolved by storing the SECRET URL in the Keystore and a non-secret URL-PRESENCE breadcrumb + theme + last-tab in Preferences. Theme persistence wiring beyond the breadcrumb is exercised by the reused desktop theme effect over `global.css`; a mobile theme PICKER is Phase 3/5 settings scope, not Phase 2.)

**2. Placeholder scan:** No "TBD/TODO/implement later/handle edge cases/similar to Task N" in any code step — every code block is complete. The only `REPLACE_ME` strings are the REQUIRED literal placeholders inside `.example` templates (and the scaffold test asserts they contain `REPLACE_ME` and NO key material). The font-download step gives a concrete, runnable `npm pack @fontsource/*` extraction procedure (no "download appropriate fonts" hand-wave).

**3. Type consistency across tasks:**
- `keystoreAdapter` shape (`getItem`/`setItem`/`removeItem`, all `Promise`) is identical in Task 3 (def), Task 4 (`bootMobile` consumes `getItem`), and Task 9 (`FirstRun` consumes `setItem`). ✔
- Storage-key constants `BASE_URL_KEY='jaghelm-base-url'`, `TOKEN_KEY='jaghelm-token'`, `LAST_TAB_KEY='jaghelm-last-tab'`, `URL_PRESENT_KEY='jaghelm-base-url-present'` defined once in Task 2 and consumed verbatim in Tasks 4/6/9. ✔ (`TOKEN_KEY` matches `client.js` `initAuthToken()`'s `'jaghelm-token'`.)
- `normalizeBaseUrl` always returns `<origin>/api`; `testConnection` (Task 9) hits `${base}/auth/check` and `apiFetch`'s `url.startsWith(getApiBase())` guard (from the merged `client.js`) therefore injects `x-auth-token`. ✔
- `bootMobile(): Promise<{configured}>` (Task 4) is consumed by `main.jsx` (Task 9) which passes `configured` to `<MobileApp configured/>` (Task 6 prop) and renders `<FirstRun onConnected/>` (Task 9). ✔
- `TABS` ids (`overview/services/infra/alerts`) match `VIEWS` keys in `MobileApp.jsx` and the `LAST_TAB_KEY` round-trip. ✔
- `setApiBase`/`setAuthToken`/`initAuthToken`/`apiFetch`/`setStorageAdapter` signatures match the merged Phase-1 seams exactly (verified against the worktree). ✔

**Resolved spec ambiguities (recorded for the implementer):**
1. **SDK 36 vs available 35** — build on 35 (highest installed build-tools), 36 pin deferred to Phase 6 (ledger #3).
2. **`android/` committed vs gitignored** — committed minus secrets (DESIGN.md layout line 77), build output + secrets gitignored (Task 8).
3. **Backend URL storage (Keystore vs Preferences)** — the SECRET URL → Keystore (`BASE_URL_KEY`); a non-secret presence breadcrumb → Preferences (`URL_PRESENT_KEY`), so cold-start first-run gating needs no Keystore read in render.
4. **`installNativeHttp()` semantics** — native HTTP is enabled declaratively in `capacitor.config.ts`; the JS function is an explicit, testable marker/seam (no JS toggle exists), keeping the default-transport decision legible.
5. **Capacitor CLI invocation** — local dep via `npx @capacitor/cli` (no global `cap`); all native steps prefix `source ~/.android-env`.
6. **Fonts** — desktop uses CDN; mobile bundles latin `.woff2` from Fontsource (OFL/Apache-2.0) with family names matching the desktop tokens.
