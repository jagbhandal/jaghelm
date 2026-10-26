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
 * the exported getNodesData() for one node with a stubbed globalThis.fetch returning "0" values.
 * Runs in its own process; safeFetch ultimately calls globalThis.fetch.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { initDiscovery, getNodesData } = await import('./discovery.js');

/** One node's data: getNodesData() for that node alone. */
const nodeData = async (label) => (await getNodesData([label])).get(label);

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

  // The target list (#470), read for a node whose up is 0: none of its own.
  if (new URL(String(url)).pathname === '/api/v1/targets') {
    return { ...result([]), json: async () => ({ status: 'success', data: { activeTargets: [], droppedTargets: [] } }) };
  }
  // The node's up, 0: Prometheus's own answer stands, whatever the target list
  // says (#470, #477).
  if (q.includes('max by (node) (up{')) {
    return result([{ metric: {}, value: [0, '0'] }]);
  }

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
    const { metrics } = await nodeData('vm-test');
    assert.equal(metrics.temp, '0.0', 'scalar() returns 0 for a "0" string value');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('discovery: a container idle at 0% CPU shows 0, not null', async () => {
  globalThis.fetch = async (url) => promResponse(url);
  try {
    const { containers } = await nodeData('vm-test');
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
    const { containers } = await nodeData('vm-test');
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
const { readFailure } = await import('./failureWords.js');

const answer = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  body: null,
  json: async () => body,
});

/** What Node's fetch rejects with when the connection is refused: the reason, with its code, as the cause. */
const refusedFetch = () =>
  new TypeError('fetch failed', {
    cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:9998'), { code: 'ECONNREFUSED' }),
  });

// Each failure, and its cause as failureWords.js reads it from the PromQueryError (#605).
const FAILURES = {
  'an HTTP 500': [async () => answer(500, { status: 'error', errorType: 'internal', error: 'boom' }), { cause: 'http', status: 500 }],
  'a timeout': [
    async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    },
    { cause: 'timeout' },
  ],
  'a refused connection': [
    async () => {
      throw refusedFetch();
    },
    { cause: 'refused' },
  ],
  'a 200 with an error status': [async () => answer(200, { status: 'error', error: 'query timed out' }), { cause: 'rejected' }],
  'a 200 that is not a query result': [async () => answer(200, { hello: 'proxy login page' }), { cause: 'unreadable' }],
  'a body that is not JSON': [
    async () => ({
      ...answer(200, null),
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    }),
    { cause: 'unreadable' },
  ],
};

for (const [name, [stub, failure]] of Object.entries(FAILURES)) {
  test(`promQuery: ${name} rejects with a PromQueryError that says why`, async () => {
    globalThis.fetch = stub;
    try {
      await assert.rejects(promQuery('up'), (err) => {
        assert.ok(err instanceof PromQueryError);
        assert.deepEqual(readFailure(err), failure);
        return true;
      });
    } finally {
      globalThis.fetch = realFetch;
    }
  });
}

test('promQuery: a refused request keeps its cause in the message, for the log (#605)', async () => {
  globalThis.fetch = async () => {
    throw refusedFetch();
  };
  try {
    await assert.rejects(promQuery('up'), {
      message: 'Prometheus query failed: fetch failed: connect ECONNREFUSED 127.0.0.1:9998',
    });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('promQuery: a query no series match resolves to [], not an error', async () => {
  globalThis.fetch = async () => answer(200, { status: 'success', data: { resultType: 'vector', result: [] } });
  try {
    assert.deepEqual(await promQuery('up{node="nope"}'), []);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('getNodesData, one node: a failing query makes the result ok:false with its error', async () => {
  globalThis.fetch = async (url) =>
    decodeURIComponent(url).includes('container_')
      ? answer(503, { status: 'error', error: 'unavailable' })
      : promResponse(url);
  try {
    const data = await nodeData('vm-test');
    assert.equal(data.ok, false);
    assert.match(data.error, /HTTP 503/);
    assert.deepEqual(data.failure, { cause: 'http', status: 503 }, 'and its cause, for the words (#605)');
    assert.deepEqual(data.failedReads, ['containers'], 'only what the failed queries feed');
    assert.equal(data.metrics.temp, '0.0', 'what the other queries returned is kept');
    assert.deepEqual(data.containers, []);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('getNodesData: every query answering, even with no series, is ok:true', async () => {
  // Prometheus has no target for vm-test either, and one for vm-test-2, which
  // has its up series: the list names a node asked for (#470, #477).
  globalThis.fetch = async (url) => {
    if (new URL(String(url)).pathname === '/api/v1/targets') {
      const labels = { instance: 'vm-test-2:9100', job: 'node', node: 'vm-test-2' };
      const activeTargets = [{ labels, health: 'up', lastScrape: '2026-10-20T10:00:00Z' }];
      return answer(200, { status: 'success', data: { activeTargets, droppedTargets: [] } });
    }
    return decodeURIComponent(url).includes('max by (node) (up{')
      ? promResult([{ metric: { node: 'vm-test-2' }, value: [0, '1'] }])
      : promResult([]);
  };
  try {
    const data = (await getNodesData(['vm-test', 'vm-test-2'])).get('vm-test');
    assert.equal(data.ok, true);
    assert.equal(data.error, null);
    assert.deepEqual(data.failedReads, []);
    assert.equal(data.reachable, null, 'no up series for the node: reachability unknown');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('getNodesData, one node: reachable is up{node} — true if any target answered, false if none did', async () => {
  for (const [up, reachable] of [['1', true], ['0', false]]) {
    const seen = [];
    globalThis.fetch = async (url) => {
      const q = decodeURIComponent(url);
      seen.push(q);
      return q.includes('max by (node) (up{node=~"vm-test"})') ? promResult([{ metric: {}, value: [0, up] }]) : promResult([]);
    };
    try {
      assert.equal((await nodeData('vm-test')).reachable, reachable);
      assert.ok(seen.some((q) => q.includes('max by (node) (up{node=~"vm-test"})')));
    } finally {
      globalThis.fetch = realFetch;
    }
  }
});

// #232 review: one failed query is not the whole node. failedReads names what
// the failed queries feed, so the push snapshot holds only that.
test('getNodesData, one node: failedReads names the parts whose queries failed', async () => {
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
      const data = await nodeData('vm-test');
      assert.equal(data.ok, false);
      assert.deepEqual(data.failedReads, failedReads);
    } finally {
      globalThis.fetch = realFetch;
    }
  }
});

// ── #470: no `up` series is told from Prometheus's own targets ───────────
// A Prometheus that has just started answers every query with no series until
// it scrapes. A node with no `up` series, or `up` 0, is then asked about once a
// cycle, in Prometheus's target list: a target of that node not scraped yet
// makes the node unread (no signal), and no target at all leaves it as before
// (with no metric either, the model judges it unreachable). Prometheus writes
// `up` on every scrape, so a scraped target with no `up` series is Prometheus
// storing nothing: a failure of its own.

const { NODE_READS } = await import('./discovery.js');
const TARGETS_PATH = '/api/v1/targets';

/** An active target of node `node`, as /api/v1/targets lists it. */
const target = (node, health, lastScrape = health === 'unknown' ? '0001-01-01T00:00:00Z' : '2026-10-20T10:00:00Z') => ({
  discoveredLabels: { __address__: `${node}:9100` },
  labels: { instance: `${node}:9100`, job: 'node', node },
  scrapePool: 'node',
  scrapeUrl: `http://${node}:9100/metrics`,
  lastError: '',
  lastScrape,
  lastScrapeDuration: 0,
  health,
});

const targetsAnswer = (activeTargets) => answer(200, { status: 'success', data: { activeTargets, droppedTargets: [] } });

/**
 * A Prometheus with no series at all (nothing scraped yet, or no node), whose
 * target list is `targets` (a function, so a test can fail it). `reads` lists
 * every URL asked.
 */
function coldProm(targets) {
  const reads = [];
  const fetch = async (url) => {
    const u = String(url);
    reads.push(u);
    return new URL(u).pathname === TARGETS_PATH ? targets() : promResult([]);
  };
  return { reads, fetch, targetReads: () => reads.filter((u) => new URL(u).pathname === TARGETS_PATH) };
}

test('#470: a node with no up series whose target Prometheus has not scraped yet is unread, and nothing failed', async () => {
  for (const [why, t] of [
    ['health unknown', target('vm-test', 'unknown')],
    ['no lastScrape', { ...target('vm-test', 'up'), lastScrape: undefined }],
  ]) {
    const prom = coldProm(() => targetsAnswer([target('other', 'up'), t]));
    globalThis.fetch = prom.fetch;
    try {
      const data = await nodeData('vm-test');
      assert.equal(data.ok, true, why);
      assert.equal(data.error, null, why);
      assert.equal(data.reachable, null, why);
      assert.deepEqual(data.failedReads, [...NODE_READS], `${why}: every part unread`);
      assert.equal(prom.targetReads().length, 1, `${why}: the targets read once`);
      assert.match(prom.targetReads()[0], /\/api\/v1\/targets\?state=active$/);
    } finally {
      globalThis.fetch = realFetch;
    }
  }
});

test('#470: a node with no up series and no target of its own is as before: nothing unread, reachability null', async () => {
  // Other nodes' targets, one not scraped yet: only the node's own count. The
  // list names a node asked for (`other`), so Prometheus scrapes them (#477).
  const prom = coldProm(() => targetsAnswer([target('other', 'unknown'), target('vm-test-2', 'up')]));
  globalThis.fetch = prom.fetch;
  try {
    const data = (await getNodesData(['vm-test', 'other'])).get('vm-test');
    assert.equal(data.ok, true);
    assert.deepEqual(data.failedReads, []);
    assert.equal(data.reachable, null);
    assert.equal(prom.targetReads().length, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

/**
 * A Prometheus whose `up` query answers `ups[i]` on its i-th ask (the last
 * one after that; each a map of node to value, a node left out having no
 * series), with no other series, and whose target list is `targets`. `ups`
 * entries may be a function, to fail the ask.
 */
function promWithUp(ups, targets) {
  const reads = [];
  const upQueries = [];
  const fetch = async (url) => {
    const u = String(url);
    reads.push(u);
    if (new URL(u).pathname === TARGETS_PATH) return targets();
    const q = decodeURIComponent(u);
    if (!q.includes('max by (node) (up{')) return promResult([]);
    upQueries.push(q);
    const up = ups[Math.min(upQueries.length, ups.length) - 1];
    if (typeof up === 'function') return up();
    return answer(200, {
      status: 'success',
      data: { result: Object.entries(up).map(([node, v]) => ({ metric: { node }, value: [0, String(v)] })) },
    });
  };
  return { fetch, upQueries, targetReads: () => reads.filter((u) => new URL(u).pathname === TARGETS_PATH) };
}

test('#470: no up series while a target of the node has been scraped: Prometheus stored nothing, the node is unread, with the problem naming it (#476: ok stays true)', async () => {
  for (const health of ['up', 'down']) {
    // vm-test-3 has its up series: untouched. Its other target was scraped too.
    const prom = promWithUp([{ 'vm-test-3': 1 }], () =>
      targetsAnswer([
        target('vm-test', health),
        { ...target('vm-test-2', 'unknown'), labels: { ...target('vm-test-2', 'up').labels, job: 'cadvisor' } },
        target('vm-test-2', health),
        target('vm-test-3', 'up'),
      ])
    );
    globalThis.fetch = prom.fetch;
    try {
      const data = await getNodesData(['vm-test', 'vm-test-2', 'vm-test-3']);
      for (const node of ['vm-test', 'vm-test-2']) {
        const d = data.get(node);
        assert.equal(d.ok, true, `${health} ${node}: Prometheus answered`);
        assert.equal(d.problem, 'Prometheus scraped vm-test, vm-test-2 but stored no up series', `${health} ${node}`);
        assert.deepEqual(d.failedReads, [...NODE_READS], `${health} ${node}`);
        assert.equal(d.reachable, null);
      }
      assert.equal(data.get('vm-test-3').ok, true);
      assert.deepEqual(data.get('vm-test-3').failedReads, []);
      assert.equal(prom.targetReads().length, 1, health);
      assert.equal(prom.upQueries.length, 2, `${health}: up asked again, for those nodes only`);
      assert.match(prom.upQueries[1], /up\{node=~"vm-test\|vm-test-2"\}/);
    } finally {
      globalThis.fetch = realFetch;
    }
  }
});

test('#470: a node scraped between the up query and the targets read has its up series when asked again: unread, nothing failed', async () => {
  const prom = promWithUp([{}, { 'vm-test': 1 }], () => targetsAnswer([target('vm-test', 'up')]));
  globalThis.fetch = prom.fetch;
  try {
    const data = await nodeData('vm-test');
    assert.equal(data.ok, true);
    assert.equal(data.error, null);
    assert.deepEqual(data.failedReads, [...NODE_READS]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('#470: the up query asked again failing makes the node unread, and the result ok:false with why', async () => {
  const prom = promWithUp([{}, async () => answer(500, { status: 'error', error: 'boom' })], () =>
    targetsAnswer([target('vm-test', 'up')])
  );
  globalThis.fetch = prom.fetch;
  try {
    const data = await nodeData('vm-test');
    assert.equal(data.ok, false);
    assert.equal(data.error, 'Prometheus answered HTTP 500');
    assert.deepEqual(data.failedReads, [...NODE_READS]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// A reboot: Prometheus scraped the node's cAdvisor before it listened (up 0),
// and not its node-exporter yet, so `max by (node) (up)` is 0.
const cadvisor = (node, health) => ({
  ...target(node, health),
  labels: { instance: `${node}:8080`, job: 'cadvisor', node },
});

test('#470: up 0 while a target of the node is not scraped yet, or answered since, is unread, and nothing failed', async () => {
  for (const [why, targets] of [
    ['node-exporter not scraped yet', [cadvisor('vm-test', 'down'), target('vm-test', 'unknown')]],
    ['node-exporter with no last scrape', [cadvisor('vm-test', 'down'), { ...target('vm-test', 'up'), lastScrape: undefined }]],
    ['cAdvisor answered since the up query', [cadvisor('vm-test', 'up'), target('vm-test', 'down')]],
  ]) {
    const prom = promWithUp([{ 'vm-test': 0 }], () => targetsAnswer(targets));
    globalThis.fetch = prom.fetch;
    try {
      const data = await nodeData('vm-test');
      assert.equal(data.ok, true, why);
      assert.equal(data.reachable, false, why);
      assert.deepEqual(data.failedReads, [...NODE_READS], why);
      assert.equal(prom.targetReads().length, 1, why);
      assert.equal(prom.upQueries.length, 1, `${why}: up not asked again`);
    } finally {
      globalThis.fetch = realFetch;
    }
  }
});

test('#470: up 0 with every target of the node scraped and down, or none of its own, is as before', async () => {
  for (const [why, targets] of [
    ['every target down', [cadvisor('vm-test', 'down'), target('vm-test', 'down'), target('other', 'unknown')]],
    ['no target of its own', [target('other', 'unknown')]],
  ]) {
    const prom = promWithUp([{ 'vm-test': 0 }], () => targetsAnswer(targets));
    globalThis.fetch = prom.fetch;
    try {
      const data = await nodeData('vm-test');
      assert.equal(data.ok, true, why);
      assert.equal(data.reachable, false, why);
      assert.deepEqual(data.failedReads, [], why);
    } finally {
      globalThis.fetch = realFetch;
    }
  }
});

test('#470: up 0 when the targets read fails stands, as Prometheus\'s own answer: nothing unread, nothing failed', async () => {
  const prom = promWithUp([{ 'vm-test': 0 }], async () => answer(403, { error: 'forbidden' }));
  globalThis.fetch = prom.fetch;
  try {
    const data = await nodeData('vm-test');
    assert.equal(data.ok, true);
    assert.equal(data.reachable, false);
    assert.deepEqual(data.failedReads, []);
    assert.equal(prom.targetReads().length, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// The problem in words (#605), and its raw detail, for the log.
const TARGET_FAILURES = {
  'an HTTP 403 (a proxy that only lets queries through)': [
    async () => answer(403, { error: 'forbidden' }),
    'Prometheus refused the targets read (HTTP 403)',
    /^Prometheus answered HTTP 403 to the targets read$/,
  ],
  'a refused connection': [
    async () => {
      throw refusedFetch();
    },
    'Prometheus refused the connection',
    /^Prometheus targets read failed: fetch failed: connect ECONNREFUSED 127\.0\.0\.1:9998$/,
  ],
  'a 200 that is not a target list': [
    async () => answer(200, { hello: 'proxy login page' }),
    "Prometheus's answer couldn't be read",
    /^Prometheus returned no target list$/,
  ],
  'a 200 with an error status': [
    async () => answer(200, { status: 'error', error: 'unavailable' }),
    'Prometheus refused the targets read',
    /^Prometheus returned no target list: unavailable$/,
  ],
};

for (const [name, [targets, problem, detail]] of Object.entries(TARGET_FAILURES)) {
  test(`#470: the targets read failing (${name}) makes a node with no up series unread, with the problem saying why`, async () => {
    const prom = coldProm(targets);
    globalThis.fetch = prom.fetch;
    try {
      const data = await nodeData('vm-test');
      assert.equal(data.ok, true);
      assert.equal(data.problem, problem);
      assert.match(data.problemDetail, detail);
      assert.deepEqual(data.failedReads, [...NODE_READS]);
      assert.equal(data.reachable, null);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
}

test('#470: the targets read failing leaves a node that has its up series as it was', async () => {
  const both = ['vm-test', 'vm-test-2'];
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (new URL(u).pathname === TARGETS_PATH) throw new TypeError('fetch failed');
    // Only vm-test-2 has an up series.
    return decodeURIComponent(u).includes('max by (node) (up{')
      ? answer(200, { status: 'success', data: { result: [{ metric: { node: 'vm-test-2' }, value: [0, '1'] }] } })
      : promResult([]);
  };
  try {
    const data = await getNodesData(both);
    assert.equal(data.get('vm-test').problem, "Prometheus didn't answer");
    assert.deepEqual(data.get('vm-test').failedReads, [...NODE_READS]);
    assert.equal(data.get('vm-test-2').ok, true, 'the node Prometheus has up for is read as usual');
    assert.equal(data.get('vm-test-2').problem, undefined);
    assert.equal(data.get('vm-test-2').error, null);
    assert.deepEqual(data.get('vm-test-2').failedReads, []);
    assert.equal(data.get('vm-test-2').reachable, true);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('#470: no targets read when every node has an up series, nor for one Prometheus has metrics for', async () => {
  // vm-test has up; vm-test-2 has no up series but a CPU reading (a node read
  // by its metrics, whose up series lacks the node label): it is reachable by
  // them, so the target list could change nothing.
  for (const nodes of [['vm-test'], ['vm-test', 'vm-test-2']]) {
    const reads = [];
    globalThis.fetch = async (url) => {
      const u = String(url);
      reads.push(u);
      const q = decodeURIComponent(u);
      if (q.includes('max by (node) (up{')) return promResult([{ metric: {}, value: [0, '1'] }]);
      if (q.includes('node_cpu_seconds_total'))
        return answer(200, { status: 'success', data: { result: [{ metric: { node: 'vm-test-2' }, value: [0, '20'] }] } });
      return promResult([]);
    };
    try {
      const data = await getNodesData(nodes);
      assert.equal(reads.filter((u) => new URL(u).pathname === TARGETS_PATH).length, 0, nodes.join(','));
      for (const n of nodes) assert.deepEqual(data.get(n).failedReads, [], n);
    } finally {
      globalThis.fetch = realFetch;
    }
  }
});

test('#470: no targets read when the up query failed: every node is unread already', async () => {
  const reads = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    reads.push(u);
    return decodeURIComponent(u).includes('max by (node) (up{') ? answer(500, { status: 'error', error: 'boom' }) : promResult([]);
  };
  try {
    const data = await nodeData('vm-test');
    assert.equal(reads.filter((u) => new URL(u).pathname === TARGETS_PATH).length, 0);
    assert.deepEqual(data.failedReads, ['reachable']);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ── #476: a first scrape that never comes; #477: no target per node ──────
// A target still waiting for its first scrape 3 of its scrape intervals after
// the first cycle that saw it is Prometheus failing, naming it, not silence.
// The count is kept in the data dir (targetWaits.js), so a restart goes on
// with it. A target list that names none of the nodes (a federation or
// remote-write backend) makes a missing `up` series Prometheus's problem,
// never a host's.

const { mkdtempSync, rmSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const { createTargetWaits } = await import('./targetWaits.js');

const PROM_URL = 'http://localhost:9998';
const T = 1_782_345_600_000;
const realNow = Date.now;

/** A fresh waits file, discovery pointed at it; `restart()` reads it back as a new process would. */
function waitsFile() {
  const dir = mkdtempSync(join(tmpdir(), 'jaghelm-discovery-waits-'));
  const path = join(dir, 'waits.json');
  const start = () => initDiscovery(PROM_URL, { targetWaits: createTargetWaits({ path }) });
  start();
  return {
    restart: start,
    done() {
      Date.now = realNow;
      globalThis.fetch = realFetch;
      initDiscovery(PROM_URL);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** One getNodesData call at T + `ms`. */
async function at(ms, nodes) {
  Date.now = () => T + ms;
  return getNodesData(nodes);
}

// vm-test's node-exporter, never scraped, every 30 s: its limit is 90 s.
const stuck = { ...target('vm-test', 'unknown'), scrapeInterval: '30s' };
// The node by its label, no names given (#605); the target's address is for the log.
const TOO_LONG = "Prometheus hasn't scraped vm-test in 3 scrape intervals";

test('#476: a target still waiting for its first scrape 3 of its intervals after the first cycle that saw it: Prometheus failing, naming it; the node unread', async () => {
  const f = waitsFile();
  // vm-test-2 is scraped and has its up series: never touched.
  const prom = promWithUp([{ 'vm-test-2': 1 }], () => targetsAnswer([stuck, target('vm-test-2', 'up')]));
  globalThis.fetch = prom.fetch;
  try {
    for (const ms of [0, 30_000, 60_000, 89_999]) {
      const d = (await at(ms, ['vm-test', 'vm-test-2'])).get('vm-test');
      assert.deepEqual([d.ok, d.problem, d.whyNoUp], [true, undefined, 'not-scraped-yet'], `${ms} ms: not scraped yet`);
      assert.deepEqual(d.failedReads, [...NODE_READS]);
    }
    const data = await at(90_000, ['vm-test', 'vm-test-2']);
    const d = data.get('vm-test');
    assert.deepEqual([d.ok, d.problem, d.whyNoUp], [true, TOO_LONG, 'not-scraped-too-long'], '3 intervals on: Prometheus answered, the problem is this node\'s');
    assert.equal(d.problemDetail, 'targets not scraped: vm-test:9100 (vm-test)', 'the target, for the log');
    assert.deepEqual(d.failedReads, [...NODE_READS], 'still unread: whether it is up, nobody knows');
    assert.equal(d.reachable, null);
    const other = data.get('vm-test-2');
    assert.deepEqual([other.ok, other.error, other.failedReads, other.reachable], [true, null, [], true]);
  } finally {
    f.done();
  }
});

test('#476: the count goes on across a restart (it is in the data dir), and starts again after a long gap when Prometheus can\'t say when it started', async () => {
  const f = waitsFile();
  const prom = coldProm(() => targetsAnswer([stuck]));
  globalThis.fetch = prom.fetch;
  try {
    await at(0, ['vm-test']);
    await at(30_000, ['vm-test']);
    f.restart(); // a new process, reading the file
    const d = (await at(90_000, ['vm-test'])).get('vm-test');
    assert.deepEqual([d.problem, d.whyNoUp], [TOO_LONG, 'not-scraped-too-long'], 'counted from the first cycle before the restart');

    // JagHelm off for longer than the gap: Prometheus may have restarted with
    // it, so the target may be new; its wait starts again.
    f.restart();
    const back = (await at(90_000 + 6 * 60_000, ['vm-test'])).get('vm-test');
    assert.deepEqual([back.problem, back.whyNoUp], [undefined, 'not-scraped-yet']);
  } finally {
    f.done();
  }
});

test('#476: a target the list gives a last scrape for, unknown again, counts from that scrape', async () => {
  const f = waitsFile();
  const reset = { ...stuck, lastScrape: new Date(T - 100_000).toISOString() };
  const prom = coldProm(() => targetsAnswer([reset]));
  globalThis.fetch = prom.fetch;
  try {
    const d = (await at(0, ['vm-test'])).get('vm-test');
    assert.deepEqual([d.problem, d.whyNoUp], [TOO_LONG, 'not-scraped-too-long'], 'its first sighting is already past the limit');
  } finally {
    f.done();
  }
});

test('#476: up 0 while a target waits past its limit is Prometheus failing too; inside it, unread with nothing failed', async () => {
  const f = waitsFile();
  const prom = promWithUp([{ 'vm-test': 0 }], () => targetsAnswer([cadvisor('vm-test', 'down'), stuck]));
  globalThis.fetch = prom.fetch;
  try {
    let d = (await at(0, ['vm-test'])).get('vm-test');
    assert.deepEqual([d.ok, d.whyNoUp, d.reachable], [true, 'not-scraped-yet', false]);
    d = (await at(120_000, ['vm-test'])).get('vm-test');
    assert.deepEqual([d.problem, d.whyNoUp], [TOO_LONG, 'not-scraped-too-long']);
    assert.deepEqual(d.failedReads, [...NODE_READS]);
  } finally {
    f.done();
  }
});

test('#476: a wait is kept through cycles that read no targets, and while the read fails; forgotten once the list shows the target scraped', async () => {
  const f = waitsFile();
  let mode = 'stuck';
  const prom = promWithUp(
    [() => (mode === 'up' ? promResult([{ metric: {}, value: [0, '1'] }]) : promResult([]))],
    () => {
      if (mode === 'blocked') return answer(403, { error: 'forbidden' });
      return targetsAnswer([mode === 'scraped' ? { ...stuck, health: 'up', lastScrape: new Date(T).toISOString() } : stuck]);
    }
  );
  globalThis.fetch = prom.fetch;
  try {
    await at(0, ['vm-test']);
    mode = 'blocked';
    let d = (await at(30_000, ['vm-test'])).get('vm-test');
    assert.equal(d.whyNoUp, 'targets-unread');
    mode = 'up'; // up 1: no targets read
    d = (await at(60_000, ['vm-test'])).get('vm-test');
    assert.deepEqual([d.reachable, d.whyNoUp], [true, undefined]);
    mode = 'stuck';
    d = (await at(90_000, ['vm-test'])).get('vm-test');
    assert.equal(d.whyNoUp, 'not-scraped-too-long', 'counted from 0: nothing in between dropped it');

    mode = 'scraped'; // the list shows it scraped (and stored nothing): its wait goes
    await at(120_000, ['vm-test']);
    mode = 'stuck';
    d = (await at(150_000, ['vm-test'])).get('vm-test');
    assert.equal(d.whyNoUp, 'not-scraped-yet', 'a new wait');
  } finally {
    f.done();
  }
});

/**
 * A Prometheus for vm-test, with a cAdvisor whose up is `cadvisorUp()` and a
 * node-exporter never scraped; and vm-test-2, whose only target is not
 * scraped yet. `started` is when /api/v1/status/runtimeinfo says Prometheus
 * started (null: it doesn't answer). `runtimeReads` counts those reads.
 */
function siblingProm({ cadvisorUp, started = new Date(T - 3_600_000).toISOString() }) {
  const runtimeReads = [];
  const fetch = async (url) => {
    const u = new URL(String(url));
    if (u.pathname === TARGETS_PATH) {
      return targetsAnswer([cadvisor('vm-test', cadvisorUp() ? 'up' : 'down'), stuck, target('vm-test-2', 'unknown')]);
    }
    if (u.pathname === '/api/v1/status/runtimeinfo') {
      runtimeReads.push(String(url));
      if (started === null) return answer(404, { status: 'error', error: 'not found' });
      return answer(200, { status: 'success', data: { startTime: started, lastConfigTime: started } });
    }
    const q = decodeURIComponent(String(url));
    if (q.includes('max by (node) (up{')) {
      return promResult([{ metric: { node: 'vm-test' }, value: [0, cadvisorUp() ? '1' : '0'] }]);
    }
    return promResult([]);
  };
  return { fetch, runtimeReads };
}

test('#476: a node with one healthy and one stuck target: the stuck one counts from the first list that showed it, whatever its node read since', async () => {
  const f = waitsFile();
  let up = true;
  const prom = siblingProm({ cadvisorUp: () => up });
  globalThis.fetch = prom.fetch;
  try {
    // vm-test-2 needs a check, so the list is read: vm-test's waiting
    // node-exporter is seen too, though vm-test reads up 1.
    let data = await at(0, ['vm-test', 'vm-test-2']);
    assert.deepEqual([data.get('vm-test').reachable, data.get('vm-test').whyNoUp], [true, undefined]);
    for (const ms of [30_000, 60_000]) await at(ms, ['vm-test']); // up 1: nothing to check
    up = false; // cAdvisor flaps: vm-test is checked; its node-exporter has waited 120 s
    data = await at(120_000, ['vm-test']);
    const d = data.get('vm-test');
    assert.deepEqual([d.whyNoUp, d.problem], ['not-scraped-too-long', TOO_LONG]);
    assert.equal(prom.runtimeReads.length, 1, 'Prometheus is asked when it started, to confirm the wait');
    up = true;
    await at(150_000, ['vm-test']);
    up = false;
    assert.equal((await at(180_000, ['vm-test'])).get('vm-test').whyNoUp, 'not-scraped-too-long', 'the flap dropped nothing');
  } finally {
    f.done();
  }
});

test('#476: JagHelm off for more than 5 minutes keeps a wait when Prometheus has run since before it began, and starts it again when Prometheus started after', async () => {
  for (const [started, why] of [
    [new Date(T - 3_600_000).toISOString(), 'not-scraped-too-long'],
    [new Date(T + 5 * 60_000).toISOString(), 'not-scraped-yet'],
  ]) {
    const f = waitsFile();
    const prom = siblingProm({ cadvisorUp: () => false, started });
    globalThis.fetch = prom.fetch;
    try {
      await at(0, ['vm-test']);
      await at(30_000, ['vm-test']);
      f.restart(); // off for 10 minutes
      const d = (await at(30_000 + 10 * 60_000, ['vm-test'])).get('vm-test');
      assert.equal(d.whyNoUp, why, `Prometheus started ${started}`);
    } finally {
      f.done();
    }
  }
});

test('#477: no up series and an empty target list: Prometheus failing, naming the nodes; no node unreachable', async () => {
  const f = waitsFile();
  const prom = coldProm(() => targetsAnswer([]));
  globalThis.fetch = prom.fetch;
  try {
    const data = await at(0, ['vm-test', 'vm-test-2']);
    for (const node of ['vm-test', 'vm-test-2']) {
      const d = data.get(node);
      assert.equal(d.ok, true, node);
      assert.equal(d.problem, 'Prometheus lists no target for any node, and has no up series for vm-test, vm-test-2', node);
      assert.equal(d.whyNoUp, 'no-targets-at-all', node);
      assert.deepEqual(d.failedReads, [...NODE_READS], `${node}: unread, so the model calls it no signal, not unreachable`);
    }
  } finally {
    f.done();
  }
});

test('#477: a target list that names none of the nodes (a federation or remote-write backend) reads the same', async () => {
  const f = waitsFile();
  // A federating Prometheus: its only targets are the other Prometheus and itself.
  const federate = { ...target('vm-test', 'up'), labels: { instance: 'leaf:9090', job: 'federate' } };
  const self = { ...target('vm-test', 'up'), labels: { instance: 'localhost:9090', job: 'prometheus', node: 'elsewhere' } };
  // vm-test-2 has its up series (federated); vm-test has lost it.
  const prom = promWithUp([{ 'vm-test-2': 1 }], () => targetsAnswer([federate, self]));
  globalThis.fetch = prom.fetch;
  try {
    const data = await at(0, ['vm-test', 'vm-test-2']);
    const d = data.get('vm-test');
    assert.deepEqual([d.ok, d.whyNoUp], [true, 'no-targets-at-all']);
    assert.equal(d.problem, 'Prometheus lists no target for any node, and has no up series for vm-test');
    assert.deepEqual(d.failedReads, [...NODE_READS]);
    assert.deepEqual([data.get('vm-test-2').ok, data.get('vm-test-2').reachable], [true, true]);
  } finally {
    f.done();
  }
});

test('#477: a target list that names some of the nodes: each node read as before', async () => {
  const f = waitsFile();
  // vm-test has no target (gone from Prometheus); vm-test-2's is not scraped yet.
  const prom = coldProm(() => targetsAnswer([target('vm-test-2', 'unknown')]));
  globalThis.fetch = prom.fetch;
  try {
    const data = await at(0, ['vm-test', 'vm-test-2']);
    const gone = data.get('vm-test');
    assert.deepEqual([gone.ok, gone.failedReads, gone.reachable, gone.whyNoUp], [true, [], null, 'no-target'], 'unreachable, as before');
    const waiting = data.get('vm-test-2');
    assert.deepEqual([waiting.ok, waiting.whyNoUp], [true, 'not-scraped-yet']);
    assert.deepEqual(waiting.failedReads, [...NODE_READS]);
  } finally {
    f.done();
  }
});

test('#477: up 0 with an empty target list stands, as Prometheus\'s own answer', async () => {
  const f = waitsFile();
  const prom = promWithUp([{ 'vm-test': 0 }], () => targetsAnswer([]));
  globalThis.fetch = prom.fetch;
  try {
    const d = (await at(0, ['vm-test'])).get('vm-test');
    assert.deepEqual([d.ok, d.reachable, d.failedReads, d.whyNoUp], [true, false, [], 'scraped-and-down']);
  } finally {
    f.done();
  }
});

test('#605: a refused PROMETHEUS_URL is off, not "not set up": every read rejects, asking nothing, and says so', async () => {
  const { promQueryRange } = await import('./discovery.js');
  const { failureSentence } = await import('./failureWords.js');
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    throw new Error('asked');
  };
  initDiscovery(null, { problem: 'PROMETHEUS_URL carries a user name or password, so it is not used' });
  try {
    for (const read of [() => promQuery('up'), () => promQueryRange('up', { start: 0, end: 60, step: 60 })]) {
      await assert.rejects(read(), (err) => {
        assert.deepEqual(readFailure(err), { cause: 'off' });
        assert.equal(failureSentence('prometheus', err), 'Prometheus is off: its URL is refused');
        return true;
      });
    }
    assert.deepEqual(asked, []);
  } finally {
    globalThis.fetch = realFetch;
    initDiscovery('http://localhost:9998');
  }
});

test('#704: an unset PROMETHEUS_URL: every read rejects marked unset, asking nothing; not "off", not unreachable', async () => {
  const { promQueryRange } = await import('./discovery.js');
  const { failureSentence } = await import('./failureWords.js');
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    throw new Error('asked');
  };
  initDiscovery(null, { problem: 'Prometheus is not set. Set PROMETHEUS_URL in .env.', unset: true });
  try {
    for (const read of [() => promQuery('up'), () => promQueryRange('up', { start: 0, end: 60, step: 60 })]) {
      await assert.rejects(read(), (err) => {
        assert.deepEqual(readFailure(err), { cause: 'unset' });
        assert.equal(failureSentence('prometheus', err), 'No Prometheus is set up');
        return true;
      });
    }
    assert.deepEqual(asked, [], 'no request to localhost or anywhere');
  } finally {
    globalThis.fetch = realFetch;
    initDiscovery('http://localhost:9998');
  }
});
