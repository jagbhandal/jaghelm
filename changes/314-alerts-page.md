### Added
- The Alerts page shows what happened as well as what is wrong now. Under the
  active issues, History lists every alert change of the last 30 days, newest
  first and grouped by day: when it happened, what it was about, the change
  (such as "Down → Up"), why, and whether it reached the phones ("Sent to 2
  phones", "Push not set up"). It works whether or not push notifications are
  set up. A row opens its entity, and one JagHelm no longer watches says so.
- Filter the Alerts page by severity (critical, warning, info), by kind
  (services, nodes, power, jobs, backups, integrations, monitoring sources)
  and by a search. The filters are in the page's address, so Back undoes one
  and a link opens the page filtered. `GET /api/events` takes the new `kind`
  and `q` filters.
