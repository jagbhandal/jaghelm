import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderServerNotes } from './release-notes.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'release-notes.mjs');

const ENTRY = {
  version: '2.0.0',
  date: '2026-10-16',
  summary: 'One sentence summary.',
  sections: [
    { name: 'Added', body: '- a\n  continued' },
    { name: 'Fixed', body: '- b' },
  ],
  line: 3,
};

const FENCE = '```';

test('server notes match the fixed template', () => {
  const expected = [
    '2026-10-16 · `v2.0.0` · `ghcr.io/jagbhandal/jaghelm:2.0.0`',
    '',
    'One sentence summary.',
    '',
    '### Added',
    '- a continued',
    '',
    '### Fixed',
    '- b',
    '',
    '---',
    '',
    FENCE,
    'docker pull ghcr.io/jagbhandal/jaghelm:2.0.0',
    FENCE,
    '',
    'Image signed with cosign (keyless). Full changelog: [v1.5.0...v2.0.0](https://github.com/jagbhandal/jaghelm/compare/v1.5.0...v2.0.0)',
  ].join('\n');
  assert.equal(renderServerNotes(ENTRY, { prevTag: 'v1.5.0' }), expected);
});

test('server notes without prevTag link the CHANGELOG', () => {
  const out = renderServerNotes(ENTRY, { prevTag: null });
  assert.ok(out.endsWith('Full changelog: [CHANGELOG.md](https://github.com/jagbhandal/jaghelm/blob/v2.0.0/CHANGELOG.md)'));
});

// Every temp dir the CLI tests make; removed after the file's tests (#369).
const tmpDirs = [];
after(() => { for (const d of tmpDirs) rmSync(d, { recursive: true, force: true }); });
function makeTmp() {
  const dir = mkdtempSync(path.join(tmpdir(), 'relnotes-'));
  tmpDirs.push(dir);
  return dir;
}

function runCli(text, args) {
  const dir = makeTmp();
  const file = path.join(dir, 'CHANGELOG.md');
  writeFileSync(file, text);
  return spawnSync(process.execPath, [SCRIPT, ...args, '--changelog', file], { encoding: 'utf8' });
}

const LOG = '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- x\n\n## [2.0.0] — 2026-10-16\n\nOne sentence summary.\n\n### Added\n\n- a\n';

test('CLI renders server notes', () => {
  const r = runCli(LOG, ['server', '2.0.0', '--prev', 'v1.5.0']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.startsWith('2026-10-16 · `v2.0.0`'));
  assert.ok(r.stdout.includes('compare/v1.5.0...v2.0.0'));
});

test('CLI exits 1 for a missing version', () => {
  const r = runCli(LOG, ['server', '9.9.9']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no CHANGELOG section for 9\.9\.9/);
  assert.equal(r.stdout, '');
});

test('CLI refuses Unreleased', () => {
  const r = runCli(LOG, ['server', 'Unreleased']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Unreleased/);
  assert.equal(r.stdout, '');
});

test('CLI exits 1 on lint failure', () => {
  const r = runCli('no heading\n', ['server', '2.0.0']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /# Changelog/);
});

test('CLI renders only server notes: the Android kind is gone (#659)', () => {
  const r = runCli(LOG, ['android', '2.0.0']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: release-notes\.mjs server/);
});

// Unfolded fragments would be missing from the notes (#357): a forgotten fold, or a PR
// that merged after the release PR ran it.
test('CLI refuses unfolded fragments, naming them and the fold command', () => {
  const dir = makeTmp();
  for (const [rel, text] of Object.entries({
    'CHANGELOG.md': LOG,
    'changes/README.md': '# Changelog fragments\n',
  })) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  }
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: 'utf8' });
  assert.equal(run('server', '2.0.0').status, 0, 'READMEs alone do not block');

  writeFileSync(path.join(dir, 'changes/1-a.md'), '### Added\n- a\n');
  const r = run('server', '2.0.0');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /changes\/1-a\.md/);
  assert.match(r.stderr, /node scripts\/changelog-fold\.mjs \(docs/);
  assert.equal(r.stdout, '');
  assert.equal(run('server', '2.0.0', '--allow-unfolded').status, 0, 'a test render may skip the check');
});

const WRAPPED = {
  ...ENTRY,
  summary: 'A wrapped\nsummary.',
  sections: [{ name: 'Added', body: '- first bullet\n  continues\n- second' }],
};

test('server notes unwrap a wrapped summary and wrapped bullets', () => {
  const expected = [
    '2026-10-16 · `v2.0.0` · `ghcr.io/jagbhandal/jaghelm:2.0.0`',
    '',
    'A wrapped summary.',
    '',
    '### Added',
    '- first bullet continues',
    '- second',
    '',
    '---',
    '',
    FENCE,
    'docker pull ghcr.io/jagbhandal/jaghelm:2.0.0',
    FENCE,
    '',
    'Image signed with cosign (keyless). Full changelog: [CHANGELOG.md](https://github.com/jagbhandal/jaghelm/blob/v2.0.0/CHANGELOG.md)',
  ].join('\n');
  assert.equal(renderServerNotes(WRAPPED, { prevTag: null }), expected);
});

// A release page lives under /releases/tag/, where a repo-relative link 404s (#308): the
// notes point each one at the file at the release's tag, as the CHANGELOG means it.
const LINKS_ENTRY = {
  ...ENTRY,
  version: '4.0.0',
  sections: [
    {
      name: 'Changed',
      body: [
        '- See [the guide](docs/GET-STARTED.md) first.',
        '- As [section 1 of the runbook](docs/security/INCIDENT-RUNBOOK.md#1-datasecretsjson-or-dash_secret-was-exposed) describes.',
        '- Upstream is [Keep a Changelog](https://keepachangelog.com/), unchanged.',
        '- Read [the section below](#removed), unchanged.',
      ].join('\n'),
    },
  ],
};

test('server notes point a repo-relative link at the file at the release tag', () => {
  const out = renderServerNotes(LINKS_ENTRY, { prevTag: 'v3.0.0' });
  assert.ok(
    out.includes('- See [the guide](https://github.com/jagbhandal/jaghelm/blob/v4.0.0/docs/GET-STARTED.md) first.'),
    out
  );
});

test('a relative link keeps its anchor', () => {
  const out = renderServerNotes(LINKS_ENTRY, { prevTag: 'v3.0.0' });
  assert.ok(
    out.includes(
      '[section 1 of the runbook](https://github.com/jagbhandal/jaghelm/blob/v4.0.0/docs/security/INCIDENT-RUNBOOK.md#1-datasecretsjson-or-dash_secret-was-exposed)'
    ),
    out
  );
});

test('an absolute link and an anchor-only link are left alone', () => {
  const out = renderServerNotes(LINKS_ENTRY, { prevTag: 'v3.0.0' });
  assert.ok(out.includes('- Upstream is [Keep a Changelog](https://keepachangelog.com/), unchanged.'), out);
  assert.ok(out.includes('- Read [the section below](#removed), unchanged.'), out);
  assert.ok(!out.includes('blob/v4.0.0/https'), out);
});
