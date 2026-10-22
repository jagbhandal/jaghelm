# ADR 0007 — Production converges on main's head (a scheduled reconcile)

**Status:** accepted (#534, 2026-10-22). Supersedes
[ADR 0005](0005-event-driven-deploy.md).

## Context

The image is built on GitHub, after Gitea's push mirror delivers the commit;
the deploy runs on Gitea's runner on vm-103, triggered by the push to `main`.
Nothing orders the two. The deploy waited up to 6 minutes for the commit's
`:sha-<short>` image and then failed red (#356 removed the old fallback to a
stale `:latest`, rightly).

On 2026-10-22 the mirror lagged about 7 minutes, and replayed intermediate
heads while it caught up. Deploys 5464, 5474 and 5476 went red although
nothing was wrong: the images landed after the wait, or were never built for a
commit main had already moved past. Nothing then deployed 32257bc until a
deploy was re-run by hand, because ADR 0005's dispatch (the build telling
Gitea to deploy) had never been switched on. A red deploy that means nothing
teaches us to ignore red deploys.

Options:

1. **A longer wait.** Mirror lag has no bound, so any wait can be too short,
   and a long one holds the deploy queue.
2. **ADR 0005's dispatch, then drop the push trigger.** The deploy starts when
   the image is signed. It needs a Gitea token with write access stored as a
   GitHub secret, and GitHub reaching Gitea's API from the internet. A
   dispatch that is lost (Gitea down, token expired) deploys nothing, and
   nothing notices.
3. **A reconcile on Gitea's own runner.** Every few minutes, compare what
   vm-103 serves with main's head and deploy the difference. GitHub needs no
   secret and nothing is exposed: the runner already reads GHCR and Gitea. It
   also repairs whatever left production behind, not only a late image.

## Decision

Option 3. **Reconcile production** (`.gitea/workflows/reconcile.yml`) runs
every 5 minutes and by hand. It reads `/api/health`'s `revision` over HTTP
from the runner (over SSH only if that fails) and main's head from the Gitea
API:

- the same: one log line, no SSH, no pull;
- behind, and main's head has its image: deploy main's head;
- behind, no image: wait quietly, then **fail 30 minutes after the commit**,
  naming the GitHub build to check (it failed, or never ran);
- `/api/health` not answering: fail, change nothing.

It deploys with the same steps as the push deploy: both workflows run
`scripts/deploy/deploy.sh`, one command per step (pin, stage, switch, health
gate, rollback, prune), and share the concurrency group
`deploy-jaghelm-production`, so they never race. The runner has no checkout,
so each run reads `deploy.sh` at its own commit from the Gitea API, as the
stage already read `compose.yaml`.

The push deploy stays the fast path. Each round of its wait checks whether
main has moved past its commit (green, "Superseded by …"); when its wait runs
out it ends green, "Image not built yet; the reconcile ships it when it is".
Neither touches vm-103. Red now means a real failure: a build missing for 30
minutes, or a stage, switch or health gate failure (rolled back as before).

A deploy that failed after reaching vm-103 writes its commit to
`deploy-failed` in the stack directory. Scheduled runs don't retry that
commit, so a bad build is tried once instead of being recreated and rolled
back every 5 minutes. A healthy deploy removes the file; a run started by hand
retries the commit.

ADR 0005's dispatch step is removed from `build-push.yml`, with its
`workflow_dispatch` trigger on `deploy.yml`: it was never enabled, and a
manual deploy is now a manual run of the reconcile.

## Consequences

- A merge is live within about 6 minutes when its image is built in time,
  otherwise within 5 minutes of the image landing.
- 288 reconcile runs a day appear in the Actions list (filter by workflow to
  see the deploys alone). Gitea creates a run for every schedule tick, and a
  job can't decide to skip itself before it starts, so no-op runs can't be
  kept out. Each takes a few seconds on vm-103's runner.
- A newer run waiting in the concurrency group replaces an older waiting one,
  which Gitea then shows as cancelled (grey, not red).
- Production follows `main`. A manual rollback to another commit lasts until
  the next scheduled run, unless the reconcile is disabled first (Actions →
  Reconcile production → Disable workflow); re-enable it to return to `main`.
  A revert merged on `main` is the lasting rollback.
- The commit time is the one Gitea reports for main's head; for the merge
  commits this repo uses, that is the merge.
