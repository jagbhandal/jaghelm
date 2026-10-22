// Guards .gitea/workflows/deploy.yml:
//   #211  every SSH to vm-103 verifies a host key pinned from the VM103_HOST_KEY
//         repository variable, and the deploy fails closed without it;
//   #207  the deploy delivers this commit's compose.yaml to vm-103, verifies it
//         there, and a rollback restores the image AND the compose.yaml together;
//   #356  a deploy whose image never arrives fails and changes nothing (no
//         fallback to :latest), and a green deploy means this commit is live.
// The step scripts are taken from the workflow itself and run against stubs (ssh
// runs the remote command locally; docker, curl and sleep are fakes), so these
// tests exercise the real deploy code, not a copy of it. runJob runs the whole
// job, step by step, with the workflow's own if: conditions.
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
const WAIT = () => step(/^Wait for /);
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
  "manifest inspect "*)
    # The registry: misses FAKE_MANIFEST_MISSES polls, then has the image.
    n=$(cat "$FAKE_MANIFEST_COUNT" 2>/dev/null || echo 0); echo $((n + 1)) > "$FAKE_MANIFEST_COUNT"
    [ "$n" -ge "\${FAKE_MANIFEST_MISSES:-0}" ] || exit 1 ;;
  "inspect --format {{.Image}} jaghelm") [ -n "\${FAKE_PREV_IMAGE:-}" ] || exit 1; echo "$FAKE_PREV_IMAGE" ;;
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
// curl: answers the health endpoint (revision FAKE_REVISION, else this commit's);
// otherwise records argv and the -K config read from stdin, then "downloads"
// FAKE_COMPOSE_SRC to the -o path.
const FAKE_CURL = `#!/bin/sh
case "$*" in *"/api/health"*)
  printf '{"status":"ok","version":"3.0.0","revision":"%s"}\\n' "\${FAKE_REVISION-${SHA.slice(0, 7)}}"; exit 0 ;;
esac
echo "$*" > "$FAKE_CURL_ARGV"
cat > "$FAKE_CURL_CONFIG"
[ "\${FAKE_CURL_RC:-0}" = 0 ] || exit "$FAKE_CURL_RC"
out=; prev=
for a in "$@"; do [ "$prev" = -o ] && out=$a; prev=$a; done
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
      STACK_DIR: stack,
      VM103_SSH: `deploy@${TEST_HOST}`,
      SSH_CMD: path.join(bin, 'ssh-local'),
      FAKE_DOCKER_LOG: f('docker.log'),
      FAKE_SSH_LOG: f('ssh.log'),
      FAKE_CURL_ARGV: f('curl.argv'),
      FAKE_CURL_CONFIG: f('curl.config'),
      FAKE_COMPOSE_SRC: f('compose.src'),
      FAKE_MANIFEST_COUNT: f('manifest.count'),
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
function runStep(sb, s, env = {}) {
  const file = path.join(sb.dir, 'step.sh');
  writeFileSync(file, s.run);
  return spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', file], {
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

// Runs the whole job as act_runner would: steps in order, a failure skips the
// rest except failure() and always() steps, continue-on-error never fails the
// job, and any other if: (an unset repository variable) is false.
function runJob(sb, env = {}) {
  let failed = false;
  const ran = [];
  let log = '';
  for (const s of STEPS) {
    const cond = String(s.if ?? '');
    const runs = cond.includes('always()')
      ? true
      : cond.includes('failure()')
        ? failed
        : cond === '' && !failed;
    if (!runs) continue;
    const r = runStep(sb, s, { VM103_HOST_KEY: KEY_LINE, ...stageEnv(), ...env });
    ran.push(s.name);
    log += out(r);
    if (r.status !== 0 && !s['continue-on-error']) failed = true;
  }
  return { failed, ran, log };
}

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
  assert.equal(env.ROLLBACK_ARMED, '1');
});

test('docker compose config is only run in modes that print no .env values', () => {
  // Every invocation (comments and messages name it without options).
  const calls = [...WF_TEXT.matchAll(/docker compose config((?:\s+-[-\w]+(?: json)?)+)/g)];
  assert.deepEqual(
    calls.map((m) => m[1].trim()),
    ['-q', '--images', '--format json --no-interpolate --no-env-resolution']
  );
  assert.doesNotMatch(WF_TEXT, /docker compose config\s*(\)|<|\||$)/m, 'bare config prints .env');
  // The JSON one is captured and parsed, never echoed.
  const json = WF_TEXT.split('\n').find((l) => l.includes('--no-env-resolution'));
  assert.match(json, /^\s*new_cfg=\$\(docker compose config /);
  assert.ok(!/echo[^\n]*\$new_cfg|printf '%s\\n' "\$new_cfg"\s*$/m.test(STAGE().run));
});

test('the compose.yaml fetch uses the job token, limited to reading this repo', () => {
  assert.equal(STAGE().env.JOB_TOKEN, '${{ secrets.GITEA_TOKEN }}');
  assert.deepEqual(JOB.permissions, { contents: 'read' });
  assert.ok(!WF_TEXT.includes('PR_TOKEN'));
});

test('stage: a failed fetch fails before vm-103 is touched', (t) => {
  const sb = stagedSandbox(t);
  const r = runStep(sb, STAGE(), stageEnv({ FAKE_CURL_RC: '22' }));
  assert.notEqual(r.status, 0);
  assert.equal(sb.read('ssh.log'), '', 'no SSH at all');
  assert.equal(readFileSync(sb.stackFile('compose.yaml'), 'utf8'), OLD_COMPOSE);
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
const FCM = '/app/secrets/fcm-service-account.json';
// The hand-placed container today: host networking, data, uploads and the FCM key.
const RUNNING_HOST = {
  FAKE_RUNNING_NET: 'host',
  FAKE_RUNNING_MOUNTS: `/app/data\n/app/uploads\n${FCM}`,
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
    { FAKE_RUNNING_NET: 'jaghelm_default', FAKE_RUNNING_MOUNTS: `/app/data\n/app/uploads\n${FCM}` },
    { targets: ['/app/uploads', '/app/data'] },
    new RegExp(`mount ${FCM}`),
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
  const merged = configJson({ net: 'host', targets: ['/app/uploads', '/app/data', FCM] });
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
    new RegExp(`accept-drops present, dropping: network_mode host.*mount ${FCM}`)
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

// ── #356: no fallback to :latest; green means this commit is live ────────────

const LIVE = (sb) => readFileSync(sb.stackFile('compose.yaml'), 'utf8');
const verbs = (sb) => dockerCalls(sb).map((c) => c.split('|')[0]);

test('job: a missing image fails the deploy, names the build to re-run, and leaves vm-103 alone', (t) => {
  const sb = stagedSandbox(t);
  const job = runJob(sb, { FAKE_MANIFEST_MISSES: '999' });
  assert.equal(job.failed, true, job.log);
  const errors = job.log.split('\n').filter((l) => l.startsWith('::error::'));
  assert.equal(errors.length, 1, job.log);
  assert.match(errors[0], /ghcr\.io\/jagbhandal\/jaghelm:sha-abcdef0/);
  assert.match(errors[0], /"Build and Push Docker Image"/);
  assert.match(errors[0], new RegExp(`github\\.com/jagbhandal/jaghelm/commit/${SHA}`));
  assert.match(errors[0], /re-run this deploy/);
  assert.doesNotMatch(job.log, /falling back|verified healthy/);
  // Nothing reached vm-103: no SSH, no pull, no compose call, no restart.
  assert.equal(sb.read('ssh.log'), '');
  assert.deepEqual(verbs(sb).filter((v) => !v.startsWith('manifest inspect ')), []);
  assert.equal(LIVE(sb), OLD_COMPOSE);
  assert.ok(job.ran.includes(ROLLBACK().name), 'the rollback step runs and finds nothing to do');
  assert.match(job.log, /nothing to roll back/);
});

test('job: a healthy container on another revision fails the deploy and rolls back', (t) => {
  const sb = stagedSandbox(t);
  const job = runJob(sb, { FAKE_REVISION: '6565d7c' });
  assert.equal(job.failed, true, job.log);
  assert.match(job.log, /::error::.*revision 6565d7c.*abcdef0/);
  assert.doesNotMatch(job.log, /verified healthy/);
  assert.ok(job.ran.includes(ROLLBACK().name));
  assert.equal(LIVE(sb), OLD_COMPOSE, 'compose.yaml rolled back');
  assert.deepEqual(verbs(sb).slice(-2), [`tag sha256:previous ${LATEST}`, 'compose up -d --force-recreate']);
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

test('wait: keeps polling until the image appears within the wait', (t) => {
  const sb = stagedSandbox(t);
  const r = runStep(sb, WAIT(), { FAKE_MANIFEST_MISSES: '2', IMAGE_WAIT_SECONDS: '360' });
  assert.equal(r.status, 0, out(r));
  assert.equal(sb.read('manifest.count').trim(), '3');
  assert.doesNotMatch(out(r), /::error::/);
});

test('the image wait is one named variable, six minutes', () => {
  assert.equal(JOB.env.IMAGE_WAIT_SECONDS, 360);
  assert.match(WAIT().run, /\$\{IMAGE_WAIT_SECONDS:\?/);
});

test('no step falls back to :latest: no compose pull, no "image not pulled" path', () => {
  assert.doesNotMatch(WF_TEXT, /compose pull/);
  assert.doesNotMatch(WF_TEXT, /IMAGE_PULLED|image_pulled/);
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
