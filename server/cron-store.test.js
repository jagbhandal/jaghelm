import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let store;
let dataDir;
before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'jaghelm-cron-store-'));
  process.env.JAGHELM_DATA_DIR = dataDir;
  store = await import('./cron-store.js');
});

// Removed after the file's tests so a run leaves nothing in tmpdir (#369).
after(() => { if (dataDir) rmSync(dataDir, { recursive: true, force: true }); });

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

test('recordRun uses own-property lookups (inherited names do not pollute)', () => {
  store.recordRun({ node: 'hasOwnProperty', job: 'call', status: 'success' });
  assert.equal(typeof Object.prototype.hasOwnProperty.call, 'function');
  assert.equal(Object.prototype.hasOwnProperty.call({ a: 1 }, 'a'), true);
  const n = store.getAllStatuses().find((s) => s.node === 'hasOwnProperty');
  assert.ok(n.jobs.some((j) => j.job === 'call'));
  store.recordRun({ node: 'toString', job: 'x', status: 'success' });
  assert.equal(({}).toString.x, undefined);
});
