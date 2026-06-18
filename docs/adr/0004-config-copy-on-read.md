# ADR 0004 — Config is copy-on-read with synchronous atomic writes (no async queue)

**Status:** accepted

## Context

The in-memory config is read by many routes and the refresh loop, and written by
the config/integration save routes. Two hazards: (1) `getConfig()` previously
returned the live object, so a route could mutate shared state in place (diverging
memory from disk on a failed save, or leaking a resolved `_token` into the shared
object); (2) coordinating concurrent writes with the 5-second external-file
watcher.

## Decision

- **Copy-on-read:** `getConfig()` returns a `structuredClone` of the config, and
  `saveConfig()` stores a defensive clone. No caller can reach the canonical
  object, so in-place mutation is impossible by construction.
- **Synchronous atomic writes, NOT an async mutation queue.** `saveConfig` runs
  its whole pipeline (serialize → atomic temp+fsync+rename → update `lastModified`)
  in a single event-loop tick, so concurrent POST handlers can't interleave and
  the watcher (a separate tick) can never observe a half-applied state.

## Consequences

- The shared-mutable-state class of bug is eliminated, verified by tests.
- We deliberately **rejected** the async mutation queue the original plan
  suggested: it would re-open a watcher↔write race (a poll firing between the
  rename and the `lastModified` update) for no benefit, since the synchronous
  atomic write already provides crash-safety (ADR 0001) and serialization.
- Cost: a small `structuredClone` per read. The config is a few KB and reads are
  per-request (not a hot loop), so this is negligible.
