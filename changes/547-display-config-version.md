### Changed
- After updating, reload any JagHelm tab that was already open: until then
  its display settings can't be saved.

### Fixed
- A browser or tab left open from before a change to the display settings
  can no longer undo it. Hiding an Overview section on one device and then
  changing anything on another that hadn't reloaded used to bring the
  section back, since the second device saved its whole old copy. Now the
  second device's save is checked against what is stored: JagHelm keeps the
  other device's changes, adds only what you changed, and says "Merged with
  changes from another device". If it is refused twice in a row, it shows
  what is stored and says "Settings changed on another device; reloaded".
- A change to the display settings made just before closing the tab is no
  longer lost when its save didn't get through: it is saved the next time
  JagHelm opens in that browser, keeping what other devices changed since.
- A `display-config.json` broken by a hand edit (one stray comma) no longer
  reads as empty: a device's next change saves its whole copy over it, never
  just that change. A file JagHelm can't read keeps each device's settings
  as they are, and saving says why.
- A value edited by hand into `display-config.json` that Settings can't save
  (a `javascript:` link, a reserved key, an Overview section switch that
  isn't true or false) no longer makes every later save fail: that value
  alone is left out, the log names where it was, and the next save removes
  it from the file.
- When `services.yaml` can't be read, a Settings save now says why at once,
  as it does for a file that doesn't parse, instead of reloading the page
  first.
