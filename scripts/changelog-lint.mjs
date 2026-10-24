// Usage: node scripts/changelog-lint.mjs <file>
// Also lints the fragments in changes/ next to <file>, and <file> with them folded in.
import { lintWithFragments } from './changelog.mjs';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('usage: node scripts/changelog-lint.mjs <file>');
  process.exit(2);
}

const errors = lintWithFragments(file);
for (const e of errors) console.error(e);
process.exit(errors.length ? 1 : 0);
