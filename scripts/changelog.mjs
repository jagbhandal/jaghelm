// CHANGELOG parser and format linter, and the per-PR fragments (changes/<issue>-<slug>.md)
// the release PR folds into it. Node built-ins only.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const SECTION_ORDER = [
  'Breaking changes',
  'Added',
  'Changed',
  'Deprecated',
  'Removed',
  'Fixed',
  'Security',
];

const HEADING_RE = /^## \[(Unreleased|\d+\.\d+\.\d+)\](?: — (\d{4}-\d{2}-\d{2}))?$/;
const REQUIRES_RE = /^Requires JagHelm server (\d+\.\d+\.\d+) or later\.$/;
const LINK_REF_RE = /^\[[^\]]+\]:\s*\S+/;
const EMOJI_RE = /\p{Extended_Pictographic}/u;

function normalize(text) {
  return text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+$/, ''));
}

function cmpVersion(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

// { n, msg } errors as sorted "line N: msg" strings.
function format(errs) {
  return errs.sort((a, b) => a.n - b.n).map((e) => `line ${e.n}: ${e.msg}`);
}

function validDate(s) {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Shared scan: returns entries (with extra lint-only fields) plus structural errors.
function scan(text) {
  const lines = normalize(text);
  const errors = [];
  const err = (n, msg) => errors.push({ n, msg });

  // Trailing link-reference footer: link refs (and blanks) through end of file.
  let end = lines.length;
  let k = lines.length - 1;
  while (k >= 0 && (lines[k] === '' || LINK_REF_RE.test(lines[k]))) k--;
  const footerStart = k + 1;
  const footerHasRef = lines.slice(footerStart).some((l) => LINK_REF_RE.test(l));
  if (footerHasRef) end = footerStart;

  const entries = [];
  let cur = null;
  let sec = null;
  for (let i = 0; i < end; i++) {
    const line = lines[i];
    const n = i + 1;
    if (line.startsWith('## ')) {
      const m = HEADING_RE.exec(line);
      if (!m || (m[1] === 'Unreleased') !== (m[2] === undefined) || (m[2] && !validDate(m[2]))) {
        err(n, 'invalid version heading (expected "## [X.Y.Z] — YYYY-MM-DD" or "## [Unreleased]")');
        cur = null;
        sec = null;
        continue;
      }
      cur = { version: m[1], date: m[2] ?? null, pre: [], sections: [], line: n };
      entries.push(cur);
      sec = null;
      continue;
    }
    if (!cur) {
      if (LINK_REF_RE.test(line)) err(n, 'link reference only allowed after the last entry');
      continue;
    }
    if (/^#{3,} /.test(line) || /^#{3,}$/.test(line)) {
      const m = /^### (.+)$/.exec(line);
      if (!m || /^#/.test(m[1])) {
        err(n, `deeper heading not allowed: "${line}"`);
        continue;
      }
      sec = { name: m[1], lines: [], line: n };
      cur.sections.push(sec);
      continue;
    }
    if (/^#{1,2} /.test(line)) {
      err(n, `unexpected heading inside entry: "${line}"`);
      continue;
    }
    if (LINK_REF_RE.test(line)) err(n, 'link reference only allowed after the last entry');
    (sec ? sec.lines : cur.pre).push({ text: line, n });
  }

  const out = entries.map((e) => {
    const pre = e.pre;
    const nonBlank = pre.filter((l) => l.text !== '');
    const reqLines = nonBlank.filter((l) => REQUIRES_RE.test(l.text));
    let requires = null;
    let requiresLine = null;
    if (reqLines.length > 0) {
      requires = REQUIRES_RE.exec(reqLines[0].text)[1];
      requiresLine = reqLines[0].n;
      if (reqLines.length > 1 || nonBlank[nonBlank.length - 1] !== reqLines[0]) {
        err(requiresLine, 'requires line must appear once, directly after the summary');
      }
    }
    const summary = nonBlank
      .filter((l) => !REQUIRES_RE.test(l.text))
      .map((l) => l.text)
      .join('\n')
      .trim();
    const sections = e.sections.map((s) => ({
      name: s.name,
      body: s.lines.map((l) => l.text).join('\n').trim(),
    }));
    return { entry: { version: e.version, date: e.date, summary, requires, sections, line: e.line }, raw: e, requiresLine };
  });

  return { out, errors, lines };
}

export function parseChangelog(text) {
  return { entries: scan(text).out.map((o) => o.entry) };
}

export function findEntry(text, version) {
  const e = parseChangelog(text).entries.find((x) => x.version === version);
  if (!e) throw new Error(`no CHANGELOG section for ${version}`);
  return e;
}

export function lintChangelog(text, opts = {}) {
  const mobile = Boolean(opts.mobile);
  const { out, errors, lines } = scan(text);
  const errs = [...errors];
  const err = (n, msg) => errs.push({ n, msg });

  if (lines[0] !== '# Changelog') err(1, 'file must start with "# Changelog"');

  lines.forEach((l, i) => {
    if (EMOJI_RE.test(l)) err(i + 1, 'emoji not allowed');
  });

  let prev = null;
  out.forEach(({ entry, raw, requiresLine }, idx) => {
    if (entry.version === 'Unreleased') {
      if (idx !== 0) err(entry.line, 'Unreleased must be the first entry');
    } else {
      if (prev && cmpVersion(entry.version, prev) >= 0) {
        err(entry.line, `versions must be strictly descending (${entry.version} after ${prev})`);
      }
      prev = entry.version;
      if (!entry.summary) err(entry.line, `released entry ${entry.version} has no summary`);
    }
    if (entry.requires && !mobile) err(requiresLine, 'requires line only allowed in mobile CHANGELOG');
    lintSections(raw.sections, err);
  });

  return format(errs);
}

// The subsection rules a version section and a fragment share: known names, each once, in
// canonical order, and only bullets and indented continuations under them.
function lintSections(sections, err) {
  let lastIdx = -1;
  const seen = new Set();
  sections.forEach((s) => {
    const order = SECTION_ORDER.indexOf(s.name);
    if (order === -1) {
      err(s.line, `unknown section "${s.name}"`);
    } else if (seen.has(s.name)) {
      err(s.line, `duplicate section "${s.name}"`);
    } else {
      if (order < lastIdx) err(s.line, `section "${s.name}" is out of order`);
      lastIdx = Math.max(lastIdx, order);
      seen.add(s.name);
    }
    for (const l of s.lines) {
      if (l.text !== '' && !l.text.startsWith('- ') && !l.text.startsWith('  ')) {
        err(l.n, `content under "### ${s.name}" must be a bullet ("- ") or indented continuation`);
      }
    }
  });
}

// ── Fragments ───────────────────────────────────────────────────────────────
// Each PR writes its entry to its own file in changes/ next to the CHANGELOG, so open PRs
// never conflict over [Unreleased]; the release PR folds them in (docs/RELEASING.md).

export const FRAGMENT_NAME_RE = /^([1-9]\d*)-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

export const fragmentDir = (changelog) => path.join(path.dirname(changelog), 'changes');

// Fold order: ascending issue number, then file name. Bad names sort last.
const issueOf = (name) => Number(FRAGMENT_NAME_RE.exec(name)?.[1] ?? Infinity);
const byIssue = (a, b) => issueOf(a.name) - issueOf(b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

// A fragment's ### subsections as { name, line, lines: [{ text, n }] }, blank lines dropped.
// Other headings, text before the first heading and emoji go to err.
function fragmentSections(text, err = () => {}) {
  const sections = [];
  normalize(text).forEach((line, i) => {
    const n = i + 1;
    if (EMOJI_RE.test(line)) err(n, 'emoji not allowed');
    if (line === '') return;
    const m = /^### (.+)$/.exec(line);
    if (m) sections.push({ name: m[1], line: n, lines: [] });
    else if (/^#+( |$)/.test(line)) err(n, `only "### <Subsection>" headings are allowed: "${line}"`);
    else if (sections.length === 0) err(n, 'text before the first "### <Subsection>" heading');
    else sections.at(-1).lines.push({ text: line, n });
  });
  return sections;
}

// Format errors in one fragment: the subsection rules of a version section, at least one
// bullet under each heading, and nothing else (no summary line).
export function lintFragment(text) {
  const errs = [];
  const err = (n, msg) => errs.push({ n, msg });
  const sections = fragmentSections(text, err);
  lintSections(sections, err);
  for (const s of sections) {
    const first = s.lines[0];
    if (!first) err(s.line, `"### ${s.name}" has no bullets`);
    else if (first.text.startsWith('  ')) err(first.n, `"### ${s.name}" must start with a bullet ("- ")`);
  }
  if (errs.length === 0 && sections.length === 0) err(1, 'empty fragment: add a "### <Subsection>" heading with bullets');
  return format(errs);
}

// ## [Unreleased] in `lines`, which ends at the next ## heading, the link-reference footer or
// EOF: its ### subsections as { name, start, end } (heading index, index past its last
// non-blank line), and `last`, the index past the entry's last non-blank line.
function unreleasedLayout(lines) {
  const clean = lines.map((l) => l.replace(/\s+$/, ''));
  const head = clean.indexOf('## [Unreleased]');
  if (head === -1) throw new Error('no "## [Unreleased]" section to fold the fragments into');
  const sections = [];
  let last = head + 1;
  for (let i = head + 1; i < clean.length && !clean[i].startsWith('## ') && !LINK_REF_RE.test(clean[i]); i++) {
    if (clean[i] === '') continue;
    const m = /^### (.+)$/.exec(clean[i]);
    if (m) sections.push({ name: m[1], start: i });
    if (sections.length) sections.at(-1).end = i + 1;
    last = i + 1;
  }
  return { sections, last };
}

// The CHANGELOG with the fragments' bullets added to ## [Unreleased], subsection by
// subsection in canonical order: existing bullets first, then the fragments in fold order.
// Every other line is kept as it is. Expects fragments that pass lintFragment.
export function foldFragments(text, fragments) {
  const add = new Map(SECTION_ORDER.map((name) => [name, []]));
  for (const f of [...fragments].sort(byIssue)) {
    for (const s of fragmentSections(f.text)) add.get(s.name)?.push(...s.lines.map((l) => l.text));
  }
  if ([...add.values()].every((b) => b.length === 0)) return text;

  const lines = text.split('\n');
  for (const [name, bullets] of add) {
    if (bullets.length === 0) continue;
    const { sections, last } = unreleasedLayout(lines);
    const order = SECTION_ORDER.indexOf(name);
    const own = sections.find((s) => s.name === name);
    const next = sections.find((s) => SECTION_ORDER.indexOf(s.name) > order);
    if (own) lines.splice(own.end, 0, ...bullets);
    else if (next) lines.splice(next.start, 0, `### ${name}`, ...bullets, '');
    else lines.splice(last, 0, '', `### ${name}`, ...bullets);
  }
  return lines.join('\n');
}

// The fragment files in dir (every file but README.md) as { name, path, text }, in fold order.
export function readFragments(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name !== 'README.md')
    .map((e) => ({ name: e.name, path: path.join(dir, e.name), text: readFileSync(path.join(dir, e.name), 'utf8') }))
    .sort(byIssue);
}

// Every problem with a CHANGELOG file, the fragments next to it, and the file as it would be
// once they are folded in, each prefixed with the file it is in.
export function lintWithFragments(file, opts = {}) {
  const text = readFileSync(file, 'utf8');
  const errors = lintChangelog(text, opts).map((e) => `${file}: ${e}`);
  const fragments = readFragments(fragmentDir(file));
  for (const f of fragments) {
    if (!FRAGMENT_NAME_RE.test(f.name)) {
      errors.push(`${f.path}: file name must be <issue>-<slug>.md, for example 357-changelog-fragments.md`);
    }
    errors.push(...lintFragment(f.text).map((e) => `${f.path}: ${e}`));
  }
  if (errors.length > 0 || fragments.length === 0) return errors;
  try {
    return lintChangelog(foldFragments(text, fragments), opts).map((e) => `${file} with the fragments folded in: ${e}`);
  } catch (e) {
    return [`${file}: ${e.message}`];
  }
}
