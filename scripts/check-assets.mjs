#!/usr/bin/env node
/**
 * CI guard against the "referenced-but-absent" class of bug (broken PWA icons,
 * a missing og-image, dead doc links) that the audit found.
 *
 *  - FAILS the build if a root-absolute asset referenced in index.html or
 *    manifest.json is missing from public/ (the concrete, user-visible class).
 *  - WARNS (non-fatal) on dead relative links in docs/ + README, so pre-existing
 *    doc drift is surfaced without blocking deploys.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const root = process.cwd();
const pub = join(root, 'public');
const errors = [];
const warnings = [];

// 1. Public assets referenced in index.html + manifest.json must exist.
const html = readFileSync(join(root, 'index.html'), 'utf8');
const refs = new Set();
for (const m of html.matchAll(/(?:href|src|content)="(\/[^"'>]+)"/g)) refs.add(m[1]);
if (existsSync(join(pub, 'manifest.json'))) {
  const manifest = JSON.parse(readFileSync(join(pub, 'manifest.json'), 'utf8'));
  for (const icon of manifest.icons || []) {
    if (icon.src) refs.add(icon.src.startsWith('/') ? icon.src : '/' + icon.src);
  }
}
for (const ref of refs) {
  // Skip the SPA entry, Vite-hashed assets, API paths, and external URLs.
  if (ref.startsWith('/src/') || ref.startsWith('/assets/') || ref.startsWith('/api')) continue;
  if (!existsSync(join(pub, ref.replace(/^\//, '')))) {
    errors.push(`missing asset referenced by index.html/manifest: ${ref}`);
  }
}

// 2. Relative markdown links in docs/ + README should resolve (warn only).
const mdFiles = [join(root, 'README.md')];
const walk = (d) => {
  if (!existsSync(d)) return;
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (e.endsWith('.md')) mdFiles.push(p);
  }
};
walk(join(root, 'docs'));
for (const f of mdFiles) {
  if (!existsSync(f)) continue;
  for (const m of readFileSync(f, 'utf8').matchAll(/\]\(([^)]+)\)/g)) {
    const link = m[1].split('#')[0].trim();
    if (!link || /^(https?:|mailto:|#|\/)/.test(link)) continue;
    if (!existsSync(resolve(dirname(f), link))) {
      warnings.push(`${f.replace(root + '/', '')}: dead link -> ${link}`);
    }
  }
}

if (warnings.length) console.warn('Dead doc links (non-fatal):\n' + warnings.map((w) => '  - ' + w).join('\n'));
if (errors.length) {
  console.error('\nAsset check FAILED:\n' + errors.map((e) => '  - ' + e).join('\n'));
  process.exit(1);
}
console.log('Asset check passed.');
