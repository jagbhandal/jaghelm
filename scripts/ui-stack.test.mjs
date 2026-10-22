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
import { readTokens, resolveContext } from './ui-contrast.mjs';
import {
  DURATIONS,
  EASES,
  SHADOWS,
  SPACING,
  TYPE_STEPS,
  Z_INDEX,
  cn,
} from '../src/ui/lib/utils.js';
import { ROOT_SWITCHES, SWITCHES } from '../src/ui/lib/portal.js';

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
// own --tw-* aside, which it registers with @property). A legacy name such as
// --text-sm or --accent would carry today's value into the new UI, so only
// these: Base UI sets them inline on a popup's positioner, the trigger's width
// and the room left on screen (#285). A test below fails if today's CSS ever
// defines one.
const UNDECLARED_VARS = new Set(['--anchor-width', '--available-height']);

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

const isLegacy = (f) => !f.startsWith('src/ui/') && !/\.test\.[jt]sx?$/.test(f);

/** The class names in the selectors of today's stylesheets under `dirs`. */
function legacySelectorNames(dirs = ['src', 'mobile/src']) {
  const names = new Set();
  for (const f of dirs.flatMap((d) => walk(d, ['.css'])).filter(isLegacy)) {
    postcss.parse(read(f)).walkRules((rule) => {
      for (const [, name] of rule.selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) names.add(name);
    });
  }
  return names;
}

/** Class names today's screens use: legacy selectors, and class props outside src/ui/. */
function legacyClassNames() {
  const names = legacySelectorNames();
  // Every string in a className (or fooClassName) prop. A piece ending in '-' is the
  // stem of a name built at runtime, such as `issue-row--${severity}`.
  const modules = [...walk('src', ['.js', '.jsx']), ...walk('mobile/src', ['.js', '.jsx'])];
  for (const f of modules.filter(isLegacy)) {
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

// Functions whose arguments are class names (clsx-style: strings, the branches of
// && || ?:, arrays, and the keys of an object), and cva, whose base and variant
// values are.
const CLASS_FNS = new Set(['cn', 'clsx', 'cx', 'twMerge', 'twJoin']);
// Classes that compile to nothing by design: they name a group or peer for a
// variant (`group-hover:`, `peer-checked:`).
const MARKER = /^(group|peer)(\/[\w-]+)?$/;

/**
 * The class names a component writes: [{ file, name }] for each string in a
 * className prop, in a call to cn() and its kin, and in cva()'s base classes,
 * variants and compound variants (never its variant names or defaults). Parsed,
 * not scanned, so a class named in a comment doesn't count. Pure: takes the
 * source and the file name for messages.
 */
export function classNamesIn(source, file) {
  const out = [];
  const add = (text) => {
    for (const name of text.split(/\s+/)) if (name) out.push({ file, name });
  };
  // The fixed parts of a template literal, less the pieces that touch a ${}.
  const template = (node) => {
    const parts = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)];
    parts.forEach((text, i) => {
      const words = text.split(/(\s+)/);
      if (i > 0 && !/^\s/.test(text)) words.shift();
      if (i < parts.length - 1 && !/\s$/.test(text)) words.pop();
      add(words.join(''));
    });
  };
  // Lookup objects: `const sizes = { sm: '…' }`, read in a class position as
  // sizes[size] or sizes.sm. Their values are classes (nested maps too), their
  // keys never; each map is read once. Any other variable a class position reads
  // by name (`const pad = 'px-3'`, cn(pad)) holds classes in its initializer.
  const maps = new Map();
  const held = new Map();
  const walked = new Set();
  const values = (obj) => {
    for (const p of obj.properties) {
      if (!ts.isPropertyAssignment(p)) continue;
      if (ts.isObjectLiteralExpression(p.initializer)) values(p.initializer);
      else classes(p.initializer);
    }
  };
  const lookup = (node) => {
    let root = node;
    while (ts.isElementAccessExpression(root) || ts.isPropertyAccessExpression(root))
      root = root.expression;
    const map = ts.isIdentifier(root) ? maps.get(root.text) : undefined;
    if (map && !walked.has(map)) {
      walked.add(map);
      values(map);
    }
  };
  const variable = (name) => {
    for (const init of held.get(name) ?? []) {
      if (walked.has(init)) continue;
      walked.add(init);
      classes(init);
    }
  };
  const classes = (node) => {
    if (!node) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node.text);
    else if (ts.isIdentifier(node)) variable(node.text);
    else if (ts.isTemplateExpression(node)) {
      template(node);
      node.templateSpans.forEach((s) => classes(s.expression));
    } else if (ts.isElementAccessExpression(node) || ts.isPropertyAccessExpression(node))
      lookup(node);
    else if (ts.isJsxExpression(node) || ts.isParenthesizedExpression(node))
      classes(node.expression);
    else if (ts.isConditionalExpression(node)) [node.whenTrue, node.whenFalse].forEach(classes);
    else if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if (op !== ts.SyntaxKind.AmpersandAmpersandToken) classes(node.left);
      classes(node.right);
    } else if (ts.isArrayLiteralExpression(node)) node.elements.forEach(classes);
    else if (ts.isObjectLiteralExpression(node)) {
      for (const p of node.properties) {
        if (p.name && (ts.isStringLiteral(p.name) || ts.isIdentifier(p.name))) add(p.name.text);
      }
    }
  };
  const prop = (obj, key) =>
    obj && ts.isObjectLiteralExpression(obj)
      ? obj.properties.find((p) => ts.isPropertyAssignment(p) && p.name.text === key)?.initializer
      : undefined;
  const cva = ([base, config]) => {
    classes(base);
    const variants = prop(config, 'variants');
    for (const group of variants?.properties ?? []) {
      for (const value of group.initializer?.properties ?? []) classes(value.initializer);
    }
    const compound = prop(config, 'compoundVariants');
    for (const entry of compound?.elements ?? []) {
      classes(prop(entry, 'class'));
      classes(prop(entry, 'className'));
    }
  };
  const visit = (node) => {
    if (ts.isJsxAttribute(node) && /className$/i.test(node.name.text ?? '')) {
      classes(node.initializer);
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (node.expression.text === 'cva') cva(node.arguments);
      else if (CLASS_FNS.has(node.expression.text)) node.arguments.forEach(classes);
    }
    ts.forEachChild(node, visit);
  };
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JSX
  );
  const declare = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const name = node.name.text;
      if (ts.isObjectLiteralExpression(node.initializer)) maps.set(name, node.initializer);
      else held.set(name, [...(held.get(name) ?? []), node.initializer]);
    }
    ts.forEachChild(node, declare);
  };
  declare(sourceFile); // first, so a variable declared after its use still counts
  visit(sourceFile);
  return out;
}

/** The names among `names` that compile to no CSS under the stack's theme. */
async function uncompiled(names) {
  const compiler = await compileStack();
  let size = compiler.build([]).length;
  const empty = [];
  for (const name of [...new Set(names)].sort()) {
    const grown = compiler.build([name]).length; // cumulative: growth means CSS
    if (grown === size && !MARKER.test(name)) empty.push(name);
    size = grown;
  }
  return empty;
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
  assert.match(css, /\.bg-accent\s*\{/, 'expected the Button utilities in the compiled CSS');
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
  assert.ok(scale.has('--radius-md'), 'expected the radius scale under .jh-ui');
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
  // The collection works: a class from a stylesheet, and one only markup uses (AppFrames).
  assert.ok(names.has('glass-card') && names.has('app-frames'), 'legacy class names not found');
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

// The status components' `android` look (src/ui/lib/status.js), a stopgap until
// Phase 4 (#326), writes the class names the Android app's own stylesheets
// style, in the legacy layer, so its screens look as before. They compile to
// nothing in the stack by design. A name is let through only in one of the five
// status component files, only as one of the Android blocks they write or an
// element of one (`sys-status-card__word`), and only when MobileApp.css and its
// kin style it or its modifiers. So a misspelt utility fails, and so does an
// Android class name anywhere else (`chip`, `secondary` and `note` are styled
// there too), which on the web would do nothing.
const STATUS_FILES = new Set([
  'src/ui/status-lamp.jsx',
  'src/ui/status-word.jsx',
  'src/ui/issue-row.jsx',
  'src/ui/subsystem-strip.jsx',
  'src/ui/attention-panel.jsx',
]);
const ANDROID_BLOCKS =
  /^(status-lamp|status-word|issue-row|subsystem-cell|subsys-strip|sys-status-card)(__[\w-]+)?$/;

/** Class names in the Android app's stylesheets, and the blocks and elements of their modifiers. */
function androidHooks() {
  const names = legacySelectorNames(['mobile/src']);
  for (const name of [...names]) {
    const at = name.indexOf('--');
    if (at > 0) names.add(name.slice(0, at));
  }
  return names;
}

/** Whether a `{ file, name }` that compiles to nothing is the Android look's, as above. */
const isAndroidHook = (hooks, { file, name }) =>
  STATUS_FILES.has(file) && ANDROID_BLOCKS.test(name) && hooks.has(name);

test('every class in src/ui/ compiles to CSS', async () => {
  const found = walk('src/ui', ['.js', '.jsx'])
    .filter((f) => !/\.test\.jsx?$/.test(f))
    .flatMap((f) => classNamesIn(read(f), f));
  assert.ok(
    found.some((c) => c.name === 'inline-flex'),
    'no class names found in src/ui/'
  );
  for (const f of STATUS_FILES)
    assert.ok(
      found.some((c) => c.file === f),
      `${f} not found`
    );
  const hooks = androidHooks();
  assert.ok(
    hooks.has('status-lamp') && hooks.has('sys-status-card__word'),
    'Android hooks not found'
  );
  assert.ok(
    !hooks.has('inline-flex') && !hooks.has('glass-card'),
    'only Android selectors are hooks'
  );
  const empty = new Set(await uncompiled(found.map((c) => c.name)));
  assert.deepEqual(
    found
      .filter((c) => empty.has(c.name) && !isAndroidHook(hooks, c))
      .map((c) => `${c.file}: ${c.name}`),
    [],
    "these classes compile to nothing: Tailwind's default sizes, colours, fonts, radii and " +
      'shadows are cleared (docs/design-system.md, rule 4). Use the scale (text-body-sm, ' +
      'text-caption...) and the roles'
  );
});

test("the class check lets through the Android look's class names in the status components, and nothing else", async () => {
  const hooks = androidHooks();
  // Generic names the Android app's stylesheets also style: before #287's fix
  // pass, any file in src/ui/ could write them and pass.
  for (const name of ['chip', 'secondary', 'note']) assert.ok(hooks.has(name), name);
  const badge = 'src/ui/status-word.jsx';
  const cases = [
    // Styled by MobileApp.css; an element whose modifiers it styles.
    { file: 'src/ui/status-lamp.jsx', name: 'status-lamp' },
    { file: 'src/ui/attention-panel.jsx', name: 'sys-status-card__word' },
    // A misspelt hook, and an element of a block that no stylesheet styles.
    { file: 'src/ui/status-lamp.jsx', name: 'status-lampp' },
    { file: 'src/ui/issue-row.jsx', name: 'issue-row__mian' },
    // Android names outside the status blocks, on StatusBadge's web look.
    { file: badge, name: 'chip' },
    { file: badge, name: 'secondary' },
    { file: badge, name: 'note' },
    // A status block outside the status component files.
    { file: 'src/ui/button.jsx', name: 'status-lamp' },
    // A class only the web's legacy CSS styles; a cleared Tailwind size.
    { file: badge, name: 'glass-card' },
    { file: badge, name: 'text-sm' },
  ];
  const empty = new Set(await uncompiled(cases.map((c) => c.name)));
  assert.deepEqual(
    cases
      .filter((c) => empty.has(c.name) && !isAndroidHook(hooks, c))
      .map((c) => `${c.file}: ${c.name}`),
    [
      'src/ui/status-lamp.jsx: status-lampp',
      'src/ui/issue-row.jsx: issue-row__mian',
      `${badge}: chip`,
      `${badge}: secondary`,
      `${badge}: note`,
      'src/ui/button.jsx: status-lamp',
      `${badge}: glass-card`,
      `${badge}: text-sm`,
    ]
  );
});

test('the class check reads className, cn() and cva(), and catches what compiles to nothing', async () => {
  const source = `
    // text-lg in a comment is not a class
    const v = cva('inline-flex text-sm', {
      variants: { size: { xs: 'h-6 text-xs', md: \`h-8 \${x}px-2 text-body\` } },
      compoundVariants: [{ size: 'xs', class: 'font-serif' }],
      defaultVariants: { size: 'md' },
    });
    const C = ({ on }) => (
      <div className={cn('p-2', on && 'shadow-md', on ? 'text-caption' : 'text-xl', { 'bg-red-500': on })}>
        <span className="group/row tabular-nums" />
      </div>
    );`;
  const names = classNamesIn(source, 'x.jsx').map((c) => c.name);
  assert.deepEqual(names.sort(), [
    'bg-red-500',
    'font-serif',
    'group/row',
    'h-6',
    'h-8',
    'inline-flex',
    'p-2',
    'shadow-md',
    'tabular-nums',
    'text-body',
    'text-caption',
    'text-sm',
    'text-xl',
    'text-xs',
  ]);
  assert.deepEqual(await uncompiled(names), [
    'bg-red-500',
    'font-serif',
    'shadow-md',
    'text-sm',
    'text-xl',
    'text-xs',
  ]);
});

/** The class names classNamesIn() finds in `source`, sorted. */
const namesIn = (source) =>
  classNamesIn(source, 'x.jsx')
    .map((c) => c.name)
    .sort();

test("the class check reads a template literal's ${} expressions", async () => {
  const source = `
    const C = ({ on }) => (
      <div className={\`p-2 \${on ? 'text-2xl' : 'text-caption'}\`}>
        <span className={cn(\`gap-1 \${on && 'shadow-lg'}\`)} />
      </div>
    );`;
  const names = namesIn(source);
  assert.deepEqual(names, ['gap-1', 'p-2', 'shadow-lg', 'text-2xl', 'text-caption']);
  assert.deepEqual(await uncompiled(names), ['shadow-lg', 'text-2xl']);
});

test('the class check reads the values of a lookup object, never its keys', async () => {
  // A map read by key, declared after its use and nested, as cn(sizes[size]).
  const source = `
    const C = ({ size, tone }) => (
      <div className={cn('p-2', sizes[size], tones[tone].dot)} />
    );
    const sizes = { sm: 'h-7 text-sm', md: 'h-8 text-body' };
    const tones = { ok: { dot: 'bg-green-500' } };`;
  const names = namesIn(source);
  assert.deepEqual(names, ['bg-green-500', 'h-7', 'h-8', 'p-2', 'text-body', 'text-sm']);
  assert.deepEqual(await uncompiled(names), ['bg-green-500', 'text-sm']);
});

test('the class check reads the classes a variable holds, where a class position reads it', async () => {
  // As table.jsx's cellPad and align (#424). A variable no class position reads,
  // and a parameter (a caller's className), add nothing.
  const source = `
    const pad = 'px-3 first:px-4';
    const C = ({ numeric, className }) => {
      const align = numeric ? 'text-right tabular-nums' : 'text-2xl';
      const label = 'Loading';
      return <td className={cn(pad, align, className)}>{label}</td>;
    };`;
  const names = namesIn(source);
  assert.deepEqual(names, ['first:px-4', 'px-3', 'tabular-nums', 'text-2xl', 'text-right']);
  assert.deepEqual(await uncompiled(names), ['text-2xl']);
});

// Tailwind reads each script it scans as text, comments and other prose included,
// and generates a utility for every word that is one (#424): `grow`, `outline` or
// `block` in a comment each put a rule in the stylesheet that no element uses.
// Tailwind v4 can't skip a script's comments (`@source` picks files, and `@source
// not inline()` would refuse the word as a class too), so this check holds the
// line. The stack's own stylesheets are scanned only for the variables they read.

// Utilities a script in src/ui/ writes as data, not as a class, so the build
// generates them whatever its comments say, and prose may name them: StatusLamp's
// `ring` shape (a prop value the Android app passes), theme names lib/utils.js
// lists for cn, and Table's `data-slot`. Each ships a rule no element uses. Add a
// word only for a name another contract fixes; otherwise rename the data.
const DATA_WORDS = new Map([
  ['ring', 'src/ui/status-lamp.jsx'],
  ['overline', 'src/ui/lib/utils.js'],
  ['sticky', 'src/ui/lib/utils.js'],
  ['table', 'src/ui/table.jsx'],
]);

/** The candidates Tailwind finds in a script's text, as the build's scan does. */
const candidatesIn = (content, file) =>
  new Scanner({}).scanFiles([{ content, extension: path.extname(file).slice(1) }]);

/**
 * The utilities the build generates from src/ui/ that no className, cn() or cva()
 * there writes, as `file: word` for each file whose text names one. `extra`
 * ([{ file, content }]) adds scripts to the scan. The build's own scan decides
 * what is generated; each script is scanned again on its own to name its file.
 */
async function strayUtilities(extra = []) {
  const compiler = await compileStack();
  const scanner = new Scanner({ sources: compiler.sources });
  const candidates = scanner.scan();
  const scripts = scanner.files
    .map((f) => path.relative(ROOT, f))
    .filter((f) => /\.jsx?$/.test(f))
    .map((file) => ({ file, content: read(file) }));
  assert.ok(
    scripts.some((s) => s.file === 'src/ui/button.jsx'),
    'the scan found no script in src/ui/'
  );
  const namedIn = new Map();
  for (const { file, content } of [...scripts, ...extra]) {
    const own = candidatesIn(content, file);
    for (const name of own) namedIn.set(name, [...(namedIn.get(name) ?? []), file]);
  }
  for (const { file, content } of extra) candidates.push(...candidatesIn(content, file));
  const written = new Set(
    [...scripts, ...extra].flatMap(({ file, content }) =>
      classNamesIn(content, file).map((c) => c.name)
    )
  );
  let size = compiler.build([]).length;
  const stray = [];
  for (const name of [...new Set(candidates)].sort()) {
    const grown = compiler.build([name]).length; // cumulative: growth means a utility
    if (grown !== size && !written.has(name) && !DATA_WORDS.has(name)) {
      for (const file of namedIn.get(name) ?? ['(a stylesheet in src/ui/)'])
        stray.push(`${file}: ${name}`);
    }
    size = grown;
  }
  return stray.sort();
}

test('every utility the build generates from src/ui/ is a class written there', async () => {
  assert.deepEqual(
    await strayUtilities(),
    [],
    'these words in src/ui/ generate a utility that no className, cn() or cva() writes, ' +
      'so it ships unused (Tailwind reads comments as class names, #424). Reword them: ' +
      '"grows" for "grow", "on screen" for "visible", "its own width" for "its container". ' +
      'A word the code writes as data goes in DATA_WORDS, above'
  );
});

test('the stray-utility check names the file and the word, and passes what is written', async () => {
  // A line comment, a block comment and JSX text each name a utility nothing
  // writes. A word some component writes (`hidden`) and a data word (`overline`)
  // add nothing, nor do the classes this file writes, held in a variable or not.
  const content = `
    // The label may grow to the row's end.
    /* Its outline sits outside, kept hidden until hovered, as overline text. */
    const pad = 'px-7';
    export const P = () => <p className={cn(pad, 'flex-1')}>Shown in italic</p>;`;
  assert.deepEqual(await strayUtilities([{ file: 'src/ui/planted.jsx', content }]), [
    'src/ui/planted.jsx: grow',
    'src/ui/planted.jsx: italic',
    'src/ui/planted.jsx: outline',
  ]);
});

test('each data word the stray-utility check lets through is still data in its file', () => {
  const printer = ts.createPrinter({ removeComments: true });
  for (const [word, file] of DATA_WORDS) {
    const code = printer.printFile(
      ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, false, ts.ScriptKind.JSX)
    );
    assert.ok(
      candidatesIn(code, file).includes(word),
      `${file} names \`${word}\` only in comments now: drop it from DATA_WORDS`
    );
  }
});

/** Names in tailwind.css's @theme block under `--<ns>-`, less sub-keys (`--text-x--line-height`). */
function themeNames(ns) {
  const theme = postcss
    .parse(read(STACK))
    .nodes.find((n) => n.type === 'atrule' && n.name === 'theme');
  const names = [];
  theme.walkDecls((d) => {
    const m = d.prop.match(new RegExp(`^--${ns}-([a-z][\\w-]*)$`));
    if (m && !m[1].includes('--') && d.value !== 'initial') names.push(m[1]);
  });
  return names;
}

test("cn knows the theme's names: type steps, spacing, shadows, layers and motion (src/ui/lib/utils.js)", () => {
  // Without these, cn reads text-caption as a colour and drops it beside
  // text-crit-fg, never lets a caller's h-9 replace h-control, and keeps both
  // of z-dialog z-toast, leaving the stylesheet's order to pick one.
  const lists = [
    [TYPE_STEPS, 'text', 'text', 'TYPE_STEPS'],
    [SPACING, 'spacing', 'h', 'SPACING'],
    [SHADOWS, 'shadow', 'shadow', 'SHADOWS'],
    [Z_INDEX, 'z-index', 'z', 'Z_INDEX'],
    [DURATIONS, 'transition-duration', 'duration', 'DURATIONS'],
    [EASES, 'ease', 'ease', 'EASES'],
  ];
  for (const [list, ns, prefix, name] of lists) {
    assert.deepEqual([...list], themeNames(ns), `${name} and tailwind.css --${ns}-*`);
    // ...and cn treats each one as its group's: the later of two wins.
    for (const n of list) {
      for (const other of list.filter((o) => o !== n)) {
        assert.equal(cn(`${prefix}-${other}`, `${prefix}-${n}`), `${prefix}-${n}`, name);
      }
    }
  }
  assert.equal(cn('z-dialog', 'z-10'), 'z-10');
  assert.equal(cn('duration-standard', 'duration-300'), 'duration-300');
  assert.equal(cn('ease-standard', 'ease-in'), 'ease-in');
});

test('the controls keep the same heights in both densities, read from the tokens', async () => {
  // Each height utility reads its token...
  const compiler = await compileStack();
  const heights = new Map();
  const classes = ['h-control', 'h-control-sm', 'h-segment', 'size-control', 'size-control-sm'];
  postcss.parse(compiler.build(classes)).walkRules((rule) => {
    const cls = rule.selector.slice(1);
    if (classes.includes(cls)) rule.walkDecls(/^(height|width)$/, (d) => heights.set(cls, d.value));
  });
  assert.deepEqual(Object.fromEntries(heights), {
    'h-control': 'var(--jh-control-h)',
    'h-control-sm': 'var(--jh-control-h-sm)',
    'h-segment': 'var(--jh-segment-h)',
    'size-control': 'var(--jh-control-h)',
    'size-control-sm': 'var(--jh-control-h-sm)',
  });
  // ...and data-density="compact" on the root changes a row, never a control:
  // the mock's compact mode keeps its 34px and 30px controls. A segment is a
  // control less its track's 2px padding, so the track is a control's height.
  const { rules } = readTokens(read('src/ui/tokens.css'));
  const sizes = (density) => {
    const props = resolveContext(rules, { density });
    return ['row-h', 'control-h', 'control-h-sm', 'segment-h'].map((t) => props[`--jh-${t}`]);
  };
  const segment = 'calc(var(--jh-control-h) - 4px)';
  assert.deepEqual(sizes('comfortable'), ['40px', '34px', '30px', segment]);
  assert.deepEqual(sizes('compact'), ['32px', '34px', '30px', segment]);
});

test('a portal root copies every switch the tokens read (src/ui/lib/portal.js)', () => {
  const header = postcss
    .parse(read('src/ui/tokens.css'))
    .nodes.find((n) => n.type === 'comment').text;
  const switches = [...header.matchAll(/\b(data-[a-z]+)="/g)].map((m) => m[1]);
  assert.ok(switches.length >= 4, "expected the switches in tokens.css's header");
  assert.deepEqual([...ROOT_SWITCHES].sort(), [...new Set(switches)].sort());
  // UiRoot sets no attribute for a default (#286), so each default must be the
  // one tokens.css shows with no attribute.
  for (const { attribute, default: fallback } of Object.values(SWITCHES)) {
    const line = header.split('\n').find((l) => l.includes(`${attribute}="`));
    assert.match(line, new RegExp(`${fallback} is the default`), `${attribute}: ${line}`);
  }
});

// What, after the `{...portalRoot}` spread, would override the root it makes:
// its class, a switch, where it renders, or another spread.
const OVERRIDES_ROOT = new Set(['className', 'container', ...ROOT_SWITCHES]);

/**
 * Base UI portals in `source` that aren't given the portal root's props
 * (`{...portalRoot}`, lib/portal.js), or that override them after the spread:
 * [`file: <Tag.Portal>`]. Such a portal would render outside every `.jh-ui`
 * root, without the tokens, the reset or the screen's switches.
 */
export function barePortals(source, file) {
  const out = [];
  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText();
      const attributes = node.attributes.properties;
      const at = attributes.findIndex(
        (a) =>
          ts.isJsxSpreadAttribute(a) &&
          ts.isIdentifier(a.expression) &&
          a.expression.text === 'portalRoot'
      );
      const overridden = attributes
        .slice(at + 1)
        .some((a) => ts.isJsxSpreadAttribute(a) || OVERRIDES_ROOT.has(a.name.getText()));
      if (/(^|\.)Portal$/.test(tag) && (at < 0 || overridden)) out.push(`${file}: <${tag}>`);
    }
    ts.forEachChild(node, visit);
  };
  const kind = /\.tsx?$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.JSX;
  visit(ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind));
  return out;
}

test('every Base UI portal in src/ui/ is a .jh-ui root with the screen’s switches', () => {
  const files = walk('src/ui', ['.js', '.jsx', '.ts', '.tsx']).filter(
    (f) => !/\.test\.[jt]sx?$/.test(f)
  );
  const portalling = files.filter((f) => /\.Portal\b/.test(read(f)));
  // floating/dialog.jsx holds the layer the Dialog, the Drawer and the Confirm share.
  assert.ok(portalling.length >= 5, `expected the overlays' portals, found ${portalling}`);
  assert.deepEqual(
    files.flatMap((f) => barePortals(read(f), f)),
    [],
    'give each portal {...portalRoot} from usePortalRoot or useOverlayPortal (lib/portal.js), ' +
      'with nothing after it that overrides the root'
  );
  // The check bites.
  const source = `<>
    <DialogPrimitive.Portal><div /></DialogPrimitive.Portal>
    <Toast.Portal className="jh-ui" />
    <Popover.Portal {...props} />
    <Menu.Portal {...portalRoot} className="x" />
    <Dialog.Portal {...portalRoot} container={el} />
    <Toast.Portal {...portalRoot} data-theme="light" />
    <Popover.Portal {...portalRoot} {...rest} />
    <Select.Portal {...portalRoot}><div /></Select.Portal>
    <Tooltip.Portal keepMounted {...portalRoot} />
  </>`;
  assert.deepEqual(barePortals(source, 'x.jsx'), [
    'x.jsx: <DialogPrimitive.Portal>',
    'x.jsx: <Toast.Portal>',
    'x.jsx: <Popover.Portal>',
    'x.jsx: <Menu.Portal>',
    'x.jsx: <Dialog.Portal>',
    'x.jsx: <Toast.Portal>',
    'x.jsx: <Popover.Portal>',
  ]);
  assert.deepEqual(barePortals('const p = <Popover.Portal />;', 'x.js'), [
    'x.js: <Popover.Portal>',
  ]);
});

test('only src/ui/ imports Base UI: a screen uses the components, whose portals are roots', () => {
  const files = [
    ...walk('src', ['.js', '.jsx', '.mjs', '.ts', '.tsx']),
    ...walk('mobile/src', ['.js', '.jsx', '.mjs', '.ts', '.tsx']),
  ].filter((f) => !f.startsWith('src/ui/'));
  assert.ok(files.length > 20, `expected the apps' modules, found ${files.length}`);
  const importsBaseUi = (source) =>
    /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\(\s*)['"]@base-ui\//.test(source);
  assert.deepEqual(
    files.filter((f) => importsBaseUi(read(f))),
    [],
    'import a component from @ui/ instead: a Base UI part used directly skips the portal root'
  );
  // The check bites.
  for (const line of [
    "import { Dialog } from '@base-ui/react/dialog';",
    "const m = await import('@base-ui/react/menu');",
    "export { Popover } from '@base-ui/react/popover';",
  ]) {
    assert.ok(importsBaseUi(line), line);
  }
  assert.ok(!importsBaseUi("expect(el).toHaveAttribute('data-base-ui-focus-guard');"));
});

/** The variants of a class name: `hover:dark:bg-x` → ['hover', 'dark']. */
function variantsOf(name) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < name.length; i++) {
    const c = name[i];
    if (c === '[' || c === '(') depth++;
    else if (c === ']' || c === ')') depth--;
    else if (c === ':' && depth === 0) {
      out.push(name.slice(start, i));
      start = i + 1;
    }
  }
  return out;
}

test('src/ui/ never uses the dark: variant, so roots of different themes can nest', () => {
  // `dark:` matches inside any root without data-theme="light", so it can't
  // tell a light root nested in a dark one; the tokens can (tailwind.css).
  const found = walk('src/ui', ['.js', '.jsx'])
    .filter((f) => !/\.test\.jsx?$/.test(f))
    .flatMap((f) => classNamesIn(read(f), f));
  assert.ok(found.length > 100, 'expected the class names in src/ui/');
  assert.deepEqual(
    found.filter((c) => variantsOf(c.name).includes('dark')).map((c) => `${c.file}: ${c.name}`),
    [],
    'use the tokens, which each root sets, instead of dark:'
  );
  assert.deepEqual(variantsOf('hover:dark:bg-surface-2'), ['hover', 'dark']);
  assert.deepEqual(variantsOf("[&_svg:not([class*='size-'])]:size-4"), [
    "[&_svg:not([class*='size-'])]",
  ]);
});

// Motion that isn't §5.3's: a duration, delay or easing of its own, or a
// keyframe animation (§5.3: "animate bars only"; none of src/ui/ is a bar yet).
const OWN_MOTION = /^(duration|delay|ease|animate)-(?!standard$)/;

test('motion is §5.3’s 150ms, and reduced motion cuts it, portals included', async () => {
  const files = walk('src/ui', ['.js', '.jsx']).filter((f) => !/\.test\.jsx?$/.test(f));
  const found = files.flatMap((f) => classNamesIn(read(f), f));
  assert.deepEqual(
    found.filter((c) => OWN_MOTION.test(utilityOf(c.name))).map((c) => `${c.file}: ${c.name}`),
    [],
    'transitions take the token (--jh-duration, --jh-ease): drop the duration, delay or easing'
  );
  assert.deepEqual(
    ['duration-300', 'hover:delay-75', 'ease-in-out', 'animate-pulse', 'data-open:animate-in']
      .concat(['duration-standard', 'ease-standard', 'transition-opacity'])
      .filter((n) => OWN_MOTION.test(utilityOf(n))),
    ['duration-300', 'hover:delay-75', 'ease-in-out', 'animate-pulse', 'data-open:animate-in'],
    'the check bites'
  );
  // The popups are drawn in the floating layer (#444); floating/dialog.jsx
  // draws the Drawer's and the Confirm's layer too.
  for (const name of ['floating/dialog', 'floating/popover', 'floating/tooltip', 'toast']) {
    assert.ok(
      found.some((c) => c.file === `src/ui/${name}.jsx` && /^transition/.test(utilityOf(c.name))),
      `${name}.jsx: expected its 150ms transition`
    );
  }

  const tokens = resolveContext(readTokens(read('src/ui/tokens.css')).rules, {});
  assert.equal(tokens['--jh-duration'], '150ms');
  assert.equal(tokens['--jh-ease'], 'ease');

  const tree = postcss.parse(await buildStack(read(STACK)));
  const durations = new Set();
  tree.walkDecls('transition-duration', (d) => {
    if (d.parent.parent?.type !== 'atrule' || !/reduce/.test(d.parent.parent.params))
      durations.add(d.value);
  });
  assert.ok(durations.size > 0, 'expected the transitions in the compiled stack');
  assert.deepEqual(
    [...durations].filter((v) => !/^(var\(--tw-duration, )?var\(--jh-duration\)\)?$/.test(v)),
    [],
    'every transition runs for --jh-duration'
  );

  // The base style cuts every transition and animation inside a .jh-ui root
  // with reduced motion asked for; !important in the lowest new layer beats
  // even a utility's !important. Every portal is such a root (above).
  let cut = null;
  tree.walkAtRules('media', (media) => {
    if (!/prefers-reduced-motion:\s*reduce/.test(media.params)) return;
    let p = media.parent;
    while (p && !(p.type === 'atrule' && p.name === 'scope')) p = p.parent;
    if (p?.params !== '(.jh-ui)' || p.parent?.params !== 'base') return;
    media.walkRules((rule) => {
      if (rule.selectors.includes('*')) cut = rule;
    });
  });
  assert.ok(cut, 'expected the reduced-motion rule in the base layer, scoped to .jh-ui');
  const decls = Object.fromEntries(cut.nodes.map((d) => [d.prop, `${d.value} ${d.important}`]));
  assert.equal(decls['transition-duration'], '0.01ms true');
  assert.equal(decls['animation-duration'], '0.01ms true');
});

test("Base UI's positioner variables are not ones today's CSS defines", () => {
  const sheets = [...walk('src', ['.css']), ...walk('mobile/src', ['.css'])].filter(
    (f) => !f.startsWith('src/ui/')
  );
  for (const f of sheets) {
    postcss.parse(read(f)).walkDecls(/^--/, (d) => {
      assert.ok(!UNDECLARED_VARS.has(d.prop), `${f} defines ${d.prop}, which the new UI reads`);
    });
  }
});

/** A class name less its variants (`focus-visible:`, `data-[a=b:c]:`) and its `!`. */
function utilityOf(name) {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < name.length; i++) {
    const c = name[i];
    if (c === '[' || c === '(') depth++;
    else if (c === ']' || c === ')') depth--;
    else if (c === ':' && depth === 0) start = i + 1;
  }
  return name.slice(start).replace(/^!|!$/g, '');
}

// A utility that takes the outline away: none, hidden, zero width or a
// transparent colour, written as a utility or an arbitrary value or property.
const RING_REMOVER = new RegExp(
  [
    String.raw`^outline-(none|hidden|0|transparent)(\/[\w.[\]%-]+)?$`,
    String.raw`^outline-\[0(px)?\]$`,
    String.raw`^\[outline(-width|-style|-color)?:(none|hidden|0|0px|transparent)\]$`,
  ].join('|')
);

/** The class names among `names` that take away the focus ring the base style draws. */
export const ringRemovers = (names) => names.filter((n) => RING_REMOVER.test(utilityOf(n)));

/** `style` props in `source` that set an outline: [{ file, name }]. */
export function outlineStyles(source, file) {
  const out = [];
  const visit = (node) => {
    if (ts.isJsxAttribute(node) && node.name.text === 'style') {
      const walkObject = (n) => {
        if (ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) {
          const key =
            n.name && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name)) ? n.name.text : '';
          if (/^outline(Width|Style|Color|-width|-style|-color)?$/.test(key))
            out.push({ file, name: key });
        }
        ts.forEachChild(n, walkObject);
      };
      ts.forEachChild(node, walkObject);
    }
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX));
  return out;
}

test('no class or style in src/ui/ takes the focus ring away', () => {
  const files = walk('src/ui', ['.js', '.jsx']).filter((f) => !/\.test\.jsx?$/.test(f));
  const found = files.flatMap((f) => classNamesIn(read(f), f));
  assert.deepEqual(
    ringRemovers(found.map((c) => c.name)),
    [],
    'every control keeps the 2px focus ring (tailwind.css base); move it with outline-offset-*'
  );
  assert.deepEqual(
    files.flatMap((f) => outlineStyles(read(f), f)).map((s) => `${s.file}: style ${s.name}`),
    [],
    'a style prop must not set the outline either: the focus ring is the base style'
  );
  // The check bites: each way of hiding the ring is caught, and moving it isn't.
  const source = `<b className="outline-none focus:outline-hidden focus-visible:outline-0
    outline-none! !outline-none focus-visible:outline-none! outline-transparent
    focus-visible:outline-transparent outline-transparent/50 [outline:none] [outline:0]
    focus-visible:[outline-style:none] [outline-color:transparent] [outline-width:0px]
    outline-[0px] focus-visible:outline-[0] data-[a=b:c]:outline-none
    -outline-offset-2 outline-offset-1 outline-offset-0 outline-2 outline-focus-ring
    focus-visible:outline-offset-1 data-[a=b:c]:outline-offset-2" />`;
  assert.deepEqual(ringRemovers(namesIn(source)), [
    '!outline-none',
    '[outline-color:transparent]',
    '[outline-width:0px]',
    '[outline:0]',
    '[outline:none]',
    'data-[a=b:c]:outline-none',
    'focus-visible:[outline-style:none]',
    'focus-visible:outline-0',
    'focus-visible:outline-[0]',
    'focus-visible:outline-none!',
    'focus-visible:outline-transparent',
    'focus:outline-hidden',
    'outline-[0px]',
    'outline-none',
    'outline-none!',
    'outline-transparent',
    'outline-transparent/50',
  ]);
  const styled = `<b style={{ outline: 'none' }} /><i style={{ outlineWidth: 0, color: 'red' }} />
    <u style={{ 'outline-style': 'none' }} /><s style={{ outlineOffset: 2 }} />`;
  assert.deepEqual(
    outlineStyles(styled, 'x.jsx').map((s) => s.name),
    ['outline', 'outlineWidth', 'outline-style']
  );
});

// Names a module binds that merge class names, and the packages that provide them.
const MERGER_NAMES = /^(cn|cx|clsx|twMerge|twJoin|createCn|extendTailwindMerge)$/;
const MERGER_PACKAGES = /^(cn|tailwind-merge|clsx|classnames)(\/|$)/;
const UTILS = 'src/ui/lib/utils.js';

/** True if `spec`, imported from `file`, is src/ui/lib/utils.js. */
function isUtils(file, spec) {
  const target = spec.startsWith('@ui/')
    ? `src/ui/${spec.slice('@ui/'.length)}`
    : spec.startsWith('.')
      ? path.posix.normalize(path.posix.join(path.posix.dirname(file), spec))
      : spec;
  return target === UTILS || target === UTILS.replace(/\.js$/, '');
}

/**
 * The imports and re-exports in `source` that bring in a class merger other than
 * src/ui/lib/utils.js's cn: a merger package (`cn`, `tailwind-merge`, `clsx`),
 * or a `cn` or `twMerge` from anywhere else, such as `@/lib/utils`.
 */
export function strayMergers(source, file) {
  const out = [];
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  for (const node of sf.statements) {
    const spec =
      node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
        ? node.moduleSpecifier.text
        : null;
    if (!spec || !(ts.isImportDeclaration(node) || ts.isExportDeclaration(node))) continue;
    const names = [];
    const clause = ts.isImportDeclaration(node) ? node.importClause : undefined;
    if (clause?.name) names.push(clause.name.text);
    const bindings =
      clause?.namedBindings ?? (ts.isExportDeclaration(node) ? node.exportClause : undefined);
    if (bindings && 'elements' in bindings) {
      for (const el of bindings.elements) names.push((el.propertyName ?? el.name).text);
    } else if (bindings) names.push(bindings.name.text);
    if (isUtils(file, spec)) continue;
    if (MERGER_PACKAGES.test(spec) || names.some((n) => MERGER_NAMES.test(n))) {
      out.push(`${file}: ${spec}`);
    }
  }
  return out;
}

test('src/ui/ merges class names only through lib/utils.js, the cn that knows the theme', () => {
  const files = walk('src/ui', ['.js', '.jsx']).filter((f) => f !== UTILS);
  assert.ok(files.includes('src/ui/button.jsx'), 'expected the controls in src/ui/');
  assert.deepEqual(
    files.flatMap((f) => strayMergers(read(f), f)),
    [],
    "import cn from src/ui/lib/utils.js: the stock one misreads the theme's names " +
      "(`npx shadcn add` writes `import { cn } from 'cn'`; switch it)"
  );
  // The check bites, and lets the taught cn through by any path.
  const source = `
    import { cn } from 'cn';
    import { twMerge } from 'tailwind-merge';
    import clsx from 'clsx';
    import { createCn } from 'cn/config';
    import { cn as merge } from '@/lib/utils';
    import * as tw from 'tailwind-merge';
    export { cn } from 'cn';
    import { cn as ok1 } from './lib/utils.js';
    import { cn as ok2 } from '@ui/lib/utils';
    import { Check } from 'lucide-react';
    import { cva } from 'class-variance-authority';`;
  assert.deepEqual(strayMergers(source, 'src/ui/x.jsx'), [
    'src/ui/x.jsx: cn',
    'src/ui/x.jsx: tailwind-merge',
    'src/ui/x.jsx: clsx',
    'src/ui/x.jsx: cn/config',
    'src/ui/x.jsx: @/lib/utils',
    'src/ui/x.jsx: tailwind-merge',
    'src/ui/x.jsx: cn',
  ]);
  assert.deepEqual(strayMergers(`import { cn } from '../lib/utils';`, 'src/ui/forms/x.jsx'), []);
  assert.deepEqual(strayMergers(`import { cn } from '../lib/utils';`, 'src/ui/x.jsx'), [
    'src/ui/x.jsx: ../lib/utils',
  ]);
});
