### Fixed
- On Kuma's status-page fallback (not the `/metrics` source), a running container whose monitor was paused while down is no longer shown as down and no longer sends a "service down" notification.
- On the status-page fallback only, a Kuma heartbeat read that answers with an error status is now a failed load that names the status and keeps the last good statuses, instead of loading every monitor with no status. A Gitea repo whose commits request answers with an error is left out, and if every repo does the poll fails and keeps the last list.
