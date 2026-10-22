### Security
- A `services.yaml` that doesn't parse is no longer logged with the lines
  around the bad one, so a password or token written near it no longer
  reaches the log (and Loki). The log and Settings now say why it doesn't
  parse and where (line and column), without quoting the file. The same goes
  for a damaged `secrets.json`, `auth.json` or `display-config.json`.
