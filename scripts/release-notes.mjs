// Renders the public GitHub Release body from a CHANGELOG entry. Node built-ins only.
// Usage:
//   node scripts/release-notes.mjs server <version> [--prev <tag>] [--changelog <path>]
//   node scripts/release-notes.mjs android <version> --apk <name> --sha256 <hex> [--changelog <path>]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { findEntry, lintChangelog } from './changelog.mjs';

const IMAGE = 'ghcr.io/jagbhandal/jaghelm';
const REPO_URL = 'https://github.com/jagbhandal/jaghelm';
const FENCE = '```';

function body(entry) {
  return [entry.summary, ...entry.sections.map((s) => `### ${s.name}\n${s.body}`)];
}

export function renderServerNotes(entry, { prevTag }) {
  const v = entry.version;
  const link = prevTag
    ? `[${prevTag}...v${v}](${REPO_URL}/compare/${prevTag}...v${v})`
    : `[CHANGELOG.md](${REPO_URL}/blob/v${v}/CHANGELOG.md)`;
  return [
    `${entry.date} · \`v${v}\` · \`${IMAGE}:${v}\``,
    ...body(entry),
    '---',
    `${FENCE}\ndocker pull ${IMAGE}:${v}\n${FENCE}`,
    `Image signed with cosign (keyless). Full changelog: ${link}`,
  ].join('\n\n');
}

export function renderAndroidNotes(entry, { apkName, sha256 }) {
  const req = entry.requires ? ` · Requires JagHelm server ${entry.requires} or later` : '';
  return [
    `${entry.date} · \`mobile-v${entry.version}\`${req}`,
    ...body(entry),
    '---',
    `**Asset:** \`${apkName}\` · SHA-256 \`${sha256}\``,
    'Download the APK on your Android device and open it to install. Updates install over earlier versions and keep your settings.',
  ].join('\n\n');
}

function fail(code, msg) {
  console.error(msg);
  process.exit(code);
}

function main(argv) {
  const [kind, version, ...rest] = argv;
  if ((kind !== 'server' && kind !== 'android') || !version) {
    fail(2, 'usage: release-notes.mjs server <version> [--prev <tag>] [--changelog <path>]\n       release-notes.mjs android <version> --apk <name> --sha256 <hex> [--changelog <path>]');
  }
  const opts = {};
  for (let i = 0; i < rest.length; i += 2) {
    const k = rest[i];
    if (!['--prev', '--changelog', '--apk', '--sha256'].includes(k) || rest[i + 1] === undefined) {
      fail(2, `unknown or incomplete option: ${k}`);
    }
    opts[k.slice(2)] = rest[i + 1];
  }
  const mobile = kind === 'android';
  if (mobile && (!opts.apk || !opts.sha256)) fail(2, 'android requires --apk <name> and --sha256 <hex>');
  if (version === 'Unreleased') fail(1, 'refusing to render notes for Unreleased');

  const file = opts.changelog ?? (mobile ? 'mobile/CHANGELOG.md' : 'CHANGELOG.md');
  const text = readFileSync(file, 'utf8');
  const errors = lintChangelog(text, { mobile });
  if (errors.length) fail(1, errors.map((e) => `${file}: ${e}`).join('\n'));
  let entry;
  try {
    entry = findEntry(text, version);
  } catch (e) {
    fail(1, e.message);
  }
  const out = mobile
    ? renderAndroidNotes(entry, { apkName: opts.apk, sha256: opts.sha256 })
    : renderServerNotes(entry, { prevTag: opts.prev ?? null });
  process.stdout.write(`${out}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
