// Usage: node scripts/changelog-fold.mjs [--mobile] [<file>]
// The release PR's first step (docs/RELEASING.md): folds the fragments in changes/ next to
// <file> (default CHANGELOG.md, or mobile/CHANGELOG.md with --mobile) into its
// ## [Unreleased] section and deletes them. Changes nothing if anything fails the lint.
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { foldFragments, fragmentDir, lintWithFragments, readFragments } from './changelog.mjs';

const args = process.argv.slice(2);
const mobile = args.includes('--mobile');
const file = args.find((a) => !a.startsWith('--')) ?? (mobile ? 'mobile/CHANGELOG.md' : 'CHANGELOG.md');

const fragments = readFragments(fragmentDir(file));
if (fragments.length === 0) {
  console.log(`${file}: no fragments to fold`);
  process.exit(0);
}
const errors = lintWithFragments(file, { mobile });
if (errors.length) {
  for (const e of errors) console.error(e);
  process.exit(1);
}
writeFileSync(file, foldFragments(readFileSync(file, 'utf8'), fragments));
for (const f of fragments) unlinkSync(f.path);
console.log(`${file}: folded ${fragments.length} fragment(s) from ${fragmentDir(file)}/`);
