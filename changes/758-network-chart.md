### Added
- The Monitoring page gains a Network chart: each node's traffic in and out in
  bytes per second as a mirrored area, real network interfaces only (loopback,
  bridges, veths, VPN tunnels and VLAN subinterfaces are left out).
  `GET /api/history` accepts `node.net.rx` and `node.net.tx`.
