# JagHelm Mobile Phase 6 — Build & Distribution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the build-and-distribution half of JagHelm mobile: a `signingConfigs.release` in `mobile/android/app/build.gradle` keyed on the **presence** of `keystore.properties` (graceful-disable house style — absent file ⇒ unsigned release that still builds and is NEVER downgraded to the debug key), a committed `keystore.properties.example` template that does not trip the secret-scan floor, `.gitignore` coverage proving real key material can never be committed, a `.github/workflows/build-apk.yml` CI workflow (triggered on `mobile-v*` tags + `workflow_dispatch`) that decodes the keystore from four GitHub secrets to a temp path, writes `keystore.properties`, runs `./gradlew assembleRelease`, verifies the signature with `apksigner`, guards the artifact path against leaked secrets, **shreds the signing material in an `if: always()` step**, and uploads the signed APK artifact — plus an operator runbook (`KEYSTORE.md`) and the mobile PR-check lane (already present in `build-push.yml`, asserted here).

**Architecture:** Signing presence IS the flag, mirroring the existing conditional google-services apply in the same `build.gradle` (`try { file('google-services.json') … apply plugin }`). At the top of `mobile/android/app/build.gradle`, `def hasReleaseKeystore = rootProject.file("app/keystore.properties").exists()` loads the props only when present; `signingConfigs.release` is defined ONLY inside `if (hasReleaseKeystore)`, and `buildTypes.release.signingConfig` is wired ONLY inside the same guard. When absent, `signingConfig` stays `null` ⇒ the release APK is built **unsigned** (fail-loud on sideload) rather than silently debug-signed (installs but unshippable). CI injects the credential exactly as the FCM SA and `google-services.json` are CI-injected: base64 secret → `base64 -d` straight to a file → `keystore.properties` written from env → consumed by Gradle → **shredded in `if: always()`**. No secret value is ever echoed; the artifact path is guarded so no signing material can ride along in the upload. For sideload-only distribution (no Play Store) a single self-signed key suffices and MUST be reused for every update.

**Tech Stack:** Capacitor 8.4.1 (`@capacitor/cli`/`@capacitor/android` ^8.4.1), Gradle 8.14.3 wrapper (google-services 4.4.4 already classpath-wired), JDK 17 (CI) / 21 (local Android Studio), Android `targetSdk`/`compileSdk` 36 / `minSdk` 24 (`mobile/android/variables.gradle`), GitHub Actions (full-SHA-pinned actions, matching `build-push.yml`), `keytool` (key gen), `apksigner` (sign verify, from SDK build-tools).

## Global Constraints

- **Signing-config presence IS the flag (graceful disable, HARD).** Define `signingConfigs.release` and wire `buildTypes.release.signingConfig` ONLY inside `if (hasReleaseKeystore)`. Absent `keystore.properties` ⇒ `assembleRelease` still succeeds and emits an UNSIGNED APK. NEVER fall back to `signingConfigs.debug` for release — a debug-signed "release" installs but is unshippable and is the default Gradle trap.
- **`keystore.properties` path consistency (HARD).** The gradle script resolves `rootProject.file("app/keystore.properties")` (`rootProject` = the `android/` Gradle project ⇒ `mobile/android/app/keystore.properties`). `storeFile file(...)` resolves the bare filename relative to the module dir `mobile/android/app/`. CI writes both the decoded keystore and `keystore.properties` into `mobile/android/app/`. Keep all three consistent or you get a `FileNotFoundException` only at release time.
- **Secrets are NEVER committed (public repo).** Real `.jks`/`.keystore`/`keystore.properties` are gitignored (parent `mobile/.gitignore` path-agnostic globs + the `mobile/android/.gitignore` defense-in-depth). The committed template is `keystore.properties.example` only.
- **Secret-scan floor (Phase-0 gate) MUST stay green (HARD).** `keystore.properties.example` uses **unquoted** placeholders (`storePassword=CHANGE_ME`) — the GENERIC rule only fires on **quoted** ≥12-char high-entropy values, so unquoted placeholders never reach it and no FORMAT rule matches. `build-apk.yml` references `${{ secrets.* }}` (never seen by the scanner) and never inlines a literal credential. No new `# pragma: allowlist secret` is needed if these shapes are honored. This whole phase is secret-adjacent ⇒ gated on the merged Phase-0 floor.
- **`.gitignore` order: globs then negations.** The `mobile/.gitignore` template-negation block (`!**/*.example`) MUST stay AFTER the secret globs so the committed `.example` survives while real key material is ignored. Verify `git check-ignore` lists the real files and `git status` shows only the `.example`.
- **CI secret hygiene (HARD).** No secret value is ever echoed (no `set -x`); secrets reach the shell only as `env:` vars and are written with `printf` into files. base64 decode is piped straight to file. Cleanup is `if: always()`. An artifact-secret guard fails the job if any signing material is in the upload path. `permissions: contents: read` (least privilege).
- **Action pinning style (match repo).** Every `uses:` is pinned to a full 40-char commit SHA with a trailing `# vN` comment, exactly like `build-push.yml`. Node version `'22'` with npm cache. No floating tags.
- **In-sandbox limits (honest handoff).** The sandbox has no Gradle/Android SDK and no signing secrets, so `./gradlew assembleRelease` and the on-device sideload are HUMAN-HANDOFFS — documented in the PR, NOT marked done from a skipped run, NEVER a `|| echo` silent no-op.
- **Out of scope (do NOT implement here):** prod FCM service-account CI-injection on **deploy** (a SEPARATE follow-up — the server-side push pipeline already ships graceful-disable from Phase 4; Phase 6's only credential concern is the build-time keystore + `google-services.json`); App Bundle (`.aab`)/Play Store upload (sideload only); per-ABI splits; R8/minify enablement (`minifyEnabled false` stays); a bespoke push icon (Phase-5 polish note).
- **PRE-DONE CI GATE (durable lesson — HARD):** the final task verifies via the ROOT pipeline FROM REPO ROOT — `npm run lint` AND `npm test` AND `npm run test:client` AND `npm --prefix mobile test`. Do NOT settle for a `cd mobile` shortcut. After implementation, run `/simplify` then `/security-review` before calling Phase 6 done. The human merge gate (Jag reviews + merges the PR) is never bypassed — no push to main, no auto-merge, no `Co-Authored-By` trailer.

---

## File Structure

Every path is relative to the repo root (`/home/ilaaj-agent/jaghelm`, or your worktree). NEW unless marked MODIFY.

| Path | Responsibility |
|---|---|
| `mobile/android/app/build.gradle` (MODIFY) | Add `signingConfigs.release` reading `app/keystore.properties`, GUARDED by `if (hasReleaseKeystore)`; wire `buildTypes.release.signingConfig` only in the same guard; absent ⇒ unsigned, never debug-signed. |
| `mobile/android/keystore.properties.example` | Committed, non-secret template (unquoted `CHANGE_ME` / `jaghelm-upload` placeholders) describing the four keys; documents that CI injects + shreds these. Survives the gitignore globs via the `.example` negation. |
| `mobile/android/.gitignore` (MODIFY) | Defense-in-depth: uncomment `*.jks` / `*.keystore`, add `keystore.properties` (parent already covers them path-agnostically; this makes the android subtree self-protecting). |
| `.github/workflows/build-apk.yml` | NEW CI: `mobile-v*` tag + `workflow_dispatch`; JDK 17 temurin; Node 22; Android SDK; `npm ci` + vite mobile build + `cap sync android`; decode `KEYSTORE_BASE64` → file + write `keystore.properties` from secrets; `./gradlew assembleRelease`; `apksigner verify`; artifact-secret guard; `if: always()` shred; upload signed APK. Full-SHA-pinned actions. |
| `docs/mobile/KEYSTORE.md` | Operator runbook for Jag: `keytool -genkeypair` (RSA 2048, validity 10000, alias `jaghelm-upload`), `base64 -w0` encode, the four exact secret names, trigger via tag/dispatch, sideload/install + same-key-forever rule. |
| `docs/mobile/plans/2026-06-26-mobile-phase6-signed-apk.md` | This plan. |

**NOT changed (already in place):** the conditional google-services Gradle apply, `capacitor.config.ts`, `variables.gradle` (SDK 36 / minSdk 24), the Gradle wrapper, the parent `mobile/.gitignore` secret globs + `.example` negation, `mobile/keystore.properties.example` (the Phase-0 stub — superseded by the `mobile/android/` one this phase owns), and the **mobile PR-check lane** (`build-push.yml`'s `test` job already runs `npm ci && npm test` + `npm audit` in `mobile`; asserted, not re-added).

---

## Build order

Leaf-first so each task's dependencies already exist:
1. **Signing config + `keystore.properties.example`** (Task 1) — the Gradle seam + the committed template; everything else assumes it.
2. **`.gitignore` defense-in-depth + leak proof** (Task 2) — prove real key material can never be committed.
3. **`build-apk.yml` CI workflow** (Task 3) — decode → write props → assembleRelease → verify → guard → shred → upload.
4. **Operator runbook `KEYSTORE.md`** (Task 4) — the human handoff for key gen + secret setup + sideload.
5. **Root-CI verification gate** (Task 5) — the durable full-pipeline gate + `/simplify` + `/security-review`.

---

## Locked design decisions (controller, 2026-06-26)

1. **Signing presence IS the flag.** `signingConfigs.release` + `buildTypes.release.signingConfig` live ONLY inside `if (hasReleaseKeystore)`; absent ⇒ unsigned (build still succeeds), NEVER debug-signed. Mirrors the conditional google-services apply in the same file.
2. **Throwaway-key-to-verify-then-swap.** Because the sandbox has no signing secrets, the agent can VERIFY the wiring with a locally-generated **throwaway** keystore (a temporary `keystore.properties` + a `keytool` dummy `.jks`, both gitignored, deleted after) to confirm `assembleRelease` produces a signed APK end-to-end where a toolchain exists — but Jag's REAL `jaghelm-upload` key is generated by the operator (Task 4 / `KEYSTORE.md`) and set as the four secrets. The throwaway key is never committed and never used to ship.
3. **`keystore.properties` canonical path = `mobile/android/app/keystore.properties`.** Gradle reads `rootProject.file("app/keystore.properties")`; CI writes the keystore + props into `mobile/android/app/`; `storeFile` is a bare filename resolved by `file(...)` relative to that module dir. The Phase-0 `mobile/keystore.properties.example` stub is superseded by the `mobile/android/keystore.properties.example` this phase owns (next to where Gradle reads it).
4. **CI credential injection mirrors the FCM SA / google-services pattern:** base64 secret → temp file → consume → shred in `if: always()`. Plus an `apksigner verify` (fail-loud on unsigned) and an artifact-secret guard (fail if any key material is in the upload path) before publish.
5. **Sideload-only ⇒ one self-signed key, reused forever.** No Play Store, no upload-key/app-signing-key split. A different key on update ⇒ `INSTALL_FAILED_UPDATE_INCOMPATIBLE`; documented in `KEYSTORE.md`.
6. **Prod FCM service-account CI-injection on DEPLOY is a SEPARATE follow-up.** Out of scope here. Phase 6's only credential surface is the build-time keystore (+ `google-services.json` already handled by the conditional apply). The runtime push pipeline already graceful-disables from Phase 4.

---

## Task 1: Signing config + `keystore.properties.example` (graceful local fallback)

**Files:**
- Modify: `mobile/android/app/build.gradle`
- Create: `mobile/android/keystore.properties.example`

**Interfaces:**
- Produces: a `signingConfigs.release` that exists ONLY when `keystore.properties` is present; `buildTypes.release` signed only then, else unsigned (never debug-signed).
- Consumes: the existing conditional-apply house style in the same `build.gradle` (google-services).

- [ ] **Step 1: Write the guard + example.** Add the top-of-file `hasReleaseKeystore` load (`rootProject.file("app/keystore.properties")`), the guarded `signingConfigs.release`, and the guarded `buildTypes.release.signingConfig`. Create `mobile/android/keystore.properties.example` with UNQUOTED placeholders (`storeFile=jaghelm-release.jks`, `storePassword=CHANGE_ME`, `keyAlias=jaghelm-upload`, `keyPassword=CHANGE_ME`).
- [ ] **Step 2: Secret-floor check — Expected: PASS (clean).** `python3 scripts/secret-scan.py mobile/android/keystore.properties.example mobile/android/app/build.gradle` → `✓ no secrets detected`, exit 0.
- [ ] **Step 3: (HUMAN-HANDOFF) Throwaway-key signed-build verify.** On a box with the Android toolchain: `source ~/.android-env`, `keytool -genkeypair -keystore mobile/android/app/jaghelm-release.jks -alias jaghelm-upload -keyalg RSA -keysize 2048 -validity 10000` (dummy passwords), write a matching gitignored `mobile/android/app/keystore.properties`, then `(cd mobile/android && ./gradlew assembleRelease)` and `apksigner verify --print-certs -v mobile/android/app/build/outputs/apk/release/*.apk` → `Verified using v2 scheme: true`. Then verify the ABSENT path: delete `keystore.properties` + the `.jks`, re-run `assembleRelease` → still succeeds, APK is UNSIGNED (`apksigner verify` exits non-zero). Document in the PR; do NOT mark done from a skipped sandbox run.
- [ ] **Step 4: Commit.** `git add mobile/android/app/build.gradle mobile/android/keystore.properties.example && git commit -m "feat(mobile): graceful release signing config keyed on keystore.properties"`

---

## Task 2: `.gitignore` defense-in-depth + no-leak proof

**Files:**
- Modify: `mobile/android/.gitignore`

**Interfaces:**
- Produces: a self-protecting `mobile/android/` subtree (real `.jks`/`.keystore`/`keystore.properties` ignored) without breaking the committed `.example`.

- [ ] **Step 1: Uncomment + add.** In `mobile/android/.gitignore` uncomment `*.jks` / `*.keystore` and add `keystore.properties`.
- [ ] **Step 2: Leak proof — Expected: real key material IGNORED.** Drop fake `mobile/android/app/{keystore.properties,jaghelm-release.jks}` + a `*.keystore`; `git check-ignore` lists all three; `git status --short mobile/android/` shows ONLY the gitignore + the `.example` (never the key files). Delete the fakes.
- [ ] **Step 3: Commit.** `git add mobile/android/.gitignore && git commit -m "chore(mobile): gitignore release keystore material under android/ (defense-in-depth)"`

---

## Task 3: `build-apk.yml` CI workflow — decode + shred + verify + artifact guard

**Files:**
- Create: `.github/workflows/build-apk.yml`

**Interfaces:**
- Produces: a signed `app-release.apk` artifact on a `mobile-v*` tag or manual dispatch; secrets shredded `if: always()`.
- Consumes: four GitHub secrets (`KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`) + the Task-1 Gradle signing config.

- [ ] **Step 1: Write the workflow.** Triggers (`push` tags `mobile-v*` + `workflow_dispatch`), `permissions: contents: read`, full-SHA-pinned actions (checkout/setup-node v5 from `build-push.yml`; setup-java v4, setup-android v3, upload-artifact v4 SHAs resolved against the GitHub API), Node 22 + npm cache, `npm ci` + `npm run build` + `npx cap sync android` (in `mobile`), decode `KEYSTORE_BASE64` straight to `mobile/android/app/release.keystore` + write `keystore.properties` from secrets via `printf`, `./gradlew assembleRelease` (in `mobile/android`), `apksigner verify --min-sdk-version 24`, artifact-secret guard, `if: always()` shred, upload `mobile/android/app/build/outputs/apk/release/*.apk`.
- [ ] **Step 2: YAML + secret-floor check — Expected: PASS.** `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/build-apk.yml'))"` parses; `python3 scripts/secret-scan.py .github/workflows/build-apk.yml` → clean.
- [ ] **Step 3: (HUMAN-HANDOFF) Live CI run.** After Jag sets the four secrets (Task 4), push a `mobile-v*` tag or run the workflow manually; confirm the run is green, `apksigner verify` reports v2 `true`, and the `jaghelm-release-apk` artifact downloads. Document in the PR; cannot run in-sandbox (no secrets / no runner).
- [ ] **Step 4: Commit.** `git add .github/workflows/build-apk.yml && git commit -m "ci(mobile): signed release APK workflow (decode→assembleRelease→verify→shred→upload)"`

---

## Task 4: Operator runbook `KEYSTORE.md`

**Files:**
- Create: `docs/mobile/KEYSTORE.md`

**Interfaces:**
- Produces: the step-by-step Jag runbook (key gen → base64 → four secrets → trigger → sideload).

- [ ] **Step 1: Write the runbook.** `keytool -genkeypair` (RSA 2048, validity 10000, alias `jaghelm-upload`), `base64 -w0`, the four exact secret names, tag/dispatch trigger, `apksigner verify`, `adb install -r` / file-manager sideload, the same-key-forever rule, backup warning.
- [ ] **Step 2: Commit.** `git add docs/mobile/KEYSTORE.md && git commit -m "docs(mobile): release keystore + signed-APK operator runbook"`

> Plan + the copied `docs/mobile/` plan history are committed alongside (the prior phase plans were untracked in the main checkout; this phase lands them in git so the mobile plan trail is versioned).

---

## Task 5: Root-CI verification — the durable full-pipeline gate (FROM REPO ROOT)

**Files:** No production change. RUNS the durable pre-done gate.

- [ ] **Step 1: Root lint — Expected: PASS.** `npm run lint`
- [ ] **Step 2: Root backend/shared suite — Expected: PASS.** `npm test`
- [ ] **Step 3: Root client vitest — Expected: PASS.** `npm run test:client`
- [ ] **Step 4: Mobile vitest — Expected: PASS.** `npm --prefix mobile test`
- [ ] **Step 5: (HUMAN-HANDOFF) APK build sanity.** No signing secrets / full Android SDK in-sandbox ⇒ `./gradlew assembleRelease` + sideload are operator steps (Tasks 1/3 handoffs + `KEYSTORE.md`). State explicitly in the PR; do NOT mark done from a skipped run.
- [ ] **Step 6: Post-implementation review gates (HARD RULE).** Run `/simplify` then `/security-review`; address findings; re-run Steps 1–4 if code changed.
- [ ] **Step 7: Final commit (only if review applied changes).**

> The human merge gate is never bypassed: open a PR for Jag to review + merge. No push to main, no auto-merge, no `Co-Authored-By` trailer.

---

## Self-Review (performed 2026-06-26)

**Spec coverage** — every Phase 6 scope item (DESIGN.md line 788) maps to a task:
- `build-apk.yml` (ephemeral runner, `if: always()` secret-shred, artifact-secret guard) → Task 3 (shred step `if: always()`; the "Guard against secret leakage into the artifact" step).
- keystore / `google-services.json` CI secrets → Task 3 (`KEYSTORE_BASE64`/`KEYSTORE_PASSWORD`/`KEY_ALIAS`/`KEY_PASSWORD`); `google-services.json` keeps its existing conditional Gradle apply (no change needed) — noted in "NOT changed".
- signing config with local fallback → Task 1 (graceful-disable, presence-is-the-flag).
- release-attached signed APK → Task 3 (`apksigner verify` + `upload-artifact`). (Sideload distribution ⇒ artifact, not a GitHub Release attach; the artifact IS the release vehicle — documented in `KEYSTORE.md`.)
- mobile PR-check lane → already in `build-push.yml`'s `test` job (mobile `npm test` + `npm audit`); asserted in "NOT changed", re-confirmed by Task 5 Step 4.

**Throwaway-key-to-verify-then-swap** — Task 1 Step 3 uses a gitignored, deleted-after dummy `.jks` to prove the signed-vs-unsigned wiring where a toolchain exists; Jag's real `jaghelm-upload` key is operator-generated and never enters the repo.

**Two operator handoffs (explicit, never silently passed):**
1. Generate the real keystore + set the four GitHub secrets (`KEYSTORE.md` §1–3).
2. On-device signed-APK sideload + first-run test (`KEYSTORE.md` §6 / DESIGN E2E line 810).

**Out-of-scope confirmed:** prod FCM service-account CI-injection on deploy is a SEPARATE follow-up (DESIGN line 543) — NOT in this phase; the runtime push pipeline already graceful-disables (Phase 4).

**Placeholder scan** — no TODO/FIXME left in shipped config; the `keystore.properties.example` placeholders are intentional unquoted dummies that pass the secret floor; native/SDK steps are flagged as honest human-handoffs, never silently passed with `|| echo`.

**Floor consistency** — `keystore.properties.example` and `build-apk.yml` both scanned clean by `scripts/secret-scan.py`; no new pragma needed (unquoted placeholders + `${{ secrets.* }}` references only).
