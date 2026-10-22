### Fixed
- Turn off push on this device now stays off: the app no longer turns push
  back on at its next start. It also deletes the phone's push token, so alerts
  stop even if the server didn't hear about it. Turn it back on from the same
  screen with *Turn on push on this device*.
- A Log out, Forget this device or Turn off push while the phone is offline is
  now finished when the phone is back online: the app asks the server to end
  that session and forget the phone, and deletes the push token, the next time
  it has a connection or you sign in. If the app isn't opened again, this
  waits until it is.
