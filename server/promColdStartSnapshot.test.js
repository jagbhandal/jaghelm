/**
 * #470: JagHelm restarting with its push snapshot (every node reachable and
 * healthy) while Prometheus has just started and scraped nothing, as when a
 * host reboot brings both up together. It used to page host_unreachable for
 * every node, then host_recovered for each a cycle or two later.
 *
 * The real refreshes, status model and push cycle, in a process of their own
 * (this file), against a mock Prometheus (testing/coldPrometheus.js). The
 * snapshot is written by a push pipeline fed without the refresh loop, so the
 * refreshes still start from nothing. promColdStart.test.js boots with none.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { coldHomelab } from './testing/coldPrometheus.js';
import { pushPipeline } from './testing/pushPipeline.js';

const { getCached, getCachedInternal } = await import('./cache.js');
const { refreshServices, refreshUPS } = await import('./refresh.js');
const { NOT_SCRAPED } = await import('./status/rules.js');

const realFetch = globalThis.fetch;
process.on('exit', () => {
  globalThis.fetch = realFetch;
});

const caches = { getCached, getCachedInternal, getAllCronStatuses: () => [] };

test('#470: booting with a snapshot against a Prometheus that has scraped nothing: no push; the nodes read no signal, then healthy once it scrapes', async () => {
  const lab = coldHomelab();
  globalThis.fetch = lab.mock.fetch;
  const p = pushPipeline();
  try {
    // The JagHelm before the reboot: every node read, healthy.
    await p.cycle(await lab.scrapedCaches());
    assert.deepEqual(p.sent, []);
    const written = p.snapshot.prev().hosts;
    assert.deepEqual(Object.keys(written), [...lab.labels].sort());
    for (const label of lab.labels) assert.equal(written[label].reachable, true, label);

    p.restart();
    for (let i = 0; i < 3; i += 1) {
      await Promise.all([refreshServices(), refreshUPS()]);
      await p.cycle(caches);
    }
    assert.deepEqual(p.sent, [], 'no host_unreachable, no source push');
    assert.equal(lab.mock.targetReads, 3, 'the target list is read once a cycle');
    assert.equal(p.status.sources.prometheus.state, 'ok');
    for (const label of lab.labels) {
      const e = p.status.entities.find((x) => x.id === `nodes/${label}`);
      assert.deepEqual([e.state, e.word, e.reason], ['unknown', 'No signal', NOT_SCRAPED], label);
    }
    assert.deepEqual(p.snapshot.prev().hosts, written, 'each node held as it was');

    lab.scrape();
    for (let i = 0; i < 2; i += 1) {
      await Promise.all([refreshServices(), refreshUPS()]);
      await p.cycle(caches);
    }
    assert.deepEqual(p.sent, [], 'no host_recovered');
    for (const label of lab.labels) {
      const e = p.status.entities.find((x) => x.id === `nodes/${label}`);
      assert.equal(e.state, 'ok', `${label}: ${e.reason}`);
    }
    assert.deepEqual(p.snapshot.prev().hosts, written);
  } finally {
    p.close();
  }
});
