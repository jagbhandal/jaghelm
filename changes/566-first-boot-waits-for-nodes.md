### Fixed
- A first start while Prometheus is down, or before it has scraped any host,
  no longer leaves an empty board for good. JagHelm saves no `services.yaml`
  until it has found a node, asks Prometheus again every refresh, and adds
  the nodes as soon as there are some, with no restart or hand edit. A
  `services.yaml` that is already there, or that you save in Settings
  meanwhile, is yours and is never rediscovered over. `/api/health` says
  `discovering` while it waits, and Settings → Nodes says whether the nodes
  will come by themselves.
