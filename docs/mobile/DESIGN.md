# JagHelm Mobile — Design Spec

## Context

JagHelm today is a **desktop-first** self-hosted homelab dashboard: Vite 8 + React 19 + Express 4, served as one unit. Its UI is a 24-column drag-and-drop grid that, on a phone, collapses into a single cramped column — the drag affordances, the 13 settings tabs, and the dense grid are all hostile to a small screen. There is no working push, so "is anything on fire?" requires opening a browser and squinting.

The goal is a **mobile-first, monitor-on-the-go native Android app** with working push, that **reuses the existing backend and data layer** rather than reimplementing it. It is delivered as a Capacitor-wrapped, brand-new mobile-first React UI (NOT React Native, NOT a wrapper of the desktop SPA) that imports the same `apiFetch` / `useData` data layer and talks to the same Express backend over Tailscale. Deep configuration stays on the desktop web app; the mobile app is for watching, triaging, and light actions (open / mute).

## Goals & Non-Goals

**Goals**
- Mobile-first Android app for at-a-glance health: status / health / alerts / metrics across services, nodes, UPS, cron.
- Working push (FCM) originated by the backend on real state changes.
- User-controllable **notification preferences** (per-category on/off + a recoveries toggle + master switch), filtered **server-side** so muted categories are never sent. Push is **edge-triggered** (state changes only — a cron that succeeds every 15 min never notifies).
- Reuse the existing data layer (`src/api/client.js` `apiFetch`, `src/hooks/useData.js`), auth (`x-auth-token` header + token in storage), and the Express backend. Rebuild **presentation only**.
- Generic / OSS-friendly: any self-hoster can build and run it; push is optional and self-disables with no FCM creds.
- Distributed as a **signed APK, sideloaded** (no Play Store).
- Onboard to the portfolio harness discipline; harden the secret floor **before** any secret-adjacent code lands (public repo).

**Non-Goals**
- No React Native; no reuse/wrapping of the desktop grid UI.
- No deep configuration (the 13 desktop settings tabs stay on desktop web).
- No Cloudflare-Access 2FA path in the app (2FA in a WebView is painful) — access is over Tailscale.
- No Play Store distribution.
- No hardcoded tailnet / node identities; backend URL is configured at first-run.
- No extraction of the data layer into a shared package yet (relative `@shared` alias now; promote later).
- **Mute is descoped from v1** (see "Light Actions" below) — v1 ships **Open** only; Mute is a tracked follow-up with a defined design, not shipped in the mockups' wired state.

## UX & Information Architecture

Locked via mockups. **Bottom-tab nav: Overview / Services / Infra / Alerts.**

- **Overview** — health hero is a **subsystem strip** (Services / Nodes / UPS / Cron cells; green = calm, red = degraded; the cell card is alarm-tinted when degraded). Active incidents render **expanded inline** (cause + 24h uptime spark + **Open**); multiple incidents collapse behind "+N more". Below, compact node rows with CPU / MEM bars.
- **Services** — a **flat list sorted problems-first**, each row tagged with its node (services are organized per node: `vm-101`, `vm-103`, `gateway-pi`). Filter chips (All / Down / per-node), search, tap to detail. **Icons resolve via a base-aware resolver (see Icon Rendering §)** — never a relative `/api/icons/cached`.
- **Infra** — compact **node cards** (name, type, CPU / MEM / DISK, or TEMP for the Pi, "N up / M down"); tap to node detail with the full service list for that node.
- **Alerts** — push history grouped by day; the active incident is pinned red at top; tap to incident detail.
- **Incident detail** — full screen: status, node, cause, 24h uptime, event timeline (including "push sent"), **Open**.
- **First-run** — backend URL + access token, Test & Connect, tailnet note; both values stored in the Android Keystore.
- **Notification settings** — reached from the **Alerts** tab header (gear icon). Per-category toggles (Services / Hosts / UPS / Cron) + a global **"also notify on recovery"** switch + a master push on/off. The only in-app settings surface (deep config stays on desktop). See *Notification preferences* under Push Pipeline.

**Light Actions (v1 = Open only).** "Open" is a deep-link / launch to the underlying service or the desktop view — read-only navigation, no backend write. **Mute is cut from v1**: a Mute that suppresses future push is a stateful, deterministic-differ-coupled write (new authenticated route, persistence, TTL, and an explicit "muted service recovers then re-downs — does it re-fire?" rule) that crosses into notification-policy/config territory. Shipping it half-specified would break the differ's determinism guarantee. It is captured as a tracked follow-up with the full design sketched in "Deferred: Mute" below; the mockups' Mute affordances are disabled/hidden in v1.

**Design language** — reuse the JagHelm tokens from `src/styles/global.css`: One Dark Pro default + 11 themes via `[data-theme]` CSS vars, glassmorphism cards (`backdrop-filter: blur(24px)`), Outfit / DM Sans / JetBrains Mono fonts, glowing status dots (green / red / amber), indigo `#6366f1` accent. Mobile changes **composition, not identity** — same tokens, recomposed for one-hand small-screen use and safe areas. Fonts are **bundled locally** (not CDN) so `font-src 'self'` holds under the WebView CSP.

## Architecture & Data-Layer Reuse

All changes are **additive and default-inert**: with the mobile flags / runtime calls absent, the desktop web app behaves byte-for-byte as today.

### Monorepo layout

Mobile lives in the public repo as a sibling of `src/`, with its **own** Vite build (the root `vite.config.js` is desktop-coupled — `outDir: 'dist'` is what Express serves, `manualChunks` assume dnd-kit/Settings, and `npm run build` runs `scripts/inject-sw-precache.mjs` for a desktop SW). A second config keeps the desktop build untouched while letting mobile reuse `src/` by source.

```
jaghelm/
├── src/                       # EXISTING desktop UI — unchanged
│   ├── api/client.js          # ← REUSED by mobile (apiFetch + base-aware guard)
│   ├── hooks/useData.js       # ← REUSED by mobile (base-aware, incl. icon resolver)
│   ├── api/baseUrl.js         # NEW — configurable API base (web + mobile)
│   ├── storage/index.js       # NEW — storage adapter seam (web default)
│   └── styles/global.css      # ← REUSED tokens/themes
├── server/                    # EXISTING Express backend — unchanged code, + CORS/CSP env + server/push/*
├── vite.config.js             # EXISTING desktop build — UNTOUCHED
├── package.json               # EXISTING + mobile passthrough scripts only
├── mobile/                    # NEW — mobile-first React UI + Capacitor shell
│   ├── package.json           # mobile-only deps (@capacitor/*, FCM plugin, vite, react)
│   ├── vite.config.mobile.js  # separate build → mobile/dist (NOT server-served)
│   ├── capacitor.config.ts    # appId, webDir: 'dist', server.androidScheme
│   ├── index.html             # mobile CSP meta tag (see Capacitor §)
│   ├── src/
│   │   ├── main.jsx
│   │   ├── MobileApp.jsx      # bottom-tab shell: Overview/Services/Infra/Alerts
│   │   ├── runtimeConfig.js   # backend baseUrl resolution
│   │   ├── nativeHttp.js      # Capacitor native-HTTP fetch wiring (default transport)
│   │   ├── storage/keystoreAdapter.js
│   │   ├── storage/prefsAdapter.js   # Capacitor Preferences (non-secret UI state)
│   │   └── views/...          # mobile-only presentation
│   ├── android/               # `npx cap add android` output (committed, minus secrets)
│   ├── google-services.json.example
│   ├── keystore.properties.example
│   └── .env.example
```

**Shared import = one alias, not an extracted package (yet).** `src/api/client.js` and `src/hooks/useData.js` are plain ESM with shallow deps. Mobile's Vite config aliases the desktop `src/` so the reuse seam is a single line:

```js
// mobile/vite.config.mobile.js
resolve: { alias: { '@shared': fileURLToPath(new URL('../src', import.meta.url)) } },
build:   { outDir: 'dist' }, // mobile/dist — Capacitor webDir, NOT server-served
```
```js
import { getServices, getUPSStatus, getCronStatus, getServiceIcon } from '@shared/hooks/useData.js';
import { setAuthToken } from '@shared/api/client.js';
```

Root `package.json` gains passthrough scripts only:
```jsonc
"mobile:dev":   "vite --config mobile/vite.config.mobile.js",
"mobile:build": "vite build --config mobile/vite.config.mobile.js",
"mobile:sync":  "npm run mobile:build && cap sync android --config mobile/capacitor.config.ts"
```

**Why relative-now, package-later:** extracting `src/api` + `src/hooks` into an internal `@jaghelm/data-layer` workspace package is the clean end-state but forces a desktop-side import refactor for zero immediate benefit. **ADR (deferred):** "promote `@shared` → internal workspace package when a third consumer appears" — capture as harness `gc`/`context` evidence.

### Configurable `/api` base URL

The web app uses a relative same-origin `/api`; mobile must hit an absolute Tailscale URL (e.g. `http://vm-101:3099/api`). A single source-of-truth resolver **defaults to `/api`** (web unchanged) and is overridable at runtime (mobile).

Current hardcoded state (verify line cites against the current tree before implementation — see "Ground-truth file references" below): `useData.js` → `const BASE = '/api'` (top of file); `client.js:13` module-load token seed; the protected-route guard is the single block at `client.js:34-47` keying on the literal `'/api'` prefix.

**New `src/api/baseUrl.js`:**
```js
let apiBase =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_JAGHELM_BASE_URL) || '/api';
export function setApiBase(base) { apiBase = (base || '/api').replace(/\/+$/, ''); }
export function getApiBase()     { return apiBase; }
export function isRelativeBase() { return apiBase.startsWith('/'); }
```

- **`useData.js`:** replace `const BASE = '/api'` with `import { getApiBase }` and resolve through it (`const BASE = () => getApiBase()`; ~18 mechanical call sites). Functionally identical on web — `getApiBase()` returns `'/api'`.
- **`client.js`:** make the protected-route guard base-aware so an absolute mobile URL still gets `x-auth-token`:
  ```js
  const base = getApiBase();
  const isApiCall = typeof url === 'string' && url.startsWith(base); // '/api' web OR 'http://host/api' mobile
  if (isApiCall && !url.includes('/auth/login') && authToken) { /* inject x-auth-token */ }
  ```
- **First-run wiring (mobile only):** boot reads the stored base from secure storage and calls `setApiBase()` before any data hook fires. Desktop never calls `setApiBase`, so it keeps `'/api'`.

### Icon Rendering (base-aware — no relative `/api`)

**Ground truth:** `cachedIconUrl()` lives in `src/hooks/useData.js` (returns a hardcoded relative `/api/icons/cached?url=...`) and is called by `getServiceIcon()` in the same file — which resolves the icon for **every** service. `uploadFile()` also lives in `useData.js`. The mockup-locked IA renders icons in the Services flat list, Infra node cards, and Overview node rows, so this is **core presentation, not an edge path**. On the Capacitor origin `https://localhost`, a relative `/api/icons/cached` resolves to `https://localhost/api/icons/cached` (no Express there → every icon 404s), and the base-aware guard would not inject `x-auth-token` for a relative URL against an absolute base anyway. This **must** be fixed.

**Decision (a): route `cachedIconUrl()` through `getApiBase()`** — the same one-line pattern as the rest of the data layer:
```js
// src/hooks/useData.js — cachedIconUrl, base-aware
import { getApiBase } from '../api/baseUrl.js';
export function cachedIconUrl(url) {
  return `${getApiBase()}/icons/cached?url=${encodeURIComponent(url)}`;
}
```
This makes the proxied icon URL absolute and same-base on mobile, so it reaches Express over Tailscale and the auth guard injects `x-auth-token` (the icon route is protected). Web is byte-for-byte identical (`getApiBase()` → `/api`).

**Fallback (b):** if a deployment routes via the env-CORS allow-list and prefers not to proxy, mobile presentation may render icons **directly from the CDN** (already permitted in `connect-src`/`img-src`: `https://cdn.jsdelivr.net`), skipping the proxy. Default is (a).

**`uploadFile()`** stays relative (web-only; mobile does no uploads) — but it is **explicitly captured as a harness gap** (the one remaining raw `/api` literal that bypasses the resolver), with the correct file attribution (`src/hooks/useData.js`, not `client.js`).

### Token storage seam

Current coupling: token/theme read & written through raw `localStorage` (`client.js:13`, `App.jsx`). Introduce a **storage adapter** with an async-shaped interface, default-bound to `localStorage` for web and swapped to Keystore-backed storage for mobile.

**New `src/storage/index.js`** (web default — sync `localStorage` behind an async API so the mobile adapter is a drop-in):
```js
const webStorage = {
  async getItem(k)    { return (typeof localStorage !== 'undefined' && localStorage.getItem(k)) || null; },
  async setItem(k, v) { if (typeof localStorage !== 'undefined') localStorage.setItem(k, v); },
  async removeItem(k) { if (typeof localStorage !== 'undefined') localStorage.removeItem(k); },
};
let impl = webStorage;
export function setStorageAdapter(a) { impl = a; }
export const secureStore = {
  getItem:    (k)    => impl.getItem(k),
  setItem:    (k, v) => impl.setItem(k, v),
  removeItem: (k)    => impl.removeItem(k),
};
```

**Mobile `mobile/src/storage/keystoreAdapter.js`** — wraps a Keystore-backed plugin (`capacitor-secure-storage-plugin`, EncryptedSharedPreferences), since the token + backend URL are secrets:
```js
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';
export const keystoreAdapter = {
  async getItem(k)    { try { return (await SecureStoragePlugin.get({ key: k })).value; } catch { return null; } },
  async setItem(k, v) { await SecureStoragePlugin.set({ key: k, value: String(v) }); },
  async removeItem(k) { await SecureStoragePlugin.remove({ key: k }); },
};
```

**Non-secret UI state (theme, last tab) goes through the Capacitor Preferences plugin** (`mobile/src/storage/prefsAdapter.js`), **never WebView `localStorage`**. Preferences is scheme-independent native storage, so the `androidScheme`-change orphaning risk is **fully eliminated** for all persisted mobile state (not merely "softened" for the token). Plain Preferences is for non-secret state only; secrets always go through the Keystore adapter.

`client.js` and `App.jsx` stop touching `localStorage` directly and go through `secureStore`. The module-load token seed (`client.js:13`) becomes an explicit async init awaited at boot:
```js
import { secureStore } from '../storage/index.js';
let authToken = '';
export async function initAuthToken() { authToken = (await secureStore.getItem('jaghelm-token')) || ''; }
```
- **Mobile boot order:** `setStorageAdapter(keystoreAdapter)` → `await initAuthToken()` → `setApiBase(storedBase)` → render.
- **Web boot:** `await initAuthToken()` with the default adapter — same persisted-session behaviour as today.
- **First-run mobile screen** writes both `jaghelm-base-url` and `jaghelm-token` through the **Keystore** adapter, satisfying the "stored in Android Keystore" requirement; theme/last-tab go through Preferences.

### Transport & CORS (Express)

**Default transport = Capacitor native HTTP (no CORS at all).** Backend calls are routed through Capacitor's native HTTP layer (patched `fetch`/`XHR` leaves native code, not the WebView), which **bypasses CORS entirely**. This is the **default** for three reasons: (1) the OSS backend needs **zero** app-specific config — its CORS posture stays identical to today; (2) native code reads all response headers, so the `exposedHeaders: ['ETag']` concern disappears and `useData.js` `If-None-Match` 304 caching works unmodified; (3) it removes the spoofable-`Origin` widening described below. Wiring lives in `mobile/src/nativeHttp.js`; `connect-src` in the mobile CSP can then stay tight (`'self'`).

**Factual correction:** `cors({ origin: false })` (the unset-`CORS_ORIGIN` state, `server/index.js`) does **not** block the request server-side — `cors` calls `next()` and Express **processes** the request; it merely omits the `Access-Control-Allow-Origin` header, so only the **browser** discards the response. A non-browser client (or a spoofed `Origin`) is unaffected at the server.

**Fallback transport = Express env allow-list.** If a deployment uses the WebView's `fetch` instead of native HTTP, the operator adds the Capacitor origins to the existing env allow-list — **no server code change required**:
```bash
CORS_ORIGIN=https://localhost,capacitor://localhost
```
**Security note (state plainly):** this **widens** the API's reachable origin set. `https://localhost` is **attacker-spoofable** from non-browser clients and trivially set by any local dev server or page that can reach the tailnet host. The practical risk is bounded because auth is the custom `x-auth-token` header (not cookies → non-credentialed CORS, no `credentials: true`), so a cross-origin page cannot read the API without already holding the token. This fallback **must** be paired with the existing token auth (it is). Because auth is a custom header, recommended additive, web-safe pinning so the preflight is deterministic across `cors` versions:
```js
app.use(cors({
  origin: corsOrigins,
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-auth-token', 'If-None-Match'],
  exposedHeaders: ['ETag'], // REQUIRED only on the WebView-fetch fallback — cross-origin JS cannot read
}));                         // ETag by default, which would silently break useData.js If-None-Match 304 caching.
```
With native HTTP (the default), neither `CORS_ORIGIN` nor `exposedHeaders` is needed. **Decide once per deployment; the default is native HTTP.**

### CSP

The server CSP (`server/index.js`) is served with the SPA from the Express origin and governs the **desktop browser**. The Capacitor WebView loads `mobile/dist` from its own `https://localhost` document and does **not** receive the server CSP for that document, so the server CSP does not gate the WebView's `connect-src`. The CSP that matters for mobile is the **meta tag in `mobile/index.html`** (see Capacitor §). One **additive, env-gated** server knob lets a self-hoster extend `connectSrc` without editing source; unset → identical to today:
```js
const extraConnect = (process.env.CSP_CONNECT_EXTRA || '').split(',').map(s => s.trim()).filter(Boolean);
connectSrc: ["'self'", 'https://cdn.jsdelivr.net', 'https://raw.githubusercontent.com', ...extraConnect],
```

## Capacitor Shell & Android

> Grounded against Capacitor 8.x (June 2026). Version-specific gotchas flagged ⚠️.

The Capacitor layer is a **thin native wrapper** around the new mobile-first React bundle in `jaghelm/mobile/` — load the local web bundle into a WebView, expose native capabilities (push, secure storage, native HTTP, deep links, back button, safe areas), and produce a signed sideload APK. Data flows over Tailscale to Express via the reused `apiFetch`, routed through native HTTP by default.

### Init

```bash
# inside jaghelm/mobile/
npm install @capacitor/core @capacitor/cli
npx cap init "JagHelm" "io.jaghelm.app" --web-dir=dist
npm install @capacitor/android
npx cap add android        # creates ./android/
```
`webDir` must contain the compiled bundle's final `index.html` (Vite → `dist/`); a wrong `webDir` fails sync with "Could not find the web assets directory."

**`capacitor.config.ts` (base):**
```typescript
import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'io.jaghelm.app',          // MUST equal the Firebase Android package name (Push §)
  appName: 'JagHelm',
  webDir: 'dist',
  server: { androidScheme: 'https', hostname: 'localhost' },  // set explicitly — see ⚠️ below
  plugins: {
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
    CapacitorHttp: { enabled: true },   // native HTTP = default transport (bypasses CORS)
  },
};
export default config;
```
⚠️ **`appId` is load-bearing** — it is the Android `applicationId` *and* must equal the Firebase-registered package name, or FCM registration silently fails. Pick it once.

### Local-bundle origin: scheme, navigation, transport

- ⚠️ **Default `androidScheme` is `http` (`http://localhost`), NOT `https`** despite some doc examples. Set it **explicitly**. `https://localhost` is a secure-context origin (needed by some web APIs), but ⚠️ **changing the scheme later is like shipping on a different domain** — `localStorage`/IndexedDB/cookies written under one scheme are inaccessible under the other. **We sidestep this entirely:** the token lives in the Keystore and all non-secret state lives in Capacitor Preferences (both scheme-independent native storage), so nothing persisted orphans on a scheme change. Still, **pin the scheme before first release**.
- ⚠️ **Custom (non-`http`/`https`) schemes break routing** (WebView 117+). Keep `androidScheme` to `http`/`https` only.
- **`server.allowNavigation`** — leave empty/minimal. The app is a local bundle that talks to the backend via native HTTP/XHR, not by navigating. Do **not** add the tailnet host (hardcoded node + OSS leak; backend host is runtime-configured).
- **`server.cleartext`** — leave `false`. Tailscale already encrypts transport.
- ⚠️ **Never set `server.url`** in committed config — that's the live-reload escape hatch; it would point production at a dev machine.

### CSP (mobile `index.html`)

Add a `<meta http-equiv="Content-Security-Policy">` to `mobile/index.html`. **CSP is NOT the network enforcement boundary on mobile** (token auth + Tailscale are); a configurable backend host cannot be pinned in a fixed meta tag. Scope `connect-src` honestly to the chosen transport:

- **Native HTTP (default):** native requests bypass the WebView's `connect-src`, so keep it **tight** — `connect-src 'self'`. The Verification claim "the mobile CSP blocks unexpected WebView `connect-src`" holds against this.
- **WebView-fetch fallback:** the backend host is runtime-configured, so a fixed CSP cannot both be generic and pin the host. Use `connect-src 'self' http://*:* https://*:*` and state in the comment that CSP is intentionally **not** the boundary here (token auth + Tailscale are). **Do not use bare `https://*`** as a pretend-tight policy.

```html
<!-- Default (native-HTTP transport): connect-src stays tight; native calls bypass it. -->
<meta http-equiv="Content-Security-Policy"
  content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
           font-src 'self' data:; img-src 'self' data: blob: https://cdn.jsdelivr.net;
           connect-src 'self';">
```
Fonts are **bundled locally**, so `font-src 'self'` holds and no `fonts.googleapis.com` / `fonts.gstatic.com` allowance is needed. Glassmorphism `backdrop-filter` and the theme CSS need **no** CSP relaxation. If the WebView-fetch fallback is chosen, widen `connect-src` to `'self' http://*:* https://*:*` with the honest "not the boundary" note; if CDN icons are used (Icon fallback b), keep `https://cdn.jsdelivr.net` in `img-src`/`connect-src`.

### Build chain

```bash
# from jaghelm/mobile/
npm run build          # vite build -> dist/ (webDir)
npx cap sync android   # copy web assets + config + refresh native plugin deps
# release (one-shot, signed):
npx cap build android --androidreleasetype APK \
  --keystorepath "$KEYSTORE_PATH" --keystorepass "$KEYSTORE_PW" \
  --keystorealias "$KEY_ALIAS"   --keystorealiaspass "$KEY_ALIAS_PW" \
  --signing-type apksigner
```
- `cap sync` = `cap copy` (assets + config) **plus** `cap update` (plugin deps); use `sync` after any dep/config change, `copy` after a pure web rebuild.
- `npx cap build` is the supported one-shot for a **signed** APK/AAB (keystore via flags or `android.buildOptions`); raw Gradle (`./gradlew assembleRelease`) remains available for CI.
- ⚠️ **Default `releaseType` is `AAB`** — set `APK` for sideload. ⚠️ **Default `signingType` is `jarsigner`** — prefer `apksigner` (v2/v3 signature schemes; matches the SHA-256 fingerprints App Links expect).

### Toolchain / SDK (Capacitor 8) ⚠️

| Item | Value |
|---|---|
| `minSdkVersion` | 24 (Android 7) |
| `compile` / `targetSdkVersion` | **36** |
| Android Gradle Plugin | 8.13.0 |
| Gradle wrapper | 8.14.3 |
| Kotlin | 2.2.20 |
| Android Studio | Otter 2025.2.1+ |
| Node | 22+ |

⚠️ Pin these in `android/variables.gradle` / the Gradle wrapper so CI and Jag's box agree; a stale Firebase/`google-services` classpath vs this AGP/Kotlin toolchain is the top build-break.

### Deep links, hardware back, safe areas

**Deep links** — push-tap routing to the right Incident detail. ⚠️ Verified `https` **App Links** require an `assetlinks.json` at `https://<host>/.well-known/assetlinks.json` containing the APK's SHA-256 signing fingerprint — which is **per-self-hoster** (each builds with their own keystore + backend host). For the generic OSS build, prefer a **custom URL scheme** (`jaghelm://incident/<id>`) for push-tap routing (no domain verification); treat verified `https` App Links as an optional, operator-configured extra. Most navigation is push-driven (`pushNotificationActionPerformed` carries `data`), so the custom scheme covers the primary flow.
```typescript
import { App, type URLOpenListenerEvent } from '@capacitor/app';
App.addListener('appUrlOpen', (e: URLOpenListenerEvent) => routeTo(e.url.split('://').pop()));
```

**Hardware back** — map to the React Router stack; only `exitApp()` at a tab root:
```typescript
App.addListener('backButton', ({ canGoBack }) => { if (atTabRoot()) App.exitApp(); else history.back(); });
```

**Safe areas / edge-to-edge** ⚠️ (the big Capacitor 8 / Android 15 gotcha):
- ⚠️ **Android 15 (SDK 35) enforces edge-to-edge; we compile to SDK 36, so it's mandatory** — content draws under the status/nav bars by default. Status Bar plugin's `overlaysWebView` / `backgroundColor` are **removed on Android 15+**; Capacitor 8 **removed `android.adjustMarginsForEdgeToEdge`** in favor of the new **System Bars** core plugin.
- Lay out the bottom-tab bar and Overview hero with CSS `env(safe-area-inset-*)` so glass cards / tab bar don't collide with the status bar or gesture pill.
- ⚠️ **WebView < 140 bug:** `safe-area-inset-*` values are wrong on older WebViews. Use the **`insetsHandling`** config setting so Capacitor injects correct inset variables regardless of WebView version; verify on a real older device.

## Push Pipeline / FCM

The backend originates push on infrastructure state changes. It plugs into the existing Express background poll (`server/refresh.js` → `runBackgroundRefresh`) and reuses the data the loop already produces. The detector is a **judgment-free deterministic module**: given two snapshots it emits the same event set **in the same canonical order** every time — no model, no heuristics, no wall-clock branching beyond explicit thresholds. Push is **fully optional**: with no FCM service account configured, the whole pipeline self-disables and nothing else is affected.

### Architecture

```
runBackgroundRefresh()  ──▶ refreshServices/refreshUPS/refreshGitea/...   [existing poll, ~30s]
        │  (new, AWAITED, inside the try — after allSettled, before recordRefreshCycle)
        ▼
  await runPushCycle()  ──▶ guarded; self-contained try/catch; can never reject
        ▼
  buildSnapshot(caches)  ──▶ canonical { services, hosts, ups, cron } state map   (PURE)
        ▼
  diffSnapshots(prev,next) ──▶ Event[] (canonically sorted)   server/push/differ.js  (PURE, no I/O)
        ▼
  dispatchEvents(events) ──▶ per event × per registered token   server/push/fcm.js (HTTP v1, Admin SDK)
        ▼
  persist next snapshot → data/push-snapshot.json (completes before cycle ends)
        ▼
  prune UNREGISTERED/INVALID tokens   server/push/tokenStore.js
```

New files under `server/push/` (mirrors the existing `server/<domain>.js` layout):

| File | Responsibility |
|---|---|
| `server/push/snapshot.js` | `buildSnapshot()` — flatten existing caches into a canonical comparable map (keys inserted in sorted order). Pure. |
| `server/push/differ.js` | `diffSnapshots(prev, next, thresholds)` — deterministic differ; returns a **canonically sorted** `Event[]`. Pure, no I/O. |
| `server/push/fcm.js` | FCM HTTP v1 via Firebase Admin SDK; `initPush()`, `isPushEnabled()`, credential bootstrap. |
| `server/push/tokenStore.js` | Device-token registration + persistence + stale-token pruning. |
| `server/push/dispatch.js` | Glue: events → FCM message JSON, per-token fan-out, dead-token pruning, holds + persists the prev-snapshot. |
| `server/routes/push.js` | `POST`/`DELETE /api/push/register`, `GET /api/push/status`. |

### Error-isolation contract (runPushCycle vs runBackgroundRefresh)

`runBackgroundRefresh()` is `async`, `setInterval`-driven, and ends in a `finally` that flips `bgRefreshRunning = false`. The push cycle is wired **awaited, inside the existing try**, after `Promise.allSettled([...])` resolves (so it reads fully-written caches, never half-written state) and **before `recordRefreshCycle`**:
```js
// server/refresh.js — inside runBackgroundRefresh(), in the try, after the allSettled block
await Promise.allSettled([refreshServices(), refreshUPS(), refreshGitea(), refreshIntegrations()]);
await runPushCycle();          // AWAITED: snapshot write completes before the cycle ends; rejections caught here
recordRefreshCycle();
```
`runPushCycle()` is additionally **self-contained**: it wraps its entire body (snapshot → diff → dispatch → persist) in its own `try/catch` and **can never reject** — any FCM HTTP failure or JSON-write error is logged and swallowed, so even if the wiring ever changes, no `unhandledRejection` can escape and crash the serve loop. It returns immediately when `!isPushEnabled()`, so a self-hoster with no FCM creds pays nothing.
```js
export async function runPushCycle() {
  if (!isPushEnabled()) return;        // zero cost when push disabled
  try {
    const next = buildSnapshot(readCaches());
    const events = diffSnapshots(loadPrevSnapshot(), next, thresholds);
    await dispatchEvents(events);
    persistSnapshot(next);             // must complete before return
  } catch (err) { log.warn({ err }, 'push cycle failed — skipped this round'); }
}
```
**Required test:** a thrown error inside `dispatchEvents` does **not** propagate past `runBackgroundRefresh` and does **not** become an `unhandledRejection`; the snapshot is only persisted on a clean cycle.

### Deterministic state-change detection

The detector hooks in as the **last data step of the cycle**, after `Promise.allSettled` resolves and caches are populated — so it sees exactly the data the API serves.

**Snapshot** — reads the just-written caches (`getCached('services')`, `getCached('ups')`) + `cron-store.getAllStatuses()`, projecting into one canonical map keyed by stable IDs that already exist in the data layer (services use the existing `uid` = `nodeKey:container`). **Keys are inserted in sorted order** so iteration order is pinned:
```js
{
  services: { "vm-101:gitea": "up", "vm-103:grafana": "down" },           // monitor?.status || c.status
  hosts:    { "vm-101": { reachable: true,  cpu: 0.42, mem: 0.61, disk: 0.55 },
              "vm-103": { reachable: false, cpu: null, mem: null, disk: null } },
  ups:      { state: "online" },                                          // nut_status → online|on_battery|unknown
  cron:     { "pi2:npm-sync": "success", "vm103:backup": "failure" },     // latest run status per node:job
}
```
> **API name (ground truth):** the cache accessor is `getCached(key)` (`server/cache.js`), **not** `getCache`. Use `getCached`.

Status normalization is explicit and total: Kuma/Docker → `up|down|unknown`; a node whose `refreshServices` outcome was `rejected` (or all-null metrics) → `reachable:false`; NUT → `online|on_battery|unknown`. Anything unrecognized → `unknown` and **never emits** (no false alarms on novel states).

**Differ** — `diffSnapshots(prev, next, thresholds) → Event[]`. No I/O, no `Date.now()`, no randomness. The previous snapshot is held in a module-level var in `dispatch.js` and **persisted to `data/push-snapshot.json`** so a restart doesn't re-fire every active incident as "new". The first cycle after boot establishes a baseline and emits nothing.

**Canonical ordering (REQUIRED for the byte-identical promise).** "Same input ⇒ same event set" is necessary but not sufficient for "byte-identical array": JS object key iteration is insertion-order, and cache-population order across refreshes is not pinned. The differ therefore applies a **total, deterministic sort** to the emitted array before returning:
> **Sort key:** ascending `(type, id)` — string-compare `type`, tiebreak by `id`. This is the canonical order; it is stated here and **asserted in the table-driven test** (the test compares the full serialized array, not a set). `buildSnapshot` also emits sorted keyed maps as belt-and-suspenders. Without this, the "byte-identical array" promise does not hold.

| Domain | Transition | `type` | Severity |
|---|---|---|---|
| Service | `up`/`unknown` → `down` | `service_down` | critical |
| Service | `down` → `up` | `service_recovered` | info |
| Host | `reachable` true → false | `host_unreachable` | critical |
| Host | `reachable` false → true | `host_recovered` | info |
| Host | metric crosses threshold up (`cpu`/`mem`/`disk` ≥ limit, was below) | `host_threshold` | warning |
| Host | metric falls below threshold − hysteresis | `host_threshold_cleared` | info |
| UPS | `online` → `on_battery` | `ups_on_battery` | critical |
| UPS | `on_battery` → `online` | `ups_restored` | info |
| Cron | ok/new → `failure` | `cron_failed` | warning |
| Cron | `failure` → `success` | `cron_recovered` | info |

Each `Event` is a plain serializable record:
```js
{ type: "service_down", id: "vm-103:grafana", node: "vm-103",
  title: "grafana is DOWN", body: "Service grafana on vm-103 is not responding",
  prev: "up", next: "down" }
```

**Determinism guards (by construction):** pure exported function unit-tested with fixture snapshot pairs (same input ⇒ **byte-identical, canonically-sorted** event array, table-driven test covering every row + the no-change → `[]` case + an order-stability case where two unsorted inputs yield identical arrays); thresholds (`{ cpu: 0.90, mem: 0.90, disk: 0.90, hysteresis: 0.05 }`) are explicit config read from `display-config.json`, not magic numbers; hysteresis (the only stateful nuance) lives in the comparison, not in timers; new/removed keys handled by one documented baseline rule; no model call anywhere. This satisfies the determinism-by-construction law — atomic deterministic execution, judgment (thresholds/severities/sort key) lives in config/spec.

### Device-token registration + storage

Mounted behind the same `authMiddleware` as every other write route:
```
POST   /api/push/register     { token, platform: "android", appVersion }
DELETE /api/push/register     { token }            // on logout / push-disable
GET    /api/push/status                            // { enabled: bool } — drives the app's toggle
```
`server/push/tokenStore.js` persists to `data/push-tokens.json` via the existing `atomicWriteFileSync` helper (same pattern as `cron-store.js`):
```json
{ "<fcm-token>": { "platform": "android", "appVersion": "1.0.0",
                   "registeredAt": "2026-06-25T...", "lastSeenAt": "2026-06-25T..." } }
```
`register` upserts + refreshes `lastSeenAt` (idempotent). The client re-registers on app start so active devices stay fresh.

**Token-store privacy & retention.** `data/push-tokens.json` holds FCM **device tokens** (device-identifying, PII-adjacent). It is gitignored via the existing `data/` ignore (verified safe — never committed). Retention policy: per Firebase guidance a token unconnected for **30 days is stale**; `tokenStore` prunes tokens whose `lastSeenAt` is older than 30 days, plus response-driven pruning on `UNREGISTERED`/`INVALID_ARGUMENT` (below). On `DELETE /api/push/register` (logout / push-disable) the token is removed immediately. No token is retained beyond the 30-day stale window without a refresh.

### FCM HTTP v1 send (service account)

Use the Firebase **Admin SDK** (`firebase-admin`, Node) — the recommended path; it manages the OAuth 2.0 access-token mint/refresh internally (signs a JWT with the service-account private key, exchanges it for a short-lived bearer scoped to FCM, caches + refreshes). Reference equivalent: `POST https://fcm.googleapis.com/v1/projects/{projectId}/messages:send`, scope `https://www.googleapis.com/auth/firebase.messaging`.

**Init — guarded so missing/invalid creds degrade to disabled, never crash boot** (called from `boot()` alongside other `init*()`):
```js
import { initializeApp, cert } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
let messaging = null;
export function initPush() {
  const path = process.env.FCM_SERVICE_ACCOUNT || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!path || !existsSync(path)) { log.info('push disabled — no FCM service account'); return; }
  try {
    const sa = JSON.parse(readFileSync(path, 'utf8'));
    initializeApp({ credential: cert(sa), projectId: sa.project_id });
    messaging = getMessaging();
    log.info({ project: sa.project_id }, 'push enabled');
  } catch (err) { log.warn({ err }, 'FCM init failed — push disabled'); }  // never throws into boot()
}
export function isPushEnabled() { return messaging !== null; }
```

**Per-device targeting + message shape** — each event sent per token via the `token` field; the `data` block carries machine-readable fields so the app deep-links straight to Incident detail:
```json
{ "message": {
    "token": "<fcm-registration-token>",
    "notification": { "title": "grafana is DOWN", "body": "Service grafana on vm-103 is not responding" },
    "data": { "type": "service_down", "id": "vm-103:grafana", "node": "vm-103", "severity": "critical" },
    "android": { "priority": "high", "notification": { "channelId": "jaghelm-incidents" } } } }
```
Via the SDK: `messaging.send(message)` or `sendEach([...])` for the per-token fan-out. Critical → `android.priority: "high"`; info/warning → normal priority (battery).

**Stale-token pruning (deterministic, response-driven):** after each send, remove a token when the response is `UNREGISTERED` (404) or `INVALID_ARGUMENT` (400) **and the payload is known-valid** (such tokens are permanently invalid). `dispatch.js` collects those IDs → `tokenStore.remove(token)`. Transient errors (`UNAVAILABLE`, `INTERNAL`) are logged and retried next cycle, not pruned.

### Client registration (Capacitor)

```typescript
import { PushNotifications } from '@capacitor/push-notifications';
async function initPush() {
  let perm = await PushNotifications.checkPermissions();
  if (perm.receive === 'prompt') perm = await PushNotifications.requestPermissions();
  if (perm.receive !== 'granted') return;                 // gracefully disabled
  await PushNotifications.addListener('registration', t => registerDeviceTokenWithBackend(t.value));
  await PushNotifications.addListener('registrationError', e => console.error('FCM reg error', e.error));
  await PushNotifications.addListener('pushNotificationReceived', n => { /* in-app toast */ });
  await PushNotifications.addListener('pushNotificationActionPerformed', n => routeToIncident(n.notification.data));
  await PushNotifications.register();                      // register() does NOT prompt — requestPermissions first
}
```
- ⚠️ **Android 13+ requires the runtime `POST_NOTIFICATIONS` permission** (we target 36) — `requestPermissions()` triggers it; without it `register()` succeeds but nothing shows.
- `@capacitor/push-notifications` already pulls `firebase-messaging` — no manual Gradle dep — but keep the `google-services` classpath compatible with the Capacitor 8 toolchain.
- `AndroidManifest.xml` metadata: `com.google.firebase.messaging.default_notification_icon` → `@mipmap/push_icon`; `..default_notification_channel_id` → `@string/default_notification_channel_id`.

### Optional / graceful disable

Presence of valid credentials **is** the flag — no separate enable switch (the right default for OSS self-hosters). `isPushEnabled()` is the single gate. `runPushCycle()` returns immediately when false (snapshot/differ skipped entirely). `GET /api/push/status` reports `{ enabled: false }` so the app shows push as unavailable rather than failing silently; `POST /api/push/register` returns `{ stored: true, deliveryEnabled: false }` — the token is recorded harmlessly so enabling FCM later starts delivery to already-registered devices without re-onboarding. Init failures log a warning, leave `messaging = null`, and JagHelm boots and serves the dashboard normally.

### Notification preferences (per-category + recoveries)

User-controllable, **filtered server-side** so a muted category is never sent (saves battery + FCM quota and keeps the differ pure). v1 granularity = **per-category + a recoveries toggle + master switch**; the schema is built to extend to per-service mute (see *Deferred: Mute*) and quiet hours without a rewrite.

**Edge-triggered baseline (no toggle needed for spam).** The differ emits only on *state transitions* (`down`/`recovered`, `failed`/`recovered`, `on-battery`/`restored`), never on "ran again" or "still up" — so a cron succeeding every 15 minutes produces **zero** pushes by construction. Preferences govern *which transitions you care about*, not noise suppression.

**Model.** Prefs are stored per device token in the token-store record (one source of truth, travels with the device):
```json
{ "<fcm-token>": { "platform": "android", "appVersion": "1.0.0", "registeredAt": "...", "lastSeenAt": "...",
    "prefs": { "categories": { "service": true, "host": true, "ups": true, "cron": true },
               "notifyRecoveries": true, "enabled": true } } }
```
- **Categories → event types:** `service` → `service_down`/`service_recovered`; `host` → `host_down`/`host_recovered`/`host_threshold`; `ups` → `ups_onbattery`/`ups_restored`; `cron` → `cron_failed`/`cron_recovered`.
- **`notifyRecoveries`** off ⇒ `*_recovered`/`*_restored` suppressed (you get the down, not the all-clear).
- **`enabled`** = master switch; off ⇒ no pushes to this device (token kept so re-enabling needs no re-onboarding).
- **Defaults** (new registration): all categories on, recoveries on, enabled on.

**Route** (behind `authMiddleware`, alongside the other push routes):
```
GET /api/push/prefs?token=<t>     // current prefs (defaults if unset)
PUT /api/push/prefs               { token, prefs }   // upsert
```

**Filtering (deterministic, in dispatch — never in the pure differ).** Mirrors the deferred-Mute mechanism: `dispatchEvents` consults the *per-token* prefs as **data** when fanning an event out, and drops the event for tokens whose category is off (or `notifyRecoveries` off for a recovery event, or `enabled` false). `diffSnapshots` stays I/O-/clock-/pref-free and still emits the full canonical event set; preference filtering is a pure `(event, prefs) → boolean` applied per (event × token). The byte-identical-differ guarantee is untouched, and two devices can hold different prefs off the same event stream.

**Client.** The Notification-settings screen `GET`s prefs on open, writes on toggle (optimistic UI + `PUT`), and reflects `GET /api/push/status.enabled` (a no-creds backend grays the screen). Prefs are **not secret** — they ride the normal authed API, no Keystore needed.

## Deferred: Mute (tracked follow-up — NOT in v1)

Mute appears in the mockups (Overview inline incidents, Incident detail, Alerts) but is **cut from v1** because, done right, it is a stateful write coupled to the differ's determinism. When built, it must be specified as:
- **Route:** `POST /api/push/mute { id, ttlSeconds }` and `DELETE /api/push/mute { id }`, behind `authMiddleware`.
- **Persistence:** `data/push-mutes.json` (`{ "<id>": { until: <epoch> } }`) via `atomicWriteFileSync`; gitignored under `data/`.
- **Differ interaction (deterministic):** mutes are passed into `dispatchEvents` as data, **not** consulted in the pure `diffSnapshots` (which stays I/O- and clock-free). `dispatchEvents` drops events whose `id` is muted and whose `until` has not elapsed; expiry is evaluated against a single timestamp captured once per cycle and passed in, so the differ stays pure. **Re-fire rule:** a muted service that recovers then re-downs while still muted does **not** re-fire until the mute TTL elapses; on TTL expiry the next transition fires normally. This rule is asserted in the differ/dispatch tests.
- **TTL:** explicit, operator-chosen (e.g. 1h/8h/until-cleared); no implicit forever-mute.

Until specified and built, the mockups' Mute affordances are disabled/hidden; v1 ships **Open** only. **Mute is a strict extension of the v1 notification-preferences mechanism** — same per-token store and same `dispatchEvents` data-filter, just keyed per-`id` with a TTL instead of per-category — so it slots in without reworking the differ.

## Security & Secrets

Three secret classes, all in scope of a **public** repo (a careless leak is worldwide), all kept out of git via `.gitignore` + `.example` templates + CI-secret/local injection at build/deploy time:

| Secret | Where it lives | Provisioning | Never committed |
|---|---|---|---|
| **Android keystore** (`.jks`/`.keystore`) + passwords | build machine / CI | env / CI-secret (base64-decoded to a temp path consumed by `--keystorepath`, **shredded after** in an `if: always()` step) or gitignored `keystore.properties` | `*.jks`, `*.keystore`, `keystore.properties`, `capacitor.config.local.ts` |
| **FCM service-account JSON** (server push origination) | Express host | `FCM_SERVICE_ACCOUNT` / `GOOGLE_APPLICATION_CREDENTIALS` env → Docker secret / bind-mounted file; CI-injected on deploy | `*service-account*.json`, `fcm-*.json`, `firebase-adminsdk*.json` |
| **`google-services.json`** (operator's Android Firebase config) | `mobile/android/app/` | CI-decoded base64 secret at build (**shredded after**), or operator drops in locally | `mobile/android/app/google-services.json`, `mobile/google-services.json` |

The keystore is the **crown jewel**: its compromise lets anyone ship a trojaned APK under JagHelm's identity. The FCM service-account JSON contains a **GCP private key**. `google-services.json` is operator-specific config. None may ever land in the repo.

**`.gitignore` additions** (current is only `node_modules/ dist/ .env uploads/ data/`). **Order matters: secret globs first, then explicit negations so committed `.example` templates survive the globs:**
```gitignore
# mobile secrets
mobile/android/app/google-services.json
mobile/google-services.json
mobile/**/*.keystore
mobile/**/*.jks
mobile/keystore.properties
mobile/android/key.properties
mobile/.env
capacitor.config.local.ts
*service-account*.json
fcm-*.json
firebase-adminsdk*.json

# negations — committed templates MUST survive the globs above
!**/*.example
!**/*.example.json
!server/push/*.example.json
!mobile/*.example
!mobile/*.example.json
```
> **Glob/template contradiction fixed.** The FCM template is named `server/push/fcm-service-account.json.example` (the `.json.example` style, matching `mobile/google-services.json.example`) — **not** `fcm-service-account.example.json`, which the broad `*service-account*.json` glob would silently swallow. The explicit `!**/*.example.json` / `!server/push/*.example.json` negations are placed **after** the secret globs so they win. A file is either a committed template **or** a gitignored secret, never both.

**Committed `.example` templates** (placeholders only, literal `REPLACE_ME`, no key material): `mobile/google-services.json.example`, `mobile/keystore.properties.example`, `mobile/.env.example`, `server/push/fcm-service-account.json.example`.

**CI assertion — every named template is tracked.** Because a mis-ordered glob silently swallowing a template is exactly the failure mode above, `check.yml` runs:
```bash
for t in mobile/google-services.json.example mobile/keystore.properties.example \
         mobile/.env.example server/push/fcm-service-account.json.example; do
  git ls-files --error-unmatch "$t" || { echo "TEMPLATE NOT TRACKED: $t"; exit 1; }
done
```
A swallowed template **fails the build** instead of silently disappearing for a cloning self-hoster.

**On-device storage** — the backend URL + `x-auth-token` are stored in the **Android Keystore** via the secure-storage plugin (EncryptedSharedPreferences), never in `@capacitor/preferences` (plaintext `SharedPreferences`, explicitly not for secrets) and never in JS-readable `localStorage`. Plain Preferences is acceptable only for non-secret UI state (selected theme, last tab) — and **all** such state goes through the Preferences plugin, never WebView `localStorage`.

**REQUIRED-FIRST floor hardening (Phase 0, gates everything secret-adjacent):** before any FCM / keystore / `google-services.json` code lands, the portfolio floor `secret-scan.py` + `scrub-payload.py` must catch **GCP service-account JSON** (`"type": "service_account"` + `private_key`) and **PEM private keys** (`-----BEGIN ... PRIVATE KEY-----`, incl. bare PKCS#8 and the `\n`-escaped JSON form), **via a single shared rule registry** (see Harness track). Detail below.

## Harness Stress-Test Track

The mobile app is the first **public-repo, signed-artifact** project to onboard to the portfolio harness (`homelab-infra/docs/harness/`). It is run deliberately as a **stress test** of the discipline: apply the existing `web-app` archetype, record where the harness holds and where it cracks against a target it was never calibrated for, and **harden the floor's secret controls before any secret-adjacent code lands**.

### Applying the discipline (archetype: `web-app`, for now)

`jaghelm` is a monorepo; the unit of conformance is the **repo**. Per `ARCHETYPES.md`'s hybrid rule, `jaghelm/mobile/` is a Capacitor/React presentation layer that **reuses** the parent data layer and shares the parent CI host — it is not a standalone repo. We therefore do **not** add a second `.git`; the mobile track is scored as part of the single `jaghelm` `web-app` manifest, with mobile-specific evidence paths and a captured-failure ledger.

`web-app` targets (`archetype-targets.yml`): `context L2 · legibility L2 · enforcers L3 · verification L3 · gc L2 · autonomy L2`.

**`jaghelm/.harness.yml` (honest seed — climb by capturing failures, not pre-filling):**
```yaml
archetype: web-app
levels:
  context:      L2   # AGENTS.md → docs/; ADD docs/mobile/ARCHITECTURE.md (Capacitor shell, reuse boundary, configurable backend URL)
  legibility:   L2   # web boots + logs/metrics queryable; mobile = web preview (npm run mobile:dev) + cap live-reload observable
  enforcers:    L3   # custom CI lints + git-guard + HARDENED secret-scan w/ SHARED registry — claimed L3 ONLY once §hardening merged
  verification: L2   # CI tests/typecheck/build on PR; L3 needs the Elrond agent-review loop — TRACKED GAP (▼ vs L3 target)
  gc:           L1   # GAP (target L2): no QUALITY_SCORE.md / golden-principles doc — uniform portfolio weakness
  autonomy:     L2   # human-held deploy gate; mobile adds a RELEASE/signing gate not yet modelled by the archetype
evidence:
  context:      [AGENTS.md, docs/mobile/ARCHITECTURE.md]
  enforcers:    [scripts/secret-scan.py, scripts/secret_rules.py, .githooks/, .github/workflows/ci.yml]
  verification: [.github/workflows/check.yml]
last_audited: 2026-06-25
```
`enforcers: L3` is claimed **only once the hardened secret-scan + shared registry are merged** (the REQUIRED-FIRST condition); until then the honest claim is L2 and `scan.py` won't credit L3 because the evidence content-signature won't match.

### REQUIRED-FIRST: secret-scan + scrub hardening + SHARED REGISTRY (public-repo-critical)

The 2026-06-24 red-team pass found the harness holds against a *careless* agent but a *malicious author* defeats many controls — an acceptable residual for a **private** repo. `jaghelm` is **public**, so these careless-agent findings are reclassified **critical, fix-before-any-secret-adjacent-code-lands**. Files to harden:

- `homelab-infra/docs/harness/templates/floor/secret-scan.py` (copied into each repo's `scripts/secret-scan.py`) — `RULES`, `GENERIC`, `is_placeholder()`, `scannable()`, `tracked_files()`, `main()`; `SKIP_NAMES`, `SKIP_SUFFIX`.
- `homelab-infra/istari/scripts/scrub-payload.py` (the Nir→Elrond egress scrubber on the review path) — `_TOKEN_PREFIX_PATTERNS`, `_ENV_VAR_LINE_PATTERN`, `_SECRET_KEY_PATTERN`; `Scrubber._scrub_string()`, `Scrubber.scrub()`.
- **NEW `scripts/secret_rules.py` (shared registry) — REQUIRED-FIRST, not deferred** (see below).

**Shared rule registry is part of Phase 0 (NOT a deferred follow-up).** The structural fix — **one shared `RULES` registry imported by both** scanner (reports) and scrubber (replaces match with a stable token) — is the **only** thing that makes "the egress scrubber catches every shape the scanner does" a *guarantee* rather than a hope. Hand-copying patterns into two files is exactly the drift the registry prevents: a new shape added to the scanner while the scrubber's hand-copy lags would egress a secret of that shape unscrubbed through the **public-repo** Elrond review path (Phase 7). It is small. **It lands in Phase 0.** The scrubber imports the shared `RULES` and gains every shape (PEM/PKCS#8, GCP SA, AWS `AKIA`/`ASIA`, Azure `AccountKey=`, Stripe `sk_live`, Google `AIza…`, JWT) instead of the prior ~5 prefixes.

**`secret_rules.py` (shared) — rules:**
```python
RULES = [
  ("private-key",       re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP |ENCRYPTED )?PRIVATE KEY-----")),
  ("gcp-sa-type",       re.compile(r'"type"\s*:\s*"service_account"')),
  ("gcp-sa-private-key", re.compile(r'"private_key"\s*:\s*"(?:-----BEGIN|\\n-----BEGIN|\\u002dBEGIN)')),
  ("gcp-sa-key-id",     re.compile(r'"private_key_id"\s*:\s*"[0-9a-f]{40}"')),
  ("aws-access-key",    re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
  ("azure-acct-key",    re.compile(r"AccountKey=[A-Za-z0-9+/]{86}==")),
  ("stripe-live",       re.compile(r"\bsk_live_[0-9A-Za-z]{24,}\b")),
  ("google-api-key",    re.compile(r"\bAIza[0-9A-Za-z_\-]{35}\b")),
  ("jwt",               re.compile(r"\beyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\b")),
]
```
The bare PKCS#8 `-----BEGIN PRIVATE KEY-----` (the form inside a GCP SA JSON `private_key`) must match — **add a regression test asserting it**. `"type": "service_account"` is the single lowest-false-positive fingerprint.  <!-- pragma: allowlist secret -->

**`secret-scan.py` — bypasses to close:**
1. **FORMAT rules (the `RULES` registry) must run on ALL files; only `GENERIC` keeps the skip list.** Today `scannable()` excludes `SKIP_NAMES`/`SKIP_SUFFIX`/`.example`, so a real key in `pnpm-lock.yaml` or `app.min.js` is never seen. A `BEGIN PRIVATE KEY` block is never a legit lockfile entry.
2. **`.example`/`.sample` exemption is dangerous on a public repo** — a careless agent fills a real value into `google-services.json.example`. Keep the GENERIC exemption but **always run the `RULES` registry (PEM/GCP/AWS/…) on `.example` too**.
3. **One bad byte skips the whole file** (`errors="strict"` + `continue` on `UnicodeDecodeError`). Open with `errors="replace"` (null-byte-ratio pre-filter for true binaries).
4. **Missing scanner = silent pass.** The CI floor step must **fail** when `scripts/secret-scan.py` is absent (`test -f … || exit 1`), and `scan.py`'s evidence check must require it exist + be non-empty.
5. **Placeholder filter drops short real secrets** (`is_placeholder()` on substring + `len <= 24`). Entropy-gate it: Shannon entropy > ~3.5 bits/char ⇒ not a placeholder regardless of substring.

**`scrub-payload.py` — leaks to close on the egress path** (PR diffs flow through it before Claude-API egress; a stray `google-services.json`/PEM in a diff would egress unscrubbed). **Import the shared `secret_rules.RULES`** (the registry above) so the scrubber gains every scanner shape; replace each match with a stable token. **Case-fold** the env/key rules (lowercase `password:`/`token:` in JSON/YAML currently slips the UPPERCASE-only env-line rule). Add a **post-scrub fail-closed tripwire** — re-run the `RULES` registry over the serialized scrubbed payload and raise `ScrubAmbiguityError` if any secret shape survives. **Until the shared registry is merged (i.e. inside Phase 0, before it lands), the post-scrub tripwire is the gate AND Elrond review stays fully disabled — not even advisory — on secret-adjacent diffs.**

**Close the scanner's own stub-evidence hole** (so the `enforcers: L3` claim can't be faked by a 0-byte stub). Harden `scan.py::assess()`:
1. **isfile + non-empty** (`os.path.isfile(p) and os.path.getsize(p) > 0`; dir evidence = non-empty dir). (Ground truth: `assess()` currently uses `os.path.exists` with no isfile/non-empty/content check — the real stub hole.)
2. **Per-pillar content signature** — for `enforcers` claiming the secret-scan, the evidence files must contain the load-bearing rules. **Exact signatures required** (regex literals that must be `grep`-present in `scripts/secret-scan.py` **or** the imported `scripts/secret_rules.py`):
   - `-----BEGIN ` **and** `PRIVATE KEY-----` (the PEM rule literal), matched by `grep -E 'BEGIN .*PRIVATE KEY'`
   - `"type"\s*:\s*"service_account"` (the GCP-SA fingerprint), matched by `grep -F 'service_account'` **and** `grep -E '"type".*service_account'`
   A stub that omits the PEM rule or the GCP-SA fingerprint fails to verify, so `enforcers: L3` cannot be credited.
3. **Fail-closed on unknown level strings** — any level not in `ORDER` (`L0..L3`) is an error/unverified, not silently `0`.

### Floor wiring, `.gitignore`, scan gate, Elrond review

| Floor element | Pillar | Mobile note |
|---|---|---|
| `scripts/secret_rules.py` (shared registry) | enforcers | **Phase 0.** Single source of truth imported by scanner + scrubber. |
| `scripts/secret-scan.py` (hardened) | enforcers | **Public repo = load-bearing.** Imports `secret_rules`; catches `google-services.json`, FCM SA JSON, base64-embedded keystore; runs FORMAT rules on `.example` + lockfiles. |
| `.gitignore` secrets block + negations | enforcers | Globs then `!**/*.example.json` etc.; `*.keystore`, `*.jks`, `google-services.json`, `mobile/android/key.properties`, `*service-account*.json`. |
| Template-tracked CI assertion | enforcers | `git ls-files --error-unmatch` each named `.example` (above). |
| `.githooks/pre-commit` → `secret-scan.py` | enforcers | Best-effort (`--no-verify` bypasses); authoritative gate is CI + branch protection. |
| `check.yml` on `pull_request` | verification | Add the mobile build/test/lint lane to climb off the L1 trigger floor. |
| `.harness-ledger.md` (`harness capture`) | all | The holds/cracks ledger. |

`harness init` is **not** re-run against the subtree (would drop a second `.git`/manifest); the floor controls are wired into the existing `jaghelm` repo, scoped to the mobile path. The floor moves a path **off L0, no higher** (anti-kitchen-sink); mobile then climbs by capturing real failures (`harness capture --pillar <P> --rule "<one line>" --enforcer <path>`), which stamps the enforcer into `evidence[pillar]` so `scan.py --check` proves it stays wired.

**`scan.py --check` gate** (CI): `python3 homelab-infra/docs/harness/scan.py --check ~ ~/projects` — flags any pillar below its target (`▼`) and any `≥L2` claim whose evidence paths don't resolve (`?`); exits 1 on either. This guarantees the hardened `scripts/secret-scan.py` + `scripts/secret_rules.py` stay wired (both in `evidence.enforcers`) — delete either and `enforcers: L3` goes unverified and CI goes red.

**Elrond agent-review on mobile PRs** — `web-app` targets `verification L3` = self-review **+** agent-to-agent review before a human. Every PR touching `jaghelm/mobile/` triggers the Elrond review job (`elrond_review.py`: scrub → Claude-API consult → review record) in addition to `/code-review` + adversarial-reviewer. The payload is scrubbed by `scrub-payload.py` (importing the shared registry) **before** egress — exactly why the registry is unified in Phase 0. **The merge gate stays human** (HARD rule: Elrond reviews, Jag merges; L3 autonomy tops out at "bounded autonomy with a human merge/deploy gate," never auto-merge). **Sequencing:** Elrond review stays **disabled on secret-adjacent diffs until the shared registry lands**; once it lands it runs **advisory**; the **tracked flip** `ci.yml` → `--check --require` (makes Elrond review blocking, bumps verification L2→L3) is gated on red-team triage. Until then mobile verification is honestly L2 (`▼`), recorded in the ledger as a known crack.

### The holds/cracks ledger

Two records: the per-repo `.harness-ledger.md` (L1 captured-failure record; adding the enforcer promotes the rule to L2 + stamps `evidence[pillar]`), and a stress-test holds/cracks table in `docs/mobile/HARNESS-STRESS-TEST.md`:

| Control (pillar) | Scenario | HELD / CRACKED | Evidence / ledger # | Fix or residual |
|---|---|---|---|---|
| secret-scan (enf) | committed FCM service-account JSON in a diff | HELD (after hardening) | ledger #; scan.py content-sig | `gcp-sa-type` rule (shared) |
| secret-scan (enf) | key pasted into `google-services.json.example` | CRACKED→HELD | ledger # | run `RULES` on `.example` |
| secret-scan (enf) | key in `pnpm-lock.yaml` / `app.min.js` | CRACKED→HELD | ledger # | FORMAT-rules-on-all-files |
| .gitignore (enf) | `*service-account*.json` glob swallows committed template | CRACKED→HELD | ledger #; template-tracked CI | `.json.example` rename + negation |
| scrub-payload | PEM in a mobile PR diff to Elrond | CRACKED→HELD | post-scrub tripwire + shared registry | shared `secret_rules` |
| scan.py evidence | 0-byte stub certifies enforcers L3 | CRACKED→HELD | isfile + non-empty + content-sig | exact PEM/SA signatures |
| differ | same logical state, different emit order | CRACKED→HELD | order-stability test | canonical `(type,id)` sort |
| push cycle | thrown dispatch error escapes refresh loop | CRACKED→HELD | error-isolation test | awaited + self-contained try |
| archetype model | signing key / release channel / native store | CRACKED | (archetype gap below) | new archetype? |
| verification | Elrond review not yet blocking (`--require`) | CRACKED (▼) | gated on red-team triage | flip `ci.yml` |

`HELD` = caught as-is; `CRACKED→HELD` = failed first, captured + added enforcer; `CRACKED` = genuine unresolved gap surfaced for the discipline owner. Honest-numbers rule: a row is `HELD` only if a checked-in test demonstrates the catch.

### Archetype-taxonomy gap (open question for the discipline owner)

`web-app` was not calibrated for a **shipped, signed, sideloaded native artifact**. We classify mobile as `web-app` for now (substance is web tech, pillar targets are a reasonable fit), but the fit cracks in three places — record as CRACKED rows and feed to the archetype owner:
1. **Signing key (autonomy + enforcers):** an Android keystore whose compromise ships a trojaned APK under JagHelm's identity — a blast radius the `web-app` deploy-gate model doesn't capture. No archetype models "the release-signing identity is a crown-jewel secret."
2. **Release channel (autonomy):** sideloaded signed APK is a build→sign→publish gate with its own provenance question (was *this* APK built from *this* reviewed commit?), distinct from the server deploy gate.
3. **Native secret storage (legibility + verification):** "verify the token was written to native secure storage and never to JS-readable `localStorage`" needs a mobile-specific check (e.g. a Capacitor/Detox test asserting the token is absent from `localStorage`, present only via the secure-storage plugin).

**Recommendation:** keep `web-app` for the build, record these three as unresolved CRACKED rows, and let the owner decide between annotating `web-app` with signing/release/native-storage bars or minting a `mobile-app` / `released-artifact` archetype. A deliberate calibration decision — not a silent `web-app` checkmark hiding a crown-jewel signing key.

## OSS / Self-Hosting

JagHelm is a **public** GitHub repo; the mobile app must build **generic** for any self-hoster:
- **No hardcoded tailnet / nodes.** The backend URL is supplied at first-run and stored in the Keystore; never baked into config, `allowNavigation`, or CSP host pins. Node identities (`vm-101`, `vm-103`, `gateway-pi`) come from the operator's own backend data, not the app.
- **Default transport is native HTTP** — the OSS backend needs **zero** CORS/CSP changes; its posture stays identical to today. The env allow-list is a documented fallback only.
- **Push is optional and self-disabling.** No Firebase setup ⇒ no FCM creds ⇒ backend skips origination, `GET /api/push/status` returns `{ enabled: false }`, the app grays out its push toggle, and the registration endpoint still records tokens harmlessly. A self-hoster with zero Firebase configuration is fully functional.
- **All secrets are operator-supplied** via `.example` templates + env / local files; nothing operator-specific is committed (and the template-tracked CI check proves the templates ship).
- **No paid dependencies** — the secure-storage plugin is a free/OSS community plugin (Ionic Identity Vault / enterprise Secure Storage is noted for completeness but not depended on).
- **No Play Store / Google account required** to run — distribution is a self-built or release-attached signed APK.

## Build & Distribution

Distribution is a **signed APK, sideloaded** — no Play Store (so APK, not AAB).

**Local / dev build (operator machine with Android SDK):**
```bash
npm ci && npm ci --prefix mobile   # root + mobile deps
npm run mobile:build               # vite build → mobile/dist
npx cap sync android               # copy mobile/dist + plugins into mobile/android
cd mobile/android && ./gradlew assembleRelease   # or: npx cap build android --androidreleasetype APK …
```
Generate the keystore once, off-repo: `keytool -genkey -v -keystore jaghelm-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias jaghelm`. Signing config in `mobile/android/app/build.gradle` reads `System.getenv("KEYSTORE_PASSWORD")` etc. with a **local fallback to gitignored `keystore.properties`** so operators can build locally without CI. ⚠️ Set `releaseType: 'APK'` + `signingType: 'apksigner'` explicitly.

**CI — `.github/workflows/build-apk.yml`** (separate from the Docker-only `build-push.yml`; triggers on `release: published` + `workflow_dispatch` so a signed APK is a release artifact). **The signing job MUST run on an ephemeral `ubuntu-latest` runner; self-hosted runners MUST NOT run it** (decoded secrets would persist in the workspace between jobs and be readable by later workflows). Keystore + `google-services.json` come from **GitHub Actions secrets**, base64-decoded to temp paths, used, and **shredded in an `if: always()` step** so they never outlive the job. The keystore-password env vars are scoped to the `assembleRelease` step only.

```yaml
name: Build signed APK
on: { release: { types: [published] }, workflow_dispatch: {} }
jobs:
  apk:
    runs-on: ubuntu-latest        # REQUIRED ephemeral — do NOT run on self-hosted runners
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version: '22', cache: 'npm' }
      - uses: actions/setup-java@v4
        with: { distribution: 'temurin', java-version: '21' }
      - run: npm ci && npm ci --prefix mobile
      - run: npm run mobile:build
      - name: Decode signing secrets (CI-only; never in repo; shredded below)
        env:
          KEYSTORE_B64:  ${{ secrets.ANDROID_KEYSTORE_B64 }}
          GSERVICES_B64: ${{ secrets.GOOGLE_SERVICES_JSON_B64 }}
        run: |
          echo "$KEYSTORE_B64"  | base64 -d > mobile/android/app/release.keystore
          echo "$GSERVICES_B64" | base64 -d > mobile/android/app/google-services.json
      - run: npx cap sync android
      - name: Assemble + sign release
        working-directory: mobile/android
        env:
          KEYSTORE_PASSWORD: ${{ secrets.ANDROID_KEYSTORE_PASSWORD }}
          KEY_ALIAS:         ${{ secrets.ANDROID_KEY_ALIAS }}
          KEY_PASSWORD:      ${{ secrets.ANDROID_KEY_PASSWORD }}
        run: ./gradlew assembleRelease
      - name: Guard — APK output dir must not contain secrets
        run: |
          ! find mobile/android/app/build/outputs/apk/release -name 'google-services.json' -o -name '*.keystore' | grep -q . \
            || { echo "SECRET LEAKED INTO ARTIFACT DIR"; exit 1; }
      - uses: actions/upload-artifact@v4
        with:
          name: jaghelm-apk
          path: mobile/android/app/build/outputs/apk/release/*.apk   # pinned to .apk only
      - name: Attach APK to the release
        run: gh release upload "${{ github.event.release.tag_name }}" mobile/android/app/build/outputs/apk/release/app-release.apk
        env: { GH_TOKEN: ${{ secrets.GITHUB_TOKEN }} }
      - name: Shred decoded secrets (ALWAYS — even on failure)
        if: always()
        run: |
          shred -u mobile/android/app/release.keystore        2>/dev/null || rm -f mobile/android/app/release.keystore
          shred -u mobile/android/app/google-services.json    2>/dev/null || rm -f mobile/android/app/google-services.json
```

**PR-check parity** — the per-PR `check.yml` adds a mobile lane: `npm run mobile:build` (catches shared-import + alias breakage), a `cap` config lint (fail on committed `server.url`, `cleartext: true`, non-`localhost` `allowNavigation`, or missing `releaseType: APK`/`signingType: apksigner`), the template-tracked assertion (above), and the floor `scan.py --check` with the hardened shared-registry GCP/PEM rules.

## Implementation Phases

Ordered. **Phase 0 is required-first and gates every secret-adjacent phase.**

- **Phase 0 — Floor secret hardening + SHARED REGISTRY (REQUIRED-FIRST).** Create `scripts/secret_rules.py` (shared `RULES`: PEM/PKCS#8, GCP-SA, AWS, Azure, Stripe, Google, JWT). Harden `secret-scan.py` to import it (FORMAT-rules-on-all-files incl. `.example`/lockfiles; `errors="replace"`; missing-scanner-fails-CI; entropy-gated placeholder). Harden `scrub-payload.py` to import the **same** registry (case-folded env rules; post-scrub fail-closed `ScrubAmbiguityError` tripwire). Harden `scan.py::assess()` (isfile+non-empty, exact PEM + `service_account` content signatures, fail-closed unknown levels). Add `.gitignore` negations + the template-tracked CI assertion. Add regression tests (bare PKCS#8, SA JSON, `.example`-key, lockfile-key, surviving-PEM tripwire). **Nothing FCM / keystore / `google-services.json` lands until this is merged; Elrond review stays disabled on secret-adjacent diffs until the registry lands.**
- **Phase 1 — Data-layer seams (additive, no mobile yet).** `src/api/baseUrl.js`; `useData.js` + `client.js` base-aware; **`cachedIconUrl()` routed through `getApiBase()`**; `src/storage/index.js` + `initAuthToken()`; CORS `exposedHeaders: ['ETag']` + env-gated `CSP_CONNECT_EXTRA` (fallback-only). Desktop behaviour byte-for-byte unchanged. Capture the remaining raw `/api`-literal (`uploadFile` in `useData.js`) as a harness gap with the **correct file attribution**.
- **Phase 2 — Mobile scaffold + shell.** `jaghelm/mobile/` (own Vite config, `@shared` alias, `capacitor.config.ts` with `CapacitorHttp` enabled, `npx cap add android`), `mobile/src/nativeHttp.js` (default transport), bottom-tab `MobileApp.jsx`, theme-token reuse, locally-bundled fonts, `.gitignore` + `.example` templates, edge-to-edge / safe-area / `insetsHandling`, hardware back, tight mobile CSP meta. First-run screen (backend URL + token + Test & Connect) writing to Keystore via the storage adapter; theme/last-tab via Preferences.
- **Phase 3 — Read-only UX.** Overview subsystem strip + inline incidents (**Open** only) + node rows; Services flat problems-first list + chips/search + **base-aware icons**; Infra node cards + node detail; Alerts history + incident detail. All read-only over the reused data layer. (Mute affordances disabled/hidden — descoped.)
- **Phase 4 — Push backend (server-side).** `server/push/{snapshot,differ,fcm,tokenStore,dispatch}.js` + `server/routes/push.js`; wire **`await runPushCycle()`** into `runBackgroundRefresh` (inside try, before `recordRefreshCycle`); self-contained try/catch; `initPush()` into `boot()`; persisted snapshot; deterministic differ with **canonical `(type,id)` sort** + table-driven tests (incl. order-stability + error-isolation); 30-day token retention/prune; **per-token notification-prefs store (per-category + `notifyRecoveries` + master `enabled`, defaults-on) + a deterministic per-(event × token) pref filter in `dispatchEvents` + `GET`/`PUT /api/push/prefs`**; graceful-disable path. (Secret-adjacent ⇒ requires Phase 0.)
- **Phase 5 — Push client + light actions.** Capacitor push registration, permission flow (`POST_NOTIFICATIONS`), token POST, deep-link routing into Incident detail; **Open** action; `GET /api/push/status` toggle wiring; **Notification-settings screen (Alerts-tab gear): per-category + recoveries + master toggles, optimistic `PUT /api/push/prefs`**. (Secret-adjacent ⇒ requires Phase 0.)
- **Phase 6 — Build & distribution.** `build-apk.yml` (ephemeral runner, `if: always()` secret-shred, artifact-secret guard), keystore/`google-services.json` CI secrets, signing config with local fallback, release-attached signed APK; mobile PR-check lane.
- **Phase 7 — Harness onboarding & ledger.** `jaghelm/.harness.yml` (honest seed), `docs/mobile/ARCHITECTURE.md`, `docs/mobile/HARNESS-STRESS-TEST.md` holds/cracks table, `.harness-ledger.md` captures, `scan.py --check` in CI, Elrond review job (advisory once registry lands); record the archetype CRACKED rows and the verification `--require` flip as tracked follow-ups.

## Ground-truth file references (verify before implementing)

The harness `capture` lands on the wrong enforcer if line cites drift. Re-verify against the current tree before Phase 1/4:
- `cachedIconUrl` + `uploadFile` live in **`src/hooks/useData.js`** (NOT `client.js`). `getServiceIcon` (same file) calls `cachedIconUrl` for every service.
- The cache accessor is **`getCached(key)`** in `server/cache.js` (NOT `getCache`).
- `client.js:13` is the module-load token seed; the protected-route guard is the single block at `client.js:34-47` (no separate detection block).
- `useData.js` top defines `const BASE = '/api'`.
- `scan.py::assess()` currently uses `os.path.exists` (no isfile/non-empty/content check) — the real stub-evidence hole.
- `cors({ origin: false })` does NOT block server-side — it omits `Access-Control-Allow-Origin` only.

## Verification

**E2E test plan**
- **Desktop regression (Phase 1 gate):** desktop web app boots and behaves byte-for-byte as before — `getApiBase()` returns `/api`, `cachedIconUrl()` returns `/api/icons/cached?...`, `initAuthToken()` restores the session from `localStorage`, the protected-route guard still injects `x-auth-token`, 304 caching intact. Snapshot/diff the desktop bundle behaviour.
- **Differ unit tests (Phase 4 gate):** table-driven fixtures asserting every transition row emits its event with correct severity, the no-change case yields `[]`, hysteresis prevents flapping, baseline-on-first-cycle emits nothing, `unknown` never emits, the persisted snapshot survives a restart without re-firing active incidents, and **an order-stability case** where two differently-ordered logical-equivalent inputs yield a **byte-identical** canonically-`(type,id)`-sorted array.
- **Push error-isolation (Phase 4 gate):** a thrown error inside `dispatchEvents` does not propagate past `runBackgroundRefresh` and does not become an `unhandledRejection`; the snapshot is persisted only on a clean cycle; `bgRefreshRunning` clears normally.
- **Notification-prefs filtering (Phase 4 gate):** a category toggled off suppresses exactly that category's events for that token while other tokens with it on still receive them; `notifyRecoveries:false` suppresses `*_recovered`/`*_restored` only; `enabled:false` suppresses all; unset prefs deliver everything; the pref filter is a pure `(event,prefs)→bool` that does not perturb the canonical differ output.
- **Push graceful-disable:** with no FCM creds, boot succeeds, `runPushCycle()` is a no-op, `GET /api/push/status` → `{ enabled: false }`, `POST /api/push/register` → `{ stored: true, deliveryEnabled: false }`.
- **Push E2E (with creds):** induce a service down/up, host unreachable, UPS on-battery, cron failure; assert exactly one push per real transition, correct `data` payload, deep-link opens the right Incident detail; assert `UNREGISTERED`/`INVALID_ARGUMENT` tokens are pruned and transient errors are not; assert 30-day-stale tokens are pruned.
- **Mobile build / shell:** `npm run mobile:build` + `npx cap sync android` succeed; `@shared` imports resolve; `./gradlew assembleRelease` (or `cap build … APK`) produces a **signed** APK; sideload onto a device, complete first-run (URL + token → Keystore), Test & Connect reaches the Tailscale backend over **native HTTP**, all four tabs render over live data **with icons resolving** (no `https://localhost/api/icons` 404s).
- **Native secret-storage check:** assert the token is **absent** from `localStorage`/plain Preferences and present only via the secure-storage plugin; assert theme/last-tab persist via Preferences and survive a scheme change (the archetype-gap verification item).
- **Secret-floor regression (Phase 0 gate):** `secret-scan.py` flags a bare `-----BEGIN PRIVATE KEY-----`, a `"type": "service_account"` JSON, a key pasted into `*.example`, and a key in a lockfile/min.js; missing-scanner fails CI; the post-scrub tripwire raises `ScrubAmbiguityError` on a surviving PEM; **scanner and scrubber import the same `secret_rules.RULES`** (assert a rule added to the registry is seen by both). `scan.py --check` goes red if `scripts/secret-scan.py` or `scripts/secret_rules.py` is deleted or stubbed, or if the PEM/`service_account` content signatures are absent. The **template-tracked CI assertion** fails the build if any named `.example` is untracked.  <!-- pragma: allowlist secret -->
- **CORS/CSP:** with native HTTP (default), backend calls reach Express with no `CORS_ORIGIN` set and 304 caching works (native reads `ETag`); the tight mobile CSP (`connect-src 'self'`) blocks unexpected WebView `connect-src`. With the WebView-fetch fallback, `https://localhost` reaches the backend only with `CORS_ORIGIN` set and `exposedHeaders: ['ETag']`.

**Mandatory pre-done gate (HARD RULE):** after implementation, run **`/simplify`** then **`/security-review`** before calling any phase done — non-negotiable, every phase that ships code. The mobile PR path additionally runs `/code-review` + adversarial-reviewer + the Elrond agent-review job (advisory once the shared registry lands; disabled on secret-adjacent diffs before that); **the human merge gate is never bypassed** (Jag reviews and merges; no auto-merge, no push to main).