### Added
- `PATCH /api/integrations/<key>` with `{ "enabled": true }` or
  `{ "enabled": false }` enables or disables an integration and changes
  nothing else in its `services.yaml` entry. The Enable and Disable buttons in
  Settings use it.
### Fixed
- Saving an integration in Settings no longer drops what its form doesn't
  show. The save used to rebuild the integration's `services.yaml` entry from
  the form, so a custom integration written by hand lost its endpoint, auth,
  header and fields, and a password or token stored under a name Settings
  doesn't use was lost. Now only the fields on the form change, a password or
  token left blank keeps the stored one, and a save that changes nothing
  leaves `services.yaml` untouched.
- The Enable and Disable buttons on an integration's row change only whether
  it is enabled. They used to rebuild the entry the same way, dropping its
  target container and URL parameters, and turning a second instance such as
  `adguard_primary` into a custom integration that no longer worked.
- An integration stored under a key Settings would not give it (such as
  `my_npm`) stays under that key when it is saved in Settings, as long as its
  instance name is not changed. It used to move to the key Settings derives,
  replacing any integration already stored there.
