### Fixed
- A Nodes or Services save in Settings that the server refuses or that fails
  now says why in a message, and the screen shows what is stored again. It
  used to look saved and quietly go back on the next visit.
### Security
- Settings no longer receives the credentials in `services.yaml`. Reading it
  for the Nodes, Services and Integrations screens used to send the whole file
  to the browser, so a password or token written into it by hand as plain
  text, a `$secret:` reference, a key under another name (`apikey`, `secret`,
  `cookie`), a header value under `extraHeaders`, a login body, an endpoint
  with a key in its query string and a value an endpoint fills in through a
  `{name}` placeholder were all in the page. Each one that is set now comes
  back as `{ "$stored": true }`, and saving the Nodes or Services screen keeps
  the stored value in its place; a save that changes nothing leaves the file
  untouched. A save that sends that marker where nothing is stored, or in
  place of anything but a credential, is refused and writes nothing.
- Plex's `X-Plex-Token` in a URL's query string is now taken out of log lines,
  as other keys are.
