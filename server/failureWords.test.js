/**
 * A source's failure in words (#605, failureWords.js): each cause a read can
 * fail with gives its one sentence, naming the source and keeping the useful
 * part of the cause, and no sentence carries an errno code, a URL, a host, a
 * port or a credential. The errors are the shapes Node's fetch (undici) and
 * JagHelm's readers really throw.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CAUSES, failureDetail, failureSentence, readFailure } from './failureWords.js';
import { PromQueryError } from './discovery.js';
import { RAW_DETAIL as RAW } from './testing/rawDetail.js';

/** What Node's fetch rejects with when the connection fails: "fetch failed", the reason as its cause. */
const fetchFailed = (code, message) =>
  new TypeError('fetch failed', { cause: Object.assign(new Error(message), { code }) });

/** discovery.js's wrapping of a failed request. */
const promFailed = (cause) =>
  new PromQueryError(`Prometheus query failed: ${cause.message}`, { cause });

const answered = (status) =>
  Object.assign(new PromQueryError(`Prometheus answered HTTP ${status}`), { status });

// Each cause: the errors that read as it, and the sentence for Prometheus and for Kuma.
const TABLE = [
  {
    cause: 'refused',
    errors: [
      fetchFailed('ECONNREFUSED', 'connect ECONNREFUSED 10.0.0.9:9090'),
      promFailed(fetchFailed('ECONNREFUSED', 'connect ECONNREFUSED 10.0.0.9:9090')),
      // Happy eyeballs: one refusal per address, in an AggregateError.
      new TypeError('fetch failed', {
        cause: new AggregateError([
          Object.assign(new Error('connect ECONNREFUSED ::1:9090'), { code: 'ECONNREFUSED' }),
          Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:9090'), { code: 'ECONNREFUSED' }),
        ]),
      }),
      'connect ECONNREFUSED 10.0.0.9:9090',
    ],
    prometheus: 'Prometheus refused the connection',
    kuma: 'Kuma refused the connection',
  },
  {
    cause: 'timeout',
    errors: [
      new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
      promFailed(new DOMException('The operation was aborted due to timeout', 'TimeoutError')),
      fetchFailed(
        'UND_ERR_CONNECT_TIMEOUT',
        'Connect Timeout Error (attempted address: prom.lan:9090, timeout: 10000ms)'
      ),
      fetchFailed('ETIMEDOUT', 'connect ETIMEDOUT 10.0.0.9:9090'),
    ],
    prometheus: "Prometheus didn't answer in time",
    kuma: "Kuma didn't answer in time",
  },
  {
    cause: 'dns',
    errors: [
      fetchFailed('ENOTFOUND', 'getaddrinfo ENOTFOUND prom.lan'),
      fetchFailed('EAI_AGAIN', 'getaddrinfo EAI_AGAIN prom.lan'),
      'getaddrinfo ENOTFOUND prom.lan',
    ],
    prometheus: "Prometheus's address didn't resolve",
    kuma: "Kuma's address didn't resolve",
  },
  {
    cause: 'tls',
    errors: [
      fetchFailed('CERT_HAS_EXPIRED', 'certificate has expired'),
      fetchFailed('DEPTH_ZERO_SELF_SIGNED_CERT', 'self-signed certificate'),
      fetchFailed('UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'unable to verify the first certificate'),
      fetchFailed(
        'ERR_TLS_CERT_ALTNAME_INVALID',
        "Hostname/IP does not match certificate's altnames: Host: prom.lan"
      ),
      fetchFailed('EPROTO', 'write EPROTO 00F8:error:0A00010B:SSL routines:wrong version number'),
    ],
    prometheus: "Prometheus's TLS connection failed",
    kuma: "Kuma's TLS connection failed",
  },
  {
    cause: 'auth',
    errors: [answered(401), new Error('Kuma status page answered HTTP 401')],
    prometheus: 'Prometheus refused the credentials',
    kuma: 'Kuma refused the credentials',
  },
  {
    cause: 'http',
    status: 403,
    errors: [answered(403), 'Prometheus answered HTTP 403 to the targets read'],
    prometheus: 'Prometheus refused the query (HTTP 403)',
    kuma: 'Kuma refused the request (HTTP 403)',
  },
  {
    cause: 'http',
    status: 404,
    errors: [answered(404)],
    prometheus: 'Prometheus refused the query (HTTP 404)',
    kuma: 'Kuma refused the request (HTTP 404)',
  },
  {
    cause: 'http',
    status: 503,
    errors: [answered(503), new Error('Kuma status page answered HTTP 503')],
    prometheus: 'Prometheus answered with an error (HTTP 503)',
    kuma: 'Kuma answered with an error (HTTP 503)',
  },
  {
    cause: 'rejected',
    errors: [
      Object.assign(new PromQueryError('Prometheus returned no query result: parse error'), {
        failure: 'rejected',
      }),
    ],
    prometheus: 'Prometheus refused the query',
    kuma: 'Kuma refused the request',
  },
  {
    cause: 'unreadable',
    errors: [
      promFailed(new SyntaxError('Unexpected token < in JSON at position 0')),
      Object.assign(new PromQueryError('Prometheus returned no query result'), {
        failure: 'unreadable',
      }),
      new Error('response too large (>5242880 byte cap)'),
      new Error('The reply is not JSON (text/html)'),
    ],
    prometheus: "Prometheus's answer couldn't be read",
    kuma: "Kuma's answer couldn't be read",
  },
  {
    cause: 'empty',
    errors: [Object.assign(new Error('Kuma status page lists no monitors'), { failure: 'empty' })],
    prometheus: "Prometheus's answer was empty",
    kuma: "Kuma's status page lists no monitors",
  },
  {
    cause: 'redirect',
    errors: [
      new Error(
        "redirected http://sonarr.lan:8989 → http://sso.lan; not following a redirect to another origin because this integration's credential is in the URL; configure the final URL instead"
      ),
      new Error(
        'redirected http://a.lan → http://b.lan; refusing to re-send a request body to another origin (HTTP 307)'
      ),
      new Error('too many redirects'),
    ],
    prometheus: "Prometheus's redirect wasn't followed (see the log)",
    kuma: "Kuma's redirect wasn't followed (see the log)",
  },
  {
    cause: 'blocked',
    errors: [
      new Error('Blocked private IPv4 host: 169.254.169.254'),
      new Error('Blocked URL scheme: file:'),
      new Error('Blocked host: metadata.google.internal'),
      new Error('Invalid URL: ht!tp://x'),
    ],
    prometheus: "Prometheus's address is blocked (see the log)",
    kuma: "Kuma's address is blocked (see the log)",
  },
  {
    // A source URL refused for carrying a credential (#419): off, as the board says.
    cause: 'off',
    errors: [
      Object.assign(
        new PromQueryError('PROMETHEUS_URL carries a user name or password, so it is not used'),
        { failure: 'off' }
      ),
    ],
    prometheus: 'Prometheus is off: its URL is refused',
    kuma: 'Kuma is off: its URL is refused',
  },
  {
    cause: 'unset',
    errors: [
      Object.assign(new PromQueryError('No Prometheus is set up (PROMETHEUS_URL)'), {
        failure: 'unset',
      }),
    ],
    prometheus: 'No Prometheus is set up',
    kuma: 'No Kuma is set up',
  },
  {
    cause: 'unanswered',
    errors: [
      new TypeError('fetch failed'),
      fetchFailed('ECONNRESET', 'read ECONNRESET'),
      fetchFailed('EHOSTUNREACH', 'connect EHOSTUNREACH 10.0.0.9:9090'),
      new Error('boom'),
      'fetch failed',
      undefined,
    ],
    prometheus: "Prometheus didn't answer",
    kuma: "Kuma didn't answer",
  },
];

test('every cause the module knows has a row in the table', () => {
  assert.deepEqual([...new Set(TABLE.map((row) => row.cause))].sort(), [...CAUSES].sort());
});

for (const row of TABLE) {
  test(`${row.cause}${row.status ? ` ${row.status}` : ''}: read as its cause, and said in its sentence`, () => {
    for (const err of row.errors) {
      const failure = readFailure(err);
      assert.deepEqual(
        failure,
        row.status ? { cause: row.cause, status: row.status } : { cause: row.cause },
        String(err)
      );
      assert.equal(failureSentence('prometheus', err), row.prometheus, String(err));
      assert.equal(failureSentence('kuma', err), row.kuma, String(err));
      // A failure read once reads the same again: the model is handed it read.
      assert.deepEqual(readFailure(failure), failure);
      assert.equal(failureSentence('prometheus', failure), row.prometheus);
      for (const sentence of [row.prometheus, row.kuma]) assert.doesNotMatch(sentence, RAW);
    }
  });
}

test('a refused read names it, in place of the source’s word', () => {
  assert.equal(
    failureSentence('prometheus', answered(403), { request: 'targets read' }),
    'Prometheus refused the targets read (HTTP 403)'
  );
  assert.equal(failureSentence('gitea', answered(401)), 'Gitea refused the credentials');
  assert.equal(failureSentence('gitea', answered(500)), 'Gitea answered with an error (HTTP 500)');
});

test('the sentence is one per cause, however the raw error varies (a port, an address)', () => {
  const sentences = new Set(
    ['10.0.0.9:9090', '10.0.0.9:9091', '[::1]:9090'].map((at) =>
      failureSentence('prometheus', fetchFailed('ECONNREFUSED', `connect ECONNREFUSED ${at}`))
    )
  );
  assert.deepEqual([...sentences], ['Prometheus refused the connection']);
});

test('the raw detail, for the log only, keeps each message along the cause chain', () => {
  assert.equal(
    failureDetail(promFailed(fetchFailed('ECONNREFUSED', 'connect ECONNREFUSED 10.0.0.9:9090'))),
    'Prometheus query failed: fetch failed: connect ECONNREFUSED 10.0.0.9:9090'
  );
  assert.equal(failureDetail(fetchFailed('EPIPE', '')), 'fetch failed: EPIPE');
  assert.equal(
    failureDetail('Kuma status page answered HTTP 502'),
    'Kuma status page answered HTTP 502'
  );
  assert.equal(failureDetail({ cause: 'http', status: 502 }), 'http (HTTP 502)');
});
