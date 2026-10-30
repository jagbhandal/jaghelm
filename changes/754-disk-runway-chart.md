### Added
- The Monitoring API now serves a Disk runway chart: each node's days until
  its disk is full, soonest first, from the same forecast as the node cards.
  A node that is off, a disk that fills too irregularly, or one without enough
  history says so in words instead of a number. `/api/disk-forecast` also
  gives each node's disk size and used bytes. The page itself stays hidden
  until its charts are in.
