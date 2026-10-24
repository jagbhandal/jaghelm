### Fixed
- Settings, Nodes & Services: a container that runs on two nodes, such as
  `gateway-npm` on both Pis, now gets its display name and icon per node.
  Renaming it on one node no longer reverts to the other node's name. A name
  or icon you had set for the container is kept on every node until you change
  one; Remove all overrides clears them all.
