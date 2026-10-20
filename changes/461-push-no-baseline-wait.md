### Fixed
- When JagHelm starts without its saved alert state (a first run, or a missing
  or damaged file), the phone gets its alerts from the first minute again. It
  used to send nothing until Prometheus and the UPS reading both answered, so
  a service going down or a job failing in that time was never sent, and if
  only the UPS reading kept failing, nothing was sent at all.
- Starting during a Prometheus outage without the saved alert state now sends
  the "Monitoring source down" alert after a minute, and one when Prometheus is
  back; the nodes then alert once if they are in trouble.
