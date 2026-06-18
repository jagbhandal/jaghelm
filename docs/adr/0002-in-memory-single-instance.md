# ADR 0002 — Single-instance, in-memory state (no database)

**Status:** accepted

## Context

JagHelm is a personal homelab dashboard for one operator. Its data is small (a
config file, a warm cache of metrics, a handful of sessions). The deployment is a
single Docker container.

## Decision

Keep all runtime state **in memory** (response cache, sessions, refresh-loop
state, rate-limiter buckets) and persist only the user config/secrets to files
(ADR 0001). Do **not** introduce a database or a shared cache. Run as a **single
instance**.

## Consequences

- Drastically simpler: no DB to run, migrate, back up, or secure; no ORM.
- A restart clears the cache (re-warmed by the background refresh loop within one
  cycle) and invalidates sessions (re-login) — acceptable for one user.
- **Horizontal scaling is out of scope**: two instances would not share sessions,
  cache, or the rate-limiter's global counter, and both would write the same
  files. The bounded in-memory maps (cache, limiter) have FIFO/size caps so a
  single instance can't be memory-exhausted, but the design assumes one replica.
- Documented as a known constraint in KNOWN-ISSUES.md.
