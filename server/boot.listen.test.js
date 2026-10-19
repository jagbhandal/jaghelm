/**
 * #261: when the server can't listen (a port already in use, an address the
 * machine doesn't have), it stops with an error instead of running on with
 * nothing listening (the uncaughtException handler would otherwise keep the
 * process alive). The port in use is one this test holds on 127.0.0.1.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverEntry = fileURLToPath(new URL('./index.js', import.meta.url));
const dataDir = mkdtempSync(join(tmpdir(), 'jh-boot-listen-'));

const blocker = createServer();
await new Promise((resolve, reject) => {
  blocker.once('error', reject);
  blocker.listen(0, '127.0.0.1', resolve);
});
const busyPort = /** @type {import('node:net').AddressInfo} */ (blocker.address()).port;

after(() => {
  blocker.close();
  rmSync(dataDir, { recursive: true, force: true });
});

test('a port already in use exits 1 with "cannot listen"', async () => {
  const env = {
    ...process.env,
    JAGHELM_DATA_DIR: dataDir, JAGHELM_HOST: '127.0.0.1', PORT: String(busyPort), LOG_LEVEL: 'info',
    PROMETHEUS_URL: 'http://127.0.0.1:1', KUMA_URL: 'http://127.0.0.1:1',
  };
  delete env.DASH_PASS;
  delete env.NODE_TEST_CONTEXT; // the child is a server, not a test file
  const child = spawn(process.execPath, [serverEntry], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  let deadline;
  const code = await Promise.race([
    exited,
    new Promise((resolve) => { deadline = setTimeout(() => resolve('still running after 30 s'), 30000); }),
  ]);
  clearTimeout(deadline);
  if (code !== 1) {
    child.kill('SIGKILL');
    await exited;
  }
  assert.equal(code, 1, `expected exit 1, got ${code}:\n${out}`);
  const line = out.split('\n').find((l) => l.includes('"msg":"cannot listen"'));
  assert.ok(line, out);
  const logged = JSON.parse(line);
  assert.equal(logged.host, '127.0.0.1');
  assert.equal(String(logged.port), String(busyPort));
  assert.match(String(logged.err), /EADDRINUSE/);
});
