// No author-specific defaults in the shipped web and Android code (#272): a
// fresh install must not show the author's dashboard name, UPS model or node
// names. Tests and fixtures may name them (they test the migration of old
// layouts, for example); the code they test may not fall back to them.
//
// The server files whose strings reach a stranger's screen are scanned too
// (#248): the services.yaml a first boot generates, and the public demo, which
// also names no host, network, account or node label of the author's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['src', 'mobile/src'];
const EXTS = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.json', '.html', '.css'];

// The demo's fixtures and the first-boot config ship in the server image.
const DEMO_FILES = ['server/demo.js', 'server/demoFixtures.js'];
const SERVER_FILES = [...DEMO_FILES, 'server/config.js'];

const AUTHOR_STRINGS = [
  'JAG-NET',
  'APC Back-UPS ES 600M1',
  '(Gateway, Production, Staging)',
  'Gateway Primary',
  'Gateway Secondary',
  'VM 103',
  'VM 101',
  // The owner's weather place, once the placeholders of Settings → Appearance (#322).
  'Grove City',
  '-83.09',
];

// What the demo must not name: the author's account, network, node labels and
// node names. Generic words are matched whole, so "gateway" in a sentence
// about a reverse proxy would still be caught, but "pi10" is not "pi1".
const DEMO_PATTERNS = [
  /jagbhandal/i,
  /192\.168\./,
  /\b(pi[12]|vm-?10[13])\b/i,
  /\b(Gateway|Production|Staging)\b/,
];

const isTest = (rel) => /\.test\.[cm]?[jt]sx?$/.test(rel);
const isFixture = (rel) => rel.split('/').some((part) => /^(__)?fixtures?(__)?$/.test(part));

/** Repo-relative source files under `dir`, tests and fixtures left out. */
function sources(dir) {
  const out = [];
  for (const e of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || isFixture(rel)) continue;
      out.push(...sources(rel));
    } else if (EXTS.includes(path.extname(e.name)) && !isTest(rel) && !isFixture(rel)) {
      out.push(rel);
    }
  }
  return out;
}

/** `file:line: match` for every line of `files` that `matches`. */
function scan(files, matches) {
  const hits = [];
  for (const rel of files) {
    const lines = readFileSync(path.join(ROOT, rel), 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const m of matches(line)) hits.push(`${rel}:${i + 1}: ${m}`);
    });
  }
  return hits;
}

test('the scan covers the web and Android sources, and the server files a stranger sees', () => {
  const files = DIRS.flatMap(sources);
  assert.ok(files.includes('src/components/CommandPalette.jsx'), 'src/ is scanned');
  assert.ok(files.includes('mobile/src/MobileApp.jsx'), 'mobile/src/ is scanned');
  assert.ok(!files.some(isTest), 'tests are left out');
  for (const rel of SERVER_FILES)
    assert.ok(readFileSync(path.join(ROOT, rel), 'utf8').length > 0, `${rel} exists`);
});

test('no web, Android or stranger-facing server source falls back to an author-specific string', () => {
  const hits = scan([...DIRS.flatMap(sources), ...SERVER_FILES], (line) =>
    AUTHOR_STRINGS.filter((s) => line.includes(s))
  );
  assert.deepEqual(hits, []);
});

test("the demo names no host, network, account or node of the author's (#248)", () => {
  const hits = scan(DEMO_FILES, (line) =>
    DEMO_PATTERNS.map((re) => line.match(re)?.[0]).filter(Boolean)
  );
  assert.deepEqual(hits, []);
});

test("the config a fresh install starts from names nothing of the author's (#322)", async () => {
  const { defaultConfig } = await import('../src/defaultConfig.js');
  const { generateDefaultConfig } = await import('../server/config.js');
  const cfg = defaultConfig();
  // No place, no tabs, no links: a stranger's board starts empty.
  assert.equal(cfg.weatherLat, '');
  assert.equal(cfg.weatherLon ?? '', '');
  assert.equal(cfg.weatherCity, '');
  assert.equal(cfg.showWeather, false);
  assert.deepEqual(cfg.tabs, []);
  assert.deepEqual(cfg.links, {});
  assert.deepEqual(cfg.sections, {});
  // Celsius and the browser's locale, not an author's choice (#494, #260).
  assert.equal(cfg.units, 'metric');
  assert.equal(cfg.locale, '');
  // The services.yaml a first boot writes has the discovered nodes and nothing else.
  assert.deepEqual(generateDefaultConfig([]), { nodes: {}, services: {}, integrations: {} });
  const found = generateDefaultConfig(['edge-1']);
  assert.deepEqual(Object.keys(found.nodes), ['edge-1']);
  assert.equal(found.nodes['edge-1'].display_name, 'edge-1');
  assert.deepEqual(found.services, {});
});
