### Fixed
- Switching Settings tabs, or leaving Settings, right after an edit to Nodes
  or Services no longer loses your next edit. The next change used to be
  refused with "Settings changed elsewhere; reloaded" although nothing had
  changed elsewhere. Now both edits are saved, and a real change elsewhere is
  still caught.
- Closing the browser tab within a moment of a Nodes or Services edit now
  asks first instead of losing the edit, and a save the server never answers
  gives up after 15 seconds and says so instead of holding up every later
  save.
