### Fixed
- A container that stopped, and was the last one a Kuma monitor ran on, no
  longer shows as critical while that monitor is up, such as the old name of a
  container redeployed under a new one. It is a warning, like any other
  missing container, and its reason says the monitor is up. While the monitor
  is pending it shows "No signal", and while it is in maintenance it shows
  "Maintenance". While the monitor is down, the board has one critical issue
  for the outage, the monitor's, not a second one for the container.
