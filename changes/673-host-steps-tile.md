### Added
- The Overview and the phone's Overview show "Pending host steps" with how many
  are open and a link out to each one in Gitea, read from the running list in
  homelab-infra issue #848. It appears only when Gitea is set up and at least one
  step is open, and if the list can't be read it is one quiet "See #848" link.
  Read-only; it sends no alert. It uses the Gitea address and token the Pipeline
  panel already has, which must be able to read that repo's issues. Settings →
  Appearance → Overview sections and Edit layout can hide or move it.
