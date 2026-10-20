### Fixed
- Changing an integration's instance name in Settings to a name another
  integration already uses is refused, with a message beside the Instance
  Name field that names that integration, and nothing is changed. The save
  used to remove the edited integration and write it over the other one, whose
  URL, target container and stored credentials were lost. Adding a new
  integration under an instance name in use is refused the same way, instead
  of replacing that integration's settings, and so is a second custom
  integration from the custom builder, which used to replace the first one.
