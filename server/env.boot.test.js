/**
 * The environment at boot (#249), on the real server (`node server/index.js`):
 *
 * - An install that sets today's names (PROMETHEUS_URL, KUMA_URL, GITEA_URL,
 *   GITEA_TOKEN, DASH_*, TRUST_PROXY) starts and reads Prometheus and Gitea
 *   as before, with one deprecation warning for each old name (GITEA_URL,
 *   GITEA_TOKEN) and no value in the log.
 * - A value that doesn't fit its variable stops the start: one error line
 *   names the variable, never the value, and nothing listens.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
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
 * of the runner's own variables), until `done(lines)` (asked as it writes and
 * every 50 ms) or it exits; stop it. Returns its output, its JSON lines and
 * the code it exited with on its own (null: it was still running).
 */
async function boot(vars, done) {
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    JAGHELM_DATA_DIR: join(root, `d${++dirs}`),
    JAGHELM_HOST: '127.0.0.1',
    PORT: '0',
    DASH_SECRET,
    ...vars,
  };
  const child = spawn(process.execPath, [serverEntry], { env, stdio: ['ignore', 'pipe', 'pipe'] });
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
      ['GITEA_URL', 'JAGHELM_GITEA_URL', 'GITEA_URL is deprecated: rename it to JAGHELM_GITEA_URL. The next release reads only JAGHELM_GITEA_URL'],
      ['GITEA_TOKEN', 'JAGHELM_GITEA_TOKEN', 'GITEA_TOKEN is deprecated: rename it to JAGHELM_GITEA_TOKEN. The next release reads only JAGHELM_GITEA_TOKEN'],
    ],
    out
  );
  assert.ok(!out.includes(GITEA_TOKEN), 'the token is never logged');
  // Gitea polled under the old names: the token in the header, the repo's default branch.
  assert.ok(seen.some(([u, auth]) => u === '/api/v1/repos/search?limit=20' && auth === `token ${GITEA_TOKEN}`), JSON.stringify(seen));
  assert.ok(seen.some(([u]) => u === '/api/v1/repos/o/r/commits?limit=5&sha=trunk'), JSON.stringify(seen));
  assert.ok(seen.some(([u]) => u.startsWith('/api/v1/query')), 'Prometheus read');
  assert.ok(!lines.some((l) => l.level === 'error'), out);
});

test('an invalid value stops the start: one line names the variable, never its value, and nothing listens', async () => {
  const { out, lines, code } = await boot(
    { PROMETHEUS_URL: 'http://127.0.0.1:1', KUMA_URL: 'http://127.0.0.1:1', JAGHELM_ICON_CACHE_MAX_MB: 'lots-of-megs', CSP_REPORT_ONLY: 'maybe-later' },
    () => false
  );

  assert.equal(code, 1, out);
  assert.deepEqual(
    lines.filter((l) => l.level === 'error').map((l) => [l.variable, l.msg]),
    [
      ['JAGHELM_ICON_CACHE_MAX_MB', "JAGHELM_ICON_CACHE_MAX_MB must be a number above 0: JagHelm won't start until it is fixed"],
      ['CSP_REPORT_ONLY', "CSP_REPORT_ONLY must be true or false: JagHelm won't start until it is fixed"],
    ],
    out
  );
  for (const value of ['lots-of-megs', 'maybe-later']) assert.ok(!out.includes(value), `${value} in:\n${out}`);
  assert.ok(!lines.some((l) => l.msg === 'listening'), out);
});
