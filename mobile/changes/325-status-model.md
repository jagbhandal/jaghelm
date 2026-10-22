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
  This needs JagHelm server 3.0.0 or later.
- A tapped push opens that host, source or issue as it is now, when it is still
  open, instead of only the push's own details.

### Fixed
- When the app's view of JagHelm is out of date (the server can't be reached,
  says its status is stale, or hasn't answered for two refreshes), every lamp,
  cell and row turns grey, keeping what it last said and how long ago, instead
  of showing old colours as current.
- A new install with nothing set up says "Nothing monitored yet", not "No
  signal".
- A `services.yaml` that doesn't load now shows as an issue in the app, not
  only as a push.
