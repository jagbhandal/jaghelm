### Changed
- Settings → Integrations is rebuilt in the new look. "Connected" lists what is
  set up, each with the board's own status word for it (a failing one says why),
  and Disable, Edit and Remove on the row. "Add an integration" is the preset
  gallery with a search and a category, and a custom builder. Test connection and
  Save work as before, and a password or token is still never shown or read back.
- Removing an integration asks first in the same confirmation dialog the phones
  list uses, naming it as you do ("AdGuard Home (primary)"), not by its key.

### Fixed
- The list no longer guesses an integration's preset from the part of its name
  before an underscore: a custom `my_api` shows as Custom, not as a preset called
  `my`. A custom integration written by hand with an endpoint and fields now says
  they are set in services.yaml, and Settings keeps them when you save.
