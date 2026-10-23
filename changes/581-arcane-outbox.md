### Added
- Arcane's notifications are in the alert history (`GET /api/events`) with
  JagHelm's own: each update run, held-back or caught-up update, agent going
  offline or reconnecting, Arcane release and weekly vulnerability digest, and
  whether it went to your phones. They are recorded with phone notifications
  off too.

### Changed
- JagHelm keeps its Arcane state in `data/push-snapshot.json`. The first start
  after this update reads `arcane-state.json`, `arcane-held-back.json` and
  `arcane-vuln-state.json` once, so nothing is announced again, and leaves them
  in place for a rollback; you can delete them once you won't roll back.

### Fixed
- When the server can't reach Google, Arcane polling and the weekly
  vulnerability digest no longer stall, and an Arcane notification is no
  longer lost. They wait with JagHelm's other notifications and go out in
  order once Google answers, also after a restart. A restart or crash no
  longer drops one, nor makes Arcane news found before it be announced again.
  An agent that disconnects and reconnects before either notification went
  out sends neither.
