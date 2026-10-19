// Guards JagHelm's fonts and type (#244, #284): every font is self-hosted, so no
// font request leaves the origin; each @font-face matches the file it points
// at; the new UI's faces follow the one list in src/ui/typefaces.js, as
// src/ui/fonts.css, tokens.css and docs/design-system.md do; the default setup
// fits the 60 KB budget; and the type scale and root typography are the ones
// the docs and the signed-off mock give. docs/design-system.md, "Type".
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';
import { compile } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';
import postcss from 'postcss';
import { readTokens } from './ui-contrast.mjs';
import { DEFAULT_TYPEFACE, MONO_TYPEFACE, TYPEFACES } from '../src/ui/typefaces.js';
import { FONT_FAMILIES } from '../src/hooks/useThemeVars.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const FONTS = 'src/fonts';
const LEGACY_FONTS = 'src/styles/fonts.css';
const UI_FONTS = 'src/ui/fonts.css';
const STACK = 'src/ui/tailwind.css';
const DOC = 'docs/design-system.md';
// Fonts on first load, for the default setup (#284): the default face and the mono.
const BUDGET = 60 * 1024;

/** Repo-relative files under `dir` with one of `exts`, tests left out. */
function walk(dir, exts) {
  return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory())
      return e.name === 'node_modules' || e.name === 'dist' ? [] : walk(rel, exts);
    return exts.some((x) => e.name.endsWith(x)) && !/\.test\./.test(e.name) ? [rel] : [];
  });
}

// ---- Reading a WOFF2 file ------------------------------------------------------

// The table tags a WOFF2 directory refers to by index (the WOFF2 spec, 5.1).
const KNOWN_TAGS = (
  'cmap head hhea hmtx maxp name OS/2 post cvt_ fpgm glyf loca prep CFF_ VORG EBDT EBLC gasp ' +
  'hdmx kern LTSH PCLT VDMX vhea vmtx BASE GDEF GPOS GSUB EBSC JSTF MATH CBDT CBLC COLR CPAL ' +
  'SVG_ sbix acnt avar bdat bloc bsln cvar fdsc feat fmtx fvar gvar hsty just lcar mort morx ' +
  'opbd prop trak Zapf Silf Glat Gloc Feat Sill'
)
  .split(' ')
  .map((t) => t.replace('_', ' '));

/** The tables of a WOFF2 font, by tag, as stored (glyf and loca transformed). */
export function woff2Tables(buf) {
  assert.equal(buf.toString('latin1', 0, 4), 'wOF2', 'not a WOFF2 file');
  const numTables = buf.readUInt16BE(12);
  const compressed = buf.readUInt32BE(20);
  let at = 48;
  const base128 = () => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const b = buf[at++];
      value = value * 128 + (b & 0x7f);
      if (!(b & 0x80)) return value;
    }
    throw new Error('bad UIntBase128');
  };
  const dir = [];
  for (let i = 0; i < numTables; i++) {
    const flags = buf[at++];
    const tag =
      (flags & 0x3f) === 63 ? buf.toString('latin1', at, (at += 4)) : KNOWN_TAGS[flags & 0x3f];
    const version = flags >> 6;
    const origLength = base128();
    // glyf and loca are transformed unless version 3; any other table if not 0.
    const transformed = tag === 'glyf' || tag === 'loca' ? version !== 3 : version !== 0;
    dir.push({ tag, length: transformed ? base128() : origLength });
  }
  const data = brotliDecompressSync(buf.subarray(at, at + compressed));
  const tables = {};
  let offset = 0;
  for (const { tag, length } of dir) {
    tables[tag] = data.subarray(offset, offset + length);
    offset += length;
  }
  return tables;
}

/** What a font file can draw: { weights: [min, max], italic }. */
export function fontFace(buf) {
  const { fvar, 'OS/2': os2 } = woff2Tables(buf);
  const italic = (os2.readUInt16BE(62) & 1) === 1; // fsSelection bit 0
  if (fvar) {
    const axes = fvar.readUInt16BE(4);
    const count = fvar.readUInt16BE(8);
    const size = fvar.readUInt16BE(10);
    for (let i = 0; i < count; i++) {
      const a = axes + i * size;
      if (fvar.toString('latin1', a, a + 4) === 'wght') {
        return {
          weights: [fvar.readInt32BE(a + 4) / 65536, fvar.readInt32BE(a + 12) / 65536],
          italic,
        };
      }
    }
  }
  const weight = os2.readUInt16BE(4); // usWeightClass
  return { weights: [weight, weight], italic };
}

// ---- Reading the stylesheets -----------------------------------------------------

/** The @font-face rules of a stylesheet: [{ family, style, weights, display, file, range }]. */
function fontFaces(rel) {
  const faces = [];
  postcss.parse(read(rel)).walkAtRules('font-face', (rule) => {
    const d = {};
    rule.walkDecls((decl) => (d[decl.prop] = decl.value.replace(/\s+/g, ' ').trim()));
    const url = d.src.match(/^url\('([^']+)'\) format\('woff2'\)$/);
    assert.ok(url, `${rel}: ${d['font-family']} must have one woff2 src, got ${d.src}`);
    const [lo, hi = lo] = d['font-weight'].split(' ').map(Number);
    faces.push({
      family: d['font-family'].replace(/^'|'$/g, ''),
      style: d['font-style'],
      weights: [lo, hi],
      display: d['font-display'],
      file: path.posix.join(path.posix.dirname(rel), url[1]),
      range: d['unicode-range'],
    });
  });
  return faces;
}

const LATIN =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, ' +
  'U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';

/** The licence file for a family: 'JetBrains Mono Variable' → JetBrainsMono-OFL.txt. */
const licence = (family) =>
  `${FONTS}/licences/${family.replace(/ Variable$/, '').replace(/\s/g, '')}-OFL.txt`;

// ---- Self-hosting (#244) ---------------------------------------------------------

test('no page, stylesheet or script loads a font or stylesheet from another origin', () => {
  const pages = ['index.html', 'mobile/index.html'];
  const code = [...walk('src', ['.js', '.jsx']), ...walk('mobile/src', ['.js', '.jsx'])];
  const sheets = [...walk('src', ['.css']), ...walk('mobile/src', ['.css'])];
  assert.ok(sheets.includes(LEGACY_FONTS) && sheets.includes(UI_FONTS));
  for (const f of [...pages, ...code, ...sheets]) {
    assert.ok(!/fonts\.(googleapis|gstatic)\.com/.test(read(f)), `${f} names Google Fonts`);
  }
  const offOrigin = /^(?:[a-z][\w+.-]*:|\/\/)/i;
  for (const f of pages) {
    for (const [tag] of read(f).matchAll(/<link\b[^>]*>/g)) {
      const href = tag.match(/href="([^"]*)"/)?.[1] ?? '';
      assert.ok(!offOrigin.test(href), `${f}: ${tag} loads from another origin`);
    }
  }
  for (const f of sheets) {
    const css = postcss.parse(read(f));
    css.walkAtRules('import', (rule) => {
      assert.ok(
        !offOrigin.test(rule.params.replace(/^url\(|^['"]/g, '')),
        `${f}: @import ${rule.params}`
      );
    });
    css.walkDecls((decl) => {
      for (const [, url] of decl.value.matchAll(/url\(\s*['"]?([^'")]+)/g)) {
        assert.ok(
          !offOrigin.test(url) || url.startsWith('data:'),
          `${f}: url(${url}) is off-origin`
        );
      }
    });
  }
});

test("today's font presets are self-hosted, every one but System's", () => {
  const declared = new Set(fontFaces(LEGACY_FONTS).map((f) => f.family));
  const wanted = new Set();
  for (const [preset, roles] of Object.entries(FONT_FAMILIES)) {
    if (preset === 'system') continue; // the device's own faces: nothing to load
    for (const stack of Object.values(roles)) wanted.add(stack.match(/^'([^']+)'/)[1]);
  }
  assert.ok(wanted.has('Outfit') && wanted.has('Roboto Mono'));
  assert.deepEqual(
    [...wanted].filter((f) => !declared.has(f)),
    [],
    `missing from ${LEGACY_FONTS}`
  );
  assert.deepEqual(
    [...declared].filter((f) => !wanted.has(f)),
    [],
    `unused in ${LEGACY_FONTS}`
  );
});

test('every @font-face points at a file that draws the face it declares', () => {
  const faces = [...fontFaces(LEGACY_FONTS), ...fontFaces(UI_FONTS)];
  for (const face of faces) {
    const where = `${face.family} ${face.style} ${face.weights.join('-')} (${face.file})`;
    assert.ok(existsSync(path.join(ROOT, face.file)), `${where}: no such file`);
    assert.equal(face.display, 'swap', `${where}: font-display must be swap`);
    assert.equal(face.range, LATIN, `${where}: the latin subset's unicode-range`);
    const has = fontFace(readFileSync(path.join(ROOT, face.file)));
    assert.equal(has.italic, face.style === 'italic', `${where}: font-style`);
    assert.ok(
      has.weights[0] <= face.weights[0] && face.weights[1] <= has.weights[1],
      `${where}: the file draws weights ${has.weights.join('-')} only`
    );
    assert.ok(
      existsSync(path.join(ROOT, licence(face.family))),
      `${where}: no ${licence(face.family)}`
    );
  }
  // Nothing shipped that nothing uses, files or licences.
  const used = new Set(faces.map((f) => f.file));
  const files = readdirSync(path.join(ROOT, FONTS)).filter((f) => f.endsWith('.woff2'));
  assert.deepEqual(
    files.filter((f) => !used.has(`${FONTS}/${f}`)),
    [],
    'unused font files'
  );
  const licences = new Set(faces.map((f) => licence(f.family)));
  const texts = readdirSync(path.join(ROOT, FONTS, 'licences')).map(
    (f) => `${FONTS}/licences/${f}`
  );
  assert.deepEqual(
    texts.filter((f) => !licences.has(f)),
    [],
    'licences for no font'
  );
  for (const f of texts) assert.match(read(f), /SIL Open Font License, Version 1\.1/, f);
});

// ---- The new UI's faces (#284) ----------------------------------------------------

test('one typeface list: fonts.css, tokens.css and the docs follow src/ui/typefaces.js', () => {
  const ids = TYPEFACES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, 'a typeface is listed twice');
  assert.equal(ids[0], DEFAULT_TYPEFACE, 'the default typeface comes first');
  for (const id of ids) assert.match(id, /^[a-z]+(-[a-z]+)*$/, `${id}: a data-typeface value`);
  const others = ids.filter((id) => id !== DEFAULT_TYPEFACE);
  const byId = Object.fromEntries(TYPEFACES.map((t) => [t.id, t]));

  // fonts.css: one face per typeface and the mono, as the list gives them.
  assert.deepEqual(
    fontFaces(UI_FONTS).map(({ family, style, weights, file }) => ({
      family,
      style,
      weights,
      file,
    })),
    [...TYPEFACES, MONO_TYPEFACE].map(({ family, weights, file }) => ({
      family,
      style: 'normal',
      weights,
      file: `${FONTS}/${file}`,
    })),
    UI_FONTS
  );

  // tokens.css: the default face on .jh-ui, a block per other face setting only
  // --jh-font-face, and the switch its header documents.
  const tokens = read('src/ui/tokens.css');
  const { rules } = readTokens(tokens);
  const base = rules.find((r) => r.selector === '.jh-ui').decls;
  assert.equal(base['--jh-font-face'], `'${byId[DEFAULT_TYPEFACE].family}'`);
  assert.match(base['--jh-font-sans'], /^var\(--jh-font-face\),/);
  assert.match(base['--jh-font-mono'], new RegExp(`^'${MONO_TYPEFACE.family}',`));
  const blocks = rules.filter((r) => r.attrs.typeface);
  assert.deepEqual(blocks.map((r) => r.attrs.typeface).sort(), [...others].sort());
  for (const r of blocks) {
    assert.deepEqual(Object.keys(r.attrs), ['typeface'], `${r.selector}: the typeface alone`);
    assert.deepEqual(r.decls, { '--jh-font-face': `'${byId[r.attrs.typeface].family}'` });
  }
  assert.deepEqual(tokens.match(/data-typeface="([a-z|-]+)"/)?.[1].split('|'), others);

  // docs/design-system.md: the switches table and the typefaces table.
  const doc = read(DOC);
  const sw = doc.match(/^\| `data-typeface` \| (.+?) \| ([\w-]+) \|$/m);
  assert.ok(sw, `${DOC} has no data-typeface row in its switches table`);
  assert.deepEqual(
    [...sw[1].matchAll(/`([a-z-]+)`/g)].map((m) => m[1]),
    others
  );
  assert.equal(sw[2], DEFAULT_TYPEFACE);
  const rows = table(doc, '| Face | `data-typeface` | Weights | Use |');
  assert.deepEqual(
    rows.map(([label, attr, weights]) => [label, attr, weights]),
    [...TYPEFACES, MONO_TYPEFACE].map(({ id, label, weights }) => [
      id === DEFAULT_TYPEFACE ? `${label} (default)` : label,
      id === DEFAULT_TYPEFACE || id === MONO_TYPEFACE.id ? 'none' : `\`${id}\``,
      weights.join('–'),
    ]),
    `${DOC}'s typefaces table`
  );
});

test("the default setup's fonts fit the 60 KB budget", () => {
  const size = (t) => statSync(path.join(ROOT, FONTS, t.file)).size;
  const face = TYPEFACES.find((t) => t.id === DEFAULT_TYPEFACE);
  const total = size(face) + size(MONO_TYPEFACE);
  assert.ok(
    total <= BUDGET,
    `${face.label} (${size(face)} B) and ${MONO_TYPEFACE.label} (${size(MONO_TYPEFACE)} B) ` +
      `are ${total} B, over ${BUDGET} B`
  );
});

// ---- The type scale and the root's typography ---------------------------------------

/** The rows of the Markdown table under `head`, as trimmed cells. */
function table(doc, head) {
  const lines = doc.split('\n');
  const at = lines.indexOf(head);
  assert.ok(at >= 0, `${DOC} has no table headed ${head}`);
  const end = lines.findIndex((l, i) => i > at && !l.startsWith('|'));
  return lines.slice(at + 2, end).map((l) =>
    l
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim())
  );
}

test('the type scale in tailwind.css is the one docs/design-system.md lists', () => {
  const theme = postcss
    .parse(read(STACK))
    .nodes.find((n) => n.type === 'atrule' && n.name === 'theme');
  const scale = {};
  theme.walkDecls(/^--text-[\w-]+$/, (d) => {
    const [, step, part = 'size'] = d.prop.match(/^--text-([\w-]+?)(?:--([\w-]+))?$/);
    if (d.value === 'initial') return; // --text-*: initial clears Tailwind's sizes
    (scale[step] ??= {})[part] = d.value;
  });
  const fromTheme = Object.entries(scale).map(([step, s]) => [
    step,
    `${parseInt(s.size)}/${parseInt(s['line-height'])}` +
      (s['letter-spacing'] ? `, ${s['letter-spacing']}` : ''),
    s['font-weight'] ?? '',
  ]);
  const fromDoc = table(read(DOC), '| Step | Size / line | Weight | Use |').map(
    ([step, size, w]) => [step.replace(/`/g, ''), size, w]
  );
  assert.deepEqual(fromDoc, fromTheme);
  // The mock's 15px titles have their own step (#284).
  assert.deepEqual(
    fromTheme.find(([s]) => s === 'title-xs'),
    ['title-xs', '15/20', '700']
  );
});

test("the .jh-ui root sets the mock's tabular figures and smoothing; font-mono drops ligatures", async () => {
  const compiler = await compile(read(STACK), {
    base: path.join(ROOT, 'src/ui'),
    onDependency() {},
  });
  const css = postcss.parse(
    compiler.build([
      ...new Scanner({ sources: compiler.sources }).scan(),
      'font-mono',
      'tabular-nums',
      'proportional-nums',
    ])
  );
  const decls = (match) => {
    const out = {};
    css.walkRules((rule) => {
      if (match(rule)) rule.walkDecls((d) => (out[d.prop] = d.value));
    });
    return out;
  };
  const root = decls(
    (r) =>
      r.selector === ':scope' &&
      r.parent.params === '(.jh-ui)' &&
      r.parent.parent?.params === 'base'
  );
  assert.equal(root['font-family'], 'var(--jh-font-sans)');
  assert.equal(root['font-variant-numeric'], 'tabular-nums');
  assert.equal(root['-webkit-font-smoothing'], 'antialiased');
  assert.equal(root['-moz-osx-font-smoothing'], 'grayscale');
  assert.equal(root['text-rendering'], 'optimizeLegibility');
  const mono = decls((r) => r.selector === '.font-mono');
  assert.equal(mono['font-family'], 'var(--jh-font-mono)');
  assert.match(mono['font-feature-settings'], /'liga' 0, 'calt' 0/);
  assert.match(
    decls((r) => r.selector === '.tabular-nums')['--tw-numeric-spacing'],
    /tabular-nums/
  );
  assert.match(
    decls((r) => r.selector === '.proportional-nums')['--tw-numeric-spacing'],
    /proportional-nums/
  );
});
