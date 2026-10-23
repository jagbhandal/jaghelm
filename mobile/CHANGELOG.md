# Changelog

All notable changes to the JagHelm Android app are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.4.0] — 2026-10-23

The app now shows the server's own status, the same as the web and push, a tapped notification opens what it is about, and signing out ends the session on the server and stops push to the phone.

Requires JagHelm server 4.0.0 or later.

### Changed
- The app now shows JagHelm's own judgement of everything it watches, the same
  one the web and push use, instead of working out its own. The Overview's card,
  strip and issue list, the Services list, the Infra cards and the detail
  screens say what the web says: a disk turns amber at 90 % and red at 95 %, as
  the server's lines say (or the lines you set), not at the app's own 75 and
  90 %; the strip shows a cell for each area you have set up (Services, Nodes,
  Power, Jobs, Backups, Integrations); every issue row says where it is and
  why. A node card counts its services as the server does ("4 / 5 services up
  · 1 down"), and a node that hosts none says "No services" instead of "0 up".
- Each cell of the Overview's strip shows its count in bold with what it counts
  under it, in the web's words ("11 / 12" over "up"). The Power cell shows the
  UPS's charge as the web does ("100 % charge"), and its runtime left while on
  battery.
- The app reads the UPS's runtime left ("21 min left") from JagHelm's status,
  as it reads everything else, so each refresh asks the server for two things
  instead of three.
- Update the server first. With a 3.0.0 server the app still works, but the
  strip's cells show their count on one line and the UPS's readings are asked
  for separately, as before; with a server older than 3.0.0 the app says so,
  and to update it.
- Tapping a notification opens what it is about, as it is now: a service's
  notification its service, a node's its node, and the UPS, a job, a backup
  or an Arcane agent's their detail, the same screen its row opens, instead
  of only the notification's own details. This works whether the app was
  running or the tap started it; until the first refresh the screen says
  "Loading…", and the tab you last had open no longer replaces it. One about
  a service or node that is no longer there shows what the notification
  said, as before. With a server older than 4.0.0, a notification still
  opens the right thing, worked out from what it says, as before.
- When JagHelm asks you to wait after too many sign-in attempts, the sign-in
  screen says for how long, such as "Try again in 30 s.", instead of "later".

### Fixed
- When the app's view of JagHelm is out of date (the server can't be reached,
  says its status is stale, or hasn't answered for two refreshes), every lamp,
  cell and row turns grey, keeping what it last said and how long ago, instead
  of showing old colours as current, and the Power cell and the UPS's issue
  show no runtime left from back then. The Alerts tab keeps its list too,
  grey, instead of going blank.
- A new install with nothing set up says "Nothing monitored yet", not "No
  signal".
- A `services.yaml` that doesn't load now shows as an issue in the app, not
  only as a push.
- Log out and Forget this device now stop push notifications to the phone. The
  app asks the server to forget the phone before it ends the session, and
  turns push off on the phone itself too, so alerts stop even when JagHelm
  can't be reached at that moment. Signing in again turns notifications back
  on.
- Turn off push on this device now stays off: the app no longer turns push
  back on at its next start. It also deletes the phone's push token, so alerts
  stop even if the server didn't hear about it. Turn it back on from the same
  screen with *Turn on push on this device*.
- A Log out, Forget this device or Turn off push while the phone is offline is
  now finished when the phone is back online: the app asks the server to end
  that session and forget the phone, and deletes the push token, the next time
  it has a connection or you sign in. If the app isn't opened again, this
  waits until it is.

### Security
- Log out and Forget this device now end the session on the server as well as
  on the phone, so a copy of the session token stops working. Your other
  sessions, such as a browser, stay signed in. The app logs out at once, even
  when the server can't be reached. A server older than 4.0.0 keeps the
  session until it expires, as before.

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

[Unreleased]: https://github.com/jagbhandal/jaghelm/compare/mobile-v1.4.0...HEAD
[1.4.0]: https://github.com/jagbhandal/jaghelm/compare/mobile-v1.3.0...mobile-v1.4.0
[1.3.0]: https://github.com/jagbhandal/jaghelm/compare/mobile-v1.2.0...mobile-v1.3.0
[1.2.0]: https://github.com/jagbhandal/jaghelm/compare/mobile-v1.1.0...mobile-v1.2.0
[1.1.0]: https://github.com/jagbhandal/jaghelm/compare/mobile-v1.0.7...mobile-v1.1.0
[1.0.0]: https://github.com/jagbhandal/jaghelm/tree/mobile-v1.0.0
