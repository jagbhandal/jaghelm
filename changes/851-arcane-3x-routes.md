### Fixed
- The Arcane poller works again with Arcane 3.x, which moved its API from `/api/environments` and `/api/app-version` to `/api/agents` and `/api/version`. Since the upgrade every call returned 404, so the Arcane update, prune and check jobs showed as overdue. The dry-run script and the setup doc use the new routes.
