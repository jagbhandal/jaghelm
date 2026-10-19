### Fixed
- A browser tab left open across a deploy now reloads itself once when you open
  Settings or an app tab, and comes back on the new version, instead of showing
  "Something went wrong". If the view fails again within a minute of that
  reload, the error screen shows as before, so a broken build can't keep
  reloading the page.
