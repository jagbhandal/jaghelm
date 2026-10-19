### Fixed
- The web app's offline cache no longer grows with every deploy of the same
  version. When a new build's service worker takes over, it deletes cached
  bundles from earlier builds; the current build's files, including the
  Settings and iframe views, stay cached, as do the app shell, your uploaded
  logo and the app icons.
- A browser tab still open on an older build no longer gets the dashboard page
  back when it asks for a file that a deploy removed. The server now answers
  `404 Not Found` for a missing file under `/assets/`, and the service worker
  never caches an HTML page or an error under a bundle's address.
