### Fixed
- Healthy checks in the heartbeat strips are green, as in Uptime Kuma, with
  rounded pill bars. Maintenance stays faint.
- With a Kuma API key set, the strips show Kuma's own recent history right
  after a restart instead of empty rings. A monitor that isn't on Kuma's status
  page keeps the strip JagHelm samples itself.
- With a Kuma API key set, a service that just went down or came back shows it in
  the strip at once, without waiting for Kuma's own history to catch up.
