### Fixed
- Deleting an integration now deletes its stored password, token and URL
  too. They used to stay behind, and an integration added again under the
  same name quietly used the old credential. When JagHelm starts, it also
  clears out the ones earlier deletes left behind, and those of an
  integration removed from `services.yaml` by hand.
- An integration save that can't be written to `services.yaml` (a full disk,
  or the file changed or broken by hand at that moment) no longer leaves the
  password or token you typed stored. Nothing is saved, and saving again
  once the problem is fixed works as before.
