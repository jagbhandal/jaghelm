### Fixed
- A Kuma monitor whose service moves to another card while it is down now sends
  one "Service down" and one "Service recovered" push per outage. A container
  that took a down monitor (or the monitor of a service you renamed, such as
  nextcloud to nextcloud-app) used to send a second "Service down", or lose the
  "Service recovered" when it took over in the cycle the monitor came back up.
  The recovery is sent for the card the monitor has when it comes back up,
  which can differ from the one the down push named. Updating sends no push.
- When every copy of a container that runs on several nodes stops and its
  monitor goes down, the red card is drawn on the node the monitor last ran on,
  not on another copy's node, and its "Service recovered" push is no longer
  lost.
- Pausing or deleting a Kuma monitor while it is down no longer sends a
  "Service recovered" push for its container's card.
