### Added
- `JAGHELM_ICON_CACHE_MAX_MB` sets how much the icon cache (`icon-cache/` in the
  data dir) keeps, in MB. It defaults to 50. Past it the least recently used icon
  is deleted, and it is fetched again the next time it is shown.
### Changed
- Only Dashboard Icons and selfh.st icons go through the icon cache now: their
  SVG, PNG and WebP files on jsDelivr (no version, `@latest` or `@main`) or on
  raw.githubusercontent.com (`main` or `HEAD`). Any other icon URL on jsDelivr or
  raw.githubusercontent.com, such as another repository or a pinned version, is
  now loaded by the browser straight from there, so it still shows. An icon over
  512 KB is not cached either: the browser is sent to the CDN for it, where one
  over 2 MB used to show nothing. So is one the cache can't store, such as when
  writing to the data dir fails, where it used to be served without being kept.
### Security
- Anyone who could reach JagHelm's port could fill its disk through the icon
  cache, `/api/icons/cached`, which needs no login so that icons load as images.
  It fetched and kept any file up to 2 MB from jsDelivr or
  raw.githubusercontent.com, with no limit on the total, and kept the same file
  again for each different query string. It now fetches only icons of the two
  icon repositories, builds the URL it fetches itself, so query strings and other
  spellings of one icon share one file, follows a redirect only to another such
  icon, refuses a response that is not the image type its name says, and keeps
  at most 512 KB per icon and 50 MB in all. It fetches at most 8 icons at a time
  with 256 more waiting, and answers `503` past that, and holds an icon in
  memory only until it is on disk, so a flood of requests for icons not yet
  cached can no longer run it out of memory. The icons already in the cache stay
  and count toward the 50 MB.
