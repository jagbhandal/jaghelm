### Fixed
- A Kuma monitor whose service moves to another card while it is down now sends
  one "Service down" and one "Service recovered" push per outage. A container
  that took a down monitor (or the monitor of a service you renamed, such as
  nextcloud to nextcloud-app) used to send a second "Service down", or lose the
  "Service recovered" when it took over in the cycle the monitor came back up.
  Both copies of an unpinned replica stopping (Vaultwarden on vm103 and pi2) no
  longer lose the recovery either. The recovery is sent for the card the
  monitor has when it comes back up, which can differ from the one the down
  push named. Updating sends no push.
