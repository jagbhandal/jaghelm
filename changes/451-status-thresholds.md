### Added
- `/api/status` now also says which lines it judged by (`thresholds`): the
  defaults, or the ones set under `pushThresholds` in `display-config.json`.
  The new Overview's meters draw their warning and critical lines from it, so
  a meter turns amber or red exactly where the server's status and push
  notifications do.
