// Guards .gitea/workflows/deploy.yml:
//   #211  every SSH to vm-103 verifies a host key pinned from the VM103_HOST_KEY
//         repository variable, and the deploy fails closed without it;
//   #207  the deploy delivers this commit's compose.yaml to vm-103, verifies it
//         there, and a rollback restores the image AND the compose.yaml together.
// The step scripts are taken from the workflow itself and run against stubs (ssh
// runs the remote command locally; docker and curl are fakes), so these tests
// exercise the real deploy code, not a copy of it.
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
const WF_TEXT = readFileSync(path.join(ROOT, '.gitea/workflows/deploy.yml'), 'utf8');
const JOB = yaml.load(WF_TEXT).jobs.deploy;
const STEPS = JOB.steps;
const REPO_COMPOSE = readFileSync(path.join(ROOT, 'compose.yaml'), 'utf8');

const SHA = 'abcdef0123456789abcdef0123456789abcdef01';
const TEST_HOST = '192.0.2.10'; // RFC 5737 documentation address
const LATEST = 'ghcr.io/jagbhandal/jaghelm:latest';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const HAS_SSH_KEYGEN = spawnSync('sh', ['-c', 'command -v ssh-keygen']).status === 0;

function step(re) {
  const found = STEPS.filter((s) => re.test(s.name));
  assert.equal(found.length, 1, `expected one step named like ${re}, found ${found.length}`);
  return found[0];
}

const PIN = () => step(/host key/i);
const STAGE = () => step(/^Stage /);
const SWITCH = () => step(/^Switch /);
const VERIFY = () => step(/^Verify deployment/);
const ROLLBACK = () => step(/^Roll back/);

function heredoc(run, marker) {
  const m = run.match(new RegExp(`<<'${marker}'[^\\n]*\\n([\\s\\S]*?)\\n${marker}\\n`));
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
  "inspect --format {{.Image}} jaghelm") [ -n "\${FAKE_PREV_IMAGE:-}" ] || exit 1; echo "$FAKE_PREV_IMAGE" ;;
  "pull "*) exit "\${FAKE_PULL_RC:-0}" ;;
  "compose config -q") exit "\${FAKE_CONFIG_RC:-0}" ;;
  "compose config --images") printf '%s\\n' "\${FAKE_IMAGES:-${LATEST}}" ;;
esac
exit 0
`;
// curl: records argv and the -K config read from stdin, then "downloads"
// FAKE_COMPOSE_SRC to the -o path.
const FAKE_CURL = `#!/bin/sh
echo "$*" > "$FAKE_CURL_ARGV"
cat > "$FAKE_CURL_CONFIG"
[ "\${FAKE_CURL_RC:-0}" = 0 ] || exit "$FAKE_CURL_RC"
out=; prev=
for a in "$@"; do [ "$prev" = -o ] && out=$a; prev=$a; done
cp "$FAKE_COMPOSE_SRC" "$out"
`;
// ssh: runs the remote command locally (stdin passes through).
const FAKE_SSH = `#!/bin/sh
echo "$1" >> "$FAKE_SSH_LOG"
exec bash -c "$1"
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
      STACK_DIR: stack,
      VM103_SSH: `deploy@${TEST_HOST}`,
      SSH_CMD: path.join(bin, 'ssh-local'),
      FAKE_DOCKER_LOG: f('docker.log'),
      FAKE_SSH_LOG: f('ssh.log'),
      FAKE_CURL_ARGV: f('curl.argv'),
      FAKE_CURL_CONFIG: f('curl.config'),
      FAKE_COMPOSE_SRC: f('compose.src'),
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

// Runs a workflow step's script the way act does on vm-103's runner (POSIX sh
// with `set -euo pipefail`; bash --posix stands in for busybox ash here).
// Values the workflow injects with expressions are supplied by the test.
function runStep(sb, s, env = {}) {
  const file = path.join(sb.dir, 'step.sh');
  writeFileSync(file, s.run);
  return spawnSync('bash', ['--posix', '-e', file], {
    encoding: 'utf8',
    input: '',
    env: { ...sb.env, ...githubEnv(sb), ...env },
  });
}

// Runs one of the workflow's remote (vm-103) scripts as `bash -s -- args`.
function runRemote(sb, script, args, env = {}) {
  return spawnSync('bash', ['-s', '--', ...args], {
    encoding: 'utf8',
    input: script,
    env: { ...sb.env, ...env },
  });
}

const out = (r) => `${r.stdout}${r.stderr}`;
const dockerCalls = (sb) => sb.read('docker.log').split('\n').filter(Boolean);

// ── #211: host key pinning ───────────────────────────────────────────────────

test('no step trusts an unknown vm-103 host key', () => {
  assert.doesNotMatch(WF_TEXT, /StrictHostKeyChecking=(no|accept-new)/);
  assert.doesNotMatch(WF_TEXT, /UserKnownHostsFile=\/dev\/null/);
});

test('ssh is defined once, with StrictHostKeyChecking=yes and only the pinned key', () => {
  const sshLines = STEPS.flatMap((s) => (s.run || '').split('\n')).filter((l) =>
    /(^|[\s"'=])ssh\s+-/.test(l)
  );
  assert.equal(sshLines.length, 1, `ssh defined ${sshLines.length} times:\n${sshLines.join('\n')}`);
  const [def] = sshLines;
  assert.match(def, /StrictHostKeyChecking=yes/);
  assert.match(def, /UserKnownHostsFile=\$\{?KH\}?/);
  assert.match(def, /GlobalKnownHostsFile=\/dev\/null/);
  assert.match(def, /^\s*echo "SSH_CMD=ssh /, 'SSH_CMD is exported once for every later step');
});

test('the host key comes from the VM103_HOST_KEY repository variable, never inline', () => {
  assert.equal(PIN().env.VM103_HOST_KEY, '${{ vars.VM103_HOST_KEY }}');
  // The repo is mirrored to a public GitHub repo: no key material in the file.
  assert.doesNotMatch(WF_TEXT, /(ssh-ed25519|ecdsa-sha2-nistp\d+|ssh-rsa)\s+AAAA[A-Za-z0-9+/]{16}/);
});

test('the host key is pinned before any step that reaches vm-103', () => {
  assert.equal(STEPS.indexOf(PIN()), 0, 'pin step runs first (before the image wait)');
  for (const s of STEPS.slice(1)) {
    assert.doesNotMatch(s.run || '', /\bssh\s+-/, `${s.name} builds its own ssh command`);
  }
});

test('no expression interpolation inside run bodies (act_runner caveat)', () => {
  for (const s of STEPS) assert.ok(!(s.run || '').includes('${{'), `${s.name} has \${{ in run`);
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

test('the pinned known_hosts file is removed at the end, whatever happened', () => {
  const s = step(/known_hosts/);
  assert.equal(STEPS.indexOf(s), STEPS.length - 1);
  assert.match(String(s.if), /always\(\)/);
});

// ── #207: compose.yaml delivery ──────────────────────────────────────────────

const OLD_COMPOSE = `services:\n  jaghelm:\n    image: ${LATEST}\n    network_mode: host\n`;

function stageEnv(extra = {}) {
  return {
    PR_TOKEN: 'tok-not-on-argv',
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
  assert.equal(env.IMAGE_PULLED, '1');
  assert.equal(env.COMPOSE_SHA256, sha256(REPO_COMPOSE));
  assert.equal(env.ROLLBACK_ARMED, '1');
});

test('docker compose config is only run in modes that print no .env values', () => {
  // Every invocation (comments and messages name it without options).
  const calls = WF_TEXT.match(/docker compose config\s+-\S*/g) || [];
  assert.deepEqual(calls, ['docker compose config -q', 'docker compose config --images']);
  assert.doesNotMatch(WF_TEXT, /docker compose config\s*(\)|<|\||$)/m, 'bare config prints .env');
});

test('stage: a failed fetch fails before vm-103 is touched', (t) => {
  const sb = stagedSandbox(t);
  const r = runStep(sb, STAGE(), stageEnv({ FAKE_CURL_RC: '22' }));
  assert.notEqual(r.status, 0);
  assert.equal(sb.read('ssh.log'), '', 'no SSH at all');
  assert.equal(readFileSync(sb.stackFile('compose.yaml'), 'utf8'), OLD_COMPOSE);
  assert.equal(githubEnv(sb).ROLLBACK_ARMED, undefined);
});

test('stage: arming the rollback is the last thing it does', () => {
  const lines = STAGE().run.trimEnd().split('\n');
  assert.match(lines[lines.length - 1], /ROLLBACK_ARMED=1.*GITHUB_ENV/);
});

// The remote install script, run directly for its failure paths.
function install(sb, want, env = {}) {
  writeFileSync(sb.stackFile('compose.yaml.new'), REPO_COMPOSE);
  return runRemote(sb, heredoc(STAGE().run, 'INSTALL_COMPOSE'), [sb.stack, want], env);
}

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

// ── switch, gate, rollback ───────────────────────────────────────────────────

function stagedAndSwitched(t, extra = {}) {
  const sb = stagedSandbox(t);
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

test('switch: falls back to compose pull when the commit image was not pulled', (t) => {
  const { sb, switched } = stagedAndSwitched(t, { FAKE_PULL_RC: '1' });
  assert.equal(switched.status, 0, out(switched));
  const calls = dockerCalls(sb);
  assert.ok(
    calls.some((c) => c.startsWith('compose pull|')),
    calls.join('\n')
  );
  assert.ok(!calls.some((c) => c.startsWith('tag ')));
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

test('the health gate only verifies; rollback lives in one step that runs on any failure', () => {
  assert.doesNotMatch(VERIFY().run, /docker (tag|compose)/);
  assert.match(String(ROLLBACK().if), /failure\(\)/);
  assert.ok(STEPS.indexOf(ROLLBACK()) > STEPS.indexOf(VERIFY()));
  const prune = step(/^Prune/);
  assert.ok(STEPS.indexOf(prune) > STEPS.indexOf(ROLLBACK()));
  assert.equal(prune.if, undefined, 'prune runs only after a healthy deploy');
});

test('rollback: restores the previous compose.yaml, then the previous image, then recreates', (t) => {
  const { sb, switched } = stagedAndSwitched(t);
  assert.equal(switched.status, 0);
  const before = dockerCalls(sb).length;
  const r = runStep(sb, ROLLBACK());
  assert.equal(r.status, 0, out(r));
  assert.equal(readFileSync(sb.stackFile('compose.yaml'), 'utf8'), OLD_COMPOSE);
  const calls = dockerCalls(sb).slice(before);
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
