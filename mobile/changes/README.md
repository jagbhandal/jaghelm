# Android changelog fragments

A PR with a user-facing Android app change writes its CHANGELOG entry as its own
file here instead of editing `mobile/CHANGELOG.md`. No two PRs then edit the
same lines, so they merge in any order without conflicts. The release PR folds every
fragment into `## [Unreleased]` of `mobile/CHANGELOG.md` and deletes the files
(`node scripts/changelog-fold.mjs --mobile`, see
[docs/RELEASING.md](../../docs/RELEASING.md)). Server changes go in
[`changes/`](../../changes/) instead.

- **Name:** `<issue>-<slug>.md`, lowercase, such as `229-updates-toggle.md`.
- **Content:** one or more `### <Subsection>` headings from `Breaking changes`,
  `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`, in that
  order, each followed by bullets (`- `). A bullet may continue on lines
  indented by two spaces. No summary line, no requirement line and nothing
  outside the bullets. The wording rules are those of "The CHANGELOG format" in
  RELEASING.md.

Example, `mobile/changes/229-updates-toggle.md`:

```markdown
### Changed
- The Watchtower notification toggle is now labelled Updates.
```

`node scripts/changelog-lint.mjs --mobile mobile/CHANGELOG.md` checks the
fragments along with the CHANGELOG, and CI runs it on every PR. The release
workflow refuses to publish while a fragment is left unfolded. The fold and the
lint skip this README.
