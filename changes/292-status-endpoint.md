### Added
- `GET /api/status` serves the server's view of everything JagHelm watches:
  one overall sentence, the ranked list of issues, a summary per area
  (Services, Nodes, Power, Jobs, Backups, Integrations), every service, node,
  UPS, job and integration with its state and the reason for it, and whether
  Prometheus, Uptime Kuma and the NUT exporter are answering. It sends an ETag
  and answers 304 while nothing has changed. It sits beside `/api/services`,
  `/api/ups` and `/api/cron/status`, which keep their shape and meaning, so
  installed Android apps keep working.
- When Prometheus, Uptime Kuma or the NUT exporter stops answering for two
  refreshes in a row (about a minute), one "Monitoring source down" push says
  so, and one "Monitoring source recovered" push follows when it answers again.
  Nothing it watches sends a push while it is down. It follows the Hosts,
  Services or UPS notification toggle respectively.
### Changed
- Push notifications now say what the dashboard says: the text names the
  service, host, UPS or job and gives the same reason the dashboard shows, for
  example "Gitea on vm103 · Kuma: down" or "pve · Disk 94 % (warning above
  90 %)". Titles are as before, except host readings, which now read "Host CPU
  high", "Host memory high", "Host disk critical" and so on.
- Host alerts follow the dashboard's thresholds: a host's temperature (from
  75 °C, critical from 85 °C) and its Proxmox storage pools now send alerts too,
  a disk or pool reaching 95 % sends a second, critical alert, and a CPU alert
  waits until CPU has been over 90 % for two refreshes in a row.
- A service that Uptime Kuma reports as pending or in maintenance keeps its last
  state for push: a service that goes down, pending, then up now sends its
  "Service recovered", and one that goes down, pending, then down again no
  longer sends a second "Service down".
- A Kuma monitor that `services.yaml` maps to a container running on several
  hosts now sends one "Service down" and one "Service recovered" per outage,
  naming every host, instead of one per container.
### Fixed
- A host reading that drifts back down through the 5-point band below its alert
  line now sends "back to normal" once it is below the band, and one that dips
  into the band and rises again no longer sends a second alert. This holds
  across a restart of JagHelm.
- A Kuma monitor mapped to containers on several hosts no longer leaves a
  "Service down" without its "Service recovered" when one of those containers
  stops during the outage, and no longer repeats "Service down" when it comes
  back.
