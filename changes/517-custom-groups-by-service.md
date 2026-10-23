### Removed
- A custom group's icon and colour options, which no longer drew anything,
  and its hidden setting: a hidden group could hide a service that is down.
  Choose which Overview sections show in Settings → Appearance.

### Fixed
- A custom group in Settings → Sections now holds each service on its own
  node: grouping AdGuard Home on one Pi no longer takes the other Pi's too.
  The list shows every service by name and node, and a Kuma monitor with no
  container can now be grouped. A group made before keeps the services it
  showed, and is saved the new way the next time you change it.
