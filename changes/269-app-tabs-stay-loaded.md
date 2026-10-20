### Changed
- An embedded tab stays loaded when you switch to another tab, Settings or the
  dashboard, and is where you left it when you come back. It used to load again
  from the start on every switch. Deleting the tab in Settings unloads it.
### Fixed
- An embedded tab that takes more than 8 seconds to load now says it is slow to
  load and offers Retry, and shows as soon as it loads. It used to say
  "Embedding Blocked" and blame the service's headers.
- An embedded tab whose server refuses to be shown inside another site
  (X-Frame-Options or a CSP frame-ancestors list that leaves JagHelm out) says
  it won't open inside JagHelm, names the header, and offers "Open in new tab"
  and how to allow embedding. JagHelm's server reads the service's headers to
  find this out, so it has to be able to reach the tab's URL; when it can't,
  the tab shows what the browser shows. Retry, and "Check again", reload only
  that tab.
### Security
- The server's outbound URL check now refuses the cloud metadata address
  (169.254.169.254) and 0.0.0.0/8 when they are written as IPv6, such as
  http://[::ffff:169.254.169.254]/, which the server connected to as IPv4. An
  IPv6 address that carries an IPv4 address is checked as that IPv4 address,
  in strict mode too.
