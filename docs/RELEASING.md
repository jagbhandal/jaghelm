# Releasing JagHelm

JagHelm has two release lines, versioned independently:

| | Server | Android app |
|---|---|---|
| Tag | `vX.Y.Z` | `mobile-vX.Y.Z` |
| Version file | `package.json` | `mobile/package.json` |
| Changelog | `CHANGELOG.md` | `mobile/CHANGELOG.md` |
| Workflow | `.github/workflows/release.yml` ("Release") | `.github/workflows/build-apk.yml` ("Build Signed Mobile APK") |
| Published | `ghcr.io/jagbhandal/jaghelm:X.Y.Z` and a GitHub Release, marked Latest | A GitHub Release with `jaghelm-android-X.Y.Z.apk` attached, not marked Latest |

The only manual release action is pushing a tag to Gitea. CI does the rest. A
published version tag never moves and a published release page is never
rewritten; the workflows fail rather than do either.

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

## Changelog entries during development

Every PR except the release PR writes its entry as a fragment, a file of its
own that the release PR folds in, and leaves `CHANGELOG.md` and
`mobile/CHANGELOG.md` alone, so open PRs never conflict over `## [Unreleased]`:

- `changes/<issue>-<slug>.md` for a server change,
  `mobile/changes/<issue>-<slug>.md` for an Android app change.
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

`changes/README.md` and `mobile/changes/README.md` describe the same rules next
to the files. The CHANGELOG lint (step 6 below, and `check.yml` on every PR)
also checks each fragment, naming the file and line of a problem, and checks the
CHANGELOG as it would be once the fragments are folded in.

## When to release

Release when `## [Unreleased]` and the fragments in `changes/` (or
`mobile/changes/`) hold user-facing changes worth shipping. Pick
the version by [Semantic Versioning](https://semver.org/): a breaking change
(anything under "Breaking changes") is a major bump, a new feature a minor
bump, and fixes only a patch bump. Before 2.0.0, breaking changes shipped in
minor releases.

When an Android release depends on a new server version, release the server
first and give the Android section a requirement line (see below).

## 1. The release PR

One PR per release, from a branch off `main`:

1. Fold the fragments into the CHANGELOG, for each CHANGELOG that has any:

   ```bash
   node scripts/changelog-fold.mjs            # changes/ into CHANGELOG.md
   node scripts/changelog-fold.mjs --mobile   # mobile/changes/ into mobile/CHANGELOG.md
   ```

   It adds every fragment's bullets to `## [Unreleased]`, subsection by
   subsection in the canonical order, after the entries already there and in
   ascending issue-number order, then deletes the fragment files (the READMEs
   stay). Nothing else in the file changes, and with no fragments it changes
   nothing. If a fragment or the result would fail the lint, it prints the
   problems and changes nothing. Commit the CHANGELOG and the deletions
   together, and edit the folded bullets in the CHANGELOG if they need it.
2. Bump the version file: `package.json` for the server, `mobile/package.json`
   for the Android app. The workflows refuse a tag whose version differs from
   the version file at the tagged commit.
3. In the CHANGELOG, turn `## [Unreleased]` into `## [X.Y.Z] — YYYY-MM-DD`
   (em dash) and add a one-sentence summary directly under the heading. Start a
   new, empty `## [Unreleased]` above it.
4. Android only, optional: directly under the summary, add
   `Requires JagHelm server X.Y.Z or later.` The release page shows it in its
   header.
5. Update the link references at the bottom of the file: add
   `[X.Y.Z]: https://github.com/jagbhandal/jaghelm/compare/vPREV...vX.Y.Z`
   (`mobile-vPREV...mobile-vX.Y.Z` for Android) and change `[Unreleased]` to
   compare from the new tag to `HEAD`.
6. Lint and preview locally (Node built-ins only, no install needed):

   ```bash
   node scripts/changelog-lint.mjs CHANGELOG.md
   node scripts/changelog-lint.mjs --mobile mobile/CHANGELOG.md
   node scripts/release-notes.mjs server X.Y.Z --prev vPREV
   node scripts/release-notes.mjs android X.Y.Z --apk jaghelm-android-X.Y.Z.apk --sha256 pending
   ```

   The lint prints nothing and exits 0 when the file and the fragments next to
   it are valid. `check.yml` runs the same lint on every PR to `main`.
7. Server only: run `npm run test:ci` and raise `MIN_PASSING` in
   `scripts/test-floor.mjs` to the `# pass` count it prints. CI fails a run that
   passes fewer tests than this floor, so keeping it current means a silently
   dropped test is caught.

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

After the release PR is merged, and before tagging, run each workflow once by
hand on `main`. A dry run publishes nothing and writes the release page exactly
as it will appear into the run's job summary.

- **Server:** GitHub → Actions → **Release** → **Run workflow** on `main`, with
  the defaults (tag empty, `dry_run` on). It treats `main` as if it were tagged
  with its `package.json` version and runs every check: version file, CHANGELOG
  section, no unfolded fragments in `changes/`, the `:sha-<short>` image, its
  digest and cosign signature, and that `:X.Y.Z` is free. The `:sha-<short>` image of `main` must exist, so wait for
  `build-push.yml` to finish after the merge.
- **Android:** GitHub → Actions → **Build Signed Mobile APK** → **Run
  workflow** on `main`. It builds and signs a test APK (version name
  `0.0.0-dispatch.N`, version code = run number) and renders the notes for the
  `mobile/package.json` version under "Dry run — checksum is of this test
  build". While that version is untagged, unfolded fragments in
  `mobile/changes/` fail the run as they would fail the tag; once it is tagged,
  the run is a test build between releases and pending fragments are fine. A
  manual run is always a test build and never creates a release, even
  when it is started on a tag. The test APK still reports the
  `mobile/package.json` version to the server when it registers for push.

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

git tag -a mobile-vX.Y.Z -m "JagHelm Android X.Y.Z" <merge-commit>
git push <gitea-remote> mobile-vX.Y.Z
```

`<gitea-remote>` is the remote that points at the Gitea repository. The tag
reaches GitHub within seconds and starts the release workflow there.

Release tags are plain `vX.Y.Z` and `mobile-vX.Y.Z`; pre-release suffixes such
as `-rc1` are rejected. Each part of an Android version has at most three
digits, because the version code is built from them.

Push release tags one or two at a time. GitHub does not create tag push events
when more than three tags are pushed at once, so a mirror sync that carries
four or more tag updates silently skips the release workflows (see
[Recovery](#recovery)).

## 4. What CI does

**Server (`release.yml`, on a `v*` tag):**

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

**Android (`build-apk.yml`, on a `mobile-v*` tag):**

1. Checks that `mobile/package.json` has the tag's version, that
   `mobile/CHANGELOG.md` has a valid section, and that `mobile/changes/` holds
   no unfolded fragments, before the build starts.
2. Builds and signs the APK. The version name comes from the tag and the
   version code is `MAJOR × 1000000 + MINOR × 1000 + PATCH`, so each release
   installs over the previous one. The signature is verified with `apksigner`,
   and the signing material is shredded and checked for leaks before anything
   is uploaded.
3. A release job then publishes the APK as `jaghelm-android-X.Y.Z.apk`: it
   checks the downloaded build against the SHA-256 computed after signing, then
   creates the GitHub Release "JagHelm Android X.Y.Z" with the APK attached and
   its SHA-256 in the notes, not marked Latest, so the repository's Latest badge
   stays on the server release. If a release for the tag already exists, even a
   draft, the run fails without changing it.

The signing secrets are described in [mobile/KEYSTORE.md](mobile/KEYSTORE.md).

Both release checks refuse unfolded fragments, because their entries would be
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
  image runs as `node`, such as `"node":"v26.12.0"`.
- The GitHub Releases page shows the new release; Latest is the newest server
  release.
- The APK downloads from the Android release, its SHA-256 (`sha256sum`) matches
  the notes, and `apksigner verify --print-certs` shows the release key.
- The APK installs over the previous version without uninstalling it.

## Recovery

**A tag push did not start the workflow** (for example, four or more tags
arrived in one mirror sync). Server: Actions → **Release** → **Run workflow**
with `tag` set to `vX.Y.Z`, `dry_run` off and `create_release` on. This runs the
same checks and publishes as the tag push would have. Android has no
equivalent: a manual run of **Build Signed Mobile APK** is always a test build.
Push the tag again on its own: delete it on Gitea, let the mirror remove it
from GitHub, then push the same tag at the same commit.

**A release run failed** (for example, a missing secret). Fix the cause, then
re-run it from its page on GitHub. It checks out the same tag again. For
Android:

- If the build job failed, use **Re-run all jobs**.
- If the release job failed, first delete any draft release it left for the
  tag on the Releases page, because the job refuses to run while a release for
  the tag exists. Then use **Re-run failed jobs**, which publishes the same
  build. The build is kept as an artifact for 7 days; after that, use **Re-run
  all jobs** to rebuild.

**A tag was pushed on a commit whose build failed.** Nothing is published: the
release workflow cannot find the `:sha-<short>` image, or it is unsigned, and
stops before tagging. Delete the tag on Gitea, let the mirror remove it from
GitHub, fix the build, and push the tag again on the fixed merge commit.

**The `:X.Y.Z` image tag points at the wrong image.** Actions → **Release** →
**Run workflow** with `tag` set to `vX.Y.Z`, `repair` on and `create_release`
off. Run it first with `dry_run` on: the summary shows the current and the new
digest. Then run it with `dry_run` off to move `:X.Y.Z` to the `:sha-<short>`
image of the tagged commit. This is the only sanctioned way to move a
published tag. It exists for a one-time fix of `:1.4.0`, which had been rebuilt
from later code.
