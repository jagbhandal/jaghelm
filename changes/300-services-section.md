### Added
- The Overview has a Services section under Infrastructure: every service in
  one list, grouped by node, one line each with its status, its name, its
  ping latency and one number from its app integration. A service that is
  down or not answering says why instead, in its status colour; healthy ones
  stay quiet. A Node / Group switch groups the list by the custom groups of
  Settings → Sections, the node beside each name; until there is one, Group
  is greyed out with a link there. This browser remembers the choice. On a
  phone each row reads its number and latency under the name. An issue for a service in the panel above
  leads to its row, and the Services filter shows the section alone. When
  JagHelm loses its signal, every row turns grey and the section says how old
  its numbers are.

### Changed
- The board no longer has service cards: the Services section lists the
  services, so the node panels keep only their Proxmox lists, and custom
  groups are a way to group that list instead of panels of their own. Service
  cards can no longer be dragged between panels; choose a group's services in
  Settings → Sections. Per-container CPU, memory and network numbers are no
  longer on the Overview, and Settings → Layout no longer has the service
  cards' options.
