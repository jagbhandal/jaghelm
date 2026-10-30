### Added
- A Monitoring API, `GET /api/monitoring?range=`, serves the charts of the
  coming Monitoring page from Prometheus, with the same login as the history
  API. Each chart is read, cached and fails on its own. The page itself stays
  hidden until its charts are in.
