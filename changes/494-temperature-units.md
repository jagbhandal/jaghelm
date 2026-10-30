### Added
- `/api/status` now serves `units` (`metric` or `imperial`), the Units setting
  in Settings → Appearance. Temperatures in the status model's reasons, in
  push text and on the node meters and drive lists follow it, so they show one
  number in one unit. Celsius stays the default; the lines stay stored in °C
  and only the display converts, so the unit never changes a level.
