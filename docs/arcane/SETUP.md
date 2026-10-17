# Arcane Update Notifications: Operator Setup

JagHelm polls the Arcane manager's REST API (read-only) and turns its state changes into
mobile push notifications and scheduled-job history. This replaces the Watchtower webhook
(see [docs/watchtower/SETUP.md](../watchtower/SETUP.md), deprecated).

The poller lives in `server/arcane/` and starts at boot. It is off unless both `ARCANE_URL`
and `ARCANE_API_KEY` are set, and it never runs in demo mode.

## 1. Create a scoped API key in Arcane

Create an API key for JagHelm with only these grants. All of them are read-only.

| Scope | Grants |
|---|---|
| Global | `environments:list`, `environments:read` |
| Each environment | `containers:list`, `image-updates:read`, `activities:read` |

JagHelm calls only these endpoints, with the key in the `X-API-Key` header:

- `GET /api/environments`
- `GET /api/environments/{id}/containers` (pending updates only)
- `GET /api/environments/{id}/activities` (`auto_update` and `system_prune`, plus `job_run`
  to tell scheduled runs from manual ones; see §6)
- `GET /api/environments/{id}/updater/history`
- `GET /api/app-version`

It never calls `/jobs*`, which needs the write-capable `jobs:manage` grant.

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
| `NODE_EXTRA_CA_CERTS` | Path to the manager's CA or self-signed certificate (step 3). |

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
changing the file. It applies to every outbound HTTPS call from the process.

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

All Arcane pushes use the existing **Watchtower / updates** notification toggle in the app;
there is no separate Arcane toggle. Recovery messages also respect the "also notify on
recovery" switch.

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
  two apart. A state file written before 2.1.0 has no pending map, so for its first poll a
  newly held-back container is announced as before; the map is then recorded silently.
- **Agent offline.** `Agent disconnected; Arcane cannot manage <env>` (title
  `Arcane · <env>`) pushes after 2 consecutive polls that report the environment down,
  counted from first sight and independent of the silent data baseline. One push per outage.
  `Agent reconnected` pushes once when it returns.
- **New Arcane release.** `Arcane <version> available` pushes once per new version, checked
  every `ARCANE_RELEASE_CHECK_HOURS`. The body says to upgrade by PR (bump the pinned tag).
- **Failed reads.** If any read for an environment fails (network error, non-2xx, malformed
  body), JagHelm leaves that environment's state untouched for that poll. A flaky Arcane
  therefore cannot cause a false "caught up" or a replayed backlog.

State advances before the push is sent, so a push outage never replays old events later.

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
names it as the activity it produced. While that job run is still finishing, the activity is
judged on a later poll. Job runs are read newest first, 50 per page and at most 4 pages, back
to the oldest run being judged; a run whose job run lies further back counts as manual.

## 7. Keep Arcane away from JagHelm itself

`compose.yaml` labels the JagHelm container `com.getarcaneapp.arcane.updater=false` and
`com.getarcaneapp.arcane.update-check=false`, so Arcane neither updates it nor reports it
as pending. JagHelm's own deploys go through the pin, health-gate and rollback workflow.

## 8. Dry run before enabling

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
is never printed. Exit code 2 means a missing `ARCANE_URL` / `ARCANE_API_KEY` or a bad
argument.

`--record <dir>` additionally writes each response as a JSON fixture, reduced to the fields
JagHelm reads (labels, environment variables and everything else are dropped). Per-environment
files come from the first environment (by name) whose response has rows, otherwise the first
environment. Review the files before committing them anywhere.

## 9. Files JagHelm keeps

In the data volume: `arcane-state.json` (which environments are baselined, agent down
counters, recent activity ids, each environment's pending updates, last notified release) and
`arcane-held-back.json` (held-back containers per environment). Deleting both makes the next
poll a fresh silent baseline.

## 10. Cutover from Watchtower, and rollback

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
   again the only source of update pushes. The `arcane-update` and `arcane-prune` jobs then
   stop reporting and go overdue after about 30 hours; delete them from the scheduled-jobs
   dashboard if the rollback lasts. To start again later from a silent baseline, delete both
   Arcane state files (§9) before setting `ARCANE_URL` again.
