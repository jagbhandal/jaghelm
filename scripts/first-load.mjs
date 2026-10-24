#!/usr/bin/env node
/**
 * The first load (#444): what a browser fetches to draw the first screen, as
 * the server sends it, from a production build, against spec §4's two budgets
 * (Jag, 2026-10-22; raised from 200 KB on 2026-10-24, #654): 230 KB for the
 * scripts, styles and page (the logo counted with them), and 60 KB for the
 * self-hosted faces.
 *
 *   node scripts/first-load.mjs              build into dist/, then measure it,
 *                                            at 1440px and at 390px
 *   node scripts/first-load.mjs --dist DIR   measure a build already in DIR
 *
 * It counts what index.html pulls (the page, its scripts and module preloads,
 * its stylesheets, any preloaded font) and what the first screen draws beyond
 * it: the header's logo and the two faces the new UI draws text in by
 * default (the default sans in src/ui/typefaces.js, and the mono; latin
 * files). A phone's first screen (below 768px, #303) is the phone screens
 * instead of the desktop's sections: the same, plus their chunk
 * (PHONE_CHUNK) and what it imports, and none of the desktop's Jobs section
 * or utilities rail (DESKTOP_CHUNKS, #578, #532), which a desktop's counts;
 * `--phone` reports it, and with neither flag both
 * are. Text is counted
 * gzipped, as the server's compression() sends it; fonts and images as they
 * are; the app's data (/api) not at all. kB are 1,000 bytes.
 * e2e/first-load.spec.mjs checks, in a browser on the incident fixture at
 * 1440px and at 390px, that this is exactly what the first screen fetches.
 *
 * It is CI's gate on the budgets (#306, .gitea/workflows/check.yml): it
 * exits 1 when either total is over its budget at either width, naming
 * which. The functions are pure, for a test (scripts/first-load.test.mjs):
 * firstLoad(build) is the report, formatReport(report) the table this
 * prints, overBudget(report) what is over.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { DEFAULT_TYPEFACE, MONO_TYPEFACE, TYPEFACES } from '../src/ui/typefaces.js';

/** Spec §4's budgets, in bytes: the code (scripts, styles, the page, the logo), and the fonts. */
export const BUDGETS = Object.freeze({ code: 230_000, fonts: 60_000 });

/** The header's logo (src/ui/app-header.jsx), from public/. */
export const LOGO = '/logo.svg';

/** The latin files of the faces the new UI draws on the first screen: the default sans and the mono. */
export const FACES = [TYPEFACES.find((t) => t.id === DEFAULT_TYPEFACE).file, MONO_TYPEFACE.file];

/**
 * The phone screens' chunk (src/shell/PhoneView.jsx, lazyViews.js
 * loadPhoneView): a phone's first screen loads it, a desktop's never.
 */
export const PHONE_CHUNK = 'PhoneView.js';

/**
 * The Overview's Jobs section (src/shell/OverviewJobs.jsx, lazyViews.js
 * loadOverviewJobs, #578): a desktop's first screen asks for it as the board
 * mounts and draws nothing under the status until it is in; and its utilities
 * rail (src/shell/OverviewRail.jsx, loadOverviewRail, #532), which a window
 * from 1440px asks for as it draws the rail. So both are counted with a
 * desktop's first load (at 1440px); a phone's first screen never loads them.
 */
export const DESKTOP_CHUNKS = Object.freeze(['OverviewJobs.js', 'OverviewRail.js']);

/**
 * The phone's detail screens (src/shell/PhoneDetail.jsx, lazyViews.js
 * loadPhoneDetail, #309): a phone fetches them once the browser is idle after
 * the first screen, so the first detail opened draws at once. Listed apart
 * (`idle`), in no total: the first screen never waits for them.
 */
export const PHONE_IDLE_CHUNK = 'PhoneDetail.js';

/**
 * The command palette's index (src/components/CommandPaletteIndex.js,
 * lazyViews.js loadCommandPaletteIndex, #611): its rows, the search over them
 * and Settings' search terms. Either width fetches it once the browser is
 * idle after the first screen, so the first ⌘K opens at once; listed apart
 * (`idle`), in no total, as the detail screens are.
 */
export const PALETTE_IDLE_CHUNK = 'CommandPaletteIndex.js';

/**
 * The pending host steps (src/shell/HostActions.jsx, lazyViews.js
 * loadHostActions, #673): both widths' Overview ask for it once the browser is
 * idle after the first screen (HostActionsSlot), so it is listed apart (`idle`),
 * in no total, as the detail screens and the palette's index are.
 */
export const HOST_ACTIONS_IDLE_CHUNK = 'HostActions.js';

/**
 * The Backups section (src/shell/Backups.jsx, lazyViews.js loadBackups, #675):
 * asked for once the browser is idle after the first screen, as the pending
 * host steps are, so it is listed apart (`idle`), in no total.
 */
export const BACKUPS_IDLE_CHUNK = 'Backups.js';

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

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * `file`'s built copy among `assets` (the names in dist/assets), as a URL: the
 * whole name with Vite's 8-character hash before the extension, never a longer
 * name that starts the same. Pure.
 */
export function builtAsset(assets, file) {
  const dot = file.lastIndexOf('.');
  const built = new RegExp(`^${escape(file.slice(0, dot))}-[\\w-]{8}${escape(file.slice(dot))}$`);
  const name = assets.find((a) => built.test(a));
  if (!name) throw new Error(`${file} is not in the build's assets`);
  return `/assets/${name}`;
}

/**
 * The scripts a built script imports statically (`from"./x.js"`,
 * `import"./x.js"`), as /assets/ URLs, in the order it names them. Pure.
 */
export function staticImports(code) {
  const out = [];
  for (const [, file] of String(code).matchAll(/(?:from|import)\s*["']\.\/([\w.-]+\.js)["']/g)) {
    const url = `/assets/${file}`;
    if (!out.includes(url)) out.push(url);
  }
  return out;
}

/** Bytes as sent: gzipped for text, as they are for fonts and images. Pure. */
export function transferSize(url, bytes) {
  return RAW.test(url) ? bytes.length : gzipSync(bytes).length;
}

/**
 * The first load of a build: { items, code, fonts }, `items` being
 * [{ kind, url, bytes }] in the table's order, `code` and `fonts` each
 * { total, budget }: the fonts, and everything else. `build` gives the build's
 * index.html (`html`), the names in its assets folder (`assets`), and
 * `read(url)`, a file's bytes. With `phone`, a phone's first screen: the
 * phone screens' chunk and the scripts it imports that the page hasn't
 * pulled; without, a desktop's, with the
 * Jobs section's and the utilities rail's chunks (DESKTOP_CHUNKS) and what
 * they import, each when the build has it; and `idle`, what it fetches
 * once the browser is idle after that (PHONE_IDLE_CHUNK, a phone's only, and
 * PALETTE_IDLE_CHUNK and HOST_ACTIONS_IDLE_CHUNK, and the scripts only they import), in no total (none in
 * a build without them).
 * Pure apart from `read`.
 */
export function firstLoad({ html, assets, read }, { phone = false } = {}) {
  const pulled = htmlPulls(html);
  const lazy = [];
  // `from`'s chunk and the scripts it imports that nothing listed has, onto `into`.
  const walk = (from, into, listed) => {
    const queue = [from];
    while (queue.length) {
      const url = queue.shift();
      if (listed.some((p) => p.url === url) || into.some((p) => p.url === url)) continue;
      into.push({ kind: 'script', url });
      queue.push(...staticImports(read(url)));
    }
  };
  if (phone) walk(builtAsset(assets, PHONE_CHUNK), lazy, pulled);
  for (const chunk of phone ? [] : DESKTOP_CHUNKS) {
    const built = assets.some((a) => a.startsWith(chunk.replace(/\.js$/, '-')));
    if (built) walk(builtAsset(assets, chunk), lazy, pulled);
  }
  const idleScripts = [];
  for (const chunk of phone
    ? [PHONE_IDLE_CHUNK, PALETTE_IDLE_CHUNK, HOST_ACTIONS_IDLE_CHUNK, BACKUPS_IDLE_CHUNK]
    : [PALETTE_IDLE_CHUNK, HOST_ACTIONS_IDLE_CHUNK, BACKUPS_IDLE_CHUNK]) {
    const built = assets.some((a) => a.startsWith(chunk.replace(/\.js$/, '-')));
    if (built) walk(builtAsset(assets, chunk), idleScripts, [...pulled, ...lazy]);
  }
  const wanted = [
    { kind: 'page', url: '/index.html' },
    ...pulled,
    ...lazy,
    ...FACES.map((file) => ({ kind: 'font', url: builtAsset(assets, file) })),
    { kind: 'image', url: LOGO },
  ];
  const items = [];
  for (const item of wanted) {
    if (items.some((i) => i.url === item.url)) continue;
    items.push({ ...item, bytes: transferSize(item.url, read(item.url)) });
  }
  items.sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));
  const sum = (keep) => items.filter(keep).reduce((total, i) => total + i.bytes, 0);
  return {
    items,
    code: { total: sum((i) => i.kind !== 'font'), budget: BUDGETS.code },
    fonts: { total: sum((i) => i.kind === 'font'), budget: BUDGETS.fonts },
    idle: idleScripts.map((i) => ({ ...i, bytes: transferSize(i.url, read(i.url)) })),
  };
}

const kB = (bytes) => (bytes / 1000).toFixed(1);

/** The totals of `report` over their budget, by name ('code', 'fonts'); none, []. Pure. */
export function overBudget({ code, fonts }) {
  return Object.entries({ code, fonts })
    .filter(([, { total, budget }]) => total > budget)
    .map(([name]) => name);
}

/**
 * The report as a table, one line a file (its hash left out, so two builds
 * compare line by line), a line a kind, and the code's and the fonts' totals
 * against their budgets. Pure.
 */
export function formatReport(
  { items, code, fonts, idle = [] },
  title = 'First load: what the first screen fetches, as sent (kB = 1,000 bytes)'
) {
  const name = (url) => url.replace(/-[\w-]{8}(\.\w+)$/, '$1');
  const width = Math.max(...items.map((i) => name(i.url).length));
  const line = (left, bytes) => `${left.padEnd(width + 9)}${kB(bytes).padStart(7)} kB`;
  const out = [title, ''];
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
  out.push('');
  for (const [label, { total, budget }] of [
    ['code: page, scripts, styles, images', code],
    ['fonts', fonts],
  ]) {
    const left = budget - total;
    const verdict = `${left >= 0 ? 'under' : 'OVER'} its ${kB(budget)} kB budget by ${kB(Math.abs(left))} kB`;
    out.push(`${line(`  ${label}`, total)}  ${verdict}`);
  }
  if (idle.length) {
    out.push('', '  After the first screen, once the browser is idle (in no total):');
    for (const i of idle) out.push(line(`  ${i.kind.padEnd(7)}${name(i.url)}`, i.bytes));
  }
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
  const build = {
    html: readFileSync(path.join(dist, 'index.html'), 'utf8'),
    assets: readdirSync(path.join(dist, 'assets')),
    read: (url) => readFileSync(path.join(dist, url)),
  };
  const only = argv.includes('--phone') ? 'phone' : argv.includes('--desktop') ? 'desktop' : null;
  const runs = [];
  if (only !== 'phone')
    runs.push([
      '1440px',
      firstLoad(build),
      'First load at 1440px: what the first screen fetches, as sent (kB = 1,000 bytes)',
    ]);
  if (only !== 'desktop')
    runs.push([
      '390px',
      firstLoad(build, { phone: true }),
      'First load at 390px, the phone screens (#303), as sent (kB = 1,000 bytes)',
    ]);
  console.log(runs.map(([, report, title]) => formatReport(report, title)).join('\n\n'));
  const over = runs.flatMap(([width, report]) => overBudget(report).map((n) => `${n} at ${width}`));
  if (over.length) {
    console.error(`\nOver the first-load budget (spec §4): ${over.join(', ')}`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
