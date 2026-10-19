/**
 * #242: booting the real server (`node server/index.js`) makes no request to
 * api.github.com, in normal and in demo mode. Each boot runs in a child process
 * with a preload that records every global fetch and fails it, so the test needs
 * no network and can't reach GitHub even when the code under test tries.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const serverEntry = fileURLToPath(new URL('./index.js', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'jh-icons-boot-'));
after(() => rmSync(root, { recursive: true, force: true }));

const preload = join(root, 'record-fetch.mjs');
writeFileSync(preload, `
import { appendFileSync } from 'node:fs';
globalThis.fetch = async (input) => {
  appendFileSync(process.env.FETCH_LOG, String(input instanceof Request ? input.url : input) + '\\n');
  throw new TypeError('fetch blocked by icons.boot.test.js');
};
`);

/** Boot the server, wait until it listens and a little after, stop it; returns the fetched URLs. */
async function bootAndRecord(name, extraEnv) {
  const dataDir = mkdtempSync(join(root, `${name}-`));
  const fetchLog = join(dataDir, 'fetches.log');
  writeFileSync(fetchLog, '');
  const env = {
    ...process.env, ...extraEnv,
    JAGHELM_DATA_DIR: dataDir, FETCH_LOG: fetchLog, PORT: '0', LOG_LEVEL: 'info',
    PROMETHEUS_URL: 'http://127.0.0.1:1', KUMA_URL: 'http://127.0.0.1:1',
  };
  delete env.DASH_PASS;
  delete env.NODE_TEST_CONTEXT; // the child is a server, not a test file
  const child = spawn(process.execPath, ['--import', pathToFileURL(preload).href, serverEntry],
    { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  let timer;
  try {
    const listening = await Promise.race([
      new Promise((resolve) => {
        const check = () => {
          if (/"msg":"listening"/.test(out)) resolve(true);
          else timer = setTimeout(check, 50);
        };
        check();
      }),
      exited.then(() => false),
    ]);
    assert.ok(listening, `server exited before it listened:\n${out}`);
    // The old index fetch started before listen; give anything deferred a moment too.
    await new Promise((resolve) => setTimeout(resolve, 1000));
  } finally {
    clearTimeout(timer);
    child.kill('SIGKILL');
    await exited;
  }
  return readFileSync(fetchLog, 'utf8').split('\n').filter(Boolean);
}

for (const [mode, env] of [['normal', {}], ['demo', { DEMO_MODE: 'true' }]]) {
  test(`boot makes no request to api.github.com (${mode} mode)`, async () => {
    const urls = await bootAndRecord(mode, env);
    const github = urls.filter((u) => new URL(u).hostname === 'api.github.com');
    assert.deepEqual(github, [], `boot requested ${github.join(', ')}`);
  });
}
