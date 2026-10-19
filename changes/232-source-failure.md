### Fixed
- A Prometheus restart, reload or timeout no longer sends a "Host unreachable"
  push for every host, followed by a "Host recovered" for each when Prometheus
  answers again. Uptime Kuma being unreachable for more than 5 minutes no longer
  sends a "Service recovered" for each service it had down, then "Service down"
  again when it is back. While either fails, push alerts keep the last known
  state of the hosts and services it watches, and Kuma keeps alerting about
  services through a Prometheus outage. A UPS that goes on battery while
  Prometheus is failing is still alerted once Prometheus answers.
- Only what a failed Prometheus query reads is held: one query that keeps
  failing on one host (a temperature or container query, say) no longer holds
  back a "Host unreachable" for another host, or that host's other readings.
- A Prometheus that has just started and not scraped anything yet no longer
  reads as every host being unreachable.
- Nothing is re-sent after JagHelm restarts, or after its refresh fails for more
  than 2 minutes: hosts are no longer reported recovered, nor services down
  again, on the next good refresh.
- JagHelm starting while Prometheus is down no longer sends a "Host recovered"
  for every host when Prometheus comes back.
- A host is now reported unreachable as soon as Prometheus can no longer scrape
  it (`up` is 0 for every target with its `node` label), instead of minutes later
  when its CPU reading runs out.
- While Prometheus fails, the dashboard no longer turns containers that are
  still running into grey "last seen" cards.
- A Prometheus or Uptime Kuma outage is now logged once: one warning when it
  starts failing, with the error, and one info line when it answers again. Kuma
  being unreachable used to log an error every refresh.
