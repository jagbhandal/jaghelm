### Changed
- When JagHelm can't reach its server, or the server's status has gone out of
  date, nothing on screen keeps the last status's green, amber or red. The
  header, the Overview's attention panel, the subsystem strip and the
  Infrastructure section turn grey with a hollow lamp and say "No signal ·
  last known 3 min ago", followed by what the status last said, such as "All
  systems normal". The last issues, counts and node readings stay on screen,
  grey, so a short outage doesn't blank the page; every age counts on
  together, and the colours come back with the next answer. The Alerts page
  follows the same rule. A status that has gone unanswered for too long
  counts as out of date too, so a tab opened again after hours, or a laptop
  woken from sleep, shows grey at once rather than hours-old colours until
  the next answer. Screen readers hear "No signal" once, not every second
  of the age, and a grey lamp is read as "No signal", not as its last word.
