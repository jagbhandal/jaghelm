### Changed
- The app reads the UPS's runtime left ("21 min left") from JagHelm's status,
  as it reads everything else, so each refresh asks the server for two things
  instead of three. A server older than this change is still asked for the
  UPS's readings, as before.

### Fixed
- While the app's view of JagHelm is out of date, the Power cell and the UPS's
  issue no longer show a runtime left from back then.
