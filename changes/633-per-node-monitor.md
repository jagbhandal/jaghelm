### Fixed
- Settings, Nodes & Services: a container that runs on two nodes, such as
  `gateway-npm` on both Pis, now gets its Uptime Kuma monitor per node.
  Choosing a monitor for one node no longer changes the other, and Auto-match
  clears only that node. Display name and icon still apply to every node.
