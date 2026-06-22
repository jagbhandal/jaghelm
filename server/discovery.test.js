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

// Return a Prometheus instant-query response for whichever metric the URL asks for.
// Every numeric value is the STRING "0" to exercise the falsy-0 path.
function promResponse(url) {
  const q = decodeURIComponent(url);
  const result = (samples) => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: null,
    json: async () => ({ data: { result: samples } }),
  });

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
