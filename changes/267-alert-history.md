### Added
- JagHelm keeps a history of its alerts for 30 days (up to 1000), whether or
  not phone notifications are set up: each service going down or coming back,
  each reading over its line or back to normal, the UPS, jobs, backups and
  monitoring sources. Each says when, what it was about and why, and whether it
  went to your phones (to how many), was turned off in their settings, or
  wasn't sent. It survives restarts and updates. `GET /api/events` serves it,
  newest first, a page at a time, filtered by what it is about or by severity;
  the web and Android Alerts pages will show it in a later release.

### Changed
- Without phone notifications set up, JagHelm now writes
  `data/push-snapshot.json` too: it holds the history and the last state it is
  compared against.
