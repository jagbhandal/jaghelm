### Fixed
- A Proxmox storage pool over its line no longer sends a false "back to normal"
  and a second alert when the Proxmox integration fails for a while: 93 %, a
  failed fetch, 88 % and 93 % again is one alert. While the fetch fails, the node
  keeps its warning, and its reason says the pool has no reading instead of
  showing a number. This holds across a restart of JagHelm.
- A pool that Proxmox lists with no size, such as inactive storage, is no
  longer read as 0 %, so it never ends a warning.
- A pool over its line that Proxmox no longer lists now sends one "back to
  normal" and leaves the node's warning, once a fetch succeeds without it. So
  does a pool whose Proxmox integration is removed, disabled or pointed at
  another node.
