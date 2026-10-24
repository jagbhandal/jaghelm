### Added
- A node's or container's detail now shows "Recent errors": its last 20
  error and warning log lines from the last 6 hours, read from Loki when the
  detail opens. Set `LOKI_URL` to turn it on; without it, or when Loki doesn't
  answer, the detail says logs are unavailable. Passwords and tokens in a
  line are hidden.
