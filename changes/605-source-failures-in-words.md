### Changed
- A monitoring source that stops answering now says why in plain words, one
  sentence per cause: "Prometheus refused the connection", "Prometheus didn't
  answer in time", "Prometheus's address didn't resolve", "Kuma's TLS
  connection failed", "Kuma refused the credentials", "Prometheus answered with
  an error (HTTP 503)" and so on. The issue on the board, the push
  notification, the Alerts history and the history charts all use the same
  words; before, they could show the raw error, such as "connect
  ECONNREFUSED". Gitea's source says why too, where it said only that its
  refresh failed. Alerts already in the history keep the words they were
  recorded with.
- An integration that fails says why the same way ("sonarr refused the
  connection", "plex didn't answer in time") instead of the raw fetch error,
  which could name hosts and addresses.
- When Prometheus has a problem with a node while it answers, the board names
  the node as `services.yaml` does ("Prometheus hasn't scraped VM 103 in 3
  scrape intervals"); the targets' addresses go to the server log.
- The server log records the full error once when a source starts failing,
  and again when it fails for another reason, instead of only the first
  time.
