### Added
- `JAGHELM_UPS_NAME` picks the UPS the UPS panel shows, by its name in NUT.
### Changed
- JagHelm checks its environment at start. A value that doesn't fit its
  variable (`LOG_LEVEL=trace`, `CSP_REPORT_ONLY=0`,
  `ARCANE_RELEASE_CHECK_HOURS=6h`) used to be ignored or misread without a
  word: now the log warns once, naming the variable and the default used
  instead, never the value. Only a `PORT` that isn't a port number, or a
  `JAGHELM_BLOCK_PRIVATE_NETWORKS` that isn't true or false, stops the start,
  with a line naming it: fix it in `.env` and start again.
- The Pipeline panel reads Gitea every 5 minutes instead of at every refresh,
  about a tenth of the requests. A failed read is tried again after 30
  seconds, then less often, and the panel keeps the last commits meanwhile,
  for up to 10 minutes after Gitea last answered.
- `env.example` now lists every variable JagHelm reads.
- `npm start` reads `.env` before anything else, so `LOG_LEVEL` and
  `JAGHELM_DATA_DIR` there now count. Docker installs are unchanged.
### Deprecated
- The unprefixed names of the integration and Gitea variables (`GITEA_URL`,
  `GITEA_TOKEN`, `NPM_URL`, `SONARR_API_KEY` and the rest) still work in this
  release, with one warning each in the log at start; a later release drops
  them and reads only the `JAGHELM_` names. Rename them in `.env`. When both
  names are set with different values, the `JAGHELM_` one is used.
### Fixed
- The integration variables now work under the `JAGHELM_` names the docs
  gave (`JAGHELM_NPM_URL`, `JAGHELM_SONARR_API_KEY`, …); only AdGuard's,
  Cloudflare's and PhotoPrism's did. The Pipeline panel's Gitea is
  `JAGHELM_GITEA_URL` and `JAGHELM_GITEA_TOKEN`.
- The Pipeline panel shows each repo's commits on its default branch, so a
  repo whose default branch isn't `main` no longer shows nothing.
- The UPS panel shows a UPS of any name. It read only one named `apcups`;
  with several, it shows the first by name that has a reading, unless
  `JAGHELM_UPS_NAME` names one.
