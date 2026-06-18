# ADR 0001 — Atomic file writes for all user state

**Status:** accepted

## Context

JagHelm persists user state to plain files (`services.yaml`, `display-config.json`,
the encrypted `secrets.json`, the admin password hash, cron history) — there is no
database (see ADR 0002). A naive `writeFileSync` can be interrupted (crash, OOM,
container kill) mid-write, leaving a truncated or empty file. For the credential
store or the admin hash, a torn write is a lockout or data-loss event.

## Decision

Every state file is written through `server/util/atomicWrite.js`:
**write to a temp sibling → `fsync` → `rename` over the target.** `rename(2)` is
atomic on POSIX filesystems, so a reader (or a restart) only ever sees the whole
old file or the whole new file, never a partial one; `fsync` before the rename
guarantees the bytes are durable before the directory entry flips. The two
credential files are written `0600`.

## Consequences

- A crash mid-write cannot corrupt or truncate any state file.
- A `mid-write-SIGKILL` chaos test (`server/config.test.js`) asserts the invariant.
- Cost: a temp file + fsync per write. State writes are infrequent (config saves,
  not a hot path), so this is negligible.
- Caveat: atomicity is per-file. Cross-file consistency (e.g. config + secrets in
  one logical change) is not transactional — acceptable for a single-user app.
