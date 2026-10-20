### Changed
- The warning about an invalid CSP_CONNECT_EXTRA entry is now a JSON log line
  like every other server log line, with the entry in its `entry` field.
### Security
- When PROMETHEUS_URL or KUMA_URL contains a user name and password, the server
  log no longer includes the password. Node refuses such a URL, and its error
  message, which named the full URL, was logged on every failed refresh, and
  the startup lines printed both URLs as they are. The server now takes the
  password out of every URL in every line it logs, whatever the URL's scheme,
  and a user name given without a password too. A password with a character
  such as # or / that makes the URL invalid is taken out with the user name.
  The line keeps the URL's host, so it still says where the request was going.
