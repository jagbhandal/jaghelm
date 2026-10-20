### Added
- DEMO_SCENARIO=healthy serves the demo board with nothing down. The default,
  incident, has one service down and a failed backup job.
### Changed
- A board without a saved layout lays itself out from the nodes it finds: the
  nodes first, up to three side by side, then UPS beside Pipeline, Scheduled
  Jobs beside the Checklist, then Quick Launch. The nodes used to stack full
  width below the other panels. A saved layout is unchanged.
- A first boot names each discovered node by its Prometheus label. The labels
  pi1, pi2, vm103 and vm101 used to get the names "Gateway Primary", "Gateway
  Secondary", "Production" and "Staging". An existing services.yaml is
  unchanged.
- The startup "listening" log line gives the port bound, so PORT=0 shows the
  one picked.
### Fixed
- The read-only demo (DEMO_MODE=true) shows a populated board: three nodes
  with their services, the UPS, Pipeline, Scheduled Jobs and Checklist panels,
  Quick Launch links with their icons, and "Service Disruption" while its demo
  service is down. It showed nodes with no services, panels stuck on
  "Loading…", a green status and a "Couldn't save settings" error.
- The demo makes no outbound request and writes no file. It no longer runs
  node discovery or the refresh loop's Prometheus, Kuma, UPS and Gitea polls,
  and no longer writes services.yaml or makes its data directory at startup.
- A panel switched off in Settings no longer leaves an empty space at the
  bottom of the board.
