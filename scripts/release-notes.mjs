// Renders the public GitHub Release body from a CHANGELOG entry. Node built-ins only.
// Usage:
//   node scripts/release-notes.mjs server <version> [--prev <tag>] [--changelog <path>]
//
// Refuses while changes/ next to the CHANGELOG holds fragments that were never folded in
// (#357), since their entries would be missing from the notes. --allow-unfolded skips that
// for a test render of a version already released.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findEntry, fragmentDir, lintChangelog, readFragments } from './changelog.mjs';

const IMAGE = 'ghcr.io/jagbhandal/jaghelm';
const REPO_URL = 'https://github.com/jagbhandal/jaghelm';
const FENCE = '```';

// GitHub renders single newlines as line breaks, so undo the CHANGELOG's hard wraps.
function unwrapBullets(text) {
  const out = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('- ') || out.length === 0) out.push(line);
    else out[out.length - 1] += ` ${line}`;
  }
  return out.join('\n');
}

// A release page lives under /releases/tag/, where a link relative to the CHANGELOG 404s
// (#308). Each Markdown link whose target is a path in the repo (no scheme such as https:
// or mailto:, not `#anchor` alone) points at that file at the release's tag instead,
// resolved from the CHANGELOG's directory (`dir`) as GitHub resolves it there; its
// anchor stays.
function linkToTag(text, tag, dir) {
  return text.replace(/\]\(([^)\s]+)\)/g, (whole, target) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#') || target.startsWith('//')) {
      return whole;
    }
    const at = target.indexOf('#');
    const file = at === -1 ? target : target.slice(0, at);
    const anchor = at === -1 ? '' : target.slice(at);
    const inRepo = file.startsWith('/') ? file.slice(1) : path.posix.join(dir, file);
    const clean = path.posix.normalize(inRepo);
    if (clean.startsWith('..')) return whole;
    return `](${REPO_URL}/blob/${tag}/${clean}${anchor})`;
  });
}

function body(entry, { tag, dir }) {
  return [
    entry.summary.split('\n').map((l) => l.trim()).filter(Boolean).join(' '),
    ...entry.sections.map((s) => `### ${s.name}\n${unwrapBullets(s.body)}`),
  ].map((part) => linkToTag(part, tag, dir));
}

export function renderServerNotes(entry, { prevTag }) {
  const v = entry.version;
  const link = prevTag
    ? `[${prevTag}...v${v}](${REPO_URL}/compare/${prevTag}...v${v})`
    : `[CHANGELOG.md](${REPO_URL}/blob/v${v}/CHANGELOG.md)`;
  return [
    `${entry.date} · \`v${v}\` · \`${IMAGE}:${v}\``,
    ...body(entry, { tag: `v${v}`, dir: '' }),
    '---',
    `${FENCE}\ndocker pull ${IMAGE}:${v}\n${FENCE}`,
    `Image signed with cosign (keyless). Full changelog: ${link}`,
  ].join('\n\n');
}

function fail(code, msg) {
  console.error(msg);
  process.exit(code);
}

function main(argv) {
  const [kind, version, ...args] = argv;
  if (kind !== 'server' || !version) {
    fail(2, 'usage: release-notes.mjs server <version> [--prev <tag>] [--changelog <path>] [--allow-unfolded]');
  }
  const allowUnfolded = args.includes('--allow-unfolded');
  const rest = args.filter((a) => a !== '--allow-unfolded');
  const opts = {};
  for (let i = 0; i < rest.length; i += 2) {
    const k = rest[i];
    if (!['--prev', '--changelog'].includes(k) || rest[i + 1] === undefined) {
      fail(2, `unknown or incomplete option: ${k}`);
    }
    opts[k.slice(2)] = rest[i + 1];
  }
  if (version === 'Unreleased') fail(1, 'refusing to render notes for Unreleased');

  const file = opts.changelog ?? 'CHANGELOG.md';
  const text = readFileSync(file, 'utf8');
  const unfolded = allowUnfolded ? [] : readFragments(fragmentDir(file));
  if (unfolded.length) {
    fail(1, `${fragmentDir(file)}/ holds fragments that are not folded into ${file}, so their entries would be missing from the notes:\n` +
      unfolded.map((f) => `  ${f.path}`).join('\n') +
      `\nFold them in a release PR first: node scripts/changelog-fold.mjs (docs/RELEASING.md)`);
  }
  const errors = lintChangelog(text);
  if (errors.length) fail(1, errors.map((e) => `${file}: ${e}`).join('\n'));
  let entry;
  try {
    entry = findEntry(text, version);
  } catch (e) {
    fail(1, e.message);
  }
  const out = renderServerNotes(entry, { prevTag: opts.prev ?? null });
  process.stdout.write(`${out}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
