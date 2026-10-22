### Fixed
- A `services.yaml` JagHelm can't read (its permissions, a directory in its
  place, a disk error) no longer looks like an empty, healthy board. The
  header and the attention panel say "services.yaml can't be read
  (permission denied)", the phone gets one "JagHelm config broken" alert,
  `/api/health` says `unreadable`, and Settings saves nothing over it. Fix
  the permissions and JagHelm reads it again within 30 seconds, no restart
  needed, with one "JagHelm config fixed".
- A broken `services.yaml` that gets deleted no longer leaves the board
  saying it doesn't parse until a restart: the warning clears within a few
  seconds, and the next save in Settings writes a new file.
- If the file was already broken when JagHelm started, deleting it leaves an
  empty board; restart JagHelm and it discovers your nodes again.
