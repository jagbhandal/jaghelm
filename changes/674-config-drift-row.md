### Added
- The Overview and the phone's Overview show a "Config drift" row: green when
  every host that reports says its config matches the repo and the newest report
  is fresh, amber when a host reports drift or its check failed, or when no
  report has come in for a while ("Unknown", never green), and grey "No reports"
  until a host first sends one. Tap it for each host's drift items and how old its
  report is. A host that is switched off keeps its last report and is not an
  alert, and the row sends no alert. A timer on a host runs the drift check and
  pushes the result to `POST /api/drift/report`, with the same secret as the
  cron reports (`JAGHELM_CRON_SECRET`); without that secret the row is absent.
  JagHelm runs no check and holds no key. Settings → Nodes & Services → Config
  drift sets the hours before a silent row reads "Unknown" (default 36), and
  Appearance → Overview sections or Edit layout can hide or move the row.
