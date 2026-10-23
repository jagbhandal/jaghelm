/**
 * #576: every DASH_SECRET value the docs print is refused as a key, by the
 * secrets manager and by the session stamp, from one list.
 *
 * The test reads the docs: each `DASH_SECRET=<value>` (an .env line, a compose
 * list item, `-e`) and each `DASH_SECRET: <value>` YAML key in the files at the
 * repo root (README, env.example, compose.yaml, ...) and under docs/ and
 * changes/. A doc that prints a new example without adding it to
 * EXAMPLE_SECRETS fails here. A blank value is "not set", and a `$` value is an
 * interpolation or a command (`$(openssl rand -hex 32)`), not an example.
 *
 * The secrets manager caches the first key it derives, so the one value it is
 * meant to accept is tried last.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DASH_PASS = 'stamp-test-password'; // pragma: allowlist secret
delete process.env.DASH_SECRET;

const { EXAMPLE_SECRETS, isExampleSecret } = await import('./exampleSecrets.js');
const { setSecret } = await import('../secrets.js');
const { credentialStamp } = await import('../auth/passwords.js');

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DOC_NAME = /\.(md|ya?ml|example|env)$/i;

/** The docs, samples and examples: the root's own files, and docs/ and changes/ whole. */
function docFiles() {
  const files = readdirSync(ROOT, { withFileTypes: true })
    .filter((e) => e.isFile() && DOC_NAME.test(e.name))
    .map((e) => e.name);
  const walk = (dir) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (DOC_NAME.test(e.name)) files.push(rel);
    }
  };
  walk('docs');
  walk('changes');
  return files;
}

const ASSIGNMENTS = [
  /\bDASH_SECRET=["']?([^\s"'`]*)/g, // .env line, compose list item, `-e`, inline code
  /^[ \t]*(?:-[ \t]*)?DASH_SECRET:[ \t]*["']?([^\s"'`#]*)/gm, // a YAML key
];

/** Every DASH_SECRET value the docs print, with where. */
function documentedValues() {
  const found = [];
  for (const file of docFiles()) {
    const text = readFileSync(join(ROOT, file), 'utf8');
    for (const re of ASSIGNMENTS) {
      for (const m of text.matchAll(re)) {
        const value = m[1];
        if (!value || value.startsWith('$')) continue;
        const line = text.slice(0, m.index).split('\n').length;
        found.push({ where: `${file}:${line}`, value });
      }
    }
  }
  return found;
}

const DOCUMENTED = documentedValues();
const VALUES = [...new Set([...DOCUMENTED.map((d) => d.value), ...EXAMPLE_SECRETS])];

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

test('the scan finds the example in README, GET-STARTED and env.example', () => {
  for (const file of ['README.md', 'docs/GET-STARTED.md', 'env.example']) {
    assert.ok(
      DOCUMENTED.some((d) => d.where.startsWith(`${file}:`)),
      `no DASH_SECRET=<value> found in ${file}; found: ${JSON.stringify(DOCUMENTED)}`
    );
  }
});

test('every DASH_SECRET the docs print is in the shared list', () => {
  for (const { where, value } of DOCUMENTED) {
    assert.ok(isExampleSecret(value), `${where} prints DASH_SECRET=${value}: add it to EXAMPLE_SECRETS (server/util/exampleSecrets.js)`);
  }
});

test('the list matches in any case, with spaces around; nothing else matches', () => {
  assert.equal(isExampleSecret('  Paste-Your-Random-Secret-HERE\n'), true);
  assert.equal(isExampleSecret('CHANGEME'), true);
  assert.equal(isExampleSecret(crypto.randomBytes(32).toString('hex')), false);
  assert.equal(isExampleSecret('changeme-but-longer'), false);
  for (const v of [undefined, null, '', 42, {}]) assert.equal(isExampleSecret(v), false, String(v));
});

test('the secrets manager refuses each as a key: it stores nothing and logs what to do', () => {
  for (const value of VALUES) {
    process.env.DASH_SECRET = value;
    let stored;
    const lines = captureLogs(() => {
      stored = setSecret('integration_576_token', 'a-token');
    });
    assert.equal(stored, false, `DASH_SECRET=${value} was used as a key`);
    assert.deepEqual(
      lines.map(({ level, module }) => ({ level, module })),
      [{ level: 'error', module: 'secrets' }],
      value
    );
    assert.match(lines[0].msg, /DASH_SECRET is an example value from the docs/);
    assert.match(lines[0].msg, /openssl rand -hex 32/);
  }
  assert.equal(existsSync(join(process.env.JAGHELM_DATA_DIR, 'secrets.json')), false);
});

test('the session stamp refuses each as a key: DASH_PASS is stamped with scrypt', () => {
  for (const value of VALUES) {
    process.env.DASH_SECRET = value;
    assert.match(credentialStamp(), /^scrypt:/, `DASH_SECRET=${value} keyed the stamp`);
  }
  process.env.DASH_SECRET = crypto.randomBytes(32).toString('hex');
  assert.match(credentialStamp(), /^hmac-sha256:/, 'a real secret keys the stamp');
});

test('one list: both callers import it, and no other server source spells an example', () => {
  const IMPORT = /import\s*\{[^}]*\bisExampleSecret\b[^}]*\}\s*from\s*'(?:\.\.?\/)+util\/exampleSecrets\.js'/;
  for (const file of ['server/secrets.js', 'server/auth/passwords.js']) {
    assert.ok(IMPORT.test(readFileSync(join(ROOT, file), 'utf8')), `${file} does not import isExampleSecret`);
  }
  // The examples long enough to pass as a key on length alone: a copy of one
  // in another source is a second list.
  const distinctive = VALUES.filter((v) => v.length >= 16);
  assert.ok(distinctive.length >= 3, JSON.stringify(distinctive));
  const holders = [];
  const walk = (dir) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.(js|mjs|cjs)$/.test(e.name) && !/\.test\.(js|mjs|cjs)$/.test(e.name)) {
        const text = readFileSync(join(ROOT, rel), 'utf8').toLowerCase();
        if (distinctive.some((v) => text.includes(v.toLowerCase()))) holders.push(rel);
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
