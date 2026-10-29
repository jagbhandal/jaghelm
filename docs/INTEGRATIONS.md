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

## Drive health: `smartctl_exporter`

Drive health is not a preset. JagHelm reads [`smartctl_exporter`](https://github.com/prometheus-community/smartctl_exporter) (v0.15.0) through the Prometheus it already uses, and judges each drive on the server. Nothing in `services.yaml` or Settings sets it up; scrape the exporter and the node's side of the status model grows a drive per disk. An install with no such series, or with `JAGHELM_DRIVES=off`, is unchanged. The exporter's job needs the `node` label of the node it runs on (see [Configuration](CONFIGURATION.md#drive-health-smart)); its name must start with `smartctl` (`smartctl-nas`), since the exporter's own `up` is found by that.

The series JagHelm reads, with labels `node` and `device` (`sda`, `nvme0`):

| Series | Use |
|---|---|
| `smartctl_device_smart_status` | 1 passed the drive's own health check, 0 failed (critical) |
| `smartctl_device_critical_warning` | NVMe critical-warning bitmask; non-zero is critical |
| `smartctl_device_available_spare`, `smartctl_device_available_spare_threshold` | NVMe spare, percent; at or below the threshold is a warning |
| `smartctl_device_media_errors` | NVMe media and data-integrity errors; growth over 7 days is critical |
| `smartctl_device_attribute` with `attribute_id` 5, 197, 198 and `attribute_value_type="raw"` | SATA reallocated, pending and offline-uncorrectable sectors; growth over 7 days is a warning |
| `smartctl_device_temperature` with `temperature_type="current"` | °C, judged by the drive-temperature lines (NVMe 70/80, SATA 55/60 by default); the series' other types are the drive's own limits and are not read |
| `smartctl_device_percentage_used`, `smartctl_device_power_on_seconds`, `smartctl_device_rotation_rate` | shown, never alerted |
| `smartctl_device` (`model_name`, `protocol`) | the drive's name and kind. Its `serial_number` label is never read: every query drops it |
| `smartctl_devices`, `smartctl_device_smartctl_exit_status`, `up` of the scrape | whether the exporter can see the drives (below) |

Counters are judged by growth over 7 days, not by "above zero", because they only rise: a drive with a stable count of remapped sectors is quiet, and one still remapping warns. With less than 7 days in Prometheus the growth that exists is what counts, and a first sighting never alerts by itself.

A node that had drives and no longer has any in the read, or whose smartctl scrape is down, raises one "Drive monitoring has no signal" alert in the no-signal state. It is not a drive's alert and does not turn the node amber. A drive's own smartctl exit status never makes a node blind: the exporter drops a failed read and serves cached values, and every drive whose data arrives is judged (a failing drive reports exit 8 and up, and is judged by `smartctl_device_smart_status`). After 24 hours without a signal the node's drives are forgotten and the alert ends without a push.

Flags that matter on the exporter:

- `--smartctl.powermode-check=standby` keeps a sleeping drive asleep: smartctl skips it and the exporter keeps serving its last values. JagHelm cannot tell those from fresh ones, so a drive in standby shows its last reading.
- `--smartctl.interval=10m` has the exporter read SMART at most every 10 minutes and serve the cached values in between, which is what lets the drives spin down. JagHelm's own refresh is far more frequent, so declare the interval with `reading_interval` (below) and the Drives block says so.
- `--smartctl.device=/dev/sdX` (one per drive) when the exporter cannot scan for them, as on a NAS.

### How often readings refresh: the `reading_interval` target label

The exporter serves cached values between its own polls, so a drive temperature on screen can be up to one interval old while the page refreshes much more often. To have the Drives block say so, add an optional `reading_interval` label next to `node` on the same scrape target. It must equal the exporter's `--smartctl.interval`:

```yaml
scrape_configs:
  - job_name: smartctl-nas
    static_configs:
      - targets: ['192.168.x.x:9633']
        labels:
          node: nas
          reading_interval: 1h
```

Accepted values are a whole number and `s`, `m` or `h` (`90s`, `10m`, `1h`, `3h`), from 60 seconds to 7 days. Anything else is ignored, with a debug line in the log. Without the label nothing changes. With it, the Drives block's footnote reads "Readings refresh about every hour, on their own schedule, not with this page." and, on a node with a drive that may sleep, "A sleeping drive shows its last reading." Targets that carry the label produce it on every series of the job; JagHelm reads it from `smartctl_devices`, and a node whose series declare two different values shows no interval.

JagHelm shows no "last read at" time on purpose. The exporter exposes no read timestamp, and its polls drift (it sleeps the interval after each poll, so the ticks move by the poll duration), so any time computed from Prometheus would be wrong by minutes.

