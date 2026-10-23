### Added
- JagHelm keeps a history of its alerts for 30 days (up to 1000), whether or
  not phone notifications are set up: each service going down or coming back,
  each reading over its line or back to normal, the UPS, jobs, backups and
  monitoring sources. Each says when, what it was about and why, and whether it
  went to your phones (to how many), was turned off in their settings, or
  wasn't sent. It survives restarts and updates. `GET /api/events` serves it,
  newest first, a page at a time, filtered by what it is about or by severity;
  the web and Android Alerts pages show it.

### Changed
- Without phone notifications set up, JagHelm now writes
  `data/push-snapshot.json` too: it holds the history and the last state it is
  compared against. Turning notifications back on still sends what changed
  since your phones were last told, never a stale alert.
- A `data/push-snapshot.json` that can't be read is kept as
  `push-snapshot.json.corrupt-<time>` (the newest one only) instead of being
  written over, and the log says how many alerts it held.
