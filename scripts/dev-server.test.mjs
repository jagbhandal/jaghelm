// #704: `npm run dev:server` really boots the server (index.js only boots as
// the entry script) and gives it a Prometheus URL when .env has none.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./dev-server.mjs', import.meta.url));

test('dev-server.mjs boots the server and listens, with a dev Prometheus URL', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jaghelm-devserver-'));
  const env = { ...process.env, PORT: '0', JAGHELM_DATA_DIR: dir, DASH_SECRET: 'a'.repeat(64) };
  delete env.PROMETHEUS_URL;
  const child = spawn(process.execPath, [SCRIPT], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no "listening" line: ${out}`)), 20_000);
      child.on('exit', () => reject(new Error(`exited early: ${out}`)));
      child.stdout.on('data', (d) => {
        out += d;
        if (out.includes('"msg":"listening"')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    assert.match(out, /"promUrl":"http:\/\/localhost:9090"/);
  } finally {
    child.removeAllListeners('exit');
    child.kill('SIGTERM');
    await new Promise((r) => (child.exitCode === null ? child.once('exit', r) : r()));
    rmSync(dir, { recursive: true, force: true });
  }
});
