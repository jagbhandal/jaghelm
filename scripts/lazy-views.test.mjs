// Guards the one list of lazily loaded views (src/lazyViews.js, #490). The
// client tests load every export there before a file's tests run
// (src/testing/setup.js), so a test that opens a lazy view never races its
// first import. A lazy view whose loader lives anywhere else would race again,
// so every React.lazy() in src/ takes an exported loader from lazyViews.js, and
// no other file in src/ has a dynamic import(). Tests are left out: they may
// build lazy views of their own (src/chunkReload.test.jsx does).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const LIST = 'src/lazyViews.js';

/** The app's source files under src/: no tests, no test helpers. */
function appSources(dir = 'src') {
  const out = [];
  for (const e of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (rel !== 'src/testing') out.push(...appSources(rel));
    } else if (/\.(js|jsx|mjs)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(rel);
  }
  return out;
}

/** Every call in `file`: what is called (`callee`), its `args`, and the call `node`. */
function calls(file) {
  const source = ts.createSourceFile(
    file,
    read(file),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JSX
  );
  const out = [];
  const visit = (node) => {
    if (ts.isCallExpression(node))
      out.push({ callee: node.expression, args: node.arguments, node });
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

const isImport = (c) => c.callee.kind === ts.SyntaxKind.ImportKeyword;
const isLazy = (c) =>
  (ts.isIdentifier(c.callee) && c.callee.text === 'lazy') ||
  (ts.isPropertyAccessExpression(c.callee) && c.callee.name.text === 'lazy');

/** The names lazyViews.js exports, each a loader whose body is one import(). */
function exportedLoaders() {
  const names = new Set();
  for (const c of calls(LIST).filter(isImport)) {
    let node = c.node;
    while (node && !ts.isVariableStatement(node)) node = node.parent;
    const exported = node?.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    assert.ok(
      exported,
      `${LIST}: every import() is an exported loader, or the tests won't load it`
    );
    for (const d of node.declarationList.declarations) names.add(d.name.getText());
  }
  return names;
}

test('lazyViews.js exports a loader for each lazy view, and only loaders', () => {
  const names = exportedLoaders();
  assert.ok(names.size >= 4, `expected the four lazy views at least, found ${[...names]}`);
  // One import() per loader and no other call, so loading every export is safe.
  assert.equal(calls(LIST).length, names.size);
});

test('no file in src/ but lazyViews.js has a dynamic import()', () => {
  const stray = [];
  for (const file of appSources()) {
    if (file === LIST) continue;
    for (const c of calls(file).filter(isImport)) stray.push(`${file}: ${c.node.getText()}`);
  }
  assert.deepEqual(stray, [], `put each loader in ${LIST}, and lazy() it from there`);
});

test('every lazy() in src/ takes a loader exported by lazyViews.js', () => {
  const loaders = exportedLoaders();
  const found = [];
  const bad = [];
  for (const file of appSources()) {
    for (const c of calls(file).filter(isLazy)) {
      const arg = c.args[0];
      found.push(`${file}: ${c.node.getText()}`);
      if (c.args.length !== 1 || !ts.isIdentifier(arg) || !loaders.has(arg.text))
        bad.push(`${file}: ${c.node.getText()}`);
    }
  }
  assert.ok(found.length >= 4, `expected the app's lazy views, found ${found}`);
  assert.deepEqual(bad, []);
});

test('the client test setup loads every loader in lazyViews.js', () => {
  assert.match(read('vite.config.js'), /setupFiles: \['\.\/src\/testing\/setup\.js'\]/);
  const setup = read('src/testing/setup.js');
  assert.match(setup, /vi\.mock\('\.\.\/lazyViews\.js', async \(importOriginal\) => \{/);
  assert.match(setup, /const loaders = Object\.entries\(await importOriginal\(\)\);/);
  assert.match(
    setup,
    /lazyViewsLoaded = Promise\.all\(\s*loaders\.map\(async \(\[name, load\]\) => loadedViews\.set\(name, await load\(\)\)\)/
  );
  assert.match(setup, /beforeAll\(\(\) => lazyViewsLoaded\)/);
});
