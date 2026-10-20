### Fixed
- The README and the getting-started guide now show the `compose.yaml` JagHelm
  ships: a bridge network with port 3099 published and the container hardening,
  plus the step that makes `data/` and `uploads/` writable by the app's user.
  They used to call host networking the default.
