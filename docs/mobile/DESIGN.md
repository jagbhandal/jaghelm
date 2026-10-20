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

- **Overview** — health hero is a **subsystem strip** (Services / Nodes / UPS / Cron cells; green = calm, red = degraded; the cell card is alarm-tinted when degraded). Active issues list one compact row per incident (lamp, status word, name, readout; the cause only on a down row). Tapping an issue row opens the detail screen of what it refers to: a down or unknown service opens Service detail, and a UPS or cron row opens Incident detail, since the app has no UPS or cron job screen. The row is a button named "{title}, {word}, {readout}", where the name spells out UNKN as "unknown"; Back (on screen or the hardware key) returns to the Overview, and the service's **Open** lives on its detail screen. The row finds its entity by the key `deriveIncidents` carries (service uid, or the incident id such as `cron:{node}:{job}`), never by its name; the map is `issueRoute` in `mobile/src/nav/issueRoute.js`, which also sends a node row to Node detail, although no row refers to a node yet. A row with nothing to open renders as plain content, not a button, and doesn't look tappable (#279). If the service or incident is gone by the next poll, its detail screen says so ("This service is no longer reported." or "This incident has resolved.") and Back still returns to the Overview. The Overview has no per-node rows (Bug #10); nodes show in the Nodes cell and on Infra. The UPS cell reads `nut_status` as push does: 1 is MAINS, 2 (on battery) and 3 (low battery) are ON BATTERY with an incident, and 0 or no reading is NO SIGNAL. The healthy hero names the UPS only when its state is known: status 1 still reads "N services up across M nodes — UPS on mains", and an unknown status or no reading adds nothing to the hero while the cell shows NO SIGNAL. The map is `upsState` in `mobile/src/data/derive.js`; the app can't bundle server code, so `upsStatusParity.test.js` holds it to `normalizeUpsStatus` in `server/push/snapshot.js` and fails if the two drift (#273).
- **Services** — a **flat list sorted problems-first**, each row tagged with its node (services are organized per node: `vm-101`, `vm-103`, `gateway-pi`). Filter chips (All / Down / per-node), search, tap to detail. **Icons resolve via a base-aware resolver (see Icon Rendering §)** — never a relative `/api/icons/cached`.
- **Infra** — compact **node cards** (name, type, CPU / MEM / DISK, or TEMP for a node that reports temperature such as the Pi, "N up / M down"); tap to node detail with the full service list for that node. DISK replaces TEMP on the card once disk is at or above 90 % (`DISK_HOT`, push's default disk threshold and the spec §6.1 disk warn line), so a near-full disk is never hidden (#273). The detail screen has room for both and shows CPU, MEM, TEMP (when reported) and DISK, so the temperature behind an amber lamp stays visible. It doesn't change the node's lamp; that waits for the server status model (#290, #292).
- **Alerts** — push history grouped by day; the active incident is pinned red at top; tap to incident detail.
- **Incident detail** — full screen: status, node, cause, 24h uptime, **Open**. A derived incident has no event timeline, because the snapshot carries no event times; a push-event fallback (a tapped push with no live incident behind it) shows the push time. Reached from Alerts, from a UPS or cron row on the Overview, and from a tapped push.
- **First-run** — backend URL + access token, Test & Connect, tailnet note; both values stored in the Android Keystore.
- **Startup states** — the app renders at once; `Root.jsx` owns the boot attempt and never shows a blank screen. **Connecting to JagHelm…** while the startup auth check runs (one 10 s deadline, `BOOT_TIMEOUT_MS` in `boot.js`), then the app (first-run / re-auth / tabs as before). If the server can't be reached (timeout, network error, or a 5xx from `/auth/check` such as a proxy's 502 while JagHelm is down; a 401 or `authenticated: false` still drops to re-auth): **Can't reach JagHelm** with the saved server address, "If you're away from home, check that Tailscale is connected on this phone.", **Retry** (re-runs the check, keeps the saved session token) and **Change server** (clears the token and address as Forget device does, through the same `forgetServer()` in `mobile/src/auth/forgetServer.js`, then lands on first-run). An unexpected boot error or a malformed boot result shows **Something went wrong** + Retry (re-runs boot); a render crash anywhere (top-level `ErrorBoundary.jsx`) shows the same screen, where Retry reloads the app. Each boot attempt carries an id and only the latest may change the screen, so a superseded attempt resolving late is ignored. Sign in on the login screen uses the same 10 s deadline for the request and its body: if the server doesn't answer, the form shows "Can't reach JagHelm. If you're away from home, check that Tailscale is connected on this phone." and the button re-enables.
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
This makes the proxied icon URL absolute and same-base on mobile, so it reaches Express over Tailscale. Web is byte-for-byte identical (`getApiBase()` → `/api`).

> **Correction (2026-10, #255):** no token is involved. An `<img>` is loaded by the WebView, not through `apiFetch`, so nothing injects `x-auth-token`, and `/api/icons/cached` is a public route because of that. Since #255, `cachedIconUrl()` also routes only Dashboard Icons and selfh.st URLs through the cache (`server/icon-sources.js`); any other URL is returned unchanged. Whether the app can load the absolute backend URL at all under its CSP (`img-src 'self' data: blob:`) is the Android icons issue, #373.

**Fallback (b):** if a deployment routes via the env-CORS allow-list and prefers not to proxy, mobile presentation may render icons **directly from the CDN**, skipping the proxy. Default is (a). That would need `https://cdn.jsdelivr.net` added to the mobile CSP's `img-src`: the shipped `mobile/index.html` allows only `'self' data: blob:` there and `'self'` in `connect-src` (corrected 2026-10; see #373).

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
- **Mobile boot order:** render first (`Root.jsx` shows Connecting at once), then `bootMobile()` runs `setStorageAdapter(keystoreAdapter)` → `installNativeHttp()` → read the stored base → `setApiBase(storedBase)` → keep-signed-in (a session-only login drops the token) → `await initAuthToken()` → revalidate with `/auth/check` (bounded by `BOOT_TIMEOUT_MS`). `App` and its data hooks mount only after boot resolves.
- **Web boot:** `await initAuthToken()` with the default adapter — same persisted-session behaviour as today.
- **First-run mobile screen** writes both `jaghelm-base-url` and `jaghelm-token` through the **Keystore** adapter, satisfying the "stored in Android Keystore" requirement; theme/last-tab go through Preferences.

### Transport & CORS (Express)

**Default transport = Capacitor native HTTP (no CORS at all).** Backend calls are routed through Capacitor's native HTTP layer (patched `fetch`/`XHR` leaves native code, not the WebView), which **bypasses CORS entirely**. This is the **default** for three reasons: (1) the OSS backend needs **zero** app-specific config — its CORS posture stays identical to today; (2) native code reads all response headers, so the `exposedHeaders: ['ETag']` concern disappears; (3) it removes the spoofable-`Origin` widening described below. Wiring lives in `mobile/src/nativeHttp.js`; `connect-src` in the mobile CSP can then stay tight (`'self'`).

**A 304 can't come back through Capacitor's patched GET (#238).** Capacitor 8 sends a patched `GET` as a WebView request to its local interceptor (`https://localhost/_capacitor_http_interceptor_?u=…`), and the interceptor hands the native answer back as an `android.webkit.WebResourceResponse`, whose constructor throws on any 3xx status. The interceptor catches that and returns nothing, so the WebView loads the interceptor URL itself and a 304 reaches JS as a failed fetch (read from the Capacitor 8 and AOSP sources: `WebViewLocalServer.handleCapacitorHttpRequest`, `WebResourceResponse.setStatusCodeAndReasonPhrase`). `installNativeHttp()` (run from `bootMobile()`) therefore wraps `window.fetch` on the device: a `GET` to the backend (a URL on the origin of `getApiBase()`) that carries `If-None-Match` goes through the `CapacitorHttp.request` plugin call instead, which returns status, headers and body over the bridge, and is rebuilt into a `Response` (a 304 with a null body, a 200 with its JSON). The plugin gets the resolved absolute URL and follows redirects, as the interceptor path does. It hands back a JSON body it can't parse (empty or malformed) as a raw string; that string goes into the `Response` as it is, so `json()` throws as it would in a browser and the bad body never replaces the last good one, nor does its ETag: `useData.js` stores a response's ETag only together with a body that parsed (#383). Everything else — unconditional GETs such as the first load, writes, other hosts, the app's own files — keeps Capacitor's normal path. The caller's `AbortSignal` (12 s in `useData.js`) still settles the request; the plugin call itself has a 15 s native backstop. In a browser the wrapper is not installed.

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

### Live data polling

`mobile/src/data/useDashboard.js` is the app's one live-data source: `/api/services` (the health gate: a failure sets `error`), `/api/ups` and `/api/cron/status` (a failure keeps the last value). One scheduler (`mobile/src/data/pollScheduler.js`, explicit `start`/`stop`) drives every fetch round. Rounds never overlap: a trigger during a round folds into one follow-up. The next poll is armed one refresh interval after a round lands, so the status bar's `HH:MM · next Ys` (`lastUpdated` + interval) is when it really fires. The interval is the display config's `refreshInterval` (the web dashboard's, 30 s by default, 5 s floor); a change re-arms the pending poll.

Each round has a reason, which sets how it fetches. The server contract is the web dashboard's ([ARCHITECTURE.md](../ARCHITECTURE.md) §4.2, and Polling in §5): `/api/services` and `/api/ups` answer `If-None-Match` with a 304, and `/api/cron/status` has no ETag and sends `Cache-Control: private, max-age=60`.

| Round | When | services, ups | cron |
| --- | --- | --- | --- |
| `force` | first load; a tap on the status bar | full fetch (`skipEtag`, `cache: 'reload'`) | full fetch, past the cache |
| `poll` | every interval | `If-None-Match` | plain GET |
| `resume` | the app returns to the foreground | `If-None-Match` | full fetch, past the cache |

A 304 hands back the same body reference as the last 200 (`useData.js`), so an unchanged poll leaves the data untouched and the views' memos hold; the only re-render is the status bar's clock. A 304 counts as a success (the server confirmed the data), so `lastUpdated` moves; a failed round leaves it alone. A conditional request is never answered from an HTTP cache, so a `resume` round can send ETags and still get the server's current answer; only cron, which has no ETag, is fetched past the cache after a trip to the background.

**Background.** The hook listens to `@capacitor/app` `appStateChange`. Capacitor sends `isActive: false` when the activity stops (no longer visible): the scheduler stops, with no timer left and any queued round dropped (a round in flight finishes but arms nothing). `isActive: true` (sent on every activity resume) starts it again with one `resume` round at once; while it is already running, the event does nothing, so a resume that follows a dialog rather than a trip to the background costs no fetch. The same event sets the hook's `foreground` flag, which `RefreshStatus` uses to stop its 1 s countdown heartbeat in the background and tick once on return. In a browser, `@capacitor/app` sends the same event from `visibilitychange`.

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
           font-src 'self' data:; img-src 'self' data: blob:;
           connect-src 'self';">
```
(As shipped in `mobile/index.html`; corrected 2026-10, the snippet used to list `https://cdn.jsdelivr.net` in `img-src`, which the shipped CSP never had. See #373.)
Fonts are **bundled locally**, so `font-src 'self'` holds and no `fonts.googleapis.com` / `fonts.gstatic.com` allowance is needed. Glassmorphism `backdrop-filter` and the theme CSS need **no** CSP relaxation. If the WebView-fetch fallback is chosen, widen `connect-src` to `'self' http://*:* https://*:*` with the honest "not the boundary" note; if CDN icons are used (Icon fallback b), add `https://cdn.jsdelivr.net` to `img-src`.

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

The backend originates push on infrastructure state changes. It plugs into the existing Express background poll (`server/refresh.js` → `runBackgroundRefresh`) and reads what the loop already produces: since #292, the server's **status model** (`server/status/`, [ARCHITECTURE.md](../ARCHITECTURE.md) 4.7), which judges every entity once for the web, the app and push. The detector is a **judgment-free deterministic module**: given two snapshots it emits the same event set **in the same canonical order** every time — no heuristics, no wall-clock branching; every line (thresholds, hysteresis, "for 2 cycles") is the status model's. Push is **fully optional**: with no FCM service account configured, the whole pipeline self-disables and nothing else is affected.

### Architecture

```
runBackgroundRefresh()  ──▶ refreshServices/refreshUPS/refreshGitea/...   [existing poll, ~30s]
        ▼
  updateStatus()  ──▶ the status model, once a cycle (also served at /api/status)   server/status/
        │  (AWAITED, inside the try — after allSettled, before recordRefreshCycle)
        ▼
  await runPushCycle()  ──▶ guarded; self-contained try/catch; can never reject
        ▼
  buildSnapshot(caches, prev, status) ──▶ { services, monitorOf, hosts, ups, cron, sources }   (PURE)
        ▼
  diffSnapshots(prev,next,status) ──▶ Event[] (canonically sorted)   server/push/differ.js  (PURE, no I/O)
        ▼
  dispatchEvents(events) ──▶ per event × per registered token   server/push/fcm.js (HTTP v1, Admin SDK)
        ▼
  advance prev snapshot (memory); write data/push-snapshot.json if its alert state changed
        ▼
  prune UNREGISTERED/INVALID tokens   server/push/tokenStore.js
```

New files under `server/push/` (mirrors the existing `server/<domain>.js` layout):

| File | Responsibility |
|---|---|
| `server/push/snapshot.js` | `buildSnapshot()` — record what the status model decided about each entity push pages for, as a canonical comparable map (keys inserted in sorted order). Pure. |
| `server/push/differ.js` | `diffSnapshots(prev, next, status)` — deterministic differ; returns a **canonically sorted** `Event[]`, each with the model's reason. Pure, no I/O. |
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
    const prev = loadPrevSnapshot();
    const next = buildSnapshot(readCaches(), prev, status); // from the status model (#292); holds what it can't call
    const events = diffSnapshots(prev, next, status);
    await dispatchEvents(events);
    persistSnapshot(next);             // must complete before return
  } catch (err) { log.warn({ err }, 'push cycle failed — skipped this round'); }
}
```
**Required test:** a thrown error inside `dispatchEvents` does **not** propagate past `runBackgroundRefresh` and does **not** become an `unhandledRejection`; the snapshot is only persisted on a clean cycle.

### Deterministic state-change detection

The detector hooks in as the **last data step of the cycle**, after `Promise.allSettled` resolves and caches are populated — so it sees exactly the data the API serves.

**Snapshot** (#292) — reads this cycle's status model (built from the just-written caches and one read of `cron-store.getAllStatuses()`), plus the caches' source flags and monitor identities, projecting into one canonical map keyed by stable IDs that already exist in the data layer (services use the existing `uid` = `nodeKey:container`). **Keys are inserted in sorted order** so iteration order is pinned:
```js
{
  services: { "vm-101:gitea": "up", "vm-103:grafana": "down" },           // each Kuma-fed service: crit → down, ok → up
  monitorOf: { "vm-101:gitea": "1", "vm-103:grafana": "7" },             // the Kuma monitor that fed each key (#395)
  hosts:    { "vm-101": { reachable: true,  levels: { cpu: "ok", disk: "warn", mem: "ok", temp: "ok" } },
              "vm-103": { reachable: false, levels: { cpu: "ok", disk: "ok", mem: "ok" } } },  // the model's conditions
  ups:      { state: "online" },                                          // the model's UPS: crit → on_battery, ok → online
  cron:     { "pi2:npm-sync": "success", "vm103:backup": "failure" },     // each job (and backup): success|failure|overdue
  sources:  { "kuma": "ok", "nut": "ok", "prometheus": "failing" },       // ok | failing (1st failed cycle) | down
}
```
> **API name (ground truth):** the cache accessor is `getCached(key)` (`server/cache.js`), **not** `getCache`. Use `getCached`.

Every state is the model's: a service's from its Kuma monitor, a host's `reachable` and each reading's level (hysteresis and CPU's 2 cycles applied) from its node entity, the UPS's and each job's from theirs; the model's status word tells a pending service, an unreachable node, a failed run and an overdue one apart. What the model can't call up or down — a service pending or in maintenance, an entity a failed source made unknown, a reading whose query failed or that has no value this cycle (the model holds its level too, #462, so a sensor that skips a cycle mid-episode sends no clear and no second alert), the UPS while NUT is quiet — **holds its last known state** and never emits, so on battery, unknown, on battery sends no second `ups_on_battery`, and online, unknown, online sends nothing. **An entity with no previous state (#448)** — new to the snapshot (a node added to `services.yaml`, a reading that starts answering, a new service or job, a UPS never read, held as `unknown`), or every entity when there is no snapshot — is diffed from "no previous state": it pages once if it appears in trouble, at the model's level, and sends nothing if it appears ok (no "Host recovered" for a new node). A container with no monitor, an integration and an Arcane agent are not in it (the Arcane poller pages for its agents).

**A Kuma monitor no container has (#390)** has a card only while it is down. The services refresh keeps the uids of the up ones beside the cached services payload, in `upWithoutCard` (it is not served), each the uid its red card has while down, as long as its last container isn't in the stopped list. The status model reads them as up services, and `buildServices` records them as `up`, so the monitor's recovery diffs on the key of its down push. A service card with the same uid wins, but a grey presence breadcrumb does not (the model judges it as a missing container), so a recovery while the monitor's stopped container still shows one is sent too. A paused monitor, or one Kuma no longer has, is in neither, so it sends nothing. See [ARCHITECTURE.md](../ARCHITECTURE.md), "Kuma monitors and containers".

**A monitor's key can move (#395)**: a container takes it, its stopped container holds it only while it is down, or a monitor that remembered the same container drops out. The services refresh keeps `monitorOf` beside the cached payload (not served), the id of the monitor each monitored uid carries, and `buildSnapshot` stores it in the snapshot. The differ diffs such a key against the monitor's last state wherever its keys were (`serviceHistory`), so each outage is one `service_down` and one `service_recovered`, each on the card the monitor has at the time; a key whose monitor moved on to another key starts fresh, and so does a key whose monitor has gone (paused or deleted) when no monitor feeds it now, so a running card whose monitor is paused or deleted while down sends no false recovery. A monitor an explicit mapping gives several containers is **one** event, on the first of its cards, naming every node, however its cards come and go during the outage (#407). A card that had no monitor and a key that a monitor new to the snapshot feeds (deleted from Kuma and added again) keep their own state, as before. A snapshot written before #395 has no `monitorOf` and diffs key by key, so the deploy sends nothing. The FCM payload is unchanged.

**A failed source is not an outage of what it watches (#232), and is one push of its own (#292).** The services payload says whether Prometheus and Kuma answered this cycle (`sources.prometheus.ok`, `sources.kuma.ok`), and each node which of its reads failed (`failedReads`); the UPS payload carries its own `ok`. A missing payload (a cold cache after a restart, or one past its 120 s TTL because the refresh kept failing) counts as failed, never as an empty answer. The status model makes what a failed source feeds `unknown`, and `buildSnapshot(caches, prev, status)` holds each unknown at its previous state instead of reading the failure as every host or service going away. For hosts that is per host and per reading: a reading whose query failed keeps its previous level, and `reachable` its previous value when the node's `up` query failed (or, for a node judged by metric presence, one of its metric queries did); everything else takes this cycle's. A query covers every node (#234), so a metric query that keeps failing holds that reading on every host, and, for a host with no `up` series, its reachability; a host's `up` at 0 still pages. A host missing from the payload while Prometheus fails is kept whole. The source itself — Prometheus, Kuma or the NUT exporter, failed two cycles in a row — sends one `source_down`, and one `source_recovered` when it answers. While Prometheus fails, a service missing from this cycle keeps its previous status while one present (a Kuma outage card, or the up entry of a monitor whose container wasn't seen) takes this cycle's, so Kuma keeps paging, and a recovery during the outage is sent when Kuma reports it: with no container seen, the up monitor is an entry under its card's uid (#390). Only if no node could be read at all is it sent once the container is seen again; while Kuma fails, all of `services` is kept, since Kuma sets every status that can page; while the UPS read fails, `ups` is kept. `runPushCycle` hands the builder its `prev` and advances to the result, so the kept state lasts however long the failure does, and its recovery diffs against the last real reading.

With no `prev` (a first run, or a missing or unreadable file) there is nothing to keep, and the snapshot is built whatever the sources say (#461): there is no baseline to wait for. A source that failed is in its `sources` like on any cycle, so its second failed cycle in a row sends `source_down` and its recovery `source_recovered` (#439); what it feeds is unknown in the model, so a host is left out and a service or the UPS is `unknown`, which sends nothing, and each is new once the source answers: what is in trouble then pages once. A Kuma service going down, or a job failing, pages as on any cycle. Until #461 `buildSnapshot` returned null while the UPS read failed, or Prometheus failed with no host's reachability read, and that cycle was skipped. The wait dated from a baseline that was never diffed (a host recorded unreachable during the outage sent `host_recovered` later; an `unknown` UPS kept a later `on_battery` silent); since #448 a host not read is not in the snapshot and is new when read, and the UPS pages going on battery from `unknown`, so all the wait still did was silence every push meanwhile, for as long as the UPS query kept failing.

**Differ** — `diffSnapshots(prev, next, status) → Event[]`. No I/O, no `Date.now()`, no randomness. The previous snapshot is held in memory (`createPushSnapshot` in `dispatch.js`) and **persisted to `data/push-snapshot.json`** so a restart doesn't re-fire every active incident as "new". The file is read once, on the first cycle; it is rewritten only when the snapshot's alert state (`alertStateKey` in `differ.js`: every state, the monitor of each service key, each host's reachability and levels, each source's state — since #292 all of the snapshot) differs from the file's, so a steady cycle writes nothing. The status model's memory starts, at boot, from the levels the file holds, so a reading inside its hysteresis band after a restart (or a threshold edited while JagHelm was stopped) is judged as if the process had kept running (#361). A failed write is retried every cycle, and shutdown writes the latest snapshot (`flush`) if the file is behind; until it lands, a restart can re-send an alert, or miss the recovery of one already sent. With no file, or an unreadable one, every entity is new (#448): the first cycle sends each open problem once and nothing for what is ok, and the snapshot it writes holds them, so the next cycle, or the next restart, sends nothing again. A file written before #292 holds readings, not levels: it is read as the levels its readings give (`upgradeSnapshot`), so the first cycle after the deploy compares levels like any other, and a reading that crossed its line since the file was written is sent. A cycle whose status model failed is skipped (nothing diffed, sent or advanced), so the next good cycle sends what changed meanwhile.

**Canonical ordering (REQUIRED for the byte-identical promise).** "Same input ⇒ same event set" is necessary but not sufficient for "byte-identical array": JS object key iteration is insertion-order, and cache-population order across refreshes is not pinned. The differ therefore applies a **total, deterministic sort** to the emitted array before returning:
> **Sort key:** ascending `(type, id)` — string-compare `type`, tiebreak by `id`. This is the canonical order; it is stated here and **asserted in the table-driven test** (the test compares the full serialized array, not a set). `buildSnapshot` also emits sorted keyed maps as belt-and-suspenders. Without this, the "byte-identical array" promise does not hold.

| Domain | Transition | `type` | Severity |
|---|---|---|---|
| Service | `up`/`unknown` → `down` | `service_down` | critical |
| Service | `down` → `up` | `service_recovered` | info |
| Host | `reachable` true → false, or new to the snapshot and unreachable | `host_unreachable` | critical |
| Host | `reachable` false → true | `host_recovered` | info |
| Host | a reading's level rises (`ok` → `warn`, or to `crit`), or a reading new to the snapshot (a new host's included) is at `warn` or `crit`: CPU, memory, disk, temperature, a storage pool | `host_threshold` | warning (critical for `crit`) |
| Host | a reading's level returns to `ok` (below its line − hysteresis) | `host_threshold_cleared` | info |
| UPS | `online`/`unknown` (no known state) → `on_battery` | `ups_on_battery` | critical |
| UPS | `on_battery` → `online` | `ups_restored` | info |
| Cron | ok/new → `failure` | `cron_failed` | warning |
| Cron | `failure` → `success` | `cron_recovered` | info |
| Cron | → `overdue` | `cron_overdue` | warning |
| Monitoring source | failed two cycles in a row (`down`) | `source_down` | warning |
| Monitoring source | `down` → `ok` | `source_recovered` | info |

Each `Event` is a plain serializable record:
```js
{ type: "service_down", id: "vm-103:grafana", node: "vm-103",
  title: "Service down", body: "Grafana on vm-103 · Kuma: down",
  reason: "Kuma: down", severity: "critical", prev: "up", next: "down" }
```

**Determinism guards (by construction):** pure exported function unit-tested with fixture snapshot pairs (same input ⇒ **byte-identical, canonically-sorted** event array, table-driven test covering every row + the no-change → `[]` case + an order-stability case where two unsorted inputs yield identical arrays); every line is the status model's (`server/status/thresholds.js`, `display-config.json`'s `pushThresholds` over the spec §6.1 defaults), not a number of push's own; hysteresis lives in the model's held levels, not in the comparison or in timers; new/removed keys handled by one documented rule (a new key is diffed from no previous state, #448); no machine-learning model is called anywhere (the status model is plain code). This satisfies the determinism-by-construction law — atomic deterministic execution, judgment (thresholds/severities/sort key) lives in config/spec.

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
                   "registeredAt": 1782345600000, "lastSeenAt": 1782345600000 } }
```
`registeredAt`/`lastSeenAt` are epoch-ms numbers. `register` upserts + refreshes `lastSeenAt` (idempotent). The client re-registers on app start. A send FCM accepts also refreshes `lastSeenAt` (`dispatchEvents` → `tokenStore.markDelivered`: at most one write per dispatch, and none for a token already refreshed in the last day), so `lastSeenAt` is the last sign of life — an app start **or** an accepted push — and a phone used only to receive alerts stays fresh without the app being opened (#247).

**Token-store privacy & retention.** `data/push-tokens.json` holds FCM **device tokens** (device-identifying, PII-adjacent). It is gitignored via the existing `data/` ignore (verified safe — never committed). Retention policy: a token is pruned only when FCM names it as unregistered or invalid on a send (below), or after **270 days** with no app start and no accepted push (`tokenStore.pruneStale()`, every refresh cycle) — no sooner than FCM's own 270-day expiry for an inactive Android registration (FCM's clock is the device's connection to FCM, not ours). A token FCM keeps accepting pushes for never ages out; one that gets no sends (every category muted, push disabled) still ages out on app starts alone. On load, a damaged record is dropped (not an object) or repaired (an unreadable `lastSeenAt` restarts at load time; missing prefs become the defaults) so one bad record cannot stop push delivery. On `DELETE /api/push/register` (logout / push-disable) the token is removed immediately. Until 2026-10 (#247) the backstop was 30 days on app starts alone, which silently dropped phones that received alerts but were not opened for a month.

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

**Stale-token pruning (deterministic, response-driven):** `fcm.sendToToken` flags a token as dead when FCM answers `UNREGISTERED` (404, `messaging/registration-token-not-registered`), the legacy `InvalidRegistration` (`messaging/invalid-registration-token`), or `INVALID_ARGUMENT` (400) whose message names the registration token. Any other `INVALID_ARGUMENT` is a payload problem (too big, bad data, bad TTL) or a non-JSON 400, which firebase-admin maps to the same code: the token is kept and FCM's message is logged. `dispatch.js` collects the flagged tokens → `tokenStore.removeToken(token)`, once each per dispatch. Transient errors (`UNAVAILABLE`, `INTERNAL`) are logged and the token is kept, but the send is not retried: `runPushCycle` advances the persisted snapshot every cycle, so that transition is not re-detected and the alert is lost.

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
    "prefs": { "categories": { "service": true, "host": true, "ups": true, "cron": true, "watchtower": true },
               "notifyRecoveries": true, "enabled": true } } }
```
- **Categories → event types:** `service` → `service_down`/`service_recovered`; `host` → `host_unreachable`/`host_recovered`/`host_threshold`/`host_threshold_cleared`; `ups` → `ups_on_battery`/`ups_restored`; `cron` → `cron_failed`/`cron_recovered`/`cron_overdue`; `source_down`/`source_recovered` (#292) → the category of what the source watches: Prometheus `host`, Kuma `service`, NUT `ups` (`SOURCE_CATEGORY`, `server/push/dispatch.js`); `watchtower` (shown as *Updates*) → the Arcane types `arcane_update`/`arcane_heldback`/`arcane_cleared`/`arcane_agent_offline`/`arcane_agent_recovered`/`arcane_release`/`arcane_vulns` (mapped explicitly in `TYPE_CATEGORY`, `server/push/dispatch.js`). `arcane_cleared` and `arcane_agent_recovered` count as recoveries.
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

> **Superseded by [docs/RELEASING.md](../RELEASING.md)** for the release trigger and the attach step. There is no `release: published` trigger any more: releases start from a tag pushed to Gitea. On a `mobile-vX.Y.Z` tag, `build-apk.yml` builds and signs the APK, then a release job attaches it to a GitHub Release with notes from `mobile/CHANGELOG.md`. On a `vX.Y.Z` tag, `release.yml` adds the version tag to the image `main` already built (by digest, no rebuild) and publishes the GitHub Release. The sketch below is the original design.

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
- **Phase 4 — Push backend (server-side).** `server/push/{snapshot,differ,fcm,tokenStore,dispatch}.js` + `server/routes/push.js`; wire **`await runPushCycle()`** into `runBackgroundRefresh` (inside try, before `recordRefreshCycle`); self-contained try/catch; `initPush()` into `boot()`; persisted snapshot; deterministic differ with **canonical `(type,id)` sort** + table-driven tests (incl. order-stability + error-isolation); token retention/prune (shipped at 30 days on app starts; since #247 a 270-day backstop that accepted pushes also refresh); **per-token notification-prefs store (per-category + `notifyRecoveries` + master `enabled`, defaults-on) + a deterministic per-(event × token) pref filter in `dispatchEvents` + `GET`/`PUT /api/push/prefs`**; graceful-disable path. (Secret-adjacent ⇒ requires Phase 0.)
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
- **Differ unit tests (Phase 4 gate):** table-driven fixtures asserting every transition row emits its event with correct severity, the no-change case yields `[]`, hysteresis prevents flapping, a first cycle with no snapshot pages only what is in trouble (#448; it was a silent baseline before), `unknown` never emits, the persisted snapshot survives a restart without re-firing active incidents, and **an order-stability case** where two differently-ordered logical-equivalent inputs yield a **byte-identical** canonically-`(type,id)`-sorted array.
- **Push error-isolation (Phase 4 gate):** a thrown error inside `dispatchEvents` does not propagate past `runBackgroundRefresh` and does not become an `unhandledRejection`; the snapshot is persisted only on a clean cycle; `bgRefreshRunning` clears normally.
- **Notification-prefs filtering (Phase 4 gate):** a category toggled off suppresses exactly that category's events for that token while other tokens with it on still receive them; `notifyRecoveries:false` suppresses `*_recovered`/`*_restored` only; `enabled:false` suppresses all; unset prefs deliver everything; the pref filter is a pure `(event,prefs)→bool` that does not perturb the canonical differ output.
- **Push graceful-disable:** with no FCM creds, boot succeeds, `runPushCycle()` is a no-op, `GET /api/push/status` → `{ enabled: false }`, `POST /api/push/register` → `{ stored: true, deliveryEnabled: false }`.
- **Push E2E (with creds):** induce a service down/up, host unreachable, UPS on-battery, cron failure; assert exactly one push per real transition, correct `data` payload, deep-link opens the right Incident detail; assert `UNREGISTERED`/`INVALID_ARGUMENT` tokens are pruned and transient errors are not; assert a token with no app start and no accepted push for 270 days is pruned, and one FCM keeps accepting is not (#247).
- **Mobile build / shell:** `npm run mobile:build` + `npx cap sync android` succeed; `@shared` imports resolve; `./gradlew assembleRelease` (or `cap build … APK`) produces a **signed** APK; sideload onto a device, complete first-run (URL + token → Keystore), Test & Connect reaches the Tailscale backend over **native HTTP**, all four tabs render over live data **with icons resolving** (no `https://localhost/api/icons` 404s).
- **Native secret-storage check:** assert the token is **absent** from `localStorage`/plain Preferences and present only via the secure-storage plugin; assert theme/last-tab persist via Preferences and survive a scheme change (the archetype-gap verification item).
- **Secret-floor regression (Phase 0 gate):** `secret-scan.py` flags a bare `-----BEGIN PRIVATE KEY-----`, a `"type": "service_account"` JSON, a key pasted into `*.example`, and a key in a lockfile/min.js; missing-scanner fails CI; the post-scrub tripwire raises `ScrubAmbiguityError` on a surviving PEM; **scanner and scrubber import the same `secret_rules.RULES`** (assert a rule added to the registry is seen by both). `scan.py --check` goes red if `scripts/secret-scan.py` or `scripts/secret_rules.py` is deleted or stubbed, or if the PEM/`service_account` content signatures are absent. The **template-tracked CI assertion** fails the build if any named `.example` is untracked.  <!-- pragma: allowlist secret -->
- **CORS/CSP:** with native HTTP (default), backend calls reach Express with no `CORS_ORIGIN` set and 304 caching works (native reads `ETag`); the tight mobile CSP (`connect-src 'self'`) blocks unexpected WebView `connect-src`. With the WebView-fetch fallback, `https://localhost` reaches the backend only with `CORS_ORIGIN` set and `exposedHeaders: ['ETag']`.

**Mandatory pre-done gate (HARD RULE):** after implementation, run **`/simplify`** then **`/security-review`** before calling any phase done — non-negotiable, every phase that ships code. The mobile PR path additionally runs `/code-review` + adversarial-reviewer + the Elrond agent-review job (advisory once the shared registry lands; disabled on secret-adjacent diffs before that); **the human merge gate is never bypassed** (Jag reviews and merges; no auto-merge, no push to main).