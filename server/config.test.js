/**
 * Config persistence coordination — the immutability contract (copy-on-read /
 * defensive-copy-on-write so routes can't corrupt shared in-memory state) and a
 * crash-safety chaos test proving an atomic write is never observed torn, even
 * when the writer is SIGKILL'd mid-write.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const dir = mkdtempSync(join(tmpdir(), 'jh-config-'));
process.env.JAGHELM_DATA_DIR = dir;
const { saveConfig, getConfig, loadConfig } = await import('./config.js');

after(() => rmSync(dir, { recursive: true, force: true }));

test('getConfig returns an independent deep copy — caller mutation does not leak', () => {
  assert.equal(saveConfig({ nodes: { a: { name: 'A' } }, services: {} }), true);
  const c1 = getConfig();
  c1.nodes.a.name = 'HACKED';
  c1.nodes.b = { injected: true };
  const c2 = getConfig();
  assert.equal(c2.nodes.a.name, 'A', 'stored node untouched by caller mutation');
  assert.equal(c2.nodes.b, undefined, 'injected key did not persist into shared state');
  assert.notEqual(c1, c2, 'each getConfig() returns a fresh object');
});

test('saveConfig stores a defensive copy — post-save caller mutation does not leak', () => {
  const draft = { nodes: { x: { name: 'X' } }, services: {} };
  saveConfig(draft);
  draft.nodes.x.name = 'MUTATED-AFTER-SAVE';
  assert.equal(getConfig().nodes.x.name, 'X');
});

test('saveConfig persists to disk; loadConfig round-trips', () => {
  saveConfig({ nodes: { n: { name: 'N' } }, services: {}, grid_columns: 12 });
  const reloaded = loadConfig();
  assert.equal(reloaded.nodes.n.name, 'N');
  assert.equal(reloaded.grid_columns, 12);
});

test('saveConfig refuses a reentrant save (returns false)', () => {
  // A getter on an enumerable field fires while saveConfig is serializing the
  // outer object — the simplest deterministic way to re-enter the function.
  let innerResult = null;
  const evil = { services: {} };
  Object.defineProperty(evil, 'nodes', {
    enumerable: true,
    get() {
      innerResult = saveConfig({ nodes: {}, services: {} });
      return {};
    },
  });
  assert.equal(saveConfig(evil), true, 'outer save succeeds');
  assert.equal(innerResult, false, 'reentrant inner save was refused');
});

test('atomic write survives a mid-write SIGKILL — target file is never torn', async () => {
  const target = join(dir, 'crash-target.txt');
  const awUrl = new URL('./util/atomicWrite.js', import.meta.url).href;
  const LEN = 200_000;
  // Child loops writing fully-valid, versioned 200KB payloads. A complete file
  // is `v<digit>` padded with '.' to exactly LEN, then '\nEND'. A non-atomic
  // writer killed mid-write would leave a truncated file failing this shape.
  const childSrc = `
    import { atomicWriteFileSync } from ${JSON.stringify(awUrl)};
    const target = ${JSON.stringify(target)};
    const LEN = ${LEN};
    let i = 0;
    for (;;) {
      atomicWriteFileSync(target, ('v' + (i++ % 10)).padEnd(LEN, '.') + '\\nEND');
    }
  `;
  const childFile = join(dir, 'crash-child.mjs');
  writeFileSync(childFile, childSrc);
  const child = spawn(process.execPath, [childFile], { stdio: 'ignore' });
  const exited = new Promise((res) => child.once('exit', res));

  // Wait for the first full write to land, then a little longer so the kill is
  // likely to interrupt a write in progress.
  const deadline = Date.now() + 5000;
  while (!existsSync(target) && Date.now() < deadline) await sleep(10);
  await sleep(80);
  child.kill('SIGKILL');
  await exited;

  assert.ok(existsSync(target), 'target exists after the crash');
  const content = readFileSync(target, 'utf8');
  assert.equal(
    content.length,
    LEN + 4,
    `expected a complete ${LEN + 4}-byte file, got ${content.length}`
  );
  assert.match(
    content,
    /^v\d\.+\nEND$/,
    'frozen on a complete versioned payload, not a torn write'
  );
});
