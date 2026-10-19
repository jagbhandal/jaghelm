### Fixed
- A Prometheus restart, reload or timeout no longer sends a "Host unreachable"
  push for every host, followed by a "Host recovered" for each when Prometheus
  answers again. Uptime Kuma being unreachable for more than 5 minutes no longer
  sends a "Service recovered" for each service it had down, then "Service down"
  again when it is back. While either fails, push alerts keep the last known
  state of the hosts and services it watches, and Kuma keeps alerting about
  services through a Prometheus outage. A UPS that goes on battery while
  Prometheus is failing is still alerted once Prometheus answers.
- A host is now reported unreachable as soon as Prometheus can no longer scrape
  it (`up` is 0 for every target with its `node` label), instead of minutes later
  when its CPU reading runs out.
- While Prometheus fails, the dashboard no longer turns containers that are
  still running into grey "last seen" cards.
- A Prometheus outage is now logged: one warning when its queries start failing,
  with the error, and one info line when they succeed again.
