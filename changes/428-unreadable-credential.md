### Changed
- A password, token or user name that a custom integration's endpoint fills
  in through `{token}`, `{password}` or `{username}` is now URL-encoded, so
  one with `&`, `#`, `/`, `?`, a space or `@` arrives intact instead of being
  cut short or sent to the wrong path. Write credentials in `services.yaml`
  as they are: one you encoded by hand is now encoded twice, so write it
  unencoded again.

### Fixed
- An integration whose stored password or token can't be read (its secret is
  gone, or won't decrypt) no longer sends a request with it left empty, which
  failed the login and then held the integration as "login refused twice".
  It sends nothing, its card says to enter the credential again, and it is
  retried as soon as the secret is back or the credential is saved again in
  Settings. This now holds for every kind of login, as it already did for a
  credential in the URL.
