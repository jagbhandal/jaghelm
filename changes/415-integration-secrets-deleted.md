### Fixed
- Deleting an integration now deletes its stored password, token and URL
  too. They used to stay behind, and an integration added again under the
  same name quietly used the old credential. Adding an integration also
  clears any left under its name by an earlier delete.
- Renaming an integration no longer deletes a stored password that another
  integration uses too.
- An integration save that can't be written to `services.yaml` (a full disk,
  or the file changed or broken by hand at that moment) no longer leaves the
  password or token you typed stored. Nothing is saved, and saving again
  once the problem is fixed works as before.
- A password or token that can't be written to `secrets.json` now fails the
  save. It used to be reported saved and was gone after the next restart.
