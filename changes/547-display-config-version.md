### Fixed
- A browser or tab left open from before a change to the display settings
  can no longer undo it. Hiding an Overview section on one device and then
  changing anything on another that hadn't reloaded used to bring the
  section back, since the second device saved its whole old copy. Now the
  second device's save is checked against what is stored: JagHelm keeps the
  other device's changes, adds only what you changed, and says "Merged with
  changes from another device". If it is refused twice in a row, it shows
  what is stored and says "Settings changed on another device; reloaded".
- A display setting edited by hand into a value Settings can't save (such as
  an Overview section switch that isn't true or false) no longer makes every
  later save fail: it is left out, the log names the setting, and the next
  save removes it from the file.
- When `services.yaml` can't be read, a Settings save now says why at once,
  as it does for a file that doesn't parse, instead of reloading the page
  first.
