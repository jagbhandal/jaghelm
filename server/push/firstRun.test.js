/**
 * A first run pushes nothing (#449): with nothing set up, the status model's
 * board is empty (overall `empty`, "Nothing monitored yet") and has no entity,
 * so push has nothing to page about. The `first-run` fixture
 * (testing/statusScenarios.js: the services refresh's own payload for no
 * nodes, with Prometheus answering, and no UPS, Kuma, Gitea, integrations or
 * jobs) runs through the status model and the real push cycle
 * (testing/pushPipeline.js) as a fresh install
 * runs it: no snapshot file, so the first cycle is the baseline, then cycle
 * after cycle, and again after a restart.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pushPipeline } from '../testing/pushPipeline.js';
import { scenarioCycles } from '../testing/statusScenarios.js';

const EMPTY_SNAPSHOT = {
  services: {},
  monitorOf: {},
  hosts: {},
  ups: { state: 'unknown' },
  cron: {},
  sources: { prometheus: 'ok' },
};

test('first run: a fresh install with nothing set up sends no push, cycle after cycle and across a restart', async () => {
  const [{ caches, extra }] = scenarioCycles('first-run');
  const pipeline = pushPipeline({ env: extra.env });
  try {
    for (let i = 0; i < 5; i += 1) {
      const status = await pipeline.cycle(caches, { backupJobs: extra.backupJobs });
      assert.deepEqual(status.overall, { state: 'empty', sentence: 'Nothing monitored yet' });
      assert.deepEqual(status.entities, []);
    }
    // The baseline was kept, so a cycle diffs against it: an empty snapshot.
    assert.deepEqual(pipeline.snapshot.prev(), EMPTY_SNAPSHOT);
    pipeline.restart();
    for (let i = 0; i < 3; i += 1) {
      await pipeline.cycle(caches, { backupJobs: extra.backupJobs });
    }
    assert.deepEqual(pipeline.sent, []);
  } finally {
    pipeline.close();
  }
});
