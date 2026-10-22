### Changed
- Moving an integration to a new address (another host, port, or http to
  https) now means typing its password or token again. Save and Test refuse
  a new address with the credential left blank, and say to re-enter it for
  the new address; so does a save of the whole config in Settings.

### Security
- A stored password or token now goes only to the address it was entered
  for. A signed-in session could send any stored credential to another
  host, by changing an integration's URL and keeping its stored credential,
  or by naming another integration's `$secret:` in the config. Now an
  integration whose stored credential isn't for its address sends nothing,
  and its card says to re-enter the credential for this address. At the
  first start after updating, each stored credential is bound to the
  addresses of the integrations that use it; one no integration uses is
  bound to none. Credentials in `.env`, or typed into `services.yaml` by
  hand, go wherever the URL points, as before.
