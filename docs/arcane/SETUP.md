# Arcane Update Notifications: Operator Setup

JagHelm polls the Arcane manager's REST API (read-only) and turns its state changes into
mobile push notifications and scheduled-job history. This replaced the Watchtower webhook,
which was removed in 2.2.0. Once a week it also sends a vulnerability digest from Arcane's
stored scan results (§7).

The poller lives in `server/arcane/` and starts at boot. It is off unless both `ARCANE_URL`
and `ARCANE_API_KEY` are set, and it never runs in demo mode.

## 1. Create a scoped API key in Arcane

Create an API key for JagHelm with only these grants. All of them are read-only.

| Scope | Grants |
|---|---|
| Global | `environments:list`, `environments:read` |
| Each environment | `containers:list`, `image-updates:read`, `activities:read` |
| Global, optional, for the vulnerability digest (§7) | `vulnerabilities:read` |

Arcane v2.16.1 saves every API-key grant as global: its key form has no per-environment
choice. With `vulnerabilities:read` the key can read every environment's scan results, so
`ARCANE_VULN_DIGEST_ENVS` (§2) decides which environments the digest reads.

JagHelm calls only these endpoints, with the key in the `X-API-Key` header:

- `GET /api/environments`
- `GET /api/environments/{id}/containers` (all containers, with their update check)
- `GET /api/environments/{id}/activities` (`auto_update`, `system_prune` and
  `image_update_check`, plus `job_run` to tell scheduled runs from manual ones; see §6)
- `GET /api/environments/{id}/updater/history`
- `GET /api/app-version`

With `vulnerabilities:read`, for the weekly digest (§7):

- `POST /api/environments/{id}/images/vulnerabilities/summaries` (the latest scan of each
  container image, looked up by image id)
- `GET /api/environments/{id}/vulnerabilities/overview` (the known-exploited count)
- `GET /api/environments/{id}/vulnerabilities/all` (critical and high findings with a fixed
  version, 100 per page)

It never calls `/jobs*`, which needs the write-capable `jobs:manage` grant, and never starts
a vulnerability scan (`vulnerabilities:scan`).

## 2. Configure JagHelm

Set these in the JagHelm env file on vm-103 (`/opt/stacks/jaghelm/.env`; the template is
`env.example`) and recreate the container. Never commit real values.

| Variable | Meaning |
|---|---|
| `ARCANE_URL` | Manager base URL. Credentials in the URL (`user:pass@`) disable the poller. `http://` works but logs a one-time warning that the key travels unencrypted. |
| `ARCANE_API_KEY` | The key from step 1. |
| `ARCANE_CHECK_ONLY_ENVS` | Comma list of environment names that are check-only (see below). Default empty. |
| `ARCANE_POLL_SECONDS` | Poll interval. Default 300, minimum 60. |
| `ARCANE_RELEASE_CHECK_HOURS` | Arcane release check interval. Default 6, minimum 1. |
| `ARCANE_IMAGE_CHECK_HOURS` | How often Arcane's image watcher checks for updates (its **Polling** schedule), used as the `arcane-check` job's expected interval (§6). Default 6, for a schedule of `0 0 */6 * * *`; minimum 1, maximum 744 (31 days). |
| `ARCANE_VULN_DIGEST_ENVS` | Comma list of environment names the weekly vulnerability digest (§7) reads, for example `vm-103`. Default empty, which turns the digest off. |
| `ARCANE_VULN_DIGEST_DAY` | Day of the weekly vulnerability digest (§7) in UTC, 0 (Sunday) to 6. Default 0. |
| `ARCANE_VULN_DIGEST_HOUR` | Hour of the weekly vulnerability digest in UTC, 0 to 23. Default 14. |
| `NODE_EXTRA_CA_CERTS` | Path to the manager's CA or self-signed certificate (step 3). |

Both intervals are capped at the timer limit of about 24.8 days (2^31-1 ms), so a very large
value cannot wrap around into a tight loop.

If either `ARCANE_URL` or `ARCANE_API_KEY` is missing, JagHelm logs that the integration is
off and starts nothing.

## 3. Trust the manager's certificate

If the manager uses a self-signed certificate, JagHelm must trust it. There is no
TLS-skip option. Put the certificate (public part only) in the data volume as
`data/arcane-ca.crt` and set:

```
NODE_EXTRA_CA_CERTS=/app/data/arcane-ca.crt
```

`NODE_EXTRA_CA_CERTS` is read once at process start, so restart the container after
changing the file. It applies to every outbound HTTPS call from the process. If the file is
missing, Node only prints a warning at start; the poller then logs the TLS reason with each
failed read, for example `Arcane request failed: fetch failed (DEPTH_ZERO_SELF_SIGNED_CERT)`.

## 4. Environments

Environment names must match `[A-Za-z0-9._-]{1,64}` (for example `vm-103`, `vm-101`,
`pi-1`, `pi-2`). An environment with any other name is skipped with one warning in the log,
and so are two environments that share a name. Disabled environments are ignored.

Health comes from the environment's `status`: `online` and `standby` are up, `offline` and
`error` are down, anything else (such as `pending`) is unknown and changes nothing.

### Check-only environments

Name an environment in `ARCANE_CHECK_ONLY_ENVS` when Arcane only checks it and never
applies updates (the Pis, for example). Every pending update there counts as held back.
Elsewhere, a pending update is held back when the container has auto-update turned off.

## 5. What pushes when

All Arcane pushes use the existing **Updates** notification toggle in the app (labelled
**Watchtower** in app 1.1.0 and earlier; the preference key is still `watchtower`); there is no
separate Arcane toggle. Recovery messages also respect the "also notify on recovery" switch.

- **First sight is silent.** The first time JagHelm sees an environment up with every read
  succeeding, it stores the held-back set and marks existing finished activities as seen. No
  push, no scheduled-job run. This is also what happens after the state files are deleted.
- **Update run.** Each finished `auto_update` activity pushes once, with the containers
  updated and failed (title `Updates · <env>`, for example `2 updated: a, b · 1 failed: c`).
  A run that updated nothing and failed nothing pushes nothing. Arcane's update history has
  no run id, so a run takes the results from its start to 60 seconds after it ended, but
  never past the start of the next run: back-to-back runs report each container once.
- **Held back.** `1 update held back: name` (or `N updates held back: names`) pushes when a
  held-back container has image news: its update is newly pending, or its latest image
  changed. `N caught up: names` pushes when a held-back container no longer has a pending
  update at all (it was updated, or it is gone). It pushes on change only, not on every poll.
- **Policy-only changes are silent.** Moving a container into or out of the held-back set
  while its latest image stays the same pushes nothing: adding or removing the
  `com.getarcaneapp.arcane.updater=false` label, editing Arcane's exclusion list, or adding
  or removing an environment in `ARCANE_CHECK_ONLY_ENVS`. JagHelm keeps each environment's
  pending updates (container to latest image, any tier) in `arcane-state.json` to tell the
  two apart. A state file from a pre-release build has no pending map, so for its first poll a
  newly held-back container is announced as before; the map is then recorded silently.
- **Agent offline.** `Agent disconnected; Arcane cannot manage <env>` (title
  `Arcane · <env>`) pushes after 2 consecutive polls that report the environment down,
  counted from first sight and independent of the silent data baseline. One push per outage.
  `Agent reconnected` pushes once when it returns.
- **New Arcane release.** `Arcane <version> available` pushes once per new version, checked
  every `ARCANE_RELEASE_CHECK_HOURS`. The body says to upgrade by PR (bump the pinned tag).
- **Failed reads.** If any data read for an environment fails (network error, non-2xx,
  malformed body), JagHelm leaves that environment's data state (held-back set, pending
  updates, seen activities, baseline) alone for that poll; its agent health still updates
  from the environment list. If the environment list itself fails, all state is left
  unchanged. A flaky Arcane therefore cannot cause a "caught up" storm or a replayed backlog.
  A read that keeps failing is logged once per distinct error, plus one line when reads
  recover, not on every poll.
- **Failed update checks.** When Arcane's own check of a container fails (a registry outage
  or an auth error) or has not run, a held-back container stays held back, silently, with
  its last known update. It clears only when Arcane reports it up to date or it is gone, so
  a registry error never reads as "caught up".

Push bodies list at most 10 names, each capped at 64 characters; the rest are summarised as
`+N more` (for example `12 updates held back: a, b, c, d, e, f, g, h, i, j +2 more`).

State advances before the push is sent, so a push outage never replays old events later. At
startup, when push (FCM) credentials are configured, the first poll and the first release
check wait up to 30 seconds for push to be ready, so events found right after a restart are
not lost to the push client still starting.

## 6. Scheduled-job history

Each finished activity of a known environment that Arcane's scheduler started is also
recorded as a run of the cron job `arcane-update` (updates) or `arcane-prune` (system prune),
with the environment name as the node and an expected interval of 24 hours, so a schedule
that stops running is flagged overdue. A run is `success` unless Arcane reports the activity
`failed`; an update run is a `failure` only when it failed without any per-container result.
The error text is capped at 2048 characters. Activities that have not reached a final state
(`success`, `failed`, `cancelled`) are retried on the next poll.

Manual runs never become cron runs, so a one-off button press does not start a daily
overdue clock: the Prune button, a container's or project's Update button, "update all"
from the updater page, and the Jobs page's "Run now". They still push their updated and
failed containers (§5). Arcane gives a scheduled and a manual activity the same shape, so
JagHelm reads the environment's `job_run` activities: a run counts as scheduled only when a
job run with trigger `scheduled` (or `recovery`, a missed slot the scheduler runs late)
names it as the activity it produced. Job runs are read newest first, 50 per page and at
most 4 pages, back to the oldest run being judged; a run whose job run lies further back
counts as manual.

A finished run always pushes on the poll that first sees it. If its job run has not finished
yet (Arcane can hold a job run queued or retrying), only the cron decision waits: the run is
kept in `arcane-state.json` and checked again on each poll. It is recorded once its job run
finishes as `scheduled` or `recovery`, and dropped if that turns out `manual`. A run still
waiting after 30 minutes, or pushed out by more than 50 waiting runs in one environment,
counts as manual (no cron run, one log line). A failed job-run read leaves the waiting runs
as they are.

### Image watcher checks (`arcane-check`)

Held-back pushes depend on Arcane's image watcher checking the registries, on every
environment (on check-only environments it is the only thing that looks for updates). So
each finished `image_update_check` the watcher ran on its own is recorded as a run of the
cron job `arcane-check` for that environment, with an expected interval of
`ARCANE_IMAGE_CHECK_HOURS` (default 6 hours). If checks stop, the job goes overdue after the
interval plus a quarter of it (7.5 hours by default). A check pushes nothing itself.

The watcher runs on its schedule, and also once when its Arcane container starts (and on
Docker image events, if Arcane's image event watcher is enabled). Through a read-only key
these look the same, so both count. Manual checks never count: the **Check Updates** button
(it runs outside the job runner, so its activity carries no run id) and the Jobs page's
**Run now** for image polling (its `job_run` has trigger `manual`). Arcane writes a `job_run`
for image polling only when it is started by hand, so a job-runner check without one counts
as scheduled.

A check is `success` even when Arcane marks it failed because some images could not be
checked (`Image update check completed: 34 checked, 2 errors`); those containers keep their
held-back state silently (§5). It is a `failure` only when every image errored or the check
failed before checking anything; the error text is Arcane's.

The first poll that sees an environment's checks, including the first poll after upgrading
from 2.1.0, marks the checks already listed as seen without recording them, so the job
appears after the next check.

## 7. Weekly vulnerability digest

Once a week, Sunday 14:00 UTC by default (`ARCANE_VULN_DIGEST_DAY`, `ARCANE_VULN_DIGEST_HOUR`),
JagHelm reads the vulnerability scan results Arcane has stored and pushes a digest per
environment, but only when something is new. It never starts a scan: scanning has to be
scheduled in Arcane itself (`VULNERABILITY_SCAN_ENABLED`). It reads only the environments
named in `ARCANE_VULN_DIGEST_ENVS`, and only once Arcane has scanned something there; an
environment not in the list is never read and never gets a scheduled job. With the list
empty (the default) the digest is off. The key needs `vulnerabilities:read` (§1).

**What is new.** A finding is identified by its image repository (without tag or digest), its
vulnerability id and its package, for critical and high findings that have a fixed version,
in the images the environment's containers use (running or not). Images no container uses
are left out, so a stray pull or an old image waiting for the prune is not news. The digest
pushes when there is any of:

- a new critical or high finding since the last digest;
- more known-exploited vulnerabilities (CISA KEV, from Arcane's risk overview) than at the
  last digest. This compares counts, so a KEV entry that arrives in the week another one
  leaves is not announced as KEV (a critical or high finding behind it still is). Arcane
  counts KEV over all images it scanned, including unused ones;
- an image of a running container that is newly stale or failed: not in either list at the
  last digest. Stale means its latest scan is older than 9 days, or it has no scan while its
  container is older than 9 days (a container just recreated on a new image waits for the
  next scan). Failed means its latest scan failed.

Nothing new, no push. Findings that went away (`N fixed`) and scan problems already
reported at an earlier digest (`still not scanned: …`, `still failing: …`) are listed in a
push that goes out anyway, and never push on their own; nor does a scan problem clearing.
The `arcane-vuln-digest` job (below) is what tells you the digest itself stopped. For
example (title `Vulnerabilities · vm-103`):

```
3 new critical, 11 new high (fix available) · 9 images · top: nextcloud 2C, immich-server 1C · KEV 1
KEV 2 (1 new) · 2 fixed
1 image not scanned in 9 days: redis · 1 scan failed: gitea · still failing: nextcloud
```

`top` lists the three images with the most new findings (`2C 1H`: two critical, one high).
The severity is warning for a new critical finding or a new KEV entry, info otherwise. The
digest uses the **Updates** notification toggle, like the other Arcane pushes.

Because the repository is the key, an image update that keeps a finding is not news, and
neither is the same finding in a second tag of the image. While an image's latest scan has
not completed (it failed, it is running, or a newly pulled image is not scanned yet),
Arcane lists none of its findings; JagHelm then keeps that repository's findings from the
last digest rather than count them as fixed, so they are not announced again as new once a
scan succeeds. The same holds for a scan that starts while JagHelm reads the findings: it
reads each image's scan state again afterwards. While any repository is in that state, the
stored KEV count is never lowered, so a KEV entry hidden by a failed scan does not come back
as new. An image's first results do count as new.

**First digest.** The first digest of an environment is a silent baseline: it stores the
current findings, the KEV count and the images already stale or failed, and pushes nothing,
as the poller does at first sight (§5). At start, JagHelm runs a digest at once if it has
not baselined any environment yet, or if it was down at the last weekly slot. So after
setting `ARCANE_VULN_DIGEST_ENVS` and adding the grant, the next start takes the baseline
straight away; a later grant waits for the next weekly slot unless JagHelm restarts.

**Scheduled-job history.** Every digest records a run of the cron job `arcane-vuln-digest`
for the environment, expected weekly, so digests that stop go overdue after 8.75 days (a
week plus a quarter). The run is `success` when the results were read, whether or not it
pushed, including the baseline. It is `failure` when they could not be read (Arcane
unreachable, the environment offline, an error from Arcane) for an environment that already
has its baseline; an environment without one has no job yet. The findings read is tried up
to three times, 30 seconds apart, before the week counts as failed.

**Refused reads.** A refused read (HTTP 401 or 403: the key lacks `vulnerabilities:read`, or
vulnerability management is turned off on that environment) pushes nothing and records no
run, just as the poller records nothing on a failed read. It is logged once per environment
while JagHelm runs, plus once when reads recover. So a listed environment the key cannot
read never gets an `arcane-vuln-digest` job; one that becomes unreadable later lets its job
go overdue. A listed name Arcane does not return is logged once.

**Limits.** Arcane serves findings 100 per page. JagHelm reads every page and checks the
rows against Arcane's total, so a scan that finishes mid-read fails that attempt instead of
reporting half the findings as fixed. An environment fails its digest, loudly and without
storing anything, when Arcane returns more than 20,000 critical and high findings or when
the findings to keep (the current ones plus those carried for unscanned images) would pass
20,000. The dry run (§9) shows the count against that cap. Image scan states are looked up
for at most 500 images per environment.

## 8. Keep Arcane away from JagHelm itself

`compose.yaml` labels the JagHelm container `com.getarcaneapp.arcane.updater=false` and
`com.getarcaneapp.arcane.update-check=false`, so Arcane neither updates it nor reports it
as pending. JagHelm's own deploys go through the pin, health-gate and rollback workflow.

## 9. Dry run before enabling

`scripts/arcane-poll-once.js` runs the real poller twice against the live manager over
throwaway temp stores. It sends no push and never touches JagHelm's data directory. Pass 1
is the silent baseline; pass 2 shows what would push. Run it under Node 22:

```bash
ARCANE_URL=https://arcane.example:3552 ARCANE_API_KEY=... \
  ARCANE_CHECK_ONLY_ENVS=pi-1,pi-2 \
  node scripts/arcane-poll-once.js
```

Use the same `NODE_EXTRA_CA_CERTS` as production if the manager is self-signed. Output lists
each would-be push, the cron runs, and the per-environment health and held-back set. The key
is never printed. Exit code 0 means both passes read everything; 1 means a pass reported read
errors (listed under `errors`); 2 means a missing `ARCANE_URL` / `ARCANE_API_KEY`, a bad
argument, or an unexpected failure (its message is printed, without a stack trace).

`--vuln-digest` runs the weekly vulnerability digest (§7) instead of the poller, for the
environments in `ARCANE_VULN_DIGEST_ENVS`, also twice over a throwaway state file and
without sending anything:

```bash
ARCANE_URL=https://arcane.example:3552 ARCANE_API_KEY=... ARCANE_VULN_DIGEST_ENVS=vm-103 \
  node scripts/arcane-poll-once.js --vuln-digest
```

Pass 1 is the silent baseline; pass 2 shows what would push against it (normally nothing,
since nothing changed in between). Each listed environment's outcome is listed: `baseline`
or `digest` with `criticalHighFixable` (the critical and high findings with a fix that
Arcane returned, against the `cap` of 20,000), the finding count of the images in use, the
KEV count and the stale or failed scans; `no-results` (nothing scanned there);
`no-permission` (the key lacks `vulnerabilities:read`, or vulnerability management is off
there); `not-found`; `down`; or `error`. Then, for each environment that took a baseline,
the push it would get if every current finding and scan problem were new, to preview the
wording, and the time of the next scheduled digest. Exit code 0 means at least one
environment was read and none had a read error; 1 otherwise, including when every
environment refused the read; 2 as above, and also when `ARCANE_VULN_DIGEST_ENVS` is empty.
`--record` does not combine with `--vuln-digest`.

`--record <dir>` additionally writes each response as a JSON fixture, reduced to the fields
JagHelm reads (labels, environment variables and everything else are dropped) and anonymized:
container names, image references, tags, digests and every id (environment, activity, batch,
history) become stable placeholders (`ctr-01`, `registry.example/img-01:latest`, fake `sha256:`
values, fake UUIDs, `id-01`),
and error text becomes `redacted` (an image check's count summary is kept: it names nothing).
Environment names and the Arcane version are kept.
Per-environment files come from the first environment (by name) whose response has rows,
otherwise the first environment. Review the files before committing them anywhere. In the
JagHelm repository, live recordings belong in `server/arcane/fixtures/live/`; the files
directly in `server/arcane/fixtures/` are hand-built scenarios the unit tests depend on, so
never record over them.

## 10. Files JagHelm keeps

In the data volume: `arcane-state.json` (which environments are baselined, agent down
counters, recent activity ids, recent image check ids, each environment's pending updates,
runs waiting on their job run, last notified release) and `arcane-held-back.json` (held-back containers per
environment). Deleting both makes the next poll a fresh silent baseline. Deleting only
`arcane-held-back.json` is silent too while each container's latest image is unchanged: the
pending updates in `arcane-state.json` show the backlog is not news, so the set is rebuilt
quietly and only a newer image pushes. Only a state file from a pre-release build (no pending
updates in it) would announce every held-back container again.

The vulnerability digest (§7) keeps `arcane-vuln-state.json`: per environment, the critical
and high findings, the KEV count and the stale and failed images of the last digest, plus
when the last digest ran.
Deleting it (with JagHelm stopped) makes the next digest a silent baseline again, taken at
the next start.

## 11. Cutover from Watchtower, and rollback

1. **Deploy** with `ARCANE_URL` and `ARCANE_API_KEY` set and `ARCANE_CHECK_ONLY_ENVS` empty.
   While Watchtower is still the update source, unlabelled containers count as auto-tier, so
   Arcane announces no held-back updates for them and nothing arrives twice. Only containers
   that already carry `com.getarcaneapp.arcane.updater=false` (a canary, for example) push
   as held back.
2. **At the flip**, after Watchtower is stopped and Arcane's labels and exclusions are in
   place, set `ARCANE_CHECK_ONLY_ENVS=pi-1,pi-2` and recreate the container. The backlog
   moves into the held-back set as a policy-only change (§5), so it is silent: no state
   files to delete, and only a genuinely new image pushes afterwards.
3. **Rollback** to Watchtower: unset `ARCANE_URL` and recreate the container, so Watchtower is
   again the only source of update pushes. The `arcane-check` job then stops reporting and
   goes overdue after about 7.5 hours, `arcane-update` and `arcane-prune` after about 30
   hours, and `arcane-vuln-digest` after about 8.75 days; delete them from the
   scheduled-jobs dashboard if the rollback lasts. To start again later from a silent baseline, delete the
   Arcane state files (§10) before setting `ARCANE_URL` again.
