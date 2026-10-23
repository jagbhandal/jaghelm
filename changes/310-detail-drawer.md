### Added
- The panel a row opens now has everything about that thing, on a computer
  and on a phone:
  - a node: its CPU, memory, disk and temperature meters, uptime, and memory
    and disk in GB; on a Proxmox host, its virtual machines, its storage
    pools (coloured by the same disk thresholds as a node's disk) and its
    last backup;
  - a service: its latency and 24-hour uptime, its container's CPU, memory
    and network traffic, and the numbers from its integration (or why the
    integration couldn't be read);
  - the UPS: charge, runtime (left on battery, or at this load on mains),
    load and model;
  - an integration: its numbers, or why it couldn't be read.
- On a computer the panel links to the thing (Open, using your own embedded
  app or Quick Launch link of the same name), to Grafana and Uptime Kuma (your
  apps or links of those names), and to where it is set up in Settings.
- The panel fetches these details only while it is open, and refreshes them
  with the status. If a read fails, it keeps the last details and says they
  aren't updating.
