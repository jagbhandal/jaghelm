import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderServerNotes, renderAndroidNotes } from './release-notes.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'release-notes.mjs');

const ENTRY = {
  version: '2.0.0',
  date: '2026-10-16',
  summary: 'One sentence summary.',
  requires: null,
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

test('android notes include requires in the header and asset footer', () => {
  const entry = { ...ENTRY, version: '1.1.0', requires: '2.0.0' };
  const expected = [
    '2026-10-16 · `mobile-v1.1.0` · Requires JagHelm server 2.0.0 or later',
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
    '**Asset:** `JagHelm-1.1.0.apk` · SHA-256 `abc123`',
    '',
    'Download the APK on your Android device and open it to install. Updates install over earlier versions and keep your settings.',
  ].join('\n');
  assert.equal(renderAndroidNotes(entry, { apkName: 'JagHelm-1.1.0.apk', sha256: 'abc123' }), expected);
});

test('android notes omit requires when absent', () => {
  const out = renderAndroidNotes({ ...ENTRY, version: '1.1.0' }, { apkName: 'a.apk', sha256: 'ff' });
  assert.equal(out.split('\n')[0], '2026-10-16 · `mobile-v1.1.0`');
});

function runCli(text, args) {
  const dir = mkdtempSync(path.join(tmpdir(), 'relnotes-'));
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

test('CLI android requires --apk and --sha256', () => {
  const r = runCli(LOG, ['android', '2.0.0']);
  assert.equal(r.status, 2);
});

// Unfolded fragments would be missing from the notes (#357): a forgotten fold, or a PR
// that merged after the release PR ran it. Each line checks only its own changes/ dir.
test('CLI refuses unfolded fragments of its own line only, naming them and the fold command', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'relnotes-'));
  for (const [rel, text] of Object.entries({
    'CHANGELOG.md': LOG,
    'mobile/CHANGELOG.md': LOG,
    'changes/README.md': '# Changelog fragments\n',
    'mobile/changes/README.md': '# Changelog fragments\n',
  })) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  }
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: 'utf8' });
  const android = ['android', '2.0.0', '--apk', 'a.apk', '--sha256', 'ff'];
  assert.equal(run('server', '2.0.0').status, 0, 'READMEs alone do not block');

  writeFileSync(path.join(dir, 'mobile/changes/2-b.md'), '### Added\n- b\n');
  assert.equal(run('server', '2.0.0').status, 0, 'mobile fragments do not block a server release');
  let r = run(...android);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /mobile\/changes\/2-b\.md/);
  assert.match(r.stderr, /node scripts\/changelog-fold\.mjs --mobile/);
  assert.equal(r.stdout, '');
  assert.equal(run(...android, '--allow-unfolded').status, 0, 'a test build may skip the check');

  writeFileSync(path.join(dir, 'changes/1-a.md'), '### Added\n- a\n');
  r = run('server', '2.0.0');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /changes\/1-a\.md/);
  assert.match(r.stderr, /node scripts\/changelog-fold\.mjs(?! --mobile)/);
  assert.equal(r.stdout, '');
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

test('android notes unwrap a wrapped summary and wrapped bullets', () => {
  const expected = [
    '2026-10-16 · `mobile-v2.0.0`',
    '',
    'A wrapped summary.',
    '',
    '### Added',
    '- first bullet continues',
    '- second',
    '',
    '---',
    '',
    '**Asset:** `a.apk` · SHA-256 `ff`',
    '',
    'Download the APK on your Android device and open it to install. Updates install over earlier versions and keep your settings.',
  ].join('\n');
  assert.equal(renderAndroidNotes(WRAPPED, { apkName: 'a.apk', sha256: 'ff' }), expected);
});
