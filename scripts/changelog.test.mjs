import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECTION_ORDER, parseChangelog, lintChangelog, findEntry } from './changelog.mjs';

const H = '# Changelog\n\n';
const RELEASED = `${H}## [2.0.0] — 2026-10-16\n\nOne sentence summary.\n\n### Breaking changes\n\n- a\n\n### Added\n\n- b\n  continued\n`;

test('SECTION_ORDER is the seven subsections in order', () => {
  assert.deepEqual(SECTION_ORDER, ['Breaking changes', 'Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security']);
});

test('parses a released entry', () => {
  const { entries } = parseChangelog(RELEASED);
  assert.deepEqual(entries[0], {
    version: '2.0.0',
    date: '2026-10-16',
    summary: 'One sentence summary.',
    sections: [
      { name: 'Breaking changes', body: '- a' },
      { name: 'Added', body: '- b\n  continued' },
    ],
    line: 3,
  });
  assert.deepEqual(lintChangelog(RELEASED), []);
});

test('parses Unreleased with no summary', () => {
  const text = `${H}## [Unreleased]\n\n### Added\n\n- x\n`;
  const e = parseChangelog(text).entries[0];
  assert.equal(e.version, 'Unreleased');
  assert.equal(e.date, null);
  assert.equal(e.summary, '');
  assert.deepEqual(lintChangelog(text), []);
});

test('a released entry has no requires field', () => {
  assert.equal('requires' in parseChangelog(RELEASED).entries[0], false);
});

test('a "Requires JagHelm server" line is plain summary text now', () => {
  const text = `${H}## [1.0.0] — 2026-10-16\n\nS.\n\nRequires JagHelm server 2.0.0 or later.\n\n### Added\n\n- x\n`;
  assert.equal(parseChangelog(text).entries[0].summary, 'S.\nRequires JagHelm server 2.0.0 or later.');
});

test('lintChangelog takes no mobile option: the same text lints the same', () => {
  assert.deepEqual(lintChangelog(RELEASED, { mobile: true }), lintChangelog(RELEASED));
});

test('rejects out-of-order sections', () => {
  const text = `${H}## [1.0.0] — 2026-10-16\n\nS.\n\n### Fixed\n\n- a\n\n### Added\n\n- b\n`;
  const errs = lintChangelog(text);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /^line \d+: .*out of order/);
});

test('rejects unknown section', () => {
  const errs = lintChangelog(`${H}## [1.0.0] — 2026-10-16\n\nS.\n\n### Highlights\n\n- a\n`);
  assert.ok(errs.some((m) => m.includes('unknown section "Highlights"')));
});

test('rejects duplicate and deeper headings and stray content', () => {
  const dup = lintChangelog(`${H}## [1.0.0] — 2026-10-16\n\nS.\n\n### Added\n\n- a\n\n### Added\n\n- b\n`);
  assert.ok(dup.some((m) => m.includes('duplicate')));
  const deep = lintChangelog(`${H}## [1.0.0] — 2026-10-16\n\nS.\n\n### Added\n\n#### Sub\n\n- b\n`);
  assert.ok(deep.some((m) => m.includes('deeper heading')));
  const prose = lintChangelog(`${H}## [1.0.0] — 2026-10-16\n\nS.\n\n### Added\n\nplain prose\n`);
  assert.ok(prose.some((m) => m.includes('bullet')));
});

test('rejects emoji', () => {
  const errs = lintChangelog(`${H}## [1.0.0] — 2026-10-16\n\nS.\n\n### Added\n\n- ✨ new\n`);
  assert.ok(errs.some((m) => m.includes('emoji')));
});

test('rejects missing summary', () => {
  const errs = lintChangelog(`${H}## [1.0.0] — 2026-10-16\n\n### Added\n\n- a\n`);
  assert.ok(errs.some((m) => m.includes('summary')));
});

test('rejects non-descending versions', () => {
  const text = `${H}## [1.2.0] — 2026-10-16\n\nS.\n\n## [1.3.0] — 2026-10-15\n\nS.\n`;
  assert.ok(lintChangelog(text).some((m) => m.includes('descending')));
});

test('rejects hyphen instead of em dash in heading', () => {
  const errs = lintChangelog(`${H}## [1.0.0] - 2026-10-16\n\nS.\n`);
  assert.ok(errs.some((m) => m.includes('heading')));
});

test('rejects missing # Changelog header and misplaced Unreleased', () => {
  assert.ok(lintChangelog('## [Unreleased]\n').some((m) => m.includes('# Changelog')));
  const text = `${H}## [1.0.0] — 2026-10-16\n\nS.\n\n## [Unreleased]\n`;
  assert.ok(lintChangelog(text).some((m) => m.includes('Unreleased')));
});

test('link references only after the last entry', () => {
  const ok = `${RELEASED}\n[2.0.0]: https://github.com/jagbhandal/jaghelm/releases/tag/v2.0.0\n`;
  assert.deepEqual(lintChangelog(ok), []);
  assert.equal(parseChangelog(ok).entries[0].sections[1].body, '- b\n  continued');
  const bad = `${H}## [2.0.0] — 2026-10-16\n\nS.\n\n[x]: https://example.com\n\n## [1.0.0] — 2026-10-01\n\nS.\n`;
  assert.ok(lintChangelog(bad).some((m) => m.includes('link reference')));
});

test('free text before the first entry is allowed', () => {
  assert.deepEqual(lintChangelog(`# Changelog\n\nSome intro text.\n\n## [Unreleased]\n`), []);
});

test('CRLF and trailing whitespace parse identically to LF', () => {
  const crlf = RELEASED.replace(/\n/g, ' \r\n');
  assert.deepEqual(parseChangelog(crlf), parseChangelog(RELEASED));
  assert.deepEqual(lintChangelog(RELEASED), []);
  assert.deepEqual(lintChangelog(crlf), []);
});

test('findEntry returns an entry and throws for a missing version', () => {
  assert.equal(findEntry(RELEASED, '2.0.0').version, '2.0.0');
  assert.throws(() => findEntry(RELEASED, '9.9.9'), /no CHANGELOG section for 9.9.9/);
});

test('CLI exits 0 on valid and 1 with errors on invalid', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cl-'));
  // Removed when the test ends, pass or fail (#369).
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), 'changelog-lint.mjs');
  const good = path.join(dir, 'good.md');
  const bad = path.join(dir, 'bad.md');
  writeFileSync(good, RELEASED);
  writeFileSync(bad, `${H}## [1.0.0] - 2026-10-16\n`);
  execFileSync(process.execPath, [cli, good]);
  const r = spawnSync(process.execPath, [cli, bad], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr + r.stdout, /line 3: .*heading/);
});
