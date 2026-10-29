# Configuration

Everything you can set in JagHelm: the `.env` file, the files it keeps in `data/`, and the settings that live only in environment variables. To install JagHelm, start with the [README](../README.md); this page is the reference you come back to.

- [Prometheus requirements](#prometheus-requirements)
- [The `.env` file](#the-env-file)
- [Drive health (SMART)](#drive-health-smart)
- [Networking](#networking)
- [Settings and the files in `data/`](#settings-and-the-files-in-data)
- [Environment variables](#environment-variables)
- Reports from cron jobs, drift checks and backups: [REPORTING.md](REPORTING.md)

## Prometheus requirements

JagHelm reads every node's numbers (CPU, memory, disk, temperature, uptime) from a Prometheus. Each machine needs `node_exporter`, and **each scrape target needs a `node: <name>` label**. JagHelm finds your nodes by that label; without it the Overview stays on "Waiting for your first node". The label is the name the node gets on the board, and you can rename it later. cAdvisor (optional, it adds the per-container rows) needs the same `node` label on its targets, with the same value as that machine's node_exporter.

JagHelm calls Prometheus's query API (`/api/v1/query`), its health check (`/-/healthy`, for `/api/readyz`) and, when a node has no `up` series or its `up` is 0, its target list (`/api/v1/targets`); a proxy in front of Prometheus must allow all three. It also asks when Prometheus started (`/api/v1/status/runtimeinfo`) before a target that never got its first scrape counts as stuck; that one is optional.

  - **Direct scrape** (supported, recommended): Prometheus, or VictoriaMetrics/vmagent scraping with `promscrape`, scrapes each node's `node_exporter` (and cAdvisor) with a `node` label on the target, and lists those targets. JagHelm reads the target list to tell a node not scraped yet ("No signal") from one that's down ("Host unreachable"). A target still waiting for its first scrape after 3 of its scrape intervals shows as Prometheus failing, naming the target, with one "Monitoring source down" alert.
  - **Federation or remote write** (Thanos, Mimir, a federating Prometheus, or VictoriaMetrics fed only by remote write; supported): the series need the same `node` label. These backends list no scrape target per node, so when a node's `up` series is missing JagHelm can't tell the host from the pipeline: that reads as Prometheus failing (one "Monitoring source down" alert), never as each host unreachable. A host whose `up` reads 0 still alerts as unreachable.

## Drive health (SMART)

Drive health is an optional module that needs no setup in JagHelm: it is active when Prometheus holds `smartctl_devices` for at least one node, which one probe (`count(smartctl_devices)`, kept 10 minutes) decides. With no such series nothing changes: no drives on any node, no extra queries beyond the probe, no alerts. To use it, run [`smartctl_exporter`](INTEGRATIONS.md#drive-health-smartctl_exporter) on the machines with the disks and scrape it with a job whose name starts `smartctl` (`smartctl-nas`) and **a `node: <name>` label with the same value as that machine's node_exporter**, as for every other node series. Series whose `node` label matches no node in `services.yaml` are ignored, with one warning in the log until the set changes. Nodes without SMART (a Raspberry Pi's SD card, a VM) show nothing.

`JAGHELM_DRIVES=off` turns the module off even when the series exist; `on` or unset leaves it to the series. A drive that was in trouble when the module is turned off is cleared. A switch in Settings will read the same setting.

Each drive is judged on its own and rolls up to its node, which is no longer green while a drive is failing or warning, and its reason names the drive. The temperature lines for drives (an NVMe's and a SATA drive's) are saved with the others in `thresholds.json` and by `PUT /api/thresholds` as `nvmeTemp` and `sataTemp`. A `thresholds.json` without them uses the defaults.

## Use your own Prometheus

The [README quickstart](../README.md#install-in-5-steps) starts its own Prometheus. If you already run one, edit the downloaded `compose.yaml`:

1. Delete the `prometheus`, `node-exporter` and `cadvisor` services, the `depends_on:` lines in `jaghelm`, and the `prometheus_data` volume. Delete `prometheus.yml` too.
2. In `.env`, set `PROMETHEUS_URL` to an address **the JagHelm container** can reach: the server's LAN address (`http://192.168.1.20:9090`), or a service name if both share a Docker network. `localhost` will not work.
3. Make sure every scrape target has the `node` label (see above), then run `docker compose up -d`.

## The `.env` file

The [quickstart](examples/quickstart/compose.yaml) makes a `.env` for you (see the README). These are the variables people set most. `env.example` in the repo lists all of them, with a comment for each. If you write the file by hand, it looks like this (replace the `DASH_SECRET` value with the output of `openssl rand -hex 32` before the first start):

```env
PROMETHEUS_URL=http://prometheus:9090
DASH_SECRET=replace-with-output-of-openssl-rand-hex-32
DASH_USER=admin
DASH_PASS=choose-a-long-password
```



| Variable | Needed? | What it does |
|---|---|---|
| `PROMETHEUS_URL` | For node data | Where Prometheus answers, e.g. `http://prometheus:9090`. JagHelm has no default: unset, the board says "Prometheus is not set" and nothing is requested. Not `localhost` under the shipped `compose.yaml`, where that is the JagHelm container itself. |
| `DASH_SECRET` | Yes, a real one | The key that encrypts the passwords and tokens you store in Settings. Make one with `openssl rand -hex 32`. JagHelm refuses every example value in these docs as a key: it stores no credential and logs what to do until it has a real one. |
| `DASH_USER`, `DASH_PASS` | Recommended | The sign-in. User defaults to `admin`. With `DASH_PASS` empty there is no sign-in at all, and the secrets API, the log peek and Remove on a missing container stay closed (see `JAGHELM_ALLOW_OPEN_SECRETS` in `env.example`). |
| `KUMA_URL` | Only with Uptime Kuma | Where Uptime Kuma answers, e.g. `http://kuma:3001`. Unset, there is no Uptime Kuma and no error. |
| `KUMA_API_KEY` | No | Reads every monitor and its uptime from Kuma's authenticated `/metrics` (needs Kuma 2.1.0 or later). Blank, JagHelm uses the public status page. |
| `LOKI_URL` | No | Loki, for "Recent errors" in a node's or container's detail. Unset, the detail says logs aren't set up. |
| `TRUST_PROXY` | Behind a reverse proxy | The proxy addresses to trust `X-Forwarded-For` from, comma-separated. Blank if JagHelm is reached directly. |
| `LOGIN_TRUSTED_NETS` | No | Networks that never wait on the shared sign-in budget during an attack, such as your LAN and tailnet: `192.168.68.0/22,100.64.0.0/10`. |
| `JAGHELM_CRON_SECRET` | For job and drift reports | The shared secret your cron jobs and hosts send; see [REPORTING.md](REPORTING.md). Make one with `openssl rand -hex 32`. |
| `JAGHELM_UPS_NAME` | No | Which UPS to show when NUT reports several. |

Replace the `DASH_SECRET` example with the output of `openssl rand -hex 32` before the first start. JagHelm refuses every example value in these docs as a key: it stores no credential and logs what to do until it has a real one.

Keep user names, passwords and keys out of `PROMETHEUS_URL`, `KUMA_URL`, `JAGHELM_GITEA_URL` and every integration's URL variable (`JAGHELM_NTFY_URL`, `JAGHELM_ADGUARD_URL` and the rest). One that carries a credential (`http://user:pass@host`, however written) is refused: JagHelm never requests or logs it, and the board, `/api/health` or the integration's error name the variable, never its value. Kuma's key goes in `KUMA_API_KEY` and Gitea's token in `JAGHELM_GITEA_TOKEN`; JagHelm can't log in to Prometheus. Node refused such a URL already, so no working setup changes, unless a path held a raw `@` after a port (write it `%40`).

## Networking

JagHelm's shipped `compose.yaml` uses a bridge network that publishes port 3099, so the container stays off the host's network. JagHelm runs as user 1000 on a read-only image, so `data/` and `uploads/` are the only places it writes, and they must be writable by that user (`mkdir -p data uploads && sudo chown 1000:1000 data uploads`).

**Switch to host networking** only if JagHelm can't reach something from the bridge: an exporter bound to a host-only interface, or anything found by mDNS. Replace the `ports:` block with `network_mode: host`. Host mode drops the network isolation and ignores `ports:`; JagHelm then binds 3099 on the host directly.

The server listens on every IPv4 interface (`0.0.0.0`) on `PORT` (default 3099). Set `JAGHELM_HOST` to listen on one address instead, such as `127.0.0.1` for a reverse proxy on the same host with `network_mode: host`. In a bridge-network container keep the default (see `env.example`).

## Settings and the files in `data/`

Most things are configurable from the Settings UI: an index of seven sections (Sources, Nodes & Services, Integrations, Apps & links, Notifications, Appearance and System), each a card saying what it holds, with a search that finds a setting by name ("font" finds Appearance, and opens it at its fonts), or by the name of a tab Settings had before ("widgets", "security"). The command palette finds them the same way. For people who prefer files, everything is on disk too, in `data/` (or the directory `JAGHELM_DATA_DIR` names). Set `JAGHELM_DATA_DIR` like any other variable: in Docker, `environment:` or `env_file`; running `npm start`, the `.env` in its working directory, which it reads before anything else, or the process environment, which wins over `.env`.

```
data/
├── services.yaml          # nodes, services, integrations
├── display-config.json    # theme, layout, sections, links, backup jobs
├── secrets.json           # AES-256-GCM encrypted credentials
├── config-version.key     # key for the versions of services.yaml and display-config.json, which a save checks (made on first start; if lost, a new one is made)
├── auth.json              # password hash (if changed via UI)
├── sessions.json          # signed-in sessions: a SHA-256 of each session token, never the token
├── known-addresses.json   # the 16 addresses signed in from last, which skip the sign-in budget during an attack
├── cron-jobs.json         # cron job execution history
├── drift-reports.json     # the latest config drift report per host
├── todos.json             # checklist data
├── icon-index.json        # icon picker's names-only index (a cache; safe to delete)
└── icon-cache/            # CDN icons served locally after the first load (a cache, at most 50 MB; safe to delete)
```

A sign-in survives restarts and updates. It ends after 30 days without use, and 90 days after sign-in in any case. Logging out ends that session; changing the password in Settings ends every other one. Changing `DASH_PASS`, `DASH_USER` or `DASH_SECRET`, or removing `auth.json`, signs every device out at the next start. To sign every device out without changing the password, stop JagHelm, delete `data/sessions.json` and start it again.

Failed sign-ins slow down the address they come from: after 5 in a row it waits 30 s, doubling with each further failure up to 15 minutes, and a sign-in clears it. Guesses from many addresses at once share one budget, at most 130 an hour, and during such an attack a brand-new address can be kept waiting for as long as it lasts. The 16 addresses you signed in from most recently (kept across restarts) and those in `LOGIN_TRUSTED_NETS` skip that budget, so list your LAN and tailnet there. The sign-in form says how long to wait. A restart clears your own address's wait, not an attack: it refills the budget for the attackers. Behind a reverse proxy, set `TRUST_PROXY`, or every client shares the proxy's address and anyone can claim a trusted one. Details in [KNOWN-ISSUES.md](../KNOWN-ISSUES.md).
 
`services.yaml` is hot-reloaded — edit it on disk and JagHelm picks up the change without restarting. A save that leaves it unreadable or empty for a moment keeps the last good config, and JagHelm never overwrites a file it can't read: until it is fixed, Settings says which line doesn't parse and refuses every save. A save in Settings changes only the lines of what it changed: the file's comments, blank lines and quoting stay, with the spacing evened out (two-space indents, one space before a comment at the end of a line, `[a, b]` for a flow list), and a list it changes is written anew, without the comments between its items. A key it removes takes the comment right above it; a heading a blank line above stays. A file with YAML anchors, aliases or merge keys (`&`, `*`, `<<`), or a value JagHelm's two YAML readers read differently (an unquoted date), is still rewritten whole in JagHelm's own layout, without its comments, and the log says so. The credentials in it never reach the browser: Settings reads a password or token (plain text or a `$secret:` reference), a value under another credential's name (`apikey`, `secret`, `cookie` and the like), a header value under `extraHeaders`, a session's `loginBody`, an endpoint with a key in its query string, and a value an endpoint fills in through a `{name}` placeholder only as `{ "$stored": true }`, and a save in Settings keeps each stored one. So is an integration's URL that carries a key or password (see the integrations section below).

## Environment variables

The `.env` example above covers the required + commonly used vars. JagHelm checks the whole environment once at start: a value that doesn't fit its variable (`LOG_LEVEL=loud`, `CSP_REPORT_ONLY=yes`) is warned once in the log, naming the variable and the default used instead, never its value. The defaults are the safe side (the CSP enforced, the secrets API closed, no demo). Only a `PORT` that isn't a port number or a `JAGHELM_BLOCK_PRIVATE_NETWORKS` that isn't true or false stops the start. An empty `NAME=` line counts as unset.

There's also a power-user escape hatch — every preset integration can be configured via env vars instead of the UI ([`env.example`](../env.example) lists each preset's):
 
```env
# Prefixed with JAGHELM_ to avoid colliding with service env vars in
# shared Docker networks. UI/yaml config is overridden when set.
JAGHELM_ADGUARD_URL=http://192.168.x.x:8085
JAGHELM_ADGUARD_USER=admin
JAGHELM_ADGUARD_PASS=secret
 
JAGHELM_NPM_URL=http://192.168.x.x:81
```

The Pipeline panel shows recent Gitea commits. For a repo with Gitea Actions, each row is a commit its latest push runs ran on, with the CI result ("CI Passed", "CI Failed", "CI Running" and so on), the branch and the short SHA; pull-request and scheduled runs don't show. A repo without Actions, or with Actions on but no runs yet, shows the latest commits on its default branch, with no CI result. Gitea is read every 5 minutes: one request for the list of repos, then one per repo. A repo with Actions on but no runs takes one more request an hour, when JagHelm checks it for runs again (and once more at the first read after a restart). A failed read is tried again after 30 seconds, then less often, and the panel keeps the last commits for up to 10 minutes after Gitea last answered. The panel reads `JAGHELM_GITEA_URL` and `JAGHELM_GITEA_TOKEN`, which the Gitea preset reads too. With `JAGHELM_GITEA_URL` unset, JagHelm polls no Gitea and the dashboard has no Pipeline panel.

```env
JAGHELM_GITEA_URL=http://192.168.x.x:3000
JAGHELM_GITEA_TOKEN=...
```

The Overview's Expiry section lists TLS certificates and Tailscale node keys with the days left, amber under 21 days and red under 7 (both lines are in Settings → Nodes & Services → Expiry). Add the hosts to watch there (`nas.example.com` or `192.168.1.5:8443`, up to 30): the server makes a TLS handshake with each about a minute after it starts and every 6 hours, reads the certificate's end date and issuer, and sends nothing else. An expired or self-signed certificate is read and reported, not trusted. `JAGHELM_BLOCK_PRIVATE_NETWORKS=true` refuses private addresses here as it does elsewhere. For Tailscale node keys, set `JAGHELM_TAILSCALE_API_KEY` (the variable the Tailscale integration reads too) to an API access token (the Keys page of the Tailscale admin console; tokens there are not scoped, they act with the role of the user who makes them, so make it as a user with a read-only role, and it expires in 90 days at most). It is sent to `api.tailscale.com` only, in a header, and never logged. `JAGHELM_TAILNET` names the tailnet; unset, the token's own is used. With no host and no key the section is absent. It sends no alerts.

```env
JAGHELM_TAILSCALE_API_KEY=tskey-api-...
```

Older installs used names without the prefix (`GITEA_URL`, `GITEA_TOKEN`, `NPM_URL`, `SONARR_API_KEY` and the rest). Those still work, with a warning in the log for each one set, but a later release reads only the `JAGHELM_` names, so rename them when you can. When both names are set with different values, the `JAGHELM_` one is used. The server's own settings (`PROMETHEUS_URL`, `KUMA_URL`, `DASH_*`, `PORT`, `TRUST_PROXY`, `ARCANE_*` and the rest) keep their names.

See [`env.example`](../env.example) for the full list.
