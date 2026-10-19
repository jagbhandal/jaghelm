// Guards how the new UI stack (Tailwind CSS v4 and shadcn/ui in src/ui/, #282)
// sits beside today's CSS without restyling it, and stays importable by the
// Android app. docs/ARCHITECTURE.md, "UI stack", explains the design.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const LAYER_ORDER = '@layer legacy, properties, theme, base, components, utilities;';
const ENTRIES = ['src/main.jsx', 'mobile/src/main.jsx'];
const LEGACY_SHEETS = ['src/styles/legacy.css', 'mobile/src/styles/legacy.css'];

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

/** The stylesheet without comments; quoted strings (such as `@source` globs) kept whole. */
function stripComments(css) {
  let out = '';
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end < 0 ? css.length : end + 1;
    } else if (c === "'" || c === '"') {
      const end = css.indexOf(c, i + 1);
      const stop = end < 0 ? css.length : end + 1;
      out += css.slice(i, stop);
      i = stop - 1;
    } else out += c;
  }
  return out;
}

/** The top-level statements of a stylesheet: each at-rule or rule up to its `{` or `;`. */
function topLevel(css) {
  const out = [];
  let depth = 0;
  let start = 0;
  const src = stripComments(css);
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"') {
      i = src.indexOf(c, i + 1);
      if (i < 0) break;
    } else if (c === '{') {
      if (depth === 0) out.push(src.slice(start, i).trim());
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) start = i + 1;
    } else if (c === ';' && depth === 0) {
      out.push(src.slice(start, i + 1).trim());
      start = i + 1;
    }
  }
  return out.filter(Boolean);
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
    assert.doesNotMatch(
      read(f),
      /^\s*import\s+['"][^'"]+\.css['"]/m,
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

test('the stylesheets declare the same cascade layer order, legacy lowest', () => {
  for (const f of [...LEGACY_SHEETS, 'src/ui/tailwind.css']) {
    assert.equal(topLevel(read(f))[0], LAYER_ORDER, `${f} must open with ${LAYER_ORDER}`);
  }
});

test("the new stack's stylesheet cannot reach today's screens", () => {
  const css = read('src/ui/tailwind.css');
  const statements = topLevel(css);
  // Tailwind's own preflight would reset every element on the page; the scoped copy only .jh-ui.
  assert.ok(statements.includes("@import './preflight.css' layer(base);"));
  assert.ok(!/tailwindcss\/preflight|@import 'tailwindcss'/.test(stripComments(css)));
  // Only src/ui/ is scanned, so a class in legacy markup never generates a utility.
  assert.ok(
    statements.includes("@import 'tailwindcss/utilities.css' layer(utilities) source(none);")
  );
  // The default theme is inlined: no --text-* or --font-mono on :root beside global.css's own.
  assert.ok(statements.includes("@import 'tailwindcss/theme.css' layer(theme) theme(inline);"));
  // Nothing unlayered: only imports, sources, variants, @theme and @layer blocks.
  for (const s of statements) {
    assert.match(
      s,
      /^@(layer|import|source|custom-variant|theme)\b/,
      `unlayered rule in tailwind.css: ${s}`
    );
  }
  // Tokens are scoped to .jh-ui. A :root, html or body rule would override today's
  // --accent, --border, --card and --muted (global.css, MobileApp.css).
  assert.doesNotMatch(stripComments(css), /(^|[\s,{}])(:root|html|body)\b[^{};]*\{/);
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

/** `--name: value` declarations in every block whose selector matches `selectorRe`. */
function declarations(css, selectorRe) {
  const vars = new Map();
  for (const [, body] of css.matchAll(new RegExp(`${selectorRe.source}\\s*\\{([^{}]*)\\}`, 'g'))) {
    for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g))
      vars.set(name, value);
  }
  return vars;
}

test('a theme variable Tailwind puts on :root is redeclared under .jh-ui when built from its tokens', async () => {
  // Compile the stack's stylesheet as the build does, with the classes found in src/ui/.
  const { compile } = await import('@tailwindcss/node');
  const { Scanner } = await import('@tailwindcss/oxide');
  const file = path.join(ROOT, 'src/ui/tailwind.css');
  const compiler = await compile(readFileSync(file, 'utf8'), {
    base: path.dirname(file),
    onDependency() {},
  });
  const out = compiler.build(new Scanner({ sources: compiler.sources }).scan());
  assert.match(out, /\.bg-primary\s*\{/, 'expected the Button utilities in the compiled CSS');

  const scoped = declarations(out, /(?<![\w-])\.jh-ui(?![\w-])/);
  const onRoot = declarations(out, /:root,\s*:host/);
  for (const [name, value] of onRoot) {
    const uses = [...value.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]);
    if (uses.some((t) => scoped.has(t) && !onRoot.has(t))) {
      assert.ok(
        scoped.has(name),
        `${name}: ${value} is written on :root, where ${uses.join(', ')} do not exist: ` +
          'declare it again in the .jh-ui block of src/ui/tailwind.css'
      );
    }
  }
});
