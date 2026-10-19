### Fixed
- An Uptime Kuma monitor that no container has (a ping of the NAS or a switch,
  or a check of a web UI on another machine) now sends a "Service recovered"
  push when it comes back up, for the same service as its "Service down" push.
  It used to send only the "Service down". The board is unchanged: such a
  monitor still shows a card only while it is down. A paused monitor, or one
  deleted from Kuma, sends nothing.
- A monitor that comes back up while its stopped container still shows a grey
  card now sends its "Service recovered" push too, and one that comes back up
  while Prometheus is failing sends it right away instead of once Prometheus
  answers again.
