/**
 * #505: a services.yaml that doesn't parse at boot is on the board, in a push
 * and in /api/health, not an empty board with a green header.
 *
 * JagHelm boots on a broken file with no config (#463), so the board had
 * nothing on it and /api/health said nothing. Now the config is a source: the
 * status model has it down, with the line, the header's sentence and the
 * attention panel say so, it pages once through the source_down path after
 * its 2 cycles and once more when the file is fixed, and /api/health has
 * `config: { state: 'unparseable', line }` while `status` stays `ok`, as for
 * the status check (#440), so the deploy gate doesn't flap. None of it quotes
 * the file (#504): a credential on the bad line is in no status, push, health
 * body, snapshot file or log line.
 *
 * Its own file because the module's state is the point: it boots on the
 * broken file, as index.js does, through the loop's real wiring.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-config-broken-'));
process.env.JAGHELM_DATA_DIR = dataDir;
process.env.LOG_LEVEL = 'debug';
const creds = join(dataDir, 'sa.json');
writeFileSync(creds, JSON.stringify({ project_id: 'test' }));

const fcm = await import('./push/fcm.js');
const { getCached, setCache } = await import('./cache.js');
const { getPushStore } = await import('./push/store.js');
const { loadConfig } = await import('./config.js');
const { noNodesCacheEntry, runStatusAndPush, stopBackgroundRefresh } = await import('./refresh.js');
const { systemRoutes } = await import('./routes/system.js');

const app = express();
app.use('/api', systemRoutes);

after(() => {
  stopBackgroundRefresh();
  rmSync(dataDir, { recursive: true, force: true });
});

// Push is up, with one phone registered; what FCM was asked to send.
const sent = [];
fcm.initPush({
  credsPath: creds,
  env: {},
  messagingFactory: () => ({
    send: async (msg) => sent.push({ data: msg.data, notification: msg.notification }),
  }),
  logger: { info() {}, warn() {} },
});
getPushStore().registerToken('phone', { platform: 'android', appVersion: '1.2.0' });

// The structured logger's JSON lines (their raw text) written while `fn` runs.
async function captureLogs(fn) {
  const lines = [];
  const orig = { out: process.stdout.write, err: process.stderr.write };
  const tap = (write) =>
    function (chunk, ...rest) {
      const text = String(chunk);
      try {
        if (JSON.parse(text)?.module) {
          lines.push(text);
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
    await fn();
  } finally {
    process.stdout.write = orig.out;
    process.stderr.write = orig.err;
  }
  return lines;
}

const SECRET = 'Hunter2Plain'; // pragma: allowlist secret
const CONFIG_PATH = join(dataDir, 'services.yaml');

/** services.yaml with a credential around line 8, and `badLine` there. */
const withLine8 = (badLine) =>
  [
    'nodes: {}',
    'services: {}',
    'integrations:',
    '  npm:',
    '    url: http://npm.example.test',
    `    username: ${SECRET}-above`,
    '    enabled: true',
    badLine,
    `    token: ${SECRET}-below`,
    '',
  ].join('\n');

// One indentation slip on line 8, the credential on it.
const BROKEN = withLine8(`   password: ${SECRET}-on-the-line`);
const FIXED = withLine8(`    password: ${SECRET}-on-the-line`);

/**
 * What the refreshes cache with no nodes in the config JagHelm holds (`{}` at
 * boot on a broken file): the services refresh's own entry for no nodes, its
 * probe answered (#449), no UPS and no integrations.
 */
function refreshedWithNoNodes() {
  const { payload, internal } = noNodesCacheEntry({ prometheusOk: true });
  setCache('services', payload, internal);
  setCache('ups', { status: null, charge: null, runtime: null, load: null, ok: true, configured: false, model: null });
  setCache('integrations', {});
}

const snapshotFile = join(dataDir, 'push-snapshot.json');
const pushed = (from) => sent.slice(from).map((m) => `${m.data.type} ${m.data.id}`);
const T0 = Date.UTC(2026, 9, 22, 12, 0, 0);
const CYCLE = 30_000;

test('boot on a broken services.yaml: the config source is down with its line, health says so, one page; fixed: one recovery; the file is quoted nowhere', async () => {
  writeFileSync(CONFIG_PATH, BROKEN);
  const logs = await captureLogs(async () => {
    // As index.js boots: the file is present, so no discovery; the board starts empty.
    assert.deepEqual(loadConfig(), {});

    // The first cycle: the board says the config is broken, not "Nothing monitored yet".
    refreshedWithNoNodes();
    await runStatusAndPush([], T0);
    const status = getCached('status');
    assert.deepEqual(status.sources.config, {
      state: 'failed',
      error: "services.yaml doesn't parse (line 8)",
      since: T0,
    });
    const issue = status.issues.find((i) => i.id === 'sources/config');
    assert.deepEqual(issue, {
      id: 'sources/config',
      kind: 'source',
      subsystem: 'sources',
      name: 'JagHelm config',
      state: 'warn',
      word: 'Failed',
      reason: "services.yaml doesn't parse (line 8)",
      since: T0,
    });
    assert.deepEqual(status.overall, {
      state: 'warn',
      sentence: "services.yaml doesn't parse (line 8)",
    });
    assert.deepEqual(pushed(0), [], 'one failed cycle sends nothing');

    // /api/health: the config's state and line beside the model's; `status` stays ok.
    const res = await request(app).get('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok', 'the deploy gate is not tripped');
    assert.deepEqual(res.body.config, { state: 'unparseable', line: 8 });
    assert.deepEqual(res.body.statusModel, { state: 'ok' });
    assert.doesNotMatch(res.text, new RegExp(SECRET));

    // The second cycle pages once, the third sends nothing more.
    await runStatusAndPush([], T0 + CYCLE);
    await runStatusAndPush([], T0 + 2 * CYCLE);
    assert.deepEqual(pushed(0), ['source_down config']);
    assert.deepEqual(sent[0].data, { type: 'source_down', id: 'config', node: 'config', severity: 'warning' });
    assert.deepEqual(sent[0].notification, {
      title: 'JagHelm config broken',
      body: "JagHelm config · services.yaml doesn't parse (line 8)",
    });
    assert.equal(JSON.parse(readFileSync(snapshotFile, 'utf8')).sources.config, 'down');

    // Fixed by hand: the watcher's reload (loadConfig) loads it.
    writeFileSync(CONFIG_PATH, FIXED);
    loadConfig();
    assert.deepEqual((await request(app).get('/api/health')).body.config, { state: 'ok' });
    await runStatusAndPush([], T0 + 3 * CYCLE);
    await runStatusAndPush([], T0 + 4 * CYCLE);
    assert.deepEqual(pushed(1), ['source_recovered config'], 'one recovery, then nothing');
    assert.deepEqual(sent[1].notification, {
      title: 'JagHelm config fixed',
      body: 'services.yaml loads again',
    });
    const back = getCached('status');
    assert.equal(back.sources.config, undefined, 'a good file lists no config source');
    assert.deepEqual(back.issues, []);
    assert.equal(back.overall.state, 'empty', 'the empty board is calm again (#449)');
    assert.equal(JSON.parse(readFileSync(snapshotFile, 'utf8')).sources.config, undefined);
  });

  // Never the file's text: not in the model, the pushes, the snapshot or the log.
  const everywhere = [
    JSON.stringify(getCached('status')),
    JSON.stringify(sent),
    readFileSync(snapshotFile, 'utf8'),
    ...logs,
  ].join('\n');
  assert.ok(logs.length > 0, 'the logger was heard');
  assert.doesNotMatch(everywhere, new RegExp(SECRET));
});

test('broken by a later edit (a reload, not a boot): health and the board say so, one page, one recovery', async () => {
  const before = sent.length;
  writeFileSync(CONFIG_PATH, withLine8('    password: [unclosed'));
  loadConfig();
  const health = (await request(app).get('/api/health')).body;
  assert.equal(health.status, 'ok');
  assert.equal(health.config.state, 'unparseable');
  assert.equal(typeof health.config.line, 'number');
  refreshedWithNoNodes();
  await runStatusAndPush([], T0 + 10 * CYCLE);
  await runStatusAndPush([], T0 + 11 * CYCLE);
  await runStatusAndPush([], T0 + 12 * CYCLE);
  assert.deepEqual(pushed(before), ['source_down config']);
  assert.match(getCached('status').overall.sentence, /^services\.yaml doesn't parse \(line \d+\)$/);
  writeFileSync(CONFIG_PATH, FIXED);
  loadConfig();
  await runStatusAndPush([], T0 + 13 * CYCLE);
  assert.deepEqual(pushed(before), ['source_down config', 'source_recovered config']);
});
