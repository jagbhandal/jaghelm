# Error budget policy — JagHelm

This policy says what changes when error budget is burned. Without it, the SLOs
are theater. It is adapted to JagHelm's reality: a **single-maintainer hobby
project with no SLA and no on-call team**. The roles below collapse to one person
— the value is the *decision rule*, not an org chart.

## Scope

Applies to these SLOs, all sharing one compliance window:

- **target: 99.5%**
- **window_days: 28**

so the same budget states below govern each:

| SLO | target | window | budget |
|---|---|---|---|
| `slo-jaghelm-dashboard-feed-request-success-rate` ([feed-success-rate.md](feed-success-rate.md)) | 99.5% | 28d | 201.6 min |
| `slo-jaghelm-dashboard-feed-request-latency` ([feed-latency.md](feed-latency.md)) | 99.5% | 28d | 201.6 min |
| `slo-jaghelm-data-freshness` ([data-freshness.md](data-freshness.md)) | 99.5% | 28d | 201.6 min |

- **Owner:** jagbhandal
- **Review cadence:** quarterly
- **Last reviewed:** 2026-06-17 (initial)

## States and actions

Budget remaining = error budget left in the current 28-day window.

### HEALTHY (>50% budget remaining)

- Normal operation. Ship features and refactors freely.
- This is the default state for a stable single-instance dashboard.

### CAUTION (25–50% budget remaining)

- Be deliberate with risky changes (touching `refresh.js`, `cache.js`, the
  Express middleware chain, or anything in the `/api/services` path).
- Check the burn-rate trend before the next non-trivial deploy.

### CRITICAL (<25% budget remaining)

- **Soft deploy freeze** on the affected service: only SLO-improving fixes ship
  to the `/api/services` / refresh path. Unrelated changes (themes, icons, new
  presets) are fine — they don't touch the load-bearing path.
- Before merging anything to the hot path, confirm it doesn't make the SLI worse.

### VIOLATED (budget exhausted, target missed)

- **Same day:** stop the bleeding — roll back the offending change, or restart
  the container if the refresh loop wedged (`docker compose restart jaghelm`).
- **Within a few days:** write a short note in `KNOWN-ISSUES.md` (or a commit
  message) — what broke, why, what stops the recurrence. This is the
  hobby-scale equivalent of a postmortem; the point is a written cause, not
  ceremony.
- **Within the window:** ship at least one concrete follow-up that addresses the
  root cause.

## Recovery

After exiting VIOLATED, treat the service as CRITICAL until the burn rate holds
below 1× for **7 consecutive days** *and* the follow-up fix is shipped.

## Roles (single-maintainer mapping)

| Nominal SRE role | Who | Responsibility here |
|---|---|---|
| Service owner | jagbhandal | Decides state transitions; makes the fix |
| On-call | the ntfy/Gotify push | Delivers the burn-rate alert to a phone |
| Reviewer | jagbhandal (or a future contributor) | Sanity-checks hot-path changes during CRITICAL |

"Page" in the alert docs means an **ntfy or Gotify push** (both are JagHelm
integrations) — not a real pager. A ticket-severity alert can just be a GitHub
issue or a note.

## Exceptions

The soft freeze can be lifted by the owner for a **security fix** or to ship the
SLO-improving change itself. Note the reason in the commit so a future review can
see it.

## Reviewing this policy

Every quarter, alongside `slo_review.py --slo-doc docs/slos/` (must report
**0 FAIL**), ask:

1. Did I actually act on a burn-rate alert, or ignore it? (If ignored — is the
   alert wrong, or is the SLO not worth keeping?)
2. Are the 50% / 25% thresholds right for a one-user dashboard?
3. Was a target never burned (too easy → tighten) or constantly burned (too hard,
   or a real reliability bug to fix)?
4. Did the SLI still match how the app actually behaves after code changes?

Answers feed the next revision. Bump **Last reviewed** above each time.

## Composition with the rest of JagHelm

- **Alert delivery:** the burn-rate alerts ride JagHelm's own ntfy/Gotify presets
  — the dashboard alerts *itself*.
- **Feature-flag / chaos / operator hooks** from the upstream `slo-architect`
  skill don't apply at this scale (no flag system, no chaos harness, not on k8s)
  and are intentionally omitted rather than cargo-culted in.
