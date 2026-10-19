### Added
- `/api/services` gives each container's network traffic as a rate:
  `docker.rxBytesPerSec` and `docker.txBytesPerSec`, bytes per second over the
  last 5 minutes. `docker.rxMB` and `docker.txMB` stay as they were, the
  cumulative total in MiB, until the old endpoints are retired. A rate reads
  high for up to 5 minutes after a container is recreated.
### Changed
- JagHelm now asks Prometheus 14 queries per refresh instead of 90 with six
  hosts, and the number no longer grows with each host added: each reading is
  one query for every host. A host without a `/` filesystem, such as a NAS, is
  no longer asked for one every refresh before its largest filesystem is read.
### Fixed
- A host's temperature is now its hottest sensor. It used to be whichever sensor
  Prometheus listed first, which on a host with several (CPU, NVMe, network
  card) was not the one that matters.
- A container's memory now leaves out page cache the kernel can reclaim
  (cAdvisor's working set), so it no longer reads high for containers that
  read or write a lot of files.
- A container's network RX and TX now count all of its own interfaces, and
  leave out Docker bridges, VPN tunnels and VLAN subinterfaces. They used to
  show the counter of one interface, the alphabetically last, so a container on
  several Docker networks showed only one of them.
- A container on the host network now shows "—" for RX and TX, and
  `/api/services` gives it `docker.networkMode: "host"` with all four RX/TX
  fields null. It has no traffic of its own: cAdvisor reports the host's
  interfaces for it, so each such container would show the host's traffic. Its
  RX and TX used to read 0 MB: the counter of tailscale0, the alphabetically
  last of the host's interfaces, which cAdvisor reports as 0.
