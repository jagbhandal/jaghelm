### Added
- Settings → Sources, the first section, shows each monitoring source JagHelm
  reads: Prometheus, Uptime Kuma, NUT (the UPS) and Gitea, each answering,
  failed (with why, as the board says it) or off, and for how long; one not
  set up says which `.env` variable sets it. The cron reporters' row says how
  many jobs and backups report and how long ago the newest did; it is green
  only while they are all well, and otherwise says what is wrong ("Backups: 1
  failed"), with a link to where they are listed. While `services.yaml` can't
  be read, a row for it comes first, saying why, with a link to Nodes &
  Services. It follows the board's status as it updates and goes grey with it
  when that status is out of date. The sources are set in `.env`, not edited
  here. Settings' search and the command palette find it by a source's name
  ("prometheus", "kuma", "cron").
