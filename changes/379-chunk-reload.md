### Fixed
- A browser tab left open across a deploy now reloads itself once when you open
  Settings or an app tab, and comes back on the new version with that tab open,
  instead of showing "Something went wrong". Each version gets one such reload:
  if the view fails again on the version the reload brought up, the error screen
  shows as before, so a broken build can't keep reloading the page.
