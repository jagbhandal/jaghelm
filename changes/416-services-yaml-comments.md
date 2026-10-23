### Fixed
- A save in Settings no longer strips the comments from a `services.yaml` you
  wrote by hand. Toggling an integration, or saving the Nodes or Services tab,
  changes only the lines of what changed: your comments, blank lines and
  quoting stay, with the spacing evened out (two-space indents, one space
  before a comment at the end of a line). A file that uses YAML anchors,
  aliases or merge keys is still rewritten whole without its comments, and the
  log says so.
