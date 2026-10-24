### Removed
- The Firebase push sender is gone with the Android app. Web Push to the
  installed dashboard is the only way JagHelm alerts a phone. The
  `FCM_SERVICE_ACCOUNT` and `GOOGLE_APPLICATION_CREDENTIALS` settings, the
  service-account key and its compose mount are not read any more (a leftover
  one is ignored without a warning, and can be deleted), and
  docs/push/FCM-SETUP.md is removed. The app's device records are dropped at the
  next start, so Settings → Notifications lists only browsers, and the Android
  app's `/api/push/register`, `/api/push/status` and `/api/push/prefs` answer
  404. Web Push, the alert history and the test push are unchanged.
