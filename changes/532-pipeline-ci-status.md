### Added
- The Pipeline panel shows each commit's CI result from Gitea Actions, as the
  design has it: "repo · CI Passed" (or Failed, Running, Cancelled…) beside a
  lamp, over the branch and short SHA, with the commit's message in the
  row's tooltip. A long branch name is shortened, never the SHA. Rows come
  from push runs; pull-request and scheduled runs don't show. A repo without
  Actions shows its commits as before, with no lamp. Gitea is still read
  every 5 minutes, with smaller requests than before.

### Changed
- From 1440px the Overview loads its side rail (Quick Launch, Pipeline, the
  Checklist, weather and the clock) on its own, so a phone's first load is
  about 4 kB smaller.
