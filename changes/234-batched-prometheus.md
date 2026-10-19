### Added
- `/api/services` gives each container's network traffic as a rate:
  `docker.rxBytesPerSec` and `docker.txBytesPerSec`, bytes per second over the
  last 5 minutes. `docker.rxMB` and `docker.txMB` stay as they were, the
  cumulative total in MiB, until the old endpoints are retired.
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
  show one interface's total, whichever came last; for a container on the host
  network that was often a Docker bridge.
