// #375: from Node 26, --test-timeout bounds each test but no longer a test file's
// process, so `npm test` preloads scripts/test-exit-guard.mjs to fail a file that
// is still running that long after its tests finished.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GUARD = pathToFileURL(path.join(ROOT, 'scripts', 'test-exit-guard.mjs')).href;

const dir = mkdtempSync(path.join(tmpdir(), 'test-exit-guard-'));
after(() => rmSync(dir, { recursive: true, force: true }));

function fixture(name, body) {
  const file = path.join(dir, name);
  writeFileSync(file, `import test, { after } from 'node:test';\n${body}\n`);
  return file;
}

// The suite runs inside `node --test`, which marks its children with
// NODE_TEST_CONTEXT; a nested `node --test` that inherits it does not run files.
const ENV = { ...process.env };
delete ENV.NODE_TEST_CONTEXT;

const runUnderGuard = (file) =>
  spawnSync(process.execPath, ['--import', GUARD, '--test', '--test-timeout=500', file], {
    encoding: 'utf8',
    env: ENV,
    timeout: 30_000,
  });

test('npm test preloads scripts/test-exit-guard.mjs with a --test-timeout', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(
    pkg.scripts.test,
    /^node (?:--import \S+ )*--import \.\/scripts\/test-exit-guard\.mjs (?:--import \S+ )*--test /
  );
  assert.match(pkg.scripts.test, / --test-timeout=[1-9]\d* /);
});

test('a file that leaves an interval open fails once its tests are done, and says why', () => {
  const r = runUnderGuard(
    fixture('leaking.mjs', "test('a', () => { setInterval(() => {}, 1000); });")
  );
  assert.equal(r.error, undefined, 'the run did not end on its own');
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /still running 500 ms after its tests finished/);
});

test('a file that closes what it opened in an after hook passes', () => {
  const r = runUnderGuard(
    fixture(
      'clean.mjs',
      [
        'let timer;',
        "test('a', () => { timer = setInterval(() => {}, 1000); });",
        'after(() => clearInterval(timer));',
      ].join('\n')
    )
  );
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout + r.stderr, /still running/);
});
