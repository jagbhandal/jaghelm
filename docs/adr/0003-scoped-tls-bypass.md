# ADR 0003 — Per-request, opt-in TLS-verify bypass for self-signed infra

**Status:** accepted

## Context

Homelab services (Proxmox, some *arr apps, internal reverse proxies) frequently
present **self-signed or internal-CA TLS certificates**. JagHelm must be able to
reach them to show live data. Disabling TLS verification globally
(`NODE_TLS_REJECT_UNAUTHORIZED=0`) would weaken **every** outbound request,
including those to public APIs — an unacceptable blast radius.

## Decision

TLS verification is **on by default**. A bypass is **opt-in per integration**
(`tlsSkip`/`skipTls`) and applied **per request** via a scoped agent, never
process-wide. The outbound chokepoint still runs the SSRF guard
(`assertSafeUrl`) on the URL regardless of the TLS flag, so skipping verification
never also opens the request to an internal-address SSRF.

## Consequences

- A user can connect to a self-signed homelab service without weakening any other
  request.
- The bypass is visible in the integration's config (auditable) and is the
  operator's explicit choice for a host they control.
- Caveat: a per-request TLS bypass still trusts the network path for that one
  host — appropriate for a LAN-local service, not for one across the internet.
