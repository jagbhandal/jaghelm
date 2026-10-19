import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FRAGMENT_NAME_RE, foldFragments, lintChangelog, lintFragment, lintWithFragments } from './changelog.mjs';

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const H = '# Changelog\n\n';
const RELEASED = '## [1.0.0] — 2026-10-01\n\nOne sentence.\n\n### Added\n- old added\n\n### Changed\n- old changed\n';
const FOOTER = '\n[Unreleased]: https://example.com/compare/v1.0.0...HEAD\n[1.0.0]: https://example.com/tree/v1.0.0\n';
const LOG = `${H}Intro.\n\n## [Unreleased]\n\n### Changed\n- existing change\n\n### Security\n- existing security\n\n${RELEASED}${FOOTER}`;
const README = '# Changelog fragments\n\nProse that is not a fragment.\n';
const EMPTY = 'line 1: empty fragment: add a "### <Subsection>" heading with bullets';
const frag = (name, text) => ({ name, text });

/** A temp directory holding `files` ({ relative path: text }). */
function repo(files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'clf-'));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

test('fragment file names are <issue>-<slug>.md', () => {
  for (const ok of ['357-changelog-fragments.md', '9-a.md', '12-v2-fix.md']) assert.match(ok, FRAGMENT_NAME_RE);
  for (const bad of ['notes.md', 'fix-357.md', '357.md', '357-x.txt', '0357-x.md', '357-Has_Caps.md', 'README.md']) {
    assert.doesNotMatch(bad, FRAGMENT_NAME_RE);
  }
});

test('lintFragment accepts subsections in order with bullets, continuations and blank lines', () => {
  assert.deepEqual(lintFragment('### Breaking changes\n\n- a\n  Migrate by b.\n\n### Fixed\n- c\n- d\n'), []);
  assert.deepEqual(lintFragment('### Added\r\n- crlf \r\n'), []);
});

test('lintFragment rejects unknown, duplicate and out-of-order headings and other heading levels', () => {
  assert.deepEqual(lintFragment('### Highlights\n- a\n'), ['line 1: unknown section "Highlights"']);
  assert.deepEqual(lintFragment('### Fixed\n- a\n### Added\n- b\n'), ['line 3: section "Added" is out of order']);
  assert.deepEqual(lintFragment('### Added\n- a\n### Added\n- b\n'), ['line 3: duplicate section "Added"']);
  assert.deepEqual(lintFragment('### Added\n- a\n#### Detail\n- b\n'), ['line 3: only "### <Subsection>" headings are allowed: "#### Detail"']);
  assert.ok(lintFragment('## [1.1.0] — 2026-10-02\n### Added\n- a\n').some((m) => m.startsWith('line 1: only "### <Subsection>"')));
});

test('lintFragment rejects text outside a bullet', () => {
  assert.deepEqual(lintFragment('Summary line.\n\n### Added\n- a\n'), ['line 1: text before the first "### <Subsection>" heading']);
  assert.deepEqual(lintFragment('### Added\nplain prose\n'),
    ['line 2: content under "### Added" must be a bullet ("- ") or indented continuation']);
  assert.deepEqual(lintFragment('### Added\n  orphan continuation\n- a\n'), ['line 2: "### Added" must start with a bullet ("- ")']);
});

test('lintFragment rejects an empty fragment and a heading with no bullets', () => {
  assert.deepEqual(lintFragment(''), [EMPTY]);
  assert.deepEqual(lintFragment('\n  \n'), [EMPTY]);
  assert.deepEqual(lintFragment('### Added\n\n### Fixed\n- a\n'), ['line 1: "### Added" has no bullets']);
});

test('lintFragment rejects emoji', () => {
  assert.deepEqual(lintFragment('### Added\n- ✨ new\n'), ['line 2: emoji not allowed']);
});

test('fold keeps existing entries, adds new subsections in canonical order and orders fragments by issue number', () => {
  const fragments = [
    frag('10-b.md', '### Added\n- ten b\n\n### Fixed\n- ten b fixed\n  wrapped\n'),
    frag('9-a.md', '### Added\n\n- nine\n\n### Changed\n- nine changed\n'),
    frag('10-a.md', '### Added\n- ten a\n'),
    frag('12-z.md', '### Breaking changes\n- twelve\n  Migrate by x.\n### Removed\n- twelve removed\n'),
  ];
  const expected = `${H}Intro.

## [Unreleased]

### Breaking changes
- twelve
  Migrate by x.

### Added
- nine
- ten a
- ten b

### Changed
- existing change
- nine changed

### Removed
- twelve removed

### Fixed
- ten b fixed
  wrapped

### Security
- existing security

${RELEASED}${FOOTER}`;
  assert.equal(foldFragments(LOG, fragments), expected);
  assert.equal(foldFragments(LOG, [...fragments].reverse()), expected, 'input order does not matter');
  assert.deepEqual(lintChangelog(expected), []);
});

test('fold fills an empty Unreleased and appends a subsection after the existing ones', () => {
  const five = (text) => [frag('5-x.md', text)];
  assert.equal(foldFragments(`${H}## [Unreleased]\n\n${RELEASED}`, five('### Fixed\n- five\n')),
    `${H}## [Unreleased]\n\n### Fixed\n- five\n\n${RELEASED}`);
  assert.equal(foldFragments(`${H}## [Unreleased]\n\n### Added\n- a\n\n${RELEASED}`, five('### Security\n- five\n')),
    `${H}## [Unreleased]\n\n### Added\n- a\n\n### Security\n- five\n\n${RELEASED}`);
  assert.equal(foldFragments(`${H}## [Unreleased]\n`, five('### Added\n- five\n')), `${H}## [Unreleased]\n\n### Added\n- five\n`);
  assert.equal(foldFragments(`${H}## [Unreleased]\n${FOOTER}`, five('### Added\n- five\n')),
    `${H}## [Unreleased]\n\n### Added\n- five\n${FOOTER}`);
});

test('fold with no fragments returns the text unchanged, and throws without an Unreleased section', () => {
  assert.equal(foldFragments(LOG, []), LOG);
  assert.throws(() => foldFragments(`${H}${RELEASED}`, [frag('1-a.md', '### Added\n- a\n')]), /no "## \[Unreleased\]" section/);
});

test('lintWithFragments names the fragment file and line of each problem and skips the README', () => {
  const dir = repo({
    'CHANGELOG.md': LOG,
    'changes/README.md': README,
    'changes/10-unknown.md': '### Highlights\n- a\n',
    'changes/11-order.md': '### Fixed\n- a\n### Added\n- b\n',
    'changes/12-prose.md': '### Added\nprose\n',
    'changes/13-empty.md': '',
    'changes/14-emoji.md': '### Added\n- ✨ new\n',
    'changes/notes.md': '### Added\n- a\n',
  });
  const f = (name) => path.join(dir, 'changes', name);
  assert.deepEqual(lintWithFragments(path.join(dir, 'CHANGELOG.md')), [
    `${f('10-unknown.md')}: line 1: unknown section "Highlights"`,
    `${f('11-order.md')}: line 3: section "Added" is out of order`,
    `${f('12-prose.md')}: line 2: content under "### Added" must be a bullet ("- ") or indented continuation`,
    `${f('13-empty.md')}: ${EMPTY}`,
    `${f('14-emoji.md')}: line 2: emoji not allowed`,
    `${f('notes.md')}: file name must be <issue>-<slug>.md, for example 357-changelog-fragments.md`,
  ]);
});

test('lintWithFragments passes valid fragments and fails a CHANGELOG they cannot be folded into', () => {
  const ok = repo({ 'CHANGELOG.md': LOG, 'changes/README.md': README, 'changes/1-a.md': '### Added\n- a\n' });
  assert.deepEqual(lintWithFragments(path.join(ok, 'CHANGELOG.md')), []);
  const none = repo({ 'CHANGELOG.md': `${H}${RELEASED}`, 'changes/1-a.md': '### Added\n- a\n' });
  const file = path.join(none, 'CHANGELOG.md');
  assert.deepEqual(lintWithFragments(file), [`${file}: no "## [Unreleased]" section to fold the fragments into`]);
});

const FOLD = path.join(SCRIPTS, 'changelog-fold.mjs');
const LINT = path.join(SCRIPTS, 'changelog-lint.mjs');
const run = (cli, cwd, ...args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
const MOBILE = `${H}## [Unreleased]\n\n## [1.0.0] — 2026-10-01\n\nOne sentence.\n\n### Added\n- old added\n`;

test('fold CLI: server and mobile fragments fold into their own CHANGELOG only, READMEs stay', () => {
  const dir = repo({
    'CHANGELOG.md': LOG,
    'changes/README.md': README,
    'changes/7-server.md': '### Fixed\n- server fix\n',
    'mobile/CHANGELOG.md': MOBILE,
    'mobile/changes/README.md': README,
    'mobile/changes/8-app.md': '### Added\n- app feature\n',
  });
  const read = (rel) => readFileSync(path.join(dir, rel), 'utf8');
  const ls = (rel) => readdirSync(path.join(dir, rel)).sort();

  let r = run(FOLD, dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(read('CHANGELOG.md'), LOG.replace('\n### Security', '\n### Fixed\n- server fix\n\n### Security'));
  assert.equal(read('mobile/CHANGELOG.md'), MOBILE);
  assert.deepEqual(ls('changes'), ['README.md']);
  assert.deepEqual(ls('mobile/changes'), ['8-app.md', 'README.md']);
  assert.equal(read('changes/README.md'), README);

  const server = read('CHANGELOG.md');
  r = run(FOLD, dir, '--mobile');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(read('mobile/CHANGELOG.md'), MOBILE.replace('## [Unreleased]\n\n', '## [Unreleased]\n\n### Added\n- app feature\n\n'));
  assert.equal(read('CHANGELOG.md'), server);
  assert.deepEqual(ls('mobile/changes'), ['README.md']);
});

test('fold CLI: a second run, or a run with no changes/ directory, changes nothing', () => {
  const dir = repo({ 'CHANGELOG.md': LOG, 'changes/README.md': README, 'changes/7-a.md': '### Fixed\n- a\n' });
  const file = path.join(dir, 'CHANGELOG.md');
  assert.equal(run(FOLD, dir).status, 0);
  const once = readFileSync(file, 'utf8');
  assert.notEqual(once, LOG);
  const r = run(FOLD, dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(file, 'utf8'), once);
  assert.deepEqual(readdirSync(path.join(dir, 'changes')), ['README.md']);

  const bare = repo({ 'mobile/CHANGELOG.md': MOBILE });
  assert.equal(run(FOLD, bare, '--mobile').status, 0);
  assert.equal(readFileSync(path.join(bare, 'mobile/CHANGELOG.md'), 'utf8'), MOBILE);
});

test('fold CLI refuses a malformed fragment, naming it, and changes nothing', () => {
  const dir = repo({ 'CHANGELOG.md': LOG, 'changes/7-a.md': '### Fixed\n- a\n', 'changes/8-b.md': '### Highlights\n- b\n' });
  const r = run(FOLD, dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^changes\/8-b\.md: line 1: unknown section "Highlights"$/m);
  assert.equal(readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8'), LOG);
  assert.deepEqual(readdirSync(path.join(dir, 'changes')).sort(), ['7-a.md', '8-b.md']);
});

test('lint CLI also lints the fragments next to the CHANGELOG it is given', () => {
  const dir = repo({
    'CHANGELOG.md': LOG,
    'changes/7-a.md': '### Added\nprose\n',
    'mobile/CHANGELOG.md': MOBILE,
    'mobile/changes/8-b.md': '### Added\n- ✨ new\n',
  });
  let r = run(LINT, dir, 'CHANGELOG.md');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^changes\/7-a\.md: line 2: content under "### Added" must be a bullet/m);
  assert.doesNotMatch(r.stderr, /mobile/);
  r = run(LINT, dir, '--mobile', 'mobile/CHANGELOG.md');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^mobile\/changes\/8-b\.md: line 2: emoji not allowed$/m);

  writeFileSync(path.join(dir, 'changes/7-a.md'), '### Added\n- a\n');
  r = run(LINT, dir, 'CHANGELOG.md');
  assert.equal(r.status, 0, r.stderr);
});
