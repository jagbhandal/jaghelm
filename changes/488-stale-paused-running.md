### Fixed
- A running container whose Kuma monitor was paused while down is no longer shown as down and no longer sends a "service down" notification (Kuma's status-page fallback only).
- A Kuma or Gitea answer with an error status is now a failed source with its status named, and the board keeps its last good data, instead of being read as an empty list or as monitors with no status.
