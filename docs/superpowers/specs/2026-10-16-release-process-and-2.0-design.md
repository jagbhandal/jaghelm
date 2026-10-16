# Release process, overdue jobs, and the 2.0.0 release — design

**Date:** 2026-10-16
**Status:** approved by Jag 2026-10-16. Out of scope: reaching the server without Tailscale (#193).
**Scope:** three pieces that ship together as JagHelm 2.0.0 and JagHelm Android 1.1.0:
(A) a standard release process for the server image and the Android app,
(B) overdue detection for scheduled jobs, (C) a "can't reach server" screen in the
Android app.

Decisions Jag made are marked **(Jag)**. Everything else is a design call made in
this document and is open to review.

---

## 1. Intent

The GitHub mirror is the project's public face, and it is public and should
read as a maintained project. Today the release history is inconsistent:

- Server release pages exist only on GitHub, each formatted differently, in a
  promotional tone, with references to how the work was produced. 1.1, 1.2 and
  1.3 were all published the same day; 1.0.0 and 1.4.0 have no page.
- Android release records exist only on Gitea, and they are empty: no notes, no
  APK. Build artifacts expire after 7 days, so no released APK survives anywhere.
- `ghcr.io/jagbhandal/jaghelm:1.4.0` contains the 1.5.0 code (OCI revision label
  `45aa70f`, same as `:1.5.0`). Root cause: the 1.4.0 release was created in the
  GitHub UI with a new tag `1.4.0`; the Gitea → GitHub `--mirror` sync deleted that
  GitHub-only tag, and a later re-publish rebuilt it from `main` HEAD.
- Release builds rebuild the image and re-push `:latest` and `:sha-<short>`, so the
  "immutable" `:sha-*` tag is not immutable (`:sha-8e8a6f9` was overwritten by the
  1.4.0 release build). A stray git tag named `latest` once triggered a release
  build that put April's code on `:latest`.
- `/api/health` on production reports `1.5.0` while running 44 commits later.
- The CHANGELOG's Unreleased section covers one of the changes since 1.5.0.

Separately, two silent-failure modes found on 2026-10-09/10 remain open:

- A scheduled job that stops reporting (cron removed, host down, script dies
  before reporting) stays green on the dashboard forever.
- The Android app shows a blank gray screen, indefinitely, when it cannot reach
  the server at launch (the startup auth check has no timeout and nothing renders
  until it resolves).

**What success looks like:** the GitHub Releases page shows two clean,
consistently formatted releases (JagHelm 2.0.0, JagHelm Android 1.1.0) with a
downloadable APK; every version tag points at exactly the code it names; future
releases come out the same way without anyone hand-editing a release page; a
missed nightly backup produces a phone notification the same morning; the app
never shows a blank screen at launch.

## 2. Goals, non-goals, anti-goals

**Goals**

1. One manual release action: push a tag to Gitea. CI does the rest.
2. Server releases publish the image that `main` already built, by digest: no
   rebuild, so the released bytes are the ones production already ran.
3. Every release page is generated from the CHANGELOG in one standard format
   (§3.4). The CHANGELOG format is linted before merge, so it cannot drift.
4. Android releases attach the signed APK permanently to a GitHub Release.
5. Version tags never move once published.
6. Overdue detection for scheduled jobs, opt-in per job.
7. A clear connection screen when the app cannot reach the server at launch.

**Non-goals**

- Play Store distribution, iOS, auto-update inside the app.
- Re-creating release pages for 1.0.0–1.5.0. History lives in the CHANGELOG and the
  tags. (Recreated pages would all show tonight's date and read as a bulk backfill.)
- Deleting old `mobile-v*` tags, including those whose builds failed.
- SBOM/provenance attestations, re-enabling Trivy, Renovate.
- Connectivity UX after the app has started (the existing "NO SIGNAL" state covers it).
- Repository polish beyond releases (README overhaul, internal working files).

**Anti-goals** (failures even if everything technically works)

- A released image whose digest differs from the image built and deployed from
  that commit.
- Any published version tag (git or image) changing what it points to, outside the
  one documented repair in §3.6.
- A release page edited by hand, or release notes in a promotional voice.
- Overdue alerts for jobs that never opted in, or repeated alerts for the same
  overdue episode.
- The app hanging silently in any startup failure path.

## 3. Release process (piece A)

### 3.1 Constraints

- Gitea is the source of truth; GitHub is a `--mirror` push mirror
  (`sync_on_commit`, no interval). **Any ref that exists only on GitHub is deleted
  on the next sync.** Tags must be created on Gitea, never on GitHub.
- A tag pushed to Gitea reaches GitHub within seconds (observed: `mobile-v1.0.7`
  created 21:05:37, GitHub run started 21:05:41).
- Builds run on GitHub Actions; deploys run on Gitea Actions (self-hosted runner).
- No GitHub credential exists on MS-S1. Any one-off step that writes to GitHub
  (deleting old release pages, dispatching a workflow) is done by Jag in the
  GitHub UI.
- The Gitea repo is private; the GitHub repo and GHCR image are public.

### 3.2 Versions and tags

- Server: `vMAJOR.MINOR.PATCH`, version in root `package.json`. Next: **2.0.0 (Jag)**,
  a major bump because the Nextcloud integration change is breaking and the
  CHANGELOG commits to semantic versioning.
- Android: `mobile-vMAJOR.MINOR.PATCH`, version in `mobile/package.json`. Next:
  **1.1.0 (Jag)**. `mobile/package.json` currently says 1.4.0 and is unused; it
  becomes the checked source of truth (the APK's `versionName`/`versionCode` stay
  derived from the tag, and CI fails if tag and file disagree).
- The release workflows refuse to run when the tag's version does not equal the
  version file at that commit, or when the CHANGELOG has no section for it.

### 3.3 Server release flow

Trigger: `push: tags: ['v*']` on GitHub (arrives via the mirror).

1. Resolve the tag's commit and its short SHA. Fail unless that commit is
   reachable from `origin/main`.
2. Check `package.json` version == tag version, and that `CHANGELOG.md` has a
   section for it (via the notes script, §3.4).
3. Wait, bounded (15 min, poll), for `ghcr.io/jagbhandal/jaghelm:sha-<short>`.
   The tag is normally pushed after the merge build finishes, but a tag pushed
   within seconds of the merge must not fail.
4. Resolve that image's digest. If `:<version>` already exists: succeed as a
   no-op when it has the same digest; fail when it has a different digest (tags
   never move).
5. Add the tag `:<version>` to the existing digest
   (`docker buildx imagetools create --tag … <repo>@<digest>`). No rebuild. The
   cosign signature is attached to the digest, so the version tag is covered
   without re-signing; the workflow runs `cosign verify` on `:<version>` as a check.
6. Create the GitHub Release (`gh release create`, `GITHUB_TOKEN` with
   `contents: write`), title `JagHelm <version>`, body from the notes script,
   marked Latest. If a release for the tag already exists, fail without changing
   it (a re-pushed or moved tag must never silently rewrite a published page).

`build-push.yml` changes:

- Remove the `release: published` trigger and the tag branch of the tag-computing
  step. It runs only on pushes to `main` and publishes only `:latest` and
  `:sha-<short>`.
- Pass `IMAGE_VERSION` = the `package.json` version (not `sha-<short>`), so the
  OCI version label matches the release when that commit is released.
- Fix the dormant Gitea dispatch URL (`repos/jagbhandal/jaghelm` →
  `repos/jagdeep.bhandal/JagHelm`). It stays opt-in and off.

### 3.4 Release notes and the CHANGELOG standard (approved by Jag, format shown 2026-10-16)

CHANGELOG section shape:

```markdown
## [2.0.0] — 2026-10-16

One sentence summarizing the release.

### Breaking changes
- …
### Added
### Changed
### Deprecated
### Removed
### Fixed
### Security
```

Rules (enforced by a lint script in `check.yml` and the release workflows):

- Allowed subsections, in exactly the order above. Empty subsections are omitted.
- A one-sentence summary line directly under the version heading.
- One bullet per change, written for someone running JagHelm: what changed and
  what they need to do. Breaking changes include the migration step.
- No emoji. No marketing headlines, no test counts, no mention of how the work was
  produced. Internal CI and deploy-pipeline changes are left out (they are in the
  git history).
- The linter checks structure and emoji mechanically; tone is a review concern.

Generated release page (by `scripts/release-notes.mjs`, unit-tested):

- Server: header line `<date> · v<version> · ghcr.io/jagbhandal/jaghelm:<version>`,
  then the summary and subsections verbatim, then a footer with
  `docker pull ghcr.io/jagbhandal/jaghelm:<version>`, "Image signed with cosign
  (keyless)", and the compare link from the previous `v*` tag.
- Android: header line `<date> · mobile-v<version>`, plus the requirement line when
  present, then the summary and subsections, then a footer naming the APK file, its
  SHA-256, and one install sentence.

Android requirement line (design call): `mobile/CHANGELOG.md` sections may carry one
optional line directly under the summary, exactly of the form
`Requires JagHelm server <version> or later.` The notes script moves it into the
header (as in the approved mockup); the lint allows it only in `mobile/CHANGELOG.md`.
1.1.0 uses it (`Requires JagHelm server 2.0.0 or later.`), because the overdue display
and the Watchtower toggle need the 2.0.0 server.

Android notes come from a new `mobile/CHANGELOG.md` with the same format. It gets
a 1.1.0 section and a condensed 1.0.0 entry covering the 1.0.x rollout (2026-06-26
to 06-27), reconstructed from git history between the `mobile-v*` tags.

Existing CHANGELOG sections 1.0.0–1.5.0 are rewritten to the same standard
(same facts, concise, neutral). Version headings gain compare links at the bottom
of the file.

### 3.5 Android release flow

`build-apk.yml`, on `mobile-v*` tags (the `workflow_dispatch` test-build path is
unchanged and never creates a release):

1. Check `mobile/package.json` version == tag version and that
   `mobile/CHANGELOG.md` has the section (before the expensive build).
2. Build and sign as today; verify the signature as today.
3. Rename the APK to `jaghelm-android-<version>.apk`; compute its SHA-256.
4. Create the GitHub Release in one `gh release create` call with the APK attached:
   title `JagHelm Android <version>`, body from the notes script, `--latest=false` so
   the repository's Latest badge stays on the server release. If a release for the
   tag already exists, fail without changing it.
5. Job permissions become `contents: write` (needed for the release); the existing
   secret shredding and leak guard stay before any upload.

The APK is public on the GitHub Release **(Jag)**. It contains
`google-services.json` (Firebase client config, designed to ship in apps; sending
notifications needs the server-side service-account key, which never leaves
vm-103).

### 3.6 One-time cleanup and backfill

Order matters; see §6.

- Push annotated tags to Gitea: `v1.0.0` at `15db69c` (the commit the 1.0.0 release
  build used) and `v1.4.0` at `8e8a6f9`. This happens **before** the new release
  workflow lands: the current workflows ignore `v*` tag pushes, so the backfill
  cannot trigger a release.
- Repair `:1.4.0` to point at `:sha-8e8a6f9`'s digest. The release workflow gets a
  `workflow_dispatch` path (inputs: `tag`, `create_release` default false,
  `repair` default false) that runs steps 1–5 of §3.3 for an existing tag; `repair`
  allows step 4 to move a tag. This is the only sanctioned way to move a published
  tag and is documented as such. Jag runs it once from the GitHub Actions UI.
  (`:1.0.0` already exists and needs nothing: no `:sha-15db69c` was ever published.)
- Delete all existing release records: GitHub `v1.1.0`, `v1.2.0`, `v1.3.0`,
  `v1.5.0`, and the orphaned 1.4.0 draft (Jag, GitHub UI; deleting a release keeps
  its tag); Gitea `latest` and the seven empty `mobile-v1.0.x` records (via API).
- Delete the git tag `latest` on Gitea (the mirror removes it from GitHub). The GHCR
  `:latest` image tag is unrelated and unaffected.

### 3.6a Who does what, and why there is no tag-protection rule

- Every git tag push and every Gitea deletion in this document is done by Claude
  **only after Jag says go in chat for that specific step**: each one is public
  within seconds. GitHub UI steps (deleting old release pages, dispatching
  workflows) are Jag's, since there is no GitHub credential on MS-S1.
- No Gitea protected-tags rule (design call): Claude and Jag both push as the same
  Gitea user, so a protection rule could not tell them apart. Immutability is
  enforced where it can be: image tags never move (§3.3 step 4) and existing
  release pages are never rewritten (§3.3 step 6, §3.5 step 4).

### 3.6b Rehearsal before the real tags (design call)

A rehearsal tag would mirror to the public repository instantly, so there is none.
Instead both release workflows get a `dry_run` dispatch input. A dry run evaluates
the dispatched ref (normally `main`) as if it were tagged with the version in its
version file: it runs every check, resolves the image digest (server) or builds and
signs the APK (Android), and writes the exact rendered release page into the run's
job summary. It publishes nothing: no image tag, no release, no upload beyond the
existing short-lived build artifact. Jag runs each dry run once after PR D merges
and before the tags are pushed; it doubles as a preview of what will go public.
The `:1.4.0` repair dispatch (§3.6) additionally exercises the real image-tagging
path once before 2.0.0.

### 3.7 Version reporting

- The image records its commit: `ENV JAGHELM_REVISION=${IMAGE_REVISION}` in the
  Dockerfile runtime stage.
- `server/version.js` exports `REVISION` (env, fallback `unknown`).
- `/api/health` adds `"revision": "<short sha>"` next to `"version"`. Additive; no
  consumer breaks.

### 3.8 Documentation

JagHelm repo: new `docs/RELEASING.md` (the procedure, the tag-on-Gitea rule, the
repair path); README release/install section; `docs/mobile/KEYSTORE.md` (download
from the Release instead of the Actions artifact); `docs/ARCHITECTURE.md` CI
section.

homelab-infra (same evening, separate PR): `docs/services/jaghelm.md` (build and
release, cron API field, overdue behaviour, mobile screen, the image-prune reporter
missing from the reporter table), `docs/agents/jaghelm/ARCHITECTURE.md` and
`GET-STARTED.md` where they describe releases, `docs/runbooks/jaghelm-mobile-gray-screen.md`.

## 4. Overdue detection (piece B)

### 4.1 Reporter contract

`POST /api/cron/report` accepts an optional `expected_every_seconds`: an integer
from 60 to 2,678,400 (31 days). Anything else → 400. It is stored on the run
record. A job whose latest run has no interval behaves exactly as today.

The interval is declared by the reporter, next to the schedule it describes
(design call; the alternative, a list of intervals inside JagHelm, was rejected as
a second place to forget when a schedule changes).

### 4.2 Rule

A job is **overdue** when its latest run carries an interval and
`now > latest.timestamp + interval + grace`, where
`grace = max(25% of interval, 10 minutes)`.

Examples: a nightly 02:00 job that misses a night is overdue at about 08:00; a
15-minute job is overdue about 25 minutes after its last report.

### 4.3 State and notifications

- The push snapshot's cron map gains the state `overdue`
  (`success | failure | overdue | unknown`). `buildCron` takes `now` as an injected
  argument so the snapshot builder stays pure and clock-free; the push cycle passes
  the clock.
- Transitions:
  - `success | failure | unknown → overdue`: new event `cron_overdue` (severity
    `warning`, title "Cron job overdue", body "`<job>` on `<node>` has not reported
    on schedule").
  - `overdue → success`: `cron_recovered` (existing).
  - `overdue → failure`: `cron_failed` (existing).
  - `overdue → overdue`: nothing. One alert per overdue episode.
- `categoryOf` already maps any `cron_*` type to the existing **Cron** preference,
  and the app's deep-link mapping already routes any `cron_*` type to the job's
  incident. No new setting.
- Restart behaviour matches today's failure behaviour (`unknown → overdue` emits).

### 4.4 Display

- `GET /api/cron/status` adds per job: `expected_every_seconds` (from the latest
  run, when present), `overdue` (boolean) and `seconds_since_report`, computed with
  the current time (so clients render ages without their own clock).
  Single source of truth: web and mobile read the server's verdict.
- Web Scheduled Jobs panel: an amber "Overdue" badge and "last report <age> ago".
- Android Overview: overdue jobs count as cron issues (caution, like a failure), with
  the cause "No report for <age> (expected every <interval>)". This ships in Android
  1.1.0; the 1.0.x app ignores the new fields.

### 4.4a Removing a job (design call)

Today nothing can remove a job: the store keeps every node/job forever, so a
retired job that failed stays red indefinitely, and with overdue detection a retired
job would stay amber indefinitely.

- `DELETE /api/cron/jobs/:node/:job`, session-authenticated (same middleware as
  `GET /status`), removes the job and its history; removes the node entry when it has
  no jobs left. 404 when it does not exist.
- The web Scheduled Jobs panel gets a small **Remove** action per job with a
  confirmation ("Remove <job> on <node> and its history? It reappears if it reports
  again.").
- A removed job disappears from the snapshot; the differ only emits for keys present
  in the next snapshot, so removal sends no notification.

### 4.5 Turning it on per job

In homelab-infra (PR): `tools/ops/vm103-backup.sh` (86400), `tools/ops/prune-images.sh`
(86400), `tools/docs/docs_health.py` (86400), with their tests.

Manual, by Jag, after 2.0.0 is deployed: the two Proxmox notification webhook
bodies (`proxmox-backup`, 86400) and the pi-2 `npm-sync` and `vaultwarden-sync`
scripts (900). Exact snippets go in the homelab docs.

## 5. Connection screen (piece C)

- Startup never blocks rendering on the network. The startup auth check gets a
  10-second timeout (design call: leaves room for Tailscale to reconnect after the
  phone wakes).
- If the server cannot be reached (timeout or network error), the app shows a
  **Can't reach JagHelm** screen: the configured server address, the line "If
  you're away from home, check that Tailscale is connected on this phone.", a
  **Retry** button (re-runs the check), and **Change server** (returns to the
  first-run screen). Retry keeps the saved session token; Change server clears it
  together with the address, as Forget device does.
- This replaces today's "offline at startup: enter the app anyway" behaviour, which
  is how the gray screen was reached.
- Any unexpected error during startup, and any render crash (a top-level error
  boundary), shows an error screen with a Retry button instead of a blank one.
- Tests: timeout, network error, recovery via Retry, Change server, and the error
  boundary.

## 6. Order of work

1. Push the backfill tags `v1.0.0`, `v1.4.0` (old workflows ignore them).
2. PR A: release process (§3, except cleanup), CHANGELOG rewrite, `mobile/CHANGELOG.md`,
   docs.
3. PR B: overdue detection (§4.1–4.4).
4. PR C: connection screen (§5).
5. Jag merges A, B, C. Each merge deploys to vm-103 through the existing health gate.
6. Cleanup (§3.6): delete old release records; Jag dispatches the `:1.4.0` repair.
7. PR D: release 2.0.0 + Android 1.1.0 — version bumps, CHANGELOG sections. Jag merges.
8. Jag runs both dry runs (§3.6b) and reviews the rendered pages.
9. Tag `v2.0.0` and `mobile-v1.1.0` on Gitea at the merge commit. CI publishes both
   releases.
10. Verify (§7). Then homelab-infra PR (docs + in-repo reporters); then Jag's four
    manual reporter edits.

If time runs short, stop after step 9 with whatever of B and C has merged: the
release process and a clean Releases page are the priority.

## 7. Verification

- `:2.0.0` digest == `:sha-<short>` digest of the tagged commit == image running on
  vm-103; `cosign verify` passes on `:2.0.0`.
- `:1.4.0` OCI revision label == `8e8a6f9`.
- GitHub Releases shows exactly two releases; Latest is JagHelm 2.0.0; the APK
  downloads and its SHA-256 matches the notes; `apksigner` shows the release key.
- The APK installs over 1.0.7 on Jag's phone without uninstalling.
- `/api/health` returns `"version":"2.0.0"` and the matching revision.
- Overdue, on a local dev server (never production, design call): a test report with
  a 60-second interval goes overdue after ~11 minutes and pushes once; a fresh report
  recovers it; Remove deletes it. Unit tests cover the same transitions with an
  injected clock.
- Connection screen: with the phone off Tailscale, the app shows the screen within
  10 seconds; Retry after reconnecting enters the app.
- The CHANGELOG lint fails a deliberately malformed section in its own unit tests.

## 8. Left to the builder

File and function names beyond those given; the polling interval in §3.3; exact
wording of UI strings other than those quoted; how the notes script finds the
previous tag; the web badge styling within the existing design tokens.
