### Added
- `/api/integrations` gives each integration a `_status`: `state` (`ok`,
  `backing_off` or `auth_failed`), `since` (when that state began),
  `failures` (failed attempts in a row) and `nextAttemptAt` (when it will be
  tried again; null when it is fetched every refresh, or waits for a settings
  change). Times are milliseconds since the epoch. The dashboard does not read
  it yet.
### Changed
- An integration that fails is no longer fetched every refresh. It is retried
  after 30 seconds, then 1, 2, 4 and 8 minutes, then every 10 minutes until it
  answers, and shows its last error in between. A failing integration no longer
  slows the refresh of the others while it waits.
### Fixed
- A wrong password or token is no longer sent every 30 seconds forever, which
  could get JagHelm's address banned by an app that bans after failed logins.
  An integration whose login is refused twice in a row (HTTP 401 or 403) is
  not retried until its settings change, and its card's error says how to
  retry it. For one added from the gallery, saving it in Settings, even
  unchanged, retries it at the next refresh. For one written in
  `services.yaml`, edit the file or restart JagHelm.
