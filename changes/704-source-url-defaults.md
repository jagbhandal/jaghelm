### Breaking changes
- JagHelm no longer assumes Prometheus is at `http://localhost:9090` or Uptime
  Kuma at `http://localhost:3001`. Inside the container `localhost` is JagHelm
  itself, so those guesses only ever failed. If your `.env` has no
  `PROMETHEUS_URL`, add it now (and `KUMA_URL` if you run Uptime Kuma), then
  run `docker compose up -d`. This matters only for an install that relied on
  the guess, for example one on `network_mode: host` with Prometheus on the
  same machine.

### Changed
- With `PROMETHEUS_URL` unset, the board now says "Prometheus is not set. Set
  PROMETHEUS_URL in .env." instead of a connection refused, and JagHelm
  makes no request. A wrong address still reads "Prometheus unreachable".
  With `KUMA_URL` unset there is no Uptime Kuma, and no error.
- The docs now agree: node readings need Prometheus, while links,
  integrations and Uptime Kuma status work without it.
