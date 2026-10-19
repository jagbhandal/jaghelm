// Guards on what reaches the runtime image (#263). The image build itself fails when a
// package manager is on PATH in the runtime stage; these run pre-merge in `npm test`
// so the Dockerfile, .dockerignore and public/ can't drift from that.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const toPosix = (p) => p.split(path.sep).join('/');

/** Dockerfile stages as [{ from, name, lines }], continuation lines joined. */
function stagesOf(source) {
  const joined = source.replace(/\\\r?\n/g, ' ');
  const stages = [];
  for (const raw of joined.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const from = /^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/i.exec(line);
    if (from) stages.push({ from: from[1], name: from[2] ?? null, lines: [] });
    else if (stages.length) stages.at(-1).lines.push(line);
  }
  return stages;
}

/** A .dockerignore pattern as a RegExp over context-relative paths. Docker matches
 *  each pattern against the whole path, and a matched directory takes its contents. */
function patternToRegExp(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      i++;
      if (pattern[i + 1] === '/') {
        i++;
        re += '(?:.*/)?';
      } else re += '.*';
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}(?:/.*)?$`);
}

/** (relPath) => true when .dockerignore leaves the path out of the build context. */
function dockerignored(source) {
  const rules = source
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const negate = l.startsWith('!');
      const pattern = (negate ? l.slice(1) : l).replace(/^\/+/, '').replace(/\/+$/, '');
      return { negate, re: patternToRegExp(pattern) };
    });
  return (rel) => rules.reduce((out, r) => (r.re.test(rel) ? !r.negate : out), false);
}

// Static and literal dynamic imports. Type-only `import('…')` in JSDoc also matches,
// which can only over-report.
const IMPORT_RE =
  /\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

/** Every repo file reachable through relative imports from the entry files. */
function importGraph(entries) {
  const seen = new Set();
  const queue = [...entries];
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const abs = path.join(ROOT, rel);
    if (!existsSync(abs)) continue;
    for (const m of readFileSync(abs, 'utf8').matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (!spec.startsWith('.')) continue; // packages come from node_modules
      queue.push(toPosix(path.relative(ROOT, path.resolve(path.dirname(abs), spec))));
    }
  }
  return [...seen];
}

function walk(dir) {
  const abs = path.join(ROOT, dir);
  return readdirSync(abs).flatMap((e) => {
    const rel = `${dir}/${e}`;
    return statSync(path.join(ROOT, rel)).isDirectory() ? walk(rel) : [rel];
  });
}

const stages = stagesOf(read('Dockerfile'));
const runtime = stages.at(-1);
const isIgnored = dockerignored(read('.dockerignore'));

test('the runtime stage starts from Alpine pinned by digest, not the Node image with npm and yarn', () => {
  assert.match(runtime.from, /^alpine:[\d.]+@sha256:[0-9a-f]{64}$/);
});

test("the runtime image ships Node's LICENSE (MIT plus its bundled notices) with the binary", () => {
  const nodeBin = stages.find((s) => s.name === 'node-bin');
  assert.ok(nodeBin, 'no node-bin stage');
  const run = nodeBin.lines.filter((l) => /^RUN\b/.test(l)).join('\n');
  assert.match(run, /cp -p \/usr\/local\/bin\/node \/node\/bin\/node/);
  assert.match(run, /cp -p \/usr\/local\/LICENSE \/node\/LICENSE/);
  assert.ok(
    runtime.lines.includes('COPY --from=node-bin /node/ /usr/local/'),
    'the runtime stage must copy the node-bin tree (bin/node and LICENSE) into /usr/local/'
  );
});

test('every base image in the Dockerfile is pinned by digest', () => {
  const external = stages.map((s) => s.from).filter((f) => !stages.some((s) => s.name === f));
  for (const from of external) assert.match(from, /@sha256:[0-9a-f]{64}$/, from);
});

test('the runtime image build fails when npm, npx, yarn or corepack is on PATH', () => {
  const run = runtime.lines.filter((l) => /^RUN\b/.test(l)).join('\n');
  assert.match(run, /for tool in npm npx yarn yarnpkg corepack; do/);
  assert.match(run, /if command -v "\$tool"[^;]*;\s*then\b[\s\S]*?exit 1;\s*fi/);
  // Nothing in the runtime stage installs or calls a package manager.
  assert.doesNotMatch(run, /\b(?:npm|npx|yarn|corepack)\s+(?:ci|install|i|add|run|exec|enable)\b/);
  assert.doesNotMatch(run, /apk add[^;&]*\b(?:npm|yarn|nodejs)\b/);
});

test('the Arcane dry-run CLI is left out of the image', () => {
  for (const file of [
    'scripts/arcane-poll-once.js',
    'server/arcane/pollOnce.js',
    'server/arcane/projectFixture.js',
    'server/arcane/vulnDigestOnce.js',
  ]) {
    assert.ok(existsSync(path.join(ROOT, file)), `${file} still exists in the repo`);
    assert.ok(isIgnored(file), `${file} is not in .dockerignore`);
  }
});

test('nothing the server loads is left out of the image', () => {
  // The CMD entry, plus the presets that integrations/registry.js loads by directory.
  const presets = readdirSync(path.join(ROOT, 'server/integrations/presets'))
    .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
    .map((f) => `server/integrations/presets/${f}`);
  assert.match(runtime.lines.find((l) => /^CMD\b/.test(l)) ?? '', /"server\/index\.js"/);
  const loaded = importGraph(['server/index.js', ...presets]);
  assert.ok(loaded.length > 50, `import graph looks wrong (${loaded.length} files)`);
  for (const file of loaded) {
    assert.ok(existsSync(path.join(ROOT, file)), `${file} is imported but missing`);
    assert.ok(!isIgnored(file), `${file} is loaded by the server but .dockerignore leaves it out`);
  }
  assert.ok(!loaded.includes('server/arcane/pollOnce.js'));
});

test('the .dockerignore matcher follows Docker semantics', () => {
  const m = dockerignored('**/*.test.*\nserver/arcane/fixtures\ndocs\n*.log\n!keep.log\n');
  assert.ok(m('server/a/b.test.js'));
  assert.ok(m('x.test.mjs'));
  assert.ok(m('server/arcane/fixtures/live/a.json'));
  assert.ok(m('docs/images/dashboard.jpg'));
  assert.ok(m('debug.log'));
  assert.ok(!m('keep.log'));
  assert.ok(!m('server/logs/debug.log'), 'a pattern without ** matches from the context root only');
  assert.ok(!m('server/arcane/poller.js'));
  assert.ok(!m('documents/x'));
});

test('public/ holds only files the app uses (README screenshots live in docs/images/)', () => {
  const publicFiles = readdirSync(path.join(ROOT, 'public'));
  const sources = [
    'index.html',
    ...publicFiles.map((f) => `public/${f}`),
    ...walk('src').filter((f) => !/\.test\./.test(f)),
    ...walk('server').filter(
      (f) => !/\.test\./.test(f) && !f.startsWith('server/arcane/fixtures/')
    ),
  ].map((rel) => ({ rel, text: read(rel) }));
  for (const file of publicFiles) {
    const users = sources.filter((s) => s.rel !== `public/${file}` && s.text.includes(file));
    assert.ok(users.length > 0, `public/${file} is served but nothing in the app uses it`);
  }
  const readme = read('README.md');
  for (const shot of ['docs/images/dashboard.jpg']) {
    assert.ok(readme.includes(shot), `README no longer shows ${shot}`);
    assert.ok(existsSync(path.join(ROOT, shot)), `${shot} is missing`);
  }
});
