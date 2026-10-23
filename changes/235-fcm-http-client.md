### Changed
- The server sends push notifications with its own small Firebase Cloud
  Messaging client instead of the Firebase Admin SDK. Notifications reach the
  phone as before, with the same wording. The server's dependencies shrink from
  290 packages (92 MB) to 89 (22 MB) and its image by about 90 MB, and push is
  ready as soon as the server starts. Nothing to change: the same service-account
  key and `FCM_SERVICE_ACCOUNT` setting work as they are.

### Security
- The access token the server gets from Google with the service-account key can
  now only send notifications; before, it was also valid for the Google Cloud
  APIs the service account could use. The key never leaves the server, and
  neither it nor the tokens made with it are ever logged.
