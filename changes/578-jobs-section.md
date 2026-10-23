### Added
- The Overview has a Jobs section under Infrastructure: every scheduled job
  and backup, one line each with its status, its name, its node, its
  schedule in plain words ("daily at 06:30" for `30 6 * * *`) and how long
  ago it last reported. A job that failed or is overdue says why instead, in
  its status colour: a failed backup is red, a failed or overdue job amber.
  The Jobs and Backups filters show their own group alone, and Settings →
  Appearance → Overview sections can hide it. On a phone the same list is on
  the Infrastructure tab, under the nodes.
- A job opens its own panel: its schedule, when it last reported, the
  overdue line ("Last report 31 h ago · expected every 24 h"), its last three
  runs with their time, duration and error, and **Remove**. Remove asks
  first, then removes the job and its history as the old Scheduled Jobs
  panel did; the job comes back the next time it reports. If removing fails,
  the panel says why and nothing is removed.
