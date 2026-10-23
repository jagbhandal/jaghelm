### Added
- Settings → Notifications sets the warning and critical lines the board and
  push judge every node by: CPU and memory, the disk (and storage pools) and
  the temperature, each with its default beside it and Reset to default. A
  line out of range, a warning line not under its critical one or a wrong
  unit is refused and says why on its row. A save counts from the next
  refresh, for the board and push alike. Lines hand-edited under
  `pushThresholds` in `display-config.json` show as the lines in force until
  the first save here replaces them.
- The same page lists each phone that registered for push, by its model:
  when it registered, was last seen and last got a push, why its last push
  failed (in words), and which kinds of push it chose in the app. Remove
  takes one off, after asking. Send test push sends one to a phone or to all
  of them and says what happened to each: delivered, switched off in the
  app, failed and why, or waiting while Google can't be reached. One test
  push per phone every 30 seconds; each is in the alert history like any
  push. With push not set up on the server, the page says so and how to turn
  it on.
