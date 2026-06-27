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
const promResult = (samples) => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  body: null,
  json: async () => ({ data: { result: samples } }),
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
