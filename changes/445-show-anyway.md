### Added
- Apps: when an app's server says it can't be shown inside JagHelm, the panel
  now offers "Show it anyway". It draws the frame and remembers the choice for
  that app. A note over the frame says it may stay blank if the site really
  blocks it, and "Stop showing it anyway" (or the switch in Settings, Apps &
  links) undoes it.

### Fixed
- Apps: an app that allows JagHelm with `frame-ancestors http://your-host:80`
  is no longer reported as blocked when JagHelm runs on https, as browsers
  accept it.
