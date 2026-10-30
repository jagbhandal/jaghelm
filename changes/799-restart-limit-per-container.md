### Added
- A container that restarts on purpose can have its own restart-loop limit in
  `display-config.json`, for example `"restartLimits": {"pi-2:vaultwarden": 4}`
  (node and container name, an integer of 3 or more). It alerts only above that
  many restarts in the hour, and the alert says the limit that applied.
