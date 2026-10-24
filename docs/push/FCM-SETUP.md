# Firebase (FCM) push: server setup

> **FCM is retired in stage B (#659); the PWA uses Web Push.** The Android app is gone. The
> server's FCM sender and device registry stay for one more week, so this page keeps the
> server-side setup for anyone still running it. New installs should use Web Push (the three
> `VAPID_*` variables, [GET-STARTED.md](../GET-STARTED.md)) and skip this page.

FCM push needs one thing: the server holds a Firebase **service-account** key. Without it the
server boots fine and FCM push stays off (Web Push is independent of it).

## How it works

The server signs and sends each FCM message with the service-account key. It looks for
`FCM_SERVICE_ACCOUNT` (or `GOOGLE_APPLICATION_CREDENTIALS`) pointing at that key file
(`server/push/fcm.js`). Without it, the server logs
`push disabled: no FCM service-account creds configured` and the FCM send pipeline no-ops.
With it, the server's own FCM client (`server/push/fcmHttp.js`, no Firebase SDK) signs a
short-lived token request with the key, trades it at `oauth2.googleapis.com` for an access
token that can only send notifications, and posts each message to `fcm.googleapis.com`. The
server needs outbound HTTPS to those two hosts and nothing else for FCM push.

---

## Wire the FCM service-account on prod

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

4. **Bind-mount it read-only and point the env at it.** Add the mount in
   `/opt/stacks/jaghelm/compose.override.yaml` (create it next to `compose.yaml`). Compose
   merges it into `compose.yaml` automatically, adding this mount to the existing `volumes:`,
   and it survives `compose.yaml` updates: JagHelm's own deploy replaces `compose.yaml` on its
   host at every deploy and never touches the override.

   ```yaml
   services:
     jaghelm:
       volumes:
         - ./secrets/fcm-service-account.json:/app/secrets/fcm-service-account.json:ro
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
  (re-check the step 2 permissions and the in-container path) — then `docker compose up -d` again.
- ❌ `push disabled: messaging factory threw` with a `reason` → the file was read but is not a
  usable service-account key: the reason names the field (no `client_email`, a `private_key`
  that doesn't parse). Generate a new key (step 1).

The key is only tried against Google on the first send. If that fails, each send logs
`fcm send failed` with a `code`:

- `app/invalid-credential` → Google answered but gave no access token: it refused the key
  (revoked, or the server's clock is off by minutes). The line before it,
  `fcm access token request failed`, gives the HTTP status and Google's reason.
- `messaging/mismatched-credential` → the key is from another Firebase project than the one the phone registered with.
- `app/network-error` / `app/network-timeout` → the server can't reach Google. When it is
  `oauth2.googleapis.com` it can't reach, `fcm access token request failed` comes first, with
  `status` 0 and the error in `reason`; otherwise it is `fcm.googleapis.com`.

You can also hit the status route from an authenticated session:
`GET /api/push/status` → `{"enabled":true}`.

**End to end** — on the web, open **Settings → Notifications**; a phone registered over FCM is
listed under **Devices**. Press **Send test** on its row, or **Send test push** for every phone.
"JagHelm test push" should land on the phone within seconds, and the row says what happened:
delivered (Google accepted it), push switched off in the app, or why it failed. One test push
per phone every 30 seconds; each is recorded in the alert history like any push. For the real
thing, take a monitored service down (or wait for a real `up→down` transition), wait until the
board shows it down, and the notification should land on the phone with it (the board and push
come from the same refresh). The server logs `push cycle queued`, then `push dispatched` with `sent` of at
least 1. If nothing arrives, `docker logs jaghelm 2>&1 | grep -E 'fcm send failed|fcm access token request failed|push not sent'`
says why (above). `push not sent, trying again later` means Google didn't take it (no answer,
the key refused): the notification waits on the server and is sent, in order, once Google does.
`push not sent to one phone, trying again later` is the same for one phone (a 5xx or 429); the
other phones get theirs meanwhile. The board doesn't wait for either, and `/api/health` shows
what waits in `push`: `queued` and `oldestAgeS`.

---

## Security

- **Service-account key (server) = real secret.** It can send push to every registered device.
  Never commit it (only `fcm-service-account.json.example` is tracked), keep it `chmod 600` owned
  by UID 1000, and mount it **read-only** (`:ro`). If it ever leaks, revoke/rotate it in the
  Firebase console → *Service accounts*.
- **The key never leaves the server.** It only signs, in memory. Google's token endpoint gets the
  signed request (valid an hour), FCM gets the access token it is traded for (an hour, kept in
  memory, scoped to sending notifications), and neither is logged or put in an error. The
  `token_uri` in the key file is not used: the two Google addresses are fixed in the code.
- **Shred the original download** once it's in `secrets/` (step 3). The browser-downloaded
  copy in `~/Downloads`/`/tmp` is world-readable; leaving it there is how the key leaks.
- The key file is covered by `.gitignore`.

## See also

- [GET-STARTED.md](../GET-STARTED.md) — prod stack layout (`/opt/stacks/jaghelm`, compose, `.env`) and Web Push.
- [docs/arcane/SETUP.md](../arcane/SETUP.md) — Arcane update notifications.
