### Security
- Settings no longer receives the credentials in `services.yaml`. Reading it
  for the Nodes, Services and Integrations screens used to send the whole file
  to the browser, so a password or token written into it by hand as plain
  text, a `$secret:` reference, a header value under `extraHeaders` and a
  session login body were all in the page. Each one that is set now comes back
  as `{ "$stored": true }`, and saving the Nodes or Services screen keeps the
  stored value in its place; a save that changes nothing leaves the file
  untouched. A save that sends that marker where nothing is stored, or in
  place of anything but a credential, is refused and writes nothing.
