/**
 * #470: JagHelm booting with no push snapshot (a first run, or a missing
 * file) while Prometheus has just started and scraped nothing: every node has
 * no `up` series. It used to judge each one unreachable and page
 * host_unreachable for every node, then (with a snapshot) host_recovered when
 * the scrapes came in. The guard against that lived in this process's memory,
 * so a fresh process had none.
 *
 * The real refreshes, status model and push cycle, in a process of their own
 * (this file), against a mock Prometheus (testing/coldPrometheus.js).
 * promColdStartSnapshot.test.js boots the same way with a snapshot.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { coldHomelab } from './testing/coldPrometheus.js';
import { pushPipeline } from './testing/pushPipeline.js';

const { getCached, getCachedInternal } = await import('./cache.js');
const { refreshServices, refreshUPS } = await import('./refresh.js');
const { NODE_READS } = await import('./discovery.js');
const { NOT_SCRAPED } = await import('./status/rules.js');

const realFetch = globalThis.fetch;
process.on('exit', () => {
  globalThis.fetch = realFetch;
});

const caches = { getCached, getCachedInternal, getAllCronStatuses: () => [] };

test('#470: booting with no snapshot against a Prometheus that has scraped nothing: no push; the nodes read no signal, then healthy once it scrapes', async () => {
  const lab = coldHomelab();
  globalThis.fetch = lab.mock.fetch;
  const p = pushPipeline();
  try {
    for (let i = 0; i < 3; i += 1) {
      await Promise.all([refreshServices(), refreshUPS()]);
      await p.cycle(caches);
    }
    assert.deepEqual(p.sent, [], 'no host_unreachable, no source push');
    assert.equal(lab.mock.targetReads, 3, 'the target list is read once a cycle');
    assert.equal(getCached('services').sources.prometheus.ok, true, 'Prometheus answered');
    assert.equal(p.status.sources.prometheus.state, 'ok');
    for (const label of lab.labels) {
      assert.deepEqual(getCached('services').nodes[label].failedReads, [...NODE_READS], label);
      const e = p.status.entities.find((x) => x.id === `nodes/${label}`);
      assert.deepEqual([e.state, e.word, e.reason], ['unknown', 'No signal', NOT_SCRAPED], label);
    }
    assert.deepEqual(p.snapshot.prev().hosts, {}, 'no node read, none in the snapshot');

    lab.scrape();
    for (let i = 0; i < 2; i += 1) {
      await Promise.all([refreshServices(), refreshUPS()]);
      await p.cycle(caches);
    }
    assert.deepEqual(p.sent, [], 'each node is new and healthy: nothing to send');
    assert.equal(lab.mock.targetReads, 3, 'every node has its up series: no more targets reads');
    for (const label of lab.labels) {
      const e = p.status.entities.find((x) => x.id === `nodes/${label}`);
      assert.equal(e.state, 'ok', `${label}: ${e.reason}`);
      assert.equal(p.snapshot.prev().hosts[label].reachable, true, label);
    }
  } finally {
    p.close();
  }
});
