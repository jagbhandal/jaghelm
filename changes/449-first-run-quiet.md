### Fixed
- On a new install with nothing set up yet, the header and the Alerts page say
  "Nothing monitored yet" as a quiet line, instead of a grey "No signal" alarm
  about nothing being wrong.
- A new install that can't reach Prometheus (a wrong `PROMETHEUS_URL`) says
  "Prometheus unreachable" in the header, not that nothing is monitored.
