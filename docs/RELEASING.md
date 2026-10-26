# Releasing JagHelm

JagHelm has one release line, the server:

| | Server |
|---|---|
| Tag | `vX.Y.Z` |
| Version file | `package.json` |
| Changelog | `CHANGELOG.md` |
| Workflow | `.github/workflows/release.yml` ("Release") |
| Published | `ghcr.io/jagbhandal/jaghelm:X.Y.Z` and a GitHub Release, marked Latest |

The Android app was a second line (`mobile-vX.Y.Z`, built by `build-apk.yml`). It
is retired (#659) and has no releases under the current numbering.

The only manual release action is pushing a tag to Gitea. CI does the rest. A
published version tag never moves and a published release page is never
rewritten; the workflows fail rather than do either.

## Versioning history

Versioning restarted at 1.0.0 on 2026-10-25, for the redesigned product. The
earlier numbering (1.0.0 to 3.0.0, and the Android `mobile-v*` line) is archived
in [docs/history/CHANGELOG-pre-1.0.md](history/CHANGELOG-pre-1.0.md); git
history is unchanged. The old tags, releases and image tags were deleted before
the first 1.0.0 dry run, so a `vX.Y.Z` tag now means the new numbering only. The
1.0.0 release is the first with no previous tag: its notes link to the
CHANGELOG instead of a compare view, and its CHANGELOG link references point at
the release page.

## Image tags

| Tag | Points to | Moves? |
|---|---|---|
| `:latest` | The most recent build of `main` | Yes, on every merge |
| `:sha-<short>` | The build of one `main` commit | Per build; normally stable |
| `:X.Y.Z` | The `:sha-<short>` image of the tagged commit, by digest | No |

`build-push.yml` builds, tests and cosign-signs every push to `main` and
publishes `:latest` and `:sha-<short>`. A release never rebuilds: `release.yml`
adds `:X.Y.Z` to the image that `main` already built, so the released bytes are
the ones that were deployed from that commit.

`image-check.yml` (GitHub) builds the same image, without pushing, on every
branch except `main`, so a Dockerfile that does not build fails before the
merge. The mirror pushes the branch to GitHub; the run appears under that
branch's commits and Actions tab there, not among the PR's checks on Gitea.
Look at it before merging a Dockerfile or dependency change (a lockfile bump
can break `npm ci` in the build).

## Production deploys

Production converges on `main`'s head ([ADR 0007](adr/0007-reconcile-deploy.md)).
Two Gitea workflows put a commit's `:sha-<short>` image on vm-103, with the
same steps (`scripts/deploy/deploy.sh`), one at a time. Neither ever deploys
`:latest` instead.

- **Deploy JagHelm** (`.gitea/workflows/deploy.yml`) runs on every merge to
  `main`: the fast path. It waits up to 6 minutes (`IMAGE_WAIT_SECONDS`) for
  the commit's image, then deploys it.
- **Reconcile production** (`.gitea/workflows/reconcile.yml`) runs every 5
  minutes. When vm-103's `/api/health` reports `main`'s head as `revision`, it
  logs one line and stops. Otherwise it deploys `main`'s head once its image
  exists.

So a merge is live about 6 minutes after it, when its image is built in time;
otherwise within 5 minutes of the image landing.

What a run means:

- **Green, "Deploy verified healthy"**: `/api/health` reports that commit as
  `revision`. It is live.
- **Green, "Superseded by `<sha>`"**: `main` had moved on, so the run changed
  nothing; the later commit's deploy, or the reconcile, ships it. Re-running an
  old deploy is safe: it never puts an older build over a newer one.
- **Green, "Image not built yet; the reconcile ships it when it is"**: the
  image was not there within 6 minutes (mirror lag, a slow build). Nothing
  changed; the reconcile deploys it when the image lands.
- **Green, "nothing to do"** or **"has no image yet"** (reconcile): vm-103
  already runs `main`'s head, or its build is still under way.
- **Green with a warning, "failed its deploy on vm-103"** (reconcile): `main`'s
  head failed a deploy or was rolled back by hand, and is named in
  `/opt/stacks/jaghelm/deploy-failed`, so scheduled runs leave it alone instead
  of retrying every 5 minutes. Merge a fix, or once the cause is fixed, **Run
  workflow** on Reconcile production (a run by hand retries it). A healthy
  deploy removes the file.
- **Green with a warning, "could not read /api/health"** (reconcile): JagHelm
  on vm-103 doesn't answer, over HTTP or SSH. The reconcile can't tell what
  runs, so it changes nothing; Uptime Kuma pages when JagHelm is down.
- **Grey, cancelled**: a newer run in the same queue replaced it; that one
  ships `main`.
- **Red, "has no image … after its commit"** (reconcile): 30 minutes after the
  commit, its image still does not exist. Its GitHub **Build and Push Docker
  Image** run failed, or never ran because the mirror did not push the commit.
  Nothing on vm-103 changed. Open the build from the link in the error line,
  re-run it or merge a fix; the next reconcile run deploys it once the image
  exists. Every run goes red until then.
- **Red at the stage step** (the pull, or `compose.yaml` refused) changed
  nothing on vm-103: a failed pull happens before anything is delivered, and a
  refused `compose.yaml` is put back before the container is touched. The next
  reconcile run retries a failed pull; a refused `compose.yaml` holds the
  commit back, as below.
- **Red at the switch or the health gate** (including a `revision` that is not
  this commit) means vm-103 was rolled back to the image and `compose.yaml` it
  had before, unless a later deploy has replaced it since; then the rollback
  leaves it alone. The step's `::error::` line says why. Either way, the commit
  is held back from the reconcile (above): fix the cause, then re-run the
  deploy, or merge a fix.
- **Red, "could not read" deploy.sh or `main`'s head**: Gitea's API did not
  answer; nothing changed. Re-run it (the reconcile tries again by itself).

**Manual rollback to a known commit.** Never automatic. The lasting way is a
revert merged on `main`, which deploys like any merge. To run an earlier
commit by hand meanwhile, on vm-103, with `<bad>` the first seven characters of
the commit you are leaving (`main`'s head, the `revision` `/api/health` reports
now) and `<short>` those of a commit whose image you trust:

```bash
cd /opt/stacks/jaghelm && echo <bad> > deploy-failed && docker pull ghcr.io/jagbhandal/jaghelm:sha-<short> && docker tag ghcr.io/jagbhandal/jaghelm:sha-<short> ghcr.io/jagbhandal/jaghelm:latest && docker compose up -d --force-recreate
```

`deploy-failed` holds `<bad>` back from the reconcile: its scheduled runs warn
and leave vm-103 alone until a new commit merges, whose healthy deploy removes
the file. Without it the reconcile deploys `<bad>` again within 5 minutes. The
command keeps the host's current `compose.yaml`; when rolling back across a
`compose.yaml` change, first copy that commit's `compose.yaml` into
`/opt/stacks/jaghelm` too. `/api/health` then reports `<short>` as `revision`,
until the next merge deploys over it.

## Changelog entries during development

Every PR except the release PR writes its entry as a fragment, a file of its
own that the release PR folds in, and leaves `CHANGELOG.md` alone, so open PRs
never conflict over `## [Unreleased]`:

- `changes/<issue>-<slug>.md` for a change.
- The content is one or more subsections from
  [The CHANGELOG format](#the-changelog-format), in that order, each with its
  bullets, and nothing else (no summary or requirement line). For example,
  `changes/245-access-log.md`:

  ```markdown
  ### Fixed
  - The server's access log now records API requests with their full path.
  ```

- A PR with no user-facing change (internal CI, tests, refactors) adds no
  fragment.

`changes/README.md` describes the same rules next to the files. The CHANGELOG lint (step 5 below, and `check.yml` on every PR)
also checks each fragment, naming the file and line of a problem, and checks the
CHANGELOG as it would be once the fragments are folded in.

## When to release

Release when `## [Unreleased]` and the fragments in `changes/` hold
user-facing changes worth shipping. Pick
the version by [Semantic Versioning](https://semver.org/): a breaking change
(anything under "Breaking changes") is a major bump, a new feature a minor
bump, and fixes only a patch bump.

## 1. The release PR

One PR per release, from a branch off `main`:

1. Fold the fragments into the CHANGELOG:

   ```bash
   node scripts/changelog-fold.mjs            # changes/ into CHANGELOG.md
   ```

   It adds every fragment's bullets to `## [Unreleased]`, subsection by
   subsection in the canonical order, after the entries already there and in
   ascending issue-number order, then deletes the fragment files (the READMEs
   stay). Nothing else in the file changes, and with no fragments it changes
   nothing. If a fragment or the result would fail the lint, it prints the
   problems and changes nothing. Commit the CHANGELOG and the deletions
   together, and edit the folded bullets in the CHANGELOG if they need it.
2. Bump the version in `package.json`. The workflow refuses a tag whose
   version differs from the version file at the tagged commit. Bump the image pin in
   `README.md` and `docs/examples/quickstart/compose.yaml` to the new version.
3. In the CHANGELOG, turn `## [Unreleased]` into `## [X.Y.Z] — YYYY-MM-DD`
   (em dash) and add a one-sentence summary directly under the heading. Start a
   new, empty `## [Unreleased]` above it.
4. Update the link references at the bottom of the file: add
   `[X.Y.Z]: https://github.com/jagbhandal/jaghelm/compare/vPREV...vX.Y.Z`
   and change `[Unreleased]` to
   compare from the new tag to `HEAD`.
5. Lint and preview locally (Node built-ins only, no install needed):

   ```bash
   node scripts/changelog-lint.mjs CHANGELOG.md
   node scripts/release-notes.mjs server X.Y.Z --prev vPREV
   ```

   Leave out `--prev` when there is no previous tag (the first release); the
   notes then link to the CHANGELOG at the tag. The release workflow does this
   by itself.

   The lint prints nothing and exits 0 when the file and the fragments next to
   it are valid. `check.yml` runs the same lint on every PR to `main`.
6. Raise `MIN_PASSING` in `scripts/test-floor.mjs` to the
   `# pass` count of the release PR's CI run (its "Tests (backend, node:test)"
   step). CI fails a run that passes fewer tests than this floor, so keeping
   it current means a silently dropped test is caught. Take the count from CI,
   not from a local `npm run test:ci`: CI runs as root, which skips the tests
   that need a file root can still read or write (a handful, ten in October 2026), so a
   local run as a normal user passes that many more.

### The CHANGELOG format

Each version section has a one-sentence summary and then only these
subsections, in this order, omitting empty ones: `Breaking changes`, `Added`,
`Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`. One bullet per change,
written for someone running JagHelm: what changed and what they need to do.
Breaking changes include the migration step. No emoji, marketing headlines,
test counts or notes on how the work was produced, and no internal CI or
deploy-pipeline changes (those are in the git history). Bullets may be
hard-wrapped; do not use nested bullets or code blocks inside bullets. The lint
checks structure and emoji; tone is a review concern. A fragment follows the
same rules for its subsections and bullets, and has no summary line.

## 2. Dry run

After the release PR is merged, and before tagging, run the workflow once by
hand on `main`. A dry run publishes nothing and writes the release page exactly
as it will appear into the run's job summary.

- GitHub → Actions → **Release** → **Run workflow** on `main`, with
  the defaults (tag empty, `dry_run` on). It treats `main` as if it were tagged
  with its `package.json` version and runs every check: version file, CHANGELOG
  section, no unfolded fragments in `changes/`, the `:sha-<short>` image, its
  digest and cosign signature, and that `:X.Y.Z` is free. The `:sha-<short>` image of `main` must exist, so wait for
  `build-push.yml` to finish after the merge.

## 3. Tag on Gitea

Tags are created on **Gitea only**. GitHub is a push mirror of Gitea, and the
mirror deletes any ref that exists only on GitHub, so a tag or release created
on GitHub disappears at the next sync. Never create a tag or a release in the
GitHub UI.

Tag the merge commit of the release PR (the commit `build-push.yml` built) and
push each tag on its own:

```bash
git fetch <gitea-remote>
git tag -a vX.Y.Z -m "JagHelm X.Y.Z" <merge-commit>
git push <gitea-remote> vX.Y.Z
```

`<gitea-remote>` is the remote that points at the Gitea repository. The tag
reaches GitHub within seconds and starts the release workflow there.

Release tags are plain `vX.Y.Z`; pre-release suffixes such as `-rc1` are
rejected.

Push release tags one or two at a time. GitHub does not create tag push events
when more than three tags are pushed at once, so a mirror sync that carries
four or more tag updates silently skips the release workflow (see
[Recovery](#recovery)).

## 4. What CI does

**`release.yml`, on a `v*` tag:**

1. Checks that the tagged commit is on `main` and that `package.json` has the
   tag's version.
2. Renders the release notes from `CHANGELOG.md`. A missing or malformed
   section, or a fragment left unfolded in `changes/`, stops the release here,
   before anything is published.
3. Waits, up to 15 minutes, for `ghcr.io/jagbhandal/jaghelm:sha-<short>` of the
   tagged commit, so a tag pushed seconds after the merge does not fail.
4. Resolves that image's digest. If `:X.Y.Z` already exists at the same digest,
   the image step is a no-op; at a different digest, the run fails.
5. Verifies the cosign signature on the digest (waiting up to 5 minutes for
   it), then adds `:X.Y.Z` to that digest as a byte-for-byte copy. No rebuild,
   no re-signing: the signature on the digest covers the new tag.
6. Creates the GitHub Release "JagHelm X.Y.Z" from the rendered notes and marks
   it Latest. If a release for the tag already exists, the run fails without
   changing it.

The job summary records the commit, digest, signature status and outcome.

The release refuses unfolded fragments, because their entries would be
missing from the release page. A fragment can also land after the fold: a PR
that merges while the release PR is open. If the dry run reports fragments that
landed after the fold, open a follow-up PR that runs the fold and moves the new
bullets from `[Unreleased]` into `[X.Y.Z]`, then tag that merge commit.

## 5. Verify

- The digest of `:X.Y.Z` equals the digest of `:sha-<short>` for the tagged
  commit, and the image running in production:

  ```bash
  docker buildx imagetools inspect ghcr.io/jagbhandal/jaghelm:X.Y.Z
  docker buildx imagetools inspect ghcr.io/jagbhandal/jaghelm:sha-<short>
  ```

- The signature verifies:

  ```bash
  cosign verify ghcr.io/jagbhandal/jaghelm:X.Y.Z \
    --certificate-identity-regexp 'https://github.com/jagbhandal/jaghelm/.*' \
    --certificate-oidc-issuer https://token.actions.githubusercontent.com
  ```

- `/api/health` on the deployed server returns `"version":"X.Y.Z"` and the
  tagged commit's short SHA as `revision`.
- The server's `listening` startup log line (in Loki) shows the Node version the
  image runs as `node`, such as `"node":"v26.12.1"`.
- The GitHub Releases page shows the new release; Latest is the newest server
  release.

## Recovery

**A deploy is red.** See [Production deploys](#production-deploys).

**A tag push did not start the workflow** (for example, four or more tags
arrived in one mirror sync): Actions → **Release** → **Run workflow**
with `tag` set to `vX.Y.Z`, `dry_run` off and `create_release` on. This runs the
same checks and publishes as the tag push would have. Push the tag again on its own: delete it on Gitea, let the mirror remove it
from GitHub, then push the same tag at the same commit.

**A release run failed** (for example, a missing secret). Fix the cause, then
re-run it from its page on GitHub. It checks out the same tag again.

**A tag was pushed on a commit whose build failed.** Nothing is published: the
release workflow cannot find the `:sha-<short>` image, or it is unsigned, and
stops before tagging. Delete the tag on Gitea, let the mirror remove it from
GitHub, fix the build, and push the tag again on the fixed merge commit.

**The `:X.Y.Z` image tag points at the wrong image.** Actions → **Release** →
**Run workflow** with `tag` set to `vX.Y.Z`, `repair` on and `create_release`
off. Run it first with `dry_run` on: the summary shows the current and the new
digest. Then run it with `dry_run` off to move `:X.Y.Z` to the `:sha-<short>`
image of the tagged commit. This is the only sanctioned way to move a
published tag. It exists for a one-time fix of a tag whose image had been
rebuilt from later code.
