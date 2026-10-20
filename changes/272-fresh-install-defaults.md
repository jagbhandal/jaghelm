### Changed
- The UPS and Pipeline panels show only when their source is set up. The UPS
  panel shows when Prometheus has the UPS from the NUT exporter, and stays,
  reading "Unknown", while the exporter has been quiet for up to 7 days. The
  Pipeline panel shows when GITEA_URL is set, with a banner while Gitea is
  unreachable. A fresh install without them no longer shows a UPS panel
  reading "Unknown" or a Pipeline panel reading "Gitea unreachable", and an
  existing board drops either panel when its source is not set up, even if
  its saved layout has it. Switching a panel off in Settings → Sections still
  hides it.
- Set GITEA_URL to keep the Pipeline panel. JagHelm no longer falls back to
  http://localhost:3060 when it is unset: it polls no Gitea, shows no Pipeline
  panel and logs "Gitea panel off: GITEA_URL is not set" once at startup.
- The UPS panel's subtitle defaults to the UPS model the NUT exporter reports,
  or "Battery backup" without one, and the dashboard title to "JAGHELM" when
  it is left empty. Set your own in Settings → Sections and Settings → General.
### Fixed
- A fresh install shows the "Connect your first node" screen instead of three
  panels stuck on "Loading gateway…", "Loading production…" and "Loading
  staging…" for nodes it does not have. A saved layout that names those nodes
  is unchanged.
- On a phone-width browser, a board without a saved phone layout lists every
  node right after Quick Launch, in its desktop order. Nodes not named pi1,
  pi2, vm103, vm101, pve or nas used to come last.
- Screen readers no longer hear outages of a source whose panel is not on the
  dashboard.
