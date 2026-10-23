### Changed
- You now stay signed in, on the web and in the Android app, when JagHelm
  restarts or updates. A session ends after 30 days without use, and 90 days
  after you signed in in any case. Before, every restart signed every device
  out, and a session ended 24 hours after sign-in however much you used it.

### Security
- Sessions are kept in `data/sessions.json`, readable only by the user
  JagHelm runs as. It holds a SHA-256 of each session token, never the token,
  so a copy of the file (a backup, say) signs nobody in. Logging out and
  changing the password in Settings are saved at once and still hold after a
  restart. Changing `DASH_PASS` or `DASH_USER`, or removing `data/auth.json`,
  signs every device out at the next start. To sign every device out without
  changing the password, stop JagHelm, delete `data/sessions.json` and start
  it again.
