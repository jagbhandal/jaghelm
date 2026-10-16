// Usage: node scripts/changelog-lint.mjs [--mobile] <file>
import { readFileSync } from 'node:fs';
import { lintChangelog } from './changelog.mjs';

const args = process.argv.slice(2);
const mobile = args.includes('--mobile');
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('usage: node scripts/changelog-lint.mjs [--mobile] <file>');
  process.exit(2);
}

const errors = lintChangelog(readFileSync(file, 'utf8'), { mobile });
for (const e of errors) console.error(`${file}: ${e}`);
process.exit(errors.length ? 1 : 0);
