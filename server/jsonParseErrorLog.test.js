/**
 * #504: a JSON file holding secrets that doesn't parse is logged without a
 * word of it.
 *
 * V8's JSON.parse error quotes the text around an unexpected token
 * (`Unexpected token 'h', ..."key": Hunter2..." is not valid JSON`), and
 * secrets.json, auth.json and display-config.json each logged that error
 * whole. Now each logs the reason and position only (util/parseError.js).
 *
 * Its own file because auth.json is read when its module loads: every file is
 * written before the first import. The logger is the real one: its lines are
 * read where it writes them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';

process.env.DASH_SECRET = 'test-secret-at-least-16-chars-long'; // pragma: allowlist secret

const DIR = process.env.JAGHELM_DATA_DIR;
const SECRET = 'Hunter2Json'; // pragma: allowlist secret
// V8 quotes about ten characters past the bad token: its first seven are enough.
const QUOTED = SECRET.slice(0, 7);

/** A JSON file with the secret where a quote went missing. */
const brokenWith = (key) => `{\n  "${key}": ${SECRET}-value\n}\n`;

writeFileSync(join(DIR, 'auth.json'), brokenWith('passwordHash'));
writeFileSync(join(DIR, 'secrets.json'), brokenWith('npm_password'));
writeFileSync(join(DIR, 'display-config.json'), brokenWith('apiKey'));

/**
 * Every line the logger writes while `fn` runs. Anything else on stdout or
 * stderr (the test runner's own output) passes through.
 */
async function captureLogs(fn) {
  const lines = [];
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  const tap = (orig) =>
    function (chunk, ...rest) {
      const text = String(chunk);
      try {
        const obj = JSON.parse(text);
        if (obj && obj.module && obj.level) {
          lines.push({ text, obj });
          return true;
        }
      } catch {
        // not one of ours
      }
      return orig.call(this, chunk, ...rest);
    };
  process.stdout.write = tap(origOut);
  process.stderr.write = tap(origErr);
  try {
    await fn();
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
  return lines;
}

/** One line from `module` says `msg` with the reason and position; no line quotes the file. */
function assertLogged(lines, module, msg, parseError) {
  for (const { text } of lines)
    assert.ok(!text.includes(QUOTED), `a log line quotes the file: ${text}`);
  const line = lines.find((l) => l.obj.module === module && l.obj.msg === msg);
  assert.ok(line, `no "${msg}" from ${module} in ${lines.map((l) => l.text).join('')}`);
  assert.deepEqual(line.obj.parseError, parseError);
  assert.equal(line.obj.err, undefined, 'the raw error is logged');
}

const UNEXPECTED = { reason: 'Unexpected token', line: null, column: null };

test('auth.json that does not parse: logged with its reason, not its text', async () => {
  const lines = await captureLogs(() => import('./auth/passwords.js'));
  assertLogged(lines, 'auth', 'Failed to load auth override', UNEXPECTED);
});

test('secrets.json that does not parse: logged with its reason and position, not its text', async () => {
  const { initSecrets } = await import('./secrets.js');
  let lines = await captureLogs(() => initSecrets());
  assertLogged(lines, 'secrets', 'Failed to load secrets.json', UNEXPECTED);

  // A missing comma: V8 gives the line and column.
  writeFileSync(join(DIR, 'secrets.json'), `{\n  "a": "${SECRET}"\n  "b": "x"\n}\n`);
  lines = await captureLogs(() => initSecrets());
  assertLogged(lines, 'secrets', 'Failed to load secrets.json', {
    reason: "Expected ',' or '}' after property value",
    line: 3,
    column: 3,
  });
});

test('display-config.json that does not parse: logged with its reason, not its text, and answered as a 503 saying so (#547)', async () => {
  const { displayConfigRoutes } = await import('./routes/displayConfig.js');
  const app = express().use('/api/display-config', displayConfigRoutes);
  let r;
  const lines = await captureLogs(async () => {
    r = await request(app).get('/api/display-config');
  });
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'config_unparseable');
  assert.ok(!r.text.includes(QUOTED));
  assertLogged(lines, 'display-config', 'Failed to read', UNEXPECTED);
});

test('display-config.json that does not parse: the refresh loop logs its reason, not its text', async () => {
  const { readDisplayConfig } = await import('./refresh.js');
  // A new file, so the loop reads it again rather than its cached answer.
  writeFileSync(join(DIR, 'display-config.json'), `{\n  "apiKey": ${SECRET}-other\n}\n`);
  let read;
  const lines = await captureLogs(() => {
    read = readDisplayConfig();
  });
  assert.equal(read, null);
  assertLogged(
    lines,
    'refresh',
    'display-config.json is unreadable; using the default refresh interval and push thresholds',
    UNEXPECTED
  );
});
