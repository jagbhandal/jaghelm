# Architecture Decision Records

Short records of the load-bearing, non-obvious decisions in JagHelm — the "why"
that the code alone doesn't explain. Format: context → decision → consequences.

| ADR | Decision |
|-----|----------|
| [0001](0001-atomic-file-writes.md) | Persist all user state via atomic temp→fsync→rename writes |
| [0002](0002-in-memory-single-instance.md) | Single-instance, in-memory state (no DB) |
| [0003](0003-scoped-tls-bypass.md) | Per-request, opt-in TLS-verify bypass for self-signed infra |
| [0004](0004-config-copy-on-read.md) | Config is copy-on-read + synchronous atomic writes (no async queue) |
| [0005](0005-event-driven-deploy.md) | Event-driven build→deploy trigger (the build dispatches the deploy; opt-in, fallback-preserving) |
