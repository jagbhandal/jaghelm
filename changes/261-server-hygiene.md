### Added
- `JAGHELM_HOST` sets the address the server listens on. It defaults to `0.0.0.0`,
  every IPv4 interface, as before, so nothing changes unless you set it. With
  `network_mode: host`, `127.0.0.1` keeps JagHelm to its own host, for a reverse
  proxy there; in a bridge-network container keep the default (see `env.example`).
  An address the server can't listen on stops it with a `cannot listen` error.
### Fixed
- The icon cache now follows `JAGHELM_DATA_DIR`, like every other file JagHelm
  keeps; it was always written to `data/icon-cache/` next to the server. With
  `JAGHELM_DATA_DIR` unset (the shipped compose) or set to that same `data/`
  (`/app/data` in the image), the cache stays where it is and is used as before.
  With it set to another directory, the cache starts there empty: icons are fetched
  from the CDN once more as they are shown, and the old `data/icon-cache/` can be
  deleted. A container with its data volume at that other directory now keeps the
  cache on the volume, where before it was lost whenever the container was
  recreated, or kept the container from starting on a read-only root filesystem.
- A port already in use no longer leaves the server running with nothing
  listening. It now logs `cannot listen` and exits, so Docker's restart policy
  tries again.
