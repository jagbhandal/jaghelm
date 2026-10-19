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
const { saveConfig, getConfig, loadConfig, generateDefaultConfig } = await import('./config.js');
const { validateConfig, servicesConfigSchema } = await import('./util/configSchema.js');

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

// ── Removed blocks (#265) ──
// `display` and `custom_integrations` were written into every generated
// services.yaml but never read by anything. A file that still carries them must
// keep loading and saving; the server only says, once, that they can be deleted.

const servicesYaml = join(dir, 'services.yaml');

/** Collect the config module's warn lines written to stderr while `fn` runs. */
function captureConfigWarnings(t, fn) {
  const lines = [];
  t.mock.method(process.stderr, 'write', (chunk) => {
    for (const line of String(chunk).split('\n')) {
      if (line.includes('"level":"warn"') && line.includes('"module":"config"')) lines.push(line);
    }
    return true;
  });
  try {
    fn();
  } finally {
    t.mock.restoreAll();
  }
  return lines;
}

test('generateDefaultConfig omits the unused display and custom_integrations blocks', () => {
  const cfg = generateDefaultConfig(['pi1', 'other']);
  assert.equal('display' in cfg, false, 'no display block');
  assert.equal('custom_integrations' in cfg, false, 'no custom_integrations block');
  assert.deepEqual(Object.keys(cfg.nodes), ['pi1', 'other'], 'discovered nodes still generated');
  assert.deepEqual(cfg.integrations, {});
});

test('a services.yaml that still has display and custom_integrations loads, with one warning', (t) => {
  // Negative control: a file without the old blocks logs nothing.
  writeFileSync(servicesYaml, 'nodes:\n  pi1:\n    display_name: Gateway\nservices: {}\n');
  const clean = captureConfigWarnings(t, () => assert.ok(loadConfig()));
  assert.deepEqual(clean, [], 'no warning for a config without the old blocks');

  writeFileSync(
    servicesYaml,
    [
      'nodes:',
      '  pi1:',
      '    display_name: Gateway',
      'services: {}',
      'integrations: {}',
      'custom_integrations: {}',
      'display:',
      '  title: JAGHELM',
      '  theme: dark',
      '  refresh_interval: 30',
      '',
    ].join('\n')
  );
  let loaded;
  const warnings = captureConfigWarnings(t, () => {
    loaded = loadConfig();
    // A second load (what the file watcher does after an external edit) stays quiet.
    loadConfig();
  });

  assert.ok(loaded, 'the file loads instead of being rejected');
  assert.equal(loaded.nodes.pi1.display_name, 'Gateway', 'the rest of the config is intact');
  assert.equal(warnings.length, 1, `exactly one warning, got ${warnings.length}`);
  const entry = JSON.parse(warnings[0]);
  assert.deepEqual(entry.keys, ['display', 'custom_integrations']);
  assert.match(entry.msg, /display, custom_integrations/);
  assert.match(entry.msg, /can be deleted/);
  // Ignored, not stripped: the server does not silently drop a user's own content.
  assert.equal(loaded.display.title, 'JAGHELM');
  assert.deepEqual(loaded.custom_integrations, {});
});

test('a config that still has the old blocks passes save validation and saves', () => {
  const cfg = loadConfig();
  assert.ok(cfg.display, 'precondition: the previous test left the old blocks on disk');
  const v = validateConfig(servicesConfigSchema, cfg);
  assert.equal(v.ok, true, v.ok ? '' : v.error);
  assert.equal(saveConfig(v.data), true);
  const onDisk = readFileSync(servicesYaml, 'utf8');
  assert.match(onDisk, /^display:\n {2}title: JAGHELM$/m, 'kept as written');
  assert.match(onDisk, /^custom_integrations: \{\}$/m);
});
