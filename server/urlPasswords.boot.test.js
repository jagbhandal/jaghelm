/**
 * #419 (after #409): a PROMETHEUS_URL, KUMA_URL or GITEA_URL with a user or
 * password in it is refused at boot. It is never requested and never logged:
 * that source is off, the board (/api/status) and /api/health say so naming
 * the variable, and the boot warns once, without the value. A URL without one
 * is used as before.
 *
 * Boots the real server (`node server/index.js`) at LOG_LEVEL=debug, with a
 * node in services.yaml so each cycle reads Prometheus and Kuma, and reads
 * everything it writes to stdout and stderr. A preload runs setInterval fast
 * (any period becomes at most 50 ms), so several cycles run within a second,
 * and writes each URL the server hands to fetch to a file of its own (not the
 * log), so the test can tell what was requested.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { SOURCE_URLS, sourceUrl } from './sourceUrls.js';

const serverEntry = fileURLToPath(new URL('./index.js', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'jh-source-urls-'));
after(() => rmSync(root, { recursive: true, force: true }));

// Nothing listens on port 1: a source left at it fails each cycle, fast.
const CLOSED = 'http://127.0.0.1:1';

const preload = join(root, 'preload.mjs');
writeFileSync(
  preload,
  `
import timers from 'node:timers';
import { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const setIntervalOrig = globalThis.setInterval;
timers.setInterval = globalThis.setInterval = function (fn, ms, ...rest) {
  return setIntervalOrig.call(this, fn, Math.min(Number(ms) || 0, 50), ...rest);
};
syncBuiltinESMExports();
const fetchOrig = globalThis.fetch;
globalThis.fetch = function (input, init) {
  appendFileSync(process.env.TEST_FETCH_LOG, String(input?.url ?? input) + '\\n');
  return fetchOrig.call(this, input, init);
};
`
);

let dirs = 0;

/** A data dir whose services.yaml has one node, so each cycle reads Prometheus and Kuma. */
function dataDirWithNode() {
  const dataDir = join(root, `d${++dirs}`);
  mkdirSync(dataDir);
  writeFileSync(
    join(dataDir, 'services.yaml'),
    'nodes:\n  pi:\n    prometheus_node: pi\n    display_name: pi\n    visible: true\nservices: {}\n'
  );
  return dataDir;
}

/**
 * Boot the server with `urls` (PROMETHEUS_URL, KUMA_URL, GITEA_URL; one left
 * out is unset), wait for 3 background cycles, read /api/health, /api/status
 * and /api/readyz, stop it, and return what it wrote, its JSON lines, the
 * three answers and the URLs it handed to fetch.
 */
async function boot(urls, extraEnv = {}) {
  const dataDir = dataDirWithNode();
  const fetchLog = join(dataDir, 'fetches.txt');
  const env = {
    ...process.env,
    JAGHELM_DATA_DIR: dataDir,
    JAGHELM_HOST: '127.0.0.1',
    PORT: '0',
    LOG_LEVEL: 'debug',
    KUMA_API_KEY: 'k', // the /metrics path first, then the status page
    TEST_FETCH_LOG: fetchLog,
    ...urls,
    ...extraEnv,
  };
  for (const k of ['DASH_PASS', 'DEMO_MODE', 'ARCANE_URL', 'ARCANE_API_KEY', 'CSP_CONNECT_EXTRA', 'NODE_TEST_CONTEXT']) {
    if (!(k in extraEnv)) delete env[k];
  }
  for (const { variable } of Object.values(SOURCE_URLS)) if (!(variable in urls)) delete env[variable];
  const child = spawn(process.execPath, ['--import', pathToFileURL(preload).href, serverEntry], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  const parsed = () =>
    out
      .split('\n')
      .filter((l) => l.startsWith('{'))
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null; // a line still being written
        }
      })
      .filter(Boolean);
  const exited = new Promise((resolve) => child.once('exit', resolve));
  await new Promise((resolve) => {
    const deadline = setTimeout(resolve, 30_000);
    const check = () => {
      const ls = parsed();
      if (ls.some((l) => l.msg === 'listening') && ls.filter((l) => l.msg === 'background cycle complete').length >= 3) {
        clearTimeout(deadline);
        resolve();
      }
    };
    child.stdout.on('data', (d) => ((out += d), check()));
    child.stderr.on('data', (d) => ((out += d), check()));
    child.once('exit', () => (clearTimeout(deadline), resolve()));
  });
  const port = parsed().find((l) => l.msg === 'listening')?.port;
  const get = async (path) => {
    const r = await fetch(`http://127.0.0.1:${port}${path}`);
    return { code: r.status, body: await r.json() };
  };
  const [health, status, readyz] = port
    ? [await get('/api/health'), await get('/api/status'), await get('/api/readyz')]
    : [];
  child.kill('SIGTERM');
  const killer = setTimeout(() => child.kill('SIGKILL'), 10_000);
  await exited;
  clearTimeout(killer);
  const fetched = existsSync(fetchLog) ? readFileSync(fetchLog, 'utf8').split('\n').filter(Boolean) : [];
  return { out, lines: parsed(), health, status, readyz, fetched };
}

// Each source with a credential written two ways: as userinfo, and as a
// password of digits then a raw # or / (the URL parses as host:port, #419).
// Its host is its own, under .invalid, so the fetch log shows a request to it.
const CASES = [
  ['prometheus', 'http://jag:hunter2@prom.invalid:9090', 'http://jag:90417#hunter2@prom.invalid'], // pragma: allowlist secret
  ['kuma', 'http://jag:hunter2@kuma.invalid:3001', 'http://jag:90417/hunter2@kuma.invalid'], // pragma: allowlist secret
  ['gitea', 'http://jag:hunter2@git.invalid:3000', 'http://jag:90417/hunter2@git.invalid'], // pragma: allowlist secret
];

for (const [name, ...values] of CASES) {
  const { variable } = SOURCE_URLS[name];
  const host = new URL(values[0]).hostname;
  for (const value of values) {
    test(`${variable}=${value.replace(/hunter2/, '…')}: the source is off, named on the board and in /api/health, never requested or logged (#419)`, async () => {
      const urls = { PROMETHEUS_URL: CLOSED, KUMA_URL: CLOSED, [variable]: value };
      const { out, lines, health, status, readyz, fetched } = await boot(urls);
      const { problem } = sourceUrl(name, urls);

      // Never logged: not the password, not the digits, not the host.
      for (const part of ['hunter2', '90417', host]) assert.ok(!out.includes(part), `${part} in the log:\n${out}`);
      // Never requested.
      assert.deepEqual(fetched.filter((u) => u.includes(host) || u.includes('hunter2')), [], 'nothing requested');
      assert.ok(fetched.length > 0, 'the other sources were read');
      // One warn line at boot names the variable, and no other line does.
      const naming = lines.filter((l) => JSON.stringify(l).includes(variable));
      assert.deepEqual(
        naming.map((l) => [l.level, l.msg, l.variable]),
        [['warn', problem, variable]],
        out
      );

      // /api/health: the variable refused, with where a credential goes; the probe still ok.
      assert.equal(health.code, 200);
      assert.equal(health.body.status, 'ok');
      assert.deepEqual(health.body.sourceUrls, { [name]: { state: 'refused', variable, problem } });

      // The board: the source failed, its issue "Off" with the problem.
      assert.equal(status.code, 200, JSON.stringify(status.body));
      assert.equal(status.body.sources[name]?.state, 'failed', JSON.stringify(status.body.sources));
      assert.equal(status.body.sources[name].error, problem);
      const issue = status.body.issues.find((i) => i.id === `sources/${name}`);
      assert.deepEqual([issue?.word, issue?.reason], ['Off', problem], JSON.stringify(status.body.issues));

      // /api/readyz reads the same URLs: a refused one is not ready, unasked.
      if (name !== 'gitea') assert.equal(readyz.body.checks[name], false);
    });
  }
}

test('URLs without a credential are used as before: each source is requested, nothing is refused (#419)', async () => {
  const paths = [];
  const upstream = createServer((req, res) => {
    paths.push(req.url);
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/api/v1/query')) return res.end('{"status":"success","data":{"resultType":"vector","result":[]}}');
    if (req.url.startsWith('/api/v1/targets')) return res.end('{"status":"success","data":{"activeTargets":[]}}');
    if (req.url.startsWith('/api/v1/repos/search')) return res.end('{"ok":true,"data":[]}');
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  after(() => upstream.close());
  const base = `http://127.0.0.1:${upstream.address().port}`;

  // An entry the CSP check refuses, which index.js warns about (#409).
  const csp = 'http://jag:hunter2@127.0.0.1:9/x y'; // pragma: allowlist secret
  const { out, lines, health } = await boot(
    { PROMETHEUS_URL: base, KUMA_URL: base, GITEA_URL: base },
    { CSP_CONNECT_EXTRA: csp }
  );

  assert.ok(paths.some((p) => p.startsWith('/api/v1/query')), `Prometheus read: ${paths}`);
  assert.ok(paths.some((p) => p === '/metrics' || p.startsWith('/api/status-page/')), `Kuma read: ${paths}`);
  assert.ok(paths.some((p) => p.startsWith('/api/v1/repos/search')), `Gitea read: ${paths}`);
  assert.deepEqual(health.body.sourceUrls, {});
  assert.equal(lines.find((l) => l.msg === 'Prometheus URL')?.promUrl, base, out);
  assert.equal(lines.find((l) => l.msg === 'Uptime Kuma URL')?.kumaUrl, base, out);
  for (const { variable } of Object.values(SOURCE_URLS)) {
    assert.ok(!lines.some((l) => l.level === 'warn' && JSON.stringify(l).includes(variable)), `${variable}: ${out}`);
  }
  // The CSP warning keeps the host and loses the password (#409).
  assert.ok(!out.includes('hunter2'), out);
  const [cspLine] = lines.filter((l) => l.msg === 'ignoring invalid CSP_CONNECT_EXTRA entry');
  assert.equal(cspLine?.entry, 'http://jag:[redacted]@127.0.0.1:9/x y', out);
});
