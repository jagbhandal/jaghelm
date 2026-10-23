/**
 * #419 (after #409): a PROMETHEUS_URL, KUMA_URL or JAGHELM_GITEA_URL with a user or
 * password in it is refused at boot. It is never requested and never logged:
 * that source is off, the board (/api/status) and /api/health say so naming
 * the variable, and the boot warns once, without the value. A URL without one
 * is used as before. So is an integration's URL, from its `.env` variable or
 * its keyed `url` secret: never requested, its error names where it came from.
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
import { spawn, spawnSync } from 'node:child_process';
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

/**
 * A data dir whose services.yaml has one node, so each cycle reads Prometheus
 * and Kuma, and the `integrations` YAML given.
 */
function dataDirWithNode(integrations = '') {
  const dataDir = join(root, `d${++dirs}`);
  mkdirSync(dataDir);
  writeFileSync(
    join(dataDir, 'services.yaml'),
    'nodes:\n  pi:\n    prometheus_node: pi\n    display_name: pi\n    visible: true\nservices: {}\n' + integrations
  );
  return dataDir;
}

const DASH_SECRET = 'boot-test-secret-at-least-16-chars'; // pragma: allowlist secret
const secretsModule = pathToFileURL(fileURLToPath(new URL('./secrets.js', import.meta.url))).href;

/** Store `value` as the secret `name` in `dataDir`'s secrets.json, as the server would. */
function storeSecret(dataDir, name, value) {
  const script = `const m = await import(${JSON.stringify(secretsModule)}); m.initSecrets(); if (!m.setSecret(process.env.S_NAME, process.env.S_VALUE)) process.exit(3);`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { PATH: process.env.PATH, JAGHELM_DATA_DIR: dataDir, DASH_SECRET, S_NAME: name, S_VALUE: value },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
}

/**
 * Boot the server with `urls` (PROMETHEUS_URL, KUMA_URL, JAGHELM_GITEA_URL; one left
 * out is unset), wait for 3 background cycles, read /api/health, /api/status,
 * /api/readyz and /api/integrations, stop it, and return what it wrote, its
 * JSON lines, the four answers and the URLs it handed to fetch.
 * `integrations` is services.yaml's integrations YAML, and `secrets` the
 * secrets stored before the boot.
 */
async function boot(urls, extraEnv = {}, { integrations = '', secrets = {} } = {}) {
  const dataDir = dataDirWithNode(integrations);
  for (const [name, value] of Object.entries(secrets)) storeSecret(dataDir, name, value);
  const fetchLog = join(dataDir, 'fetches.txt');
  const env = {
    ...process.env,
    JAGHELM_DATA_DIR: dataDir,
    JAGHELM_HOST: '127.0.0.1',
    PORT: '0',
    LOG_LEVEL: 'debug',
    KUMA_API_KEY: 'k', // the /metrics path first, then the status page
    DASH_SECRET,
    TEST_FETCH_LOG: fetchLog,
    ...urls,
    ...extraEnv,
  };
  for (const k of ['DASH_PASS', 'DEMO_MODE', 'ARCANE_URL', 'ARCANE_API_KEY', 'CSP_CONNECT_EXTRA', 'NODE_TEST_CONTEXT']) {
    if (!(k in extraEnv)) delete env[k];
  }
  for (const { variable } of Object.values(SOURCE_URLS)) if (!(variable in urls)) delete env[variable];
  // Their old names too (#249), so the runner's own environment can't stand in.
  for (const k of ['GITEA_URL', 'GITEA_TOKEN']) if (!(k in urls)) delete env[k];
  for (const k of ['JAGHELM_GRAFANA_URL', 'JAGHELM_GRAFANA_TOKEN', 'GRAFANA_URL', 'GRAFANA_TOKEN']) {
    if (!(k in extraEnv)) delete env[k];
  }
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
  const [health, status, readyz, integrationsRead] = port
    ? [await get('/api/health'), await get('/api/status'), await get('/api/readyz'), await get('/api/integrations')]
    : [];
  child.kill('SIGTERM');
  const killer = setTimeout(() => child.kill('SIGKILL'), 10_000);
  await exited;
  clearTimeout(killer);
  const fetched = existsSync(fetchLog) ? readFileSync(fetchLog, 'utf8').split('\n').filter(Boolean) : [];
  return { out, lines: parsed(), health, status, readyz, integrations: integrationsRead, fetched };
}

// A real port (≤ 65535), so a password of these digits then a raw /, # or ?
// makes a URL that parses as host `jag`, this port, and no user (#419).
const PORT_DIGITS = '61753';

/**
 * `text` without the log's own numbers, which can hold any digits by chance: the
 * `time` stamp, numeric `pid` and `ms` fields, and the `listening` line (its
 * port is whatever the OS gave). What is left must not hold the credential's
 * digits in any field or URL (#594).
 */
const withoutLogNoise = (text) =>
  text
    .split('\n')
    .filter((l) => !/"msg":"listening"/.test(l))
    .join('\n')
    .replace(/"time":"[^"]*"/g, '"time":""')
    .replace(/"(pid|ms)":\d+(\.\d+)?/g, '"$1":0');

test('withoutLogNoise: digits in time, pid, ms or the listening line are dropped; in a URL or any string field they stay', () => {
  const noise = [
    `{"time":"2026-10-23T12:${PORT_DIGITS}Z","level":"info","msg":"x","pid":${PORT_DIGITS},"ms":${PORT_DIGITS}}`,
    `{"time":"2026-10-23T12:00:00.${PORT_DIGITS}Z","msg":"listening","port":${PORT_DIGITS}}`,
  ].join('\n');
  assert.ok(!withoutLogNoise(noise).includes(PORT_DIGITS));
  for (const leak of [
    `{"msg":"x","url":"http://jag:${PORT_DIGITS}"}`,
    `{"msg":"x","host":"jag","port":"${PORT_DIGITS}"}`,
    `{"msg":"x","password":"${PORT_DIGITS}"}`,
  ]) {
    assert.ok(withoutLogNoise(`{"time":"2026-10-23T12:00:00.000Z",${leak.slice(1)}`).includes(PORT_DIGITS), leak);
  }
});

/** Assert `value` reaches the shape its case names: userinfo, or host:port with no user. */
function assertShape(value) {
  const u = new URL(value);
  if (value.includes(`:${PORT_DIGITS}`)) {
    assert.deepEqual([u.username, u.password, u.hostname, u.port], ['', '', 'jag', PORT_DIGITS], value);
  } else {
    assert.deepEqual([u.username, u.password], ['jag', 'hunter2'], value); // pragma: allowlist secret
  }
}

// Each source with a credential written two ways: as userinfo, and as a
// password of digits then a raw #, / or ? (the URL parses as host:port, #419).
// Its host is its own, under .invalid, so the fetch log shows a request to it.
const CASES = [
  ['prometheus', 'http://jag:hunter2@prom.invalid:9090', `http://jag:${PORT_DIGITS}#hunter2@prom.invalid`], // pragma: allowlist secret
  ['kuma', 'http://jag:hunter2@kuma.invalid:3001', `http://jag:${PORT_DIGITS}/hunter2@kuma.invalid`], // pragma: allowlist secret
  ['gitea', 'http://jag:hunter2@git.invalid:3000', `http://jag:${PORT_DIGITS}?hunter2@git.invalid`], // pragma: allowlist secret
];

for (const [name, ...values] of CASES) {
  const { variable } = SOURCE_URLS[name];
  const host = new URL(values[0]).hostname;
  for (const value of values) {
    test(`${variable}=${value.replace(/hunter2/, '…')}: the source is off, named on the board and in /api/health, never requested or logged (#419)`, async () => {
      assertShape(value);
      const urls = { PROMETHEUS_URL: CLOSED, KUMA_URL: CLOSED, [variable]: value };
      const { out, lines, health, status, readyz, fetched } = await boot(urls);
      const { problem } = sourceUrl(name, urls);

      // Never logged: not the password, not the digits, not the host.
      for (const part of ['hunter2', host]) assert.ok(!out.includes(part), `${part} in the log:\n${out}`);
      assert.ok(!withoutLogNoise(out).includes(PORT_DIGITS), `${PORT_DIGITS} in the log:\n${out}`);
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

// An integration preset (Grafana: JAGHELM_GRAFANA_URL, its token in JAGHELM_GRAFANA_TOKEN)
// whose URL comes from its .env variable, in each shape, and from its keyed url
// secret (#419). The token is set, so a request would carry it.
const TOKEN = 'grafana-tok-5c1e'; // pragma: allowlist secret
const INTEGRATION_CASES = [
  ['JAGHELM_GRAFANA_URL', 'http://jag:hunter2@graf.invalid:3000'], // pragma: allowlist secret
  ['JAGHELM_GRAFANA_URL', `http://jag:${PORT_DIGITS}/hunter2@graf.invalid`], // pragma: allowlist secret
  ['JAGHELM_GRAFANA_URL', `http://jag:${PORT_DIGITS}#hunter2@graf.invalid`], // pragma: allowlist secret
  ['JAGHELM_GRAFANA_URL', `http://jag:${PORT_DIGITS}?hunter2@graf.invalid`], // pragma: allowlist secret
  ['integration_grafana_url', `http://jag:${PORT_DIGITS}/hunter2@graf.invalid`], // pragma: allowlist secret
];

for (const [from, value] of INTEGRATION_CASES) {
  test(`an integration URL from ${from}=${value.replace(/hunter2/, '…')} is never requested; its error names ${from}, never the value (#419)`, async () => {
    assertShape(value);
    const inEnv = from === 'JAGHELM_GRAFANA_URL';
    const { out, lines, status, integrations, fetched } = await boot(
      { PROMETHEUS_URL: CLOSED, KUMA_URL: CLOSED },
      { JAGHELM_GRAFANA_TOKEN: TOKEN, ...(inEnv && { JAGHELM_GRAFANA_URL: value }) },
      { integrations: 'integrations:\n  grafana: {}\n', secrets: inEnv ? {} : { [from]: value } }
    );

    // Nothing requested, so the token went nowhere.
    assert.deepEqual(fetched.filter((u) => /graf\.invalid|\/\/jag|hunter2/.test(u)), [], 'nothing requested');
    assert.ok(fetched.length > 0, 'the sources were read');
    // The integration's error names where its URL came from.
    const error = integrations.body.grafana?._error;
    assert.ok(error?.includes(from), JSON.stringify(integrations.body));
    assert.match(error, inEnv ? /^JAGHELM_GRAFANA_URL carries a user name or password.*JAGHELM_GRAFANA_TOKEN/ : /^The stored url/);
    // Never the value: not in the log, the error or the board.
    for (const text of [out, JSON.stringify(integrations.body), JSON.stringify(status.body)]) {
      for (const part of ['hunter2', 'graf.invalid', TOKEN]) assert.ok(!text.includes(part), `${part} in:\n${text}`);
      assert.ok(!withoutLogNoise(text).includes(PORT_DIGITS), `${PORT_DIGITS} in:\n${text}`);
    }
    // One warn line over three cycles, naming the source.
    const warned = lines.filter((l) => l.level === 'warn' && JSON.stringify(l).includes(from));
    assert.deepEqual(warned.map((l) => [l.msg, l.integration]), [[error, 'grafana']], out);
  });
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
    { PROMETHEUS_URL: base, KUMA_URL: base, JAGHELM_GITEA_URL: base },
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
