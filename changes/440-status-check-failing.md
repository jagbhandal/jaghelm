### Fixed
- When JagHelm can't work out the status (an input its status check can't
  read), push no longer goes silent without telling anyone. After two checks
  in a row it sends one "JagHelm status check failing" alert, at high priority
  and whatever your category switches say, and one "JagHelm status check
  recovered" when it works again, along with anything that changed meanwhile.
  A single failed check sends nothing, and a restart while it fails doesn't
  send the alert twice. `/api/health` now has a `statusModel` field that says
  `degraded` while this lasts, with the kind of error and since when.
