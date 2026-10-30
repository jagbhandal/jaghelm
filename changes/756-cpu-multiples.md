### Added
- The Monitoring API's CPU chart now answers a cell per node, with the CPU
  warn line, the highest reading per step on 7 d and 30 d, and each node's I/O
  wait and temperature for a drill-down. `/api/history` can also serve a new
  series, `node.iowait`. The page itself stays hidden until its charts are in.
