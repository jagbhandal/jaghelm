### Fixed
- A node reading that stops reporting while over its line, such as a sensor
  that was removed, no longer keeps its node at warning forever. After 24 hours
  with no reading, the warning leaves the board quietly, with no "back to
  normal" notification since nothing was read. The same goes for a Proxmox
  storage pool listed with no size. If the reading later comes back over its
  line, it alerts once, as new. The 24 hours count from the first missed
  reading, across restarts of JagHelm. A reading whose query or Proxmox read
  keeps failing is not cut off this way: it keeps its warning while the
  failure lasts, which the board shows as its own problem, and its "back to
  normal" is sent once it reads normal again.
