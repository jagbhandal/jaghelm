// Guards the production deploy: .gitea/workflows/deploy.yml (on a push to main),
// .gitea/workflows/reconcile.yml (every 5 minutes) and scripts/deploy/deploy.sh,
// the one implementation both run:
//   #211  every SSH to vm-103 verifies a host key pinned from the VM103_HOST_KEY
//         repository variable, and the deploy fails closed without it;
//   #207  the deploy delivers this commit's compose.yaml to vm-103, verifies it
//         there, and a rollback restores the image AND the compose.yaml together;
//   #356  no fallback to :latest, a green deploy that deployed means the commit is
//         live, a commit main has moved past changes nothing, and a rollback never
//         undoes a later deploy;
//   #534  production converges on main's head: a push deploy whose image is late
//         or superseded ends green and leaves it to the reconcile, which deploys
//         main's head, fails when it has no image 30 minutes after its commit, and
//         tries a failing commit once.
// The workflows' own steps run against stubs (ssh runs the remote command locally;
// docker, curl and sleep are fakes) with the repo's deploy.sh, so these tests
// exercise the real deploy code, not a copy of it. runJob runs a whole job, step
// by step, with the workflow's own if: conditions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEPLOY_SH = path.join(ROOT, 'scripts/deploy/deploy.sh');
const WF_TEXT = readFileSync(path.join(ROOT, '.gitea/workflows/deploy.yml'), 'utf8');
const RC_TEXT = readFileSync(path.join(ROOT, '.gitea/workflows/reconcile.yml'), 'utf8');
const SH_TEXT = existsSync(DEPLOY_SH) ? readFileSync(DEPLOY_SH, 'utf8') : '';
const WF = yaml.load(WF_TEXT);
const RC = yaml.load(RC_TEXT);
const JOB = WF.jobs.deploy;
const RJOB = RC.jobs.reconcile;
const STEPS = JOB.steps;
const RSTEPS = RJOB.steps;
const REPO_COMPOSE = readFileSync(path.join(ROOT, 'compose.yaml'), 'utf8');

const SHA = 'abcdef0123456789abcdef0123456789abcdef01';
const OLD = '6565d7c'; // what vm-103 runs before a reconcile deploy
const TEST_HOST = '192.0.2.10'; // RFC 5737 documentation address
const LATEST = 'ghcr.io/jagbhandal/jaghelm:latest';
const BUILD_LINK = `https://github.com/jagbhandal/jaghelm/commit/${SHA}/checks`;

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const HAS_SSH_KEYGEN = spawnSync('sh', ['-c', 'command -v ssh-keygen']).status === 0;

function step(re, steps = STEPS) {
  const found = steps.filter((s) => re.test(s.name));
  assert.equal(found.length, 1, `expected one step named like ${re}, found ${found.length}`);
  return found[0];
}

const FETCH = (steps = STEPS) => step(/^Fetch the deploy script/, steps);
const PIN = (steps = STEPS) => step(/host key \(fail closed\)/, steps);
const WAIT = () => step(/^Wait for /);
const DECIDE = () => step(/^Compare vm-103/, RSTEPS);
const STAGE = () => step(/^Stage /);
const SWITCH = () => step(/^Switch /);
const VERIFY = () => step(/^Verify deployment/);
const ROLLBACK = () => step(/^Roll back/);
const HOLD = () => step(/^Hold a failed commit/);

// The body of one of deploy.sh's functions: `name() {` to the `}` at column 0
// that ends it, followed by a blank line (a heredoc's own `}` is not).
function fn(name) {
  const m = SH_TEXT.match(new RegExp(`^${name}\\(\\) \\{\\n([\\s\\S]*?)\\n\\}\\n\\n`, 'm'));
  assert.ok(m, `deploy.sh has no ${name}()`);
  return m[1];
}

function heredoc(text, marker) {
  const m = text.match(new RegExp(`<<'${marker}'[^\\n]*\\n([\\s\\S]*?)\\n${marker}\\n`));
  assert.ok(m, `no <<'${marker}' heredoc`);
  return `${m[1]}\n`;
}

// A structurally valid ed25519 public key that belongs to no host (key bytes 0..31).
function fakeHostKeyBlob() {
  const u32 = (n) => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n);
    return b;
  };
  const type = Buffer.from('ssh-ed25519');
  const key = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
  return Buffer.concat([u32(type.length), type, u32(key.length), key]).toString('base64');
}
const KEY_LINE = `${TEST_HOST} ssh-ed25519 ${fakeHostKeyBlob()}`;

// ── Stubs ────────────────────────────────────────────────────────────────────
// docker: logs each call with the sha256 of the compose.yaml in its working
// directory at that moment, so a test can tell which compose a recreate used.
const FAKE_DOCKER = `#!/bin/sh
c=$(sha256sum compose.yaml 2>/dev/null | cut -d' ' -f1)
echo "$*|\${c:-none}" >> "$FAKE_DOCKER_LOG"
case "$*" in
  "manifest inspect "*)
    # The registry: misses FAKE_MANIFEST_MISSES polls, then has the image.
    n=$(cat "$FAKE_MANIFEST_COUNT" 2>/dev/null || echo 0); echo $((n + 1)) > "$FAKE_MANIFEST_COUNT"
    [ "$n" -ge "\${FAKE_MANIFEST_MISSES:-0}" ] || exit 1 ;;
  "inspect --format {{.Image}} jaghelm")
    # The running container's image: the previous one unless a test says another
    # deploy has replaced it since (FAKE_RUNNING_FILE).
    if [ -s "$FAKE_RUNNING_FILE" ]; then cat "$FAKE_RUNNING_FILE"; exit 0; fi
    [ -n "\${FAKE_PREV_IMAGE:-}" ] || exit 1; echo "$FAKE_PREV_IMAGE" ;;
  "image inspect --format {{.Id}} "*) echo "\${FAKE_THIS_IMAGE:-sha256:this}" ;;
  "pull "*) exit "\${FAKE_PULL_RC:-0}" ;;
  "compose config -q") exit "\${FAKE_CONFIG_RC:-0}" ;;
  "compose config --images") printf '%s\\n' "\${FAKE_IMAGES:-${LATEST}}" ;;
  "compose config --format json --no-interpolate --no-env-resolution")
    [ "\${FAKE_JSON_RC:-0}" = 0 ] || exit "$FAKE_JSON_RC"; printf '%s\\n' "$FAKE_CONFIG_JSON" ;;
  "inspect -f {{.HostConfig.NetworkMode}} jaghelm") [ -n "\${FAKE_RUNNING_NET:-}" ] || exit 1; echo "$FAKE_RUNNING_NET" ;;
  "inspect -f {{range .Mounts}}{{println .Destination}}{{end}} jaghelm") printf '%s\\n' "\${FAKE_RUNNING_MOUNTS:-}" ;;
  "inspect --format {{.State.Health.Status}} jaghelm") echo "\${FAKE_HEALTH:-healthy}" ;;
esac
exit 0
`;
// curl: answers the health endpoint. On vm-103 (localhost, over SSH: the health
// gate) it reports FAKE_REVISION, else this commit's; from the runner (HEALTH_URL,
// the reconcile's read) FAKE_LIVE_REVISION, else the same. FAKE_SSH_HEALTH /
// FAKE_HTTP_HEALTH=down make that one refuse the connection. Any other call
// appends argv and the -K config read from stdin to their logs, then answers
// Gitea's branch API (main's head: FAKE_MAIN_HEAD, else this commit, moving to
// FAKE_MAIN_HEAD_LATER after FAKE_MAIN_HEAD_MOVES_AFTER reads; its commit time
// FAKE_HEAD_TIME, else now) or "downloads" deploy.sh or FAKE_COMPOSE_SRC to -o.
const FAKE_CURL = `#!/bin/sh
case "$*" in *"/api/health"*)
  case "$*" in
    *localhost*) [ "\${FAKE_SSH_HEALTH:-up}" = up ] || exit 7; rev="\${FAKE_REVISION-${SHA.slice(0, 7)}}" ;;
    *) [ "\${FAKE_HTTP_HEALTH:-up}" = up ] || exit 7; rev="\${FAKE_LIVE_REVISION-\${FAKE_REVISION-${SHA.slice(0, 7)}}}" ;;
  esac
  printf '{"status":"ok","version":"3.0.0","revision":"%s"}\\n' "$rev"; exit 0 ;;
esac
echo "$*" >> "$FAKE_CURL_ARGV"
cat >> "$FAKE_CURL_CONFIG"
[ "\${FAKE_CURL_RC:-0}" = 0 ] || exit "$FAKE_CURL_RC"
case "$*" in *"/branches/main"*)
  n=$(cat "$FAKE_HEAD_COUNT" 2>/dev/null || echo 0); echo $((n + 1)) > "$FAKE_HEAD_COUNT"
  head="\${FAKE_MAIN_HEAD:-${SHA}}"
  if [ -n "\${FAKE_MAIN_HEAD_LATER:-}" ] && [ "$n" -ge "\${FAKE_MAIN_HEAD_MOVES_AFTER:-0}" ]; then head=$FAKE_MAIN_HEAD_LATER; fi
  when="\${FAKE_HEAD_TIME:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
  printf '{"name":"main","commit":{"id":"%s","message":"m","timestamp":"%s"}}\\n' "$head" "$when"; exit 0 ;;
esac
out=; prev=
for a in "$@"; do [ "$prev" = -o ] && out=$a; prev=$a; done
case "$*" in *"/raw/scripts/deploy/deploy.sh?"*) cp "$FAKE_DEPLOY_SH_SRC" "$out"; exit 0 ;; esac
cp "$FAKE_COMPOSE_SRC" "$out"
`;
// ssh: runs the remote command locally (stdin passes through). ssh-local takes
// the command alone; ssh is what the pin step's SSH_CMD calls, options and all,
// and runs its last argument.
const FAKE_SSH = `#!/bin/sh
echo "$1" >> "$FAKE_SSH_LOG"
exec bash -c "$1"
`;
const FAKE_SSH_PINNED = `#!/bin/sh
for a; do last=$a; done
echo "$last" >> "$FAKE_SSH_LOG"
exec bash -c "$last"
`;

function sandbox() {
  const dir = mkdtempSync(path.join(tmpdir(), 'deploy-wf-'));
  const bin = path.join(dir, 'bin');
  const stack = path.join(dir, 'stack');
  mkdirSync(bin);
  mkdirSync(stack);
  for (const [name, body] of [
    ['docker', FAKE_DOCKER],
    ['curl', FAKE_CURL],
    ['ssh-local', FAKE_SSH],
    ['ssh', FAKE_SSH_PINNED],
    ['sleep', '#!/bin/sh\nexit 0\n'],
  ]) {
    writeFileSync(path.join(bin, name), body);
    chmodSync(path.join(bin, name), 0o755);
  }
  const f = (n) => path.join(dir, n);
  writeFileSync(f('github_env'), '');
  writeFileSync(f('compose.src'), REPO_COMPOSE);
  return {
    dir,
    bin,
    stack,
    githubEnv: f('github_env'),
    read: (n) => (existsSync(f(n)) ? readFileSync(f(n), 'utf8') : ''),
    stackFile: (n) => path.join(stack, n),
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      GITHUB_ENV: f('github_env'),
      GITHUB_SHA: SHA,
      GITHUB_EVENT_NAME: 'push',
      STACK_DIR: stack,
      VM103_SSH: `deploy@${TEST_HOST}`,
      SSH_CMD: path.join(bin, 'ssh-local'),
      // A step run on its own uses the repo's deploy.sh, deploying this commit as
      // if the wait had chosen it. runJob fetches it and lets the wait choose.
      DEPLOY_SH,
      DEPLOY_SHA: SHA,
      HEALTH_URL: `http://${TEST_HOST}:3099/api/health`,
      IMAGE_STALE_SECONDS: String(RJOB.env.IMAGE_STALE_SECONDS),
      FAKE_DOCKER_LOG: f('docker.log'),
      FAKE_SSH_LOG: f('ssh.log'),
      FAKE_CURL_ARGV: f('curl.argv'),
      FAKE_CURL_CONFIG: f('curl.config'),
      FAKE_COMPOSE_SRC: f('compose.src'),
      FAKE_DEPLOY_SH_SRC: DEPLOY_SH,
      FAKE_MANIFEST_COUNT: f('manifest.count'),
      FAKE_HEAD_COUNT: f('head.count'),
      FAKE_RUNNING_FILE: f('running.image'),
      // The job sets 360; with sleep stubbed out, 0 makes a miss time out at once.
      IMAGE_WAIT_SECONDS: '0',
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function githubEnv(sb) {
  const env = {};
  for (const line of sb.read('github_env').split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) env[line.slice(0, i)] = line.slice(i + 1);
  }
  return env;
}

// Runs a workflow step's script the way act_runner runs it on vm-103 (the live
// deploy log shows `bash --noprofile --norc -e -o pipefail {0}`). Values the
// workflow injects with expressions are supplied by the test.
function runStep(sb, s, env = {}, { job = false } = {}) {
  const file = path.join(sb.dir, 'step.sh');
  writeFileSync(file, s.run);
  const base = { ...sb.env };
  if (job) {
    // A whole job: the fetch step exports DEPLOY_SH and the wait or the
    // comparison exports DEPLOY_SHA.
    delete base.DEPLOY_SH;
    delete base.DEPLOY_SHA;
  }
  return spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', file], {
    encoding: 'utf8',
    input: '',
    env: { ...base, ...githubEnv(sb), ...env },
  });
}

// Runs one of the deploy's remote (vm-103) scripts as `bash -s -- args`.
function runRemote(sb, script, args, env = {}) {
  return spawnSync('bash', ['-s', '--', ...args], {
    encoding: 'utf8',
    input: script,
    env: { ...sb.env, ...env },
  });
}

const out = (r) => `${r.stdout}${r.stderr}`;
const dockerCalls = (sb) => sb.read('docker.log').split('\n').filter(Boolean);

// Runs a whole job as act_runner would: steps in order, a failure skips the
// rest except failure() and always() steps, continue-on-error never fails the
// job, and any other if: (an unset repository variable) is false.
function runJob(sb, env = {}, steps = STEPS) {
  writeFileSync(sb.githubEnv, ''); // every job starts with an empty GITHUB_ENV
  let failed = false;
  const ran = [];
  let log = '';
  for (const s of steps) {
    const cond = String(s.if ?? '');
    const runs = cond.includes('always()')
      ? true
      : cond.includes('failure()')
        ? failed
        : cond === '' && !failed;
    if (!runs) continue;
    const r = runStep(sb, s, { VM103_HOST_KEY: KEY_LINE, ...stageEnv(), ...env }, { job: true });
    ran.push(s.name);
    log += out(r);
    if (r.status !== 0 && !s['continue-on-error']) failed = true;
  }
  return { failed, ran, log };
}

// ── one deploy, two workflows (#534) ─────────────────────────────────────────

test('deploy.yml runs on a push to main; the reconcile every 5 minutes and by hand', () => {
  assert.deepEqual(WF.on, { push: { branches: ['main'] } });
  assert.deepEqual(RC.on, { schedule: [{ cron: '*/5 * * * *' }], workflow_dispatch: null });
});

test('both workflows queue in one concurrency group and never cancel a running deploy', () => {
  const group = { group: 'deploy-jaghelm-production', 'cancel-in-progress': false };
  assert.deepEqual(WF.concurrency, group);
  assert.deepEqual(RC.concurrency, group);
});

test('both workflows run the same deploy: every step after the wait or the comparison is identical', () => {
  const shared = (steps, choose) => steps.filter((s) => s !== choose);
  assert.deepEqual(shared(RSTEPS, DECIDE()), shared(STEPS, WAIT()));
  assert.equal(STEPS.indexOf(WAIT()), RSTEPS.indexOf(DECIDE()));
  for (const k of ['VM103_SSH', 'STACK_DIR']) assert.equal(RJOB.env[k], JOB.env[k], k);
  assert.deepEqual(RJOB['runs-on'], JOB['runs-on']);
  assert.deepEqual(RJOB.permissions, { contents: 'read' });
});

test('every step after the fetch runs one command of deploy.sh', () => {
  for (const steps of [STEPS, RSTEPS]) {
    for (const s of steps.slice(1, -1)) {
      // A failure() step also runs when the fetch failed: then it has nothing to do.
      const re = /failure\(\)/.test(String(s.if))
        ? /^\[ -z "\$\{DEPLOY_SH:-\}" \] \|\| bash "\$\{DEPLOY_SH\}" ([a-z]+)\n?$/m
        : /^bash "\$\{DEPLOY_SH:\?\}" ([a-z]+)\n?$/;
      const m = s.run.match(re);
      assert.ok(m, `${s.name}: ${s.run}`);
      assert.match(SH_TEXT, new RegExp(`^ {2}${m[1]}\\) cmd_${m[1]} ;;$`, 'm'), `deploy.sh has no ${m[1]} command`);
    }
  }
});

test("the reconcile runs only on main, so a hand run on a branch can't run that branch's deploy.sh", () => {
  assert.equal(RJOB.if, "github.ref == 'refs/heads/main'");
});

test('the reconcile reads /api/health over HTTP and calls 30 minutes without an image a failed build', () => {
  assert.equal(RJOB.env.HEALTH_URL, `http://${JOB.env.VM103_SSH.split('@')[1]}:3099/api/health`);
  assert.equal(RJOB.env.IMAGE_STALE_SECONDS, 1800);
});

test('the GitHub build no longer dispatches the deploy (ADR 0005 superseded by 0007)', () => {
  const build = readFileSync(path.join(ROOT, '.github/workflows/build-push.yml'), 'utf8');
  assert.doesNotMatch(build, /DEPLOY_DISPATCH|dispatches|GITEA_DEPLOY_TOKEN/);
});

test('fetch: reads deploy.sh at the run commit with the job token, never on argv', (t) => {
  const sb = sandbox();
  t.after(sb.cleanup);
  const r = runStep(sb, FETCH(), stageEnv(), { job: true });
  assert.equal(r.status, 0, out(r));
  assert.equal(
    sb.read('curl.argv').trim().split(' ').pop(),
    `http://gitea.example.test/api/v1/repos/owner/JagHelm/raw/scripts/deploy/deploy.sh?ref=${SHA}`
  );
  assert.doesNotMatch(sb.read('curl.argv'), /tok-not-on-argv/);
  assert.match(sb.read('curl.config'), /Authorization: token tok-not-on-argv/);
  const fetched = githubEnv(sb).DEPLOY_SH;
  t.after(() => rmSync(fetched, { force: true }));
  assert.equal(readFileSync(fetched, 'utf8'), SH_TEXT);
  assert.match(out(r), new RegExp(`sha256=${sha256(SH_TEXT)}`));
});

test('fetch: the step is the same in both workflows, and a failed read fails before anything else', (t) => {
  assert.deepEqual(FETCH(RSTEPS), FETCH());
  assert.equal(STEPS.indexOf(FETCH()), 0);
  const sb = sandbox();
  t.after(sb.cleanup);
  const job = runJob(sb, { FAKE_CURL_RC: '22' }, RSTEPS);
  assert.equal(job.failed, true);
  const errors = job.log.split('\n').filter((l) => l.startsWith('::error::'));
  assert.deepEqual(errors, [
    `::error::could not read scripts/deploy/deploy.sh at ${SHA} from Gitea; nothing changed on vm-103. Re-run this workflow.`,
  ]);
  assert.deepEqual(job.ran, [FETCH().name, ROLLBACK().name, HOLD().name, step(/known_hosts/).name]);
  assert.equal(job.log.split('\n').filter(Boolean).length, 1, `the failure steps stay quiet:\n${job.log}`);
  assert.equal(sb.read('ssh.log'), '');
});

// ── #211: host key pinning ───────────────────────────────────────────────────

const ALL_TEXT = `${WF_TEXT}\n${RC_TEXT}\n${SH_TEXT}`;

test('no step trusts an unknown vm-103 host key', () => {
  assert.doesNotMatch(ALL_TEXT, /StrictHostKeyChecking=(no|accept-new)/);
  assert.doesNotMatch(ALL_TEXT, /UserKnownHostsFile=\/dev\/null/);
});

test('ssh is defined once, with StrictHostKeyChecking=yes and only the pinned key', () => {
  const sshLines = ALL_TEXT.split('\n').filter((l) => /(^|[\s"'=])ssh\s+-/.test(l));
  assert.equal(sshLines.length, 1, `ssh defined ${sshLines.length} times:\n${sshLines.join('\n')}`);
  const [def] = sshLines;
  assert.ok(fn('cmd_pin').includes(def), 'defined in the pin command');
  assert.match(def, /StrictHostKeyChecking=yes/);
  assert.match(def, /UserKnownHostsFile=\$\{?KH\}?/);
  assert.match(def, /GlobalKnownHostsFile=\/dev\/null/);
  assert.match(def, /^\s*echo "SSH_CMD=ssh /, 'SSH_CMD is exported once for every later step');
});

test('the host key comes from the VM103_HOST_KEY repository variable, never inline', () => {
  assert.equal(PIN().env.VM103_HOST_KEY, '${{ vars.VM103_HOST_KEY }}');
  assert.deepEqual(PIN(RSTEPS), PIN());
  // The repo is mirrored to a public GitHub repo: no key material in the files.
  assert.doesNotMatch(ALL_TEXT, /(ssh-ed25519|ecdsa-sha2-nistp\d+|ssh-rsa)\s+AAAA[A-Za-z0-9+/]{16}/);
});

test('the host key is pinned right after the fetch, before any step that reaches vm-103', () => {
  for (const steps of [STEPS, RSTEPS]) {
    assert.equal(steps.indexOf(PIN(steps)), 1, 'pin step runs second (after the fetch, before the image wait)');
    assert.doesNotMatch(FETCH(steps).run, /\bssh\b|SSH_CMD/);
  }
  assert.doesNotMatch(SH_TEXT.replace(fn('cmd_pin'), ''), /\bssh\s+-/, 'only the pin command builds an ssh command');
});

test('no expression interpolation inside run bodies (act_runner caveat)', () => {
  for (const s of [...STEPS, ...RSTEPS]) assert.ok(!(s.run || '').includes('${{'), `${s.name} has \${{ in run`);
  assert.ok(!SH_TEXT.includes('${{'));
});

for (const [label, value, skip = false] of [
  ['unset', undefined],
  ['empty', ''],
  ['not a key', 'not-a-known-hosts-line'],
  ['two lines', `${KEY_LINE}\n${KEY_LINE}`],
  ['hashed host', `|1|c2FsdA==|aGFzaA== ssh-ed25519 ${fakeHostKeyBlob()}`],
  ['another host', `192.0.2.99 ssh-ed25519 ${fakeHostKeyBlob()}`],
  // Only ssh-keygen can tell bad key bytes apart; without it ssh refuses later.
  ['bad key bytes', `${TEST_HOST} ssh-ed25519 AAAAnotavalidkeyblob`, !HAS_SSH_KEYGEN],
]) {
  test(
    `pin step fails closed when VM103_HOST_KEY is ${label}`,
    { skip: skip && 'no ssh-keygen' },
    (t) => {
      const sb = sandbox();
      t.after(sb.cleanup);
      const env = { SSH_CMD: '' };
      if (value !== undefined) env.VM103_HOST_KEY = value;
      const r = runStep(sb, PIN(), env);
      assert.notEqual(r.status, 0, out(r));
      assert.match(out(r), /::error::.*VM103_HOST_KEY/);
      assert.equal(sb.read('github_env'), '', 'nothing exported, so no later step can SSH');
    }
  );
}

test('pin step exports one SSH_CMD that trusts exactly the pinned key', (t) => {
  const sb = sandbox();
  t.after(sb.cleanup);
  const r = runStep(sb, PIN(), { SSH_CMD: '', VM103_HOST_KEY: `${KEY_LINE}\r\n` });
  assert.equal(r.status, 0, out(r));
  const env = githubEnv(sb);
  const kh = env.VM103_KNOWN_HOSTS;
  t.after(() => rmSync(kh, { force: true }));
  assert.equal(readFileSync(kh, 'utf8'), `${KEY_LINE}\n`);
  assert.equal(
    env.SSH_CMD,
    `ssh -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${kh} -o GlobalKnownHostsFile=/dev/null -i /root/.ssh/runner_deploy deploy@${TEST_HOST}`
  );
});

test('the pinned known_hosts file and the fetched script are removed at the end, whatever happened', () => {
  for (const steps of [STEPS, RSTEPS]) {
    const s = step(/known_hosts/, steps);
    assert.equal(steps.indexOf(s), steps.length - 1);
    assert.match(String(s.if), /always\(\)/);
    assert.match(s.run, /rm -f "\$\{VM103_KNOWN_HOSTS\}"/);
    assert.match(s.run, /rm -f "\$\{DEPLOY_SH\}"/);
  }
});

// ── #207: compose.yaml delivery ──────────────────────────────────────────────

const OLD_COMPOSE = `services:\n  jaghelm:\n    image: ${LATEST}\n    network_mode: host\n`;

function stageEnv(extra = {}) {
  return {
    JOB_TOKEN: 'tok-not-on-argv', // pragma: allowlist secret -- fake token for the argv test
    SERVER_URL: 'http://gitea.example.test/',
    REPOSITORY: 'owner/JagHelm',
    FAKE_PREV_IMAGE: 'sha256:previous',
    ...extra,
  };
}

function stagedSandbox(t, { oldCompose = OLD_COMPOSE } = {}) {
  const sb = sandbox();
  t.after(sb.cleanup);
  if (oldCompose !== null) writeFileSync(sb.stackFile('compose.yaml'), oldCompose);
  writeFileSync(sb.stackFile('.env'), 'DASH_SECRET=env-secret-must-not-print\n');
  return sb;
}

test('stage: fetches compose.yaml at the commit, delivers it, records both hashes', (t) => {
  const sb = stagedSandbox(t);
  const r = runStep(sb, STAGE(), stageEnv());
  assert.equal(r.status, 0, out(r));

  // Fetched from Gitea at exactly the deployed commit; the token never on argv.
  assert.equal(
    sb.read('curl.argv').trim().split(' ').pop(),
    `http://gitea.example.test/api/v1/repos/owner/JagHelm/raw/compose.yaml?ref=${SHA}`
  );
  assert.match(sb.read('curl.argv'), /http:\/\/gitea\.example\.test\/api\/v1\/repos\/owner\/JagHelm\/branches\/main/);
  assert.doesNotMatch(sb.read('curl.argv'), /tok-not-on-argv/);
  assert.match(sb.read('curl.config'), /Authorization: token tok-not-on-argv/);

  // Installed: the host copy is the commit's file, the old one kept as .prev.
  assert.equal(readFileSync(sb.stackFile('compose.yaml'), 'utf8'), REPO_COMPOSE);
  assert.equal(readFileSync(sb.stackFile('compose.yaml.prev'), 'utf8'), OLD_COMPOSE);
  assert.ok(!existsSync(sb.stackFile('compose.yaml.new')));

  // Audit trail: repo hash, host hash before and after, and the diff.
  const log = out(r);
  assert.match(log, new RegExp(`repo compose.yaml sha256=${sha256(REPO_COMPOSE)}`));
  assert.match(log, new RegExp(`before: sha256=${sha256(OLD_COMPOSE)}`));
  assert.match(log, new RegExp(`after: sha256=${sha256(REPO_COMPOSE)}`));
  assert.match(log, /^-\s+network_mode: host$/m);
  assert.match(log, /^\+\s+read_only: true$/m);
  assert.doesNotMatch(log, /env-secret-must-not-print/);

  // Nothing switched yet: :latest untouched, no recreate.
  assert.ok(!dockerCalls(sb).some((c) => /^(tag|compose up)/.test(c)), dockerCalls(sb).join('\n'));

  const env = githubEnv(sb);
  assert.equal(env.PREV_IMAGE, 'sha256:previous');
  assert.equal(env.COMPOSE_SHA256, sha256(REPO_COMPOSE));
  assert.equal(env.DEPLOY_STARTED, '1');
  assert.equal(env.ROLLBACK_ARMED, '1');
});

test('docker compose config is only run in modes that print no .env values', () => {
  // Every invocation (comments and messages name it without options).
  const calls = [...ALL_TEXT.matchAll(/docker compose config((?:\s+-[-\w]+(?: json)?)+)/g)];
  assert.deepEqual(
    calls.map((m) => m[1].trim()),
    ['-q', '--images', '--format json --no-interpolate --no-env-resolution']
  );
  assert.doesNotMatch(ALL_TEXT, /docker compose config\s*(\)|<|\||$)/m, 'bare config prints .env');
  // The JSON one is captured and parsed, never echoed.
  const json = SH_TEXT.split('\n').find((l) => l.includes('--no-env-resolution'));
  assert.match(json, /^\s*new_cfg=\$\(docker compose config /);
  assert.ok(!/echo[^\n]*\$new_cfg|printf '%s\\n' "\$new_cfg"\s*$/m.test(SH_TEXT));
});

test('the compose.yaml fetch uses the job token, limited to reading this repo', () => {
  assert.equal(STAGE().env.JOB_TOKEN, '${{ secrets.GITEA_TOKEN }}');
  assert.deepEqual(JOB.permissions, { contents: 'read' });
  assert.ok(!ALL_TEXT.includes('PR_TOKEN'));
});

test('stage: a failed fetch fails before vm-103 is touched', (t) => {
  const sb = stagedSandbox(t);
  const r = runStep(sb, STAGE(), stageEnv({ FAKE_CURL_RC: '22' }));
  assert.notEqual(r.status, 0);
  assert.equal(sb.read('ssh.log'), '', 'no SSH at all');
  assert.equal(readFileSync(sb.stackFile('compose.yaml'), 'utf8'), OLD_COMPOSE);
  assert.equal(githubEnv(sb).DEPLOY_STARTED, undefined, 'a Gitea failure holds nothing back');
  assert.equal(githubEnv(sb).ROLLBACK_ARMED, undefined);
});

test('stage: a failed install leaves the rollback unarmed and the host copy unchanged', (t) => {
  const sb = stagedSandbox(t);
  const r = runStep(sb, STAGE(), stageEnv({ FAKE_CONFIG_RC: '1' }));
  assert.notEqual(r.status, 0);
  assert.equal(readFileSync(sb.stackFile('compose.yaml'), 'utf8'), OLD_COMPOSE);
  assert.equal(githubEnv(sb).ROLLBACK_ARMED, undefined);
});

test('stage: a failed pull of this commit image fails before vm-103 changes', (t) => {
  const sb = stagedSandbox(t);
  const r = runStep(sb, STAGE(), stageEnv({ FAKE_PULL_RC: '1' }));
  assert.notEqual(r.status, 0);
  assert.match(out(r), /::error::.*ghcr\.io\/jagbhandal\/jaghelm:sha-abcdef0.*nothing changed/);
  assert.equal(readFileSync(sb.stackFile('compose.yaml'), 'utf8'), OLD_COMPOSE);
  assert.ok(!existsSync(sb.stackFile('compose.yaml.new')), 'nothing delivered');
  assert.ok(!existsSync(sb.stackFile('compose.yaml.prev')), 'refused before the backup');
  assert.ok(!dockerCalls(sb).some((c) => /^(tag|compose)/.test(c)), dockerCalls(sb).join('\n'));
  assert.equal(githubEnv(sb).DEPLOY_STARTED, undefined, 'a failed pull holds nothing back');
  assert.equal(githubEnv(sb).ROLLBACK_ARMED, undefined);
});

test('job: a failed pull (a GHCR blip) is red but not held back: the next reconcile run retries it', (t) => {
  const sb = stagedSandbox(t);
  const job = runJob(sb, { FAKE_PULL_RC: '1' });
  assert.equal(job.failed, true, job.log);
  assert.match(job.log, /nothing to hold back/);
  assert.ok(!existsSync(sb.stackFile('deploy-failed')));
  const next = reconcile(sb, { FAKE_PULL_RC: '0' });
  assert.equal(next.failed, false, next.log);
  assert.match(next.log, /deploying abcdef0[\s\S]*Deploy verified healthy/);
});

test('stage: arming the rollback is the last thing it does', () => {
  const lines = fn('cmd_stage').trimEnd().split('\n');
  assert.match(lines[lines.length - 1], /ROLLBACK_ARMED=1.*GITHUB_ENV/);
});

// The remote install script, run directly for its failure paths.
function install(sb, want, env = {}) {
  writeFileSync(sb.stackFile('compose.yaml.new'), REPO_COMPOSE);
  return runRemote(sb, heredoc(SH_TEXT, 'INSTALL_COMPOSE'), [sb.stack, want], env);
}

// What `docker compose config --format json` reports for the jaghelm service.
const configJson = ({ net, targets, tmpfs = ['/tmp:rw,noexec,nosuid,size=64m'] }) =>
  JSON.stringify({
    services: {
      jaghelm: {
        ...(net ? { network_mode: net } : {}),
        volumes: targets.map((target) => ({ type: 'bind', source: `/x${target}`, target })),
        tmpfs,
      },
    },
  });
const KEY = '/app/secrets/service-key.json';
// The hand-placed container today: host networking, data, uploads and a mounted key file.
const RUNNING_HOST = {
  FAKE_RUNNING_NET: 'host',
  FAKE_RUNNING_MOUNTS: `/app/data\n/app/uploads\n${KEY}`,
};

for (const [label, want, env] of [
  ['the staged file does not match the fetched hash', sha256('something else'), {}],
  ['docker compose config rejects it', sha256(REPO_COMPOSE), { FAKE_CONFIG_RC: '1' }],
  [
    'it does not run the :latest image the deploy retags',
    sha256(REPO_COMPOSE),
    { FAKE_IMAGES: 'ghcr.io/jagbhandal/jaghelm:sha-0000000' },
  ],
]) {
  test(`install: restores the previous compose.yaml when ${label}`, (t) => {
    const sb = stagedSandbox(t);
    const r = install(sb, want, env);
    assert.notEqual(r.status, 0, out(r));
    assert.match(out(r), /::error::/);
    assert.equal(readFileSync(sb.stackFile('compose.yaml'), 'utf8'), OLD_COMPOSE);
    assert.ok(!existsSync(sb.stackFile('compose.yaml.new')));
    assert.ok(!dockerCalls(sb).some((c) => /^(tag|compose up)/.test(c)));
  });
}

test('install: first delivery to a host without compose.yaml', (t) => {
  const sb = stagedSandbox(t, { oldCompose: null });
  const ok = install(sb, sha256(REPO_COMPOSE));
  assert.equal(ok.status, 0, out(ok));
  assert.equal(readFileSync(sb.stackFile('compose.yaml'), 'utf8'), REPO_COMPOSE);
  assert.ok(!existsSync(sb.stackFile('compose.yaml.prev')));

  rmSync(sb.stackFile('compose.yaml'));
  const bad = install(sb, sha256(REPO_COMPOSE), { FAKE_CONFIG_RC: '1' });
  assert.notEqual(bad.status, 0);
  assert.ok(!existsSync(sb.stackFile('compose.yaml')), 'back to no compose.yaml');
});

test('install: an unchanged compose.yaml prints no diff; a host override is reported, not touched', (t) => {
  const sb = stagedSandbox(t, { oldCompose: REPO_COMPOSE });
  const override = 'services:\n  jaghelm:\n    network_mode: host\n';
  writeFileSync(sb.stackFile('compose.override.yaml'), override);
  const r = install(sb, sha256(REPO_COMPOSE));
  assert.equal(r.status, 0, out(r));
  assert.match(out(r), /unchanged/);
  assert.doesNotMatch(out(r), /^[-+]{3} /m);
  assert.match(out(r), new RegExp(`compose.override.yaml.*sha256=${sha256(override)}`));
  assert.equal(readFileSync(sb.stackFile('compose.override.yaml'), 'utf8'), override);
});

// ── drop guard: never silently lose host networking or a mount ───────────────

for (const [label, running, merged, dropped] of [
  [
    'host networking',
    { FAKE_RUNNING_NET: 'host', FAKE_RUNNING_MOUNTS: '/app/data\n/app/uploads' },
    { targets: ['/app/uploads', '/app/data'] },
    /network_mode host \(would become default\)/,
  ],
  [
    'a mount',
    { FAKE_RUNNING_NET: 'jaghelm_default', FAKE_RUNNING_MOUNTS: `/app/data\n/app/uploads\n${KEY}` },
    { targets: ['/app/uploads', '/app/data'] },
    new RegExp(`mount ${KEY}`),
  ],
]) {
  test(`drop guard: refuses and restores when the new config drops ${label}`, (t) => {
    const sb = stagedSandbox(t);
    const r = install(sb, sha256(REPO_COMPOSE), {
      ...running,
      FAKE_CONFIG_JSON: configJson(merged),
    });
    assert.notEqual(r.status, 0, out(r));
    assert.match(out(r), /::error::the new config drops/);
    assert.match(out(r), dropped);
    assert.equal(readFileSync(sb.stackFile('compose.yaml'), 'utf8'), OLD_COMPOSE);
    assert.ok(!existsSync(sb.stackFile('compose.yaml.new')));
  });
}

test('drop guard: passes when an override keeps host networking and every mount', (t) => {
  const sb = stagedSandbox(t);
  const merged = configJson({ net: 'host', targets: ['/app/uploads', '/app/data', KEY] });
  const r = install(sb, sha256(REPO_COMPOSE), { ...RUNNING_HOST, FAKE_CONFIG_JSON: merged });
  assert.equal(r.status, 0, out(r));
  assert.match(out(r), /drop check: keeps/);
  assert.equal(readFileSync(sb.stackFile('compose.yaml'), 'utf8'), REPO_COMPOSE);
});

test('drop guard: fails closed when compose cannot render the config without .env', (t) => {
  const sb = stagedSandbox(t);
  const r = install(sb, sha256(REPO_COMPOSE), { ...RUNNING_HOST, FAKE_JSON_RC: '1' });
  assert.notEqual(r.status, 0, out(r));
  assert.equal(readFileSync(sb.stackFile('compose.yaml'), 'utf8'), OLD_COMPOSE);
});

test('drop guard: skipped when no jaghelm container exists', (t) => {
  const sb = stagedSandbox(t);
  const r = install(sb, sha256(REPO_COMPOSE));
  assert.equal(r.status, 0, out(r));
  assert.match(out(r), /no jaghelm container: drop check skipped/);
  assert.ok(!dockerCalls(sb).some((c) => c.startsWith('compose config --format')));
});

test('drop guard: compose.accept-drops lets one deploy through, removed once it is healthy', (t) => {
  const sb = stagedSandbox(t);
  writeFileSync(sb.stackFile('compose.accept-drops'), '');
  const merged = configJson({ targets: ['/app/uploads', '/app/data'] });
  const staged = runStep(sb, STAGE(), stageEnv({ ...RUNNING_HOST, FAKE_CONFIG_JSON: merged }));
  assert.equal(staged.status, 0, out(staged));
  assert.match(
    out(staged),
    new RegExp(`accept-drops present, dropping: network_mode host.*mount ${KEY}`)
  );
  assert.equal(readFileSync(sb.stackFile('compose.yaml'), 'utf8'), REPO_COMPOSE);
  assert.equal(runStep(sb, SWITCH()).status, 0);

  // Still there while the deploy is unproven; gone after the health gate passes.
  assert.ok(existsSync(sb.stackFile('compose.accept-drops')));
  const verified = runStep(sb, VERIFY());
  assert.equal(verified.status, 0, out(verified));
  assert.ok(!existsSync(sb.stackFile('compose.accept-drops')));
});

test('drop guard: a failed health gate keeps compose.accept-drops for the retry', (t) => {
  const sb = stagedSandbox(t);
  writeFileSync(sb.stackFile('compose.accept-drops'), '');
  const r = runStep(sb, VERIFY(), { FAKE_HEALTH: 'unhealthy' });
  assert.notEqual(r.status, 0);
  assert.ok(existsSync(sb.stackFile('compose.accept-drops')));
});

// ── switch, gate, rollback ───────────────────────────────────────────────────

function stagedAndSwitched(t, extra = {}, oldCompose = OLD_COMPOSE) {
  const sb = stagedSandbox(t, { oldCompose });
  const staged = runStep(sb, STAGE(), stageEnv(extra));
  assert.equal(staged.status, 0, out(staged));
  const switched = runStep(sb, SWITCH());
  return { sb, switched };
}

test('switch: retags :latest to this commit and recreates with the delivered compose.yaml', (t) => {
  const { sb, switched } = stagedAndSwitched(t);
  assert.equal(switched.status, 0, out(switched));
  const calls = dockerCalls(sb);
  const tag = calls.findIndex((c) =>
    c.startsWith(`tag ghcr.io/jagbhandal/jaghelm:sha-abcdef0 ${LATEST}|`)
  );
  const up = calls.findIndex((c) => c === `compose up -d --force-recreate|${sha256(REPO_COMPOSE)}`);
  assert.ok(tag >= 0 && up > tag, calls.join('\n'));
});

test('switch: refuses to recreate when the host compose.yaml no longer matches the commit', (t) => {
  const sb = stagedSandbox(t);
  assert.equal(runStep(sb, STAGE(), stageEnv()).status, 0);
  writeFileSync(sb.stackFile('compose.yaml'), `${REPO_COMPOSE}# edited by hand\n`);
  const r = runStep(sb, SWITCH());
  assert.notEqual(r.status, 0);
  assert.match(out(r), /::error::.*compose.yaml/);
  assert.ok(!dockerCalls(sb).some((c) => /^(tag|compose up)/.test(c)));
});

test('the health gate only verifies; rollback and hold run on any failure, prune only after success', () => {
  assert.doesNotMatch(fn('cmd_verify'), /docker (tag|compose)/);
  assert.match(String(ROLLBACK().if), /failure\(\)/);
  assert.match(String(HOLD().if), /failure\(\)/);
  assert.ok(STEPS.indexOf(ROLLBACK()) > STEPS.indexOf(VERIFY()));
  assert.equal(STEPS.indexOf(HOLD()), STEPS.indexOf(ROLLBACK()) + 1, 'service first, then the hold');
  const prune = step(/^Prune/);
  assert.ok(STEPS.indexOf(prune) > STEPS.indexOf(HOLD()));
  assert.equal(prune.if, undefined, 'prune runs only after a healthy deploy');
});

test('rollback: restores the previous compose.yaml, then the previous image, then recreates', (t) => {
  const { sb, switched } = stagedAndSwitched(t);
  assert.equal(switched.status, 0);
  const before = dockerCalls(sb).length;
  const r = runStep(sb, ROLLBACK());
  assert.equal(r.status, 0, out(r));
  assert.equal(readFileSync(sb.stackFile('compose.yaml'), 'utf8'), OLD_COMPOSE);
  const calls = dockerCalls(sb).slice(before).filter((c) => !/^(image )?inspect /.test(c));
  assert.deepEqual(calls, [
    `tag sha256:previous ${LATEST}|${sha256(OLD_COMPOSE)}`,
    `compose up -d --force-recreate|${sha256(OLD_COMPOSE)}`,
  ]);
});

test('rollback: does nothing when the deploy failed before vm-103 was changed', (t) => {
  const sb = stagedSandbox(t);
  const r = runStep(sb, ROLLBACK(), { SSH_CMD: '' });
  assert.equal(r.status, 0, out(r));
  assert.match(out(r), /nothing to roll back/);
  assert.equal(sb.read('ssh.log'), '');
});

test('rollback: without a previous image it fails loudly and changes nothing', (t) => {
  const sb = stagedSandbox(t);
  const r = runStep(sb, ROLLBACK(), { ROLLBACK_ARMED: '1', PREV_IMAGE: '' });
  assert.notEqual(r.status, 0);
  assert.match(out(r), /Manual intervention required/);
  assert.equal(sb.read('ssh.log'), '');
});

// ── #534: a failed commit is held back from the reconcile ────────────────────

test('hold: a deploy that failed on vm-103 names its commit in deploy-failed', (t) => {
  const { sb, switched } = stagedAndSwitched(t);
  assert.equal(switched.status, 0);
  const r = runStep(sb, HOLD());
  assert.equal(r.status, 0, out(r));
  assert.match(readFileSync(sb.stackFile('deploy-failed'), 'utf8'), new RegExp(`^${SHA} `));
  assert.match(out(r), /scheduled reconcile runs won't retry abcdef0/);
});

test('hold: a deploy that failed before reaching vm-103 holds nothing back', (t) => {
  const sb = stagedSandbox(t);
  const r = runStep(sb, HOLD(), { SSH_CMD: '' });
  assert.equal(r.status, 0, out(r));
  assert.equal(sb.read('ssh.log'), '');
  assert.ok(!existsSync(sb.stackFile('deploy-failed')));
});

test('verify: a healthy deploy removes deploy-failed', (t) => {
  const { sb, switched } = stagedAndSwitched(t);
  assert.equal(switched.status, 0);
  writeFileSync(sb.stackFile('deploy-failed'), `${'1'.repeat(40)} 2026-10-22T17:00:00Z\n`);
  const r = runStep(sb, VERIFY());
  assert.equal(r.status, 0, out(r));
  assert.ok(!existsSync(sb.stackFile('deploy-failed')));
  assert.match(out(r), /removed deploy-failed/);
});

// ── #356: no fallback to :latest; green means this commit is live ────────────

const LIVE = (sb) => readFileSync(sb.stackFile('compose.yaml'), 'utf8');
const verbs = (sb) => dockerCalls(sb).map((c) => c.split('|')[0]);
const noDeployCalls = (sb) => verbs(sb).filter((v) => !v.startsWith('manifest inspect '));

test('job: a healthy container on another revision fails the deploy, rolls back and holds the commit', (t) => {
  const sb = stagedSandbox(t);
  const job = runJob(sb, { FAKE_REVISION: '6565d7c' });
  assert.equal(job.failed, true, job.log);
  assert.match(job.log, /::error::.*revision 6565d7c.*abcdef0/);
  assert.doesNotMatch(job.log, /verified healthy/);
  assert.ok(job.ran.includes(ROLLBACK().name));
  assert.equal(LIVE(sb), OLD_COMPOSE, 'compose.yaml rolled back');
  assert.deepEqual(verbs(sb).slice(-2), [`tag sha256:previous ${LATEST}`, 'compose up -d --force-recreate']);
  assert.match(readFileSync(sb.stackFile('deploy-failed'), 'utf8'), new RegExp(`^${SHA} `));
});

test('job: the happy path deploys this commit image and proves it is live', (t) => {
  const sb = stagedSandbox(t);
  const job = runJob(sb);
  assert.equal(job.failed, false, job.log);
  assert.match(job.log, /Deploy verified healthy \(commit abcdef0[0-9a-f]*, revision abcdef0 live/);
  assert.ok(!job.ran.includes(ROLLBACK().name));
  assert.equal(LIVE(sb), REPO_COMPOSE);
  const v = verbs(sb);
  const tag = v.indexOf(`tag ghcr.io/jagbhandal/jaghelm:sha-abcdef0 ${LATEST}`);
  assert.ok(tag >= 0 && v.indexOf('compose up -d --force-recreate') > tag, v.join('\n'));
  assert.ok(!v.some((c) => c.startsWith('compose pull')), 'never pulls :latest');
});

test('the image wait is one named variable, six minutes', () => {
  assert.equal(JOB.env.IMAGE_WAIT_SECONDS, 360);
  assert.match(fn('cmd_wait'), /\$\{IMAGE_WAIT_SECONDS:\?/);
});

test('no step falls back to :latest: no compose pull, no "image not pulled" path', () => {
  assert.doesNotMatch(ALL_TEXT, /compose pull/);
  assert.doesNotMatch(ALL_TEXT, /IMAGE_PULLED|image_pulled/);
});

for (const [label, revision] of [
  ['another commit', '6565d7c'],
  ['unknown (no JAGHELM_REVISION in the image)', 'unknown'],
  ['empty', ''],
]) {
  test(`health gate: fails when /api/health reports revision ${label}`, (t) => {
    const sb = stagedSandbox(t);
    const r = runStep(sb, VERIFY(), { FAKE_REVISION: revision });
    assert.notEqual(r.status, 0, out(r));
    assert.match(out(r), /::error::.*not this commit \(abcdef0\)/);
    assert.doesNotMatch(out(r), /verified healthy/);
  });
}

test('stage: fails before vm-103 is touched when main head cannot be read', (t) => {
  const sb = stagedSandbox(t);
  const r = runStep(sb, STAGE(), stageEnv({ FAKE_MAIN_HEAD: 'not-a-sha' }));
  assert.notEqual(r.status, 0);
  assert.match(out(r), /::error::.*main/);
  assert.equal(sb.read('ssh.log'), '');
  assert.equal(githubEnv(sb).ROLLBACK_ARMED, undefined);
});

test('stage: main moving on between the wait and the stage still ends green as superseded', (t) => {
  const sb = stagedSandbox(t);
  const r = runStep(sb, STAGE(), stageEnv({ FAKE_MAIN_HEAD: 'f'.repeat(40) }));
  assert.equal(r.status, 0, out(r));
  assert.match(out(r), /Superseded by fffffff/);
  assert.equal(sb.read('ssh.log'), '');
  for (const s of [SWITCH(), VERIFY(), step(/^Prune/)]) {
    assert.match(out(runStep(sb, s)), /nothing to deploy in this run: skipped/, s.name);
  }
  assert.equal(sb.read('ssh.log'), '');
});

// Two overlapping runs: the older one fails its gate after the newer one went
// green. Its rollback must not put back the image from before both.
test('rollback: leaves vm-103 alone when a later deploy has replaced this one', (t) => {
  const { sb, switched } = stagedAndSwitched(t);
  assert.equal(switched.status, 0, out(switched));
  writeFileSync(path.join(sb.dir, 'running.image'), 'sha256:newer\n');
  writeFileSync(sb.stackFile('compose.yaml'), 'services: {} # the newer run\n');
  const gate = runStep(sb, VERIFY(), { FAKE_REVISION: 'fffffff' });
  assert.notEqual(gate.status, 0);
  const before = dockerCalls(sb).length;
  const r = runStep(sb, ROLLBACK());
  assert.equal(r.status, 0, out(r));
  assert.match(out(r), /later deploy.*nothing restored/i);
  assert.ok(!dockerCalls(sb).slice(before).some((c) => /^(tag|compose)/.test(c)), dockerCalls(sb).join('\n'));
  assert.equal(LIVE(sb), 'services: {} # the newer run\n');
});

for (const [label, running] of [
  ["this run's image", 'sha256:this'],
  ['no container at all', null],
]) {
  test(`rollback: acts when vm-103 runs ${label}`, (t) => {
    const { sb } = stagedAndSwitched(t);
    if (running) writeFileSync(path.join(sb.dir, 'running.image'), `${running}\n`);
    const before = dockerCalls(sb).length;
    const r = runStep(sb, ROLLBACK(), running ? {} : { FAKE_PREV_IMAGE: '' });
    assert.equal(r.status, 0, out(r));
    assert.equal(LIVE(sb), OLD_COMPOSE);
    assert.ok(dockerCalls(sb).slice(before).some((c) => c.startsWith(`tag sha256:previous ${LATEST}|`)));
  });
}

// ── #534: the push deploy's wait ─────────────────────────────────────────────

test('wait: keeps polling until the image appears, then deploys this commit', (t) => {
  const sb = stagedSandbox(t);
  const env = { ...stageEnv(), DEPLOY_SH, FAKE_MANIFEST_MISSES: '2', IMAGE_WAIT_SECONDS: '360' };
  const r = runStep(sb, WAIT(), env, { job: true });
  assert.equal(r.status, 0, out(r));
  assert.equal(sb.read('manifest.count').trim(), '3');
  assert.doesNotMatch(out(r), /::error::/);
  assert.equal(githubEnv(sb).DEPLOY_SHA, SHA);
});

test('wait: main moving past this commit ends the wait green as superseded, checked every round', (t) => {
  const sb = stagedSandbox(t);
  const r = runStep(
    sb,
    WAIT(),
    {
      ...stageEnv(),
      DEPLOY_SH,
      FAKE_MANIFEST_MISSES: '999',
      FAKE_MAIN_HEAD_LATER: 'f'.repeat(40),
      FAKE_MAIN_HEAD_MOVES_AFTER: '2',
      IMAGE_WAIT_SECONDS: '360',
    },
    { job: true }
  );
  assert.equal(r.status, 0, out(r));
  assert.match(out(r), /Superseded by fffffff/);
  assert.equal(sb.read('head.count').trim(), '3', "main's head read each round");
  assert.equal(sb.read('manifest.count').trim(), '2');
  assert.equal(githubEnv(sb).DEPLOY_SHA, undefined);
});

test('job: an image that never comes ends green, "the reconcile ships it", and leaves vm-103 alone', (t) => {
  const sb = stagedSandbox(t);
  const job = runJob(sb, { FAKE_MANIFEST_MISSES: '999' });
  assert.equal(job.failed, false, job.log);
  assert.match(job.log, /Image not built yet; the reconcile ships it when it is/);
  assert.match(job.log, /ghcr\.io\/jagbhandal\/jaghelm:sha-abcdef0 did not appear within 0s/);
  assert.doesNotMatch(job.log, /::error::|verified healthy/);
  // Nothing reached vm-103: no SSH, no pull, no compose call, no restart.
  assert.equal(sb.read('ssh.log'), '');
  assert.deepEqual(noDeployCalls(sb), []);
  assert.equal(LIVE(sb), OLD_COMPOSE);
  assert.ok(!job.ran.includes(ROLLBACK().name));
  for (const s of [SWITCH(), VERIFY()]) assert.ok(job.ran.includes(s.name));
  assert.match(job.log, /nothing to deploy in this run: skipped/);
});

// A later commit on main deploys this one too; deploying this one now (a late
// re-run, an overlapping run) would put an older build over a newer one.
test('job: a run whose commit is no longer main head exits green as superseded, changing nothing', (t) => {
  const sb = stagedSandbox(t);
  const job = runJob(sb, { FAKE_MAIN_HEAD: 'f'.repeat(40) });
  assert.equal(job.failed, false, job.log);
  assert.match(job.log, /Superseded by fffffff/);
  assert.doesNotMatch(job.log, /::error::|verified healthy/);
  assert.equal(sb.read('ssh.log'), '', 'nothing reached vm-103');
  assert.deepEqual(noDeployCalls(sb), []);
  assert.equal(LIVE(sb), OLD_COMPOSE);
  assert.ok(!job.ran.includes(ROLLBACK().name));
});

// ── #534: the reconcile ──────────────────────────────────────────────────────

const decision = (...args) => {
  const r = spawnSync('bash', [DEPLOY_SH, 'decision', ...args.map(String)], { encoding: 'utf8' });
  assert.equal(r.status, 0, out(r));
  return r.stdout.trim();
};

test('reconcile decision: the rule, input by input', () => {
  //            main's head  vm-103   image  age   held  stale after
  assert.equal(decision(SHA, 'abcdef0', '-', '-', '-', 1800), 'noop', 'equal');
  assert.equal(decision(SHA, OLD, 'yes', 60, 'no', 1800), 'deploy', 'behind, image');
  assert.equal(decision(SHA, OLD, 'yes', 7200, 'no', 1800), 'deploy', 'behind, image, however old');
  assert.equal(decision(SHA, 'unknown', 'yes', 60, 'no', 1800), 'deploy', 'an image without a revision');
  assert.equal(decision(SHA, OLD, 'no', 1799, '-', 1800), 'wait', 'behind, no image, under 30 min');
  assert.equal(decision(SHA, OLD, 'no', -30, '-', 1800), 'wait', 'a commit time ahead of the runner clock');
  assert.equal(decision(SHA, OLD, 'no', 1800, '-', 1800), 'stale', 'behind, no image, 30 min');
  assert.equal(decision(SHA, OLD, 'yes', 60, 'yes', 1800), 'held', 'its deploy failed');
  assert.equal(decision(SHA, '', '-', '-', '-', 1800), 'unreachable', 'no /api/health');
});

function reconcile(sb, env = {}) {
  return runJob(sb, { GITHUB_EVENT_NAME: 'schedule', FAKE_LIVE_REVISION: OLD, ...env }, RSTEPS);
}
const minutesAgo = (m, offset = 'Z') => {
  const d = new Date(Date.now() - m * 60_000);
  if (offset === 'Z') return d.toISOString();
  const [, sign, hh, mm] = offset.match(/^([+-])(\d\d):(\d\d)$/);
  const shift = (sign === '-' ? -1 : 1) * (Number(hh) * 60 + Number(mm));
  return `${new Date(d.getTime() + shift * 60_000).toISOString().slice(0, 19)}${offset}`;
};

test('reconcile: vm-103 on main head: one line, no SSH, no registry call, nothing deployed', (t) => {
  const sb = stagedSandbox(t);
  const decided = runStep(sb, DECIDE(), { ...stageEnv(), FAKE_LIVE_REVISION: 'abcdef0' });
  assert.equal(out(decided), ">>> vm-103 runs main's head abcdef0: nothing to do.\n");
  const job = reconcile(sb, { FAKE_LIVE_REVISION: 'abcdef0' });
  assert.equal(job.failed, false, job.log);
  assert.match(job.log, /vm-103 runs main's head abcdef0: nothing to do/);
  assert.equal(sb.read('ssh.log'), '');
  assert.deepEqual(dockerCalls(sb), []);
  assert.equal(LIVE(sb), OLD_COMPOSE);
  assert.equal(githubEnv(sb).DEPLOY_SHA, undefined);
});

test("reconcile: behind and main head has its image: deploys it with the shared steps and proves it live", (t) => {
  const sb = stagedSandbox(t);
  const job = reconcile(sb);
  assert.equal(job.failed, false, job.log);
  assert.match(job.log, /vm-103 runs 6565d7c, main's head is abcdef0 and its image exists: deploying abcdef0/);
  assert.match(job.log, /Deploy verified healthy \(commit abcdef0[0-9a-f]*, revision abcdef0 live/);
  assert.equal(LIVE(sb), REPO_COMPOSE);
  const v = verbs(sb);
  assert.ok(v.includes('manifest inspect ghcr.io/jagbhandal/jaghelm:sha-abcdef0'), v.join('\n'));
  assert.ok(v.includes(`tag ghcr.io/jagbhandal/jaghelm:sha-abcdef0 ${LATEST}`), v.join('\n'));
});

test('reconcile: behind, no image yet, under 30 minutes: green, waits quietly, no SSH', (t) => {
  const sb = stagedSandbox(t);
  const job = reconcile(sb, { FAKE_MANIFEST_MISSES: '999', FAKE_HEAD_TIME: minutesAgo(12) });
  assert.equal(job.failed, false, job.log);
  assert.match(job.log, /main's head abcdef0 has no image yet, 12 min after its commit; vm-103 runs 6565d7c/);
  assert.doesNotMatch(job.log, /::(error|warning)::/);
  assert.equal(sb.read('ssh.log'), '');
  assert.deepEqual(noDeployCalls(sb), []);
  assert.equal(LIVE(sb), OLD_COMPOSE);
});

test('reconcile: behind, still no image 30 minutes after the commit: red, names the build, changes nothing', (t) => {
  const sb = stagedSandbox(t);
  const job = reconcile(sb, { FAKE_MANIFEST_MISSES: '999', FAKE_HEAD_TIME: minutesAgo(31) });
  assert.equal(job.failed, true, job.log);
  const errors = job.log.split('\n').filter((l) => l.startsWith('::error::'));
  assert.equal(errors.length, 1, job.log);
  assert.match(errors[0], /main's head abcdef0 has no image 31 min after its commit: its build failed or never ran/);
  assert.match(errors[0], /"Build and Push Docker Image"/);
  assert.ok(errors[0].includes(BUILD_LINK), errors[0]);
  assert.match(errors[0], /vm-103 still runs 6565d7c; nothing changed/);
  assert.equal(sb.read('ssh.log'), '');
  assert.deepEqual(noDeployCalls(sb), []);
  assert.match(job.log, /nothing to roll back/);
  assert.match(job.log, /nothing to hold back/);
});

for (const [label, when, expect] of [
  ['a UTC offset behind', minutesAgo(40, '-04:00'), /no image 40 min after/],
  ['a UTC offset ahead', minutesAgo(10, '+05:30'), /no image yet, 10 min after/],
  ['fractional seconds', minutesAgo(5).replace('Z', '+00:00'), /no image yet, 5 min after/],
]) {
  test(`reconcile: reads the commit time with ${label}`, (t) => {
    const sb = stagedSandbox(t);
    const job = reconcile(sb, { FAKE_MANIFEST_MISSES: '999', FAKE_HEAD_TIME: when });
    assert.match(job.log, expect);
  });
}

test("reconcile: a commit time it can't read fails loudly instead of waiting forever", (t) => {
  const sb = stagedSandbox(t);
  const job = reconcile(sb, { FAKE_MANIFEST_MISSES: '999', FAKE_HEAD_TIME: 'yesterday' });
  assert.equal(job.failed, true, job.log);
  assert.match(job.log, /::error::could not read the commit time of main's head abcdef0 \("yesterday"\)/);
});

test('reconcile: a failing commit is tried once, not every 5 minutes; a run by hand retries it', (t) => {
  const sb = stagedSandbox(t);
  // First run: deploys main's head, which serves another revision: red, rolled back, held.
  const first = reconcile(sb, { FAKE_REVISION: OLD });
  assert.equal(first.failed, true, first.log);
  assert.match(first.log, /::error::.*not this commit \(abcdef0\)/);
  assert.equal(LIVE(sb), OLD_COMPOSE, 'rolled back');
  assert.match(readFileSync(sb.stackFile('deploy-failed'), 'utf8'), new RegExp(`^${SHA} `));

  // The next scheduled run: green, a warning, nothing pulled or recreated.
  const calls = dockerCalls(sb).length;
  const next = reconcile(sb, { FAKE_REVISION: OLD });
  assert.equal(next.failed, false, next.log);
  assert.match(
    next.log,
    /::warning::main's head abcdef0 failed its deploy on vm-103 .*deploy-failed.*scheduled runs don't retry it; vm-103 runs 6565d7c/
  );
  assert.deepEqual(
    dockerCalls(sb).slice(calls).map((c) => c.split('|')[0]),
    ['manifest inspect ghcr.io/jagbhandal/jaghelm:sha-abcdef0']
  );

  // Run by hand (workflow_dispatch): tries it again; this time it is healthy.
  const manual = reconcile(sb, { GITHUB_EVENT_NAME: 'workflow_dispatch' });
  assert.equal(manual.failed, false, manual.log);
  assert.match(manual.log, /Deploy verified healthy/);
  assert.ok(!existsSync(sb.stackFile('deploy-failed')));
});

test("reconcile: a hold on another commit doesn't stop main head", (t) => {
  const sb = stagedSandbox(t);
  writeFileSync(sb.stackFile('deploy-failed'), `${'1'.repeat(40)} 2026-10-22T17:00:00Z\n`);
  const job = reconcile(sb);
  assert.equal(job.failed, false, job.log);
  assert.match(job.log, /deploying abcdef0/);
});

test('reconcile: /api/health not answering over HTTP is read over SSH, with a warning', (t) => {
  const sb = stagedSandbox(t);
  const job = reconcile(sb, { FAKE_HTTP_HEALTH: 'down', FAKE_REVISION: 'abcdef0' });
  assert.equal(job.failed, false, job.log);
  assert.match(job.log, /::warning::could not read http:\/\/192\.0\.2\.10:3099\/api\/health from the runner; read it over SSH/);
  assert.match(job.log, /vm-103 runs main's head abcdef0: nothing to do/);
  assert.match(sb.read('ssh.log'), /localhost:3099\/api\/health/);
});

test('reconcile: /api/health answering nowhere: green with a warning, no redeploy', (t) => {
  const sb = stagedSandbox(t);
  const job = reconcile(sb, { FAKE_HTTP_HEALTH: 'down', FAKE_SSH_HEALTH: 'down' });
  assert.equal(job.failed, false, job.log);
  assert.match(job.log, /::warning::could not read \/api\/health on vm-103 .*JagHelm is not answering/);
  assert.doesNotMatch(job.log, /::error::/);
  assert.equal(githubEnv(sb).DEPLOY_SHA, undefined);
  assert.deepEqual(noDeployCalls(sb), []);
  assert.deepEqual(dockerCalls(sb), [], 'not even the registry');
  assert.equal(LIVE(sb), OLD_COMPOSE);
});

test("reconcile: main's head unreadable: red, nothing changed", (t) => {
  const sb = stagedSandbox(t);
  const job = reconcile(sb, { FAKE_MAIN_HEAD: 'not-a-sha' });
  assert.equal(job.failed, true, job.log);
  assert.match(job.log, /::error::could not read main's head from Gitea; nothing changed/);
  assert.equal(sb.read('ssh.log'), '');
  assert.deepEqual(dockerCalls(sb), []);
});

// The manual rollback in docs/RELEASING.md, run as written against the fakes:
// it names the commit it leaves in deploy-failed (a short sha), so the
// reconcile leaves the hand rollback alone until a new commit merges.
const RELEASING = readFileSync(path.join(ROOT, 'docs/RELEASING.md'), 'utf8');
function manualRollback() {
  const section = RELEASING.split('**Manual rollback to a known commit.**')[1];
  assert.ok(section, 'RELEASING.md has the manual rollback');
  const m = section.match(/```bash\n([\s\S]*?)\n```/);
  assert.ok(m, 'the manual rollback has a bash block');
  return m[1];
}

test('manual rollback (RELEASING.md): marks the commit it leaves before it switches', () => {
  const cmd = manualRollback();
  assert.match(cmd, /echo <bad> > deploy-failed && docker pull/);
});

test('reconcile: a head rolled back by hand stays rolled back until a new commit merges', (t) => {
  const sb = stagedSandbox(t);
  const cmd = manualRollback()
    .replaceAll('/opt/stacks/jaghelm', sb.stack)
    .replaceAll('<bad>', SHA.slice(0, 7))
    .replaceAll('<short>', OLD);
  const r = spawnSync('bash', ['-e', '-c', cmd], { encoding: 'utf8', env: sb.env });
  assert.equal(r.status, 0, out(r));
  assert.ok(verbs(sb).includes(`tag ghcr.io/jagbhandal/jaghelm:sha-${OLD} ${LATEST}`), verbs(sb).join('\n'));

  // vm-103 now serves OLD; main's head is still SHA, with its image.
  const calls = dockerCalls(sb).length;
  const job = reconcile(sb);
  assert.equal(job.failed, false, job.log);
  assert.match(job.log, /::warning::main's head abcdef0 failed its deploy on vm-103 .*deploy-failed/);
  assert.deepEqual(
    dockerCalls(sb).slice(calls).map((c) => c.split('|')[0]),
    ['manifest inspect ghcr.io/jagbhandal/jaghelm:sha-abcdef0'],
    'nothing pulled or recreated'
  );

  // A new commit merges: the mark names the old head, so the new one deploys.
  const NEW = '1234567'.padEnd(40, '0');
  const merged = reconcile(sb, { FAKE_MAIN_HEAD: NEW, FAKE_REVISION: NEW.slice(0, 7) });
  assert.equal(merged.failed, false, merged.log);
  assert.match(merged.log, /deploying 1234567[\s\S]*Deploy verified healthy/);
  assert.ok(!existsSync(sb.stackFile('deploy-failed')), 'its healthy deploy removes the mark');
});

test('reconcile: a mark shorter than 7 characters names no commit', (t) => {
  const sb = stagedSandbox(t);
  writeFileSync(sb.stackFile('deploy-failed'), 'abc\n');
  const job = reconcile(sb);
  assert.match(job.log, /deploying abcdef0/);
});
