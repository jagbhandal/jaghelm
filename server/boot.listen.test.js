/**
 * #261: a JAGHELM_HOST the server can't listen on stops it with an error, instead
 * of leaving it running with nothing listening (the uncaughtException handler
 * would otherwise keep the process alive). 203.0.113.1 is TEST-NET-3, an address
 * no machine has, so listen() fails with EADDRNOTAVAIL and nothing is bound.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverEntry = fileURLToPath(new URL('./index.js', import.meta.url));
const dataDir = mkdtempSync(join(tmpdir(), 'jh-boot-listen-'));
after(() => rmSync(dataDir, { recursive: true, force: true }));

test('a JAGHELM_HOST that cannot be listened on exits 1 with "cannot listen"', async () => {
  const env = {
    ...process.env,
    JAGHELM_DATA_DIR: dataDir, JAGHELM_HOST: '203.0.113.1', PORT: '0', LOG_LEVEL: 'info',
    PROMETHEUS_URL: 'http://127.0.0.1:1', KUMA_URL: 'http://127.0.0.1:1',
  };
  delete env.NODE_TEST_CONTEXT; // the child is a server, not a test file
  const child = spawn(process.execPath, [serverEntry], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  let deadline;
  const code = await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => { deadline = setTimeout(() => resolve('timeout'), 30000); }),
  ]);
  clearTimeout(deadline);
  if (code === 'timeout') child.kill('SIGKILL');
  assert.equal(code, 1, `expected exit 1, got ${code}:\n${out}`);
  const line = out.split('\n').find((l) => l.includes('"msg":"cannot listen"'));
  assert.ok(line, out);
  assert.equal(JSON.parse(line).host, '203.0.113.1');
});
