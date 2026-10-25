### Added
- Alerts on your phone no longer need a key tool: JagHelm makes its own Web Push key pair the first time it starts and keeps it in the data folder (`vapid-keys.json`, readable by JagHelm only). Keys set in `.env` still win, and `VAPID_SUBJECT` is now optional.

### Changed
- If the stored Web Push key file is damaged while phones are registered, alerts stay off and Settings says so, instead of silently making a new key that would sign every phone out of alerts.
- Settings now says what is wrong when JagHelm's own Web Push key can't be used (damaged, unreadable or can't be saved), and a key file that others could read is locked down to JagHelm only.
