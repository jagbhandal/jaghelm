/** Recent errors from Loki (#672): the query, its escaping, the clean-up of a line, the cache and the failures. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LOG_LIMIT,
  LOG_LINE_MAX,
  cleanLine,
  createLogPeek,
  levelOf,
  linesOf,
  logQuery,
  lokiHostOf,
  logqlString,
  resolveTarget,
} from './lokiLogs.js';

const CONFIG = {
  nodes: {
    pve: {},
    nas: { prometheus_node: 'nas-label' },
    vm103: { prometheus_node: 'vm103', loki_host: 'vm-103' },
    odd: { loki_host: 'a"b' },
    ghost: { visible: false },
  },
};
const known = (node) => new Set(node === 'pve' ? ['netdata', 'db'] : []);
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
  assert.deepEqual(resolve('nas'), { ok: true, node: 'nas', label: 'nas', container: null });
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

const R = 'x'.repeat(30);
// [name, line, the secret that must be gone]
const SECRET_CASES = [
  ['pass= outside a query', 'login failed pass=hunter22 for admin', 'hunter22'],
  ['pwd=', 'db connect pwd=Sup3rS3cret ok', 'Sup3rS3cret'],
  ['password= with a quoted space', 'cfg {"password":"correct horse battery"} bad', 'horse'], // pragma: allowlist secret
  ['password: yaml style', 'password: letmein99 rejected', 'letmein99'],
  ['DB_PASS env', 'env DB_PASS=prodpass123 set', 'prodpass123'],
  ['SMTP_PASSWORD env', 'SMTP_PASSWORD="mail pass 1" loaded', 'mail pass'],
  ['AWS_SECRET env', 'AWS_SECRET=abcDEF123456 used', 'abcDEF123456'],
  ['GH_TOKEN env', 'GH_TOKEN=tok_abcdef12345 used', 'tok_abcdef12345'],
  ['STRIPE_KEY env', 'STRIPE_KEY=pk_live_zzzz1234 used', 'pk_live_zzzz1234'],
  ['bare JWT', 'session eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJl end', 'eyJzdWIiOiIxMjM0In0'], // pragma: allowlist secret
  ['ghp_', 'clone with ghp_' + R + ' failed', R],
  ['gho_', 'oauth gho_' + R + ' failed', R],
  ['github_pat_', 'use github_pat_' + R + ' now', R],
  ['glpat-', 'gitlab glpat-' + R + ' now', R],
  ['sk-ant-', 'key sk-ant-api03-' + R + ' bad', R],
  ['sk-', 'key sk-' + R + ' bad', R],
  ['AKIA', 'aws AKIAIOSFODNN7EXAMPLE denied', 'AKIAIOSFODNN7EXAMPLE'], // pragma: allowlist secret
  ['Slack token', 'bot xoxb-1234567890-abcdefghij bad', 'abcdefghij'], // pragma: allowlist secret
  ['PEM block', 'key -----BEGIN ' + 'RSA PRIVATE KEY----- MIIEowIBAAKCAQEA0Z3 -----END ' + 'RSA PRIVATE KEY----- done', 'MIIEowIBAAKCAQEA0Z3'],
  ['PEM block, cut off', 'key -----BEGIN ' + 'PRIVATE KEY----- MIIEvQIBADANBg', 'MIIEvQIBADANBg'],
  ['Slack webhook', 'post https://hooks.slack.com/services/T000/B000/XXXXsecretXXXX failed', 'XXXXsecretXXXX'], // pragma: allowlist secret
  ['Discord webhook', 'post https://discord.com/api/webhooks/1234567890/abcTOKENdef-ghi failed', 'abcTOKENdef'],
  ['quoted x-auth-token header', '{"x-auth-token":"abc123tokenvalue","other":1}', 'abc123tokenvalue'], // pragma: allowlist secret
  ['quoted Authorization header', 'headers {"Authorization": "Bearer abcdefghijkl", "a": 1}', 'abcdefghijkl'],
  ['Cookie header', 'Cookie: sid=zzzsessionzzz', 'zzzsessionzzz'],
  ['?token= in a URL', 'GET /x?token=abc123def456 failed', 'abc123def456'],
  ['Bearer', 'sent Bearer abcdefghijklmnop', 'abcdefghijklmnop'],
];

test('cleanLine redacts every credential shape (table)', () => {
  for (const [name, line, secret] of SECRET_CASES) {
    const out = cleanLine(line);
    assert.equal(out.includes(secret), false, `${name}: ${out}`);
    assert.match(out, /redacted/, name);
  }
});

test('cleanLine leaves ordinary words alone', () => {
  for (const line of [
    'error: authentication failed for user',
    'cache key=users:42 miss',
    'WARN passing request to upstream',
    'ERROR connection reset by peer at 10.0.0.9:5432',
  ]) {
    assert.equal(cleanLine(line), line);
  }
});

test('cleanLine strips bidi and zero-width format characters (table)', () => {
  const cases = ['\u202a', '\u202b', '\u202c', '\u202d', '\u202e', '\u2066', '\u2067', '\u2068', '\u2069', '\u200b', '\u200c', '\u200d', '\u200e', '\u200f', '\u2060', '\ufeff'];
  for (const c of cases) {
    assert.equal(cleanLine('ERROR a' + c + 'b'), 'ERROR ab', c.codePointAt(0).toString(16));
  }
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

test('the host is the node\'s loki_host, else its key, never the Prometheus label; a bad loki_host is ignored; hidden nodes are 404', () => {
  assert.equal(resolve('vm103').label, 'vm-103');
  assert.equal(resolve('nas').label, 'nas');
  assert.equal(resolve('odd').label, 'odd');
  assert.equal(resolve('ghost').status, 404);
  assert.equal(resolve('ghost/db').status, 404);
  assert.equal(lokiHostOf('k', { loki_host: 'x" or {a=~".+' }), 'k');
  assert.equal(lokiHostOf('k', { loki_host: 7 }), 'k');
  assert.equal(lokiHostOf('k', { loki_host: ' pi-1' }), 'k');
});

test('a node read asks for the host only, by its loki_host', async () => {
  const { peeker, asked } = peek();
  await peeker.answer('vm103');
  assert.match(asked[0].url.searchParams.get('query'), /^\{host="vm-103"\} \|~/);
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
  await peeker.answer('pve/netdata');
  assert.equal(asked.length, 3, 'another container is its own query');
});

test('streams but no error line is `none`; no stream at all is `silent`, naming the host or container', async () => {
  // The error query finds nothing; the unfiltered one finds a line (a quiet host) or nothing.
  for (const [quiet, container, want] of [
    [true, 'pve', { state: 'none', lines: [] }],
    [false, 'pve', { state: 'silent', lines: [], reason: 'pve' }],
    [false, 'vm103', { state: 'silent', lines: [], reason: 'vm-103' }],
    [false, 'pve/db', { state: 'silent', lines: [], reason: 'db on pve' }],
  ]) {
    const queries = [];
    const { peeker } = peek({
      deps: {
        fetcher: async (url) => {
          const q = new URL(url).searchParams.get('query');
          queries.push(q);
          return reply(streams(...(quiet && !q.includes('|~') ? [[ns(1), 'info fine']] : [])));
        },
      },
    });
    assert.deepEqual((await peeker.answer(container)).body, want);
    assert.equal(queries.length, 2);
    assert.equal(queries[1].includes('|~'), false, 'the second query has no filter');
  }
});

test('a failed second query is unavailable, never a false all-clear', async () => {
  let n = 0;
  const { peeker } = peek({
    deps: {
      fetcher: async () => {
        n += 1;
        return n === 1 ? reply(streams()) : reply({ message: 'x' }, 500);
      },
    },
  });
  assert.equal((await peeker.answer('pve')).body.state, 'unavailable');
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

// Severity of a line (#844). Shapes marked "real" were read from the homelab's Loki.
test('levelOf reads the level a line states (table)', () => {
  const rows = [
    // logfmt (real: alloy, loki)
    ['ts=2026-10-31T08:37:35Z level=error msg="could not fetch logs for container" component=tailer', 'error'],
    ['level=error ts=2026-10-31T08:37:54Z caller=scheduler_processor.go:176 msg="error notifying scheduler" err=EOF', 'error'],
    ['level=warn ts=2026-10-31T08:37:54Z msg="slow"', 'warn'],
    ['level=info ts=2026-10-31T08:37:54Z caller=metrics.go:285 query="{host=\\"x\\"} |~ \\"(?i)error\\""', 'other'],
    ['time=2026-10-31 level=fatal msg=bye', 'fatal'],
    ['lvl=crit msg=x', 'fatal'],
    ['severity=warning msg=x', 'warn'],
    ['level=E msg=x', 'error'],
    // JSON (real: jaghelm); the word, and pino's numbers
    ['{"time":"2026-10-31T08:30:46.845Z","level":"warn","module":"monitors","msg":"Explicit monitor mapping"}', 'warn'],
    ['{"level":"error","msg":"boom"}', 'error'],
    ['{"level":50,"msg":"boom"}', 'error'],
    ['{"level":40,"msg":"hmm"}', 'warn'],
    ['{"level":60,"msg":"dead"}', 'fatal'],
    ['{"level":30,"msg":"fine, error count 0"}', 'other'],
    ['{"level":"30","msg":"x"}', 'other'],
    ['{"severity":"CRITICAL","message":"x"}', 'fatal'],
    ['{"msg":"error writing"}', 'other'],
    ['{"level":"error","msg":"cut off', 'error'],
    ['{"time":"x","level":"panic","msg":"x"}', 'fatal'],
    // bracketed / prefixed (real: haproxy, adguard, omada, arcane with colour codes, s6, ssh)
    ['[WARNING]  (8) : Server npm_https/npm2 is DOWN, reason: Layer4 connection problem, info: "ECONNREFUSED"', 'warn'],
    ['2026/10/31 03:24:51.358573 [error] dnsproxy: exchange failed upstream=https://dns10.quad9.net', 'error'],
    ['10-31-2026 04:33:12.005 WARN [schedule-anomaly-pool-2] [] c.t.s.e.c.u.InterfaceUtils(): Failed to parse', 'warn'],
    ['\u001b[2mOct 31 08:30:45.456\u001b[0m \u001b[93mWRN\u001b[0m failed to sync project error="load compose"', 'warn'],
    ['\u001b[2mOct 31 08:30:45.456\u001b[0m \u001b[91mERR\u001b[0m something', 'error'],
    ['s6-rc: warning: service s6rc-oneshot-runner is marked as essential', 'warn'],
    ['WARNING: send_to_all: write 34 bytes to socket 10 failed (ret=-1)', 'warn'],
    ['ERROR: relation "x" does not exist', 'error'],
    ['Error: connect ECONNREFUSED 127.0.0.1:5432', 'error'],
    ['FATAL: password authentication failed', 'fatal'],
    ['panic: runtime error: index out of range', 'fatal'],
    ['[CRITICAL] disk gone', 'fatal'],
    ['(ERR) nope', 'error'],
    ['sshd[812]: error: kex_exchange_identification', 'error'],
    ['2026-10-31T08:00:00Z error db down', 'error'],
    ['2026-10-31 08:00:00,123 - WARNING - slow', 'warn'],
    ['E1031 12:00:00.000000       1 reflector.go:150] failed to list', 'error'],
    ['W1031 12:00:00.000000       1 x.go:1] hmm', 'warn'],
    ['F1031 12:00:00.000000       1 x.go:1] dead', 'fatal'],
    ['I1031 12:00:00.000000       1 x.go:1] fine', 'other'],
    ['INFO started [error] handler', 'other'],
    // real (vaultwarden, gitea, tailscale, immich) and radicale's shape
    ['[2026-10-31 07:43:59.472][vaultwarden::api::icons][WARN] Blocked address: 192.168.68.12', 'warn'],
    ['[2026-10-31 08:50:31 +0000] [1/Thread-18561 (process_request_thread)] [WARNING] slow request', 'warn'],
    ['[2026-10-31 08:50:31 +0000] [1/Thread-18561 (process_request_thread)] [INFO] GET request for', 'other'],
    ['2026/10/30 22:27:43 .../mirror/mirror_push.go:106:SyncPushMirror() [E] SyncPushMirror [mirror: 6][repo: x]: failed', 'error'],
    ['2026/10/31 06:11:21 .../ssh_key_authorized_keys.go:55:rewriteAllPublicKeys.1() [W] Unable to remove: Error: x', 'warn'],
    ['2026/10/30 23:13:50 HTTPRequest [W] router: slow      POST /x.git/git-upload-pack for 172.21.0.1:0', 'warn'],
    ['2026/10/31 00:21:26 health(warnable=not-in-map-poll): error: Unable to connect to the coordination server', 'error'],
    ['2026/10/31 00:13:26 router: warning: failed to enable src_valid_mark', 'warn'],
    ['\u001b[31m[Nest] 7  - \u001b[39m10/31/2026, 12:00:01 AM \u001b[31m  ERROR\u001b[39m [Microservices:{"id":"x"}] Unable to run job', 'error'],
    ['\u001b[32m[Nest] 7  - \u001b[39m10/31/2026, 3:02:06 AM \u001b[32m    LOG\u001b[39m [Microservices:IntegrityService] Processed 1401', 'other'],
    ['time="2026-10-31T08:00:49Z" level=warning msg="fetch_interval_max (5s) is less than fetch_interval (30s)"', 'warn'],
    // logfmt numbers count; prose numbers do not
    ['ts=2026-10-31 level=50 msg=boom', 'error'],
    ['msg=boom a=1 level=60 b=2', 'fatal'],
    // other JSON level fields
    ['{"asctime":"x","levelname":"ERROR","message":"boom"}', 'error'],
    ['{"@timestamp":"x","log":{"level":"warn"},"message":"hm"}', 'warn'],
    ['{"log":{"level":"info"},"message":"error count 0"}', 'other'],
    // the word is not the level
    ['Sensor reported battery level: 45 after error', 'other'],
    ['zoom level=60 failed, error', 'other'],
    ['battery level=45 then fatal error', 'other'],
    ['Monitor error: probe failed', 'other'],
    ['Decoding error in frame', 'other'],
    ['Monday error: probe failed', 'other'],
    ['Mon Oct 31 08:00:00 2026 error: real stamp', 'error'],
    ['name zoom_level=error x', 'other'],
    ['{"level":"info","msg":"x"} [ERROR] later', 'other'],
    ['syslogin_perform_logout: logout() returned an error', 'other'],
    ['request ok, no error', 'other'],
    ['sync finished errors=0 warnings=0', 'other'],
    ['retry after error in upstream', 'other'],
    ['Failed to connect, warning: ignored', 'other'],
    ['the errors in this line are plural', 'other'],
    ['Alert sent to the on-call', 'other'],
    ['', 'other'],
  ];
  for (const [line, want] of rows) assert.equal(levelOf(line), want, line);
});

test('levelOf: earliest statement wins, and odd input never throws', () => {
  assert.equal(levelOf('[WARN] then level=error later'), 'warn');
  assert.equal(levelOf('level=info msg="[ERROR] quoted"'), 'other');
  for (const v of [undefined, null, 42, {}, '\u0000', '{', '{"level":{}}', '{"level":null}', 'x'.repeat(10000)]) {
    assert.ok(['fatal', 'error', 'warn', 'other'].includes(levelOf(v)));
  }
});

test('a long JSON line is read as text by word only, as cleanLine shows it raw', () => {
  const long = `{"level":"error","msg":"${'x'.repeat(4100)}"}`;
  assert.equal(levelOf(long), 'error');
  assert.equal(levelOf(`{"level":50,"msg":"${'x'.repeat(4100)}"}`), 'other');
});

test('cleanLine leaves the JSON level word off when the level is drawn as a marker', () => {
  const json = '{"level":"warn","module":"monitors","msg":"no monitor"}';
  assert.equal(cleanLine(json), 'warn monitors: no monitor');
  assert.equal(cleanLine(json, { badge: true }), 'monitors: no monitor');
});

test('linesOf gives each line its level, read before the clean-up rewrites a JSON line', () => {
  const lines = linesOf([
    {
      values: [
        [ns(3000), '{"level":50,"module":"push","msg":"send failed"}'],
        [ns(2000), 'WARN slow'],
        [ns(1000), 'no error here'],
      ],
    },
  ]);
  assert.deepEqual(lines.map((l) => [l.text, l.level]), [
    ['push: send failed', 'error'],
    ['WARN slow', 'warn'],
    ['no error here', 'other'],
  ]);
});

test('linesOf drops the JSON level word beside a marker, keeps it beside none', () => {
  const lines = linesOf([
    {
      values: [
        [ns(2000), '{"level":"warn","module":"monitors","msg":"no monitor"}'],
        [ns(1000), '{"level":"info","module":"boot","msg":"up"}'],
      ],
    },
  ]);
  assert.deepEqual(lines.map((l) => [l.text, l.level]), [
    ['monitors: no monitor', 'warn'],
    ['info boot: up', 'other'],
  ]);
});
