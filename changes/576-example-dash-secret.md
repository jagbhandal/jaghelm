### Breaking changes
- **The example `DASH_SECRET` in README and Get Started is refused as an
  encryption key,** as `env.example`'s already was, in any case and with
  spaces or quotes around it. An install running on
  `replace-with-output-of-openssl-rand-hex-32` or
  `paste-your-random-secret-here` can't read any stored credential until it
  has a real key: its integrations say the stored credential can't be read,
  and Settings can't save one. Generate a key with `openssl rand -hex 32`,
  set it as `DASH_SECRET` in `.env`, restart, then enter each integration's
  password or token again in Settings; the log line at start says the same.
  That key was public, so if `data/` or a backup of it ever left the host,
  also change those passwords and tokens in the apps themselves, as
  [section 1 of the incident runbook](docs/security/INCIDENT-RUNBOOK.md#1-datasecretsjson-or-dash_secret-was-exposed)
  describes.
