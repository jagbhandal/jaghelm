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
import yaml from 'js-yaml';

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
  saveConfig({ nodes: { n: { name: 'N' } }, services: {}, extra: { kept: 12 } });
  const reloaded = loadConfig();
  assert.equal(reloaded.nodes.n.name, 'N');
  assert.deepEqual(reloaded.extra, { kept: 12 }, 'an unknown key round-trips');
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

// ── Unread keys (#265) ──
// Releases before #265 wrote `display`, `custom_integrations`, `links`, `tabs`,
// `grid_layout` and `grid_columns` into every generated services.yaml, but
// nothing ever read them from it. A file that still carries them must keep
// loading and saving; the server only says, once per key, that they can go.

const servicesYaml = join(dir, 'services.yaml');

// The literal DEFAULT_CONFIG before #265, with one discovered node, as
// generateDefaultConfig + saveConfig wrote it on first boot.
const PRE_265_GENERATED = {
  nodes: {
    pi1: {
      prometheus_node: 'pi1',
      display_name: 'Gateway Primary',
      subtitle: 'Raspberry Pi 5',
      icon: '🛡',
      border_color: '#a78bfa',
      visible: true,
      auto_discover: true,
      hide: ['prometheus', 'node-exporter', 'cadvisor'],
    },
  },
  services: {},
  integrations: {},
  custom_integrations: {},
  display: {
    title: 'JAGHELM',
    subtitle: 'Infrastructure Dashboard',
    theme: 'dark',
    accent_color: '#6366f1',
    bg_image: '',
    bg_opacity: 0.3,
    overlay_opacity: 0.75,
    show_dots: true,
    show_search: true,
    search_engine: 'google',
    show_weather: true,
    weather_lat: '39.88',
    weather_lon: '-83.09',
    weather_city: 'Grove City',
    temp_unit: 'F',
    service_detail_level: 'stats',
    refresh_interval: 30,
    show_todos: true,
    show_cron_jobs: true,
  },
  links: {
    personal: [],
    management: [],
    devops: [],
  },
  tabs: [],
  grid_layout: null,
  grid_columns: 12,
};
const UNREAD = ['display', 'custom_integrations', 'links', 'tabs', 'grid_layout', 'grid_columns'];

function writePre265File() {
  const body = yaml.dump(PRE_265_GENERATED, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  });
  writeFileSync(servicesYaml, '# JagHelm Configuration\n\n' + body);
}

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

test('generateDefaultConfig writes only nodes, services and integrations', () => {
  const cfg = generateDefaultConfig(['pi1', 'other']);
  assert.deepEqual(Object.keys(cfg), ['nodes', 'services', 'integrations']);
  assert.deepEqual(Object.keys(cfg.nodes), ['pi1', 'other'], 'discovered nodes still generated');
  assert.deepEqual(cfg.integrations, {});
});

test('a services.yaml generated before #265 loads, with one warning naming the unread keys', (t) => {
  // Negative control: a file without the old keys logs nothing.
  writeFileSync(servicesYaml, 'nodes:\n  pi1:\n    display_name: Gateway\nservices: {}\n');
  const clean = captureConfigWarnings(t, () => assert.ok(loadConfig()));
  assert.deepEqual(clean, [], 'no warning for a config without the old keys');

  writePre265File();
  let loaded;
  const warnings = captureConfigWarnings(t, () => {
    loaded = loadConfig();
    // A second load (what the file watcher does after an external edit) stays quiet.
    loadConfig();
  });

  assert.ok(loaded, 'the file loads instead of being rejected');
  assert.equal(
    loaded.nodes.pi1.display_name,
    'Gateway Primary',
    'the rest of the config is intact'
  );
  assert.equal(warnings.length, 1, `exactly one warning, got ${warnings.length}`);
  const entry = JSON.parse(warnings[0]);
  assert.deepEqual(entry.keys, UNREAD);
  assert.match(entry.msg, new RegExp(UNREAD.join(', ')));
  assert.match(entry.msg, /can be deleted/);
  // Ignored, not stripped: the server does not silently drop a user's own content.
  for (const k of UNREAD) assert.deepEqual(loaded[k], PRE_265_GENERATED[k], `${k} kept as loaded`);
});

test('a services.yaml generated before #265 passes save validation and saves', () => {
  writePre265File();
  const cfg = loadConfig();
  // What Settings → Nodes does: change a node, POST the whole config back.
  cfg.nodes.pi1.display_name = 'Renamed';
  const v = validateConfig(servicesConfigSchema, cfg);
  assert.equal(v.ok, true, v.ok ? '' : v.error);
  assert.equal(saveConfig(v.data), true);
  const reloaded = yaml.load(readFileSync(servicesYaml, 'utf8'));
  assert.equal(reloaded.nodes.pi1.display_name, 'Renamed');
  for (const k of UNREAD) assert.deepEqual(reloaded[k], PRE_265_GENERATED[k], `${k} kept on disk`);
});
