### Fixed
- A custom integration whose endpoint puts the token in the URL, such as
  `/api/stats?key={token}`, now sends the token itself when it is stored as a
  `$secret:` reference, which is how Settings saves it. It used to send the
  reference instead, so the integration stopped authenticating as soon as its
  token was saved in Settings. `{password}` is filled in the same way.
- When a stored token or password that goes in the URL can't be read (its
  secret is missing, or `DASH_SECRET` is not set), the request is no longer
  sent with a `$secret:` reference, or without the key, in its place. It is
  not sent at all, and the card's error says the stored credential couldn't
  be resolved and to enter it again in Settings. This covers a custom
  endpoint's `{token}` or `{password}` and the key of SABnzbd, Tautulli and
  Emby. The reference is not shown or logged.
