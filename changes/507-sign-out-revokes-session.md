### Security
- Logging out now ends the session on the server as well as in the browser.
  Before, a copy of the session token (from a shared computer, a HAR file, a
  proxy log or a screenshot) kept working after you logged out, until it
  expired 24 hours after sign-in or the server restarted. Your other sessions,
  such as the Android app, stay signed in. If the server can't be reached, the
  dashboard still logs out within 5 seconds.
