### Fixed
- A merged change now always reaches the server, even when its image is built
  late. A check every five minutes deploys the newest merge whenever the server
  runs something else. A deploy that only waited for an image no longer fails:
  a failure now means a build that never came, or a deploy that broke.
