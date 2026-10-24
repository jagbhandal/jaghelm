// Usage: node scripts/changelog-fold.mjs [<file>]
// The release PR's first step (docs/RELEASING.md): folds the fragments in changes/ next to
// <file> (default CHANGELOG.md) into its
// ## [Unreleased] section and deletes them. Changes nothing if anything fails the lint.
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { foldFragments, fragmentDir, lintWithFragments, readFragments } from './changelog.mjs';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--')) ?? 'CHANGELOG.md';

if (!existsSync(file)) {
  console.error(`${file} not found: run this from the repository root, or pass the CHANGELOG's path`);
  process.exit(2);
}
const fragments = readFragments(fragmentDir(file));
if (fragments.length === 0) {
  console.log(`${file}: no fragments to fold`);
  process.exit(0);
}
const errors = lintWithFragments(file);
if (errors.length) {
  for (const e of errors) console.error(e);
  process.exit(1);
}
writeFileSync(file, foldFragments(readFileSync(file, 'utf8'), fragments));
for (const f of fragments) unlinkSync(f.path);
console.log(`${file}: folded ${fragments.length} fragment(s) from ${fragmentDir(file)}/`);
