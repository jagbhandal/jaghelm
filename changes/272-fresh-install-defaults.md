### Changed
- The UPS and Pipeline panels show only once their source is set up: the UPS
  panel once the NUT exporter reports a UPS, the Pipeline panel once Gitea
  answers. A fresh install without them no longer shows a UPS panel reading
  "Unknown" or a Pipeline panel reading "Gitea unreachable". A board that
  already has either panel in its saved layout keeps it, and a panel that has
  shown keeps showing, with its down state, when its source fails. Switching a
  panel off in Settings → Sections still hides it, and switching it on there
  shows it before its source reports.
- The UPS panel's subtitle defaults to "Battery backup", and the dashboard
  title to "JAGHELM" when it is left empty. Set your own in Settings → Sections
  and Settings → General.
### Fixed
- A fresh install shows the "Connect your first node" screen instead of three
  panels stuck on "Loading gateway…", "Loading production…" and "Loading
  staging…" for nodes it does not have. A saved layout that names those nodes
  is unchanged.
- On a phone-width browser, a board without a saved phone layout lists every
  node right after Quick Launch, in its desktop order. Nodes not named pi1,
  pi2, vm103, vm101, pve or nas used to come last.
