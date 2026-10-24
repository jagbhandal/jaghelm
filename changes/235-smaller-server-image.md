### Changed
- The server's dependencies shrink from 290 packages (92 MB) to 89 (22 MB) and
  its image by about 90 MB: push no longer goes through the Firebase Admin SDK,
  and the server is ready as soon as it starts.
