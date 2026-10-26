### Added
- Quiet hours now have a time zone picker (Settings, Notifications, Alert rules).
  The status line shows the current time in the zone you chose and the hours in
  that zone, and "Use this device's zone" sets it in one click. A new install
  uses the server's own time zone (the container's `TZ`, UTC if unset). An
  install that already saved alert rules keeps America/Toronto until you pick
  another, so nothing changes on upgrade. A save naming a zone that is not a
  real time zone is refused.
  The first save pins the zone, so changing `TZ` later does not move quiet hours.
