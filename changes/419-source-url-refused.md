### Security
- A `PROMETHEUS_URL`, `KUMA_URL` or `GITEA_URL` with a user name or password
  in it (any URL holding an `@`) is now refused at boot. JagHelm never
  requests or logs it, warns once without the value, and the board shows that
  source as off ("Kuma off") with the variable named and where the credential
  goes instead (`KUMA_API_KEY`, `GITEA_TOKEN`; Prometheus takes none).
  `/api/health` lists it under `sourceUrls`. Such a URL never worked, so no
  working setup changes, unless a path held a raw `@` (write it `%40`).
- The server log now also hides a password made of digits followed by a raw
  `#`, `/` or `?` (`http://user:1234#x@host`), which the URL parser reads as a
  host and port.
