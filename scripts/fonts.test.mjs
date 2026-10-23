// Guards JagHelm's fonts and type (#244, #284): every font is self-hosted, so no
// font request leaves the origin; each @font-face matches the file it points
// at, and each file is the one pinned by its sha256; the new UI's faces follow
// the one list in src/ui/typefaces.js, as src/ui/fonts.css, tokens.css and
// docs/design-system.md do; the default faces' vendored files fit the 60 KB
// budget; text such as "Łódź" draws in the new UI's faces from their latin-ext
// files, which latin text never needs (#394); and the type scale and root
// typography are the ones the docs and the signed-off mock give.
// docs/design-system.md, "Type".
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
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

/** The code points a font file draws: those its Windows Unicode BMP cmap (format 4) maps to a glyph. */
export function fontChars(buf) {
  const { cmap } = woff2Tables(buf);
  for (let i = 0; i < cmap.readUInt16BE(2); i++) {
    const record = 4 + i * 8;
    if (cmap.readUInt16BE(record) !== 3 || cmap.readUInt16BE(record + 2) !== 1) continue;
    const at = cmap.readUInt32BE(record + 4);
    assert.equal(cmap.readUInt16BE(at), 4, 'the Windows Unicode BMP cmap must be format 4');
    const segments = cmap.readUInt16BE(at + 6) / 2;
    const ends = at + 14;
    const starts = ends + segments * 2 + 2; // after reservedPad
    const deltas = starts + segments * 2;
    const offsets = deltas + segments * 2;
    const chars = new Set();
    for (let s = 0; s < segments; s++) {
      const start = cmap.readUInt16BE(starts + s * 2);
      const end = cmap.readUInt16BE(ends + s * 2);
      const delta = cmap.readUInt16BE(deltas + s * 2);
      const offset = cmap.readUInt16BE(offsets + s * 2);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let glyph = c;
        if (offset) {
          glyph = cmap.readUInt16BE(offsets + s * 2 + offset + (c - start) * 2);
          if (glyph === 0) continue;
        }
        if ((glyph + delta) & 0xffff) chars.add(c);
      }
    }
    return chars;
  }
  throw new Error('no Windows Unicode BMP cmap');
}

/** A font file's family name: its name table's name ID 1, Windows Unicode, US English. */
export function fontName(buf) {
  const { name } = woff2Tables(buf);
  const strings = name.readUInt16BE(4);
  for (let i = 0; i < name.readUInt16BE(2); i++) {
    const r = 6 + i * 12;
    const [platform, encoding, language, id, length, offset] = [0, 2, 4, 6, 8, 10].map((o) =>
      name.readUInt16BE(r + o)
    );
    if (platform !== 3 || encoding !== 1 || language !== 0x409 || id !== 1) continue;
    const at = strings + offset;
    return Buffer.from(name.subarray(at, at + length))
      .swap16()
      .toString('utf16le');
  }
  throw new Error('no Windows Unicode family name');
}

// ---- Reading the stylesheets -----------------------------------------------------

/**
 * The @font-face rules of a stylesheet, `rel` or `css` compiled from it, in
 * order: [{ family, style, weights, display, file, range }].
 */
function fontFaces(rel, css = read(rel)) {
  const faces = [];
  postcss.parse(css).walkAtRules('font-face', (rule) => {
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

// Google Fonts' unicode-range for each subset, as its CSS API serves it.
const LATIN =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, ' +
  'U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
const LATIN_EXT =
  'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, ' +
  'U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, ' +
  'U+2C60-2C7F, U+A720-A7FF';

/** The unicode-range a file's subset needs, by the subset in its name. */
const subsetRange = (file) => (/-latin-ext-/.test(file) ? LATIN_EXT : LATIN);

/** The [lo, hi] spans of a unicode-range ('U+0100-02BA, U+2020, …'). */
function spans(range) {
  return range.split(', ').map((part) => {
    const m = part.match(/^U\+([0-9A-F]{1,6})(?:-([0-9A-F]{1,6}))?$/);
    assert.ok(m, `unicode-range part ${part}`);
    const lo = parseInt(m[1], 16);
    return [lo, m[2] ? parseInt(m[2], 16) : lo];
  });
}

/** Whether a unicode-range contains code point `cp`. */
const inRange = (range, cp) => spans(range).some(([lo, hi]) => lo <= cp && cp <= hi);

/** Every code point in a unicode-range. */
const rangeChars = (range) =>
  spans(range).flatMap(([lo, hi]) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i));

/** 'U+0131' for 0x131. */
const hex = (cp) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;

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

test("today's font presets are self-hosted, every one but System's; the default's sans is the new UI's (#306)", () => {
  const declared = new Set(fontFaces(LEGACY_FONTS).map((f) => f.family));
  const ui = new Set(fontFaces(UI_FONTS).map((f) => f.family));
  const wanted = new Set();
  for (const [preset, roles] of Object.entries(FONT_FAMILIES)) {
    if (preset === 'system') continue; // the device's own faces: nothing to load
    for (const stack of Object.values(roles)) wanted.add(stack.match(/^'([^']+)'/)[1]);
  }
  assert.ok(wanted.has('Inter') && wanted.has('Roboto Mono'));
  // The default draws in the new UI's default face (Outfit and DM Sans went
  // with the old board), so Settings asks for no face of its own.
  const sans = TYPEFACES.find((t) => t.id === DEFAULT_TYPEFACE).family;
  assert.match(FONT_FAMILIES.default.display, new RegExp(`^'${sans}'`));
  assert.match(FONT_FAMILIES.default.body, new RegExp(`^'${sans}'`));
  assert.ok(!declared.has('Outfit') && !declared.has('DM Sans'));
  assert.deepEqual(
    [...wanted].filter((f) => !declared.has(f) && !ui.has(f)),
    [],
    `missing from ${LEGACY_FONTS} and ${UI_FONTS}`
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
    assert.equal(face.range, subsetRange(face.file), `${where}: its subset's unicode-range`);
    const buf = readFileSync(path.join(ROOT, face.file));
    // The file is the family's own: its name ID 1 is the family, in some files
    // with more words after it ("Manrope ExtraLight", "DM Sans 9pt"). So two
    // faces' files swapped, in the list and in fonts.css alike, fail here.
    const named = fontName(buf);
    const family = face.family.replace(/ Variable$/, '');
    assert.ok(named === family || named.startsWith(`${family} `), `${where}: the file is ${named}`);
    const has = fontFace(buf);
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

// The Android app ships its own copies of today's faces (mobile/src/fonts/,
// Outfit, DM Sans and JetBrains Mono): their licences sit beside them, since
// the web's went with its copies (#306).
test("the Android app's faces have their licences beside them", () => {
  const dir = 'mobile/src/fonts';
  const files = readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith('.woff2'));
  const LICENCE = { dmsans: 'DMSans', outfit: 'Outfit', jetbrainsmono: 'JetBrainsMono' };
  assert.ok(files.length > 0);
  for (const f of files) {
    const family = LICENCE[f.split('-')[0]];
    assert.ok(family, `${dir}/${f}: which face?`);
    const text = `${dir}/licences/${family}-OFL.txt`;
    assert.ok(existsSync(path.join(ROOT, text)), `${dir}/${f}: no ${text}`);
    assert.match(read(text), /SIL Open Font License, Version 1\.1/, text);
  }
});

// Each vendored file's sha256, pinned to the file Google Fonts served for it on
// 2026-10-19 (the URL above each; src/styles/fonts.css and src/ui/fonts.css give
// the requests; the latin-ext files, #394, are from the same requests as their
// latin files). A file that changes, by a swap or a re-fetch, fails here: check
// the new file against its source and update the pin in the same change.
const PINNED = Object.freeze({
  // https://fonts.gstatic.com/s/firacode/v27/uU9NCBsR6Z2vfE9aq3bh3dSD.woff2
  'fira-code-latin-wght.woff2': '771bf4b79a97fc005d12866168bd39d868a9dd3d5903008fe8b796723c8a56f4',
  // https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7.woff2
  'inter-latin-wght.woff2': '3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62',
  // https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPx7cwhsk.woff2
  'jetbrains-mono-latin-ext-wght.woff2':
    'db5ff4db83e580426280e9337a58dc57d3a83784a1b03ad80914651594441d52',
  // https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPxDcwg.woff2
  'jetbrains-mono-latin-wght.woff2':
    '83c005d49d8a6a50474c73a5a36ac0468076e9c4a29da7bdb14995d80560a5be',
  // https://fonts.gstatic.com/s/manrope/v20/xn7gYHE41ni1AdIRggmxSuXd.woff2
  'manrope-latin-ext-wght.woff2':
    '3911b66d9f2e005a4b989223405d0e5032619c668597ba467cc76a23c8fffcfb',
  // https://fonts.gstatic.com/s/manrope/v20/xn7gYHE41ni1AdIRggexSg.woff2
  'manrope-latin-wght.woff2': 'a30ddcd349703aff7464c34bef3fffdff405ee50c113440d7c8693c02d210972',
  // https://fonts.gstatic.com/s/montserrat/v31/JTUSjIg1_i6t8kCHKm459Wdhyzbi.woff2
  'montserrat-latin-ext-wght.woff2':
    '54d9a78b7ff60b689ad9f3017ffac8547b5d871afec733f6c1c3ae36577ee504',
  // https://fonts.gstatic.com/s/montserrat/v31/JTUSjIg1_i6t8kCHKm459Wlhyw.woff2
  'montserrat-latin-wght.woff2': '06b16db7a969135d48d38c49183be7fb88d4452e2a3011957c7851941f4e4879',
  // https://fonts.gstatic.com/s/nunito/v32/XRXV3I6Li01BKofINeaB.woff2
  'nunito-latin-wght.woff2': 'ba344451eab25b217a165363b1982048a5e5830a0daf36577973955a04cac793',
  // https://fonts.gstatic.com/s/plusjakartasans/v12/LDIoaomQNQcsA88c7O9yZ4KMCoOg4Ko40yyygA.woff2
  'plus-jakarta-sans-latin-ext-wght.woff2':
    '38e3b8fd8045048eb311d90170a4429ed2c8f405852dc3d91b5af8452758703f',
  // https://fonts.gstatic.com/s/plusjakartasans/v12/LDIoaomQNQcsA88c7O9yZ4KMCoOg4Ko20yw.woff2
  'plus-jakarta-sans-latin-wght.woff2':
    '153fc85b70298beeb1d61a5f723331649e7f23bb77302a66e61cb3e2fbdb5e79',
  // https://fonts.gstatic.com/s/rajdhani/v17/LDIxapCSOBg7S-QT7p4HM-Y.woff2
  'rajdhani-latin-400.woff2': '759a9000e47b028799d7a4ca602634a7ac7adf415775df070a335d18d9b66f38',
  // https://fonts.gstatic.com/s/rajdhani/v17/LDI2apCSOBg7S-QT7pb0EPOreec.woff2
  'rajdhani-latin-500.woff2': '23afdb9b5b89b878fab04d80cc30bf41bb4f3f7e8be88e5f16a7cc7671cdb2dc',
  // https://fonts.gstatic.com/s/rajdhani/v17/LDI2apCSOBg7S-QT7pbYF_Oreec.woff2
  'rajdhani-latin-600.woff2': '433a7007e4747a02a790167a6efa2625855f013970ba49b9b739a5d3db8b2601',
  // https://fonts.gstatic.com/s/rajdhani/v17/LDI2apCSOBg7S-QT7pa8FvOreec.woff2
  'rajdhani-latin-700.woff2': '5b7e4a6f97163c2636724d4de90304fc895653dcfe64c67a7a22f26331ca5c5f',
  // https://fonts.gstatic.com/s/roboto/v51/KFO7CnqEu92Fr1ME7kSn66aGLdTylUAMa3yUBA.woff2
  'roboto-latin-wght.woff2': '1404ca348bd75ef836f4dd8b6f2cc719458642d1237c368296b2fc652dca47dc',
  // https://fonts.gstatic.com/s/robotomono/v31/L0x5DF4xlVMF-BfR8bXMIjhLq38.woff2
  'roboto-mono-latin-wght.woff2':
    'b81cd55177300649be8f95b3b747d721ce607e8ed2856e25bd0c630cfd631faf',
  // https://fonts.gstatic.com/s/sourcecodepro/v32/HI_SiYsKILxRpg3hIP6sJ7fM7PqlPevW.woff2
  'source-code-pro-latin-wght.woff2':
    '8b774aaa5137a38ef40f4ac9d36db9a5eee152b2f66589dfdc82ff007fc87135',
});

test('every vendored font file is the one pinned by its sha256', () => {
  const files = readdirSync(path.join(ROOT, FONTS)).filter((f) => f.endsWith('.woff2'));
  assert.deepEqual(files.sort(), Object.keys(PINNED).sort(), `the files in ${FONTS}/ and the pins`);
  for (const f of files) {
    const sha = createHash('sha256')
      .update(readFileSync(path.join(ROOT, FONTS, f)))
      .digest('hex');
    assert.equal(sha, PINNED[f], `${FONTS}/${f} is not the pinned file`);
  }
});

// ---- The new UI's faces (#284) ----------------------------------------------------

test('one typeface list: fonts.css, tokens.css and the docs follow src/ui/typefaces.js', () => {
  const ids = TYPEFACES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, 'a typeface is listed twice');
  assert.equal(ids[0], DEFAULT_TYPEFACE, 'the default typeface comes first');
  for (const id of ids) assert.match(id, /^[a-z]+(-[a-z]+)*$/, `${id}: a data-typeface value`);
  const others = ids.filter((id) => id !== DEFAULT_TYPEFACE);
  const byId = Object.fromEntries(TYPEFACES.map((t) => [t.id, t]));

  // fonts.css: two faces per typeface and the mono, as the list gives them: the
  // latin-ext file, then the latin one, in Google's order and with its ranges
  // (#394), so the code points both claim go to latin. Each face's latin-ext
  // file is its latin file's partner, by name (and by family, in the test above).
  for (const { family, file, latinExtFile } of [...TYPEFACES, MONO_TYPEFACE]) {
    assert.match(file, /-latin-wght\.woff2$/, `${family}: its latin file`);
    assert.equal(
      latinExtFile,
      file.replace('-latin-', '-latin-ext-'),
      `${family}: its latin-ext file`
    );
  }
  assert.deepEqual(
    fontFaces(UI_FONTS).map(({ family, style, weights, file, range }) => ({
      family,
      style,
      weights,
      file,
      range,
    })),
    [...TYPEFACES, MONO_TYPEFACE].flatMap(({ family, weights, file, latinExtFile }) => [
      { family, style: 'normal', weights, file: `${FONTS}/${latinExtFile}`, range: LATIN_EXT },
      { family, style: 'normal', weights, file: `${FONTS}/${file}`, range: LATIN },
    ]),
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

// This sums the vendored files, which is about what crosses the wire, since woff2
// is already compressed. It doesn't measure a page load: #306 checks the bytes
// the built app transfers.
test('the vendored woff2 bytes of the default faces (Manrope and JetBrains Mono) are at most 60 KB', () => {
  const size = (t) => statSync(path.join(ROOT, FONTS, t.file)).size;
  const face = TYPEFACES.find((t) => t.id === DEFAULT_TYPEFACE);
  const total = size(face) + size(MONO_TYPEFACE);
  assert.ok(
    total <= BUDGET,
    `the vendored woff2 files of the default faces, ${face.label} (${size(face)} B) and ` +
      `${MONO_TYPEFACE.label} (${size(MONO_TYPEFACE)} B), are ${total} B, over ${BUDGET} B ` +
      '(woff2 is already compressed, so this is about what crosses the wire)'
  );
});

// How a browser draws text in one of the new UI's families: for each character
// it checks the family's @font-face rules, the last defined first, and takes the
// first whose unicode-range has it, downloading that rule's file if it hasn't
// (CSS Fonts 4, "Font matching", step 5). So a screen showing "Łódź" downloads
// the active face's latin-ext file for the Ł and the ź, and draws all four
// characters in that face; a latin-only screen never touches the file.
test('"Łódź" draws in each face from its latin-ext file, which latin text never downloads (#394)', () => {
  const faces = fontFaces(UI_FONTS);
  const both = rangeChars(LATIN).filter((cp) => inRange(LATIN_EXT, cp));
  assert.deepEqual(
    both.map(hex),
    ['U+0131', 'U+0152', 'U+0153', 'U+0304', 'U+0308', 'U+0329', 'U+2020'],
    'the code points both ranges claim'
  );
  for (const t of [...TYPEFACES, MONO_TYPEFACE]) {
    const rules = faces.filter((f) => f.family === t.family).reverse();
    const pick = (cp) => rules.find((f) => inRange(f.range, cp))?.file;
    const ext = `${FONTS}/${t.latinExtFile}`;
    const latin = `${FONTS}/${t.file}`;
    const draws = {
      [ext]: fontChars(readFileSync(path.join(ROOT, ext))),
      [latin]: fontChars(readFileSync(path.join(ROOT, latin))),
    };
    const word = [...'Łódź'].map((c) => c.codePointAt(0));
    assert.deepEqual(word.map(pick), [ext, latin, latin, ext], `${t.label}: the files for Łódź`);
    for (const cp of word) {
      assert.ok(draws[pick(cp)].has(cp), `${t.label}: ${pick(cp)} doesn't draw ${hex(cp)}`);
    }
    // Without the latin-ext file, Ł and ź would fall back to the system face.
    assert.ok(!draws[latin].has(0x141) && !draws[latin].has(0x17a), `${t.label}: latin has Ł, ź`);

    // Latin text never downloads the latin-ext file. Nothing up to U+00FF is in
    // latin-ext's range, and the latin file draws printable ASCII and the Latin-1
    // letters.
    for (let cp = 0; cp <= 0xff; cp++) {
      const at = `${t.label}: ${hex(cp)}`;
      assert.ok(!inRange(LATIN_EXT, cp), `${at} is in latin-ext's range`);
      const printable = (cp >= 0x20 && cp <= 0x7e) || cp >= 0xc0;
      if (printable) assert.ok(draws[latin].has(cp), `${at}: ${latin} doesn't draw it`);
    }
    // And every code point in latin's range that the latin file draws resolves
    // to it, so the latin rule must come last: the seven code points both ranges
    // claim include ı, Œ and œ, which the latin file draws and latin-ext doesn't.
    for (const cp of rangeChars(LATIN)) {
      if (cp > 0xff && !draws[latin].has(cp)) continue;
      assert.equal(pick(cp), latin, `${t.label}: ${hex(cp)} is the latin file's`);
    }
    for (const cp of [0x131, 0x152, 0x153]) {
      assert.ok(draws[latin].has(cp) && !draws[ext].has(cp), `${t.label}: ${hex(cp)}`);
    }
  }
});

// Both apps get fonts.css through tailwind.css (`@import … layer(theme)`), so
// what ships is the compiled stack. This checks, without a build, that the
// compile keeps all eight rules and their order, which the latin-first lookup
// above depends on.
test("the compiled stack keeps fonts.css's rules, in order", async () => {
  const compiler = await compile(read(STACK), {
    base: path.join(ROOT, 'src/ui'),
    onDependency() {},
  });
  const compiled = fontFaces(STACK, compiler.build([]));
  assert.equal(compiled.length, 2 * (TYPEFACES.length + 1));
  assert.deepEqual(compiled, fontFaces(UI_FONTS));
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
