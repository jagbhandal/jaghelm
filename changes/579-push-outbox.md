### Fixed
- When the server can't reach Google, the dashboard keeps updating and
  `/api/health` stays healthy. Before, every refresh waited for its phone
  notifications to be sent, which could take minutes with the internet down:
  the board stopped updating and `/api/health` answered 503, which could fail a
  deploy's health check.
- A notification Google doesn't take (no internet, Google failing, the
  service-account key refused) is no longer lost. The server keeps it, with
  any that follow, and sends them in order once Google answers, also after a
  restart. It keeps at most 100; past that it drops the oldest and logs which.
