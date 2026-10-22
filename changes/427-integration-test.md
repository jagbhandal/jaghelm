### Changed
- Test Connection in Settings → Integrations now checks exactly what the
  next refresh will do with the form as you would save it, before anything
  is saved: the same requests, with the stored endpoint and fields, and the
  password or token you typed in place of the stored one. Its error is the
  one the integration's card would show. A preset is no longer tested at a
  lighter "test" address of its own.
- A failed login to Nginx Proxy Manager, Portainer, PhotoPrism or another
  session-login app now says why (such as "Login returned HTTP 401"), and a
  reply that is not JSON says so, on the card and in Test, without quoting
  the reply.

### Fixed
- Testing a custom integration no longer requests `<url>undefined`: it is
  tested at its endpoint from `services.yaml`.
- Testing an integration you are editing no longer needs its password or
  token typed again: a blank one tests the stored one, as Save keeps it.

### Security
- A field in Settings → Integrations can no longer name a stored secret. A
  username such as `$secret:<another integration's key>`, with the URL
  pointed elsewhere, sent that secret there, on Test at once and after Save
  at the next refresh. A `$secret:` reference in any field is now refused,
  unless it is the one already stored in that field.
- An integration's URL can no longer carry a user name, password or key
  (`https://user:pass@host`, `?key=`, `?apikey=`, `?token=` and the like).
  Such a URL never worked; it was stored, sent back to the browser and
  logged. Save and Test now refuse it, with a message beside the URL field
  that says which field the credential goes in. One already in
  `services.yaml` is not requested: its card says where to move the
  credential, and Settings shows the URL empty, to be entered again without
  it.
