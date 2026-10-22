/**
 * #504: a services.yaml that doesn't parse is logged and answered without a
 * word of the file.
 *
 * The warning #463 logs took js-yaml's error whole, and its message shows the
 * lines around the bad one: a plaintext credential near it (a legacy file, a
 * hand edit) went to the log, and from there to Loki. js-yaml also names an
 * unquoted value starting with * or ! in its reason (an alias, a tag). Now the
 * log line and the 503 carry the reason and the position only.
 *
 * Its own file because the module's state is the point: the first test runs
 * against a fresh module, as at boot, with no good config to keep. The logger
 * is the real one: its lines are read where it writes them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';

process.env.DASH_SECRET = 'test-secret-at-least-16-chars-long'; // pragma: allowlist secret

const { loadConfig, readConfig } = await import('./config.js');
const { initSecrets } = await import('./secrets.js');
const { servicesRoutes } = await import('./routes/services.js');
const { integrationRoutes } = await import('./routes/integrations.js');
const { initRegistry } = await import('./integrations/registry.js');

initSecrets();
await initRegistry();

const CONFIG_PATH = join(process.env.JAGHELM_DATA_DIR, 'services.yaml');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/api/services', servicesRoutes);
app.use('/api/integrations', integrationRoutes);

const SECRET = 'Hunter2Plain'; // pragma: allowlist secret

/** services.yaml with a credential on the lines around line 8, and `badLine` there. */
const withBadLine = (badLine) =>
  [
    'nodes:',
    '  pi1:',
    '    display_name: Gateway',
    'integrations:',
    '  npm:',
    '    url: http://npm.example.test',
    `    username: ${SECRET}-above`,
    badLine,
    `    token: ${SECRET}-below`,
    '',
  ].join('\n');

const GOOD = withBadLine(`    password: ${SECRET}-on-the-line`);

// Each with the secret on the bad line, and the reason and position it gives.
const BROKEN = {
  'an indentation slip': {
    text: withBadLine(`   password: ${SECRET}-on-the-line`),
    reason: 'bad indentation of a mapping entry',
    line: 8,
    column: 4,
  },
  'a password read as an alias': {
    text: withBadLine(`    password: *${SECRET}-alias`),
    reason: 'unidentified alias "…"',
    line: 8,
    column: 34,
  },
  'a password read as a tag': {
    text: withBadLine(`    password: !${SECRET}-tag`),
    reason: 'unknown tag !<…>',
    line: 9,
    column: 5,
  },
};

const refusalFor = ({ reason, line, column }) =>
  `services.yaml doesn't parse (${reason} at line ${line}, column ${column}): ` +
  "fix it by hand; JagHelm won't save over it";

/**
 * Every line the logger writes while `fn` runs, as written. Anything else on
 * stdout or stderr (the test runner's own output) passes through.
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

/** Every route that reads or writes services.yaml, as a browser sends it. */
const ROUTES = {
  'the config read': () => request(app).get('/api/services/config'),
  'a Settings save': () =>
    request(app)
      .post('/api/services/config')
      .set('If-Match', '"any-version"')
      .send({ nodes: {}, services: {}, integrations: {} }),
  'adding an integration': () =>
    request(app).post('/api/integrations/save').send({
      type: 'adguard',
      url: 'http://adguard.example.test',
      password: 'typed-in-the-form', // pragma: allowlist secret
      create: true,
    }),
  'an integration disabled': () =>
    request(app).patch('/api/integrations/npm').send({ enabled: false }),
};

/** The answers of every route, each refused naming the reason and the position. */
async function assertRoutesRefuse(t, want) {
  for (const [name, send] of Object.entries(ROUTES)) {
    await t.test(name, async () => {
      const r = await send();
      assert.equal(r.status, 503, r.text);
      assert.deepEqual(r.body, { error: refusalFor(want), code: 'config_unparseable' });
      assert.ok(!r.text.includes(SECRET), `the answer quotes the file: ${r.text}`);
    });
  }
}

/** The config module's warn and error lines name the reason and position; no line quotes the file. */
function assertLogged(lines, want, level) {
  for (const { text } of lines)
    assert.ok(!text.includes(SECRET), `a log line quotes the file: ${text}`);
  const failed = lines.filter((l) => l.obj.module === 'config' && l.obj.level === level);
  assert.ok(failed.length > 0, `no ${level} from config in ${lines.map((l) => l.text).join('')}`);
  for (const { obj } of failed) {
    assert.deepEqual(obj.parseError, { reason: want.reason, line: want.line, column: want.column });
    assert.ok(
      obj.msg.includes(`${want.reason} at line ${want.line}, column ${want.column}`),
      obj.msg
    );
    assert.equal(obj.err, undefined, 'the raw error is logged');
  }
}

test('at boot, with nothing to keep: the error line and every answer name the line and reason, never the file', async (t) => {
  const want = BROKEN['an indentation slip'];
  writeFileSync(CONFIG_PATH, want.text);
  const lines = await captureLogs(async () => {
    assert.deepEqual(loadConfig(), {});
  });
  assertLogged(lines, want, 'error');
  const failed = lines.find((l) => l.obj.module === 'config' && l.obj.level === 'error');
  assert.match(failed.obj.msg, /starting with an empty board/);

  const answered = await captureLogs(() => assertRoutesRefuse(t, want));
  for (const { text } of answered) assert.ok(!text.includes(SECRET), text);
});

test('after a good config: a hand edit read first by a route, then by the watcher, never logs the file', async (t) => {
  for (const [name, want] of Object.entries(BROKEN)) {
    await t.test(name, async (tt) => {
      writeFileSync(CONFIG_PATH, GOOD);
      loadConfig();
      writeFileSync(CONFIG_PATH, want.text);
      const lines = await captureLogs(async () => {
        // A route reads the hand edit before the watcher has (readConfig).
        await assertRoutesRefuse(tt, want);
        // Then the watcher's reload.
        loadConfig();
      });
      assertLogged(lines, want, 'warn');
      assert.ok(
        lines.some((l) => /keeping the previous config/.test(l.obj.msg)),
        'the warning that keeps the last good config'
      );
      // What readConfig answers for Settings is the same refusal.
      assert.equal(readConfig().unusable, refusalFor(want));
    });
  }
});
