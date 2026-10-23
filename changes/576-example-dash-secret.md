### Security
- `DASH_SECRET` is refused as an encryption key when it is still the example
  that README (`replace-with-output-of-openssl-rand-hex-32`) or Get Started
  (`paste-your-random-secret-here`) prints, as `env.example`'s already was,
  in any case and with spaces around it. A key anyone can read in the docs
  left every stored credential readable to whoever got `data/secrets.json`.
  If JagHelm has been running on one of them, its integrations now say their
  stored credential can't be read and Settings can't save one: generate a
  key with `openssl rand -hex 32`, set it as `DASH_SECRET` in `.env`, restart,
  then enter each integration's password or token again in Settings. The log
  line at start says the same and how many credentials are stored.
