# ADR 0005 — Event-driven build→deploy trigger (the build dispatches the deploy)

**Status:** accepted (opt-in; fallback-preserving)

## Context

Building and deploying live in two different systems:

- **Build** runs on GitHub Actions (`.github/workflows/build-push.yml`): on a push
  to `main` it builds the image, pushes `:latest` + `:sha-<short>` (+ the semver
  tag on a release) to GHCR, and cosign-signs it.
- **Deploy** runs on the self-hosted Gitea runner (`.gitea/workflows/deploy.yml`):
  it pulls this commit's `:sha-<short>` image and recreates the container behind a
  health gate with auto-rollback.

There is **no ordering** between them. Gitea is the source of truth and mirrors to
GitHub, so a merge to `main` fires the Gitea deploy *immediately* (on mirror-sync),
while the GitHub build only finishes pushing the image minutes later. The deploy
compensates by **polling GHCR** for the `:sha-<short>` tag for up to 6 minutes,
then falling back to `:latest`. Two costs: (1) the fallback can deploy a **stale**
`:latest` if the build is slow, and (2) the poll is wasted guessing.

## Decision

Make the build **tell the deploy when the image is ready**, instead of the deploy
guessing — but do it conservatively so the existing pipeline can never break.

- `build-push.yml` gains a final step that, **after** the image is built, pushed,
  and signed, calls the Gitea **`workflow_dispatch`** API to run the deploy now:
  `POST {GITEA_API_URL}/repos/jagbhandal/jaghelm/actions/workflows/deploy.yml/dispatches`
  with `{"ref":"main"}`.
- `deploy.yml` gains a `workflow_dispatch` trigger (so it can be dispatched) and a
  `concurrency` group (so the dispatch and the push trigger can't deploy
  concurrently during rollout).
- The dispatch step is **off by default** (`vars.DEPLOY_DISPATCH_ENABLED == 'true'`)
  and **non-fatal** (`continue-on-error: true`), and the existing `push: main`
  deploy trigger **stays as a fallback**. So with nothing configured, behavior is
  exactly as before; if the dispatch ever fails (e.g. an older Gitea without the
  dispatch API), the push trigger still deploys.

### Required configuration (to enable)

On the **GitHub** repo (`jagbhandal/jaghelm`):

| Kind | Name | Value |
|------|------|-------|
| Variable | `DEPLOY_DISPATCH_ENABLED` | `true` |
| Variable | `GITEA_API_URL` | e.g. `https://git.jagbhandal.com/api/v1` |
| Secret | `GITEA_DEPLOY_TOKEN` | a Gitea token with **write:repository** scope on an account allowed to trigger the deploy workflow |

The Gitea instance must support the `workflow_dispatch` **dispatch API** (Gitea
≥ 1.24). Verify before relying on it:

```sh
curl -i -X POST -H "Authorization: token $TOKEN" -H 'Content-Type: application/json' \
  "$GITEA_API_URL/repos/jagbhandal/jaghelm/actions/workflows/deploy.yml/dispatches" \
  -d '{"ref":"main"}'      # expect 204
```

## Rollout

1. **Phase 1 (this change):** additive and inert. The dispatch step does nothing
   until the variables/secret above are set. No behavior change.
2. **Phase 2 (operator):** set the variables/secret, push a trivial change, and
   confirm the deploy ran from the dispatch (the poll step logs an immediate hit).
   **Then remove the `push: main` trigger from `deploy.yml`** so a merge no longer
   double-deploys (event-driven becomes the only path; the health gate + rollback
   remain the backstop).

## Consequences

- When enabled, the deploy starts the instant the image is signed — no poll, no
  stale-`:latest` fallback window.
- Until Phase 2, with the dispatch enabled both triggers fire for one merge; the
  `concurrency` group serializes them and the second run simply redeploys the same
  image (idempotent, health-gated). Harmless but wasteful — hence Phase 2.
- We depend on the Gitea dispatch API, an external surface we can't exercise from
  CI. The `continue-on-error` + push-trigger fallback bound that risk to "no worse
  than today."
- We deliberately kept the `:sha-<short>` pinning and the health-gate/rollback
  exactly as-is; this ADR only changes *when* the deploy starts, not *what* it does.
