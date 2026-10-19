### Removed
- `GET /api/uptime/monitors`, `GET /api/prometheus/query`, `GET /api/adguard/stats`,
  `GET /api/npm/stats` and `GET /api/docker/containers`, which passed raw Uptime Kuma,
  Prometheus, AdGuard Home, Nginx Proxy Manager and Docker data through. Neither the web
  app nor the Android app called them, and they now return `404`. If a script of yours
  used one: AdGuard Home and Nginx Proxy Manager stats come from their integration
  presets in `GET /api/integrations`, each service's Uptime Kuma status and its
  container's CPU and memory come with it in `GET /api/services`, and an ad-hoc PromQL
  query goes to Prometheus itself. `JAGHELM_ALLOW_OPEN_INFRA`, which only opened these
  endpoints on a dashboard without a password, no longer does anything and can be
  removed from your environment, and so can `ADGUARD_URL`, `ADGUARD_USER` and
  `ADGUARD_PASS`, which only `/api/adguard/stats` read (the AdGuard Home preset reads
  `JAGHELM_ADGUARD_*`).
