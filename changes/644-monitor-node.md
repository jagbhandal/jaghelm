### Fixed
- A Kuma monitor with no container, such as `cadvisor-pi1`, is now shown on its
  own node instead of on the first one. JagHelm picks the node from the address
  the monitor checks, then from its name, and Settings, Nodes & Services has a
  Node choice on these rows to set it yourself.
