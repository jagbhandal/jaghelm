/**
 * #409: the logger takes URL credentials out of everything it writes, so no call
 * site can put a `user:pass@` URL in the log: the message, every string field at
 * any depth, object keys, an Error however it is handed over, and a URL object.
 * Node's fetch refuses a URL with credentials, and its error names the full URL.
 * These tests read the logger's real output (what it writes to stdout/stderr).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.LOG_LEVEL = 'debug';
const { createLogger } = await import('./logger.js');

const log = createLogger('test');
const CRED_URL = 'http://jag:hunter2@127.0.0.1:9'; // pragma: allowlist secret
const REDACTED_URL = 'http://jag:[redacted]@127.0.0.1:9';

/** The lines `fn` makes the logger write, raw and parsed. */
function capture(fn) {
  const raw = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (s) => (raw.push(String(s)), true);
  process.stderr.write = (s) => (raw.push(String(s)), true);
  try {
    fn();
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
  return { raw: raw.join(''), entries: raw.map((l) => JSON.parse(l)) };
}

function assertNoSecret(raw) {
  assert.ok(!raw.includes('hunter2'), raw);
}

test('the message: a URL with credentials in it is redacted, in either call style', () => {
  const { raw, entries } = capture(() => {
    log.warn(`fetch ${CRED_URL}/api failed`);
    log.warn({ source: 'kuma' }, 'fetch', `${CRED_URL}/api`, 'failed');
    log.warn('fetch failed:', new Error(`refused ${CRED_URL}/api`));
  });
  assertNoSecret(raw);
  assert.deepEqual(
    entries.map((e) => e.msg),
    [
      `fetch ${REDACTED_URL}/api failed`,
      `fetch ${REDACTED_URL}/api failed`,
      `fetch failed: refused ${REDACTED_URL}/api`,
    ]
  );
});

test('a field at any depth: strings in nested objects and arrays, and object keys', () => {
  const { raw, entries } = capture(() =>
    log.info(
      {
        promUrl: CRED_URL,
        nested: { list: [`${CRED_URL}/a`, { deeper: `${CRED_URL}/b` }], n: 1 },
        byUrl: { [CRED_URL]: 'up' },
      },
      'x'
    )
  );
  assertNoSecret(raw);
  const [e] = entries;
  assert.equal(e.promUrl, REDACTED_URL);
  assert.deepEqual(e.nested, { list: [`${REDACTED_URL}/a`, { deeper: `${REDACTED_URL}/b` }], n: 1 });
  assert.deepEqual(e.byUrl, { [REDACTED_URL]: 'up' });
});

test('an Error: its message, stack and cause, and properties such as url and input', async () => {
  // Node's own refusal, as discovery.js and monitors.js get it.
  const refused = await fetch(`${CRED_URL}/api/v1/query`).catch((err) => err);
  assert.match(refused.message, /includes credentials/);
  const cause = new Error(`connect to ${CRED_URL} refused`);
  const err = new Error(`Prometheus query failed: ${refused.message}`, { cause });
  err.url = new URL(`${CRED_URL}/api/v1/query`);
  err.input = `${CRED_URL}/api/v1/query`;
  err.inner = cause; // an enumerable Error property
  let invalid;
  try {
    new URL(`${CRED_URL}:bad`);
  } catch (e) {
    invalid = e; // a TypeError with the URL in `input`
  }

  const { raw, entries } = capture(() => {
    log.warn({ err }, 'a');
    log.warn({ err: refused }, 'b');
    log.warn({ err: err.message, stack: err.stack, cause: err.cause, errCause: String(err.cause) }, 'c');
    log.warn({ result: { error: err }, invalid }, 'd');
    log.warn('e', err);
    log.warn({}, 'f', err, err.cause);
  });

  assertNoSecret(raw);
  // Still a useful line: the message, with the host.
  assert.equal(entries[0].err, `Prometheus query failed: ${refused.message.replace(CRED_URL, REDACTED_URL)}`);
  assert.ok(entries[1].err.includes(`${REDACTED_URL}/api/v1/query`), entries[1].err);
  assert.ok(entries[2].stack.includes(REDACTED_URL), entries[2].stack);
  assert.equal(entries[3].result.error.url, `${REDACTED_URL}/api/v1/query`);
  assert.equal(entries[3].result.error.input, `${REDACTED_URL}/api/v1/query`);
  assert.equal(entries[3].invalid.input, `${REDACTED_URL}:bad`);
});

test('a URL object is written as its address, redacted', () => {
  const { raw, entries } = capture(() => log.info({ url: new URL(`${CRED_URL}/api/status-page/default`) }, 'x'));
  assertNoSecret(raw);
  assert.equal(entries[0].url, `${REDACTED_URL}/api/status-page/default`);
});

test("the caller's objects are left as they were", () => {
  const make = () => {
    const err = new Error(`refused ${CRED_URL}`);
    err.url = `${CRED_URL}/x`;
    return {
      promUrl: CRED_URL,
      nested: { list: [CRED_URL, { deeper: CRED_URL }] },
      byUrl: { [CRED_URL]: 1 },
      err,
      url: new URL(CRED_URL),
    };
  };
  const fields = make();
  const { nested, err, url } = fields;
  const list = nested.list;

  capture(() => {
    log.warn(fields, `msg ${CRED_URL}`);
    log.warn({ fields }, 'nested');
  });

  const expected = make();
  assert.deepStrictEqual(fields, expected);
  assert.equal(fields.nested, nested);
  assert.equal(fields.nested.list, list);
  assert.equal(fields.err, err);
  assert.equal(err.message, expected.err.message);
  assert.equal(err.url, `${CRED_URL}/x`);
  assert.equal(fields.url, url);
  assert.equal(url.href, expected.url.href);
  assert.deepEqual(Object.keys(fields.byUrl), [CRED_URL]);
});

test('a line with no credentials is written unchanged, a URL without them keeps its host', () => {
  const { entries } = capture(() =>
    log.info(
      {
        promUrl: 'http://127.0.0.1:9',
        contact: 'admin@example.test',
        note: 'Tom & Jerry?',
        n: 3,
        ok: true,
        none: null,
        list: [1, 'two'],
      },
      'Prometheus URL'
    )
  );
  const { time, ...rest } = entries[0];
  assert.ok(time);
  assert.deepEqual(rest, {
    level: 'info',
    module: 'test',
    msg: 'Prometheus URL',
    promUrl: 'http://127.0.0.1:9',
    contact: 'admin@example.test',
    note: 'Tom & Jerry?',
    n: 3,
    ok: true,
    none: null,
    list: [1, 'two'],
  });
});
