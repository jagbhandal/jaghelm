### Added
- Settings, Nodes & Services: each service now shows which Uptime Kuma monitor
  Auto-match would pick for it and why ("matched by name", "matched by a shared
  word", or "no match"), with the monitors that have similar names. The
  suggestion is what the matcher would really do if the mapping were cleared,
  and a monitor another mapping holds is not offered. One click uses the
  suggestion; choosing another monitor overrides it, and Auto-match stays. Nodes and services are on the new look.
- Settings, Nodes & Services: mark cron jobs as backups with a switch, instead
  of editing `backupJobs` in `display-config.json` by hand. A list already
  there shows as marked.

### Fixed
- Settings, Nodes & Services: a running container with no Uptime Kuma monitor
  no longer reads "monitored". The tag says "monitored" and names the monitor
  only when one is attached, "monitor paused" for a paused one, and "no
  monitor" otherwise.
