// CHANGELOG parser and format linter. Node built-ins only.

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

function normalize(text) {
  return text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+$/, ''));
}

function cmpVersion(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
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
    if (/\p{Extended_Pictographic}/u.test(l)) err(i + 1, 'emoji not allowed');
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

    let lastIdx = -1;
    const seen = new Set();
    raw.sections.forEach((s) => {
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
  });

  return errs.sort((a, b) => a.n - b.n).map((e) => `line ${e.n}: ${e.msg}`);
}
