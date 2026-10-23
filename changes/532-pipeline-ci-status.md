### Added
- The Pipeline panel shows each commit's CI result from Gitea Actions: a lamp
  (green when it passed, red when it failed, a ring while it runs or when it
  was cancelled or skipped), with its branch and short SHA beside the repo. A
  long branch name is shortened, never the SHA. A repo without Actions shows
  its commits as before, with no lamp. Gitea is still read every 5 minutes.

### Changed
- From 1440px the Overview loads its side rail (Quick Launch, Pipeline, the
  Checklist, weather and the clock) on its own, so a phone's first load is
  about 4 kB smaller.
