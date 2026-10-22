### Fixed
- Log out and Forget this device now stop push notifications to the phone. The
  app asks the server to forget the phone before it ends the session, and
  turns push off on the phone itself too, so alerts stop even when JagHelm
  can't be reached at that moment. Signing in again turns notifications back
  on.
