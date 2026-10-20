### Fixed
- A custom integration whose endpoint puts the token in the URL, such as
  `/api/stats?key={token}`, now sends the token itself when it is stored as a
  `$secret:` reference, which is how Settings saves it. It used to send the
  reference instead, so the integration stopped authenticating as soon as its
  token was saved in Settings. `{password}` is filled in the same way.
- A username written in `services.yaml` as a `$secret:` reference is now
  resolved like a password or token, for an endpoint's `{username}`, basic
  auth and session logins. It used to be sent as the reference itself.
- When a stored token or password that goes in the URL can't be read (its
  secret is missing, or `DASH_SECRET` is not set), the request is no longer
  sent with a `$secret:` reference, or without the key, in its place. It is
  not sent at all, and the card's error says the stored credential couldn't
  be resolved: for a token, to enter it again in Settings, and for anything
  else, to check the integration's entry in `services.yaml`. This covers a
  custom endpoint's `{token}`, `{password}` or `{username}` and the key of
  SABnzbd, Tautulli and Emby. The reference is not shown or logged.
### Security
- A token or password filled into a custom integration's endpoint path, such
  as `/api/{token}/status`, no longer shows in the card's error or the server
  log when the request fails with an error that quotes the URL (a typo in the
  URL, such as an invalid port). The error shows the URL with `{token}` in
  the credential's place.
