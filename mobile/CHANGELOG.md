# Changelog

All notable changes to the JagHelm Android app are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed
- The Watchtower notification toggle is now labelled Updates, since it covers every update notification, including Arcane's. The setting itself is unchanged, so older app versions and the server keep working.

## [1.1.0] — 2026-10-16

A connection screen when the server can't be reached, overdue scheduled jobs on the Overview, and Watchtower notification settings.

Requires JagHelm server 2.0.0 or later.

### Added
- Connection screen with retry when the server can't be reached at startup, replacing an indefinite blank screen.
- Sign-in gives up after 10 seconds with a clear message instead of waiting indefinitely.
- Overdue scheduled jobs appear on the Overview with how long since they last reported.
- Notification toggle for Watchtower update events.

### Fixed
- The app reports its real version when registering for notifications.

### Security
- Dependencies updated to resolve published advisories.

## [1.0.0] — 2026-06-26

First release of the Android app, distributed as a signed APK; builds 1.0.1 to 1.0.7 followed on 2026-06-26 and 06-27 with fixes and a visual refresh.

### Added
- Sign in to a JagHelm server over the tailnet, with an optional keep-signed-in setting that revalidates on launch.
- Push notifications for service, host, UPS and scheduled-job state changes, with per-category settings and links to the related incident.
- Overview, Alerts and Infrastructure screens.

[Unreleased]: https://github.com/jagbhandal/jaghelm/compare/mobile-v1.1.0...HEAD
[1.1.0]: https://github.com/jagbhandal/jaghelm/compare/mobile-v1.0.7...mobile-v1.1.0
[1.0.0]: https://github.com/jagbhandal/jaghelm/tree/mobile-v1.0.0
