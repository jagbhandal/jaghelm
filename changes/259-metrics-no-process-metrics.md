### Removed
- `/metrics` no longer exports Node.js process metrics (`process_*` and
  `nodejs_*`). Sampling the event loop every 10 ms cost about 0.2% of a CPU
  core even when idle, and the CPU and memory figures repeat what the
  container's own metrics (cAdvisor, `docker stats`) show. The request, latency,
  cache-age, refresh-loop and sign-in failure series stay; if a dashboard or
  alert of yours reads a `process_*` or `nodejs_*` series, point it at the
  container's metrics instead.
