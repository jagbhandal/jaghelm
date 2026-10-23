### Added
- `/api/health` shows the phone notifications waiting to be sent, under
  `push`: how many (`queued`) and how long the oldest has waited
  (`oldestAgeS`), so a refused service-account key or a long internet outage
  shows. It doesn't change the health status.

### Fixed
- When the server can't reach Google, the dashboard keeps updating and
  `/api/health` stays healthy. Before, every refresh waited for its phone
  notifications to be sent, which could take minutes with the internet down:
  the board stopped updating and `/api/health` answered 503, which could fail a
  deploy's health check.
- A notification Google doesn't take (no internet, Google failing, the
  service-account key refused) is no longer lost. The server keeps it, with
  any that follow, and sends each phone its notifications in order once Google
  answers, also after a restart. One phone Google keeps failing no longer holds
  up the others. A problem that cleared before its alert went out sends
  neither the alert nor its "recovered". The server keeps at most 100 waiting
  alerts; past that it drops the oldest and logs which, but never a
  "recovered" for an alert the phone already shows.
