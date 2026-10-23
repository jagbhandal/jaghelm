### Added
- The panel a node or a container opens now has its history: a node's CPU,
  memory and disk on one chart and its temperature on another, a
  container's CPU and memory, over the last hour, 24 hours or 7 days, read
  from Prometheus. Point at a chart, or move along it with the arrow keys,
  to read every line's value at that time. When Prometheus doesn't answer,
  the chart says so instead of drawing an empty line.
- A chart with more than three lines draws the fourth to sixth dashed or
  dotted, and names every line at its end, so lines that cross stay apart
  for colour-blind eyes too.
### Changed
- The node cards' hour of CPU now comes from Prometheus, a point a minute,
  instead of JagHelm's own record of its refreshes.
### Removed
- JagHelm no longer keeps a record of node readings itself (`history.json`
  in the data folder). A `history.json` left by an older version is no
  longer read and can be deleted.
