### Added
- A Services page and an Infrastructure page, in the sidebar under Overview
  and in the command palette: every service, or every node, as the
  Overview's sections show them. Search them (a service by its name, node,
  custom group or container; a node by its name or role) and filter them by
  state (problems, up or healthy, maintenance, no signal), by node or by
  role. The filters are in the page's address, so the browser's Back undoes
  one and a link opens the page filtered. Services show as a list, grouped
  by node or custom group, or as a table; nodes as cards or a table. Each
  service or node opens its panel, as on the Overview.
- The Infrastructure page lists each Proxmox node's virtual machines and
  storage pools under the nodes, as the node's panel does.
- The Overview's Services section ends with "Show all 12 services", which
  opens the Services page.

### Changed
- On a phone, the Services search also finds a service by its node or its
  container, as the Services page does, and ignores spaces before or after
  what you type.

### Fixed
- Turning a phone or resizing a window past 768px on Services or
  Infrastructure stays on that page, with its search and filters, instead of
  jumping to the Overview.
