// #335: the PR_TOKEN must never be on a command line (argv is world-readable in
// /proc/<pid>/cmdline and shows in process listings on the runner). These tests run
// the real `run:` scripts of the workflows against stub git/curl that record their
// argv, and prove the secret arrives only through env (git) or stdin (curl).
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = 'tok-must-not-be-on-argv'; // pragma: allowlist secret -- fake token for the argv test
const load = (rel) => yaml.load(readFileSync(path.join(ROOT, rel), 'utf8'));

function stepScript(workflow, job, nameRe) {
  const step = load(workflow).jobs[job].steps.find((s) => nameRe.test(s.name ?? ''));
  assert.ok(step, `${workflow} ${job}: step ${nameRe} not found`);
  return step.run;
}

// Both stubs log "$*" (their argv) and everything they were handed another way.
const FAKE_GIT = `#!/bin/sh
echo "$*" >> "$LOG/git.argv"
env | grep '^GIT_CONFIG' >> "$LOG/git.env"
exit 0
`;
const FAKE_CURL = `#!/bin/sh
echo "$*" >> "$LOG/curl.argv"
cat >> "$LOG/curl.stdin"
for a; do case "$a" in @*) cat "\${a#@}" >> "$LOG/curl.stdin" 2>/dev/null ;; esac; done
case "$*" in *"state=open"*) printf '[]' ;; esac
exit 0
`;

function run(script, extraEnv = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'token-argv-'));
  const bin = path.join(dir, 'bin');
  mkdirSync(bin);
  for (const [n, body] of [['git', FAKE_GIT], ['curl', FAKE_CURL]]) {
    writeFileSync(path.join(bin, n), body);
    chmodSync(path.join(bin, n), 0o755);
  }
  const ws = path.join(dir, 'ws');
  mkdirSync(ws);
  const r = spawnSync('bash', ['-c', script.replaceAll('/usr/bin/curl', 'curl')], {
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      LOG: dir,
      GITHUB_WORKSPACE: ws,
      PR_TOKEN: TOKEN,
      REPOSITORY: 'o/r',
      GITHUB_REF_SAFE: 'abc123',
      PUBLIC_GITEA_URL: 'https://git.example',
      HEAD_COMMIT_MSG: 'feat: x',
      GH_SHA: 'abc123',
      API_BASE: 'https://git.example/api/v1/repos/o/r',
      ...extraEnv,
    },
    encoding: 'utf8',
  });
  const read = (n) => (existsSync(path.join(dir, n)) ? readFileSync(path.join(dir, n), 'utf8') : '');
  return { r, argv: read('git.argv') + read('curl.argv'), gitEnv: read('git.env'), stdin: read('curl.stdin') };
}

for (const [job, label] of [['check', 'check'], ['gallery', 'gallery']]) {
  test(`check.yml ${label} checkout: token reaches git through env, not argv`, () => {
    const { r, argv, gitEnv } = run(stepScript('.gitea/workflows/check.yml', job, /Manual checkout/));
    assert.equal(r.status, 0, r.stderr);
    assert.match(argv, /fetch --depth 1 origin abc123/);
    assert.ok(!argv.includes(TOKEN), `token on argv: ${argv}`);
    assert.ok(!r.stdout.includes(TOKEN) && !r.stderr.includes(TOKEN));
    assert.match(gitEnv, /GIT_CONFIG_COUNT=1/);
    assert.match(gitEnv, /GIT_CONFIG_KEY_0=http\.extraHeader/);
    assert.ok(gitEnv.includes(`GIT_CONFIG_VALUE_0=Authorization: token ${TOKEN}`));
  });
}

test('check.yml checkout: only the fetch sees the token, not init/remote/checkout', () => {
  const script = stepScript('.gitea/workflows/check.yml', 'check', /Manual checkout/);
  const { gitEnv } = run(script);
  assert.equal(gitEnv.split('GIT_CONFIG_COUNT=1').length - 1, 1);
});

test('auto-pr.yml: token reaches curl on stdin only, for the lookup and the POST', () => {
  const { r, argv, stdin } = run(stepScript('.gitea/workflows/auto-pr.yml', 'create-pr', /PR/));
  assert.equal(r.status, 0, r.stderr);
  assert.match(argv, /state=open&head=staging/);
  assert.match(argv, /-X POST/);
  assert.ok(!argv.includes(TOKEN), `token on argv: ${argv}`);
  assert.ok(!r.stdout.includes(TOKEN) && !r.stderr.includes(TOKEN));
  assert.equal(stdin.split(`Authorization: token ${TOKEN}`).length - 1, 2, 'once per curl call');
  assert.match(stdin, /"title":"feat: x"/, 'the POST body still arrives');
});

test('no workflow puts a token variable in a -H, -c or -u argument', () => {
  for (const f of ['.gitea/workflows/check.yml', '.gitea/workflows/auto-pr.yml', '.gitea/workflows/deploy.yml', '.gitea/workflows/reconcile.yml']) {
    for (const [i, line] of readFileSync(path.join(ROOT, f), 'utf8').split('\n').entries()) {
      if (/^\s*#/.test(line)) continue;
      assert.doesNotMatch(line, /(-H|-c|-u|--header|--user)\s+"[^"]*\$\{?[A-Z_]*TOKEN/, `${f}:${i + 1}: ${line}`);
    }
  }
});
