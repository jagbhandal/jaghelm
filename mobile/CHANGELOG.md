# Changelog

All notable changes to the JagHelm Android app are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.3.0] — 2026-10-20

The UPS cell no longer shows MAINS while on battery, the app stops refreshing in the background, and Active issues rows open their detail screen.

### Changed
- The app stops refreshing while it is in the background and refreshes at once when you come back to it, so it no longer uses data and battery while closed and no longer opens on data up to one refresh old.
- Refreshes after the first load ask the server only for what changed: an unchanged service list or UPS reading comes back as a short `304 Not Modified` instead of the full data. Tapping the status bar still fetches everything.
- The countdown in the status bar now matches when the next refresh really happens, including after a slow refresh or a change to the refresh interval.
- The node detail screen shows both TEMP and DISK for a node that reports both,
  such as the Pi, so you can see its temperature and how full its disk is.
- Tapping a row under Active issues on the Overview opens its detail screen: a
  down or unknown service opens that service, and a UPS or cron row opens the
  incident with its cause. Back returns to the Overview. A service's row no
  longer opens the service's web page directly; use Open on the service screen.
- TalkBack reads an unknown service's row as "unknown" instead of spelling out
  "UNKN".

### Fixed
- The UPS cell no longer shows MAINS while the UPS is on battery. It reads the
  UPS status the way push and the web dashboard do: on battery and low battery
  show ON BATTERY with an alert, and an unknown status shows NO SIGNAL instead
  of a battery alarm.
- A node card shows DISK instead of TEMP once its disk is 90 % full or more, so
  a nearly full disk on a node that reports its temperature is no longer hidden.

## [1.2.0] — 2026-10-18

The update notification toggle is now labelled Updates.

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

[Unreleased]: https://github.com/jagbhandal/jaghelm/compare/mobile-v1.3.0...HEAD
[1.3.0]: https://github.com/jagbhandal/jaghelm/compare/mobile-v1.2.0...mobile-v1.3.0
[1.2.0]: https://github.com/jagbhandal/jaghelm/compare/mobile-v1.1.0...mobile-v1.2.0
[1.1.0]: https://github.com/jagbhandal/jaghelm/compare/mobile-v1.0.7...mobile-v1.1.0
[1.0.0]: https://github.com/jagbhandal/jaghelm/tree/mobile-v1.0.0
