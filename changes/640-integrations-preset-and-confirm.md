### Changed
- Deleting a custom group and importing a configuration file now ask in the same confirmation dialog as the rest of Settings, naming the group or the file instead of a bare question.

### Fixed
- An integration saved under a key like `adguard_stats` with no `preset` is now treated as a custom integration everywhere: the Settings list, the "key already in use" message and the match to a service on the Overview all use the preset the entry names, not a guess from the start of its key.
