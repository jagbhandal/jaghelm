### Added
- The Overview has an Infrastructure section above the board: a card for each
  node with its CPU, memory, disk and temperature meters, how many of its
  services are up or down, its uptime and its CPU over the last hour. A meter
  stays the accent colour and turns amber or red only at or over its warning
  or critical line, the same lines the status uses, and shows the same
  number as the status reason. A node with no signal says so and shows no
  numbers. A node's colour shows as a small swatch beside its name. Switch to
  a table with Cards / Table; this browser remembers the choice. An issue for
  a node in the panel above leads to its card, and the Nodes filter keeps the
  section.

### Changed
- The node panels on the board no longer show their own CPU, memory,
  temperature, disk and uptime tiles, which turned amber at 70 % while the
  status warns at 90 %. Those readings are in the Infrastructure section now;
  the panels keep their services and Proxmox lists. A board laid out before
  keeps each panel's saved height, so drag a panel's corner to shrink it.
