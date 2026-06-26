# Mobile Tailscale Login + Remember-Me Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the JagHelm mobile app's raw-token first-run with a username/password login over the tailnet, keep users signed in safely (token-only, never the password), self-heal on token expiry, and ship the app-icon fix in the same build.

**Architecture:** The phone reaches the JagHelm backend **directly over the tailnet** (user enters the backend URL at first run; OSS-generic, no IP shipped). Login posts to the existing `POST /api/auth/login {username,password}` → `{token}`; the token (not the password) is persisted in the Android Keystore via the existing `secureStore` seam. A shared, null-default **auth-expired hook** in `apiFetch` lets the mobile shell bounce to the login screen on any `401` (survives the backend's 24h non-renewing session + restart-kills-session). Cleartext-http to the tailnet is enabled in the Android network-security-config (capability) and **scoped to private/tailnet destinations at the JS layer** (Android can't CIDR-scope). "Keep me signed in" controls whether the token persists across launches.

**Tech Stack:** React 19 + Vite (mobile bundle `vite.config.mobile.js`), Capacitor 8.4.1, `capacitor-secure-storage-plugin` (Keystore), `@capacitor/preferences` (non-secret prefs), Vitest + React Testing Library (jsdom), `@capacitor/assets` for icon generation.

## Global Constraints

- **No password at rest, ever.** Only the JagHelm session token is persisted. (Security decision: token is scoped/expiring/revocable; password is a reusable master key.)
- **OSS-generic:** no hardcoded IP/hostname shipped. User enters the backend URL at first run.
- Token storage key `jaghelm-token` (`TOKEN_KEY`), base-url key `jaghelm-base-url` (`BASE_URL_KEY`) — both Keystore. Non-secret prefs go through `prefsAdapter` (Preferences), NEVER Keystore (the plugin's `removeItem` throws on a missing key — known M3a defect).
- Auth header is `x-auth-token` (NOT `Authorization`). Login route `/auth/login` is exempt from the header (apiFetch already skips it).
- Cleartext-http permitted only to **private/tailnet** destinations (100.64.0.0/10, RFC1918, loopback, single-label hosts, `*.ts.net`, tailnet IPv6 `fd7a:115c:a1e0::/48`). Public hosts must use https.
- Capacitor 8 ⇒ build toolchain JDK 21 (matches CI). Web bundle (`/api` relative base, localStorage) must stay byte-for-byte unchanged — only additive, null-default hooks touch shared code.
- Mobile tests run with `npm --prefix mobile test` (`vitest run --config vite.config.mobile.js`). Shared-code tests run with the root `npm test`.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `mobile/src/netGuard.js` | `isPrivateCleartextHost(host)` + `assertSafeBackendUrl(url)` — tailnet/private cleartext policy | **Create** |
| `mobile/src/login.js` | `login({url,username,password})` → POST `/auth/login`, returns `{ok,token,error,status}` | **Create** (replaces `connect.js`) |
| `mobile/src/runtimeConfig.js` | add `REMEMBER_KEY`; add `validateLogin({url,username,password,askUrl})` | **Modify** |
| `mobile/src/Login.jsx` | URL?(first-run) + username + password + "Keep me signed in"; persists token+url+remember | **Create** (replaces `FirstRun.jsx`) |
| `mobile/src/auth/authState.js` | tiny pub/sub holding `{logout, forgetDevice}` handlers the shell registers; consumed by settings | **Create** |
| `src/api/client.js` | add `setAuthExpiredHandler(fn)`; in `apiFetch`, invoke handler on protected-route `401` | **Modify** (shared; null-default = web unaffected) |
| `mobile/src/boot.js` | honor `REMEMBER_KEY` (clear token if off); revalidate token via `/auth/check`; return `{hasUrl,hasToken}` | **Modify** |
| `mobile/src/main.jsx` | 3-state Root (needs-url / needs-auth / authed); register auth-expired→needs-auth; register logout/forget | **Modify** |
| `mobile/src/views/NotificationSettings.jsx` | add "Log out" + "Forget this device" actions | **Modify** |
| `mobile/android/app/src/main/res/xml/network_security_config.xml` | enable cleartext capability (scoping is JS-layer) | **Create** |
| `mobile/android/app/src/main/AndroidManifest.xml` | reference `android:networkSecurityConfig` on `<application>` | **Modify** |
| `mobile/capacitor.config.ts` | (no functional change; keep `androidScheme:'https'`) | — |
| icon assets under `mobile/android/.../res/mipmap-*` + `mobile/assets/` | regenerated from `public/logo.svg` via `@capacitor/assets` | **Generate+commit** |
| `connect.js` + `connect`-based tests | removed (superseded by `login.js`) | **Delete** |

---

## Task 1: Tailnet cleartext guard (`netGuard.js`)

**Files:** Create `mobile/src/netGuard.js`; Test `mobile/src/netGuard.test.js`.

**Produces:** `isPrivateCleartextHost(host) -> boolean`, `assertSafeBackendUrl(rawUrl) -> void` (throws `Error('cleartext-public')` when http to a public host; passes https and private-http).

- [ ] **Step 1 — failing test** (`netGuard.test.js`): https public ok; http to `100.88.196.41` ok; http to `192.168.1.9` ok; http to `vm-101` (single-label) ok; http to `host.ts.net` ok; http to `8.8.8.8` throws; http to `example.com` throws; `127.0.0.1` ok.
- [ ] **Step 2 — run, expect FAIL** `npm --prefix mobile test -- netGuard`.
- [ ] **Step 3 — implement.** Parse with `new URL`. https/ws s → ok. For http: allow if host is loopback, single-label (no dot & not pure public IP), RFC1918 (`10.`, `192.168.`, `172.16–31.`), CGNAT/tailnet `100.64.0.0/10` (second octet 64–127), `*.ts.net`, or IPv6 in `fd7a:115c:a1e0::/48`/`::1`. Else throw `Error('cleartext-public')`.
- [ ] **Step 4 — run, expect PASS.**
- [ ] **Step 5 — commit** `feat(mobile): tailnet-scoped cleartext guard`.

## Task 2: `login()` over the tailnet (`login.js`)

**Files:** Create `mobile/src/login.js`; Test `mobile/src/login.test.js`. Delete `mobile/src/connect.js`.

**Consumes:** `normalizeBaseUrl` (runtimeConfig), `assertSafeBackendUrl` (Task 1), `apiFetch`/`setApiBase`/`setAuthToken` (shared client).
**Produces:** `login({url,username,password}) -> {ok, token?, error?, status?}`.

- [ ] **Step 1 — failing test:** mocks `apiFetch`. (a) 200 `{token:'abc'}` → `{ok:true,token:'abc'}` and calls `setApiBase`+`setAuthToken('abc')`; (b) 401 → `{ok:false,status:401,error:/invalid/i}`; (c) 429 → `{ok:false,status:429,error:/too many/i}`; (d) network throw → `{ok:false,error:<msg>}`; (e) noauth server returns `{token:'noauth'}` → `{ok:true,token:'noauth'}`; (f) public http URL → `{ok:false,error:/tailnet|https/i}` and does NOT fetch.
- [ ] **Step 2 — run, expect FAIL.**
- [ ] **Step 3 — implement:** `normalizeBaseUrl(url)` (catch→invalid-url error); `assertSafeBackendUrl(url)` (catch→cleartext error, no fetch); `setApiBase(base)`; `POST ${base}/auth/login` JSON `{username,password}`; on `!r.ok` map 401/429/other; parse `{token}`; `setAuthToken(token)`; return.
- [ ] **Step 4 — run, expect PASS.**
- [ ] **Step 5 — commit** `feat(mobile): username/password login over the tailnet`.

## Task 3: `validateLogin` + `REMEMBER_KEY` (`runtimeConfig.js`)

**Files:** Modify `mobile/src/runtimeConfig.js`; Test `mobile/src/runtimeConfig.test.js` (extend).

**Produces:** `REMEMBER_KEY='jaghelm-remember'` (pref); `validateLogin({url,username,password,askUrl}) -> {ok,errors}` (url validated only when `askUrl`; username+password required non-empty).

- [ ] Tests: askUrl=true + bad url → `errors.url`; empty username → `errors.username`; empty password → `errors.password`; askUrl=false skips url check; all good → `{ok:true}`.
- [ ] Implement, run FAIL→PASS, commit `feat(mobile): login field validation + remember pref key`.

## Task 4: shared auth-expired hook (`client.js`)

**Files:** Modify `src/api/client.js`; Test `src/api/client.test.js` (extend or create).

**Produces:** `setAuthExpiredHandler(fn|null)`; `apiFetch` invokes the handler once when a *protected* (`startsWith(base)`, not `/auth/login`, token set) response has `status===401`. Returns the response unchanged. Default handler null ⇒ web path byte-for-byte unchanged.

- [ ] Tests: protected 401 with handler set → handler called once, response returned; 200 → not called; `/auth/login` 401 → not called; no handler set → no throw (web). Guard against re-entrancy (don't call handler for the refetch).
- [ ] Implement (wrap the protected branch to inspect status via `.then`), run FAIL→PASS, commit `feat(api): null-default auth-expired hook for 401 self-heal`.

## Task 5: `Login.jsx` (first-run + re-auth) and delete `FirstRun.jsx`

**Files:** Create `mobile/src/Login.jsx`; Test `mobile/src/Login.test.jsx`. Delete `FirstRun.jsx`/`FirstRun.test.jsx`/`FirstRun.css`→rename to `Login.css`.

**Consumes:** `login` (Task 2), `validateLogin`+keys (Task 3), `secureStore`, `setPref`.
**Produces:** `<Login askUrl knownUrl onConnected />`. Renders URL field only when `askUrl`; always username+password + "Keep me signed in on this device" checkbox (default checked). On success: persist `TOKEN_KEY`, `BASE_URL_KEY` (normalized), `URL_PRESENT_KEY` breadcrumb, and `REMEMBER_KEY` ('true'/'false'); call `onConnected()`.

- [ ] Tests (mirror existing FirstRun.test patterns; mock `./login.js`, `secureStore.setItem`, `setPref`): validation blocks submit; success persists token+url+remember + calls onConnected; 401 shows error + no persist; creds-only mode (`askUrl=false`) doesn't render URL field and uses `knownUrl`.
- [ ] Implement, run FAIL→PASS, commit `feat(mobile): username/password login screen + keep-signed-in toggle`.

## Task 6: boot honors remember + revalidates (`boot.js`)

**Files:** Modify `mobile/src/boot.js`; Test `mobile/src/boot.test.js` (create).

**Produces:** `bootMobile() -> {hasUrl, hasToken}`. Reads base (hasUrl). If `REMEMBER_KEY!=='true'` → `removeItem(TOKEN_KEY)`+`setAuthToken('')`. `initAuthToken()`; if a token is present, `GET ${base}/auth/check`; `hasToken = authenticated`. On check network-failure, treat token as present-but-unverified=true (optimistic; the 401 hook self-heals) — but if remember was off, token already cleared so hasToken=false.

- [ ] Tests (mock secureStore/prefs/apiFetch/client): no url → `{hasUrl:false,hasToken:false}`; url+token+check 200 authenticated → `{true,true}`; url+token+check says not authenticated → `{true,false}` and token cleared; remember off → token removed, `{true,false}`.
- [ ] Implement, run FAIL→PASS, commit `feat(mobile): boot honors keep-signed-in + revalidates token`.

## Task 7: 3-state Root + auth handlers (`main.jsx`, `authState.js`)

**Files:** Create `mobile/src/auth/authState.js`; Modify `mobile/src/main.jsx`. Test `mobile/src/auth/authState.test.js`.

**Produces:** `authState` = `{ setHandlers({logout,forgetDevice}), logout(), forgetDevice() }` (simple module-level registry). Root state `{hasUrl,hasToken}`: `!hasUrl`→`<Login askUrl/>`; `hasUrl&&!hasToken`→`<Login askUrl={false} knownUrl/>`; else `<MobileApp/>`. Registers `setAuthExpiredHandler` → clear token + set `hasToken=false`. Registers `authState` handlers: `logout` = clear token + hasToken=false; `forgetDevice` = clear token+url+breadcrumb+remember + hasUrl=false.

- [ ] Tests for `authState` registry (set/dispatch). Root wiring verified via the settings test (Task 8) + manual.
- [ ] Implement, run FAIL→PASS, commit `feat(mobile): 3-state auth routing + expiry/logout handlers`.

## Task 8: Logout / Forget device in settings

**Files:** Modify `mobile/src/views/NotificationSettings.jsx`; Test alongside.

**Produces:** A "Session" section: "Log out" (calls `authState.logout()`), "Forget this device" (confirm → `authState.forgetDevice()`).

- [ ] Test: clicking Log out calls `authState.logout`; Forget calls `authState.forgetDevice`.
- [ ] Implement, run FAIL→PASS, commit `feat(mobile): log out / forget device controls`.

## Task 9: Android cleartext network-security-config

**Files:** Create `mobile/android/app/src/main/res/xml/network_security_config.xml`; Modify `AndroidManifest.xml`.

- [ ] `network_security_config.xml`: `<base-config cleartextTrafficPermitted="true">` with `<trust-anchors><certificates src="system"/></trust-anchors>` and a comment that **tailnet scoping is enforced in JS (`netGuard.js`)** because Android `<domain>` can't express CIDR.
- [ ] `AndroidManifest.xml`: add `android:networkSecurityConfig="@xml/network_security_config"` to `<application>`.
- [ ] Verify `npm --prefix mobile run build` + `cap sync android` succeeds (no Gradle build needed in-sandbox). Commit `feat(mobile): permit tailnet cleartext via network-security-config`.

## Task 10: App-icon (logo) regeneration

**Files:** ensure `@capacitor/assets` devDep; source `public/logo.svg`; output mipmaps + splash; commit generated assets.

- [ ] Rasterize `public/logo.svg` → `mobile/assets/icon.png` (1024²) + `splash.png` using `sharp`/`@resvg/resvg-js`/ImageMagick (rsvg/inkscape absent in sandbox). 
- [ ] `npx @capacitor/assets generate --android` (from `mobile/`), commit the regenerated `res/mipmap-*` + `res/drawable*` assets. Commit `feat(mobile): regenerate app icon from logo.svg`.

---

## Out of scope (follow-ups)
- **Backend long-lived revocable "remember-me" device token** (30-day, listed under active devices, revocable) — the *safe* way to skip login beyond the 24h session. Server change to `sessions.js` + a devices UI. Recommended next PR if Jag wants multi-day no-retype.
- **App-lock (biometric/PIN to open)** — optional convenience+security layer; adds a native biometric plugin.

## Self-Review notes
- Web byte-for-byte: only `client.js` touches shared code, additively (null-default hook). ✔
- No password persisted anywhere. ✔
- Cleartext scoped (JS guard) + capability (manifest). ✔
- Token expiry self-heals (boot revalidate + 401 hook + logout/forget). ✔
- Naming consistent: `TOKEN_KEY`/`BASE_URL_KEY`/`URL_PRESENT_KEY`/`REMEMBER_KEY`; `login()`, `assertSafeBackendUrl()`, `setAuthExpiredHandler()`, `authState`. ✔
