### Added
- The Monitoring page reads container restarts and OOM kills from Prometheus
  (cAdvisor) and draws them as an event strip, one row per container that had
  events, with a circle for a restart and a cross for an OOM kill. A missing
  reading is said as a gap, not as "no restarts".
