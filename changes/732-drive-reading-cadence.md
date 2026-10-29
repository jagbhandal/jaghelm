### Added
- The Drives block says how often drive readings refresh. Declare the
  exporter's interval as an optional `reading_interval` label (`10m`, `1h`) on
  the smartctl scrape target in `prometheus.yml`, equal to
  `--smartctl.interval`. The footnote then reads "Readings refresh about every
  hour, on their own schedule, not with this page", plus the sleeping-drive
  sentence on a node with drives that may sleep. Without the label the block
  is unchanged. No "last read" time is shown: the exporter has none.
