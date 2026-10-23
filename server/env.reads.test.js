/**
 * The environment is read in one place (#249): server/env.js. Every other
 * server module asks it for a variable by name, so a name, its type and its
 * default can't drift from the schema. Tests and their helpers set the
 * environment as they need.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = fileURLToPath(new URL('.', import.meta.url));

/** Every server module, as a path under server/: no tests, no test helpers. */
function modules(dir = serverDir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'testing' && entry.name !== 'node_modules') out.push(...modules(path));
    } else if (/\.(js|mjs|cjs)$/.test(entry.name) && !/\.test\.(js|mjs|cjs)$/.test(entry.name)) {
      out.push(relative(serverDir, path));
    }
  }
  return out;
}

test('only server/env.js reads process.env', () => {
  const readers = modules().filter((file) => /process\.env\b/.test(readFileSync(join(serverDir, file), 'utf8')));
  assert.deepEqual(readers.sort(), ['env.js']);
});
