// The phone screens in src/phone/ (#303) draw the web below 768px. Nothing there
// may import a platform: a native (Capacitor or Cordova) plugin, which the web's
// build doesn't have, so a native app can't creep back in through them (nor
// `@shared/`, a retired alias for src/). What a screen needs of its shell comes
// in through src/phone/platform.js (docs/ARCHITECTURE.md, "The phone screens").
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

/** The patterns a module hands Vite's import.meta.glob(), which imports every file they match. */
function globsOf(source) {
  const found = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      /^import\.meta\.glob(?:Eager)?$/.test(node.expression.getText(file))
    ) {
      const [first] = node.arguments;
      const items = first && ts.isArrayLiteralExpression(first) ? first.elements : [first];
      for (const item of items) {
        if (item && ts.isStringLiteralLike(item)) found.push(item.text);
        else if (item) found.push(`<${item.getText(file)}>`); // not a literal: refused below
      }
    }
    ts.forEachChild(node, visit);
  };
  const file = ts.createSourceFile('x.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  visit(file);
  // A negative pattern (`!…`) only leaves files out.
  return found.filter((p) => !p.startsWith('!'));
}

/** What a module imports: static imports, re-exports, import() and import.meta.glob(), by specifier. */
const importsOf = (source) => [
  ...ts.preProcessFile(source, true, true).importedFiles.map((f) => f.fileName),
  ...globsOf(source),
];

// The npm scopes and prefixes Capacitor plugins (and the Cordova ones they run) ship under.
const PLUGIN = /^(?:@(?:capacitor|capawesome|capgo)[\w-]*\/|capacitor-|cordova-plugin-)/;

/** Why `file` (relative to the repo) may not import `spec`, or null when it may. */
function refusal(_file, spec) {
  if (PLUGIN.test(spec)) return 'a native plugin';
  if (spec === '@shared' || spec.startsWith('@shared/')) {
    return "an alias for src/ the web's build doesn't have: import it relatively";
  }
  if (spec.startsWith('/')) return 'a root-relative glob, which the build reads from its own root';
  if (spec.startsWith('<')) return 'a glob that is not written out, so it cannot be checked';
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
    "import { Http } from '@capacitor-community/http';",
    "import { FilePicker } from '@capawesome/capacitor-file-picker';",
    "import { Badge } from '@capawesome-team/capacitor-badge';",
    "import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';",
    "import 'cordova-plugin-device';",
    "import { getServiceIcon } from '@shared/hooks/useData.js';",
    "const x = import.meta.glob('/src/phone/*.js');",
    "const y = import.meta.glob(`/src/phone/*.js`);",
    "const z = import.meta.glob('@shared/hooks/*.js');",
    "const w = import.meta.glob(PATTERN);",
  ]) {
    assert.ok(refused(at, line).length > 0, line);
  }
  for (const line of [
    "import React, { useMemo } from 'react';",
    "import { StatusLamp } from '@ui/status-lamp';",
    "import { getServiceIcon } from '../../hooks/useData.js';",
    "import { shownReading } from '../../../server/status/readings.js';",
    "import { usePhonePlatform } from '../platform.js';",
    "const mobileFriendly = 'mobile/src';",
    "const views = import.meta.glob('./*.jsx');",
    "const some = import.meta.glob(['../components/*.jsx', '!../data/**']);",
  ]) {
    assert.deepEqual(refused(at, line), [], line);
  }
});
