# JagHelm Mobile — Release Keystore & Signed-APK Operator Runbook

This is the operator runbook for **Jag**. JagHelm mobile is distributed as a
**signed APK that you sideload** onto your phone — there is **no Play Store**. So a
single, self-signed release key is all you need. The only hard rule: **every future
update MUST be signed with the SAME key**, or Android refuses to install the update
over the existing app (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`). Generate the key once,
back it up, and reuse it forever.

The CI workflow `.github/workflows/build-apk.yml` does the actual signing — you only
need to (1) generate the keystore once, (2) set four GitHub secrets, and (3) trigger a
build. The Gradle side (`mobile/android/app/build.gradle`) reads
`mobile/android/app/keystore.properties`; when that file is absent the build still
succeeds but produces an **unsigned** APK (which will not sideload) — so for a real
release you must provide the key, locally or via CI.

---

## 1. Generate your release keystore (do this ONCE, then back it up)

`keytool` ships with the JDK. RSA 2048, 10000-day validity, alias `jaghelm-upload`:

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

GitHub secrets hold text, so the binary `.jks` must be base64-encoded **with no line
wrapping** (`-w0`), or the CI `base64 -d` step reassembles corrupted bytes:

```bash
base64 -w0 jaghelm-release.jks > jaghelm-release.jks.b64
# the contents of this file is the KEYSTORE_BASE64 secret value
cat jaghelm-release.jks.b64   # copy the whole single line
```

On macOS (BSD base64 has no `-w`): `base64 -i jaghelm-release.jks | tr -d '\n'`.

Delete the `.b64` file once you've pasted it into GitHub.

---

## 3. Set the FOUR GitHub repo secrets

Repo → **Settings → Secrets and variables → Actions → New repository secret**. Set
these **exact** four names (the workflow references them by name):

| Secret name | Value |
|---|---|
| `KEYSTORE_BASE64` | the single-line base64 string from step 2 |
| `KEYSTORE_PASSWORD` | the keystore (store) password from step 1 |
| `KEY_ALIAS` | `jaghelm-upload` |
| `KEY_PASSWORD` | the key (alias) password (= the store password if you reused it) |

No other config is needed; the workflow injects these, decodes the keystore to a temp
file, writes `keystore.properties`, builds, then **shreds the signing material in an
`if: always()` step** so nothing persists on the ephemeral runner.

---

## 4. Trigger a signed build

Two ways to run `.github/workflows/build-apk.yml`:

**A. Push a `mobile-v*` tag** (the release path):

```bash
git tag mobile-v1.0.0
git push origin mobile-v1.0.0
```

**B. Manual run:** repo → **Actions → "Build Signed Mobile APK" → Run workflow**
(`workflow_dispatch`), pick the branch, Run.

When the job finishes, open the run and download the **`jaghelm-release-apk`** artifact
(a zip containing `app-release.apk`). The workflow also runs `apksigner verify` and an
artifact-secret guard before publishing, so a green run means the APK is genuinely
signed and contains no leaked key material. (Artifacts retain for 7 days — re-run the
workflow to regenerate.)

---

## 5. Verify the APK is signed (optional, from the CLI)

`apksigner` lives in the Android SDK `build-tools/<ver>/`:

```bash
apksigner verify --print-certs -v app-release.apk
```

A signed APK reports `Verified using v2 scheme (APK Signature Scheme v2): true`
(v3 also true). For an Android-14-class target (`targetSdk 36`), **v2 is the practical
minimum** — `apksigner` applies v2+v3 automatically. A non-zero exit / missing
`Verifies` line means it is unsigned.

---

## 6. Sideload / install the APK on your phone

1. **Enable installing from your file manager / browser:** Android Settings →
   **Apps → Special access → Install unknown apps** → enable for the app you'll open the
   APK with (e.g. Files, or your browser). (Wording varies by OEM/Android version.)
2. **Get the APK onto the phone** — any of:
   - **adb (fastest, from your computer):**
     ```bash
     adb install -r app-release.apk
     ```
     `-r` reinstalls over an existing JagHelm install (only works if it's the **same**
     signing key — see the top-of-doc rule).
   - **Direct transfer:** copy `app-release.apk` to the phone (USB / Google Drive /
     email-to-self), then tap it in the Files app and confirm the install prompt.
3. **First run:** open JagHelm, enter your backend URL + token on the first-run screen,
   tap **Test & Connect**. It reaches the backend over the Tailscale network via native
   HTTP; all four tabs should render live data.

### Updating later

Build a new signed APK (bump the tag, e.g. `mobile-v1.0.1`), then `adb install -r` or
tap-to-install over the top. Because it's the **same** key, Android updates in place and
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
| Secrets | `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD` |
| Distribution | sideload only (no Play Store) → one self-signed key, reuse forever |
| Artifact | `jaghelm-release-apk` → `app-release.apk` |
