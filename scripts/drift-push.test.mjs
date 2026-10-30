/**
 * docs/examples/drift-push.sh (#674) against drift_check.py's real output
 * shapes: the exit-code mapping (0 ok, 1 with items drift, 1 with none error,
 * 2 error), paths with spaces, an UNREAD detail, and the secret never on a
 * command line. A fake drift_check and a fake curl stand in for the real ones.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = new URL('../docs/examples/drift-push.sh', import.meta.url).pathname;
const hasJq = spawnSync('jq', ['--version']).status === 0;

// Every temp dir a run() made; removed after the file's tests (#369).
const tmpDirs = [];
after(() => { for (const d of tmpDirs) rmSync(d, { recursive: true, force: true }); });

function run(out, rc) {
  const d = mkdtempSync(join(tmpdir(), 'jh-push-'));
  tmpDirs.push(d);
  writeFileSync(join(d, 'dc.py'), `import sys\nprint(${JSON.stringify(out)})\nsys.exit(${rc})\n`);
  writeFileSync(join(d, 'secret'), 'sekret\n'); // pragma: allowlist secret
  // The fake curl records its argv and stdin.
  writeFileSync(join(d, 'curl'), `#!/bin/sh\necho "$@" > ${d}/argv\ncat > ${d}/body\n`);
  chmodSync(join(d, 'curl'), 0o755);
  const r = spawnSync('sh', [SCRIPT, 'pi-1'], {
    env: { ...process.env, DRIFT_CHECK: join(d, 'dc.py'), SECRET_FILE: join(d, 'secret'), CURL: join(d, 'curl') },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  return { body: JSON.parse(readFileSync(join(d, 'body'), 'utf8')), argv: readFileSync(join(d, 'argv'), 'utf8') };
}

const SHAPES = [
  'pi-1  DIFF     /opt/stacks/adguard/compose.yaml',
  'pi-1  MISSING  /opt/stacks/x/my file.conf',
  'pi-1  UNREAD   /opt/stacks/y.json  (Command not permitted)',
  'pi-1: 3 drifted, 1 unreadable',
].join('\n');

test('drift: items parsed, spaces kept in the name, UNREAD detail split off', { skip: !hasJq }, () => {
  const { body, argv } = run(SHAPES, 1);
  assert.equal(body.status, 'drift');
  assert.equal(body.secret, 'sekret'); // pragma: allowlist secret
  assert.deepEqual(body.items, [
    { name: '/opt/stacks/adguard/compose.yaml', kind: 'DIFF', detail: '' },
    { name: '/opt/stacks/x/my file.conf', kind: 'MISSING', detail: '' },
    { name: '/opt/stacks/y.json', kind: 'UNREAD', detail: '(Command not permitted)' },
  ]);
  assert.ok(!argv.includes('sekret'), 'the secret is not on the curl command line');
});

test('exit 0 is ok; exit 2 is error; exit 1 with no items (a crash) is error, not drift', { skip: !hasJq }, () => {
  assert.equal(run('pi-1: 0 drifted, 0 unreadable', 0).body.status, 'ok');
  assert.equal(run('pi-1  UNREAD   /a.json  (x)\npi-1: 0 drifted, 1 unreadable', 2).body.status, 'error');
  assert.equal(run('Traceback (most recent call last):', 1).body.status, 'error');
});
