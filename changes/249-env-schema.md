### Breaking changes
- **JagHelm checks its environment at start, and doesn't start on a value
  that doesn't fit its variable** (a `PORT` that isn't a port number,
  `LOG_LEVEL=verbose`, `CSP_REPORT_ONLY=yes`, a negative
  `JAGHELM_ICON_CACHE_MAX_MB`). Such a value used to be ignored without a
  word. The log names the variable and what it must be, never the value: fix
  it in `.env` and start again. An empty `NAME=` line still counts as unset.
### Added
- `JAGHELM_UPS_NAME` picks the UPS the UPS panel shows, by its name in NUT.
### Changed
- The Pipeline panel reads Gitea every 5 minutes instead of at every refresh,
  about a tenth of the requests. A failed read shows until the next one.
- `env.example` now lists every variable JagHelm reads.
### Deprecated
- The unprefixed names of the integration and Gitea variables (`GITEA_URL`,
  `GITEA_TOKEN`, `NPM_URL`, `SONARR_API_KEY` and the rest) still work in this
  release, with one warning each in the log at start; the next release reads
  only the `JAGHELM_` names. Rename them in `.env`. When both names are set
  with different values, the `JAGHELM_` one is used.
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
