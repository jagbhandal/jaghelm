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
  app or Quick Launch link of exactly the same name), to Grafana and Uptime
  Kuma (your apps or links of those names), and to where it is set up in
  Settings. Something on more than one node (a Proxmox host, a container on
  every node) links only to an app or link that names its node, such as
  "Proxmox pve2"; two links of one name to different places give none.
- A Proxmox backup still running says so. While JagHelm can't be reached,
  the panel's details are greyed and say how old they are.
- A state that changed in the last minute says "just now", not "for 0 s".
- The panel fetches these details only while it is open, and refreshes them
  with the status, reusing what the page has just fetched. If a read fails,
  it keeps the last details and says they aren't updating.
