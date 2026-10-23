### Added
- Everything JagHelm watches has its own address: a service, a node, the UPS,
  a job, a backup or an integration opens at `?entity=<its id>` over the page
  you are on (`/?entity=services/apps:jellyfin`). On a computer it opens in a
  panel at the side of the page; on a phone, as a full-screen sheet. A reload,
  a bookmark, a link sent to someone and a sign-in all bring it back, and the
  browser's Back button or Escape closes it.
- Rows open what they are about: every row under Needs attention and on the
  Alerts page, each row of the Services section, and a node's card or its row
  in the Infrastructure table. The panel shows the state, why, for how long,
  and where it is. A middle click or Ctrl-click opens it in a new tab.
- A link to something JagHelm no longer watches (removed, renamed, or an old
  link) says so: "No longer monitored".
- Pushes to the Android app now name what they are about, so a tap opens it
  (see the app's changelog).

### Changed
- A row under Needs attention opens its detail instead of scrolling to that
  thing on the board below.
