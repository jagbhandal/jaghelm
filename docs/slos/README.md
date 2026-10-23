# JagHelm SLOs

Service Level Objectives for JagHelm, defined with the
[`slo-architect`](https://github.com/) discipline (Google SRE Workbook,
ch. 4–5: pick a user-facing SLI, set a target the system can actually sustain,
calculate the error budget, wire multi-window burn-rate alerts, and write down
what happens when the budget burns).

## Honesty note (read this first)

JagHelm is a **single-maintainer hobby project** with **no SLA** (see the README
"Status" section). These SLOs are *not* a customer promise. They exist for two
practical reasons:

1. **A self-protecting target.** JagHelm is a dashboard whose whole value prop is
   "live data, not just links". An SLO on data freshness is the difference
   between "the refresh loop quietly died three days ago" and "I noticed within
   an hour."
2. **A regression tripwire.** When the SLI is wired into Prometheus, the
   burn-rate alerts catch a deploy that breaks `/api/services` *before* the
   single user notices a blank dashboard.

Targets are deliberately **modest** (99.0–99.5%, not 99.9%+). JagHelm depends on
external systems it does not control — Prometheus, Uptime Kuma, and 35+ third-party
app APIs. A target the app can't sustain when an *upstream* is down would just be
alert noise. See each SLO's "Why this target" section.

> **Wiring status (2026-10):** the app emits these SLIs and the homelab
> Prometheus scrapes them (job `jaghelm`, every 30 s, #259). `GET /metrics`
> exposes `http_requests_total`, `http_request_duration_seconds_bucket` (with an
> `le="0.3"` bucket for the latency SLO) and `jaghelm_cache_age_seconds` in
> Prometheus format; `GET /api/readyz` reports backend reachability. The queries
> in each SLO doc resolve as written.

## SLO catalogue

| SLO | SLI type | Target / window | Error budget | What it protects |
|---|---|---|---|---|
| [`feed-success-rate`](feed-success-rate.md) | request-success-rate | 99.5% / 28d | 201.6 min | Dashboard loads at all (`GET /api/services` is 2xx) |
| [`feed-latency`](feed-latency.md) | request-latency | 99.5% / 28d | 201.6 min | Dashboard *feels* live (feed served fast from warm cache) |
| [`data-freshness`](data-freshness.md) | data-freshness | 99.5% / 28d | 201.6 min | Numbers are current, not stale (refresh loop is alive) |

Error budget policy that governs all three: [`error-budget-policy.md`](error-budget-policy.md).

## Scope boundary — what is deliberately NOT an SLO

- **Upstream availability (Prometheus / Kuma / app APIs).** JagHelm can't fix a
  down exporter. The feed-success SLO measures whether *JagHelm* answers, not
  whether every upstream is healthy — a node Prometheus can't scrape stays on
  the board as unreachable, a failed Prometheus or Kuma poll is flagged in the
  payload (`sources`), a node whose refresh throws is logged and dropped
  (`Promise.allSettled` in `refresh.js`), the surviving nodes still render, and
  the request is still a 2xx. That is the intended behaviour.
- **Per-integration correctness.** 35+ presets, each with its own auth shape and
  upstream. A `correctness` SLO per preset is more bookkeeping than a one-user
  homelab warrants. Re-evaluate if/when JagHelm grows a test suite.
- **CPU / RAM / disk of the host.** Those are *displayed* metrics, not JagHelm's
  own user-experience SLIs. Using them as an SLI is the classic anti-pattern
  (`slo_review.py` flags `cpu_as_sli`).

## Instrumentation

`server/metrics.js` exports, at `GET /metrics` (no auth, so keep it off the
public internet):

- `http_requests_total{route,method,code}` and
  `http_request_duration_seconds_bucket{route,method,le}` from an Express
  middleware mounted first in `server/index.js`, labelled by the matched route
  pattern (`/api/services`), never the raw URL;
- `jaghelm_cache_age_seconds{cache}`, sampled from `server/cache.js`
  (`Date.now() - entry.ts`) on each scrape;
- the refresh loop's `jaghelm_refresh_cycle_duration_seconds`,
  `jaghelm_refresh_errors_total` and
  `jaghelm_refresh_last_success_timestamp_seconds`, and
  `jaghelm_auth_failures_total`.

Nothing else: no Node.js process metrics (#259). prom-client's defaults sampled
the event loop every 10 ms, about 0.2% of a CPU core at idle, and their CPU and
memory half repeats what cAdvisor shows for the container.
`server/observability.test.js` fails when a series one of these docs names, or a
label value its query matches on, is not exported.

## How these were generated

```bash
SKILL=engineering-advanced-skills/slo-architect

# Per SLO: structured definition with all required fields
python scripts/slo_designer.py --service ... --sli-type ... --target ... \
  --window-days 28 --owner jagbhandal --policy-doc docs/slos/error-budget-policy.md ...

# Error budget + multi-window burn-rate alerts (all three land on 99.5% / 28d)
python scripts/error_budget_calculator.py --target 99.5 --window-days 28

# Pre-merge gate — must report 0 FAIL
python scripts/slo_review.py --slo-doc docs/slos/
```

## Review cadence

Quarterly (`slo_review.py` must report **0 FAIL** at each review). At each review
ask: was a target never burned (too easy — tighten)? Frequently burned (too hard,
or a real reliability problem)? Did burn-rate alerts fire usefully?
