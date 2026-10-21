### Fixed
- An editor that empties `services.yaml` for a moment while saving it no
  longer clears the board for one refresh and then pages every open problem
  again as new. A `services.yaml` that can't be parsed, or reads empty or as
  something other than a mapping, keeps the last good config until the file
  changes again.
- A `services.yaml` that can't be parsed when JagHelm starts is no longer
  taken for a first boot, so discovery no longer writes a new file over it.
  The board starts empty, and fixing the file brings it back.
