### Added
- The Overview and the phone's Overview have a Backups section: for each job
  marked as a backup, when it last ran well and how long ago, from the reports
  the Proxmox notifications, vm-103 and the NAS already send. It is amber after
  36 hours and red after 72 (Settings → Nodes & Services → Backup freshness moves
  both), red at once when the last run failed (with its reason), amber at most
  when the board says the host is unreachable (the NAS or MS-S1 may be off), and "No
  signal" for a job that has never reported, never green. With a read-only B2
  key in `JAGHELM_B2_KEY_ID`, `JAGHELM_B2_APP_KEY` and `JAGHELM_B2_BUCKET`, it
  also shows the bucket's size, a sparkline and "+N GB in 7 d" from a once-a-day
  read in the background, when data last arrived in each folder, and an amber
  "N GB hidden versions" if old file versions pile up again. Without the key that
  part is absent; a rejected key says "B2 key rejected". Read-only; it sends no
  alert. Settings → Appearance → Overview sections and Edit layout can hide or
  move it.
