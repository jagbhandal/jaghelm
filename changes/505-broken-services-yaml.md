### Fixed
- A `services.yaml` that doesn't parse no longer looks like an empty, healthy
  board. The header and the attention panel say "services.yaml doesn't parse
  (line 4)", with the line, the phone gets one "JagHelm config broken" alert
  after about a minute (whatever your category switches say) and one "JagHelm
  config fixed" when the file loads again, and `/api/health` has a `config`
  field: `unparseable` with the line while it lasts, `ok` otherwise. The same
  goes for a `services.yaml` that is empty or isn't a mapping. None of it
  quotes the file.
