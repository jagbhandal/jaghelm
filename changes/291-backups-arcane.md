### Added
- Backups are their own area in `/api/status`, beside Jobs, once you say which
  jobs are backups: list them in `display-config.json` as `backupJobs`, for
  example `["pve:proxmox-backup"]` for the Proxmox backups the PVE webhook
  reports. A backup whose last run failed is critical, and one that missed its
  schedule a warning. Their push notifications are unchanged. Jobs not in the
  list stay jobs, as before.
- An Arcane agent that goes offline now shows in `/api/status` as a warning
  under Integrations, and clears when it is back. Its push notification is
  unchanged.
