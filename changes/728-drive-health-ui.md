### Added
- Drive health in the interface. A node with drive data shows a Drives block
  in its detail (the desktop drawer and the phone sheet), directly under the
  status box: one row a drive with its lamp, name, word and temperature. A row
  opens to the model, type, power-on hours, health check and the drive's own
  readings. Serial numbers are never shown. A node with a drive that may sleep
  says "Sleeping drives show their last reading".
- The node's temperature chart draws a line for each drive, the five hottest,
  with "+N more drives, not drawn" when there are more. `/api/history` has a
  new `drive.temperature` series.
- A drive alert opens its node's detail with that drive open and marked, from
  the Alerts page, the phone and a push (`/?entity=nodes/nas&drive=sdb`).
- Settings > Notifications shows a read-only "Drive health" switch, on or off,
  where drives are read. `JAGHELM_DRIVES` in the host's `.env` still sets it.
  `/api/thresholds` reports it as `drives`.
- An install with no drive data looks and behaves as before.
