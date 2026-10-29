### Added
- Drive health. Where Prometheus scrapes `smartctl_exporter`, each node judges
  its drives (SATA and NVMe) on the server. A drive that failed its health
  check, reports an NVMe critical warning or is logging growing media errors is
  critical; one whose reallocated, pending or offline-uncorrectable sector
  count grew in the last 7 days, or whose NVMe spare is at or below its
  threshold, is a warning. The node is no longer green while a drive is, and
  its reason names the drive ("drive sdb failed its health check").
- Each drive alerts on its own, as "sdb on nas", so a second failing drive is
  pushed separately and one drive's recovery does not hide another's. Alerts
  appear on the Alerts page and in its history like any other host alert.
- Drive temperatures have their own warning and critical lines, by kind (NVMe
  70 and 80 °C, SATA 55 and 60 °C), saved with the other thresholds as
  `nvmeTemp` and `sataTemp`. A `thresholds.json` saved without them uses these
  defaults.
- A node that had drive data and no longer has any, or whose `smartctl_exporter`
  scrape is down or cannot read a drive, raises one "Drive monitoring has no
  signal" alert in the no-signal state. It does not turn the node amber.
- Drive health is optional. It is active only where Prometheus holds
  `smartctl_devices`, and `JAGHELM_DRIVES=off` turns it off even then. An
  install without the series is unchanged. The demo board shows an NVMe and
  three drives, one of them remapping sectors.
