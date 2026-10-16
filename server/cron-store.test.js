import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let store;
before(async () => {
  process.env.JAGHELM_DATA_DIR = mkdtempSync(join(tmpdir(), 'jaghelm-cron-store-'));
  store = await import('./cron-store.js');
});

test('recordRun persists expected_every_seconds', () => {
  store.recordRun({ node: 'n1', job: 'a', status: 'success', expected_every_seconds: 3600 });
  store.recordRun({ node: 'n1', job: 'b', status: 'success' });
  const jobs = store.getAllStatuses().find((s) => s.node === 'n1').jobs;
  assert.equal(jobs.find((j) => j.job === 'a').runs[0].expected_every_seconds, 3600);
  assert.equal('expected_every_seconds' in jobs.find((j) => j.job === 'b').runs[0], false);
});

test('deleteJob returns true then false; empty node is removed', () => {
  store.recordRun({ node: 'n2', job: 'only', status: 'success' });
  assert.equal(store.deleteJob('n2', 'only'), true);
  assert.equal(store.deleteJob('n2', 'only'), false);
  assert.equal(store.getAllStatuses().some((s) => s.node === 'n2'), false);
});

test('deleteJob keeps the node while other jobs remain; unknown node is false', () => {
  assert.equal(store.deleteJob('n1', 'a'), true);
  assert.deepEqual(store.getAllStatuses().find((s) => s.node === 'n1').jobs.map((j) => j.job), ['b']);
  assert.equal(store.deleteJob('nope', 'a'), false);
});
