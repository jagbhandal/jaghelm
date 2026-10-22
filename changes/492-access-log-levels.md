### Changed
- The server's access log now records every change at the default log level:
  a request that saves or deletes something, a cron job's report and a
  sign-in each log one line with its method, path and status, where before
  only a failed or slow one did. Requests that fail (`4xx`, a refused sign-in
  or an expired session included) and requests that take 300 ms or more are
  logged as before. A successful read that answered quickly, such as the
  dashboard's own refresh every 30 seconds, is logged only with
  `LOG_LEVEL=debug`, which still shows every request.

### Fixed
- A signed-out tab stops polling and asks you to sign in. When a session ends
  (24 hours after signing in, or when the server restarts), an open dashboard
  kept asking the server for data every 30 seconds and was refused each time,
  for as long as the tab stayed open. It now shows the sign-in screen once and
  asks nothing more until you sign in again, which brings the dashboard back.
