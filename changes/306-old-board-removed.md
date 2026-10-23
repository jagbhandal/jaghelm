### Added
- The Overview has a Power section under Infrastructure: the UPS, on mains
  or on battery, with its charge, and on battery the minutes it has left. Its
  row opens the UPS's panel with the charge, load, model and runtime, on
  mains too, where it has no alert to open it from. The Power tile of the
  strip shows it alone, and Settings → Appearance → Overview sections can
  hide it.

### Changed
- A fresh install with no node yet says "Waiting for your first node" (or
  "Connect your first node", with Open Settings) where the nodes will be,
  in the new look.
- A strip filter with nothing to show, such as Integrations, or one whose
  section is switched off, says why, with Show everything.
- Settings draws in Manrope, the app's own face, by default: the Default
  typography preset is Manrope and JetBrains Mono.
- Settings → Sections keeps a switch each for Quick Launch, Pipeline and the
  Checklist, the panels beside the Overview from 1440px wide.
- The Overview asks the server for less: at most four requests per refresh,
  the Pipeline's included, and none while the tab is hidden.

### Removed
- The old grid board under the Overview's sections is gone, with its drag,
  resize and saved layout, and Settings → Layout's grid columns,
  Auto-arrange, Reset and Collapsible sections. Everything it showed has a
  home: the nodes in Infrastructure and their Proxmox VMs, storage pools and
  last backup in each node's panel; the UPS in Power; Scheduled Jobs in the
  Jobs section and each job's panel; Quick Launch, Pipeline and the
  Checklist beside the Overview from 1440px wide and on the Launch page.
  Arranging the Overview comes back as an Edit layout mode.
- Settings → Sections' titles, subtitles, icons and colours for the old
  board's panels, and its UPS switch; Settings → Widgets' "Show scheduled
  jobs panel"; and the Settings live preview, which showed the old board.
  The Power and Jobs sections' switches are in Appearance → Overview
  sections.
- A node's icon (Settings → Nodes) no longer shows: the Overview's node
  cards carry its colour.
