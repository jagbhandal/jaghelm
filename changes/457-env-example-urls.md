### Fixed
- `env.example` no longer sets the two required URLs to `localhost`, which a
  container on the default bridge network can't reach; it now uses placeholders
  and says which addresses work.
