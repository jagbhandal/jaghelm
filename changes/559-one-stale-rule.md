### Fixed
- The header and the Overview's sections no longer disagree for a few seconds
  about whether what they show is current. A section's "updated 2m ago" note
  now comes at the same moment the header says "No signal" for an answer as
  old: two missed refreshes and the request's timeout, 72 s at the default
  30 s refresh (it was 1 minute). A tab opened again after a while, or a
  laptop woken from sleep, shows the note beside the header's "No signal"
  until the answers come, and both go together; going to another page and
  back still shows none.
