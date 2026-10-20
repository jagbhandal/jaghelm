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

  // The target list (#470), read for a node with no up series: none of its own.
  if (new URL(String(url)).pathname === '/api/v1/targets') {
    return { ...result([]), json: async () => ({ status: 'success', data: { activeTargets: [], droppedTargets: [] } }) };
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

test('getNodesData, one node: a failing query makes the result ok:false with its error', async () => {
  globalThis.fetch = async (url) =>
    decodeURIComponent(url).includes('container_')
      ? answer(503, { status: 'error', error: 'unavailable' })
      : promResponse(url);
  try {
    const data = await nodeData('vm-test');
    assert.equal(data.ok, false);
    assert.match(data.error, /HTTP 503/);
    assert.deepEqual(data.failedReads, ['containers'], 'only what the failed queries feed');
    assert.equal(data.metrics.temp, '0.0', 'what the other queries returned is kept');
    assert.deepEqual(data.containers, []);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('getNodesData, one node: every query answering, even with no series, is ok:true', async () => {
  // Prometheus has no target for the node either (#470).
  globalThis.fetch = async (url) =>
    new URL(String(url)).pathname === '/api/v1/targets' ? promResponse(url) : promResult([]);
  try {
    const data = await nodeData('vm-test');
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
  // Other nodes' targets, one not scraped yet: only the node's own count.
  const prom = coldProm(() => targetsAnswer([target('other', 'unknown'), target('vm-test-2', 'up')]));
  globalThis.fetch = prom.fetch;
  try {
    const data = await nodeData('vm-test');
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

test('#470: no up series while a target of the node has been scraped: Prometheus stored nothing, the node is unread and the result ok:false naming it', async () => {
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
        assert.equal(d.ok, false, `${health} ${node}`);
        assert.equal(d.error, 'Prometheus scraped vm-test, vm-test-2 but stored no up series', `${health} ${node}`);
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

const TARGET_FAILURES = {
  'an HTTP 403 (a proxy that only lets queries through)': [
    async () => answer(403, { error: 'forbidden' }),
    /^Prometheus answered HTTP 403 to the targets read$/,
  ],
  'a refused connection': [
    async () => {
      throw new TypeError('fetch failed');
    },
    /^Prometheus targets read failed: fetch failed$/,
  ],
  'a 200 that is not a target list': [async () => answer(200, { hello: 'proxy login page' }), /^Prometheus returned no target list$/],
  'a 200 with an error status': [
    async () => answer(200, { status: 'error', error: 'unavailable' }),
    /^Prometheus returned no target list: unavailable$/,
  ],
};

for (const [name, [targets, message]] of Object.entries(TARGET_FAILURES)) {
  test(`#470: the targets read failing (${name}) makes a node with no up series unread, and the result ok:false with why`, async () => {
    const prom = coldProm(targets);
    globalThis.fetch = prom.fetch;
    try {
      const data = await nodeData('vm-test');
      assert.equal(data.ok, false);
      assert.match(data.error, message);
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
    assert.equal(data.get('vm-test').ok, false);
    assert.deepEqual(data.get('vm-test').failedReads, [...NODE_READS]);
    assert.equal(data.get('vm-test-2').ok, true, 'the node Prometheus has up for is read as usual');
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
