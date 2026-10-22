#!/usr/bin/env node
/**
 * The first load (#444; spec §4: ≤ 200 KB transferred): what a browser fetches
 * to draw the first screen, as the server sends it, from a production build.
 *
 *   node scripts/first-load.mjs              build into dist/, then measure it
 *   node scripts/first-load.mjs --dist DIR   measure a build already in DIR
 *
 * It counts what index.html pulls (the page, its scripts and module preloads,
 * its stylesheets, any preloaded font) and what the first screen draws beyond
 * it: the header's logo, the two faces the new UI draws text in by default
 * (the default sans in src/ui/typefaces.js, and the mono; latin files), and
 * the two that today's board still draws (LEGACY_FACES). Text is counted
 * gzipped, as the server's compression() sends it; fonts and images as they
 * are; the app's data (/api) not at all. kB are 1,000 bytes.
 * e2e/first-load.spec.mjs checks, in a browser on the incident fixture at
 * 1440px, that this is exactly what the first screen fetches.
 *
 * The functions are pure, for a test (scripts/first-load.test.mjs) and for the
 * CI check #306 makes of it: firstLoad(build) is the report, formatReport(report)
 * the table this prints. Until then it only reports, and exits 0.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { DEFAULT_TYPEFACE, MONO_TYPEFACE, TYPEFACES } from '../src/ui/typefaces.js';

/** Spec §4's budget, in bytes. */
export const BUDGET = 200_000;

/** The header's logo (src/ui/app-header.jsx), from public/. */
export const LOGO = '/logo.svg';

/** The latin files of the faces the new UI draws on the first screen: the default sans and the mono. */
export const FACES = [TYPEFACES.find((t) => t.id === DEFAULT_TYPEFACE).file, MONO_TYPEFACE.file];

/**
 * The faces today's screens still draw on the first screen (src/styles/fonts.css):
 * DM Sans and Outfit, in the board's panels below the new sections and in the
 * Overview's hidden heading. They go with the last legacy screen (Phase 1);
 * e2e/first-load.spec.mjs fails when the browser stops fetching one, so it
 * leaves this list then.
 */
export const LEGACY_FACES = ['dm-sans-latin-wght.woff2', 'outfit-latin-wght.woff2'];

/** The kinds, in the order the table lists them. */
const KINDS = ['page', 'script', 'style', 'font', 'image'];

/** Sent as they are: compressed already, so compression() leaves them. */
const RAW = /\.(woff2?|png|jpe?g|webp|avif|gif)$/i;

/**
 * What index.html pulls on first load, in document order, each once:
 * [{ kind, url }]. Its scripts (module or not) and module preloads, its
 * stylesheets, and what it preloads. Icons and the manifest are left out: a
 * browser fetches them apart from the page. Pure.
 */
export function htmlPulls(html) {
  const out = [];
  const add = (kind, url) => {
    if (url && !out.some((p) => p.url === url)) out.push({ kind, url });
  };
  const attr = (tag, name) => tag.match(new RegExp(`\\s${name}=["']([^"']*)["']`, 'i'))?.[1];
  for (const [tag] of html.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
    if (/^<script/i.test(tag)) {
      add('script', attr(tag, 'src'));
      continue;
    }
    const rel = attr(tag, 'rel')?.toLowerCase();
    const href = attr(tag, 'href');
    if (rel === 'modulepreload') add('script', href);
    else if (rel === 'stylesheet') add('style', href);
    else if (rel === 'preload') {
      const as = attr(tag, 'as')?.toLowerCase();
      add({ font: 'font', script: 'script', style: 'style', image: 'image' }[as] ?? 'other', href);
    }
  }
  return out;
}

/** `file`'s built copy among `assets` (the names in dist/assets), as a URL. Pure. */
export function builtAsset(assets, file) {
  const dot = file.lastIndexOf('.');
  const [stem, ext] = [file.slice(0, dot), file.slice(dot)];
  const name = assets.find((a) => a.startsWith(`${stem}-`) && a.endsWith(ext));
  if (!name) throw new Error(`${file} is not in the build's assets`);
  return `/assets/${name}`;
}

/** Bytes as sent: gzipped for text, as they are for fonts and images. Pure. */
export function transferSize(url, bytes) {
  return RAW.test(url) ? bytes.length : gzipSync(bytes).length;
}

/**
 * The first load of a build: { items, total, budget }, `items` being
 * [{ kind, url, bytes }] in the table's order. `build` gives the build's
 * index.html (`html`), the names in its assets folder (`assets`), and
 * `read(url)`, a file's bytes. Pure apart from `read`.
 */
export function firstLoad({ html, assets, read }) {
  const wanted = [
    { kind: 'page', url: '/index.html' },
    ...htmlPulls(html),
    ...[...FACES, ...LEGACY_FACES].map((file) => ({ kind: 'font', url: builtAsset(assets, file) })),
    { kind: 'image', url: LOGO },
  ];
  const items = [];
  for (const item of wanted) {
    if (items.some((i) => i.url === item.url)) continue;
    items.push({ ...item, bytes: transferSize(item.url, read(item.url)) });
  }
  items.sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));
  const total = items.reduce((sum, i) => sum + i.bytes, 0);
  return { items, total, budget: BUDGET };
}

const kB = (bytes) => (bytes / 1000).toFixed(1);

/**
 * The report as a table, one line a file (its hash left out, so two builds
 * compare line by line), a line a kind, and the total against the budget. Pure.
 */
export function formatReport({ items, total, budget }) {
  const name = (url) => url.replace(/-[\w-]{8}(\.\w+)$/, '$1');
  const width = Math.max(...items.map((i) => name(i.url).length));
  const line = (left, bytes) => `${left.padEnd(width + 9)}${kB(bytes).padStart(7)} kB`;
  const out = ['First load: what the first screen fetches, as sent (kB = 1,000 bytes)', ''];
  for (const kind of KINDS) {
    const these = items.filter((i) => i.kind === kind);
    if (!these.length) continue;
    for (const i of these) out.push(line(`  ${kind.padEnd(7)}${name(i.url)}`, i.bytes));
  }
  out.push('');
  for (const kind of KINDS) {
    const sum = items.filter((i) => i.kind === kind).reduce((s, i) => s + i.bytes, 0);
    if (sum) out.push(line(`  ${kind}s`, sum));
  }
  out.push(line('  total', total));
  const left = budget - total;
  out.push(
    `  ${left >= 0 ? 'under' : 'OVER'} the ${kB(budget)} kB budget by ${kB(Math.abs(left))} kB`
  );
  return out.join('\n');
}

function main(argv) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const at = argv.indexOf('--dist');
  let dist = path.join(root, 'dist');
  if (at >= 0) dist = path.resolve(argv[at + 1]);
  else {
    const built = spawnSync('npx', ['vite', 'build', '--logLevel', 'warn'], {
      cwd: root,
      stdio: 'inherit',
    });
    if (built.status !== 0) process.exit(built.status ?? 1);
  }
  const report = firstLoad({
    html: readFileSync(path.join(dist, 'index.html'), 'utf8'),
    assets: readdirSync(path.join(dist, 'assets')),
    read: (url) => readFileSync(path.join(dist, url)),
  });
  console.log(formatReport(report));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
