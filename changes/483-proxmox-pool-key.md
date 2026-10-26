### Fixed
- In a Proxmox cluster, same-named storage pools on different nodes (such as `local-lvm`) are no longer merged into one pool, which could hide a full pool behind a healthy one. Only the monitored node's pools are shown, and a shared storage appears once.
