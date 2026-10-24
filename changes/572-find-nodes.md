### Added
- Settings, Nodes & Services: a Find nodes button asks Prometheus for its nodes now and
  adds the ones your services.yaml doesn't have. Before, a services.yaml saved
  with no nodes (a Settings change made while the first start was still
  waiting for Prometheus) could only be fixed by editing the file. It never
  removes or changes a node you have, and it says so when Prometheus can't be
  reached or has nothing new.
