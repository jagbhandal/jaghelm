/**
 * #248: the demo boots the real server (`node server/index.js`, DEMO_MODE=true)
 * and serves every read the web and Android clients make without one outbound
 * request, download or file write.
 *
 * Each boot runs in a child process with a preload that spies on both: every
 * TCP connection (http, https and fetch all open one), DNS lookup and global
 * fetch is recorded and refused, and every call that writes to the file system
 * is recorded. The data dir it is pointed at doesn't exist, so making it counts
 * too. In the demo boot every timer is run fast (any delay becomes at most
 * 10 ms), so a poller whose first tick comes minutes or a day after boot still
 * runs inside the test's watch, and the demo must log none of the lines the
 * live subsystems log as they start. A normal-mode boot under the same spies
 * is the control: it reaches out (discovery), writes (services.yaml) and logs
 * those lines, so the spies and the list are known to catch them.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const serverEntry = fileURLToPath(new URL('./index.js', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'jh-demo-boot-'));
after(() => rmSync(root, { recursive: true, force: true }));

const preload = join(root, 'spy.mjs');
writeFileSync(
  preload,
  `
import fs from 'node:fs';
import net from 'node:net';
import dns from 'node:dns';
import timers from 'node:timers';
import timersPromises from 'node:timers/promises';
import { syncBuiltinESMExports } from 'node:module';

const append = fs.appendFileSync;
// appendFileSync calls the (spied) writeFileSync: don't record our own record.
let recording = false;
const record = (kind, detail) => {
  if (recording) return;
  recording = true;
  try {
    append(process.env.SPY_LOG, JSON.stringify({ kind, detail: String(detail) }) + '\\n');
  } finally {
    recording = false;
  }
};

// Outbound: refused as a closed port would refuse it.
const refused = () => Object.assign(new Error('blocked by demo.boot.test.js'), { code: 'ECONNREFUSED' });
net.Socket.prototype.connect = function (...args) {
  // http and fetch hand connect() a normalised [options, callback] array.
  const o = Array.isArray(args[0]) ? args[0][0] : args[0];
  record('connect', o && typeof o === 'object' ? (o.path ?? (o.host ?? 'localhost') + ':' + o.port) : o);
  process.nextTick(() => this.destroy(refused()));
  return this;
};
// An address needs no lookup (listen() on JAGHELM_HOST asks for one); a name does.
const lookup = dns.lookup;
dns.lookup = (host, ...rest) => {
  if (net.isIP(host)) return lookup(host, ...rest);
  record('dns', host);
  const cb = rest[rest.length - 1];
  process.nextTick(() => cb(refused()));
};
const lookupP = dns.promises.lookup;
dns.promises.lookup = async (host, ...rest) => {
  if (net.isIP(host)) return lookupP(host, ...rest);
  record('dns', host);
  throw refused();
};
globalThis.fetch = async (input) => {
  record('fetch', input instanceof Request ? input.url : input);
  throw new TypeError('fetch blocked by demo.boot.test.js');
};

// Writes: recorded, then done.
const WRITES = ['writeFile', 'appendFile', 'mkdir', 'mkdtemp', 'rename', 'unlink', 'rm', 'rmdir',
  'copyFile', 'cp', 'truncate', 'symlink', 'link', 'chmod', 'chown', 'utimes'];
const writeFlag = (flags) => typeof flags === 'string' ? /[wa+]/.test(flags) : typeof flags === 'number' && (flags & 3) !== 0;
const spy = (obj, name, isWrite = () => true) => {
  const orig = obj[name];
  if (typeof orig !== 'function') return;
  obj[name] = function (...args) {
    if (isWrite(args)) record('write', name + ' ' + args[0]);
    return orig.apply(this, args);
  };
};
for (const n of WRITES) {
  spy(fs, n);
  spy(fs, n + 'Sync');
  spy(fs.promises, n);
}
spy(fs, 'open', (a) => writeFlag(a[1]));
spy(fs, 'openSync', (a) => writeFlag(a[1]));
spy(fs.promises, 'open', (a) => writeFlag(a[1]));
spy(fs, 'createWriteStream');

// Timers, fast: any delay becomes at most 10 ms, so a minute, an hour or a day
// passes in the second the test watches. The clock record proves it did.
if (process.env.SPY_FAST_TIMERS) {
  const fast = (orig) =>
    function (fn, ms, ...rest) {
      return orig.call(this, fn, Math.min(Number(ms) || 0, 10), ...rest);
    };
  timers.setTimeout = globalThis.setTimeout = fast(globalThis.setTimeout);
  timers.setInterval = globalThis.setInterval = fast(globalThis.setInterval);
  const sleep = timersPromises.setTimeout;
  timersPromises.setTimeout = (ms, ...rest) => sleep(Math.min(Number(ms) || 0, 10), ...rest);
  setTimeout(() => record('clock', 'a day of timers ran'), 24 * 60 * 60 * 1000).unref();
}
syncBuiltinESMExports();
`
);

// Every read the web and Android clients make, and a few they shouldn't reach.
const READS = [
  '/api/health',
  '/api/readyz',
  '/api/auth/check',
  '/api/display-config',
  '/api/services',
  '/api/services/config',
  '/api/services/monitors',
  '/api/history?series=node.cpu&range=1h',
  '/api/history?series=container.cpu&entity=apps/jellyfin&range=7d',
  '/api/ups',
  '/api/gitea/activity',
  '/api/cron/status',
  '/api/integrations',
  '/api/integrations/presets',
  '/api/todos',
  '/api/push/status',
  '/api/push/prefs?token=demo-device',
  '/api/status',
  '/api/weather?lat=40&lon=-83',
  '/api/icons?q=grafana',
];
// Paths no client reads: the demo answers them 404, as the live server answers
// a path it has no route for (#437), and still runs no route.
const NOT_READS = ['/api/secrets/keys', '/api/no-such-read'];
const WRITES = [
  ['POST', '/api/display-config'],
  ['POST', '/api/todos'],
  ['POST', '/api/services/config'],
  ['POST', '/api/integrations/test'],
  ['POST', '/api/cron/report'],
  ['PUT', '/api/secrets/demo'],
  ['DELETE', '/api/cron/jobs/apps/db-dump'],
];
const ICON = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/grafana.svg';

// What each subsystem a live boot starts (index.js startSubsystems) logs as it
// starts. The control logs every one; the demo, none.
const SUBSYSTEM_LINES = {
  secrets: /^DASH_SECRET not set|^Loaded encrypted secrets/,
  discovery: /^Prometheus URL$/,
  kuma: /^Uptime Kuma URL$/,
  'icon cache': /^icons cached locally$/,
  push: /^push (disabled|enabled)/,
  'icon index': /icon index/,
  'services.yaml': /^first boot|^No services\.yaml|^Loaded services\.yaml/,
  'refresh loop': /^background loop started$/,
  arcane: /^Arcane integration|^ARCANE_URL/,
};

/**
 * Boot the server under the spies, run `drive(baseUrl)` against it, wait a
 * moment for anything deferred, stop it. Returns what the spies recorded,
 * its output and its (never created, in demo mode) data dir.
 */
async function bootUnderSpies(name, extraEnv, drive = async () => {}) {
  const dir = mkdtempSync(join(root, `${name}-`));
  const dataDir = join(dir, 'data'); // not made: making it is a write
  const spyLog = join(dir, 'spy.log');
  writeFileSync(spyLog, '');
  const env = {
    ...process.env,
    ...extraEnv,
    JAGHELM_DATA_DIR: dataDir,
    JAGHELM_HOST: '127.0.0.1',
    PORT: '0',
    LOG_LEVEL: 'info',
    SPY_LOG: spyLog,
    // Every source it could reach out to is set, so a loop that starts would try.
    PROMETHEUS_URL: 'http://127.0.0.1:1',
    KUMA_URL: 'http://127.0.0.1:1',
    JAGHELM_GITEA_URL: 'http://127.0.0.1:1',
    ARCANE_URL: 'http://127.0.0.1:1',
    ARCANE_API_KEY: 'demo-boot-test',
  };
  delete env.DASH_PASS;
  delete env.DASH_SECRET; // so the secrets store logs its start the same way everywhere
  delete env.NODE_TEST_CONTEXT; // the child is a server, not a test file
  const child = spawn(process.execPath, ['--import', pathToFileURL(preload).href, serverEntry], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => {
    out += d;
  });
  child.stderr.on('data', (d) => {
    out += d;
  });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  let timer;
  let deadline;
  try {
    const port = await Promise.race([
      new Promise((resolve) => {
        const check = () => {
          const line = out.split('\n').find((l) => l.includes('"msg":"listening"'));
          if (line) resolve(JSON.parse(line).port);
          else timer = setTimeout(check, 50);
        };
        check();
      }),
      exited.then(() => null),
      // A hung boot must not be left running (auth off): give up and kill it.
      new Promise((resolve) => {
        deadline = setTimeout(() => resolve(null), 30000);
      }),
    ]);
    assert.ok(port, `server exited, or did not listen within 30 s:\n${out}`);
    await drive(`http://127.0.0.1:${port}`);
    // The refresh loop and the pollers start at boot; give anything deferred a
    // moment (a day and more of it, with SPY_FAST_TIMERS).
    await new Promise((resolve) => setTimeout(resolve, 1000));
  } finally {
    clearTimeout(timer);
    clearTimeout(deadline);
    child.kill('SIGKILL');
    await exited;
  }
  const records = readFileSync(spyLog, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const logged = out
    .split('\n')
    .filter((l) => l.startsWith('{'))
    .map((l) => JSON.parse(l));
  return { records, out, logged, dataDir };
}

/** The subsystems whose start line is in `logged`. */
const started = (logged) =>
  Object.keys(SUBSYSTEM_LINES).filter((name) =>
    logged.some((l) => SUBSYSTEM_LINES[name].test(l.msg))
  );

const of = (records, ...kinds) =>
  records.filter((r) => kinds.includes(r.kind)).map((r) => `${r.kind} ${r.detail}`);

test('demo: boot and every client read make no outbound request and write no file (#248)', async () => {
  const answers = {};
  const { records, out, logged, dataDir } = await bootUnderSpies(
    'demo',
    { DEMO_MODE: 'true', SPY_FAST_TIMERS: '1' },
    async (base) => {
      for (const path of [...READS, ...NOT_READS]) {
        const r = await fetch(base + path);
        answers[path] = r.status;
        await r.arrayBuffer();
      }
      for (const [method, path] of WRITES) {
        const r = await fetch(base + path, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        answers[`${method} ${path}`] = r.status;
        await r.arrayBuffer();
      }
      const icon = await fetch(`${base}/api/icons/cached?url=${encodeURIComponent(ICON)}`, {
        redirect: 'manual',
      });
      answers.icon = [icon.status, icon.headers.get('location')];
    }
  );

  assert.deepEqual(of(records, 'clock'), ['clock a day of timers ran'], 'the timers ran fast');
  assert.deepEqual(of(records, 'connect', 'dns', 'fetch'), [], 'no outbound request');
  assert.deepEqual(of(records, 'write'), [], 'no file written');
  assert.equal(existsSync(dataDir), false, 'the data dir is never made');

  for (const path of READS) assert.equal(answers[path], 200, `GET ${path}`);
  for (const path of NOT_READS) assert.equal(answers[path], 404, `GET ${path}`);
  for (const [method, path] of WRITES)
    assert.equal(answers[`${method} ${path}`], 403, `${method} ${path}`);
  // The browser fetches the icon from the CDN itself; the server only points it there.
  assert.deepEqual(answers.icon, [302, ICON]);

  assert.deepEqual(started(logged), [], 'no subsystem started');
  assert.ok(
    logged.some(
      (l) => l.module === 'demo' && /DEMO_MODE is ON/.test(l.msg) && l.scenario === 'incident'
    ),
    out
  );
  assert.deepEqual(logged.find((l) => l.msg === 'active nodes')?.nodes, [
    'edge',
    'apps',
    'storage',
  ]);
  assert.ok(
    !logged.some((l) => /NO PASSWORD SET/.test(l.msg)),
    'no unauthenticated warning: the demo is open by design'
  );
});

test('control: a normal boot under the same spies reaches out, writes and starts every subsystem, so the checks catch each', async () => {
  const { records, logged, dataDir } = await bootUnderSpies('normal', {});
  assert.deepEqual(
    started(logged),
    Object.keys(SUBSYSTEM_LINES),
    'every subsystem logged its start'
  );
  assert.ok(of(records, 'connect', 'dns', 'fetch').length > 0, 'discovery asked Prometheus');
  assert.ok(of(records, 'write').length > 0, 'the write spy sees the writes it makes');
  // Prometheus doesn't answer, so the first boot found no node and saves no
  // services.yaml (#566): it asks again each refresh.
  assert.ok(
    !of(records, 'write').some((w) => w.includes('services.yaml')),
    `no services.yaml written: ${of(records, 'write').join(', ')}`
  );
  assert.ok(
    logged.some((l) => /^first boot: node discovery could not reach Prometheus/.test(l.msg)),
    'the first boot says it waits'
  );
  assert.ok(existsSync(dataDir), 'the data dir is made');
});
