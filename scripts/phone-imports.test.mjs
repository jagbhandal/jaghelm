// The phone screens in src/phone/ (#303) are shared: the Android app draws them,
// and the web below 768px is to draw them too. So nothing there may import a
// platform: a Capacitor plugin, or anything of the Android app's own mobile/,
// which the web's build doesn't have (nor `@shared/`, mobile's name for src/).
// What a screen needs of its platform comes in through src/phone/platform.js
// (docs/ARCHITECTURE.md, "The phone screens are shared").
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PHONE = 'src/phone';

/** Every module under `dir` (relative to the repo), tests included. */
function walk(dir) {
  return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return walk(rel);
    return /\.(?:[cm]?js|jsx|tsx?)$/.test(e.name) ? [rel] : [];
  });
}

/** What a module imports: static imports, re-exports and import(), by specifier. */
const importsOf = (source) =>
  ts.preProcessFile(source, true, true).importedFiles.map((f) => f.fileName);

/** Why `file` (relative to the repo) may not import `spec`, or null when it may. */
function refusal(file, spec) {
  if (spec.startsWith('@capacitor/') || spec.startsWith('capacitor-')) return 'a Capacitor plugin';
  if (spec === '@shared' || spec.startsWith('@shared/')) {
    return "mobile/'s alias for src/, which the web's build doesn't have: import it relatively";
  }
  if (spec.startsWith('.')) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
    if (target === 'mobile' || target.startsWith('mobile/')) return "the Android app's own code";
  }
  return null;
}

const refused = (file, source) =>
  importsOf(source).flatMap((spec) => {
    const why = refusal(file, spec);
    return why ? [`${file}: ${spec} (${why})`] : [];
  });

test('it reads the phone screens', () => {
  const files = walk(PHONE);
  for (const f of ['views/Overview.jsx', 'components/ServiceRow.jsx', 'data/board.js', 'platform.js']) {
    assert.ok(files.includes(`${PHONE}/${f}`), `${PHONE}/${f} is read`);
  }
  // The reader sees every kind of import a screen writes.
  const overview = importsOf(readFileSync(path.join(ROOT, PHONE, 'views/Overview.jsx'), 'utf8'));
  assert.ok(overview.includes('@ui/attention-panel'));
  assert.ok(overview.includes('../data/board.js'));
});

test('nothing in src/phone/ imports a platform', () => {
  const found = walk(PHONE).flatMap((f) => refused(f, readFileSync(path.join(ROOT, f), 'utf8')));
  assert.deepEqual(
    found,
    [],
    'a phone screen takes what it needs of its platform through src/phone/platform.js'
  );
});

test('the check bites', () => {
  const at = `${PHONE}/views/ServiceDetail.jsx`;
  for (const line of [
    "import { App } from '@capacitor/app';",
    "const { Browser } = await import('@capacitor/browser');",
    "import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';",
    "import { openTarget } from '../../../mobile/src/open.js';",
    "export { openTarget } from '../../../mobile/src/open.js';",
    "import { getServiceIcon } from '@shared/hooks/useData.js';",
  ]) {
    assert.equal(refused(at, line).length, 1, line);
  }
  for (const line of [
    "import React, { useMemo } from 'react';",
    "import { StatusLamp } from '@ui/status-lamp';",
    "import { getServiceIcon } from '../../hooks/useData.js';",
    "import { shownReading } from '../../../server/status/readings.js';",
    "import { usePhonePlatform } from '../platform.js';",
    "const mobileFriendly = 'mobile/src';",
  ]) {
    assert.deepEqual(refused(at, line), [], line);
  }
});
