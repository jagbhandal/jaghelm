### Fixed
- The web app's offline cache no longer grows with every deploy of the same
  version. When a new build's service worker takes over, it deletes every cached
  file that isn't part of the app shell or the new build's first-paint bundles,
  so old bundles from earlier deploys no longer pile up in the browser. Other
  files it had cached, such as the Settings page code, are downloaded and cached
  again the next time they are used.
