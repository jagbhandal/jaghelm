# JagHelm Mobile — Release Keystore & Signed-APK Operator Runbook

This is the operator runbook for **Jag**. JagHelm mobile is distributed as a
**signed APK that you sideload** onto your phone — there is **no Play Store**. So a
single, self-signed release key is all you need. The only hard rule: **every future
update MUST be signed with the SAME key**, or Android refuses to install the update
over the existing app (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`). Generate the key once,
back it up, and reuse it forever.

The CI workflow `.github/workflows/build-apk.yml` runs on **GitHub Actions** and does the
actual signing — you only need to (1) generate the keystore once, (2) set four **GitHub**
Actions secrets, and (3) trigger a build. Your repo lives on Gitea and is **push-mirrored to
GitHub**, where the build runs; the mirror copies code and tags but **not** secrets, so the
four secrets must be set on GitHub directly (see §3). The Gradle side (`mobile/android/app/build.gradle`) reads
`mobile/android/app/keystore.properties`; when that file is absent the build still
succeeds but produces an **unsigned** APK (which will not sideload) — so for a real
release you must provide the key, locally or via CI.

---

## 1. Generate your release keystore (do this ONCE, then back it up)

`keytool` ships with any JDK/JRE. If you hit `keytool: command not found`, install one
first — on Ubuntu/Debian: `sudo apt install openjdk-21-jre-headless` (any JDK version
works; for keystore generation the version doesn't matter). RSA 2048, 10000-day validity,
alias `jaghelm-upload`:

> **Choose an alias that does not appear inside the APK's name** `jaghelm-android-X.Y.Z.apk`
> (so not `jaghelm`, `android` or `apk`). GitHub masks any job output that contains a secret's
> value, and the build job hands the APK name to the release job as an output; with such an
> alias the name is masked and the release job fails. `jaghelm-upload` is safe.

```bash
keytool -genkeypair \
  -v \
  -keystore jaghelm-release.jks \
  -alias jaghelm-upload \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -storetype JKS
```

It prompts for:

- a **keystore password** (this is `KEYSTORE_PASSWORD` below),
- a **key password** for the alias — press Enter to reuse the keystore password
  (this is `KEY_PASSWORD`; the CI/Gradle config treats them as separate values, so if
  you reuse one password just set both secrets to it),
- and a distinguished name (CN / O / etc.) — fill in anything sensible
  (e.g. `CN=Jagdeep Bhandal, O=JagHelm`).

This writes `jaghelm-release.jks` in the current directory.

> **BACK IT UP NOW.** Copy `jaghelm-release.jks` and both passwords to your password
> manager / offline backup. If you lose this file you can never ship a signed update to
> the same installed app again — you would have to uninstall and reinstall fresh, losing
> the app's stored state. Treat it like a crown-jewel secret. Never commit it
> (`*.jks` / `*.keystore` / `keystore.properties` are all gitignored).

### Sanity-check the key (optional)

```bash
keytool -list -v -keystore jaghelm-release.jks -alias jaghelm-upload
```

---

## 2. Base64-encode the keystore for the GitHub secret

GitHub Actions secrets hold text, so the binary `.jks` must be base64-encoded **with no line
wrapping** (`-w0`), or the CI `base64 -d` step reassembles corrupted bytes:

```bash
base64 -w0 jaghelm-release.jks > jaghelm-release.jks.b64
# the contents of this file is the KEYSTORE_BASE64 secret value
cat jaghelm-release.jks.b64   # copy the whole single line
```

On macOS (BSD base64 has no `-w`): `base64 -i jaghelm-release.jks | tr -d '\n'`.

Delete the `.b64` file once you've pasted it into GitHub.

---

## 3. Set the FIVE GitHub repo secrets

> **These go on GitHub, NOT Gitea.** The Gitea→GitHub push-mirror copies your code and
> tags but **not** secrets — GitHub Actions only reads secrets stored in the GitHub repo.
> Setting them on Gitea does nothing; the build then fails fast at the *Decode keystore* /
> *Inject Firebase config* step with exit 1 (a ~35s run that produces no artifact). This is
> the one mistake that silently wastes a build.

On **GitHub** (`github.com/jagbhandal/jaghelm`): repo → **Settings → Secrets and variables →
Actions** → **New repository secret**. Set these **exact** five names (the workflow
references them by name):

| Secret name | Value |
|---|---|
| `KEYSTORE_BASE64` | the single-line base64 string from step 2 |
| `KEYSTORE_PASSWORD` | the keystore (store) password from step 1 |
| `KEY_ALIAS` | `jaghelm-upload` |
| `KEY_PASSWORD` | the key (alias) password (= the store password if you reused it) |
| `GOOGLE_SERVICES_JSON_BASE64` | `base64 -w0 < google-services.json` — the Firebase **client** config (enables push in the APK). See **[PUSH-SETUP.md](PUSH-SETUP.md)** for where to download it. |

No other config is needed; the workflow injects these, decodes the keystore to a temp file,
writes `keystore.properties`, decodes `google-services.json` before the build, builds, then
**shreds the signing material in an `if: always()` step** so nothing persists on the
ephemeral runner. (`google-services.json` is intentionally *not* shredded — it is embedded in
the APK by design and is not a secret.)

---

## 4. Trigger a signed build

Two ways to run `.github/workflows/build-apk.yml`:

**A. Push a `mobile-v*` tag** (the release path). A release needs `mobile/package.json` at the
tag's version and a matching section in `mobile/CHANGELOG.md`; the full procedure is in
**[RELEASING.md](../RELEASING.md)**. The tag must be a plain `mobile-vX.Y.Z` (at most three
digits per part); pre-release tags such as `mobile-v1.2.0-rc1` are rejected.

```bash
git tag -a mobile-vX.Y.Z -m "JagHelm Android X.Y.Z" <merge-commit>
git push <gitea-remote> mobile-vX.Y.Z
```

Push the tag to **Gitea only**; the push-mirror copies it to GitHub, where the workflow fires on
the `mobile-v*` trigger. Never create the tag on GitHub: the mirror deletes refs that exist only
there.

**B. Manual run (on GitHub):** the **GitHub** repo → **Actions** tab → **Build Signed Mobile
APK** → **Run workflow** (`workflow_dispatch`), pick a branch or tag, Run.

> **A manual dispatch is a TEST build, not a release,** even when started on a tag. It stamps
> `versionName 0.0.0-dispatch.N` (`versionCode` = run number) and never creates a GitHub
> Release; the app inside still reports the `mobile/package.json` version to the server when it
> registers for push. It doubles as the release dry run: the job summary shows the release notes
> for the `mobile/package.json` version. Use the tag-push path (A) for an actual release so the
> version is real and monotonic.

> **Re-running after a failed build** (e.g. you just added the missing secrets): on GitHub →
> **Actions** → the failed run → **Re-run all jobs**. No new tag needed — it re-checks out the
> same commit, now with the secrets present. If only the release job failed, delete any draft
> release it left for the tag, then use **Re-run failed jobs** to publish the same build (within
> the artifact's 7-day retention; after that, **Re-run all jobs**). See
> [RELEASING.md](../RELEASING.md#recovery).

When a tag build finishes, download the APK from the **GitHub Release** for the tag
([Releases page](https://github.com/jagbhandal/jaghelm/releases)): `jaghelm-android-X.Y.Z.apk`,
with its SHA-256 in the release notes. The workflow runs `apksigner verify` and an
artifact-secret guard before publishing, so a published APK is genuinely signed and contains
no leaked key material. A manual (test) build publishes no release; its APK is only in the run's
**`jaghelm-release-apk`** artifact, which is kept for 7 days.

---

## 5. Verify the APK is signed (optional, from the CLI)

`apksigner` lives in the Android SDK `build-tools/<ver>/`:

```bash
apksigner verify --min-sdk-version 24 --print-certs -v jaghelm-android-X.Y.Z.apk
```
(The CI gate passes the same `--min-sdk-version 24` — matching `minSdkVersion` in
`variables.gradle` — so your manual check verifies identically.)

A signed APK reports `Verified using v2 scheme (APK Signature Scheme v2): true`
(v3 also true). For this app (`targetSdk 36` = Android 16), **v2 is the practical minimum** —
note the v2 requirement actually follows from `minSdkVersion 24`, not the target — and
`apksigner` applies v2+v3 automatically. A non-zero exit / missing
`Verifies` line means it is unsigned.

---

## 6. Sideload / install the APK on your phone

1. **Enable installing from your file manager / browser:** Android Settings →
   **Apps → Special access → Install unknown apps** → enable for the app you'll open the
   APK with (e.g. Files, or your browser). (Wording varies by OEM/Android version.)
2. **Get the APK onto the phone** — any of:
   - **adb (fastest, from your computer):**
     ```bash
     adb install -r jaghelm-android-X.Y.Z.apk
     ```
     `-r` reinstalls over an existing JagHelm install (only works if it's the **same**
     signing key — see the top-of-doc rule).
   - **Direct transfer:** download the APK from the GitHub Release on the phone, or copy it
     over (USB / Google Drive / email-to-self), then tap it in the Files app and confirm the
     install prompt.
3. **First run:** open JagHelm, enter your server's address and your JagHelm username and
   password on the first-run screen, and tap **Sign in**. It reaches the server over the
   Tailscale network via native HTTP; the tabs should render live data.

> **Push notifications need the `GOOGLE_SERVICES_JSON_BASE64` secret set (step 3).** The CI
> build injects `google-services.json` before the Vite/Gradle build, so a release APK ships
> with FCM compiled in — but that is only the **client half**. For a notification to actually
> arrive, the **prod server** must also have its FCM service-account wired
> (`FCM_SERVICE_ACCOUNT`). Both ends are covered end-to-end in **[PUSH-SETUP.md](PUSH-SETUP.md)**.
> If you omit the secret the build fails fast at *Inject Firebase config* (rather than
> silently shipping a push-disabled APK). All in-app tab data still works regardless of push.

### Updating later

Release a new version (see [RELEASING.md](../RELEASING.md)), download its APK from the GitHub
Release, then `adb install -r` or tap-to-install over the top. CI derives an **incrementing `versionCode`** from the tag
(`mobile-vMAJOR.MINOR.PATCH` → `MAJOR*1000000 + MINOR*1000 + PATCH`), so each higher tag
installs cleanly over the last. Because it's the **same** key, Android updates in place and
preserves the app's stored config. If you ever see
`INSTALL_FAILED_UPDATE_INCOMPATIBLE`, you signed with a different key — uninstall the old
app first (you'll lose its stored state) or recover the original keystore.

---

## Quick reference

| Item | Value |
|---|---|
| Keystore file | `jaghelm-release.jks` (RSA 2048, 10000-day validity) |
| Key alias | `jaghelm-upload` |
| Gradle reads | `mobile/android/app/keystore.properties` (gitignored) |
| CI workflow | `.github/workflows/build-apk.yml` (`mobile-v*` tag or manual) |
| Runs on | **GitHub Actions** (`github.com/jagbhandal/jaghelm`), reached via the Gitea→GitHub push-mirror |
| Secrets | `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`, `GOOGLE_SERVICES_JSON_BASE64` — set on **GitHub**, not Gitea |
| Push setup | **[PUSH-SETUP.md](PUSH-SETUP.md)** — end-to-end (APK Firebase config + prod server FCM service-account) |
| Distribution | sideload only (no Play Store) → one self-signed key, reuse forever |
| Release APK | `jaghelm-android-X.Y.Z.apk` on the tag's GitHub Release (test builds: `app-release.apk` in the run's `jaghelm-release-apk` artifact, 7 days) |
