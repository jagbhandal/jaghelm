/**
 * The integration presets' variables are the env schema's (#249): every
 * preset's envKeys take the JAGHELM_ prefix the docs promise, each one is in
 * the schema (so the boot checks it and its old name works), and the schema
 * lists no variable for a preset that doesn't read it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ENV_SCHEMA, INTEGRATION_VARS } from './env.js';

const { initRegistry, getPresetFull } = await import('./integrations/registry.js');
await initRegistry();

const presetsDir = fileURLToPath(new URL('./integrations/presets/', import.meta.url));
const types = readdirSync(presetsDir)
  .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
  .map((f) => f.slice(0, -3))
  .sort();

test('every preset reads its variables by their JAGHELM_ names, the ones the schema lists for it', () => {
  const declared = new Set(ENV_SCHEMA.map((d) => d.name));
  const withVars = [];
  for (const type of types) {
    const names = Object.values(getPresetFull(type)?.envKeys ?? {});
    if (names.length === 0) continue;
    withVars.push(type);
    for (const name of names) {
      assert.match(name, /^JAGHELM_/, `${type}: ${name}`);
      assert.ok(declared.has(name), `${type}: ${name} is not in the env schema`);
    }
    assert.deepEqual(names, (INTEGRATION_VARS[type] ?? []).map((b) => `JAGHELM_${b}`), type);
  }
  assert.deepEqual(Object.keys(INTEGRATION_VARS).sort(), withVars, 'no preset listed that reads none');
});
