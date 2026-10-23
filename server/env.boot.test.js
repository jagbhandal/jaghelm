/**
 * The environment at boot (#249), on the real server (`node server/index.js`):
 *
 * - An install that sets today's names (PROMETHEUS_URL, KUMA_URL, GITEA_URL,
 *   GITEA_TOKEN, DASH_*, TRUST_PROXY) starts and reads Prometheus and Gitea
 *   as before, with one deprecation warning for each old name (GITEA_URL,
 *   GITEA_TOKEN) and no value in the log.
 * - A value the old code let through (LOG_LEVEL=trace, CSP_REPORT_ONLY=0,
 *   ARCANE_RELEASE_CHECK_HOURS=6h) starts: one warning names each variable,
 *   never its value, and its default is used, the safe side (the CSP
 *   enforced).
 * - A bad PORT or JAGHELM_BLOCK_PRIVATE_NETWORKS stops the start: one error
 *   line names each, never the value, and nothing listens.
 * - `npm start` reads the .env in its working directory before any module
 *   reads the environment, so LOG_LEVEL and JAGHELM_DATA_DIR there count.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverEntry = fileURLToPath(new URL('./index.js', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'jh-env-boot-'));
after(() => rmSync(root, { recursive: true, force: true }));

const GITEA_TOKEN = 'old-name-token-7d3f'; // pragma: allowlist secret
const DASH_SECRET = 'env-boot-test-secret-at-least-16'; // pragma: allowlist secret

let dirs = 0;

/**
 * Start the server with `vars` over a clean environment (PATH and HOME, none
 * of the runner's own variables; a var given as undefined is left out), in
 * `cwd`, until `done(lines)` (asked as it writes and every 50 ms) or it exits;
 * stop it. `ready(port)` runs before it is stopped, when it listens. Returns
 * its output, its JSON lines and the code it exited with on its own (null: it
 * was still running).
 */
async function boot(vars, done, { cwd = root, ready } = {}) {
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    JAGHELM_DATA_DIR: join(root, `d${++dirs}`),
    JAGHELM_HOST: '127.0.0.1',
    PORT: '0',
    DASH_SECRET,
    ...vars,
  };
  for (const [k, value] of Object.entries(env)) if (value === undefined) delete env[k];
  const child = spawn(process.execPath, [serverEntry], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  const lines = () =>
    out
      .split('\n')
      .filter((l) => l.startsWith('{'))
      .flatMap((l) => {
        try {
          return [JSON.parse(l)];
        } catch {
          return []; // a line still being written
        }
      });
  let code = null;
  let waiting = true;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  await new Promise((resolve) => {
    const finish = () => (clearTimeout(deadline), clearInterval(poll), resolve());
    const deadline = setTimeout(finish, 30_000);
    const check = () => done(lines()) && finish();
    const poll = setInterval(check, 50);
    child.stdout.on('data', (d) => ((out += d), check()));
    child.stderr.on('data', (d) => ((out += d), check()));
    exited.then((c) => {
      if (waiting) code = c;
      finish();
    });
  });
  const running = code === null && child.exitCode === null;
  waiting = false;
  const port = lines().find((l) => l.msg === 'listening')?.port;
  if (running && port && ready) await ready(port);
  if (running) {
    child.kill('SIGTERM');
    const killer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    await exited;
    clearTimeout(killer);
  }
  return { out, lines: lines(), code };
}

test("today's names: the server starts and reads its sources as before, one deprecation warning per old name, no value logged", async () => {
  const seen = [];
  const upstream = createServer((req, res) => {
    seen.push([req.url, req.headers.authorization ?? null]);
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/api/v1/query')) return res.end('{"status":"success","data":{"resultType":"vector","result":[]}}');
    if (req.url.startsWith('/api/v1/targets')) return res.end('{"status":"success","data":{"activeTargets":[]}}');
    if (req.url.startsWith('/api/v1/repos/search')) return res.end('{"ok":true,"data":[{"name":"r","full_name":"o/r","default_branch":"trunk"}]}');
    if (req.url.startsWith('/api/v1/repos/o/r/commits')) return res.end('[]');
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  after(() => upstream.close());
  const base = `http://127.0.0.1:${upstream.address().port}`;

  const { out, lines, code } = await boot(
    {
      PROMETHEUS_URL: base,
      KUMA_URL: base,
      GITEA_URL: base,
      GITEA_TOKEN,
      DASH_USER: 'admin',
      DASH_PASS: '',
      TRUST_PROXY: '127.0.0.1',
      LOG_LEVEL: 'info',
    },
    (ls) => ls.some((l) => l.msg === 'listening') && seen.some(([u]) => u.includes('/commits'))
  );

  assert.equal(code, null, `it kept running:\n${out}`);
  assert.deepEqual(
    lines.filter((l) => l.level === 'warn' && l.variable).map((l) => [l.variable, l.use, l.msg]),
    [
      ['GITEA_URL', 'JAGHELM_GITEA_URL', 'GITEA_URL is deprecated: rename it to JAGHELM_GITEA_URL. A later release reads only JAGHELM_GITEA_URL'],
      ['GITEA_TOKEN', 'JAGHELM_GITEA_TOKEN', 'GITEA_TOKEN is deprecated: rename it to JAGHELM_GITEA_TOKEN. A later release reads only JAGHELM_GITEA_TOKEN'],
    ],
    out
  );
  assert.ok(!out.includes(GITEA_TOKEN), 'the token is never logged');
  // Gitea polled under the old names: the token in the header, the repo's default branch.
  assert.ok(seen.some(([u, auth]) => u === '/api/v1/repos/search?limit=20' && auth === `token ${GITEA_TOKEN}`), JSON.stringify(seen));
  assert.ok(seen.some(([u]) => u === '/api/v1/repos/o/r/commits?limit=5&sha=trunk&stat=false&verification=false&files=false'), JSON.stringify(seen));
  assert.ok(seen.some(([u]) => u.startsWith('/api/v1/query')), 'Prometheus read');
  assert.ok(!lines.some((l) => l.level === 'error'), out);
});

test('a value the old code let through starts: one warning per variable, never its value, and the safe default (the CSP enforced)', async () => {
  let csp;
  const { out, lines, code } = await boot(
    {
      PROMETHEUS_URL: 'http://127.0.0.1:1',
      KUMA_URL: 'http://127.0.0.1:1',
      LOG_LEVEL: 'trace',
      CSP_REPORT_ONLY: '0',
      ARCANE_RELEASE_CHECK_HOURS: '6h',
    },
    (ls) => ls.some((l) => l.msg === 'listening'),
    {
      ready: async (port) => {
        const r = await fetch(`http://127.0.0.1:${port}/api/health`);
        csp = [r.headers.get('content-security-policy'), r.headers.get('content-security-policy-report-only')];
      },
    }
  );

  assert.equal(code, null, `it started:\n${out}`);
  assert.deepEqual(
    lines.filter((l) => l.variable).map((l) => [l.level, l.variable, l.msg]),
    [
      ['warn', 'ARCANE_RELEASE_CHECK_HOURS', 'ARCANE_RELEASE_CHECK_HOURS must be a whole number: using the default, 6'],
      ['warn', 'LOG_LEVEL', 'LOG_LEVEL must be one of debug, info, warn, error, silent: using the default, info'],
      ['warn', 'CSP_REPORT_ONLY', 'CSP_REPORT_ONLY must be true or false: using the default, false'],
    ],
    out
  );
  for (const value of ['trace', '6h']) assert.ok(!out.includes(value), `${value} in:\n${out}`);
  assert.ok(csp[0]?.includes("script-src 'self'"), `the CSP is enforced: ${csp}`);
  assert.equal(csp[1], null, 'not report-only');
});

test('a bad PORT or JAGHELM_BLOCK_PRIVATE_NETWORKS stops the start: one line each names the variable, never its value, and nothing listens', async () => {
  const { out, lines, code } = await boot(
    { PROMETHEUS_URL: 'http://127.0.0.1:1', KUMA_URL: 'http://127.0.0.1:1', PORT: 'port-http-x', JAGHELM_BLOCK_PRIVATE_NETWORKS: 'yes-strict' },
    () => false
  );

  assert.equal(code, 1, out);
  assert.deepEqual(
    lines.filter((l) => l.level === 'error').map((l) => [l.variable, l.msg]),
    [
      ['PORT', "PORT must be a port number from 0 to 65535: JagHelm won't start until it is fixed"],
      ['JAGHELM_BLOCK_PRIVATE_NETWORKS', "JAGHELM_BLOCK_PRIVATE_NETWORKS must be true or false: JagHelm won't start until it is fixed"],
    ],
    out
  );
  for (const value of ['port-http-x', 'yes-strict']) assert.ok(!out.includes(value), `${value} in:\n${out}`);
  assert.ok(!lines.some((l) => l.msg === 'listening'), out);
});

test('npm start reads its .env before any module reads the environment: LOG_LEVEL and JAGHELM_DATA_DIR there count', async () => {
  const dir = join(root, 'dotenv');
  mkdirSync(dir);
  const dataDir = join(dir, 'state-from-dotenv');
  writeFileSync(
    join(dir, '.env'),
    `LOG_LEVEL=debug\nJAGHELM_DATA_DIR=${dataDir}\nPROMETHEUS_URL=http://127.0.0.1:1\nKUMA_URL=http://127.0.0.1:1\n`
  );
  const { out, lines, code } = await boot(
    { JAGHELM_DATA_DIR: undefined },
    (ls) => ls.some((l) => l.msg === 'listening'),
    { cwd: dir }
  );

  assert.equal(code, null, out);
  assert.ok(lines.some((l) => l.level === 'debug'), `LOG_LEVEL=debug from .env: a debug line\n${out}`);
  assert.ok(existsSync(dataDir), `JAGHELM_DATA_DIR from .env is the data dir\n${out}`);
});
