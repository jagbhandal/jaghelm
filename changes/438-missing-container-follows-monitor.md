### Fixed
- A container that stopped, and was the last one a Kuma monitor ran on, no
  longer shows as critical while that monitor is up, such as the old name of a
  container redeployed under a new one. It is a warning, like any other
  missing container, and its reason says the monitor is up. While the monitor
  is pending it shows "No signal", and while it is in maintenance it shows
  "Maintenance". While the monitor is down, the board has one critical issue
  for the outage, the monitor's, not a second one for the container.
- An outage whose monitor's container was stopped under another name now
  pages. When a monitor went down after its container stopped, and the
  container no longer matched the monitor by name (its `services.yaml` mapping
  removed), the board showed it twice and no alert was sent, nor its recovery.
- A container whose Kuma monitor is paused no longer leaves the board when it
  stops, and is no longer described by that monitor's last state: it is a
  missing container like any other. This applies to Uptime Kuma versions read
  through the status page, which still list paused monitors.
