### Added
- A new frame around every page: a header across the top that says how the
  homelab is, in one line from the server's status ("Critical · 1 service down ·
  UPS on battery"), with when it last heard and a link to the list of what is
  wrong; a sidebar with Overview, Alerts, your embedded apps and Settings, which
  folds down to icons and remembers that in this browser; and, on a phone, tabs
  for Overview, Alerts and More.
- When JagHelm can't reach its server, the header says "No signal" in grey, as
  the Android app does, instead of a status it can no longer vouch for.
- An Alerts page lists what needs attention now, worst first.
- Every page has its own address (`/alerts`, `/settings/tabs`, `/apps/<app>`):
  links, bookmarks, Back, Forward and a reload all land on the page you were on,
  offline too once JagHelm has been opened in that browser.
- Embedded apps are in the sidebar (under More on a phone) and in the command
  palette ("Open Grafana"). A dot marks an app that is still loaded; Unload
  frees it. At most five stay loaded at once: opening a sixth unloads the one
  you used least recently. Over an open app, a bar shows its name and address,
  with Reload (that app only) and Open in new tab.

### Removed
- The welcome message under the navigation bar.
- The theme button in the navigation bar: pick a theme in Settings → Appearance
  or the command palette (Ctrl K, ⌘K on a Mac).
- The weather, the clock and the web search box that sat in the navigation bar,
  for now: they come back in the Overview's side panel and the Launch page.
