/**
 * Short-lived helper containers that a management tool starts and auto-removes
 * carry the label `com.getarcaneapp.internal.resource=true`. cAdvisor exposes it
 * as `container_label_com_getarcaneapp_internal_resource`. Discovery must ignore
 * them at the source so they never become cards, registry entries or breadcrumbs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { initDiscovery, getNodeData } = await import('./discovery.js');

initDiscovery('http://localhost:9998');
const realFetch = globalThis.fetch;
const LABEL = 'container_label_com_getarcaneapp_internal_resource';
const EVAL = 1700000000;

const envelope = (samples) => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  body: null,
  json: async () => ({ data: { result: samples } }),
});

const SERIES = [
  { metric: { name: 'helper_one', [LABEL]: 'true' }, value: [EVAL, String(EVAL - 5)] },
  { metric: { name: 'plain_app' }, value: [EVAL, String(EVAL - 5)] },
  { metric: { name: 'other_label', [LABEL]: 'false' }, value: [EVAL, String(EVAL - 5)] },
];

// honourSelector=true emulates Prometheus applying the selector in the query;
// false returns every series regardless, proving the post-processing guard.
function stub({ honourSelector, seen }) {
  return async (url) => {
    const q = decodeURIComponent(url);
    if (!q.includes('container_')) return envelope([]);
    seen.push(q);
    let out = SERIES.map((s) => ({ ...s, metric: { ...s.metric } }));
    if (honourSelector && q.includes(`${LABEL}!="true"`)) {
      out = out.filter((s) => s.metric[LABEL] !== 'true');
    }
    return envelope(out);
  };
}

for (const honourSelector of [true, false]) {
  test(`discovery: helper containers are ignored (selector honoured=${honourSelector})`, async () => {
    const seen = [];
    globalThis.fetch = stub({ honourSelector, seen });
    try {
      const { containers } = await getNodeData('vm-test');
      const names = containers.map((c) => c.container).sort();
      assert.deepEqual(names, ['other_label', 'plain_app']);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
}

test('discovery: every container_* query carries the exclusion selector', async () => {
  const seen = [];
  globalThis.fetch = stub({ honourSelector: true, seen });
  try {
    await getNodeData('vm-test');
    assert.ok(seen.length >= 5);
    for (const q of seen) assert.ok(q.includes(`${LABEL}!="true"`), `missing in: ${q}`);
  } finally {
    globalThis.fetch = realFetch;
  }
});
