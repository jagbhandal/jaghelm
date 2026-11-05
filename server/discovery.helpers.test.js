/**
 * Short-lived helper containers that a management tool starts and auto-removes
 * carry the label `com.getarcaneapp.internal.resource=true`. cAdvisor exposes it
 * as `container_label_com_getarcaneapp_internal_resource`. Discovery must ignore
 * them at the source so they never become cards, registry entries or breadcrumbs.
 * So must it the containers of CI jobs, named GITEA-ACTIONS-TASK-… by Gitea's
 * act_runner (#240 review, B1).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { NOT_JOB } from './util/helperContainers.js';
import { queryText } from './testing/promRequest.js';
const { initDiscovery, getNodesData } = await import('./discovery.js');

/** One node's data: getNodesData() for that node alone. */
const nodeData = async (label) => (await getNodesData([label])).get(label);

initDiscovery('http://localhost:9998');
const realFetch = globalThis.fetch;
const LABEL = 'container_label_com_getarcaneapp_internal_resource';
const EVAL = 1700000000;

// Each sample carries the node asked for: discovery splits a batched answer by
// its `node` label (#234).
const envelope = (samples) => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  body: null,
  json: async () => ({ data: { result: samples.map((s) => ({ ...s, metric: { node: 'vm-test', ...s.metric } })) } }),
});

const JOB = 'GITEA-ACTIONS-TASK-5440-WORKFLOW-check-JOB-check-13296247f24e890e404c408850ed614fbd19f6f6c90bab756e7058625e81200b';
const JOB_SELECTOR = NOT_JOB;
// Prometheus anchors the matcher's regex; undo the PromQL string escaping first.
const JOB_RE = new RegExp(`^(?:${NOT_JOB.match(/^name!~"(.*)"$/)[1].replace(/\\\\/g, '\\')})$`);

const SERIES = [
  { metric: { name: 'helper_one', [LABEL]: 'true' }, value: [EVAL, String(EVAL - 5)] },
  { metric: { name: 'plain_app' }, value: [EVAL, String(EVAL - 5)] },
  { metric: { name: 'other_label', [LABEL]: 'false' }, value: [EVAL, String(EVAL - 5)] },
  { metric: { name: JOB }, value: [EVAL, String(EVAL - 5)] },
  // Only the prefix counts: a service whose name merely mentions it stays.
  { metric: { name: 'gitea-actions-task-viewer' }, value: [EVAL, String(EVAL - 5)] },
  // The handbook's throwaway build container (#684)...
  { metric: { name: 'handbook-build-69685' }, value: [EVAL, String(EVAL - 5)] },
  // ...but the handbook site itself, and names that only contain the prefix, stay.
  { metric: { name: 'handbook' }, value: [EVAL, String(EVAL - 5)] },
  { metric: { name: 'my-handbook-build-1' }, value: [EVAL, String(EVAL - 5)] },
  // A `docker run` with no --name: Docker's adjective_surname is a throwaway...
  { metric: { name: 'quirky_sammet' }, value: [EVAL, String(EVAL - 5)] },
  // ...but a real service with an underscore stays.
  { metric: { name: 'node_exporter' }, value: [EVAL, String(EVAL - 5)] },
];

// honourSelector=true emulates Prometheus applying the selector in the query;
// false returns every series regardless, proving the post-processing guard.
function stub({ honourSelector, seen }) {
  return async (url, init) => {
    const q = queryText(url, init);
    if (!q.includes('container_')) return envelope([]);
    seen.push(q);
    let out = SERIES.map((s) => ({ ...s, metric: { ...s.metric } }));
    if (honourSelector && q.includes(`${LABEL}!="true"`)) {
      out = out.filter((s) => s.metric[LABEL] !== 'true');
    }
    if (honourSelector && q.includes(JOB_SELECTOR)) {
      out = out.filter((s) => !JOB_RE.test(s.metric.name));
    }
    return envelope(out);
  };
}

for (const honourSelector of [true, false]) {
  test(`discovery: helper and CI job containers are ignored (selector honoured=${honourSelector})`, async () => {
    const seen = [];
    globalThis.fetch = stub({ honourSelector, seen });
    try {
      const { containers } = await nodeData('vm-test');
      const names = containers.map((c) => c.container).sort();
      assert.deepEqual(names, ['gitea-actions-task-viewer', 'handbook', 'my-handbook-build-1', 'node_exporter', 'other_label', 'plain_app']);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
}

test('discovery: every container_* query carries the exclusion selectors', async () => {
  const seen = [];
  globalThis.fetch = stub({ honourSelector: true, seen });
  try {
    await nodeData('vm-test');
    assert.ok(seen.length >= 5);
    for (const q of seen) {
      assert.ok(q.includes(`${LABEL}!="true"`), `missing in: ${q}`);
      assert.ok(q.includes(JOB_SELECTOR), `missing in: ${q}`);
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});
