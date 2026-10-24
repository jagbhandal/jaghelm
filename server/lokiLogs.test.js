/** Recent errors from Loki (#672): the query, its escaping, the clean-up of a line, the cache and the failures. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LOG_LIMIT,
  LOG_LINE_MAX,
  cleanLine,
  createLogPeek,
  linesOf,
  logQuery,
  logqlString,
  resolveTarget,
} from './lokiLogs.js';

const CONFIG = { nodes: { pve: {}, nas: { prometheus_node: 'nas-label' } } };
const known = (node) => new Set(node === 'pve' ? ['grafana', 'db'] : []);
const resolve = (entity) => resolveTarget(entity, CONFIG, known);

const ns = (ms) => String(BigInt(ms) * 1_000_000n);
const reply = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const streams = (...pairs) => ({
  status: 'success',
  data: { resultType: 'streams', result: [{ stream: {}, values: pairs }] },
});

function peek(over = {}) {
  const asked = [];
  let clock = 1_800_000_000_000;
  const lines = over.lines ?? [[ns(clock - 1000), 'ERROR db down']];
  const peeker = createLogPeek({
    env: { LOKI_URL: 'http://loki.test:3100/' },
    now: () => clock,
    resolve,
    logger: { warn() {}, info() {} },
    fetcher: async (url, opts) => {
      asked.push({ url: new URL(url), opts });
      if (over.fail) throw over.fail;
      return over.response ?? reply(streams(...lines));
    },
    ...over.deps,
  });
  return { peeker, asked, tick: (ms) => (clock += ms) };
}

test('logqlString keeps a quote, backslash or newline inside the string', () => {
  assert.equal(logqlString('a"b\\c\nd'), '"a\\"b\\\\c\\nd"');
  assert.equal(logqlString('x\u0000y'), '"x\\u0000y"');
  const q = logQuery({ label: 'x",host=~".*', container: 'a"} or {job=~".+' });
  assert.equal(q.startsWith('{host="x\\",host=~\\".*",container_name="a\\"} or {job=~\\".+"} |~ "'), true);
  assert.equal((q.match(/(?<!\\)"/g) ?? []).length % 2, 0, 'every quote that opens is closed');
});

test('the query: host and container, the error-ish words, as a LogQL string', () => {
  assert.equal(
    logQuery({ label: 'pve', container: null }),
    String.raw`{host="pve"} |~ "(?i)\\b(error|err|warn|warning|fatal|panic|critical|crit)\\b"`
  );
  assert.match(logQuery({ label: 'pve', container: 'db' }), /^\{host="pve",container_name="db"\} \|~ /);
});

test('resolveTarget: the server\'s own names, 400 malformed, 404 unknown', () => {
  assert.deepEqual(resolve('pve'), { ok: true, node: 'pve', label: 'pve', container: null });
  assert.deepEqual(resolve('nas'), { ok: true, node: 'nas', label: 'nas-label', container: null });
  assert.deepEqual(resolve('pve/db'), { ok: true, node: 'pve', label: 'pve', container: 'db' });
  for (const bad of [undefined, '', '/db', 'pve/', 'a\nb', 'x'.repeat(201), ['pve']]) {
    assert.equal(resolve(bad).status, 400, String(bad));
  }
  assert.equal(resolve('pi9').status, 404);
  assert.equal(resolve('pve/nope').status, 404);
  assert.equal(resolve('nas/db').status, 404);
});

test('cleanLine strips terminal escapes and control characters', () => {
  assert.equal(cleanLine('\u001b[31mERROR\u001b[0m boom\u0007\u0000\r\nnext\ttab'), 'ERROR boom next tab');
  assert.equal(cleanLine('\u001b]0;title\u0007warn x'), 'warn x');
});

test('cleanLine redacts credentials however JagHelm or a service wrote them', () => {
  const secrets = [
    'GET /api/x?token=abc123def456 failed',
    'GET http://h/y?apikey=SECRET9 failed',
    'Authorization: Bearer eyJhbGciOi.payload.sig',
    'header authorization="Basic dXNlcjpwYXNz"',
    'sent Bearer abcdefghijklmnop',
    '{"level":"error","password":"hunter2hunter2"}',
    'api_key=sk-live-12345 rejected',
    'client_secret: s3cr3tvalue',
    'Cookie: session=abcdef',
  ];
  for (const line of secrets) {
    const out = cleanLine(line);
    assert.doesNotMatch(out, /abc123def456|SECRET9|eyJhbGciOi|dXNlcjpwYXNz|abcdefghijklmnop|hunter2|sk-live|s3cr3tvalue|session=abcdef/, line);
    assert.match(out, /redacted/, line);
  }
  assert.equal(cleanLine('error: authentication failed for user'), 'error: authentication failed for user');
});

test('cleanLine shows a JSON line as its level, module and message only', () => {
  const json = JSON.stringify({ level: 'error', module: 'push', msg: 'send failed', url: 'http://h/x', auth: 'zzz-secret' });
  assert.equal(cleanLine(json), 'error push: send failed');
  assert.equal(cleanLine('{"no":"msg"}'), '{"no":"msg"}');
  assert.equal(cleanLine('{broken json error'), '{broken json error');
});

test('cleanLine cuts a long line', () => {
  const out = cleanLine(`error ${'x'.repeat(5000)}`);
  assert.equal(out.length, LOG_LINE_MAX + 1);
  assert.equal(out.endsWith('…'), true);
});

test('linesOf: newest first across streams, at most 20, blanks dropped', () => {
  const result = [
    { values: Array.from({ length: 15 }, (_, i) => [ns(1000 + i * 2), `a${i}`]) },
    { values: Array.from({ length: 15 }, (_, i) => [ns(1001 + i * 2), `b${i}`]) },
    { values: [[ns(5), '   '], ['bad', 'x'], [ns(6), 7]] },
  ];
  const lines = linesOf(result);
  assert.equal(lines.length, LOG_LIMIT);
  assert.deepEqual(lines.map((l) => l.at), [...lines.map((l) => l.at)].sort((a, b) => b - a));
  assert.equal(lines[0].text, 'b14');
  assert.deepEqual(linesOf('nope'), []);
});

test('a container read: bounded query to Loki, lines cleaned', async () => {
  const { peeker, asked } = peek({
    lines: [
      [ns(1_799_999_990_000), 'ERROR \u001b[31mtoken=abc123def456\u001b[0m'],
      [ns(1_799_999_995_000), 'WARN slow'],
    ],
  });
  const { status, body } = await peeker.answer('pve/db');
  assert.equal(status, 200);
  assert.equal(body.state, 'ok');
  assert.deepEqual(body.lines.map((l) => l.text), ['WARN slow', 'ERROR token=[redacted]']);
  const { url, opts } = asked[0];
  assert.equal(url.origin + url.pathname, 'http://loki.test:3100/loki/api/v1/query_range');
  assert.equal(url.searchParams.get('limit'), '20');
  assert.equal(url.searchParams.get('direction'), 'backward');
  assert.equal(BigInt(url.searchParams.get('end')) - BigInt(url.searchParams.get('start')), 6n * 3600n * 1_000_000_000n);
  assert.match(url.searchParams.get('query'), /^\{host="pve",container_name="db"\}/);
  assert.equal(opts.timeoutMs, 4000);
});

test('a node read asks for the host only, by its Prometheus label', async () => {
  const { peeker, asked } = peek();
  await peeker.answer('nas');
  assert.match(asked[0].url.searchParams.get('query'), /^\{host="nas-label"\} \|~/);
});

test('answers are kept 30 s, and reads of one being asked share the query', async () => {
  const { peeker, asked, tick } = peek();
  const [a, b] = await Promise.all([peeker.answer('pve/db'), peeker.answer('pve/db')]);
  assert.deepEqual(a, b);
  await peeker.answer('pve/db');
  assert.equal(asked.length, 1);
  tick(29_000);
  await peeker.answer('pve/db');
  assert.equal(asked.length, 1);
  tick(2_000);
  await peeker.answer('pve/db');
  assert.equal(asked.length, 2);
  await peeker.answer('pve/grafana');
  assert.equal(asked.length, 3, 'another container is its own query');
});

test('nothing in 6 hours, or nothing received, is `none`', async () => {
  const { peeker } = peek({ lines: [] });
  assert.deepEqual((await peeker.answer('pve')).body, { state: 'none', lines: [] });
});

test('an unknown node or container asks Loki nothing', async () => {
  const { peeker, asked } = peek();
  assert.equal((await peeker.answer('pve/nope')).status, 404);
  assert.equal((await peeker.answer('nope')).status, 404);
  assert.equal(asked.length, 0);
});

test('Loki unset, refused for a credential, down or refusing: unavailable, in fixed words', async () => {
  const cases = [
    [{ deps: { env: {} } }, 'No Loki is set up'],
    [{ deps: { env: { LOKI_URL: 'http://u:p@loki.test' } } }, 'Loki is off: its URL is refused'],
    [{ fail: Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }) }, 'Loki refused the connection'],
    [{ response: reply({ message: 'boom 10.0.0.9' }, 500) }, 'Loki answered with an error (HTTP 500)'],
    [{ response: new Response('<html>', { status: 200 }) }, "Loki's answer couldn't be read"],
    [{ response: reply({ status: 'error', error: 'parse error at 10.0.0.9' }) }, "Loki's answer couldn't be read"],
  ];
  for (const [over, reason] of cases) {
    const { peeker } = peek(over);
    const { status, body } = await peeker.answer('pve');
    assert.equal(status, 200);
    assert.deepEqual(body, { state: 'unavailable', lines: [], reason });
  }
});

test('a failed read is kept 10 s, then asked again', async () => {
  const { peeker, asked, tick } = peek({ fail: new Error('fetch failed') });
  await peeker.answer('pve');
  tick(9_000);
  await peeker.answer('pve');
  assert.equal(asked.length, 1);
  tick(2_000);
  await peeker.answer('pve');
  assert.equal(asked.length, 2);
});
