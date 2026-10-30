### Added
- `GET /api/history` accepts `range=30d` (a point every 2 hours, 361 points,
  as far back as Prometheus keeps). On `7d` and `30d`, `max=1` adds a
  `maxLines` list to each series, the highest reading in each step instead of
  its average, so a spike does not vanish; `1h` and `24h` ignore it.
