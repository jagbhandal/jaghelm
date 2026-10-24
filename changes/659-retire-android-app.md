### Removed
- The Android app is retired. Use the installed dashboard instead: open JagHelm
  at its https address, add it to the home screen and turn on alerts in
  Settings → Notifications, which sends them over Web Push. The app's source,
  its build and its release line (`mobile-vX.Y.Z`, with the signed APK) are
  gone; releases already published stay on the Releases page. The server still
  sends Firebase push to a phone that registered with the app, and that goes in
  a later release (docs/push/FCM-SETUP.md).
