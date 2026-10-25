/**
 * The docs name the environment the schema has (#249): env.example lists
 * every variable in server/env.js and nothing else (an old name it mentions
 * is one the schema keeps), and no JAGHELM_ name in the README, the
 * architecture doc or the getting-started guide is one JagHelm doesn't read,
 * which is how the documented JAGHELM_ integration names did nothing before.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ENV_SCHEMA, LEGACY_NAMES } from './env.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (file) => readFileSync(`${root}${file}`, 'utf8');

const SCHEMA = new Set(ENV_SCHEMA.map((d) => d.name));

/**
 * The variable names a file mentions: each `NAME=` (commented out or not) and
 * each word of capitals joined by underscores.
 */
function namesIn(text) {
  const names = new Set();
  for (const m of text.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)) names.add(m[1]);
  for (const m of text.matchAll(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g)) names.add(m[0]);
  return names;
}

test('env.example lists every variable the schema has, but the one the image sets', () => {
  const listed = namesIn(read('env.example'));
  const missing = ENV_SCHEMA.filter((d) => !d.image && !listed.has(d.name)).map((d) => d.name);
  assert.deepEqual(missing, []);
});

test('env.example names nothing the schema lacks: a variable, or an old name it still reads', () => {
  const unknown = [...namesIn(read('env.example'))].filter((n) => !SCHEMA.has(n) && !(n in LEGACY_NAMES));
  assert.deepEqual(unknown, []);
});

test('env.example leaves out the variable the image sets (JAGHELM_REVISION)', () => {
  assert.deepEqual(ENV_SCHEMA.filter((d) => d.image).map((d) => d.name), ['JAGHELM_REVISION']);
  assert.ok(!namesIn(read('env.example')).has('JAGHELM_REVISION'));
});

test('every JAGHELM_ name the README, the architecture doc and the guides give is one JagHelm reads', () => {
  for (const file of [
    'README.md',
    'docs/ARCHITECTURE.md',
    'docs/GET-STARTED.md',
    'docs/CONFIGURATION.md',
    'docs/REPORTING.md',
    'docs/INTEGRATIONS.md',
    'docs/FEATURES.md',
  ]) {
    const unknown = [...read(file).matchAll(/\bJAGHELM_[A-Z0-9_]*[A-Z0-9]\b/g)]
      .map((m) => m[0])
      .filter((n) => !SCHEMA.has(n));
    assert.deepEqual([...new Set(unknown)], [], file);
  }
});
