### Fixed
- JagHelm starting while Prometheus has just started and not collected
  anything yet (both coming up after a host reboot) no longer alerts that
  every node is unreachable and then that each one recovered. That includes a
  node Prometheus has read only in part, such as one whose container
  collector it reached before that was listening. Each such node shows "No
  signal" with the reason "not scraped by Prometheus yet" until Prometheus has
  read it. A node Prometheus doesn't monitor at all still sends its "Host
  unreachable" alert, once, and a node that is really down sends it at most
  one Prometheus scrape later than before.
- Prometheus collecting but storing nothing (its disk full) alerts once that
  Prometheus is failing, naming the nodes, and not that every node is
  unreachable, even right after JagHelm restarts.
- When a node has no reachability data, or reads as down, JagHelm now also
  reads Prometheus's list of targets. A proxy in front of Prometheus that
  blocks that list makes Prometheus show as failing, with the reason, instead
  of a node with no data alerting; a node Prometheus reads as down still
  alerts.
