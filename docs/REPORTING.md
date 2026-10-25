# Reporting: cron jobs, config drift and backups

Your own scripts and hosts can tell JagHelm how they are doing. It runs no checks of its own and holds no keys to your hosts: they push a small JSON report, and JagHelm shows the result on the Overview and alerts when one goes quiet. All of this needs `JAGHELM_CRON_SECRET` in `.env` (make one with `openssl rand -hex 32`); with it unset, every report is refused. For setting variables, see [CONFIGURATION.md](CONFIGURATION.md).

## Cron job reporting

Jobs report with `POST /api/cron/report`. `secret` must match `JAGHELM_CRON_SECRET`; `node`, `job` and `status` (`success` or `failure`) are required; `duration_seconds`, `schedule` and `error` are optional. `expected_every_seconds` is also optional: an integer from 60 to 2678400, or a digit string. Anything else returns 400 and the report is rejected.

```json
{ "secret": "...", "node": "nas", "job": "backup", "status": "success", "expected_every_seconds": 86400 }
```

The Overview's Jobs section shows `schedule` in words: words as sent ("every 15 min"), a common cron expression put in words (`30 6 * * *` is "daily at 06:30"; six fields with seconds first too), or, without one, "every 24 h" from `expected_every_seconds`. A job opens its last three runs and Remove. A schedule is in the reporter's clock and run times in the viewer's: when they can differ, put the zone in brackets after the schedule (`0 3 * * * (America/Toronto)`), which is shown as sent ("daily at 03:00 (America/Toronto)"). A `job` or `node` of `.` or `..` is refused (400): a browser can't address it to remove it.

## Config drift

Hosts push the result of their drift check to `POST /api/drift/report`, with the same `secret` (`JAGHELM_CRON_SECRET`); JagHelm runs no check and holds no key. The Overview's Config drift row is green while every host's last report says its config matches and is under 36 hours old (Settings → Nodes & Services → Config drift changes the 36), amber for drift, a failed check, or any silent host ("Unknown"; a host unheard of for 30 days drops off), grey "No reports" before the first push, and absent without the secret. Body: `{ "secret": "...", "host": "pi-1", "checkedAt": "2026-10-24T06:00:00Z", "status": "ok" | "drift" | "error", "items": [{ "name": "...", "kind": "DIFF", "detail": "..." }] }`, at most 200 items and 64 KB. A ready-to-run push script is `docs/examples/drift-push.sh`; the schema and limits are in `docs/ARCHITECTURE.md` (4.2).

`GET /api/cron/status` reports `overdue` and `seconds_since_report` for every job (`seconds_since_report` is null if a run has no timestamp), and `expected_every_seconds` only for jobs that declared one. A job is overdue when it has not reported within the interval plus `max(25% of the interval, 10 minutes)`. `DELETE /api/cron/jobs/:node/:job` (session auth, URL-encode both segments) removes a job and its history.

## Marking jobs as backups

Mark a job as a backup in Settings → Nodes & Services → Backup jobs, with the switch on its row. It is saved as `backupJobs` in `data/display-config.json`, which names a job as `"node:job"` (the node and job its reports send), and a job is a backup only when it is named there:

```json
{ "backupJobs": ["pve:proxmox-backup", "nas:b2-sync"] }
```

The Overview's Backups section (and the phone's) lists each of these jobs with when it last ran well, amber after 36 hours and red after 72 (Settings → Nodes & Services → Backup freshness), red at once for a failed last run, amber at most when the board says its host is unreachable, and "No signal" for one that has never reported. Set `JAGHELM_B2_KEY_ID`, `JAGHELM_B2_APP_KEY` and `JAGHELM_B2_BUCKET` (a read-only Backblaze application key restricted to the bucket) and it adds the bucket's size, its trend, and a warning when old file versions pile up; JagHelm reads Backblaze once a day in the background, never on a page load.

A backup shows under Backups instead of Jobs in `/api/status`, and is judged more strictly than a job: a failed last run is critical, overdue a warning (a job is a warning either way). Its push notifications are the job's, except that a failed backup pages as critical (high priority) where a failed job is a warning. Proxmox backup results reported by a PVE notification webhook arrive as a job like any other, so name that job here too. You can also edit the file (JagHelm reads it again on the next refresh) or save the whole config with `POST /api/display-config`, sending the `ETag` that `GET /api/display-config` answered in an `If-Match` header (a save without it is refused, and one over a changed file is a 409: read again). An entry that isn't a `"node:job"` string is ignored, with one warning in the log.
