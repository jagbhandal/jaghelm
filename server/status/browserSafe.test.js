// @ts-check
/**
 * The status model runs in the browser (the phone and the gallery bundle it),
 * so nothing it imports, however deep, may reach a node builtin (#764: F1's
 * containerConditions.js imported containerEvents.js, which pulls in
 * promHistory.js, and the gallery rendered nothing). Walks the relative imports
 * from the model and fails on any `node:` or bare builtin import.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRIES = ['model.js', 'summary.js', 'thresholds.js', 'rules.js'].map((f) => resolve(HERE, f));
const BUILTINS = new Set(builtinModules);

test('the status model imports no node builtin, however deep', () => {
  const seen = new Set();
  const bad = /** @type {string[]} */ ([]);
  const walk = (/** @type {string} */ file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/gm)) {
      const spec = m[1];
      if (spec.startsWith('.')) walk(resolve(dirname(file), spec));
      else if (spec.startsWith('node:') || BUILTINS.has(spec)) bad.push(`${file} imports ${spec}`);
    }
  };
  ENTRIES.forEach(walk);
  assert.deepEqual(bad, []);
  assert.ok(seen.size > 4);
});
