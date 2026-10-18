import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSummary, parseSummary, staleFloorNotice } from './test-floor.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'test-floor.mjs');

const TAP_TAIL = [
  'ok 765 - last test',
  '  ---',
  '  duration_ms: 0.07',
  "  type: 'test'",
  '  ...',
  '1..765',
  '# tests 768',
  '# suites 1',
  '# pass 765',
  '# fail 0',
  '# cancelled 0',
  '# skipped 2',
  '# todo 1',
  '# duration_ms 527.6',
  '',
].join('\n');

const ok = (over = {}) => ({ tests: 10, suites: 0, pass: 10, fail: 0, cancelled: 0, skipped: 0, todo: 0, ...over });

test('parseSummary reads the TAP summary', () => {
  assert.deepEqual(parseSummary(TAP_TAIL), {
    tests: 768, suites: 1, pass: 765, fail: 0, cancelled: 0, skipped: 2, todo: 1,
  });
});

test('parseSummary reads the spec summary, colours included', () => {
  const blue = (s) => `\u001b[34m${s}\u001b[39m`;
  const out = ['✔ a test (0.1ms)', blue('ℹ tests 3'), blue('ℹ suites 0'), blue('ℹ pass 3'), blue('ℹ fail 0'),
    blue('ℹ cancelled 0'), blue('ℹ skipped 0'), blue('ℹ todo 0'), blue('ℹ duration_ms 40.2')].join('\n');
  assert.deepEqual(parseSummary(out), { tests: 3, suites: 0, pass: 3, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
});

test('parseSummary trusts the last summary, not test output that looks like one', () => {
  const out = `# tests 99999\n# pass 99999\n${TAP_TAIL}`;
  assert.equal(parseSummary(out).pass, 765);
});

test('parseSummary returns null when there is no summary', () => {
  assert.equal(parseSummary('npm ERR! missing script: test\n'), null);
  assert.equal(parseSummary(''), null);
});

test('checkSummary passes at the floor and above it', () => {
  assert.deepEqual(checkSummary(ok(), 10), []);
  assert.deepEqual(checkSummary(ok({ tests: 12, pass: 12 }), 10), []);
});

test('checkSummary fails below the floor and names the floor', () => {
  const problems = checkSummary(ok({ tests: 9, pass: 9 }), 10);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /9 tests passed.*floor is 10/);
});

test('checkSummary does not count skipped or todo tests towards the floor', () => {
  const problems = checkSummary(ok({ tests: 10, pass: 8, skipped: 1, todo: 1 }), 10);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /8 tests passed/);
});

test('checkSummary fails on cancelled and failed tests', () => {
  assert.match(checkSummary(ok({ cancelled: 1 }), 10).join('\n'), /1 test\(s\) cancelled/);
  assert.match(checkSummary(ok({ fail: 2 }), 10).join('\n'), /2 test\(s\) failed/);
});

test('checkSummary fails when there is no summary', () => {
  assert.match(checkSummary(null, 10).join('\n'), /no test summary/);
});

test('staleFloorNotice asks for a raise only when the count is more than 2% above the floor', () => {
  assert.equal(staleFloorNotice(ok({ tests: 102, pass: 102 }), 100), null);
  assert.equal(staleFloorNotice(ok({ tests: 780, pass: 780 }), 771), null);
  assert.equal(staleFloorNotice(ok({ tests: 103, pass: 103 }), 100), '103 passed; consider raising MIN_PASSING to 103');
});

// ── CLI: runs a real node:test suite and checks the exit code ─────────────────

const dir = mkdtempSync(path.join(tmpdir(), 'test-floor-'));
after(() => rmSync(dir, { recursive: true, force: true }));

function fixture(name, body) {
  const file = path.join(dir, name);
  writeFileSync(file, `import test from 'node:test';\n${body}\n`);
  return file;
}

const PASSING = fixture('passing.mjs', "test('a', () => {});\ntest('b', () => {});\ntest('c', () => {});");
const FAILING = fixture('failing.mjs', "test('a', () => {});\ntest('b', () => { throw new Error('boom'); });");
const LEAKING = fixture('leaking.mjs', "test('a', () => { setInterval(() => {}, 1000); });");

// The suite runs inside `node --test`, which marks its children with
// NODE_TEST_CONTEXT; a nested `node --test` that inherits it does not run files.
const ENV = { ...process.env };
delete ENV.NODE_TEST_CONTEXT;

function runScript(script, args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: ENV, timeout: 30_000 });
}
const run = (...args) => runScript(SCRIPT, args);

test('CLI exits 0 and passes the output through when the floor is met', () => {
  const r = run('--min=3', process.execPath, '--test', PASSING);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^# pass 3$/m);
  assert.match(r.stderr, /3 passed \(floor 3\)/);
  assert.doesNotMatch(r.stderr, /consider raising/);
});

test('CLI still exits 0 when the floor is stale, with a notice to raise it', () => {
  const r = run('--min=2', process.execPath, '--test', PASSING);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /^test-floor: 3 passed; consider raising MIN_PASSING to 3$/m);
});

test('CLI exits 1 when fewer tests pass than the floor', () => {
  const r = run('--min=4', process.execPath, '--test', PASSING);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /3 tests passed.*floor is 4/);
});

test('CLI keeps the command\'s failing exit code', () => {
  const r = run('--min=1', process.execPath, '--test', FAILING);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /1 test\(s\) failed/);
});

test('CLI fails a file that leaks an open handle once --test-timeout cancels it', () => {
  const r = run('--min=1', process.execPath, '--test', '--test-timeout=500', LEAKING);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /cancelled/);
});

test('CLI exits 1 when the command prints no summary', () => {
  const r = run('--min=1', process.execPath, '-e', "console.log('hello')");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no test summary/);
});

test('CLI runs when started through a symlink (does not skip main and exit 0)', () => {
  const link = path.join(dir, 'linked-test-floor.mjs');
  symlinkSync(SCRIPT, link);
  const r = runScript(link, ['--min=1', process.execPath, '--test', FAILING]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /1 test\(s\) failed/);
});

test('CLI reports a command killed by a signal', () => {
  const r = run('--min=1', process.execPath, '-e', "process.kill(process.pid, 'SIGTERM')");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /killed by SIGTERM/);
  assert.doesNotMatch(r.stderr, /no test summary/);
});

test('CLI forwards SIGTERM to the command', async () => {
  // The command would outlive the test by 5 s if the signal were not passed on.
  const cli = spawn(
    process.execPath,
    [SCRIPT, '--min=1', process.execPath, '-e', "console.log('ready'); setTimeout(() => {}, 5000)"],
    { env: ENV, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stderr = '';
  cli.stderr.setEncoding('utf8').on('data', (c) => (stderr += c));
  cli.stdout.setEncoding('utf8').on('data', (c) => c.includes('ready') && cli.kill('SIGTERM'));
  const [code, signal] = await new Promise((resolve) => cli.on('close', (c, s) => resolve([c, s])));
  assert.equal(signal, null, 'the CLI handles SIGTERM itself instead of dying from it');
  assert.equal(code, 1);
  assert.match(stderr, /killed by SIGTERM/);
});

test('CLI exits 2 without a command', () => {
  const r = run('--min=1');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage/);
});
