### Fixed
- A node whose Prometheus target never gets its first scrape (a stuck scrape
  pool, a target that never resolves) no longer shows "No signal" forever with
  no alert. After 3 of the target's scrape intervals Prometheus shows as
  failing, naming the target, and sends one "Monitoring source down" alert and
  one recovery, also across a JagHelm restart. Only that node waits for
  Prometheus: a container that stops on another node still shows as
  missing, and a node or service you remove still goes.
- With a Prometheus-compatible backend that gets its series through
  federation or remote write (Thanos, Mimir, a federating Prometheus),
  losing every node's data alerts once that Prometheus is
  failing, not that every host is unreachable. The README lists the supported
  Prometheus setups.
