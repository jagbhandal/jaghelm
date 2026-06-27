# Push Notifications — End-to-End Setup

Turning on push (FCM) for the JagHelm mobile app takes **two pieces of wiring, and both
must be live** before a single notification reaches a phone. They fail independently and
show up as different messages in the app, so the table below tells you which half is missing.

| App → Notifications screen says | Missing half | Fix |
|---|---|---|
| *"Push not registered on this device…"* | **Client** — the APK has no Firebase config baked in | [Part 1](#part-1--client-ship-the-apk-with-firebase-config) |
| *"Push notifications are unavailable — the server has no notification credentials configured."* | **Server** — prod has no FCM service-account | [Part 2](#part-2--server-wire-the-fcm-service-account-on-prod) |
| *"Push is turned off on this device…"* | OS permission | Re-enable notifications for JagHelm in Android settings, reopen the app |

> The app checks the **client** half first, so you'll only ever see the *server* message once
> the client half is already working. Expect to do Part 1, then Part 2.

---

## How it works (the two halves)

- **Client** — `google-services.json` is the Firebase **client** config. It must be present
  **at APK build time**: the Vite build reads it to set `__PUSH_ENABLED__`
  (`mobile/vite.config.mobile.js`) **and** Gradle applies the `google-services` plugin from it
  (`mobile/android/app/build.gradle`). With it, the app initialises FCM, gets a registration
  token, and POSTs it to the server (`/api/push/register`). Without it, FCM is compiled out —
  no token, nothing registers.

- **Server** — the prod server signs and sends each FCM message with a Firebase
  **service-account** key. It looks for `FCM_SERVICE_ACCOUNT` (or `GOOGLE_APPLICATION_CREDENTIALS`)
  pointing at that key file (`server/push/fcm.js`). Without it, the server boots fine but logs
  `push disabled: no FCM service-account creds configured` and the whole send pipeline no-ops.

Both keys come from the **same Firebase project (`jaghelm-48d9a`)** but they are different
artifacts with very different sensitivity — see [Security](#security).

---

## Part 1 — Client: ship the APK with Firebase config

The CI release build (`.github/workflows/build-apk.yml`) injects `google-services.json` from a
secret **before** the Vite/Gradle build, then validates it's the `io.jaghelm.app` app. You just
provide the secret once.

1. **Download the client config** from the
   [Firebase console](https://console.firebase.google.com/) → project **jaghelm-48d9a** →
   **Project settings** (gear) → **General** → *Your apps* → the **Android** app
   (`io.jaghelm.app`) → **`google-services.json`** download button.

2. **Base64-encode it** (single line, no wrapping — same rule as the keystore):

   ```bash
   base64 -w0 google-services.json
   # macOS: base64 -i google-services.json | tr -d '\n'
   ```

3. **Set the GitHub secret** `GOOGLE_SERVICES_JSON_BASE64` to that string
   (GitHub → *Settings → Secrets and variables → Actions*; see
   [KEYSTORE.md step 3](KEYSTORE.md#3-set-the-five-github-repo-secrets) — secrets go on
   **GitHub**, not Gitea).

4. **Build a release** by pushing a `mobile-v*` tag (see KEYSTORE.md step 4). The resulting
   `app-release.apk` has push compiled in. If the secret is missing the build **fails fast** at
   the *Inject Firebase config* step rather than silently shipping a push-disabled APK — this
   applies to every `build-apk.yml` run, including manual `workflow_dispatch` test builds (there
   is no longer a no-Firebase build path).

> `google-services.json` is **not a secret** — the `google-services` plugin embeds it inside
> every distributed APK, so anyone with the APK can read it. It's base64'd into a secret only to
> keep project identifiers out of git (the repo gitignores the file). The CI step intentionally
> does **not** shred it and the artifact-secret guard does **not** flag it.

---

## Part 2 — Server: wire the FCM service-account on prod

This is **manual on the prod host** — no CI/deploy step injects it. The prod stack lives at
`/opt/stacks/jaghelm` (see [GET-STARTED.md](../GET-STARTED.md)).

1. **Generate the service-account key** in the
   [Firebase console](https://console.firebase.google.com/) → project **jaghelm-48d9a** →
   **Project settings** → **Service accounts** → **Generate new private key**. This downloads a
   `…-firebase-adminsdk-….json`. **This is a real credential** (it can push to every registered
   device) — treat it like a password. The tracked
   [`fcm-service-account.json.example`](../../fcm-service-account.json.example) shows the shape;
   never commit the real one.

2. **Place it on the prod host, out of git, locked down in one shot.** Use `install` so the
   `secrets/` dir and the key are created with their final owner + mode **atomically** — no
   transient world-readable window between copy and `chmod`. The container runs as the
   unprivileged **`node` user (UID 1000)** (see `Dockerfile`), so the key must be owned by UID
   1000: a root-owned `chmod 600` file would be **unreadable** inside the container and push
   would stay disabled.

   ```bash
   sudo install -d -m 700 -o 1000 -g 1000 /opt/stacks/jaghelm/secrets
   sudo install -m 600 -o 1000 -g 1000 \
     ~/Downloads/<your-project>-firebase-adminsdk-*.json \
     /opt/stacks/jaghelm/secrets/fcm-service-account.json
   ```

3. **Securely delete the original download.** Firebase saves the key to `~/Downloads` (or
   wherever your browser drops it) at world-readable `0644` — that lingering copy is a **live
   credential** outside the locked-down location. Shred it so the only copy left is the
   `chmod 600` one under `secrets/`:

   ```bash
   shred -u ~/Downloads/*firebase-adminsdk*.json     # Linux; macOS: rm -P <file>
   ```

   > Never leave the key in `/tmp`, `~/Downloads`, or any shared / world-readable directory —
   > this is the exact mistake that leaks server push credentials.

4. **Bind-mount it read-only and point the env at it.** In `/opt/stacks/jaghelm/compose.yaml`,
   add the mount under the existing `volumes:`:

   ```yaml
   services:
     jaghelm:
       # …existing config…
       volumes:
         - ./data:/app/data
         - ./uploads:/app/uploads
         - ./secrets/fcm-service-account.json:/app/secrets/fcm-service-account.json:ro   # <-- add
   ```

   In `/opt/stacks/jaghelm/.env` (already loaded via `env_file`), add:

   ```env
   FCM_SERVICE_ACCOUNT=/app/secrets/fcm-service-account.json
   ```

   > The path in `FCM_SERVICE_ACCOUNT` is the path **inside the container** (`/app/secrets/…`),
   > not the host path. It must match the right-hand side of the bind-mount.

5. **Recreate the container** so it picks up the new mount + env (a plain `restart` won't):

   ```bash
   cd /opt/stacks/jaghelm && docker compose up -d
   ```

---

## Verify it's live

**Server** — the fastest check is the boot log:

```bash
docker logs jaghelm 2>&1 | grep -i push
```

- ✅ `push enabled: FCM messaging initialized` → server half is good.
- ❌ `push disabled: no FCM service-account creds configured` → env not set / file unreadable
  (re-check step 3 permissions and the in-container path) — then `docker compose up -d` again.

You can also hit the status route from an authenticated session:
`GET /api/push/status` → `{"enabled":true}`.

**Client** — open the app → **Notification Settings**. The "unavailable / not registered"
message should be gone and a token should register. Then prove the whole chain end-to-end: take a
monitored service down (or wait for a real `up→down` transition) and confirm a notification lands
on the phone within a refresh cycle (~30s).

---

## Security

- **Service-account key (server) = real secret.** It can send push to every registered device.
  Never commit it (only `fcm-service-account.json.example` is tracked), keep it `chmod 600` owned
  by UID 1000, and mount it **read-only** (`:ro`). If it ever leaks, revoke/rotate it in the
  Firebase console → *Service accounts*.
- **Shred the original download** once it's in `secrets/` (Part 2 step 3). The browser-downloaded
  copy in `~/Downloads`/`/tmp` is world-readable; leaving it there is how the key leaks.
- **`google-services.json` (client) = not a secret.** It ships inside the APK by design.
- Neither file belongs in git; both are covered by `.gitignore`.

## See also

- [KEYSTORE.md](KEYSTORE.md) — APK signing + the five GitHub build secrets (incl.
  `GOOGLE_SERVICES_JSON_BASE64`).
- [GET-STARTED.md](../GET-STARTED.md) — prod stack layout (`/opt/stacks/jaghelm`, compose, `.env`).
- [DESIGN.md](DESIGN.md) — the push pipeline architecture (snapshot → differ → dispatch → FCM).
