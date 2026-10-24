### Added
- A new install opens a guided setup instead of an empty Overview: it checks
  that Prometheus answers, lists the nodes JagHelm found so you can name them
  or switch some off, shows whether Uptime Kuma and your UPS are connected,
  and offers Integrations, then lands on the Overview. Every step can be
  skipped, **Skip setup** ends it for every device, and an existing install
  never sees it.
- Settings → Appearance has Units (metric or imperial) and Dates and times
  (the browser's format, or a language you pick). The web app and, later, the
  Android app read the same two settings.

### Changed
- A fresh install starts in °C. An existing install keeps what it was
  drawing: Fahrenheit, or Celsius if you had chosen it, saved once at the
  first start as the new Units setting. Dates follow your browser's locale
  instead of always reading as US English.
- The example weather place in Settings → Appearance is now a neutral one.
