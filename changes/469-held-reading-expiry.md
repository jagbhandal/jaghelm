### Fixed
- A node reading that stops reporting while over its line, such as a sensor
  that was removed, no longer keeps its node at warning forever. After 24 hours
  with no reading, the warning leaves the board quietly, with no "back to
  normal" notification since nothing was read. The same goes for a Proxmox
  storage pool whose read keeps failing. If the reading later comes back over
  its line, it alerts once, as new. The 24 hours count from the first missed
  reading, across restarts of JagHelm.
