# Changelog fragments

A PR with a user-facing server change writes its CHANGELOG entry as its own file
here instead of editing `CHANGELOG.md`. No two PRs then edit the same lines, so
they merge in any order without conflicts. The release PR folds every fragment into
`## [Unreleased]` of `CHANGELOG.md` and deletes the files
(`node scripts/changelog-fold.mjs`, see [docs/RELEASING.md](../docs/RELEASING.md)).
Android app changes go in [`mobile/changes/`](../mobile/changes/) instead.

- **Name:** `<issue>-<slug>.md`, lowercase, such as `245-access-log.md`.
- **Content:** one or more `### <Subsection>` headings from `Breaking changes`,
  `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`, in that
  order, each followed by bullets (`- `). A bullet may continue on lines
  indented by two spaces. No summary line and nothing outside the bullets. The
  wording rules are those of "The CHANGELOG format" in RELEASING.md.

Example, `changes/245-access-log.md`:

```markdown
### Fixed
- The server's access log now records API requests with their full path.
```

`node scripts/changelog-lint.mjs CHANGELOG.md` checks the fragments along with
the CHANGELOG, and CI runs it on every PR. The release workflows refuse to
publish while a fragment is left unfolded. The fold and the lint skip this
README.
