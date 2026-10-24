### Fixed
- A Kuma monitor with no container, such as `cadvisor-pi1`, is now shown on its
  own node instead of on the first one. JagHelm picks the node from the address
  the monitor checks, then from its name, and Settings, Nodes & Services has a
  Node choice, a display name and an icon on these rows. Expect NAS (Ping) and
  NAS UI to move from Staging to the NAS, and cadvisor-pi1, cadvisor-pi2 and
  cadvisor-vm103 to their own nodes; Proxmox UI moves only if the Proxmox node's
  display name has the word Proxmox. Custom groups follow a moved monitor. The
  node setting is keyed by monitor name, so renaming a monitor in Uptime Kuma
  drops it (the log warns once).
