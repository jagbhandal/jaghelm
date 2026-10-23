### Changed
- JagHelm's status now carries the UPS's runtime left while it is on battery,
  so the Android app reads it there instead of asking for the UPS separately.
  On a phone, the web's UPS sheet shows it from there too ("21 min left"), and
  a refresh no longer reads the UPS's own readings. `/api/ups` stays as it is
  for apps already installed.

### Fixed
- On a phone, while the web's view of JagHelm is out of date, the UPS sheet no
  longer shows a runtime left from back then.
