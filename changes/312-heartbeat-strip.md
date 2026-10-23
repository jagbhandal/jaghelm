### Added
- Each service with an Uptime Kuma monitor shows its last checks as a
  heartbeat strip, like Kuma's: on its row on the Overview and the Services
  page (a column in the table view), and on a phone's Services rows. Failed
  checks show red and pending ones amber; point at a check to see when it
  ran and how long it took. A service without a monitor shows no strip.
- A service's panel shows its last 50 checks under "Heartbeats", with how
  often they come ("every 30 s"); on a phone its sheet shows the last 30.
  The arrow keys read each check.
- With Kuma's status page, the strips are Kuma's own checks and survive a
  restart. With `KUMA_API_KEY` set (Kuma's metrics), JagHelm records one
  check per refresh while it runs, so after a restart the strip fills over
  25 minutes at the default 30-second refresh.
