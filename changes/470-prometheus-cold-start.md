### Fixed
- JagHelm starting while Prometheus has just started and not collected
  anything yet (both coming up after a host reboot) no longer alerts that
  every node is unreachable and then that each one recovered. Each node shows
  "No signal" with the reason "not scraped by Prometheus yet" until
  Prometheus has read it. A node Prometheus doesn't monitor at all still sends
  its "Host unreachable" alert, once.
- When a node has no reachability data, JagHelm now also reads Prometheus's
  list of targets. A proxy in front of Prometheus that blocks that list makes
  Prometheus show as failing, with the reason, instead of the node alerting.
