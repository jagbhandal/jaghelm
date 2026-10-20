/**
 * #409: a PROMETHEUS_URL and KUMA_URL with a user and password never reach the
 * server log. Node's fetch refuses such a URL, and its error names the full URL,
 * so every failing cycle used to log the password, and the boot printed both
 * URLs as they are.
 *
 * Boots the real server (`node server/index.js`) at LOG_LEVEL=debug and reads
 * everything it writes to stdout and stderr: a first boot (no services.yaml, so
 * node discovery runs and fails), and a boot with a node configured whose
 * refresh cycles fail. A preload runs setInterval fast (any period becomes at
 * most 50 ms), so the cycles after the first, which log at debug, come within
 * the second the test watches.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const serverEntry = fileURLToPath(new URL('./index.js', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'jh-cred-urls-'));
after(() => rmSync(root, { recursive: true, force: true }));

const CRED_URL = 'http://jag:hunter2@127.0.0.1:9'; // pragma: allowlist secret
const REDACTED_URL = 'http://jag:[redacted]@127.0.0.1:9';

const preload = join(root, 'fast-intervals.mjs');
writeFileSync(
  preload,
  `
import timers from 'node:timers';
import { syncBuiltinESMExports } from 'node:module';
const setIntervalOrig = globalThis.setInterval;
timers.setInterval = globalThis.setInterval = function (fn, ms, ...rest) {
  return setIntervalOrig.call(this, fn, Math.min(Number(ms) || 0, 50), ...rest);
};
syncBuiltinESMExports();
`
);

/**
 * Boot the server on `dataDir` until `done(lines)` holds (or 30 s pass), stop it,
 * and return everything it wrote and the JSON lines in it.
 */
async function boot(dataDir, done) {
  const env = {
    ...process.env,
    JAGHELM_DATA_DIR: dataDir,
    JAGHELM_HOST: '127.0.0.1',
    PORT: '0',
    LOG_LEVEL: 'debug',
    PROMETHEUS_URL: CRED_URL,
    KUMA_URL: CRED_URL,
    KUMA_API_KEY: 'k', // the /metrics path first, then the status page
    // An entry the CSP check refuses, which index.js warns about.
    CSP_CONNECT_EXTRA: `${CRED_URL}/x y`,
  };
  for (const k of ['DASH_PASS', 'DEMO_MODE', 'GITEA_URL', 'ARCANE_URL', 'ARCANE_API_KEY', 'NODE_TEST_CONTEXT']) delete env[k];
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
      if (done(parsed())) {
        clearTimeout(deadline);
        resolve();
      }
    };
    child.stdout.on('data', (d) => ((out += d), check()));
    child.stderr.on('data', (d) => ((out += d), check()));
    child.once('exit', () => (clearTimeout(deadline), resolve()));
  });
  child.kill('SIGTERM');
  const killer = setTimeout(() => child.kill('SIGKILL'), 10_000);
  await exited;
  clearTimeout(killer);
  return { out, lines: parsed() };
}

const find = (lines, msg, extra = () => true) => lines.filter((l) => l.msg === msg && extra(l));

/** The boot lines name the host, with the password taken out. */
function assertBootLines(lines, out) {
  const [prom] = find(lines, 'Prometheus URL');
  assert.equal(prom?.promUrl, REDACTED_URL, out);
  const [kuma] = find(lines, 'Uptime Kuma URL');
  assert.equal(kuma?.kumaUrl, REDACTED_URL, out);
  const [csp] = find(lines, 'ignoring invalid CSP_CONNECT_EXTRA entry');
  assert.equal(csp?.entry, `${REDACTED_URL}/x y`, out);
}

test('a first boot with credentials in both URLs logs neither password', async () => {
  const dataDir = join(root, 'first');
  const { out, lines } = await boot(dataDir, (ls) => find(ls, 'active nodes').length > 0);

  assert.ok(!out.includes('hunter2'), out);
  assertBootLines(lines, out);
  // Node discovery ran and failed on Node's refusal of the URL: the leak this guards.
  const [discovery] = find(lines, 'node discovery could not reach Prometheus; starting with no nodes');
  assert.match(String(discovery?.err), /includes credentials: http:\/\/jag:\[redacted\]@127\.0\.0\.1:9\//, out);
});

test('failing refresh cycles with credentials in both URLs log neither password', async () => {
  const dataDir = join(root, 'cycles');
  mkdirSync(dataDir);
  writeFileSync(
    join(dataDir, 'services.yaml'),
    'nodes:\n  pi:\n    prometheus_node: pi\n    display_name: pi\n    visible: true\nservices: {}\n'
  );
  const stillFailing = (ls, source) => find(ls, 'data source still failing', (l) => l.source === source).length >= 2;
  const { out, lines } = await boot(
    dataDir,
    (ls) => stillFailing(ls, 'prometheus') && stillFailing(ls, 'kuma') && find(ls, 'UPS read failed').length >= 2
  );

  assert.ok(!out.includes('hunter2'), out);
  assertBootLines(lines, out);
  // Each line the card lists ran, on Node's refusal of the URL.
  const refusal = /includes credentials: http:\/\/jag:\[redacted\]@127\.0\.0\.1:9\//;
  for (const source of ['prometheus', 'kuma']) {
    const [failed] = find(lines, 'data source failed; push alerts keep its last known state until it recovers', (l) => l.source === source);
    assert.match(String(failed?.error), refusal, `${source}: ${out}`);
    for (const l of find(lines, 'data source still failing', (x) => x.source === source)) {
      assert.match(String(l.error), refusal, `${source}: ${out}`);
    }
  }
  const noMonitors = find(lines, 'No monitors loaded from Kuma — serving last-known statuses, if any, until they go stale');
  assert.ok(noMonitors.length >= 2, out);
  for (const l of noMonitors) assert.match(String(l.err), refusal, out);
  for (const l of find(lines, 'UPS read failed')) assert.match(String(l.err), refusal, out);
});
