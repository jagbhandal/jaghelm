### Removed
- `GET /api/ups` is gone. The UPS's charge, load, model and runtime have been in `GET /api/status` (the `power/ups` entity) since 1.0.0, which the web and the Android app read. A script that polled `/api/ups` should read the entity instead. The Android app is retired, so there is no minimum app version to name.
- `docker.rxMB` and `docker.txMB` (a container's cumulative network counters) are no longer in `GET /api/services`; `docker.rxBytesPerSec` and `docker.txBytesPerSec` are the traffic. Prometheus is asked two fewer queries per refresh.
