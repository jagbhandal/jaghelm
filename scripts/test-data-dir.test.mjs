// #261: no test reads or writes the checkout's own data/. `npm test` preloads
// scripts/test-data-dir.mjs into the runner and every test file's process, which
// points JAGHELM_DATA_DIR at a fresh temp dir before any server module computes
// its paths (a test file's static imports run before its first line, so a file
// that sets the variable itself can still be too late).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PRELOAD = join(ROOT, 'scripts', 'test-data-dir.mjs');
const CHECKOUT_DATA = join(ROOT, 'data');
const DATA_DIR_MODULE = pathToFileURL(join(ROOT, 'server', 'util', 'dataDir.js')).href;

const inside = (dir, parent) => {
  const rel = relative(parent, dir);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

/** Start node with the preload; returns the DATA_DIR the server would use, and whether it existed. */
function dataDirUnderPreload(env) {
  const script = `const { DATA_DIR } = await import(${JSON.stringify(DATA_DIR_MODULE)});
    const { existsSync } = await import('node:fs');
    console.log(JSON.stringify({ DATA_DIR, exists: existsSync(DATA_DIR) }));`;
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(PRELOAD).href, '--input-type=module', '-e', script],
    { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim());
}

test('npm test preloads scripts/test-data-dir.mjs', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.test, /^node --import \.\/scripts\/test-data-dir\.mjs --test /);
});

test('the preload points the data dir at a temp dir, and removes it on exit', () => {
  const env = { ...process.env };
  delete env.JAGHELM_DATA_DIR;
  const { DATA_DIR, exists } = dataDirUnderPreload(env);
  assert.ok(exists, 'the temp data dir exists while the process runs');
  assert.ok(inside(DATA_DIR, tmpdir()), `${DATA_DIR} is not under ${tmpdir()}`);
  assert.ok(!inside(DATA_DIR, CHECKOUT_DATA), `${DATA_DIR} is the checkout's data/`);
  assert.ok(!existsSync(DATA_DIR), 'the temp data dir is removed when the process exits');
});

test("the preload wins over a JAGHELM_DATA_DIR that points at the checkout's data/", () => {
  const { DATA_DIR } = dataDirUnderPreload({ ...process.env, JAGHELM_DATA_DIR: CHECKOUT_DATA });
  assert.ok(!inside(DATA_DIR, CHECKOUT_DATA), `${DATA_DIR} is the checkout's data/`);
  assert.ok(inside(DATA_DIR, tmpdir()), `${DATA_DIR} is not under ${tmpdir()}`);
});
