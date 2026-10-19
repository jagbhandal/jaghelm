/**
 * Discovery scalar/container extraction — the falsy-0 fix.
 *
 * A Prometheus value of the STRING "0" (a container truly idle at 0% CPU, a 0°C
 * temp reading, 0 bytes free) is falsy in JS. The old extractors used
 * `r.value?.[1] ? parseFloat(...) : null`, which coerced a real 0 to null —
 * showing "no data" where the answer was genuinely zero. The fix is explicit
 * presence: `r.value?.[1] != null ? parseFloat(...) : null`.
 *
 * scalar() is internal, so we exercise it (and the container fill loops) through
 * the exported getNodeData() with a stubbed globalThis.fetch returning "0" values.
 * Runs in its own process; safeFetch ultimately calls globalThis.fetch.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { initDiscovery, getNodeData } = await import('./discovery.js');

initDiscovery('http://localhost:9998');

const realFetch = globalThis.fetch;

// One Prometheus instant-query response envelope, shared by the stubs below.
// Discovery asks for every node in one query and splits the answer by its
// `node` label (#234), so each sample carries the node the tests ask for.
const promResult = (samples) => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  body: null,
  json: async () => ({ data: { result: samples.map((s) => ({ ...s, metric: { node: 'vm-test', ...s.metric } })) } }),
});

// Return a Prometheus instant-query response for whichever metric the URL asks for.
// Every numeric value is the STRING "0" to exercise the falsy-0 path.
function promResponse(url) {
  const q = decodeURIComponent(url);
  const result = promResult;

  // Container CPU at exactly 0% — the headline case.
  if (q.includes('container_cpu_usage_seconds_total')) {
    return result([{ metric: { name: 'idlebox' }, value: [0, '0'] }]);
  }
  // Node temp reading of 0.
  if (q.includes('node_hwmon_temp_celsius')) {
    return result([{ metric: {}, value: [0, '0'] }]);
  }
  // Container last-seen so the container map gets an entry for 'idlebox'.
  if (q.includes('container_last_seen')) {
    return result([{ metric: { name: 'idlebox' }, value: [0, '1700000000'] }]);
  }
  // Everything else: no data.
  return result([]);
}

test('discovery: a 0°C temp reading is preserved as "0.0", not dropped to null', async () => {
  globalThis.fetch = async (url) => promResponse(url);
  try {
    const { metrics } = await getNodeData('vm-test');
    assert.equal(metrics.temp, '0.0', 'scalar() returns 0 for a "0" string value');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('discovery: a container idle at 0% CPU shows 0, not null', async () => {
  globalThis.fetch = async (url) => promResponse(url);
  try {
    const { containers } = await getNodeData('vm-test');
    const c = containers.find((x) => x.container === 'idlebox');
    assert.ok(c, 'idle container is discovered');
    assert.equal(c.docker.cpu, 0, 'a genuine 0% CPU is kept, not coerced to null');
  } finally {
    globalThis.fetch = realFetch;
  }
});

// A stopped container is not removed from Prometheus immediately: cAdvisor stops
// exporting it, but Prometheus keeps serving the last sample within its lookback
// window (~5m). The presence of a `container_last_seen` series is therefore NOT
// proof the container is running — the freshness of its stamped value is. A stale
// value (eval time minus the stamp beyond the threshold) means the container has
// stopped; we must drop it from the running set so it leaves the board's "up"
// cards and the down/breadcrumb synthesis takes over, instead of a phantom green.
function freshnessResponse(url, EVAL) {
  const q = decodeURIComponent(url);
  const result = promResult;
  if (q.includes('container_last_seen')) {
    return result([
      { metric: { name: 'livebox' }, value: [EVAL, String(EVAL - 10)] },  // 10s old → running
      { metric: { name: 'deadbox' }, value: [EVAL, String(EVAL - 600)] }, // 10m old → stopped
    ]);
  }
  // Both still carry a (stale) CPU series — proves the exclusion overrides bare
  // metric presence, not just absence from one query.
  if (q.includes('container_cpu_usage_seconds_total')) {
    return result([
      { metric: { name: 'livebox' }, value: [EVAL, '5'] },
      { metric: { name: 'deadbox' }, value: [EVAL, '3'] },
    ]);
  }
  return result([]);
}

test('discovery: a container with a STALE container_last_seen is dropped from the running set', async () => {
  const EVAL = 1700000000;
  globalThis.fetch = async (url) => freshnessResponse(url, EVAL);
  try {
    const { containers } = await getNodeData('vm-test');
    const names = containers.map((c) => c.container);
    assert.ok(names.includes('livebox'), 'a freshly-seen container stays in the running set');
    assert.ok(!names.includes('deadbox'), 'a stale-last_seen (stopped) container is dropped');
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ── #232: a failed query is not an empty result ──────────────────────────
// promQuery used to swallow every error and return [], the same as "no series",
// so a Prometheus outage read as every host losing its metrics.

const { promQuery, PromQueryError } = await import('./discovery.js');

const answer = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  body: null,
  json: async () => body,
});

const FAILURES = {
  'an HTTP 500': async () => answer(500, { status: 'error', errorType: 'internal', error: 'boom' }),
  'a timeout': async () => {
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  },
  'a refused connection': async () => {
    throw new TypeError('fetch failed');
  },
  'a 200 with an error status': async () => answer(200, { status: 'error', error: 'query timed out' }),
  'a 200 that is not a query result': async () => answer(200, { hello: 'proxy login page' }),
  'a body that is not JSON': async () => ({
    ...answer(200, null),
    json: async () => {
      throw new SyntaxError('Unexpected token <');
    },
  }),
};

for (const [name, stub] of Object.entries(FAILURES)) {
  test(`promQuery: ${name} rejects with a PromQueryError`, async () => {
    globalThis.fetch = stub;
    try {
      await assert.rejects(promQuery('up'), PromQueryError);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
}

test('promQuery: a query no series match resolves to [], not an error', async () => {
  globalThis.fetch = async () => answer(200, { status: 'success', data: { resultType: 'vector', result: [] } });
  try {
    assert.deepEqual(await promQuery('up{node="nope"}'), []);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('getNodeData: a failing query makes the result ok:false with its error', async () => {
  globalThis.fetch = async (url) =>
    decodeURIComponent(url).includes('container_')
      ? answer(503, { status: 'error', error: 'unavailable' })
      : promResponse(url);
  try {
    const data = await getNodeData('vm-test');
    assert.equal(data.ok, false);
    assert.match(data.error, /HTTP 503/);
    assert.deepEqual(data.failedReads, ['containers'], 'only what the failed queries feed');
    assert.equal(data.metrics.temp, '0.0', 'what the other queries returned is kept');
    assert.deepEqual(data.containers, []);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('getNodeData: every query answering, even with no series, is ok:true', async () => {
  globalThis.fetch = async () => promResult([]);
  try {
    const data = await getNodeData('vm-test');
    assert.equal(data.ok, true);
    assert.equal(data.error, null);
    assert.deepEqual(data.failedReads, []);
    assert.equal(data.reachable, null, 'no up series for the node: reachability unknown');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('getNodeData: reachable is up{node} — true if any target answered, false if none did', async () => {
  for (const [up, reachable] of [['1', true], ['0', false]]) {
    const seen = [];
    globalThis.fetch = async (url) => {
      const q = decodeURIComponent(url);
      seen.push(q);
      return q.includes('max by (node) (up{node=~"vm-test"})') ? promResult([{ metric: {}, value: [0, up] }]) : promResult([]);
    };
    try {
      assert.equal((await getNodeData('vm-test')).reachable, reachable);
      assert.ok(seen.some((q) => q.includes('max by (node) (up{node=~"vm-test"})')));
    } finally {
      globalThis.fetch = realFetch;
    }
  }
});

// #232 review: one failed query is not the whole node. failedReads names what
// the failed queries feed, so the push snapshot holds only that.
test('getNodeData: failedReads names the parts whose queries failed', async () => {
  const { NODE_READS } = await import('./discovery.js');
  const failing = (match) => async (url) => {
    const q = decodeURIComponent(url);
    return match(q) ? answer(400, { status: 'error', error: 'bad_data' }) : promResponse(url);
  };
  const cases = [
    [(q) => q.includes('max by (node) (up{'), ['reachable']],
    [(q) => q.includes('node_hwmon_temp_celsius'), ['temp']],
    [(q) => q.includes('MemAvailable'), ['mem']],
    [(q) => q.includes('node_filesystem_size_bytes'), ['disk']],
    [(q) => q.includes('node_cpu_seconds_total') || q.includes('node_boot_time_seconds'), ['cpu', 'uptime']],
    [() => true, [...NODE_READS]],
  ];
  for (const [match, failedReads] of cases) {
    globalThis.fetch = failing(match);
    try {
      const data = await getNodeData('vm-test');
      assert.equal(data.ok, false);
      assert.deepEqual(data.failedReads, failedReads);
    } finally {
      globalThis.fetch = realFetch;
    }
  }
});
