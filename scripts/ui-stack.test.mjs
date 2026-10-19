// Guards how the new UI stack (Tailwind CSS v4 and shadcn/ui in src/ui/, #282)
// sits beside today's CSS without restyling it, and stays importable by the
// Android app. docs/ARCHITECTURE.md, "UI stack", explains the design.
//
// The CSS checks run on what Tailwind compiles from src/ui/tailwind.css (with
// @tailwindcss/node, as the Vite plugin does), parsed with postcss, so they hold
// however the source is written.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';
import postcss from 'postcss';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const LAYERS = ['legacy', 'properties', 'theme', 'base', 'components', 'utilities'];
const ENTRIES = ['src/main.jsx', 'mobile/src/main.jsx'];
const LEGACY_SHEETS = ['src/styles/legacy.css', 'mobile/src/styles/legacy.css'];
const STACK = 'src/ui/tailwind.css';

// Legacy class names that are also Tailwind utilities, with the same effect. Add
// nothing here: when a legacy class becomes a utility, rename the legacy class
// (.text-muted became .muted-text) or pick another role name in tailwind.css.
const SHARED_CLASSES = ['flex-1', 'sr-only'];

// Variables the new UI may read without declaring them under .jh-ui (Tailwind's
// own --tw-* aside, which it registers with @property). None so far: a legacy
// name such as --text-sm or --accent would carry today's value into the new UI.
const UNDECLARED_VARS = new Set();

/** Repo-relative paths under `dir` with one of `exts`. */
function walk(dir, exts) {
  const out = [];
  for (const e of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name !== 'node_modules' && e.name !== 'dist') out.push(...walk(rel, exts));
    } else if (exts.some((x) => e.name.endsWith(x))) out.push(rel);
  }
  return out;
}

/** Tailwind's compiler for the stack's stylesheet (`css`, default the real one). */
function compileStack(css = read(STACK)) {
  return compile(css, { base: path.join(ROOT, 'src/ui'), onDependency() {} });
}

/** The compiled stylesheet with the classes the build finds in src/ui/, plus `extra`. */
async function buildStack(css, extra = []) {
  const compiler = await compileStack(css);
  return compiler.build([...new Scanner({ sources: compiler.sources }).scan(), ...extra]);
}

/** The selector of the rule a node sits in, for messages. */
function ruleOf(node) {
  let p = node.parent;
  while (p && p.type !== 'rule') p = p.parent;
  return p ? p.selector.replace(/\s+/g, ' ') : 'the top level';
}

/** How compiled stack CSS could reach today's screens; empty when it can't. */
function reachProblems(css) {
  const problems = [];
  const tree = postcss.parse(css);
  // Nothing unlayered (it would outrank every layer), and only the declared layers.
  for (const node of tree.nodes) {
    if (
      node.type === 'comment' ||
      (node.type === 'atrule' && /^(property|keyframes)$/.test(node.name))
    )
      continue;
    if (node.type !== 'atrule' || node.name !== 'layer') {
      problems.push(`unlayered: ${node.toString().split('{')[0].trim()}`);
      continue;
    }
    for (const name of node.params.split(',').map((s) => s.trim())) {
      if (!LAYERS.includes(name)) problems.push(`unknown layer: ${name}`);
    }
  }
  // No :root, :host, html or body rule: Tailwind writes theme variables there, in a
  // layer above legacy, over today's --text-*, --font-mono, --accent, --border...
  tree.walkRules((rule) => {
    if (/(^|[\s,>+~(])(:root|:host|html|body)(?![\w-])/.test(rule.selector))
      problems.push(`root selector: ${rule.selector.replace(/\s+/g, ' ')}`);
  });
  // The base layer (preflight, shadcn's base rules) applies inside .jh-ui only.
  tree.walkAtRules('layer', (layer) => {
    if (layer.params !== 'base' || !layer.nodes) return;
    for (const n of layer.nodes) {
      if (
        n.type === 'comment' ||
        (n.type === 'atrule' && n.name === 'scope' && n.params === '(.jh-ui)')
      )
        continue;
      problems.push(`unscoped base rule: ${n.toString().split('{')[0].trim()}`);
    }
  });
  // Every variable read with var() is declared under .jh-ui. Otherwise it is
  // undefined, or worse, inherits today's value of the same name from :root.
  const declared = new Set();
  tree.walkRules('.jh-ui', (rule) => rule.walkDecls(/^--/, (d) => declared.add(d.prop)));
  tree.walkDecls((decl) => {
    for (const [, name] of decl.value.matchAll(/var\(\s*(--[\w-]+)/g)) {
      if (name.startsWith('--tw-') || declared.has(name) || UNDECLARED_VARS.has(name)) continue;
      problems.push(`${name} is read by ${ruleOf(decl)} but not declared under .jh-ui`);
    }
  });
  return [...new Set(problems)];
}

/** The stack's stylesheet as it was before the #382 review: theme variables on :root. */
function withoutReference(css) {
  for (const s of ['theme(inline reference)', '@theme inline reference {']) {
    assert.ok(css.includes(s), `expected ${s} in ${STACK}`);
  }
  return css
    .replace('theme(inline reference)', 'theme(inline)')
    .replace('@theme inline reference {', '@theme inline {');
}

/** Class names today's screens use: legacy selectors, and class props outside src/ui/. */
function legacyClassNames() {
  const names = new Set();
  const legacy = (f) => !f.startsWith('src/ui/') && !/\.test\.[jt]sx?$/.test(f);
  const sheets = [...walk('src', ['.css']), ...walk('mobile/src', ['.css'])].filter(legacy);
  for (const f of sheets) {
    postcss.parse(read(f)).walkRules((rule) => {
      for (const [, name] of rule.selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) names.add(name);
    });
  }
  // Every string in a className (or fooClassName) prop. A piece ending in '-' is the
  // stem of a name built at runtime, such as `issue-row--${severity}`.
  const modules = [...walk('src', ['.js', '.jsx']), ...walk('mobile/src', ['.js', '.jsx'])];
  for (const f of modules.filter(legacy)) {
    const file = ts.createSourceFile(f, read(f), ts.ScriptTarget.Latest, false, ts.ScriptKind.JSX);
    const visit = (node, inClassProp) => {
      if (ts.isJsxAttribute(node)) inClassProp = /className$/i.test(node.name.text ?? '');
      if (inClassProp && (ts.isStringLiteral(node) || ts.isTemplateLiteralToken(node))) {
        for (const name of node.text.split(/\s+/)) {
          if (/^-?[_a-zA-Z][\w-]*$/.test(name) && !name.endsWith('-')) names.add(name);
        }
      }
      ts.forEachChild(node, (child) => visit(child, inClassProp));
    };
    visit(file, false);
  }
  return names;
}

test('each app loads its legacy stylesheets first, then the new UI stack', () => {
  for (const entry of ENTRIES) {
    const src = read(entry);
    const legacy = src.indexOf("import './styles/legacy.css';");
    const ui = src.indexOf("import '@ui/tailwind.css';");
    assert.ok(legacy >= 0, `${entry} must import ./styles/legacy.css`);
    assert.ok(ui > legacy, `${entry} must import @ui/tailwind.css after ./styles/legacy.css`);
  }
});

test('no other module imports a stylesheet, which would be unlayered and outrank both', () => {
  const allowed = new Set([...ENTRIES, 'mobile/visual/mount.jsx']);
  const modules = [...walk('src', ['.js', '.jsx']), ...walk('mobile/src', ['.js', '.jsx'])];
  for (const f of modules) {
    if (allowed.has(f)) continue;
    // Side-effect, default and dynamic imports, with or without a ?query such as ?inline.
    assert.doesNotMatch(
      read(f),
      /\bimport\b[^;]*?['"][^'"]+\.css(\?[^'"]*)?['"]/,
      `${f} imports a stylesheet: import it into the legacy layer in styles/legacy.css instead`
    );
  }
});

test('every legacy stylesheet is imported into the legacy layer', () => {
  const layered = new Set();
  for (const sheet of LEGACY_SHEETS) {
    for (const [, spec] of read(sheet).matchAll(/@import\s+'([^']+)'\s+layer\(legacy\);/g)) {
      const rel = spec.startsWith('@shared/')
        ? `src/${spec.slice('@shared/'.length)}`
        : path.posix.join(path.posix.dirname(sheet), spec);
      layered.add(rel);
    }
  }
  const sheets = [...walk('src', ['.css']), ...walk('mobile/src', ['.css'])].filter(
    (f) => !f.startsWith('src/ui/') && !LEGACY_SHEETS.includes(f)
  );
  assert.ok(sheets.length > 0);
  for (const f of sheets) {
    assert.ok(layered.has(f), `${f} is not imported into the legacy layer by a styles/legacy.css`);
  }
});

test('the stylesheets open with the same cascade layer order, legacy lowest', () => {
  for (const f of [...LEGACY_SHEETS, STACK]) {
    const first = postcss.parse(read(f)).nodes.find((n) => n.type !== 'comment');
    assert.ok(
      first?.type === 'atrule' && first.name === 'layer' && !first.nodes,
      `${f} must open with @layer ${LAYERS.join(', ')};`
    );
    assert.deepEqual(
      first.params.split(',').map((s) => s.trim()),
      LAYERS,
      f
    );
  }
});

test('only src/ui/ is scanned for class names, tests excluded', async () => {
  const compiler = await compileStack();
  assert.equal(compiler.root, 'none', 'utilities.css must be imported with source(none)');
  for (const s of compiler.sources) assert.equal(s.base, path.join(ROOT, 'src/ui'));
  assert.ok(compiler.sources.some((s) => s.negated && s.pattern.includes('.test.')));
});

test("the compiled stack can't reach today's screens", async () => {
  const css = await buildStack();
  assert.match(css, /\.bg-primary\s*\{/, 'expected the Button utilities in the compiled CSS');
  assert.match(css, /@scope \(\.jh-ui\)\s*\{\s*:scope,\s*\*,/, 'expected the scoped preflight');
  assert.deepEqual(reachProblems(css), []);
});

test("the reach check catches the #382 review's reproductions", async (t) => {
  await t.test('a class reading a variable that legacy CSS also defines', async () => {
    const css = await buildStack(read(STACK), [
      'text-[length:var(--text-sm)]',
      'font-[family-name:var(--font-mono)]',
    ]);
    const problems = reachProblems(css);
    assert.ok(
      problems.some((p) => p.startsWith('--text-sm is read')),
      problems.join('\n')
    );
    assert.ok(
      problems.some((p) => p.startsWith('--font-mono is read')),
      problems.join('\n')
    );
  });

  await t.test('a theme variable built from another one', async () => {
    const src = read(STACK).replace(
      '@theme inline reference {',
      '@theme inline reference {\n  --radius-card: var(--radius-lg);'
    );
    const css = await buildStack(src, ['rounded-card', 'rounded-[var(--radius-card)]']);
    const problems = reachProblems(css);
    assert.ok(
      problems.some((p) => p.startsWith('--radius-card is read')),
      problems.join('\n')
    );
  });

  await t.test('without `reference`, Tailwind writes the theme onto :root', async () => {
    const css = await buildStack(withoutReference(read(STACK)), [
      'text-[length:var(--text-sm)]',
      'rounded-[var(--radius-lg)]',
    ]);
    const problems = reachProblems(css);
    assert.ok(
      problems.some((p) => p.startsWith('root selector: :root')),
      problems.join('\n')
    );
  });
});

test('the radius scale under .jh-ui matches the rounded-* utilities', async () => {
  const compiler = await compileStack();
  const scale = new Map();
  postcss
    .parse(compiler.build([]))
    .walkRules('.jh-ui', (rule) => rule.walkDecls(/^--radius-/, (d) => scale.set(d.prop, d.value)));
  assert.ok(scale.has('--radius-md'), 'the Button reads --radius-md');
  const utilities = new Map();
  const classes = [...scale.keys()].map((v) => `rounded-${v.slice('--radius-'.length)}`);
  postcss.parse(compiler.build(classes)).walkRules((rule) => {
    const cls = rule.selector.slice(1);
    if (classes.includes(cls)) rule.walkDecls('border-radius', (d) => utilities.set(cls, d.value));
  });
  for (const [name, value] of scale) {
    const cls = `rounded-${name.slice('--radius-'.length)}`;
    assert.equal(utilities.get(cls), value, `${cls} and ${name} must match in ${STACK}`);
  }
});

test("no class today's screens use is also a Tailwind utility, apart from the shared ones", async () => {
  const names = legacyClassNames();
  // The collection works: a class from a stylesheet, and one only markup uses (NavBar).
  assert.ok(names.has('glass-card') && names.has('nav-menu-btn'), 'legacy class names not found');
  const compiler = await compileStack();
  let size = compiler.build([]).length;
  const utilities = [];
  for (const name of [...names].sort()) {
    const out = compiler.build([name]); // build() is cumulative: growth means a new utility
    if (out.length !== size) utilities.push(name);
    size = out.length;
  }
  assert.deepEqual(
    utilities.filter((n) => !SHARED_CLASSES.includes(n)),
    [],
    'these legacy classes are also utilities under src/ui/tailwind.css: once src/ui/ uses one, ' +
      "its utility outranks the legacy rule on today's screens. Rename the legacy class or the role."
  );
  assert.deepEqual(utilities, SHARED_CLASSES, 'drop the names that no longer collide');
});

test('src/ui imports only packages the Android app installs and dedupes', () => {
  const mobilePkg = JSON.parse(read('mobile/package.json'));
  const rootPkg = JSON.parse(read('package.json'));
  const config = read('mobile/vite.config.mobile.js');
  const dedupe = [...config.match(/dedupe:\s*\[([\s\S]*?)\]/)[1].matchAll(/'([^']+)'/g)].map(
    (m) => m[1]
  );
  // The JSX runtime and the stylesheet's own import.
  const needed = new Map([
    ['react', 'the JSX runtime'],
    ['react-dom', 'the JSX runtime'],
    ['tailwindcss', 'src/ui/tailwind.css'],
  ]);
  for (const f of walk('src/ui', ['.js', '.jsx'])) {
    if (/\.test\.jsx?$/.test(f)) continue;
    for (const [, spec] of read(f).matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)) {
      if (spec.startsWith('.') || spec === '@ui' || spec.startsWith('@ui/')) continue;
      const parts = spec.split('/');
      needed.set(spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0], f);
    }
  }
  for (const [pkg, from] of needed) {
    const where = `${pkg} (needed by ${from})`;
    assert.ok(
      mobilePkg.dependencies?.[pkg] || (pkg === 'tailwindcss' && mobilePkg.devDependencies?.[pkg]),
      `${where} must be in mobile/package.json: the APK build installs mobile/ only`
    );
    assert.ok(
      rootPkg.devDependencies?.[pkg] || rootPkg.dependencies?.[pkg],
      `${where} must be in package.json`
    );
    assert.ok(
      dedupe.includes(pkg),
      `${where} must be in resolve.dedupe in mobile/vite.config.mobile.js`
    );
  }
});
