# JagHelm Mobile Phase 5 — Push Client + Notification Settings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the MOBILE-CLIENT half of push (the server pipeline shipped in Phase 4): install `@capacitor/push-notifications`, a fully unit-tested push module (permission → register → listeners → token POST to `/api/push/register`, `registrationError` handling, foreground receive), WORKING deep-link routing from a tapped notification's FCM `data` block into the in-app nav stack (via an FCM-id→derived-incident-id reconciler so taps land on the LIVE incident, plus a push-params fallback so host events and now-resolved incidents render a real detail instead of a dead "resolved" stub), the `jaghelm://incident/<id>` custom-URL-scheme deep-link path (`@capacitor/app` `appUrlOpen`, the primary OSS-build deep-link mechanism per DESIGN line 307), push-init wired into MobileApp mount (NOT boot), the Notification Settings screen (4 category toggles + notify-on-recovery + master switch over `GET/PUT /api/push/prefs`), the Alerts-tab header gear entry point, an in-app push-disable teardown (`DELETE /api/push/register`) wired to a dedicated "Turn off push on this device" control on the settings screen (the mobile shell has no logout flow — see Architecture), Android 13 `POST_NOTIFICATIONS` handling, and a final ROOT-CI verification task.

**Architecture:** A thin, injectable `push/` module isolates `@capacitor/push-notifications` behind testable seams (`initPush`, `registerPush`, `routeFromData`, `fcmIdToIncidentId`), mirroring how `prefsAdapter.js`/`keystoreAdapter.js` wrap their plugins. The push module obtains the FCM device token via the `registration` listener and POSTs it through the SAME `apiFetch` transport the data layer already uses (so `x-auth-token` is injected and native HTTP applies). **Deep-link routing is a PURE `(data, nav) -> void` mapper that RECONCILES the two id namespaces:** the FCM `data.id` (server format `NODE:SERVICEID` / `NODE:JOBID` / `NODE` / `NODE:METRIC` / literal `"ups"`) does NOT match mobile `deriveIncidents` ids (`service:<uid>` / `cron:<node>:<job>` / `ups:apcups`; verified `derive.js` lines 132/140/147), so `fcmIdToIncidentId(type, fcmId)` maps FCM ids onto the derived id space (service→`service:`+id, cron→`cron:`+id, ups→`ups:apcups`) and `routeFromData` pushes the screen with the RECONCILED `incidentId` plus the raw FCM `{ type, node, severity, fcmId }` as fallback render params. `IncidentDetail` looks up the live incident by the reconciled id (so a LIVE incident now matches — the headline fix) and, when none matches (host events, which `deriveIncidents` does NOT emit, OR a since-resolved incident), renders a genuine push-event detail from the fallback params instead of the dead "resolved" stub. **Deep links arrive by TWO paths, both terminating in `routeFromData`:** (A) `pushNotificationActionPerformed.notification.data` (a tray tap), and (B) the `jaghelm://incident/<id>` custom URL scheme via `@capacitor/app` `appUrlOpen` (DESIGN line 307/310 — the primary OSS-build path; the WebView origin stays `https://localhost` so DESIGN line 254's "don't use a custom *androidScheme*" caveat is respected — the deep-link URL scheme is a separate Android intent-filter, not the WebView origin). The Notification Settings screen reads/writes the server-mirrored prefs object (whose shape must byte-match the server's strict `validPrefsShape`) via a small `pushPrefsApi` client, with optimistic UI; it also hosts the **push-disable teardown** entry point (`disablePush` → `DELETE /api/push/register`). **Teardown call-site rationale:** the mobile shell has NO logout/disconnect flow (verified — `grep -rniE 'logout|signOut|disconnect' mobile/src/` returns nothing; `MobileApp.jsx` mounts when `configured===true` and never returns to a login gate; the shared `src/App.jsx` `handleLogout` is the DESKTOP/WEB path and is OUT of bounds under the mobile-only constraint). So DESIGN line 430's "DELETE on logout / push-disable" is honored via the in-app "push-disable" surface (a settings control), NOT by editing `src/App.jsx`. Non-secret device push state (FCM token, permission state) lives in `@capacitor/preferences` (throw-free), NEVER the Keystore — sidestepping the M3a `removeItem`-throws-on-missing defect. Desktop and Phases 1–4 stay byte-for-byte unchanged; **only `mobile/` files (plus the AndroidManifest intent-filter) change** — no shared `src/` edit.

**Tech Stack:** Capacitor 8.4.1 (`@capacitor/core` 8.4.1, `@capacitor/app` ^8.1.0, `@capacitor/preferences` ^8.0.1), NEW `@capacitor/push-notifications` ^8.1.1, Vite 8, React 19, Vitest 4 + `@testing-library/react` 16 (jsdom), `vi.hoisted()` plugin mocks. Android target/compile SDK 36, JDK 21.

## Global Constraints

- **Plugin version floor:** `@capacitor/push-notifications` MUST be a v8 major to pair with `@capacitor/core` 8.4.1 (the plugin's peer is `@capacitor/core >=8.0.0`). Pin `"@capacitor/push-notifications": "^8.1.1"` (current `latest`), consistent with `@capacitor/app ^8.1.0` / `@capacitor/preferences ^8.0.1`. **Do NOT** use a v7 or v9 major — a mismatched major breaks the native build/runtime.
- **Install + sync:** run `npm install @capacitor/push-notifications@^8.1.1` then `npx @capacitor/cli sync android` from `mobile/` (the shell does NOT auto-load `~/.bashrc`; prefix native steps with `source ~/.android-env`). `cap sync` registers the plugin's Java + pulls `firebase-messaging` transitively — forgetting it = "NativePlugin not implemented" at runtime. Gradle is ALREADY wired (top-level `classpath 'com.google.gms:google-services:4.4.4'` + the conditional `apply plugin` keyed on `google-services.json` presence in `android/app/build.gradle`); do NOT double-apply or hardcode the apply outside the try-block.
- **Token field is `value`, NOT `token`:** the `registration` callback yields `{ value: string }`. Reading `event.token` returns `undefined` — the single most common integration bug. On Android `value` IS the FCM token.
- **Listener ordering (HARD):** add the four listeners (`registration`, `registrationError`, `pushNotificationReceived`, `pushNotificationActionPerformed`) BEFORE calling `register()`. `register()` does NOT prompt and does NOT request permission — `requestPermissions()` must be called first and `receive === 'granted'` confirmed, or `register()` succeeds silently with nothing shown (the silent-failure trap). The `registration` event can fire immediately; a late listener loses the token.
- **Android 13+ `POST_NOTIFICATIONS`:** the app targets SDK 36, so `POST_NOTIFICATIONS` is a RUNTIME permission. `requestPermissions()` drives the dialog; on <13 it auto-grants. The plugin merges the `<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>` via manifest-merge — verify it lands after sync (the project `AndroidManifest.xml` currently only declares `INTERNET`).
- **Notification channel `jaghelm-incidents`:** the server payload sets `android.notification.channelId: "jaghelm-incidents"` and `priority: high` for `critical`. The client MUST create a matching channel (`PushNotifications.createChannel({ id: 'jaghelm-incidents', ... importance: 5 })`) at init, or critical pushes may be silent on Android 8+. Optionally also add the `default_notification_channel_id` / `default_notification_icon` `<meta-data>` to `AndroidManifest.xml`.
- **Two different "token" concepts — NEVER conflate:** the `x-auth-token` HEADER is the dashboard SESSION token (auth, injected by `apiFetch`); the `token` body/query field in push routes is the FCM DEVICE registration token. `GET /api/push/prefs?token=<T>` uses the FCM token as a query param; auth still rides the `x-auth-token` header. Query-string `?token=` is NOT an auth path.
- **Use `apiFetch` + `getApiBase()` for every push call** (`@shared/api/client.js`, `@shared/api/baseUrl.js`). Build URLs as `` `${getApiBase()}/push/register` `` so the `url.startsWith(base)` guard stays true and `x-auth-token` is injected. The mobile base always ends in `/api`. Do NOT roll a separate auth path or raw `fetch`.
- **`PUT /api/push/prefs` is a STRICT FULL-REPLACE, not a PATCH.** The body MUST be `{ token, prefs }` where `prefs` byte-matches `{ categories: { service, host, ups, cron }, notifyRecoveries, enabled }` — exactly those three top-level keys, exactly those four category keys, every value a boolean. Any extra/unknown/missing key → 400 `'malformed prefs'`. Best practice: GET first, mutate the returned object, PUT it back. `PUT` 404s `'token not found'` if the token was never registered — always POST `/register` before PUT. `GET /prefs` never 404s (returns `DEFAULT_PREFS` for unknown tokens).
- **Category key naming:** prefs schema keys are SINGULAR (`service`/`host`/`ups`/`cron`); UI labels are PLURAL (`Services`/`Hosts`/`UPS`/`Cron`). The screen maps plural labels → singular pref keys. CATEGORY_KEYS = `['service','host','ups','cron']` (server `tokenStore.js`).
- **FCM `data` values are ALL strings** (`String()`-coerced). The deep-link parser compares `data.type` against the 10 type strings and `data.severity` against `'critical'`/`'info'`/`'warning'` — never numbers/enums. The `data` block contains ONLY `{ type, id, node, severity }`. `title`/`body` live in `notification.title`/`notification.body` (OS-rendered); `prev`/`next` are NOT delivered — do not read them from `data`.
- **Non-secret push state → `@capacitor/preferences`, NEVER Keystore.** Store the FCM token, permission state, and any locally-mirrored prefs as NEW Preferences keys in `runtimeConfig.js` via `getPref`/`setPref`. This is the throw-free path that AVOIDS the **M3a** defect (`keystoreAdapter.removeItem` REJECTS on a missing key — `getItem` swallows it, `removeItem` does NOT — so clearing an absent secret throws). Phase 5 touches NO secrets, so `keystoreAdapter.js` does NOT change.
- **Push-disable teardown fires `DELETE /api/push/register { token }`** (token in the JSON BODY, with `Content-Type: application/json`) — hard removal of the registration. **Call-site (resolved):** the mobile shell has NO logout flow (the shared `src/App.jsx` `handleLogout` is the desktop/web path and is OUT of bounds under the mobile-only constraint), so DESIGN line 430's "DELETE on logout / push-disable" is wired to a dedicated **"Turn off push on this device"** control at the bottom of the NotificationSettings screen (Task 8b). This is DIFFERENT from the master toggle: master `enabled:false` is the SOFT path that fires only `PUT /api/push/prefs` (token KEPT, "so re-enabling needs no re-onboarding"). Do NOT fire DELETE on master-off; the explicit "Turn off push on this device" control is the ONLY in-app DELETE trigger.
- **Graceful-disable surface:** `GET /api/push/status` → `{ enabled: <bool> }` (key is `enabled`, NOT `isPushEnabled`); `false` under no-creds backend. The screen GRAYS OUT (shows "push unavailable") rather than failing silently. `POST /register` still returns `{ stored: true, deliveryEnabled: false }` so a later FCM enablement delivers without re-onboarding.
- **UX invariants (locked):** every tappable control is ≥44×44px; the screen must NOT show a false "all clear"/"push on" when status is unavailable; reuse the existing One Dark Pro design tokens from `mobile/src/MobileApp.css` / `src/styles/global.css` (CSS custom props: `--accent`, `--bg-card`, `--text-primary`, `--text-muted`, `--border-color`, `--card-radius-sm`, `--font-display`, `--space-*`). Mute affordances stay descoped from v1 (hidden, not shown disabled-and-broken). Safe-area insets respected.
- **Out of scope (do NOT implement):** Mute action; **verified `https` App Links ONLY** (`assetlinks.json` + `.well-known` host fingerprint is a per-self-hoster operator extra — the custom `jaghelm://incident/<id>` scheme IS in scope and IS built here, Tasks 6b + 12); real Firebase project changes; signed/release APK + keystore (Phase 6); the parallel-dispatch cap (that is SERVER-SIDE in Phase 4 `dispatch.js`, not a client concern); per-severity channels (single `jaghelm-incidents` channel); a dedicated white-on-transparent `@mipmap/push_icon` asset (Task 12 ships the FCM default-icon meta-data pointing at the existing `@mipmap/ic_launcher`; a bespoke push icon is a Phase-6 polish item, NOT shipped or referenced here). **IN scope and explicitly built (do NOT silently drop):** the `appUrlOpen` custom-scheme deep-link path (Task 6b + manifest intent-filter Task 12), the FCM-id→derived-id reconciler (Task 2a, consumed by 2b), host-event detail rendering (Task 2c), and the `disablePush` teardown WIRED to a settings control (Task 8b).
- **Tests:** Vitest (`describe/it/expect/vi`) under `mobile/`, jsdom, `globals:true`, `restoreMocks:true`, `setupFiles ['./src/testing/setup.js']`. Mock `@capacitor/push-notifications` with **`vi.hoisted()`** so the test holds handles to the mock fns referenced inside the hoisted `vi.mock` factory. Run mobile units with `npm test` from `mobile/` (i.e. `vitest run --config vite.config.mobile.js`).
- **PRE-DONE CI GATE (durable lesson from Phase 2/3 — HARD):** the final task verifies via the ROOT pipeline FROM REPO ROOT — `npm test` AND `npm run lint` AND `npm run test:client` — plus `npm --prefix mobile test`. Do NOT settle for `cd mobile && npm test`: the root `eslint .` and root suites sweep the whole repo (mobile included via flat config), and a mobile-only run misses lint/cross-cutting regressions. After implementation, run `/simplify` then `/security-review` before calling Phase 5 done. The human merge gate (Jag reviews + merges the PR) is never bypassed — no push to main, no auto-merge, no `Co-Authored-By` trailer.

---

## File Structure

Every path is relative to the repo root (`/home/ilaaj-agent/jaghelm`, or your worktree). NEW unless marked MODIFY.

| Path | Responsibility |
|---|---|
| `mobile/src/push/fcmIdToIncidentId.js` | PURE reconciler: `fcmIdToIncidentId(type, fcmId) -> string\|null` maps an FCM `data.id` (server namespace) onto a mobile `deriveIncidents` id (`service:`+id / `cron:`+id / `ups:apcups`); returns `null` for host events (no derived incident exists) so callers render from fallback params. No imports. |
| `mobile/src/push/routeFromData.js` | PURE deep-link mapper: `routeFromData(data, nav)` parses an FCM `data` block (`{type,id,node,severity}`), reconciles the id via `fcmIdToIncidentId`, and `nav.push('incident', { id: reconciledId, fcmId: data.id, type, node, severity })` (reconciled `id` drives the lookup; `fcmId`+`type`+`node`+`severity` are the fallback render params). No plugin import. |
| `mobile/src/push/pushPrefsApi.js` | Thin client over `apiFetch` + `getApiBase`: `getPushStatus()`, `getPushPrefs(token)`, `setPushPrefs(token, prefs)`, `registerToken(token)`, `deleteToken(token)`. Surfaces the server's `{ error }` body message on a non-2xx so callers can branch (400 'malformed prefs' vs 404 'token not found'). Keeps the screen + register module DRY. |
| `mobile/src/push/registerPush.js` | `initPush({ nav })` — checkPermissions → requestPermissions → (granted?) createChannel + add 4 plugin listeners + the `@capacitor/app` `appUrlOpen` listener (custom-scheme path B) + register; on `registration` persist token + POST `/push/register`; on `pushNotificationActionPerformed` and on `appUrlOpen` call `routeFromData`; on `registrationError`/`pushNotificationReceived` log. Exports `disablePush(token)` for teardown. |
| `mobile/src/push/routeFromUrl.js` | PURE: `routeFromUrl(url, nav)` parses a `jaghelm://incident/<fcmId>?type=&node=&severity=` deep-link URL into the same `{type,id,node,severity}` shape and delegates to `routeFromData`. No plugin import. |
| `mobile/src/views/NotificationSettings.jsx` | New pushed screen: 4 category toggles + notify-on-recovery + master switch; GET/PUT `/push/prefs`; reflects `GET /push/status` (grays out when unavailable); a "Turn off push on this device" control that fires `disablePush` (DELETE teardown); `BackHeader` + `nav.pop`. |
| `mobile/src/views/IncidentDetail.jsx` (MODIFY) | When no derived incident matches `params.id`, render a real push-event detail from the fallback params (`params.type`/`node`/`severity`/`fcmId`) — covers host events (never derived) AND since-resolved incidents — instead of the dead "This incident has resolved." stub. The live-incident path is unchanged. |
| `mobile/src/push/fcmIdToIncidentId.test.js` | Unit tests for the reconciler (service/cron/ups mappings, host→null, junk guard). |
| `mobile/src/push/routeFromData.test.js` | Unit tests for the deep-link mapper (all 10 types, reconciled id assertions, fallback params, junk guard). |
| `mobile/src/push/routeFromUrl.test.js` | Unit tests for the URL parser (well-formed `jaghelm://incident/<id>` with query params, junk guard). |
| `mobile/src/push/pushPrefsApi.test.js` | Unit tests for the API client (URL shapes, method/body, error message surfacing). |
| `mobile/src/push/registerPush.test.js` | Unit tests with `vi.hoisted()` plugin mock: permission flows, listener capture/invoke, token POST, error path, `appUrlOpen` routing, `disablePush` teardown. |
| `mobile/src/views/NotificationSettings.test.jsx` | Render tests: load prefs, optimistic toggle, PUT body shape, gray-out on unavailable, ≥44px controls (CSS-class smoke check), "Turn off push" fires `disablePush`. |
| `mobile/src/views/IncidentDetail.test.jsx` (MODIFY/append) | Append: a host-event / resolved-id push (no derived match) renders the fallback push-event detail (NOT the dead "resolved" stub); a live-incident match still renders the live detail. |
| `mobile/src/MobileApp.jsx` (MODIFY) | Import `NotificationSettings`; add `notificationSettings` to `SCREENS`; add a mount `useEffect(() => { initPush({ nav: navRef.current }); }, [])`. NOT in `ROOT`. |
| `mobile/src/views/Alerts.jsx` (MODIFY) | Enable the gear: drop `disabled`/`title="Coming soon"`, add `onClick={() => nav.push('notificationSettings')}`, fix `aria-label`. |
| `mobile/src/runtimeConfig.js` (MODIFY) | Add non-secret Preferences keys `PUSH_TOKEN_KEY`, `PUSH_PERM_KEY` (and `PUSH_PREFS_KEY` for fast first paint). |
| `mobile/src/MobileApp.css` (MODIFY) | `.alerts-gear` enabled state + NotificationSettings toggle-row + "turn off push" styles + push-event-detail styles (One Dark Pro tokens, ≥44px rows). |
| `mobile/package.json` (MODIFY) | Add `"@capacitor/push-notifications": "^8.1.1"` dependency. |
| `mobile/android/app/src/main/AndroidManifest.xml` (MODIFY) | `default_notification_channel_id` + `default_notification_icon` (`@mipmap/ic_launcher`) `<meta-data>` inside `<application>`; the `jaghelm` custom-scheme `<intent-filter>` (deep-link path B); verify `POST_NOTIFICATIONS` merged in. |

**NOT changed (already in place from Phase 2/4):** `capacitor.config.ts` already declares the `PushNotifications` plugin block (`appId io.jaghelm.app`); `android/app/google-services.json` is placed; the Gradle google-services plugin is wired; the server `/api/push/*` routes shipped in Phase 4. `keystoreAdapter.js` is NOT touched (push state is non-secret → Preferences, avoiding M3a).

---

## Build order

Leaf-first so each task's dependencies already exist:
1. **Install** the plugin (Task 1) — everything else imports it or sits behind a mock.
2. **`fcmIdToIncidentId`** (Task 2a) — pure, no imports; the id-namespace reconciler the deep-link mapper depends on.
3. **`routeFromData`** (Task 2b) — pure; consumes the reconciler; the deep-link contract (reconciled id + fallback params).
4. **`IncidentDetail` fallback render** (Task 2c) — renders host-events / resolved ids from the fallback params (no derived incident needed).
5. **`routeFromUrl`** (Task 2d) — pure; parses the `jaghelm://incident/<id>` custom-scheme URL into the data shape and delegates to `routeFromData`.
6. **`pushPrefsApi`** (Task 3) — pure-ish (mocks `apiFetch`); the 5 endpoint wrappers + error-message surfacing.
7. **`runtimeConfig` keys** (Task 4) — the Preferences keys `registerPush` persists into.
8. **`registerPush`** (Tasks 5–6 + 6b) — consumes `routeFromData`/`routeFromUrl` + `pushPrefsApi`; permission/register/teardown + the `appUrlOpen` listener (ADDED in Task 5's impl, ASSERTED in Task 6b), behind a `vi.hoisted()` plugin mock declared ONCE in Task 5.
9. **`NotificationSettings` screen** (Tasks 7–9, incl. 8b teardown control) — consumes `pushPrefsApi` + `disablePush`; load/optimistic-toggle/gray-out/turn-off.
10. **Wiring** (Tasks 10–11) — `Alerts.jsx` (gear, with the obsolete disabled-gear test deleted) and `MobileApp.jsx` (SCREENS + init effect, with the existing MobileApp tests' new mocks).
11. **Android manifest/channel/intent-filter** (Task 12) — channel meta-data + `jaghelm` scheme intent-filter + `POST_NOTIFICATIONS` verify + `cap sync`.
12. **Root-CI gate** (Task 13) — the durable full-pipeline verification.

---

## Locked design decisions (controller, 2026-06-26)

These resolve the spec's `openQuestions` so no task is blocked. Tasks below already reflect them.

1. **`initPush()` runs on `MobileApp` mount (configured state), once.** Not in `boot.js` (an unconfigured cold start has no base URL/auth token, so a register call has nothing to POST to). MobileApp only mounts when `configured===true`, so `setApiBase()` + `initAuthToken()` have already run. A mount `useEffect(() => { initPush({ nav }); }, [])` is the slot (third effect alongside the LAST_TAB restore and hardware-back).
2. **All event types deep-link to the SAME `incident` screen.** There is no per-type destination divergence — the screen is selected by the RECONCILED incident id; `type`/`severity`/`node`/`fcmId` ride along as fallback render params. `routeFromData` is a pure `(data, nav)` mapper.
3. **FCM `data.id` ≠ mobile `deriveIncidents` id — so the deep link MUST RECONCILE, not pass `data.id` through.** The server sends `id` as `NODE:SERVICEID` / `NODE:JOBID` / `NODE` / `NODE:METRIC` / literal `"ups"`; mobile `deriveIncidents` builds `service:<uid>` / `cron:<node>:<job>` / `ups:apcups` (`uid` IS `NODE:SERVICEID`, so `service:`+`data.id` matches; verified `derive.js` 132/140/147 + Alerts.test `service:vm-101:gitea`). Passing `data.id` straight through would NEVER match `IncidentDetail`'s `incidents.find(i => i.id === params.id)` — even for a LIVE incident — landing EVERY tap in the dead "resolved" stub. So `fcmIdToIncidentId(type, fcmId)` (Task 2a) maps onto the derived id space: `service_*` → `service:`+fcmId; `cron_*` → `cron:`+fcmId; `ups_*` → the fixed literal `ups:apcups`; **host_* → `null`** (mobile `deriveIncidents` emits NO host incident — grep `derive.js` for `host` returns nothing). `routeFromData` pushes `{ id: reconciledId, fcmId, type, node, severity }`. `IncidentDetail` (Task 2c) looks up the LIVE incident by the reconciled `id` (so live service/cron/ups taps now open the real incident — the headline fix), and when none matches (host events, which have no derived incident; OR a since-resolved incident) renders a real push-event detail from the fallback params instead of the dead stub. The reconciler + host-fallback are IN Phase 5 — NOT deferred. (The event-type strings used here are the Phase-4 differ's ACTUAL 10 strings — see the contract — NOT DESIGN.md line 511's stale `host_down`/`ups_onbattery`.)
4. **Master toggle OFF fires ONLY `PUT /push/prefs` (`enabled:false`), token KEPT.** It does NOT fire DELETE. DELETE is reserved for logout / explicit push-disable teardown (`disablePush`). Per the contract, master-off is the soft mute-everything path so re-enabling needs no re-onboarding.
5. **The screen obtains the device FCM token from Preferences (`PUSH_TOKEN_KEY`), written by `registerPush` on the `registration` event.** GET/PUT `/push/prefs` need the FCM token as the `?token=`/body field; the screen reads it via `getPref(PUSH_TOKEN_KEY)`. If absent (permission denied / not yet registered), the screen shows the unavailable state.
6. **Deny is terminal for Phase 5: `initPush` early-returns (gracefully disabled), and the settings screen surfaces an "Enable notifications in system settings" hint when permission is `denied`.** No in-app re-prompt loop. Foreground `pushNotificationReceived` logs only (no toast UI in v1 — toast styling/tap behavior is unspecified; logging keeps it deterministic and testable; the deep-link path is `pushNotificationActionPerformed` only).
7. **Single notification channel `jaghelm-incidents`, importance 5 (max).** Created at init via `createChannel`; matches the server `android.notification.channelId`. No per-severity channels.
8. **Two deep-link paths, both into `routeFromData`.** Path A: `pushNotificationActionPerformed.notification.data` (tray tap). Path B: the `jaghelm://incident/<fcmId>?type=&node=&severity=` custom URL scheme via `@capacitor/app` `App.addListener('appUrlOpen', e => routeFromUrl(e.url, nav))` (DESIGN line 307 — the PRIMARY OSS-build deep-link mechanism, since verified `https` App Links need per-self-hoster `assetlinks.json`). `routeFromUrl` parses the URL into the `{type,id,node,severity}` shape and delegates to `routeFromData`, so both paths reconcile ids identically. This is NOT a custom `androidScheme` (DESIGN line 254's caveat is about the WebView ORIGIN scheme, which stays `https://localhost` per `capacitor.config.ts`); the `jaghelm` scheme is a separate Android `<intent-filter>` (Task 12). The `appUrlOpen` listener is added inside `initPush` alongside the four plugin listeners (in Task 5's impl) and its routing is asserted in Task 6b.
9. **Push-disable teardown (`DELETE /api/push/register`) is wired to a settings control, NOT a logout flow.** The mobile shell has no logout/disconnect path (verified — see Architecture), and editing the shared `src/App.jsx` would violate the mobile-only constraint. So `disablePush(token)` is invoked by an explicit "Turn off push on this device" control at the bottom of NotificationSettings (Task 8b). After teardown the screen drops to the unavailable/"not registered" state (the FCM token is cleared). This satisfies DESIGN line 430's "DELETE on logout / push-disable" via the push-disable surface. `disablePush` is therefore LIVE-wired, not dead code.

---

## Task 1: Install `@capacitor/push-notifications` (v8) + sync

**Files:**
- Modify: `mobile/package.json` (add the dependency)
- Native: `mobile/android/` (regenerated by `cap sync`)

**Interfaces:**
- Produces: `@capacitor/push-notifications` importable as `import { PushNotifications } from '@capacitor/push-notifications';`; native plugin registered + `firebase-messaging` pulled transitively.
- Consumes: existing `@capacitor/core` 8.4.1 (peer), `android/app/google-services.json` (present), wired Gradle google-services plugin.

- [ ] **Step 1: Install + verify the version floor.** From `mobile/`:
  `npm install @capacitor/push-notifications@^8.1.1`
  Then confirm the resolved major is 8 and the dep line is present:
  `node -e "const p=require('./package.json'); const v=p.dependencies['@capacitor/push-notifications']; if(!/^\^?8\./.test(v)) { console.error('BAD version '+v); process.exit(1);} console.log('ok',v)"`
  Expected: `ok ^8.1.1` (or the resolved 8.x). A non-8 major MUST fail this check.

- [ ] **Step 2: Sync the native project.** From `mobile/` (native step — prefix env):
  `source ~/.android-env && npx @capacitor/cli sync android`
  Expected: sync succeeds; the plugin's Java registers; `firebase-messaging` appears in the resolved Android deps. `POST_NOTIFICATIONS` manifest-merge verification is NOT done here — it is declared EXPLICITLY in the source manifest in Task 12 (so it does not depend on a possibly-unrunnable merged-manifest inspection in this sandbox). Do NOT add a `|| echo`-style no-op gate here; the deterministic `POST_NOTIFICATIONS` check lives in Task 12 Step 3 (source-manifest grep, runnable in-sandbox). If `cap sync` itself cannot complete in this sandbox (no full Android SDK at this point), STATE that in the PR and defer the sync to Task 12's human-handoff — do NOT mark this step done from a failed/skipped sync.

- [ ] **Step 3: Confirm the existing suite still green (no import yet, additive dep only).** From `mobile/`:
  `npm test`
  Expected: PASS (the new dep is not imported anywhere yet; nothing should change).

- [ ] **Step 4: Commit.**
  `git add mobile/package.json mobile/package-lock.json mobile/android && git commit -m "feat(mobile): add @capacitor/push-notifications ^8.1.1 and sync android"`

---

## Task 2a: `fcmIdToIncidentId` — pure FCM-id → derived-incident-id reconciler

**Files:**
- Create: `mobile/src/push/fcmIdToIncidentId.js`
- Test: `mobile/src/push/fcmIdToIncidentId.test.js`

**Interfaces:**
- Produces: `fcmIdToIncidentId(type, fcmId) -> string | null` — maps an FCM `data.id` (server namespace) onto the mobile `deriveIncidents` id namespace so a live incident actually matches. Mapping (verified `derive.js` 132/140/147 + `Alerts.test` `service:vm-101:gitea`):
  - `service_down`/`service_recovered` → `` `service:${fcmId}` `` (FCM id is `NODE:SERVICEID`, which IS `svc.uid`; derived id is `service:<uid>`).
  - `cron_failed`/`cron_recovered` → `` `cron:${fcmId}` `` (FCM id is `NODE:JOBID`; derived id is `cron:<node>:<job>`).
  - `ups_on_battery`/`ups_restored` → the FIXED literal `'ups:apcups'` (derive.js line 140 hard-codes it; FCM id is the literal `"ups"`).
  - `host_unreachable`/`host_recovered`/`host_threshold`/`host_threshold_cleared` → `null` (mobile `deriveIncidents` emits NO host incident — grep `derive.js` for `host` returns nothing; the caller renders host events from the fallback params).
  - unknown type or missing/empty `fcmId` → `null` (defensive).
- Consumes: nothing (pure string mapping).

> The four "type families" are keyed on the `type.split('_')[0]` prefix the server's `categoryOf` uses (`service`/`host`/`ups`/`cron`), NOT the full 10-string enum — so a new differ type within a known family maps without a code change, while host stays explicitly `null`.

- [ ] **Step 1: Write failing test.** Create `mobile/src/push/fcmIdToIncidentId.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { fcmIdToIncidentId } from './fcmIdToIncidentId.js';

describe('fcmIdToIncidentId', () => {
  it('maps service events onto the derived service:<uid> id', () => {
    expect(fcmIdToIncidentId('service_down', 'vm-101:nginx')).toBe('service:vm-101:nginx');
    expect(fcmIdToIncidentId('service_recovered', 'vm-101:gitea')).toBe('service:vm-101:gitea');
  });

  it('maps cron events onto the derived cron:<node>:<job> id', () => {
    expect(fcmIdToIncidentId('cron_failed', 'vm-101:backup')).toBe('cron:vm-101:backup');
    expect(fcmIdToIncidentId('cron_recovered', 'vm-102:rotate')).toBe('cron:vm-102:rotate');
  });

  it('maps ups events onto the fixed literal ups:apcups (ignores the fcm id)', () => {
    expect(fcmIdToIncidentId('ups_on_battery', 'ups')).toBe('ups:apcups');
    expect(fcmIdToIncidentId('ups_restored', 'ups')).toBe('ups:apcups');
  });

  it('returns null for ALL host events (no derived host incident exists)', () => {
    for (const t of ['host_unreachable', 'host_recovered', 'host_threshold', 'host_threshold_cleared']) {
      expect(fcmIdToIncidentId(t, 'vm-101')).toBeNull();
      expect(fcmIdToIncidentId(t, 'vm-101:cpu')).toBeNull();
    }
  });

  it('is defensive: unknown type or missing/empty id returns null', () => {
    expect(fcmIdToIncidentId('mystery_event', 'x')).toBeNull();
    expect(fcmIdToIncidentId('service_down', '')).toBeNull();
    expect(fcmIdToIncidentId('service_down', undefined)).toBeNull();
    expect(fcmIdToIncidentId(undefined, 'x')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it — Expected: FAIL** (`Cannot find module './fcmIdToIncidentId.js'`):
  `npm test -- fcmIdToIncidentId`

- [ ] **Step 3: Minimal impl.** Create `mobile/src/push/fcmIdToIncidentId.js`:
```js
/**
 * Pure reconciler from the FCM `data.id` namespace (server) to the mobile
 * `deriveIncidents` id namespace (derive.js). The two are incompatible by
 * construction, so passing `data.id` straight to IncidentDetail's
 * `incidents.find(i => i.id === params.id)` would NEVER match — even a LIVE
 * incident. This maps them:
 *   - service_* -> `service:${fcmId}`  (FCM id NODE:SERVICEID === svc.uid;
 *                                       derive.js builds `service:${svc.uid}`)
 *   - cron_*    -> `cron:${fcmId}`     (FCM id NODE:JOBID; derive builds
 *                                       `cron:${node}:${job}`)
 *   - ups_*     -> 'ups:apcups'        (derive.js hard-codes this literal id)
 *   - host_*    -> null                (derive.js emits NO host incident; the
 *                                       caller renders host events from the
 *                                       fallback push params instead)
 *
 * @param {string} type   one of the 10 differ event types
 * @param {string} fcmId  the FCM `data.id`
 * @returns {string|null} the derived incident id, or null when no derived
 *   incident can exist (host events) / on malformed input
 */
export function fcmIdToIncidentId(type, fcmId) {
  if (typeof type !== 'string' || typeof fcmId !== 'string' || fcmId === '') return null;
  const family = type.split('_')[0]; // service|host|ups|cron (matches server categoryOf)
  switch (family) {
    case 'service':
      return `service:${fcmId}`;
    case 'cron':
      return `cron:${fcmId}`;
    case 'ups':
      return 'ups:apcups'; // derive.js line 140: the UPS incident id is a fixed literal
    case 'host':
      return null; // no derived host incident — render from fallback params
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run it — Expected: PASS:**
  `npm test -- fcmIdToIncidentId`

- [ ] **Step 5: Commit.**
  `git add mobile/src/push/fcmIdToIncidentId.js mobile/src/push/fcmIdToIncidentId.test.js && git commit -m "feat(mobile): reconcile FCM data.id to derived incident id namespace"`

---

## Task 2b: `routeFromData` — pure FCM-data → nav deep-link mapper (reconciled)

**Files:**
- Create: `mobile/src/push/routeFromData.js`
- Test: `mobile/src/push/routeFromData.test.js`

**Interfaces:**
- Produces: `routeFromData(data, nav) -> void` — PURE w.r.t. side effects beyond the one injected `nav.push`. Given an FCM `data` block it reconciles the id via `fcmIdToIncidentId(type, id)` and calls `nav.push('incident', { id: reconciledId, fcmId: data.id, type, node, severity })`. The RECONCILED `id` drives `IncidentDetail`'s live-incident lookup; `fcmId`/`type`/`node`/`severity` are the fallback render params (used when no live incident matches — host events and since-resolved incidents). Returns early (no push) when `data` is missing/`null` or `data.id` is absent/empty (defensive — never crash on a malformed payload). For host events the reconciled `id` is `null`, which is intentional — IncidentDetail renders the fallback detail.
- Consumes: `./fcmIdToIncidentId.js`; `data` = the FCM data payload `{ type: string, id: string, node: string, severity: 'critical'|'info'|'warning' }` (ALL string values); `nav` = the `useNavStack` object with `push(screen, params)`.

- [ ] **Step 1: Write failing test.** Create `mobile/src/push/routeFromData.test.js`:
```js
import { describe, it, expect, vi } from 'vitest';
import { routeFromData } from './routeFromData.js';

describe('routeFromData', () => {
  it('routes a live service_down to the RECONCILED service:<uid> id (so the live incident matches)', () => {
    const nav = { push: vi.fn() };
    routeFromData(
      { type: 'service_down', id: 'vm-101:nginx', node: 'vm-101', severity: 'critical' },
      nav,
    );
    expect(nav.push).toHaveBeenCalledTimes(1);
    expect(nav.push).toHaveBeenCalledWith('incident', {
      id: 'service:vm-101:nginx', // RECONCILED, not the raw data.id
      fcmId: 'vm-101:nginx',
      type: 'service_down',
      node: 'vm-101',
      severity: 'critical',
    });
  });

  it('reconciles cron and ups ids onto the derived namespace', () => {
    const nav = { push: vi.fn() };
    routeFromData({ type: 'cron_failed', id: 'vm-101:backup', node: 'vm-101', severity: 'warning' }, nav);
    expect(nav.push).toHaveBeenCalledWith('incident', expect.objectContaining({ id: 'cron:vm-101:backup', fcmId: 'vm-101:backup' }));
    const nav2 = { push: vi.fn() };
    routeFromData({ type: 'ups_on_battery', id: 'ups', node: 'ups', severity: 'critical' }, nav2);
    expect(nav2.push).toHaveBeenCalledWith('incident', expect.objectContaining({ id: 'ups:apcups', fcmId: 'ups' }));
  });

  it('host events push with id:null (IncidentDetail renders from fallback params) but keep fcmId/type/node', () => {
    const nav = { push: vi.fn() };
    routeFromData({ type: 'host_unreachable', id: 'vm-101', node: 'vm-101', severity: 'critical' }, nav);
    expect(nav.push).toHaveBeenCalledWith('incident', {
      id: null,
      fcmId: 'vm-101',
      type: 'host_unreachable',
      node: 'vm-101',
      severity: 'critical',
    });
    const nav2 = { push: vi.fn() };
    routeFromData({ type: 'host_threshold', id: 'vm-101:cpu', node: 'vm-101', severity: 'warning' }, nav2);
    expect(nav2.push).toHaveBeenCalledWith('incident', expect.objectContaining({ id: null, fcmId: 'vm-101:cpu', type: 'host_threshold' }));
  });

  it('is defensive: missing/null data or missing id does NOT push (no crash)', () => {
    const nav = { push: vi.fn() };
    routeFromData(null, nav);
    routeFromData(undefined, nav);
    routeFromData({}, nav);
    routeFromData({ type: 'service_down', id: '', node: 'n', severity: 'critical' }, nav);
    expect(nav.push).not.toHaveBeenCalled();
  });

  it('tolerates an absent node (passes through whatever is sent)', () => {
    const nav = { push: vi.fn() };
    routeFromData({ type: 'service_down', id: 'vm-101:nginx', severity: 'critical' }, nav);
    expect(nav.push).toHaveBeenCalledWith('incident', {
      id: 'service:vm-101:nginx',
      fcmId: 'vm-101:nginx',
      type: 'service_down',
      node: undefined,
      severity: 'critical',
    });
  });
});
```

- [ ] **Step 2: Run it — Expected: FAIL** (`Cannot find module './routeFromData.js'`):
  `npm test -- routeFromData`

- [ ] **Step 3: Minimal impl.** Create `mobile/src/push/routeFromData.js`:
```js
/**
 * Pure deep-link mapper from a tapped push's FCM `data` block into the in-app
 * nav stack. DESIGN.md routes ALL event types to the SAME Incident detail
 * screen. The FCM data payload carries ONLY { type, id, node, severity }, all
 * STRING values.
 *
 * The FCM `data.id` namespace (NODE:SERVICEID / NODE:JOBID / NODE / NODE:METRIC
 * / literal "ups") is INCOMPATIBLE with mobile `deriveIncidents` ids, so we
 * RECONCILE via fcmIdToIncidentId before pushing — otherwise IncidentDetail's
 * `incidents.find(i => i.id === params.id)` would never match, even a LIVE
 * incident. The reconciled `id` drives the lookup; `fcmId`/`type`/`node`/
 * `severity` are passed as fallback render params for events with no derived
 * incident (host events) or a since-resolved id.
 *
 * Defensive: a missing/null payload or empty id is a no-op.
 *
 * @param {{ type?: string, id?: string, node?: string, severity?: string }} data
 * @param {{ push: (screen: string, params: object) => void }} nav
 */
import { fcmIdToIncidentId } from './fcmIdToIncidentId.js';

export function routeFromData(data, nav) {
  if (!data || typeof data.id !== 'string' || data.id === '') return;
  nav.push('incident', {
    id: fcmIdToIncidentId(data.type, data.id), // reconciled (null for host events)
    fcmId: data.id,
    type: data.type,
    node: data.node,
    severity: data.severity,
  });
}
```

- [ ] **Step 4: Run it — Expected: PASS:**
  `npm test -- routeFromData`

- [ ] **Step 5: Commit.**
  `git add mobile/src/push/routeFromData.js mobile/src/push/routeFromData.test.js && git commit -m "feat(mobile): reconciled FCM-data deep-link mapper to incident screen"`

---

## Task 2c: `IncidentDetail` — render host-event / resolved-id pushes from fallback params

**Files:**
- Modify: `mobile/src/views/IncidentDetail.jsx`
- Test: `mobile/src/views/IncidentDetail.test.jsx` (append, or create if absent)

**Interfaces:**
- Produces: when `incidents.find(i => i.id === params.id)` finds NO live incident (because `params.id` is `null` for host events, or the incident has since resolved), IncidentDetail renders a real push-event detail built from `params` (`type`, `node`, `severity`, `fcmId`) — a title derived from the type, a node line, and a severity line — instead of the dead "This incident has resolved." stub. The LIVE-incident path is BYTE-UNCHANGED. When there are no fallback params either (e.g. a stale nav state with neither a live incident nor push params), keep the existing "resolved" copy as the final fallback.
- Consumes: `params` from `routeFromData` (`{ id, fcmId, type, node, severity }`); existing `deriveIncidents`, `BackHeader`, `StatusDot`.

> Phase 5 makes the deep link land somewhere REAL for every event family. Host events have no derived incident by design (mobile derives incidents only from down services / on-battery UPS / failing cron), so they MUST render from the push params — this is the in-scope host-event representation the review flagged as missing.

- [ ] **Step 1: Write failing test.** `mobile/src/views/IncidentDetail.test.jsx` ALREADY EXISTS (it imports `IncidentDetail`, `render/screen/fireEvent`, `describe/it/expect/vi/beforeEach`, and defines a `DATA` fixture; verified). Do NOT re-import or re-declare those — APPEND a NEW top-level `describe` block ONLY (it reuses the file-scope imports; define its own local fixtures with distinct names so they don't clash with `DATA`):
```jsx
// APPEND below the existing describe('IncidentDetail', ...) block — no new imports.
describe('IncidentDetail push-event fallback (Phase 5)', () => {
  const liveData = {
    servicesBody: { nodes: { 'vm-101': { display_name: 'VM 101', services: [
      { uid: 'vm-101:nginx', display_name: 'nginx', status: 'down', uptime24: 0.5, url: '' },
    ] } } },
    ups: { status: 1 }, cron: [],
  };
  const calmData = { servicesBody: { nodes: {} }, ups: { status: 1 }, cron: [] };

  it('renders a host-event push from fallback params when no derived incident exists (NOT the resolved stub)', () => {
    render(
      <IncidentDetail
        nav={{ pop: vi.fn() }}
        data={calmData}
        params={{ id: null, fcmId: 'vm-101', type: 'host_unreachable', node: 'vm-101', severity: 'critical' }}
      />,
    );
    expect(screen.queryByText(/This incident has resolved/i)).toBeNull();
    expect(screen.getByText('vm-101')).toBeInTheDocument();
    expect(screen.getByText(/host unreachable/i)).toBeInTheDocument();
    expect(screen.getByText(/critical/i)).toBeInTheDocument();
  });

  it('still renders the LIVE incident when the reconciled id matches (path unchanged)', () => {
    render(
      <IncidentDetail
        nav={{ pop: vi.fn() }}
        data={liveData}
        params={{ id: 'service:vm-101:nginx', fcmId: 'vm-101:nginx', type: 'service_down', node: 'vm-101', severity: 'critical' }}
      />,
    );
    expect(screen.getByText('nginx')).toBeInTheDocument(); // live incident title (display_name)
    expect(screen.queryByText(/This incident has resolved/i)).toBeNull();
  });

  it('falls back to the resolved copy ONLY when there is neither a live incident nor push params', () => {
    render(<IncidentDetail nav={{ pop: vi.fn() }} data={calmData} params={{ id: 'service:gone' }} />);
    expect(screen.getByText(/This incident has resolved/i)).toBeInTheDocument();
  });
});
```
> The EXISTING test at line 79–82 (`handles a resolved/stale incident id gracefully`, `params={{ id: 'service:gone:x' }}`, no `params.type`) STILL PASSES under the new impl — with no `params.type` the fallback branch is skipped and the "resolved" stub renders, exactly as before. The two live-incident tests (which reference the unchanged "Push sent"/"Detected" timeline rows) are also unaffected. So this task ADDS coverage without breaking the existing five tests.

- [ ] **Step 2: Run it — Expected: FAIL** (the new host-event test hits the "resolved" stub until the impl adds the fallback branch; the existing five tests stay GREEN):
  `npm test -- IncidentDetail`

- [ ] **Step 3: Minimal impl.** In `mobile/src/views/IncidentDetail.jsx`, replace the `if (!incident) { ... }` block:
```jsx
  if (!incident) {
    // No live derived incident. If the deep-link carried push-event params
    // (host events have NO derived incident by design; or the incident has
    // since resolved), render a real push-event detail from those params
    // instead of a dead stub. Only when there are no params either do we show
    // the resolved copy.
    if (params.type) {
      const title = humanizeType(params.type);
      return (
        <section className="mobile-view" aria-label="Incident detail">
          {/* title is in the header only (do NOT also repeat it in a <p>, or a
              getByText(/host unreachable/i) query would match twice). */}
          <BackHeader title={title} onBack={nav.pop} />
          <div className="detail-head">
            <StatusDot status={params.severity === 'info' ? 'up' : 'down'} />
            <span className="detail-head__node">{params.node || params.fcmId}</span>
          </div>
          {params.severity && (
            <p className="push-event__severity">Severity: {params.severity}</p>
          )}
          <p className="push-event__note">
            Live status for this event is not in the current snapshot — it may have resolved.
          </p>
        </section>
      );
    }
    return (
      <section className="mobile-view" aria-label="Incident detail">
        <BackHeader title="Incident" onBack={nav.pop} />
        <p className="mobile-view__todo">This incident has resolved.</p>
      </section>
    );
  }
```
And add the helper above the component (turns `host_unreachable` → "Host unreachable", etc.):
```jsx
// Turn a differ event type ('host_unreachable') into a human title ('Host unreachable').
function humanizeType(type) {
  const s = String(type || '').replace(/_/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Incident';
}
```

- [ ] **Step 4: Run it — Expected: PASS:**
  `npm test -- IncidentDetail`

- [ ] **Step 5: Commit.**
  `git add mobile/src/views/IncidentDetail.jsx mobile/src/views/IncidentDetail.test.jsx && git commit -m "feat(mobile): render host-event/resolved push deep-links from fallback params"`

---

## Task 2d: `routeFromUrl` — parse the `jaghelm://incident/<id>` custom-scheme deep link

**Files:**
- Create: `mobile/src/push/routeFromUrl.js`
- Test: `mobile/src/push/routeFromUrl.test.js`

**Interfaces:**
- Produces: `routeFromUrl(url, nav) -> void` — PURE parser for the custom-scheme deep link `jaghelm://incident/<fcmId>?type=<t>&node=<n>&severity=<s>` (DESIGN line 307). Extracts `fcmId` (the path segment after `incident/`, `decodeURIComponent`'d) + `type`/`node`/`severity` query params, assembles the `{ type, id: fcmId, node, severity }` FCM-data shape, and delegates to `routeFromData` (so the SAME reconciler + fallback logic runs for both deep-link paths). Returns early (no nav) on a URL that is not a `jaghelm://incident/...` link or has no id segment (defensive).
- Consumes: `./routeFromData.js`; `url` (string from `appUrlOpen`); `nav`.

> Per DESIGN line 310 the listener body is `routeTo(e.url.split('://').pop())` → here we parse the full URL robustly (path + query) so the same `{type,node,severity}` fallback params survive the URL round-trip. The server/notification builder emits the deep-link URL with these query params when it targets the scheme; if absent, the screen still renders from `type` alone.

- [ ] **Step 1: Write failing test.** Create `mobile/src/push/routeFromUrl.test.js`:
```js
import { describe, it, expect, vi } from 'vitest';
import { routeFromUrl } from './routeFromUrl.js';
import { routeFromData } from './routeFromData.js';
vi.mock('./routeFromData.js', () => ({ routeFromData: vi.fn() }));

describe('routeFromUrl', () => {
  it('parses jaghelm://incident/<id> with query params into the data shape and delegates', () => {
    const nav = { push: vi.fn() };
    routeFromUrl('jaghelm://incident/vm-101%3Anginx?type=service_down&node=vm-101&severity=critical', nav);
    expect(routeFromData).toHaveBeenCalledWith(
      { type: 'service_down', id: 'vm-101:nginx', node: 'vm-101', severity: 'critical' },
      nav,
    );
  });

  it('parses a host deep link (colon-less id)', () => {
    const nav = { push: vi.fn() };
    routeFromUrl('jaghelm://incident/vm-101?type=host_unreachable&node=vm-101&severity=critical', nav);
    expect(routeFromData).toHaveBeenCalledWith(
      { type: 'host_unreachable', id: 'vm-101', node: 'vm-101', severity: 'critical' },
      nav,
    );
  });

  it('is defensive: a non-incident or id-less url does NOT delegate', () => {
    const nav = { push: vi.fn() };
    routeFromUrl('jaghelm://settings', nav);
    routeFromUrl('https://example.com/incident/x', nav);
    routeFromUrl('jaghelm://incident/', nav);
    routeFromUrl('', nav);
    routeFromUrl(undefined, nav);
    expect(routeFromData).not.toHaveBeenCalled();
  });
});
```
(Reset the mock in a `beforeEach` if you add more cases; `restoreMocks:true` clears call history between tests.)

- [ ] **Step 2: Run it — Expected: FAIL** (`Cannot find module './routeFromUrl.js'`):
  `npm test -- routeFromUrl`

- [ ] **Step 3: Minimal impl.** Create `mobile/src/push/routeFromUrl.js`:
```js
/**
 * Pure parser for the custom-scheme deep link (DESIGN line 307):
 *   jaghelm://incident/<fcmId>?type=<t>&node=<n>&severity=<s>
 * This is the PRIMARY OSS-build deep-link path (verified https App Links need a
 * per-self-hoster assetlinks.json). It reassembles the FCM `data` shape and
 * delegates to routeFromData so the SAME id-reconciler + fallback logic runs as
 * the pushNotificationActionPerformed (tray-tap) path.
 *
 * Defensive: anything that is not a jaghelm://incident/<id> link is a no-op.
 *
 * @param {string} url  the appUrlOpen url
 * @param {{ push: Function }} nav
 */
import { routeFromData } from './routeFromData.js';

const PREFIX = 'jaghelm://incident/';

export function routeFromUrl(url, nav) {
  if (typeof url !== 'string' || !url.startsWith(PREFIX)) return;
  const rest = url.slice(PREFIX.length); // "<id>?type=...&..."
  const qIdx = rest.indexOf('?');
  const idRaw = qIdx === -1 ? rest : rest.slice(0, qIdx);
  if (!idRaw) return;
  let id;
  try {
    id = decodeURIComponent(idRaw);
  } catch {
    id = idRaw;
  }
  const params = new URLSearchParams(qIdx === -1 ? '' : rest.slice(qIdx + 1));
  routeFromData(
    {
      type: params.get('type') || undefined,
      id,
      node: params.get('node') || undefined,
      severity: params.get('severity') || undefined,
    },
    nav,
  );
}
```

- [ ] **Step 4: Run it — Expected: PASS:**
  `npm test -- routeFromUrl`

- [ ] **Step 5: Commit.**
  `git add mobile/src/push/routeFromUrl.js mobile/src/push/routeFromUrl.test.js && git commit -m "feat(mobile): parse jaghelm:// custom-scheme deep links into routeFromData"`

---

## Task 3: `pushPrefsApi` — typed client over apiFetch for the 5 push endpoints

**Files:**
- Create: `mobile/src/push/pushPrefsApi.js`
- Test: `mobile/src/push/pushPrefsApi.test.js`

**Interfaces:**
- Produces:
  - `getPushStatus(): Promise<{ enabled: boolean }>` — `GET ${base}/push/status`.
  - `getPushPrefs(token): Promise<PrefsObject>` — `GET ${base}/push/prefs?token=<encoded>`; returns `body.prefs`.
  - `setPushPrefs(token, prefs): Promise<PrefsObject>` — `PUT ${base}/push/prefs` body `{ token, prefs }`; returns `body.prefs`.
  - `registerToken(token): Promise<{ stored: boolean, deliveryEnabled: boolean }>` — `POST ${base}/push/register` body `{ token, platform: 'android', appVersion }`.
  - `deleteToken(token): Promise<{ removed: boolean }>` — `DELETE ${base}/push/register` body `{ token }`.
  - Each rejects (throws) on a non-2xx so callers can branch. The thrown `Error` carries `err.status` (HTTP code) AND `err.serverMessage` (the server's `{ error }` body message, e.g. `'malformed prefs'` vs `'token not found'`) so the optimistic-revert UI can distinguish a client-bug 400 from a re-register-needed 404. `err.message` includes both.
- Consumes: `@shared/api/client.js` `apiFetch` (injects `x-auth-token`, applies native HTTP), `@shared/api/baseUrl.js` `getApiBase` (mobile base ends in `/api`). `PrefsObject` = `{ categories: { service, host, ups, cron }, notifyRecoveries, enabled }`.

> NOTE: the `?token=` on GET /prefs is the FCM DEVICE token (a query param of the push route), NOT the `x-auth-token` SESSION token (a header injected by apiFetch). `encodeURIComponent` the FCM token to keep the URL valid.

- [ ] **Step 1: Write failing test.** Create `mobile/src/push/pushPrefsApi.test.js`:
```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted() so the mock fns are safely referenced inside the hoisted vi.mock
// factories (the repo convention — see connect.test.js — avoids the TDZ trap).
const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
const { getApiBase } = vi.hoisted(() => ({ getApiBase: vi.fn(() => 'http://vm-101:3099/api') }));
vi.mock('@shared/api/client.js', () => ({ apiFetch }));
vi.mock('@shared/api/baseUrl.js', () => ({ getApiBase }));

import {
  getPushStatus, getPushPrefs, setPushPrefs, registerToken, deleteToken,
} from './pushPrefsApi.js';

const PREFS = {
  categories: { service: true, host: true, ups: true, cron: true },
  notifyRecoveries: true,
  enabled: true,
};

const okJson = (body) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
  apiFetch.mockReset();
  getApiBase.mockReset().mockReturnValue('http://vm-101:3099/api');
});

describe('pushPrefsApi', () => {
  it('getPushStatus GETs /push/status and returns the body', async () => {
    apiFetch.mockResolvedValue(okJson({ enabled: false }));
    const r = await getPushStatus();
    expect(apiFetch).toHaveBeenCalledWith('http://vm-101:3099/api/push/status');
    expect(r).toEqual({ enabled: false });
  });

  it('getPushPrefs encodes the FCM token in the query and returns body.prefs', async () => {
    apiFetch.mockResolvedValue(okJson({ prefs: PREFS }));
    const r = await getPushPrefs('fcm tok/+=');
    expect(apiFetch).toHaveBeenCalledWith(
      'http://vm-101:3099/api/push/prefs?token=fcm%20tok%2F%2B%3D',
    );
    expect(r).toEqual(PREFS);
  });

  it('setPushPrefs PUTs the full {token, prefs} body and returns body.prefs', async () => {
    apiFetch.mockResolvedValue(okJson({ prefs: PREFS }));
    const r = await setPushPrefs('fcmtok', PREFS);
    expect(apiFetch).toHaveBeenCalledWith('http://vm-101:3099/api/push/prefs', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'fcmtok', prefs: PREFS }),
    });
    expect(r).toEqual(PREFS);
  });

  it('registerToken POSTs token+platform+appVersion', async () => {
    apiFetch.mockResolvedValue(okJson({ stored: true, deliveryEnabled: false }));
    const r = await registerToken('fcmtok');
    const [url, opts] = apiFetch.mock.calls[0];
    expect(url).toBe('http://vm-101:3099/api/push/register');
    expect(opts.method).toBe('POST');
    const sent = JSON.parse(opts.body);
    expect(sent.token).toBe('fcmtok');
    expect(sent.platform).toBe('android');
    expect(typeof sent.appVersion).toBe('string');
    expect(r).toEqual({ stored: true, deliveryEnabled: false });
  });

  it('deleteToken DELETEs with the token in the JSON body', async () => {
    apiFetch.mockResolvedValue(okJson({ removed: true }));
    const r = await deleteToken('fcmtok');
    expect(apiFetch).toHaveBeenCalledWith('http://vm-101:3099/api/push/register', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'fcmtok' }),
    });
    expect(r).toEqual({ removed: true });
  });

  it('throws on a non-2xx response AND surfaces the server error message', async () => {
    apiFetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'malformed prefs' }) });
    await expect(setPushPrefs('fcmtok', PREFS)).rejects.toThrow(/400.*malformed prefs/);
    apiFetch.mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: 'token not found' }) });
    try {
      await setPushPrefs('fcmtok', PREFS);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e.status).toBe(404);
      expect(e.serverMessage).toBe('token not found');
    }
  });
});
```

- [ ] **Step 2: Run it — Expected: FAIL** (`Cannot find module './pushPrefsApi.js'`):
  `npm test -- pushPrefsApi`

- [ ] **Step 3: Minimal impl.** Create `mobile/src/push/pushPrefsApi.js`:
```js
/**
 * Thin client for the Phase-4 server push endpoints. Every call rides the shared
 * apiFetch transport (injects the x-auth-token SESSION header + applies native
 * HTTP) and builds URLs off getApiBase() (which ends in /api) so the auth guard
 * fires. The `token` in these bodies/queries is the FCM DEVICE token — unrelated
 * to the x-auth-token session token apiFetch injects.
 *
 * PUT /push/prefs is a STRICT full-replace: send the complete prefs object
 * (categories{service,host,ups,cron} + notifyRecoveries + enabled, all boolean),
 * no extra keys, or the server 400s 'malformed prefs'.
 */
import { apiFetch } from '@shared/api/client.js';
import { getApiBase } from '@shared/api/baseUrl.js';

const APP_VERSION = '1.4.0'; // mirrors mobile/package.json version

async function asJson(res) {
  if (!res.ok) {
    // Surface the server's { error } body message (errors.js envelope) so callers
    // can tell 400 'malformed prefs' (client bug) from 404 'token not found'
    // (needs re-register) — both otherwise look like a bare HTTP code.
    let serverMessage;
    try {
      const body = await res.json();
      serverMessage = body && body.error;
    } catch {
      serverMessage = undefined;
    }
    const err = new Error(
      `push API HTTP ${res.status}${serverMessage ? `: ${serverMessage}` : ''}`,
    );
    err.status = res.status;
    err.serverMessage = serverMessage;
    throw err;
  }
  return res.json();
}

const JSON_HEADERS = { 'content-type': 'application/json' };

/** GET /push/status -> { enabled }. enabled:false means push delivery unavailable server-side. */
export async function getPushStatus() {
  return asJson(await apiFetch(`${getApiBase()}/push/status`));
}

/** GET /push/prefs?token=<FCM> -> the full prefs object (DEFAULT_PREFS for unknown tokens). */
export async function getPushPrefs(token) {
  const q = encodeURIComponent(token);
  const body = await asJson(await apiFetch(`${getApiBase()}/push/prefs?token=${q}`));
  return body.prefs;
}

/** PUT /push/prefs { token, prefs } (strict full-replace) -> the normalized prefs. */
export async function setPushPrefs(token, prefs) {
  const body = await asJson(
    await apiFetch(`${getApiBase()}/push/prefs`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ token, prefs }),
    }),
  );
  return body.prefs;
}

/** POST /push/register { token, platform, appVersion } -> { stored, deliveryEnabled }. */
export async function registerToken(token) {
  return asJson(
    await apiFetch(`${getApiBase()}/push/register`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ token, platform: 'android', appVersion: APP_VERSION }),
    }),
  );
}

/** DELETE /push/register { token } (token in BODY) -> { removed }. Idempotent. */
export async function deleteToken(token) {
  return asJson(
    await apiFetch(`${getApiBase()}/push/register`, {
      method: 'DELETE',
      headers: JSON_HEADERS,
      body: JSON.stringify({ token }),
    }),
  );
}
```

- [ ] **Step 4: Run it — Expected: PASS:**
  `npm test -- pushPrefsApi`

- [ ] **Step 5: Commit.**
  `git add mobile/src/push/pushPrefsApi.js mobile/src/push/pushPrefsApi.test.js && git commit -m "feat(mobile): push API client for status/prefs/register/delete"`

---

## Task 4: `runtimeConfig` Preferences keys for non-secret push state

**Files:**
- Modify: `mobile/src/runtimeConfig.js`
- Test: `mobile/src/runtimeConfig.test.js` (append; it exists from Phase 2)

**Interfaces:**
- Produces: new exported key constants `PUSH_TOKEN_KEY = 'jaghelm-push-token'`, `PUSH_PERM_KEY = 'jaghelm-push-perm'`, `PUSH_PREFS_KEY = 'jaghelm-push-prefs'` — non-secret, destined for `@capacitor/preferences` (throw-free; avoids M3a).
- Consumes: nothing (constants only).

> Push token is non-secret device state (per the spec): a leaked FCM token can at most receive pushes routed to that device, never reveal credentials — so Preferences (not Keystore) is correct AND sidesteps the M3a `removeItem`-throws defect entirely.

- [ ] **Step 1: Write failing test.** `mobile/src/runtimeConfig.test.js` is a vitest suite (`import { describe, it, expect } from 'vitest'` at the top, with existing top-level `describe` blocks; verified). MERGE the new symbols into the EXISTING top import from `'./runtimeConfig.js'` (lines 2–10) rather than adding a second mid-file `import` — i.e. add `PUSH_TOKEN_KEY, PUSH_PERM_KEY, PUSH_PREFS_KEY` to that destructured import. Then append a new top-level `describe`:
```js
// (added to the EXISTING top import:)
//   import {
//     normalizeBaseUrl, validateFirstRun, BASE_URL_KEY, TOKEN_KEY,
//     URL_PRESENT_KEY, THEME_KEY, LAST_TAB_KEY,
//     PUSH_TOKEN_KEY, PUSH_PERM_KEY, PUSH_PREFS_KEY,
//   } from './runtimeConfig.js';

describe('push Preferences keys', () => {
  it('exports stable, namespaced, distinct non-secret push keys', () => {
    expect(PUSH_TOKEN_KEY).toBe('jaghelm-push-token');
    expect(PUSH_PERM_KEY).toBe('jaghelm-push-perm');
    expect(PUSH_PREFS_KEY).toBe('jaghelm-push-prefs');
    const all = [PUSH_TOKEN_KEY, PUSH_PERM_KEY, PUSH_PREFS_KEY];
    expect(new Set(all).size).toBe(3);
    for (const k of all) expect(k.startsWith('jaghelm-')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it — Expected: FAIL** (keys undefined):
  `npm test -- runtimeConfig`

- [ ] **Step 3: Minimal impl.** Append to `mobile/src/runtimeConfig.js` (after the existing key constants):
```js
// Non-secret push state -> @capacitor/preferences (throw-free; NEVER Keystore,
// which would hit the M3a removeItem-throws-on-missing defect). The FCM device
// token is non-secret device state; permission/prefs are UI state.
export const PUSH_TOKEN_KEY = 'jaghelm-push-token'; // FCM device token (for GET/PUT prefs)
export const PUSH_PERM_KEY = 'jaghelm-push-perm'; // 'granted'|'denied'|'prompt' breadcrumb
export const PUSH_PREFS_KEY = 'jaghelm-push-prefs'; // last-known prefs JSON for fast first paint
```

- [ ] **Step 4: Run it — Expected: PASS:**
  `npm test -- runtimeConfig`

- [ ] **Step 5: Commit.**
  `git add mobile/src/runtimeConfig.js mobile/src/runtimeConfig.test.js && git commit -m "feat(mobile): add non-secret Preferences keys for push token/perm/prefs"`

---

## Task 5: `registerPush` — permission flow + listener capture (no register yet)

**Files:**
- Create: `mobile/src/push/registerPush.js`
- Test: `mobile/src/push/registerPush.test.js`

**Interfaces:**
- Produces: `initPush({ nav }): Promise<{ enabled: boolean, permission: string }>` — runs `checkPermissions` → (if `'prompt'`/`'prompt-with-rationale'`) `requestPermissions` → if `receive !== 'granted'` persist perm + early-return `{ enabled: false, permission }` (no listeners, no register). On grant: persist `PUSH_PERM_KEY='granted'`, `createChannel('jaghelm-incidents')`, add the FOUR plugin listeners + the `@capacitor/app` `appUrlOpen` listener (custom-scheme path B) BEFORE `register()`, then `register()`; returns `{ enabled: true, permission: 'granted' }`.
- Consumes: `@capacitor/push-notifications` `PushNotifications` (checkPermissions/requestPermissions/createChannel/addListener/register); `@capacitor/app` `App` (`addListener('appUrlOpen', ...)`); `./routeFromData.js`; `./routeFromUrl.js`; `./pushPrefsApi.js` (`registerToken`); `../storage/prefsAdapter.js` (`setPref`); `../runtimeConfig.js` (`PUSH_TOKEN_KEY`, `PUSH_PERM_KEY`).

> This task builds the permission gate + listener attachment (incl. the `appUrlOpen` custom-scheme listener) + channel creation; the token-persist/POST + deep-link + `disablePush` behaviors are ASSERTED in Tasks 6 / 6b. Split so each red→green is small. The Task-5 test mocks `@capacitor/app` minimally; the `appUrlOpen` ROUTING is asserted in Task 6b.

- [ ] **Step 1: Write failing test.** Create `mobile/src/push/registerPush.test.js`:
```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted so the mock fns are referenced inside the hoisted vi.mock factory.
// `removeAllListeners` + `routeFromData` are used by Task 6/6b — declared here
// ONCE so the hoisted mock block is complete and not retrofitted mid-file.
const plugin = vi.hoisted(() => ({
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  register: vi.fn(),
  addListener: vi.fn(),
  createChannel: vi.fn(),
  removeAllListeners: vi.fn(),
}));
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: plugin }));

// @capacitor/app App.addListener('appUrlOpen', ...) — the custom-scheme path B.
const appPlugin = vi.hoisted(() => ({ addListener: vi.fn() }));
vi.mock('@capacitor/app', () => ({ App: appPlugin }));

// ALL mock fns referenced inside a vi.mock factory use vi.hoisted() — vi.mock is
// hoisted above the file's top, so a plain `const` referenced in the factory
// would sit in its temporal dead zone (the TDZ trap). vi.hoisted() lifts the fn
// to the same level as the mock, eliminating the risk uniformly.
const { setPref } = vi.hoisted(() => ({ setPref: vi.fn() }));
vi.mock('../storage/prefsAdapter.js', () => ({ setPref, getPref: vi.fn() }));

const { registerToken, deleteToken } = vi.hoisted(() => ({
  registerToken: vi.fn(),
  deleteToken: vi.fn(),
}));
vi.mock('./pushPrefsApi.js', () => ({ registerToken, deleteToken }));

// routeFromData/routeFromUrl mocked here so Task 6/6b can assert on them without
// retrofitting the mock list. They are their own modules (not on `plugin`), so
// the beforeEach Object.values(plugin) reset does not touch them — reset them
// explicitly below.
const routeFromData = vi.hoisted(() => vi.fn());
const routeFromUrl = vi.hoisted(() => vi.fn());
vi.mock('./routeFromData.js', () => ({ routeFromData }));
vi.mock('./routeFromUrl.js', () => ({ routeFromUrl }));

import { initPush } from './registerPush.js';

beforeEach(() => {
  for (const f of Object.values(plugin)) f.mockReset();
  appPlugin.addListener.mockReset().mockResolvedValue({ remove: vi.fn() });
  routeFromData.mockReset();
  routeFromUrl.mockReset();
  setPref.mockReset().mockResolvedValue(undefined);
  registerToken.mockReset().mockResolvedValue({ stored: true, deliveryEnabled: true });
  deleteToken.mockReset().mockResolvedValue({ removed: true });
  plugin.addListener.mockResolvedValue({ remove: vi.fn() });
  plugin.register.mockResolvedValue(undefined);
  plugin.createChannel.mockResolvedValue(undefined);
});

describe('initPush permission gate', () => {
  it('prompts when state is "prompt", then registers on grant', async () => {
    plugin.checkPermissions.mockResolvedValue({ receive: 'prompt' });
    plugin.requestPermissions.mockResolvedValue({ receive: 'granted' });
    const r = await initPush({ nav: { push: vi.fn() } });
    expect(plugin.requestPermissions).toHaveBeenCalledTimes(1);
    expect(plugin.register).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ enabled: true, permission: 'granted' });
  });

  it('does NOT re-prompt when already granted', async () => {
    plugin.checkPermissions.mockResolvedValue({ receive: 'granted' });
    await initPush({ nav: { push: vi.fn() } });
    expect(plugin.requestPermissions).not.toHaveBeenCalled();
    expect(plugin.register).toHaveBeenCalledTimes(1);
  });

  it('early-returns disabled on deny: no listeners, no channel, no register', async () => {
    plugin.checkPermissions.mockResolvedValue({ receive: 'prompt' });
    plugin.requestPermissions.mockResolvedValue({ receive: 'denied' });
    const r = await initPush({ nav: { push: vi.fn() } });
    expect(r).toEqual({ enabled: false, permission: 'denied' });
    expect(plugin.addListener).not.toHaveBeenCalled();
    expect(appPlugin.addListener).not.toHaveBeenCalled(); // no appUrlOpen on deny
    expect(plugin.createChannel).not.toHaveBeenCalled();
    expect(plugin.register).not.toHaveBeenCalled();
    expect(setPref).toHaveBeenCalledWith('jaghelm-push-perm', 'denied');
  });

  it('creates the jaghelm-incidents channel and adds 4 plugin listeners + appUrlOpen BEFORE register()', async () => {
    plugin.checkPermissions.mockResolvedValue({ receive: 'granted' });
    const order = [];
    plugin.createChannel.mockImplementation((c) => { order.push(`channel:${c.id}`); return Promise.resolve(); });
    plugin.addListener.mockImplementation((ev) => { order.push(`listen:${ev}`); return Promise.resolve({ remove: vi.fn() }); });
    appPlugin.addListener.mockImplementation((ev) => { order.push(`applisten:${ev}`); return Promise.resolve({ remove: vi.fn() }); });
    plugin.register.mockImplementation(() => { order.push('register'); return Promise.resolve(); });
    await initPush({ nav: { push: vi.fn() } });
    expect(order).toContain('channel:jaghelm-incidents');
    const listened = order.filter((o) => o.startsWith('listen:')).map((o) => o.slice(7));
    // exactly the four plugin listeners are added
    expect(listened.slice().sort()).toEqual([
      'pushNotificationActionPerformed', 'pushNotificationReceived', 'registration', 'registrationError',
    ]);
    // the appUrlOpen custom-scheme listener is also registered
    expect(order).toContain('applisten:appUrlOpen');
    // HARD ordering: register() comes AFTER every listener (plugin + app) was
    // added (and is last).
    const registerIdx = order.indexOf('register');
    const lastListenIdx = order.map((o) => o.startsWith('listen:') || o.startsWith('applisten:')).lastIndexOf(true);
    expect(registerIdx).toBeGreaterThan(lastListenIdx);
    expect(order[order.length - 1]).toBe('register');
    expect(setPref).toHaveBeenCalledWith('jaghelm-push-perm', 'granted');
  });
});
```

- [ ] **Step 2: Run it — Expected: FAIL** (`Cannot find module './registerPush.js'`):
  `npm test -- registerPush`

- [ ] **Step 3: Minimal impl.** Create `mobile/src/push/registerPush.js`:
```js
/**
 * Mobile push registration. Behind @capacitor/push-notifications, mirroring the
 * adapter pattern so views import this and tests mock the plugin once.
 *
 * Flow (order is LOAD-BEARING):
 *   1. checkPermissions(); if 'prompt'/'prompt-with-rationale' -> requestPermissions()
 *      (this is what drives the Android 13+ POST_NOTIFICATIONS dialog).
 *   2. if receive !== 'granted' -> persist perm, early-return disabled (no listeners,
 *      no register) — gracefully disabled client-side.
 *   3. on grant: createChannel('jaghelm-incidents'), add the FOUR listeners FIRST
 *      (the 'registration' event can fire immediately), THEN register().
 *
 * register() does NOT prompt and does NOT request permission — that is why
 * requestPermissions() must precede it. The FCM token arrives via the
 * 'registration' listener as { value } (NOT { token }).
 */
import { PushNotifications } from '@capacitor/push-notifications';
import { App } from '@capacitor/app';
import { setPref } from '../storage/prefsAdapter.js';
import { PUSH_PERM_KEY, PUSH_TOKEN_KEY } from '../runtimeConfig.js';
import { registerToken } from './pushPrefsApi.js';
import { routeFromData } from './routeFromData.js';
import { routeFromUrl } from './routeFromUrl.js';

const CHANNEL_ID = 'jaghelm-incidents';

export async function initPush({ nav }) {
  let perm = await PushNotifications.checkPermissions();
  if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
    perm = await PushNotifications.requestPermissions();
  }
  if (perm.receive !== 'granted') {
    await setPref(PUSH_PERM_KEY, perm.receive);
    return { enabled: false, permission: perm.receive };
  }
  await setPref(PUSH_PERM_KEY, 'granted');

  // Matches the server payload's android.notification.channelId. Importance 5
  // (MAX) so critical (priority:high) pushes are not silenced on Android 8+.
  await PushNotifications.createChannel({
    id: CHANNEL_ID,
    name: 'JagHelm incidents',
    importance: 5,
    visibility: 1,
  });

  // Listeners BEFORE register() — 'registration' may fire immediately.
  await PushNotifications.addListener('registration', (token) => {
    onRegistration(token);
  });
  await PushNotifications.addListener('registrationError', (err) => {
    // eslint-disable-next-line no-console
    console.warn('[push] registration error:', err && err.error);
  });
  await PushNotifications.addListener('pushNotificationReceived', () => {
    // Foreground arrival: Android does not auto-show in the tray. v1 logs only
    // (no in-app toast); the deep-link path is the action-performed listener.
  });
  await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    routeFromData(action && action.notification && action.notification.data, nav);
  });

  // Deep-link path B: the jaghelm://incident/<id> custom URL scheme (DESIGN line
  // 307 — the primary OSS-build deep-link path). Same nav, same reconciler.
  await App.addListener('appUrlOpen', (event) => {
    routeFromUrl(event && event.url, nav);
  });

  await PushNotifications.register();
  return { enabled: true, permission: 'granted' };
}

/** 'registration' handler: persist the FCM token (note: event.value) + POST it. */
async function onRegistration(token) {
  const value = token && token.value; // field is `value`, NOT `token`
  if (!value) return;
  await setPref(PUSH_TOKEN_KEY, value);
  try {
    await registerToken(value);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[push] backend register failed:', e && e.message);
  }
}
```

- [ ] **Step 4: Run it — Expected: PASS:**
  `npm test -- registerPush`

- [ ] **Step 5: Commit.**
  `git add mobile/src/push/registerPush.js mobile/src/push/registerPush.test.js && git commit -m "feat(mobile): initPush permission gate + channel + listener attach"`

---

## Task 6: `registerPush` — registration token POST, error path, deep-link, disable teardown

**Files:**
- Modify: `mobile/src/push/registerPush.js` (export `disablePush`; harden `onRegistration` already present)
- Test: `mobile/src/push/registerPush.test.js` (append: capture listener callbacks + invoke them)

**Interfaces:**
- Produces: `disablePush(token): Promise<void>` — teardown: `removeAllListeners()` + `deleteToken(token)` (the DELETE `/push/register` hard-removal path) + clear `PUSH_TOKEN_KEY`. Plus assertions that the captured `registration` callback persists `value` and POSTs it, `registrationError` does not throw, and `pushNotificationActionPerformed` deep-links via `routeFromData`.
- Consumes: same as Task 5 + `./pushPrefsApi.js` `deleteToken`, `../runtimeConfig.js` `PUSH_TOKEN_KEY`.

> The token-clear on teardown uses `setPref(PUSH_TOKEN_KEY, '')` (Preferences, throw-free) — NOT `removeItem` — explicitly dodging the M3a Keystore-throws defect (and Preferences has no missing-key throw anyway).

- [ ] **Step 1: Write failing tests.** Append to `mobile/src/push/registerPush.test.js`. The hoisted mocks (`plugin`, `appPlugin`, `routeFromData`, `routeFromUrl`, `deleteToken`) were ALL declared in Task 5's block — do NOT re-declare or re-`vi.mock` them here (that would error). Just add the new `import { disablePush }` and the captured-handler tests:
```js
import { disablePush } from './registerPush.js';

// routeFromData is already imported as the hoisted mock at the top of the file
// (Task 5). Reference it directly in assertions.

function captureHandlers() {
  const handlers = {};
  plugin.addListener.mockImplementation((event, cb) => {
    handlers[event] = cb;
    return Promise.resolve({ remove: vi.fn() });
  });
  return handlers;
}

describe('registration handler + listeners (captured)', () => {
  it("'registration' persists token.value and POSTs it to the backend", async () => {
    plugin.checkPermissions.mockResolvedValue({ receive: 'granted' });
    const handlers = captureHandlers();
    await initPush({ nav: { push: vi.fn() } });
    await handlers.registration({ value: 'fake-fcm-token' });
    expect(setPref).toHaveBeenCalledWith('jaghelm-push-token', 'fake-fcm-token');
    expect(registerToken).toHaveBeenCalledWith('fake-fcm-token');
  });

  it("'registration' with a backend failure does NOT throw (logged)", async () => {
    plugin.checkPermissions.mockResolvedValue({ receive: 'granted' });
    registerToken.mockRejectedValueOnce(new Error('500'));
    const handlers = captureHandlers();
    await initPush({ nav: { push: vi.fn() } });
    await expect(handlers.registration({ value: 't' })).resolves.toBeUndefined();
  });

  it("'registrationError' does not throw", async () => {
    plugin.checkPermissions.mockResolvedValue({ receive: 'granted' });
    const handlers = captureHandlers();
    await initPush({ nav: { push: vi.fn() } });
    expect(() => handlers.registrationError({ error: 'boom' })).not.toThrow();
  });

  it("'pushNotificationActionPerformed' deep-links via routeFromData with the data block", async () => {
    plugin.checkPermissions.mockResolvedValue({ receive: 'granted' });
    const nav = { push: vi.fn() };
    const handlers = captureHandlers();
    await initPush({ nav });
    const data = { type: 'service_down', id: 'vm-101:nginx', node: 'vm-101', severity: 'critical' };
    handlers.pushNotificationActionPerformed({ actionId: 'tap', notification: { data } });
    expect(routeFromData).toHaveBeenCalledWith(data, nav);
  });
});

describe('disablePush teardown', () => {
  it('removes listeners, DELETEs the token, and clears the local token (no Keystore removeItem)', async () => {
    await disablePush('fcmtok');
    expect(plugin.removeAllListeners).toHaveBeenCalledTimes(1);
    expect(deleteToken).toHaveBeenCalledWith('fcmtok');
    expect(setPref).toHaveBeenCalledWith('jaghelm-push-token', '');
  });

  it('still clears local state when the backend DELETE fails (does not throw)', async () => {
    deleteToken.mockRejectedValueOnce(new Error('500'));
    await expect(disablePush('fcmtok')).resolves.toBeUndefined();
    expect(setPref).toHaveBeenCalledWith('jaghelm-push-token', '');
  });
});
```
(All mocks — `plugin.removeAllListeners`, `deleteToken`, `routeFromData` — are already declared in Task 5's hoisted block; nothing to retrofit here.)

- [ ] **Step 2: Run it — Expected: FAIL** (`disablePush` not exported; `routeFromData` not yet mocked-assertable):
  `npm test -- registerPush`

- [ ] **Step 3: Minimal impl.** In `mobile/src/push/registerPush.js`, MERGE `deleteToken` into the EXISTING `import { registerToken } from './pushPrefsApi.js';` line (making it `import { registerToken, deleteToken } from './pushPrefsApi.js';` — do NOT add a second import of the same module), then append the `disablePush` export:
```js
// (existing import updated to:)
//   import { registerToken, deleteToken } from './pushPrefsApi.js';

/**
 * Teardown for logout / explicit push-disable: remove plugin listeners, hard-
 * remove the registration server-side (DELETE /push/register — token in body),
 * and clear the locally-cached FCM token. Uses setPref('', ) NOT removeItem,
 * which (on the Keystore adapter) throws on a missing key (M3a) — Preferences is
 * throw-free regardless, and push state never lives in the Keystore.
 *
 * This is the HARD path. The settings master toggle (enabled:false) is the SOFT
 * path (PUT /push/prefs, token KEPT) and must NOT call this.
 */
export async function disablePush(token) {
  await PushNotifications.removeAllListeners();
  if (token) {
    try {
      await deleteToken(token);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[push] backend delete failed:', e && e.message);
    }
  }
  await setPref(PUSH_TOKEN_KEY, '');
}
```

- [ ] **Step 4: Run it — Expected: PASS:**
  `npm test -- registerPush`

- [ ] **Step 5: Commit.**
  `git add mobile/src/push/registerPush.js mobile/src/push/registerPush.test.js && git commit -m "feat(mobile): push token POST, error/deep-link handlers, disablePush teardown"`

---

## Task 6b: `registerPush` — assert the `appUrlOpen` custom-scheme path routes via `routeFromUrl`

**Files:**
- Modify: `mobile/src/push/registerPush.js` (no change if Task 5 already added the `appUrlOpen` listener — this task is the ASSERTION that locks the behavior; if the listener is missing, add it per Task 5's impl)
- Test: `mobile/src/push/registerPush.test.js` (append: capture the `appUrlOpen` callback + invoke it)

**Interfaces:**
- Produces: a test proving that on grant, `App.addListener('appUrlOpen', cb)` is registered and that invoking `cb({ url })` calls `routeFromUrl(url, nav)` with the live nav — i.e. the custom-scheme deep-link path B is wired, not just declared.
- Consumes: the hoisted `appPlugin`/`routeFromUrl` mocks from Task 5.

> The `appUrlOpen` listener was ADDED in Task 5's impl (so the order test sees it); this task captures its callback and asserts the routing, mirroring the `pushNotificationActionPerformed` test in Task 6. Split out so the path-B contract has its own red→green.

- [ ] **Step 1: Write failing test.** Append to `mobile/src/push/registerPush.test.js`:
```js
function captureAppHandlers() {
  const handlers = {};
  appPlugin.addListener.mockImplementation((event, cb) => {
    handlers[event] = cb;
    return Promise.resolve({ remove: vi.fn() });
  });
  return handlers;
}

describe('appUrlOpen custom-scheme deep-link (path B)', () => {
  it('registers an appUrlOpen listener that routes via routeFromUrl with the live nav', async () => {
    plugin.checkPermissions.mockResolvedValue({ receive: 'granted' });
    const nav = { push: vi.fn() };
    const appHandlers = captureAppHandlers();
    await initPush({ nav });
    expect(appHandlers.appUrlOpen).toBeTypeOf('function');
    appHandlers.appUrlOpen({ url: 'jaghelm://incident/vm-101%3Anginx?type=service_down&node=vm-101&severity=critical' });
    expect(routeFromUrl).toHaveBeenCalledWith(
      'jaghelm://incident/vm-101%3Anginx?type=service_down&node=vm-101&severity=critical',
      nav,
    );
  });
});
```

- [ ] **Step 2: Run it — Expected: PASS if Task 5's `appUrlOpen` listener is present; FAIL otherwise** (then add the listener exactly as Task 5's impl shows):
  `npm test -- registerPush`

- [ ] **Step 3: Commit (only if the impl changed).**
  `git add mobile/src/push/registerPush.js mobile/src/push/registerPush.test.js && git commit -m "test(mobile): assert appUrlOpen custom-scheme deep-link routes via routeFromUrl"`

---

## Task 7: `NotificationSettings` screen — load prefs + reflect status (read path)

**Files:**
- Create: `mobile/src/views/NotificationSettings.jsx`
- Test: `mobile/src/views/NotificationSettings.test.jsx`

**Interfaces:**
- Produces: `export default function NotificationSettings({ nav, data, params })` — uniform screen contract. On mount: read FCM token via `getPref(PUSH_TOKEN_KEY)`; if absent OR `getPushStatus().enabled === false`, render the GRAYED/unavailable state (no false "push on"); else `getPushPrefs(token)` and render 4 category toggles + notify-on-recovery + master, all reflecting the loaded prefs. `BackHeader title="Notifications" onBack={nav.pop}` inside `<section className="mobile-view">`.
- Consumes: `../components/BackHeader.jsx`; `../push/pushPrefsApi.js` (`getPushStatus`, `getPushPrefs`, `setPushPrefs`); `../storage/prefsAdapter.js` (`getPref`); `../runtimeConfig.js` (`PUSH_TOKEN_KEY`, `PUSH_PERM_KEY`).

> CATEGORY rows map PLURAL labels → SINGULAR pref keys: `[['service','Services'],['host','Hosts'],['ups','UPS'],['cron','Cron']]`.

- [ ] **Step 1: Write failing test.** Create `mobile/src/views/NotificationSettings.test.jsx`:
```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// vi.hoisted() for every factory-referenced mock fn (repo convention; avoids the
// TDZ trap of a plain const referenced inside the hoisted vi.mock factory).
const { getPushStatus, getPushPrefs, setPushPrefs } = vi.hoisted(() => ({
  getPushStatus: vi.fn(), getPushPrefs: vi.fn(), setPushPrefs: vi.fn(),
}));
vi.mock('../push/pushPrefsApi.js', () => ({ getPushStatus, getPushPrefs, setPushPrefs }));

const { getPref } = vi.hoisted(() => ({ getPref: vi.fn() }));
vi.mock('../storage/prefsAdapter.js', () => ({ getPref, setPref: vi.fn() }));

import NotificationSettings from './NotificationSettings.jsx';

const PREFS = {
  categories: { service: true, host: false, ups: true, cron: true },
  notifyRecoveries: false,
  enabled: true,
};
const nav = { pop: vi.fn(), push: vi.fn() };

beforeEach(() => {
  getPushStatus.mockReset().mockResolvedValue({ enabled: true });
  getPushPrefs.mockReset().mockResolvedValue(PREFS);
  setPushPrefs.mockReset().mockResolvedValue(PREFS);
  getPref.mockReset().mockResolvedValue('fcmtok');
});

describe('NotificationSettings (read path)', () => {
  it('loads prefs and reflects them in the four category + recovery + master controls', async () => {
    render(<NotificationSettings nav={nav} data={{}} params={{}} />);
    await waitFor(() => expect(getPushPrefs).toHaveBeenCalledWith('fcmtok'));
    expect(screen.getByRole('switch', { name: /services/i })).toBeChecked();
    expect(screen.getByRole('switch', { name: /hosts/i })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: /ups/i })).toBeChecked();
    expect(screen.getByRole('switch', { name: /cron/i })).toBeChecked();
    expect(screen.getByRole('switch', { name: /notify on recovery/i })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: /enable push|push notifications/i })).toBeChecked();
  });

  it('grays out (unavailable) when status.enabled is false — no false "push on"', async () => {
    getPushStatus.mockResolvedValue({ enabled: false });
    render(<NotificationSettings nav={nav} data={{}} params={{}} />);
    await waitFor(() => expect(getPushStatus).toHaveBeenCalled());
    expect(screen.getByText(/unavailable|not configured/i)).toBeInTheDocument();
    expect(getPushPrefs).not.toHaveBeenCalled();
  });

  it('shows the unavailable state when no device token is registered', async () => {
    getPref.mockResolvedValue(null);
    render(<NotificationSettings nav={nav} data={{}} params={{}} />);
    await waitFor(() => expect(screen.getByText(/not registered|unavailable/i)).toBeInTheDocument());
    expect(getPushPrefs).not.toHaveBeenCalled();
  });

  it('every control sits in a .notif-row (CSS-class smoke check for the >=44px row; jsdom has no layout)', async () => {
    // NOTE: jsdom does not compute layout, so this CANNOT assert real pixels.
    // It is a class-PRESENCE smoke check: the >=44px min-height lives in
    // .notif-row (Task 9 CSS); a real tap-target measurement would need a
    // browser/e2e runner (out of unit scope). Named honestly per the review.
    render(<NotificationSettings nav={nav} data={{}} params={{}} />);
    await waitFor(() => expect(getPushPrefs).toHaveBeenCalled());
    for (const sw of screen.getAllByRole('switch')) {
      expect(sw.closest('.notif-row')).not.toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run it — Expected: FAIL** (`Cannot find module './NotificationSettings.jsx'`):
  `npm test -- NotificationSettings`

- [ ] **Step 3: Minimal impl.** Create `mobile/src/views/NotificationSettings.jsx`:
```jsx
import React, { useEffect, useState } from 'react';
import BackHeader from '../components/BackHeader.jsx';
import { getPushStatus, getPushPrefs, setPushPrefs } from '../push/pushPrefsApi.js';
import { getPref } from '../storage/prefsAdapter.js';
import { PUSH_TOKEN_KEY } from '../runtimeConfig.js';

// Plural UI label -> singular pref key (the server prefs schema is singular).
const CATEGORIES = [
  ['service', 'Services'],
  ['host', 'Hosts'],
  ['ups', 'UPS'],
  ['cron', 'Cron'],
];

/**
 * The ONLY in-app settings surface (deep config stays on the desktop web app).
 * Loads the per-device prefs (GET /push/prefs?token=<FCM>) and reflects server
 * delivery availability (GET /push/status). When status is unavailable or no
 * device token is registered, the screen grays out rather than showing a false
 * "push on". Toggles write OPTIMISTICALLY then PUT the FULL prefs object (Task 8).
 */
export default function NotificationSettings({ nav }) {
  const [state, setState] = useState({ status: 'loading' }); // loading|unavailable|ready
  const [prefs, setPrefs] = useState(null);
  const [token, setToken] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tok = await getPref(PUSH_TOKEN_KEY);
        if (!tok) { if (!cancelled) setState({ status: 'unavailable', reason: 'not-registered' }); return; }
        const { enabled } = await getPushStatus();
        if (!enabled) { if (!cancelled) setState({ status: 'unavailable', reason: 'no-creds' }); return; }
        const loaded = await getPushPrefs(tok);
        if (cancelled) return;
        setToken(tok);
        setPrefs(loaded);
        setState({ status: 'ready' });
      } catch {
        if (!cancelled) setState({ status: 'unavailable', reason: 'error' });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <section className="mobile-view" aria-label="Notification settings">
      <BackHeader title="Notifications" onBack={nav.pop} />

      {state.status === 'loading' && <p className="mobile-view__todo">Loading…</p>}

      {state.status === 'unavailable' && (
        <p className="notif-unavailable">
          {state.reason === 'not-registered'
            ? 'Push not registered on this device. Enable notifications in system settings, then reopen the app.'
            : 'Push notifications are unavailable — the server has no notification credentials configured.'}
        </p>
      )}

      {state.status === 'ready' && prefs && (
        <Controls prefs={prefs} setPrefs={setPrefs} token={token} />
      )}
    </section>
  );
}

// Write path (optimistic PUT) is filled in Task 8; read-path render here.
function Controls({ prefs }) {
  return (
    <div className="notif-controls">
      <h2 className="detail-section">Categories</h2>
      {CATEGORIES.map(([key, label]) => (
        <label key={key} className="notif-row">
          <span className="notif-row__label">{label}</span>
          <input
            type="checkbox"
            role="switch"
            aria-label={label}
            className="notif-switch"
            checked={!!prefs.categories[key]}
            readOnly
          />
        </label>
      ))}
      <h2 className="detail-section">Recovery</h2>
      <label className="notif-row">
        <span className="notif-row__label">Also notify on recovery</span>
        <input
          type="checkbox"
          role="switch"
          aria-label="Notify on recovery"
          className="notif-switch"
          checked={!!prefs.notifyRecoveries}
          readOnly
        />
      </label>
      <h2 className="detail-section">Push</h2>
      <label className="notif-row">
        <span className="notif-row__label">Push notifications</span>
        <input
          type="checkbox"
          role="switch"
          aria-label="Enable push notifications"
          className="notif-switch"
          checked={!!prefs.enabled}
          readOnly
        />
      </label>
    </div>
  );
}
```

- [ ] **Step 4: Run it — Expected: PASS:**
  `npm test -- NotificationSettings`

- [ ] **Step 5: Commit.**
  `git add mobile/src/views/NotificationSettings.jsx mobile/src/views/NotificationSettings.test.jsx && git commit -m "feat(mobile): NotificationSettings read path + unavailable gray-out"`

---

## Task 8: `NotificationSettings` — optimistic toggle writes (strict full PUT)

**Files:**
- Modify: `mobile/src/views/NotificationSettings.jsx` (wire the `Controls` toggles to optimistic `setPushPrefs`)
- Test: `mobile/src/views/NotificationSettings.test.jsx` (append write-path tests)

**Interfaces:**
- Produces: each toggle mutates a CLONE of the full prefs object, updates UI immediately (optimistic), then `setPushPrefs(token, fullPrefs)`; on PUT failure it reverts to the prior prefs. The PUT body is ALWAYS the complete `{ categories{service,host,ups,cron}, notifyRecoveries, enabled }` shape (strict server contract).
- Consumes: `../push/pushPrefsApi.js` `setPushPrefs`.

- [ ] **Step 1: Write failing tests.** Append to `mobile/src/views/NotificationSettings.test.jsx`:
```jsx
import { fireEvent } from '@testing-library/react';

describe('NotificationSettings (write path)', () => {
  it('toggling Hosts ON sends the FULL prefs object with host:true (no extra keys)', async () => {
    render(<NotificationSettings nav={nav} data={{}} params={{}} />);
    await waitFor(() => expect(getPushPrefs).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('switch', { name: /hosts/i }));
    await waitFor(() => expect(setPushPrefs).toHaveBeenCalledTimes(1));
    const [tok, sent] = setPushPrefs.mock.calls[0];
    expect(tok).toBe('fcmtok');
    expect(sent).toEqual({
      categories: { service: true, host: true, ups: true, cron: true },
      notifyRecoveries: false,
      enabled: true,
    });
    expect(Object.keys(sent).sort()).toEqual(['categories', 'enabled', 'notifyRecoveries']);
    expect(Object.keys(sent.categories).sort()).toEqual(['cron', 'host', 'service', 'ups']);
  });

  it('master OFF sends enabled:false via PUT (token KEPT — no DELETE here)', async () => {
    render(<NotificationSettings nav={nav} data={{}} params={{}} />);
    await waitFor(() => expect(getPushPrefs).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('switch', { name: /enable push|push notifications/i }));
    await waitFor(() => expect(setPushPrefs).toHaveBeenCalled());
    const [, sent] = setPushPrefs.mock.calls[0];
    expect(sent.enabled).toBe(false);
  });

  it('reverts the optimistic toggle when the PUT fails', async () => {
    setPushPrefs.mockRejectedValueOnce(new Error('400'));
    render(<NotificationSettings nav={nav} data={{}} params={{}} />);
    await waitFor(() => expect(getPushPrefs).toHaveBeenCalled());
    const recovery = screen.getByRole('switch', { name: /notify on recovery/i });
    expect(recovery).not.toBeChecked();
    fireEvent.click(recovery);
    await waitFor(() => expect(setPushPrefs).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('switch', { name: /notify on recovery/i })).not.toBeChecked());
  });
});
```

- [ ] **Step 2: Run it — Expected: FAIL** (toggles are `readOnly`; no `setPushPrefs` call):
  `npm test -- NotificationSettings`

- [ ] **Step 3: Minimal impl.** Replace the `Controls` component in `mobile/src/views/NotificationSettings.jsx`:
```jsx
function Controls({ prefs, setPrefs, token }) {
  // Apply a full-prefs change optimistically, PUT the COMPLETE object, revert on
  // failure. PUT is a strict full-replace: the body is always the entire
  // {categories{4}, notifyRecoveries, enabled} shape — no PATCH, no extra keys.
  const apply = async (next) => {
    const prev = prefs;
    setPrefs(next);
    try {
      const saved = await setPushPrefs(token, next);
      setPrefs(saved);
    } catch {
      setPrefs(prev); // revert optimistic change
    }
  };

  const toggleCategory = (key) =>
    apply({ ...prefs, categories: { ...prefs.categories, [key]: !prefs.categories[key] } });
  const toggleRecoveries = () => apply({ ...prefs, notifyRecoveries: !prefs.notifyRecoveries });
  const toggleEnabled = () => apply({ ...prefs, enabled: !prefs.enabled });

  return (
    <div className="notif-controls">
      <h2 className="detail-section">Categories</h2>
      {CATEGORIES.map(([key, label]) => (
        <label key={key} className="notif-row">
          <span className="notif-row__label">{label}</span>
          <input
            type="checkbox"
            role="switch"
            aria-label={label}
            className="notif-switch"
            checked={!!prefs.categories[key]}
            onChange={() => toggleCategory(key)}
          />
        </label>
      ))}
      <h2 className="detail-section">Recovery</h2>
      <label className="notif-row">
        <span className="notif-row__label">Also notify on recovery</span>
        <input
          type="checkbox"
          role="switch"
          aria-label="Notify on recovery"
          className="notif-switch"
          checked={!!prefs.notifyRecoveries}
          onChange={toggleRecoveries}
        />
      </label>
      <h2 className="detail-section">Push</h2>
      <label className="notif-row">
        <span className="notif-row__label">Push notifications</span>
        <input
          type="checkbox"
          role="switch"
          aria-label="Enable push notifications"
          className="notif-switch"
          checked={!!prefs.enabled}
          onChange={toggleEnabled}
        />
      </label>
    </div>
  );
}
```
Add the import: `import { getPushStatus, getPushPrefs, setPushPrefs } from '../push/pushPrefsApi.js';` (already present from Task 7).

- [ ] **Step 4: Run it — Expected: PASS:**
  `npm test -- NotificationSettings`

- [ ] **Step 5: Commit.**
  `git add mobile/src/views/NotificationSettings.jsx mobile/src/views/NotificationSettings.test.jsx && git commit -m "feat(mobile): optimistic toggle writes with strict full-prefs PUT"`

---

## Task 8b: `NotificationSettings` — "Turn off push on this device" wires `disablePush` (DELETE teardown)

**Files:**
- Modify: `mobile/src/views/NotificationSettings.jsx` (add the teardown control + handler)
- Test: `mobile/src/views/NotificationSettings.test.jsx` (append teardown test)

**Interfaces:**
- Produces: a "Turn off push on this device" button at the bottom of the ready-state controls. On tap it calls `disablePush(token)` (the Task-6 export → `removeAllListeners` + `DELETE /api/push/register` + clear `PUSH_TOKEN_KEY`), then transitions the screen to the `unavailable`/`not-registered` state (since the FCM token is now gone). This is the SOLE in-app DELETE trigger (locked decision 9) — distinct from the master toggle's SOFT `PUT enabled:false` (Task 8). This resolves the review's "disablePush is dead code" gap WITHOUT touching the shared `src/App.jsx` (the mobile shell has no logout flow).
- Consumes: `../push/registerPush.js` `disablePush`.

> The control is intentionally a destructive-styled button, NOT a toggle, so it reads as "unregister this device" rather than "mute" — keeping it clearly distinct from the master switch.

- [ ] **Step 1: Write failing test.** At the TOP of `mobile/src/views/NotificationSettings.test.jsx` (alongside the other `vi.mock` calls from Task 7), add the `disablePush` mock using `vi.hoisted()` (so the factory's `disablePush` reference is NOT in its temporal dead zone when `vi.mock` is hoisted — the same discipline as Task 5):
```jsx
const { disablePush } = vi.hoisted(() => ({ disablePush: vi.fn() }));
vi.mock('../push/registerPush.js', () => ({ disablePush }));
```
Then APPEND the teardown describe (add `disablePush.mockReset().mockResolvedValue(undefined);` to the file's existing `beforeEach`):
```jsx
describe('NotificationSettings — turn off push (DELETE teardown)', () => {
  it('fires disablePush(token) and drops to the unavailable state', async () => {
    render(<NotificationSettings nav={nav} data={{}} params={{}} />);
    await waitFor(() => expect(getPushPrefs).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /turn off push on this device/i }));
    await waitFor(() => expect(disablePush).toHaveBeenCalledWith('fcmtok'));
    // After teardown the screen no longer shows the live toggles.
    await waitFor(() =>
      expect(screen.queryByRole('switch', { name: /enable push|push notifications/i })).toBeNull(),
    );
    expect(screen.getByText(/not registered|unavailable|turned off/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it — Expected: FAIL** (no "Turn off push" control yet):
  `npm test -- NotificationSettings`

- [ ] **Step 3: Minimal impl.** In `mobile/src/views/NotificationSettings.jsx`:
  - Add the import: `import { disablePush } from '../push/registerPush.js';`
  - Pass a teardown callback down to `Controls`; in the parent, after `disablePush` resolves, set the unavailable state:
```jsx
  // inside NotificationSettings(): give Controls a teardown that, once the
  // backend DELETE + local clear complete, drops the screen to "turned off".
  const onTurnOff = async () => {
    await disablePush(token);
    setPrefs(null);
    setToken(null);
    setState({ status: 'unavailable', reason: 'turned-off' });
  };
  // ...pass onTurnOff to <Controls .../>
```
  - Render the unavailable copy for the new reason and add the button at the end of `Controls`:
```jsx
  // in the unavailable branch, handle the new reason:
  // reason === 'turned-off' ? 'Push is turned off on this device. Re-enable notifications in system settings, then reopen the app.' : ...

  // at the end of the Controls component, after the master toggle:
      <button
        type="button"
        className="notif-turnoff"
        onClick={onTurnOff}
      >
        Turn off push on this device
      </button>
```
  (Thread `onTurnOff` through `Controls`' props; keep the optimistic-toggle code from Task 8 unchanged.)

- [ ] **Step 4: Run it — Expected: PASS:**
  `npm test -- NotificationSettings`

- [ ] **Step 5: Commit.**
  `git add mobile/src/views/NotificationSettings.jsx mobile/src/views/NotificationSettings.test.jsx && git commit -m "feat(mobile): turn-off-push control wires disablePush DELETE teardown"`

---

## Task 9: Screen styles — `.notif-*` rows + `.alerts-gear` enabled state (One Dark Pro tokens, ≥44px)

**Files:**
- Modify: `mobile/src/MobileApp.css`

**Interfaces:**
- Produces: CSS classes `.notif-controls`, `.notif-row` (≥44px min-height flex row), `.notif-row__label`, `.notif-switch`, `.notif-unavailable`, and an `.alerts-gear:not([disabled])` enabled style. All using existing design tokens (`--bg-card`, `--text-primary`, `--text-muted`, `--border-color`, `--accent`, `--card-radius-sm`, `--space-*`, `--font-display`).
- Consumes: nothing (pure CSS; visual). No test (no JS behavior) — verified by the screen test's `.notif-row` presence assertion + the build.

- [ ] **Step 1: Add the styles.** Append to `mobile/src/MobileApp.css`:
```css
/* Phase 5: Notification Settings screen. One Dark Pro tokens; >=44px rows. */
.notif-controls { display: flex; flex-direction: column; }
.notif-row {
  display: flex; align-items: center; justify-content: space-between;
  min-height: 44px; padding: var(--space-2) var(--space-1);
  border-bottom: 1px solid var(--border-color);
}
.notif-row__label { color: var(--text-primary); font-size: var(--text-base); }
.notif-switch { width: 44px; height: 44px; accent-color: var(--accent); cursor: pointer; }
.notif-unavailable { color: var(--text-muted); font-size: var(--text-base); padding: var(--space-2) 0; }

/* Phase 5: destructive "turn off push on this device" (the DELETE teardown). */
.notif-turnoff {
  margin-top: var(--space-3); min-height: 44px; padding: var(--space-2) var(--space-3);
  background: transparent; color: var(--red); border: 1px solid var(--border-color);
  border-radius: var(--card-radius-sm); font-size: var(--text-base); cursor: pointer;
}

/* Phase 5: push-event detail (host events / since-resolved ids rendered from
   the deep-link fallback params when no derived incident matches). */
.push-event__severity { color: var(--text-muted); font-size: var(--text-base); }
.push-event__note { color: var(--text-muted); font-size: var(--text-sm); margin-top: var(--space-2); }

/* Phase 5: enable the Alerts-tab gear (was opacity:0.5/cursor:default while disabled). */
.alerts-gear:not([disabled]) { color: var(--accent); opacity: 1; cursor: pointer; }
```

- [ ] **Step 2: Build check — Expected: PASS** (CSS resolves, no broken token refs):
  `npm run build`

- [ ] **Step 3: Commit.**
  `git add mobile/src/MobileApp.css && git commit -m "style(mobile): notification-settings rows + enabled alerts gear (One Dark Pro)"`

---

## Task 10: Wire the Alerts-tab gear → push the NotificationSettings screen

**Files:**
- Modify: `mobile/src/views/Alerts.jsx` (enable the gear)
- Test: `mobile/src/views/Alerts.test.jsx` (append: gear is enabled + pushes `notificationSettings`)

**Interfaces:**
- Produces: the `.alerts-gear` button is no longer `disabled`; `onClick={() => nav.push('notificationSettings')}`; `aria-label="Notification settings"`.
- Consumes: `nav.push` (from `useNavStack`).

- [ ] **Step 1: Update the test — DELETE the obsolete disabled-gear assertion, ADD the enabled-gear one.** In `mobile/src/views/Alerts.test.jsx` there is an EXISTING passing test that asserts the gear is disabled (currently lines 44–48):
```jsx
  it('renders a disabled, inert notification gear (Phase 5)', () => {
    render(<Alerts data={DATA} nav={{ push: vi.fn() }} />);
    const gear = screen.getByRole('button', { name: /notification settings/i });
    expect(gear).toBeDisabled();
  });
```
This test will go RED once the gear is enabled, so it must be DELETED (not left in place — leaving it makes the suite contradictory and red). REPLACE that entire `it(...)` block with:
```jsx
  it('the gear is enabled and pushes the notificationSettings screen on tap', () => {
    const push = vi.fn();
    render(<Alerts data={DATA} nav={{ push }} />);
    const gear = screen.getByRole('button', { name: /notification settings/i });
    expect(gear).not.toBeDisabled();
    fireEvent.click(gear);
    expect(push).toHaveBeenCalledWith('notificationSettings');
  });
```
`fireEvent` is ALREADY imported in `Alerts.test.jsx` (line 2: `import { render, screen, fireEvent } from '@testing-library/react';`); reuse the existing `DATA` fixture. NOTE the new `aria-label` is the exact string `"Notification settings"` (no "(coming soon)") — the `getByRole({ name: /notification settings/i })` query still matches.

- [ ] **Step 2: Run it — Expected: FAIL** (after the replace, the NEW test fails because the impl gear is still `disabled` with the old `aria-label` and no `onClick`):
  `npm test -- Alerts`

- [ ] **Step 3: Minimal impl.** In `mobile/src/views/Alerts.jsx`, replace the gear `<button>`:
```jsx
        <button
          type="button"
          className="alerts-gear"
          aria-label="Notification settings"
          onClick={() => nav.push('notificationSettings')}
        >
          ⚙
        </button>
```
Update the file header comment line "The notification-settings gear is rendered DISABLED/inert (Phase 5 owns it)." to "The notification-settings gear pushes the NotificationSettings screen (Phase 5)."

- [ ] **Step 4: Run it — Expected: PASS:**
  `npm test -- Alerts`

- [ ] **Step 5: Commit.**
  `git add mobile/src/views/Alerts.jsx mobile/src/views/Alerts.test.jsx && git commit -m "feat(mobile): enable Alerts gear -> push NotificationSettings"`

---

## Task 11: Register the screen + wire `initPush` into MobileApp mount

**Files:**
- Modify: `mobile/src/MobileApp.jsx` (import + SCREENS entry + init effect)
- Test: `mobile/src/MobileApp.test.jsx` (append: SCREENS dispatch + init effect fires once)

**Interfaces:**
- Produces: `SCREENS.notificationSettings = NotificationSettings` so `nav.push('notificationSettings')` renders it; a mount `useEffect(() => { initPush({ nav }); }, [])` calling the push module exactly once. NOT added to `ROOT` (it is a pushed screen, not a tab root).
- Consumes: `./views/NotificationSettings.jsx`; `./push/registerPush.js` `initPush`; the existing `nav` from `useNavStack`.

> `initPush` runs here (not boot) because MobileApp only mounts when `configured===true` — so `setApiBase()`/`initAuthToken()` have already succeeded and a register POST can authenticate. It is the third mount effect alongside LAST_TAB restore and hardware-back.

- [ ] **Step 1: Write failing test.** TWO edits to `mobile/src/MobileApp.test.jsx`:

  **(1a) Add the new module mocks alongside the EXISTING `vi.mock` block (after the `IncidentDetail` mock on line 28).** Once `MobileApp.jsx` imports `NotificationSettings` (which imports `pushPrefsApi` → `@shared/api/client.js` → storage) and `initPush`, the EXISTING shell tests would pull a real import chain (native plugin / storage) they previously didn't — so BOTH must be mocked or the prior Phase-2/3 MobileApp tests break. Use `vi.hoisted()` for `initPush` to avoid the vi.mock-hoist TDZ (`vi.mock` is hoisted above plain `const`s, so the factory would close over `initPush` in its temporal dead zone — exactly the bug `vi.hoisted` exists to prevent):
```jsx
// Phase 5: mock the push init + the settings screen so the existing shell tests
// don't pull the real plugin/storage import chain, and so we can assert initPush.
const { initPush } = vi.hoisted(() => ({
  initPush: vi.fn().mockResolvedValue({ enabled: true, permission: 'granted' }),
}));
vi.mock('./push/registerPush.js', () => ({ initPush, disablePush: vi.fn() }));
vi.mock('./views/NotificationSettings.jsx', () => ({
  default: ({ nav }) => (
    <div>NOTIFICATION_SETTINGS<button onClick={nav.pop}>back</button></div>
  ),
}));
```
  Also add `initPush.mockClear();` to the existing `beforeEach` (so the call-count assertion is isolated per test).

  **(1b) Extend the existing Alerts mock (line 24) so it can push the settings screen** — the deterministic seam for proving the `SCREENS.notificationSettings` dispatch (mirrors the existing Services stub on lines 15–22). CHANGE the static Alerts mock to:
```jsx
vi.mock('./views/Alerts.jsx', () => ({
  default: ({ nav }) => (
    <div>
      <div>AlertsView</div>
      <button onClick={() => nav.push('notificationSettings')}>go-settings</button>
    </div>
  ),
}));
```

  **(1c) Append the two REAL tests** (the second is a genuine render-through-the-SCREENS-map assertion — NOT `expect(true).toBe(true)`; it FAILS until `SCREENS.notificationSettings` is wired):
```jsx
describe('MobileApp shell — Phase 5 push wiring', () => {
  it('calls initPush exactly once on mount, passing the live nav', async () => {
    await act(async () => { render(<MobileApp />); });
    await waitFor(() => expect(initPush).toHaveBeenCalledTimes(1));
    expect(initPush).toHaveBeenCalledWith(expect.objectContaining({ nav: expect.any(Object) }));
  });

  it('registers notificationSettings in SCREENS so nav.push renders it', async () => {
    await act(async () => { render(<MobileApp />); });
    fireEvent.click(screen.getByRole('tab', { name: 'Alerts' }));
    fireEvent.click(screen.getByText('go-settings'));
    expect(screen.getByText('NOTIFICATION_SETTINGS')).toBeInTheDocument();
    expect(screen.queryByText('AlertsView')).toBeNull();
  });
});
```
  This proves the `SCREENS.notificationSettings` key actually dispatches the screen — real coverage, not a tautology. Before this task, pushing `'notificationSettings'` with the key absent renders the `SCREENS[active]` fallback (Alerts), so the second test goes RED until the impl adds the key.

- [ ] **Step 2: Run it — Expected: FAIL** (`initPush` never called; `notificationSettings` not in `SCREENS` so the push renders nothing / the Alerts fallback):
  `npm test -- MobileApp`

- [ ] **Step 3: Minimal impl.** In `mobile/src/MobileApp.jsx`:
  - Add imports:
```jsx
import NotificationSettings from './views/NotificationSettings.jsx';
import { initPush } from './push/registerPush.js';
```
  - Add to the `SCREENS` map:
```jsx
const SCREENS = {
  overview: Overview, services: Services, infra: Infra, alerts: Alerts,
  serviceDetail: ServiceDetail, node: NodeDetail, incident: IncidentDetail,
  notificationSettings: NotificationSettings,
};
```
  - Add the third mount effect (after the hardware-back effect):
```jsx
  // Phase 5: register for push once the app is in the connected state (MobileApp
  // only mounts when configured===true, so base URL + auth token are live). Push
  // depends on a configured backend + Android runtime permission, so it belongs
  // here, NOT in boot.js. nav drives deep-link routing from a tapped push.
  useEffect(() => {
    initPush({ nav: navRef.current });
  }, []);
```
  (Use `navRef.current` so the deep-link push targets the live nav; do NOT add `nav` to the dep array — the effect must run exactly once.)

- [ ] **Step 4: Run it — Expected: PASS:**
  `npm test -- MobileApp`

- [ ] **Step 5: Commit.**
  `git add mobile/src/MobileApp.jsx mobile/src/MobileApp.test.jsx && git commit -m "feat(mobile): register NotificationSettings screen + initPush on mount"`

---

## Task 12: Android manifest — FCM channel meta-data + `jaghelm` deep-link intent-filter + `POST_NOTIFICATIONS`

**Files:**
- Modify: `mobile/android/app/src/main/AndroidManifest.xml`
- Native verify: re-sync after the manifest edit.

**Interfaces:**
- Produces: (a) inside `<application>`, the FCM `default_notification_channel_id` + `default_notification_icon` `<meta-data>` so FCM-routed notifications use `jaghelm-incidents`; (b) the `jaghelm` custom-scheme `<intent-filter>` on the Capacitor `MainActivity` so `jaghelm://incident/<id>` URLs reach the app and fire `appUrlOpen` (deep-link path B, Task 6b); (c) an EXPLICIT `<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />` (do NOT rely silently on plugin manifest-merge — declaring it explicitly is the deterministic, verifiable path).
- Consumes: the EXISTING launcher icon `@mipmap/ic_launcher` (a dedicated white-on-transparent `@mipmap/push_icon` is explicitly OUT of scope — see Global Constraints; do NOT fabricate the asset).

> No unit test (native manifest). The WebView origin scheme stays `https://localhost` (`capacitor.config.ts` `androidScheme: 'https'` — DESIGN line 254); the `jaghelm` scheme here is a SEPARATE deep-link intent-filter, not the WebView origin. **Sandbox honesty:** this agent runs as `ilaaj-agent` (sandboxed); a full `./gradlew assembleDebug` + APK / merged-manifest inspection realistically CANNOT complete in-sandbox. So the manifest edits (Steps 1–3) are done + committed here, and the APK-build + merged-manifest verification (Step 4) is an EXPLICIT human-handoff to run on Jag's box — NOT a silently-skipped `|| echo` no-op. The source-manifest grep (Step 3) IS runnable in-sandbox and is the in-sandbox gate.

- [ ] **Step 1: Add the channel meta-data.** Inside the `<application>` element of `mobile/android/app/src/main/AndroidManifest.xml`, add:
```xml
        <meta-data
            android:name="com.google.firebase.messaging.default_notification_channel_id"
            android:value="jaghelm-incidents" />
        <meta-data
            android:name="com.google.firebase.messaging.default_notification_icon"
            android:resource="@mipmap/ic_launcher" />
```
(The client-side `createChannel('jaghelm-incidents')` in Task 5 is the primary channel guarantee; this meta-data is the FCM-routing belt. `@mipmap/ic_launcher` exists in the scaffolded project — verified — so the icon resource resolves.)

- [ ] **Step 2: Add the `jaghelm` deep-link intent-filter + explicit POST_NOTIFICATIONS.** Add the `<uses-permission>` inside `<manifest>` (top level), and the `<intent-filter>` INSIDE the existing `<activity android:name=".MainActivity">` element (alongside its launcher intent-filter — do NOT remove the launcher one):
```xml
    <!-- inside <manifest>, alongside the existing INTERNET permission -->
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```
```xml
        <!-- inside <activity android:name=".MainActivity" ...>, a SECOND intent-filter
             for the jaghelm://incident/<id> custom-scheme deep link (path B). -->
        <intent-filter>
            <action android:name="android.intent.action.VIEW" />
            <category android:name="android.intent.category.DEFAULT" />
            <category android:name="android.intent.category.BROWSABLE" />
            <data android:scheme="jaghelm" android:host="incident" />
        </intent-filter>
```

- [ ] **Step 3: In-sandbox gate — confirm the source manifest carries all three.** From `mobile/` (runnable as `ilaaj-agent`):
  `grep -c "POST_NOTIFICATIONS" android/app/src/main/AndroidManifest.xml` (expect `1`)
  `grep -c 'android:scheme="jaghelm"' android/app/src/main/AndroidManifest.xml` (expect `1`)
  `grep -c "default_notification_channel_id" android/app/src/main/AndroidManifest.xml` (expect `1`)
  All three MUST be present in the SOURCE manifest before committing — this is the deterministic in-sandbox check (no `|| echo` escape; a `0` count is a hard fail to fix).

- [ ] **Step 4: HUMAN-HANDOFF (run on Jag's box, NOT silently skipped) — sync + debug build + merged-manifest verify.** Document this in the PR as a manual verification step:
  `source ~/.android-env && npx @capacitor/cli sync android && (cd android && ./gradlew assembleDebug)`
  Expected on a real Android toolchain: build succeeds; `android/app/build/outputs/apk/debug/app-debug.apk` exists; the merged manifest contains `POST_NOTIFICATIONS` and the `jaghelm` scheme:
  `grep -R "POST_NOTIFICATIONS" android/app/build/intermediates/merged_manifests/ | head -1`
  `grep -R 'android:scheme="jaghelm"' android/app/build/intermediates/merged_manifests/ | head -1`
  If `assembleDebug` cannot run in-sandbox, STATE that explicitly in the PR ("APK build pending verification on Jag's box") — do NOT mark Step 4 done from a no-op.

- [ ] **Step 5: Commit.**
  `git add mobile/android/app/src/main/AndroidManifest.xml && git commit -m "feat(mobile): FCM channel meta-data + jaghelm deep-link intent-filter + POST_NOTIFICATIONS"`

---

## Task 13: Root-CI verification — the durable full-pipeline gate (FROM REPO ROOT)

**Files:**
- No production change. This task RUNS the durable Phase-2/3 pre-done gate: the ROOT pipeline, not a `cd mobile` shortcut.

**Interfaces:**
- Consumes: every file produced/modified above.
- Produces: a green ROOT pipeline proving no cross-cutting regression (root lint sweeps mobile via flat config; root suites cover server + shared `src/`; mobile units run separately).

> DURABLE LESSON (Phase 2/3): verify from REPO ROOT. `npm run lint` is `eslint .` (whole repo incl. mobile); `npm test` and `npm run test:client` sweep server + shared `src/`. A mobile-only `cd mobile && npm test` MISSES lint + cross-cutting regressions — that gap bit prior phases. Run all four below from the repo root.

- [ ] **Step 1: Root lint — Expected: PASS** (eslint over the WHOLE repo, mobile included):
  `npm run lint`
  Fix any lint errors in the new `mobile/src/push/**` + `NotificationSettings.jsx` (unused vars, hooks-deps, etc.) until clean.

- [ ] **Step 2: Root backend/shared test suite — Expected: PASS** (no server/`src` regression from additive mobile work):
  `npm test`

- [ ] **Step 3: Root client (shared `src/`) vitest — Expected: PASS:**
  `npm run test:client`

- [ ] **Step 4: Mobile vitest suite — Expected: PASS** (all new push + screen tests green):
  `npm --prefix mobile test`

- [ ] **Step 5: Mobile build sanity — Expected: PASS** (the screen + push imports bundle cleanly):
  `npm run mobile:build`

- [ ] **Step 6: Post-implementation review gates (HARD RULE).** Run `/simplify` then `/security-review` over the Phase 5 diff; address findings; re-run Steps 1–4 if any code changed. Do NOT call Phase 5 done until all four root commands + the two review gates pass.

- [ ] **Step 7: Final commit (only if review applied changes).**
  `git add -A && git commit -m "chore(mobile): phase 5 root-CI green + review fixes"`

> The human merge gate is never bypassed: open a PR for Jag to review + merge. No push to main, no auto-merge, no `Co-Authored-By` trailer.

---

## Self-Review (performed 2026-06-26)

**Spec coverage** — every Phase 5 scope item maps to a task:
- Install `@capacitor/push-notifications` (correct v8 for Cap 8) → Task 1 (version-floor assertion `^8.x`).
- Testable push module: permission request, register, listeners, token POST `/push/register`, `registrationError`, foreground receive → Tasks 5 (gate/channel/listeners/order) + 6 (token POST, error, foreground-receive-logs).
- Deep-link routing (WORKING — id namespaces reconciled, both paths) → Task 2a (`fcmIdToIncidentId` reconciler) + Task 2b (`routeFromData` pushes the RECONCILED id + fallback params) + Task 2c (`IncidentDetail` renders host-events / resolved ids from fallback params, not the dead stub) + Task 2d (`routeFromUrl` for the `jaghelm://` scheme) + Task 6 (action-performed listener) + Task 6b (`appUrlOpen` listener). EVERY tapped push — including LIVE service/cron/ups incidents and ALL four host event types — now lands on a real detail screen.
- Push-init into boot/App → Task 11 (`MobileApp` mount effect, explicitly NOT boot.js; `initPush({ nav: navRef.current })`).
- NotificationSettings screen: 4 category toggles + notify-on-recovery + master + GET/PUT `/push/prefs` → Tasks 7 (read/gray-out) + 8 (optimistic strict-PUT) + 8b (turn-off-push DELETE teardown) + 9 (styles).
- Alerts-tab gear entry + SCREENS key → Task 10 (gear, with the obsolete disabled-gear test DELETED) + Task 11 (SCREENS key + a real dispatch test).
- Push-disable teardown: DELETE `/api/push/register` → Task 6 `disablePush` (DELETE + `removeAllListeners` + local clear) WIRED to the "Turn off push on this device" settings control in Task 8b. The mobile shell has NO logout flow (verified — `grep -rniE 'logout|signOut|disconnect' mobile/src/` returns nothing; shared `src/App.jsx` is the desktop path, out of bounds), so DESIGN line 430's "DELETE on logout / push-disable" is satisfied via the push-disable surface, NOT a logout call site or a `src/App.jsx` edit (locked decision 9). Master-off remains the SOFT `PUT enabled:false` path (Task 8), NOT DELETE (locked decision 4). `disablePush` is therefore LIVE-wired, not dead code.
- Android 13 `POST_NOTIFICATIONS` → constraints + Task 5 (`requestPermissions` drives it) + Task 12 (EXPLICIT `<uses-permission>` in the source manifest + in-sandbox grep gate). Custom-scheme deep link → Task 12 `jaghelm` `<intent-filter>` on `.MainActivity`.
- Final root-CI verification (root `npm test` + `npm run lint` + `npm run test:client`, NOT cd-mobile) → Task 13 (all four from repo root + build + review gates).
- Honored gotchas verbatim: token field `value` not `token` (Task 5 impl + constraint); listeners-before-register ordering test (Task 5 order assertion, clean `register is last` check — the earlier arithmetic kludge removed); strict full-replace PUT, no extra keys (Task 8 key-set assertions); status key is `enabled` not `isPushEnabled` (Task 7); `?token=` is the FCM device token, distinct from `x-auth-token` (Task 3 note); FCM data values all strings (Task 2b); single `jaghelm-incidents` channel importance-max (Task 5); two-token non-conflation (constraints + Task 3); server `{ error }` message surfaced on non-2xx so 400 'malformed prefs' vs 404 'token not found' are distinguishable (Task 3 `asJson`). M3a removeItem-throws avoided by Preferences-only push state (Task 4 + Task 6 uses `setPref('', )` not `removeItem`). Parallel-dispatch cap + dedicated push-icon asset explicitly out-of-scope (constraints). UX: ≥44px row (Task 9 CSS) verified as a CSS-class-presence smoke check honestly labeled (Task 7 — jsdom has no layout), no false "all clear"/"push on" (Task 7 gray-out tests), One Dark Pro tokens (Task 9 — all referenced tokens `--red`/`--text-sm`/`--space-3`/etc. verified to exist).

**Placeholder scan** — re-grepped the draft for `TODO`/`FIXME`/`...`/`<impl here>`/`expect(true).toBe(true)`/prose-only test bodies: ZERO remain in code/test steps. The former Task-11 `expect(true).toBe(true)` tautology is REPLACED with a real SCREENS-dispatch render test; the former Task-12 `|| echo` silent no-op + the Task-1 `|| echo` are REPLACED with deterministic in-sandbox source-manifest greps + an explicit human-handoff for the APK build; the Task-4 `node:test` hedge and Task-12 `push_icon` hand-wave are removed. Every Step 1 ships REAL test code; every Step 3 ships REAL implementation; every run step has an exact command + expected result (native APK steps are explicitly flagged as human-handoff, not silently passed). (The word "placeholder" remains only in the Phase-3 IncidentDetail timeline comment I am NOT changing and in this scan sentence.)

**Type consistency** — cross-checked signatures against the ground-truth contracts: `fcmIdToIncidentId(type, fcmId)` maps onto the verified derived id space (`service:`+id / `cron:`+id / `ups:apcups` / host→`null`, against `derive.js` 132/140/147 + Alerts.test). `routeFromData(data, nav)` reads only `{type,id,node,severity}` (the exact 4 data keys, all strings), RECONCILES the id, and calls `nav.push('incident', { id, fcmId, type, node, severity })` matching `useNavStack.push(screen, params)`. `routeFromUrl` parses `jaghelm://incident/<id>?type=&node=&severity=` into that data shape and delegates. `IncidentDetail` looks up by the reconciled `params.id` (live path unchanged) and renders the fallback from `params.type/node/severity/fcmId` otherwise. `pushPrefsApi` URLs use `getApiBase()+'/push/...'` (base ends in `/api`, keeps the auth guard true); `setPushPrefs` body is exactly `{token, prefs}` with the strict 3-key/4-category prefs shape (matches `validPrefsShape`); `getPushStatus` returns `{enabled}` (correct key); `deleteToken`/`registerToken` send the FCM token in the BODY with `content-type: application/json`; `registerToken` sends `appVersion: '1.4.0'` (matches `mobile/package.json` version, verified). `registration` handler reads `token.value` (NOT `.token`). Screen signature `({nav,data,params})` matches the uniform MobileApp dispatch; `SCREENS.notificationSettings` not added to `ROOT` (pushed, not tab root). Preferences keys are non-secret and routed through `setPref`/`getPref` (never Keystore). The FCM-id↔derived-id reconciliation is now BUILT (Tasks 2a–2c), not deferred. No type mismatches block implementation.
