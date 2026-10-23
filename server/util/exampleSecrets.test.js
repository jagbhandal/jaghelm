/**
 * #576: every DASH_SECRET value the docs print is refused as a key, by the
 * secrets manager and by the session stamp, from one list.
 *
 * The test reads the docs: each `DASH_SECRET=<value>` (an .env line, a compose
 * list item, `-e`), each `DASH_SECRET: <value>` YAML key (a block scalar's
 * lines too), and the default of each `${DASH_SECRET:-<value>}`, in the files
 * git tracks at the repo root (README, env.example, compose.yaml, ...) and
 * under docs/ and changes/. A doc that prints a new example without adding it
 * to EXAMPLE_SECRETS fails here. Only tracked files are read, never a local
 * `.env`, and a failure names where a value is, never the value. A blank value
 * is "not set", and another `$` value is an interpolation or a command
 * (`$(openssl rand -hex 32)`), not an example.
 *
 * The secrets manager caches the first key it derives, so the one value it is
 * meant to accept is tried last.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DASH_PASS = 'stamp-test-password'; // pragma: allowlist secret
delete process.env.DASH_SECRET;

const { EXAMPLE_SECRETS, isExampleSecret } = await import('./exampleSecrets.js');
const { setSecret, getSecret } = await import('../secrets.js');
const { credentialStamp } = await import('../auth/passwords.js');

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DOC_NAME = /\.(md|ya?ml|example|env)$/i;
const DOC_PLACE = /^(?:[^/]+|docs\/.+|changes\/.+)$/; // the root's own files, docs/, changes/

/** The docs, samples and examples git tracks under `root`. */
function docFiles(root) {
  return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter((f) => f && DOC_PLACE.test(f) && DOC_NAME.test(f) && existsSync(join(root, f)));
}

// The value after `DASH_SECRET=` or a YAML `DASH_SECRET:`: quoted (its
// content), or up to a space (for `=`, a quote or backtick too).
const ASSIGNMENT = /\bDASH_SECRET=(?:"([^"\n]*)"|'([^'\n]*)'|([^\s"'`]*))/g;
const YAML_KEY = /^([ \t]*)(?:-[ \t]*)?DASH_SECRET:(?:[ \t]+(?:"([^"\n]*)"|'([^'\n]*)'|([^\s#"']\S*)))?/gm;
const DEFAULT = /\$\{DASH_SECRET:?-([^}]*)\}/g; // `${DASH_SECRET:-x}`, `${DASH_SECRET-x}`
const BLOCK = /^[|>](?:[1-9]?[+-]?|[+-]?[1-9]?)$/; // a YAML block scalar's indicator

/** The value a raw one stands for: an interpolation's default, or null when there is none. */
function candidate(raw) {
  if (!raw) return null;
  const withDefault = /^\$\{\w+:?-([^}]*)\}$/.exec(raw);
  const value = withDefault ? withDefault[1] : raw;
  return value && !value.startsWith('$') ? value : null;
}

/** A YAML block scalar's text: the lines after line `at` indented past `indent`, joined. */
function blockText(lines, at, indent, folded) {
  const out = [];
  for (let i = at + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() && l.match(/^[ \t]*/)[0].length <= indent) break;
    out.push(l.trim());
  }
  return out.join(folded ? ' ' : '\n').trim();
}

/** Every DASH_SECRET value the tracked docs under `root` print, with where. */
function documentedValues(root) {
  const found = new Map();
  const add = (file, text, index, raw) => {
    const value = candidate(raw);
    if (value === null) return;
    const where = `${file}:${text.slice(0, index).split('\n').length}`;
    found.set(`${where}\0${value}`, { where, value });
  };
  for (const file of docFiles(root)) {
    const text = readFileSync(join(root, file), 'utf8');
    const lines = text.split('\n');
    for (const m of text.matchAll(ASSIGNMENT)) add(file, text, m.index, m[1] ?? m[2] ?? m[3]);
    for (const m of text.matchAll(DEFAULT)) add(file, text, m.index, m[1]);
    for (const m of text.matchAll(YAML_KEY)) {
      let raw = m[2] ?? m[3] ?? m[4];
      if (m[4] && BLOCK.test(m[4])) {
        const at = text.slice(0, m.index).split('\n').length - 1;
        raw = blockText(lines, at, m[1].length, m[4][0] === '>');
      }
      add(file, text, m.index, raw);
    }
  }
  return [...found.values()];
}

const DOCUMENTED = documentedValues(ROOT);
// What the secrets manager and the stamp are tried with: each value the docs
// print and each in the list, once, named by where it is, never by the value.
const seen = new Set();
const TRIED = [
  ...DOCUMENTED,
  ...EXAMPLE_SECRETS.map((value, i) => ({ where: `EXAMPLE_SECRETS[${i}]`, value })),
].filter(({ value }) => !seen.has(value) && seen.add(value));

/** Every line the logger writes while `fn` runs; anything else passes through. */
function captureLogs(fn) {
  const lines = [];
  const orig = { out: process.stdout.write, err: process.stderr.write };
  const tap = (write) =>
    function (chunk, ...rest) {
      try {
        const obj = JSON.parse(String(chunk));
        if (obj && obj.module && obj.level) {
          lines.push(obj);
          return true;
        }
      } catch {
        // not one of ours
      }
      return write.call(this, chunk, ...rest);
    };
  process.stdout.write = tap(orig.out);
  process.stderr.write = tap(orig.err);
  try {
    fn();
  } finally {
    process.stdout.write = orig.out;
    process.stderr.write = orig.err;
  }
  return lines;
}

/** A git repo holding `tracked` (path → text) in its index, and `untracked` beside it. */
function fixtureRepo(t, tracked, untracked = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'jh-576-docs-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  for (const [files, add] of [
    [tracked, true],
    [untracked, false],
  ]) {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(dir, path, '..'), { recursive: true });
      writeFileSync(join(dir, path), text);
      if (add) execFileSync('git', ['add', '--', path], { cwd: dir });
    }
  }
  return dir;
}

test('the scan reads only what git tracks: a local .env is never read', (t) => {
  const dir = fixtureRepo(
    t,
    { 'README.md': '```env\nDASH_SECRET=tracked-example-576\n```\n' },
    {
      '.env': 'DASH_SECRET=untracked-real-secret-576\n',
      'docs/local.md': 'DASH_SECRET=untracked-doc-576\n',
    }
  );
  assert.deepEqual(documentedValues(dir), [{ where: 'README.md:2', value: 'tracked-example-576' }]);
});

test("the scan reads a compose default, a YAML block's lines and a quoted value, and skips interpolations", (t) => {
  const dir = fixtureRepo(t, {
    'compose.yaml': [
      'services:',
      '  a:',
      '    environment:',
      '      - DASH_SECRET=${DASH_SECRET:-default-colon-576}',
      '      DASH_SECRET: ${DASH_SECRET-default-plain-576}',
      '      DASH_SECRET: >-',
      '        folded-576',
      '      DASH_SECRET: |',
      '        literal-576',
      '      OTHER: x',
      '      DASH_SECRET: "quoted-576"',
      '      DASH_SECRET: ${DASH_SECRET}',
      '      DASH_SECRET: ${DASH_SECRET:?set DASH_SECRET}',
      "      - DASH_SECRET='single-576'",
      '',
    ].join('\n'),
    'docs/run.md': 'docker run -e DASH_SECRET=$(openssl rand -hex 32) and `DASH_SECRET=inline-576`\n',
  });
  assert.deepEqual(
    documentedValues(dir)
      .map(({ where, value }) => `${where} ${value}`)
      .sort(),
    [
      'compose.yaml:11 quoted-576',
      'compose.yaml:14 single-576',
      'compose.yaml:4 default-colon-576',
      'compose.yaml:5 default-plain-576',
      'compose.yaml:6 folded-576',
      'compose.yaml:8 literal-576',
      'docs/run.md:1 inline-576',
    ]
  );
});

test('the scan finds the example in README, GET-STARTED and env.example', () => {
  const where = DOCUMENTED.map((d) => d.where);
  for (const file of ['README.md', 'docs/GET-STARTED.md', 'env.example']) {
    assert.ok(
      where.some((w) => w.startsWith(`${file}:`)),
      `no DASH_SECRET=<value> found in ${file}; found at: ${where.join(', ')}`
    );
  }
});

test('every DASH_SECRET the docs print is in the shared list', () => {
  for (const { where, value } of DOCUMENTED) {
    assert.ok(
      isExampleSecret(value),
      `the DASH_SECRET at ${where} is not in EXAMPLE_SECRETS (server/util/exampleSecrets.js): add it`
    );
  }
});

test('the list matches in any case, with spaces or one pair of quotes around; nothing else matches', () => {
  assert.equal(isExampleSecret('  Paste-Your-Random-Secret-HERE\n'), true);
  assert.equal(isExampleSecret('CHANGEME'), true);
  assert.equal(isExampleSecret('"changeme"'), true, 'docker run --env-file passes quotes through');
  assert.equal(isExampleSecret(" 'Your-Random-Secret-Here' "), true);
  assert.equal(isExampleSecret('" changeme "'), true);
  assert.equal(isExampleSecret('"changeme\''), false, 'not a pair');
  assert.equal(isExampleSecret('"\'changeme\'"'), false, 'one pair only');
  assert.equal(isExampleSecret(crypto.randomBytes(32).toString('hex')), false);
  assert.equal(isExampleSecret('changeme-but-longer'), false);
  for (const v of [undefined, null, '', '""', 42, {}]) assert.equal(isExampleSecret(v), false, String(v));
});

test('the secrets manager logs a missing DASH_SECRET once, not at every read', () => {
  const lines = captureLogs(() => {
    assert.equal(getSecret('integration_576_token'), null);
    assert.equal(setSecret('integration_576_token', 'a-token'), false);
  });
  assert.deepEqual(
    lines.map(({ level, module, msg }) => ({ level, module, msg: msg.slice(0, 20) })),
    [{ level: 'warn', module: 'secrets', msg: 'DASH_SECRET not set ' }]
  );
});

test('the secrets manager refuses each as a key: it stores nothing and logs what to do, once', () => {
  for (const { where, value } of TRIED) {
    process.env.DASH_SECRET = value;
    let stored;
    let read;
    const lines = captureLogs(() => {
      stored = setSecret('integration_576_token', 'a-token');
      read = getSecret('integration_576_token');
    });
    assert.equal(stored, false, `the DASH_SECRET at ${where} was used as a key`);
    assert.equal(read, null, `the DASH_SECRET at ${where} read a secret`);
    assert.deepEqual(
      lines.map(({ level, module }) => ({ level, module })),
      [{ level: 'error', module: 'secrets' }],
      `one refusal line for the DASH_SECRET at ${where}`
    );
    assert.match(lines[0].msg, /^DASH_SECRET is an example value from the docs/);
    assert.match(lines[0].msg, /openssl rand -hex 32/);
  }
  assert.equal(existsSync(join(process.env.JAGHELM_DATA_DIR, 'secrets.json')), false);
});

test('the session stamp refuses each as a key: DASH_PASS is stamped with scrypt', () => {
  for (const { where, value } of TRIED) {
    process.env.DASH_SECRET = value;
    assert.ok(credentialStamp().startsWith('scrypt:'), `the DASH_SECRET at ${where} keyed the stamp`);
  }
  process.env.DASH_SECRET = crypto.randomBytes(32).toString('hex');
  assert.ok(credentialStamp().startsWith('hmac-sha256:'), 'a real secret keys the stamp');
});

test('one list: both callers import it, and no other server source spells an example', () => {
  const IMPORT = /import\s*\{[^}]*\bisExampleSecret\b[^}]*\}\s*from\s*'(?:\.\.?\/)+util\/exampleSecrets\.js'/;
  for (const file of ['server/secrets.js', 'server/auth/passwords.js']) {
    assert.ok(IMPORT.test(readFileSync(join(ROOT, file), 'utf8')), `${file} does not import isExampleSecret`);
  }
  // The examples long enough to pass as a key on length alone: a copy of one
  // in another source is a second list.
  const distinctive = TRIED.map((t) => t.value.toLowerCase()).filter((v) => v.length >= 16);
  assert.ok(distinctive.length >= 3, `only ${distinctive.length} examples of 16 characters or more`);
  const holders = [];
  const walk = (dir) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.(js|mjs|cjs)$/.test(e.name) && !/\.test\.(js|mjs|cjs)$/.test(e.name)) {
        const text = readFileSync(join(ROOT, rel), 'utf8').toLowerCase();
        if (distinctive.some((v) => text.includes(v))) holders.push(rel);
      }
    }
  };
  walk('server');
  assert.deepEqual(holders, ['server/util/exampleSecrets.js']);
});

// Last: the secrets manager keeps the first key it derives.
test('a DASH_SECRET not in the list is a key (the refusals above are the list, not a broken store)', () => {
  process.env.DASH_SECRET = crypto.randomBytes(32).toString('hex');
  assert.equal(setSecret('integration_576_token', 'a-token'), true);
});
