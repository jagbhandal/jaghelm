# Integrations

An integration is a card that calls one of your apps and shows a real number beside it: AdGuard's blocked queries, Sonarr's queue, Proxmox's node load and more. JagHelm has 35+ presets (open Settings → Integrations to see the gallery). Each preset already knows its app's address shape, how to sign in and how to format its numbers.

Connect AdGuard, Plex, Sonarr, Proxmox, Cloudflare, Vaultwarden, and dozens more through the Settings → Integrations gallery. Each preset has known endpoints, auth shape, and field formatting baked in. Test connection checks the form as it would be saved, before anything is: it makes the requests the next refresh would make, with the stored entry's endpoint and fields and a typed password or token in place of the stored one, and shows the error the integration's card would show. A custom integration covers anything not in the gallery: its form takes the URL and a token, and its JSON endpoint, auth mode and the paths to extract are written in its entry in `services.yaml`.

## How credentials are stored and sent

Credentials are encrypted with AES-256-GCM (PBKDF2-derived key from `DASH_SECRET`) before being written to `secrets.json`.

A stored password or token goes only to the address it was entered for: the host, port and http or https of the integration's URL. Moving an integration to a new address means typing its credential again; Save and Test refuse a new address with the password or token left blank, and so does a save of the whole config in Settings. An integration whose stored credential isn't for its address (its URL edited in `services.yaml`, or another integration's `$secret:` named in its entry) sends nothing, and its card says to re-enter the credential for this address. At the first start after updating, each stored credential is bound to the addresses of the integrations that use it. Credentials in `.env`, or typed into `services.yaml` by hand, are not bound: they go wherever the URL points. Every request an integration makes stays on its URL's host and port: an endpoint in `services.yaml` that leads elsewhere is not requested, and its card says so.

Credentials go in their own fields, never in the URL, and a field never names a stored secret (a `$secret:` reference is refused unless it is the one already stored there): a user name and password in the Username and Password fields, a key or token in the API Key or API Token field (a custom integration's other credentials go in its entry in `services.yaml`). A URL with a user name or password before the host (`https://user:pass@host`) or a key in its query (`?key=`, `?apikey=`, `?token=` and the like) never worked, and Save and Test refuse one, with a message beside the URL field that says where the credential goes. An integration whose URL in `services.yaml` already carries one is not requested: its card says where to move the credential, and Settings shows the URL empty, to be entered again without it.

Write a password, token or user name in `services.yaml` as it is, not URL-encoded: JagHelm encodes one it fills into a custom endpoint's `{token}`, `{password}` or `{username}`, so a `&`, `#`, `/`, `?`, space or `@` in it arrives intact, and one already encoded by hand would be encoded twice. A stored password or token that can't be read (its secret is gone from `secrets.json`, or won't decrypt after `DASH_SECRET` changed) is never sent empty: the integration sends nothing, and its card says the stored credential couldn't be read and where to enter it again. It backs off like any failed fetch, not as a refused login, and is tried again at the next refresh once the secret is back or the credential is saved again in Settings.

## When an integration fails

An integration that fails is retried after 30 seconds, then 1, 2, 4 and 8 minutes, then every 10 minutes until it answers, and its card shows the failure meanwhile. One whose login is refused twice in a row (HTTP 401 or 403) is not retried until its settings change, so an app that bans an address after failed logins doesn't ban JagHelm's. Saving it in Settings, changed or not, retries it at the next refresh. So does editing its entry in `services.yaml` (any change counts), and a restart retries every integration.

## What a save in Settings changes

Saving an integration in Settings changes only what its form shows: the URL, username, target container, password or token (a blank one keeps the stored credential), the preset's URL parameters, the instance name and Enabled. Anything else in its `services.yaml` entry stays as written, such as a custom integration's endpoint, auth and fields, and a save that changes nothing leaves the file untouched. A changed instance name moves the integration to its new name, with its stored password and token. An instance name another integration already uses is refused, with a message beside the Instance Name field that names it, and nothing is changed; so is a new integration added under a name in use. The Enable and Disable buttons change only `enabled`, and a Settings form left open doesn't undo them unless its own Enabled box was changed.

## Setting an integration from `.env` instead

Every preset can also be set from environment variables instead of the UI; `env.example` lists each preset's.

```env
# Prefixed with JAGHELM_ to avoid colliding with service env vars in
# shared Docker networks. UI/yaml config is overridden when set.
JAGHELM_ADGUARD_URL=http://192.168.x.x:8085
JAGHELM_ADGUARD_USER=admin
JAGHELM_ADGUARD_PASS=secret
 
JAGHELM_NPM_URL=http://192.168.x.x:81
```
