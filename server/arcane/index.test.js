import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startArcane, stopArcane } from './index.js';
import { projectFixture } from './projectFixture.js';

const KEY = 'test-key-123'; // pragma: allowlist secret

test('startArcane returns null without ARCANE_URL', () => {
  assert.equal(startArcane({ env: { ARCANE_API_KEY: KEY }, demo: false }), null);
  assert.equal(startArcane({ env: { ARCANE_URL: 'https://a.test' }, demo: false }), null);
  stopArcane();
});

test('startArcane returns null in demo mode', () => {
  const env = { ARCANE_URL: 'https://a.test', ARCANE_API_KEY: KEY };
  assert.equal(startArcane({ env, demo: true }), null);
  stopArcane();
});

test('projectFixture drops labels and unknown fields', () => {
  const out = projectFixture('containers', {
    success: true,
    pagination: { page: 1 },
    data: [
      {
        id: 'c1',
        names: ['/x'],
        image: 'img:1',
        labels: { secret: 'v' },
        env: ['TOKEN=abc'],
        autoUpdateEnabled: false,
        updateInfo: { hasUpdate: true, currentVersion: '1', latestVersion: '2', authMethod: 'basic', error: 'e' },
      },
    ],
  });
  assert.deepEqual(out, {
    success: true,
    data: [
      {
        // Anonymized for the public repo (projectFixture.test.js covers the mapping).
        names: ['/ctr-01'],
        image: 'registry.example/img-01:1.0.0',
        autoUpdateEnabled: false,
        updateInfo: { hasUpdate: true, currentVersion: '1.0.0', latestVersion: '1.0.1', error: 'redacted' },
      },
    ],
  });
  assert.equal(JSON.stringify(out).includes('TOKEN'), false);
  const envs = projectFixture('environments', { success: true, data: [{ id: '0', name: 'a', status: 'online', lastSeen: 'x', apiUrl: 'http://x', accessToken: 'z' }] });
  assert.deepEqual(envs.data[0], { id: '0', name: 'a', status: 'online' });
  const ver = projectFixture('app-version', { currentVersion: '1', releaseNotes: 'long' });
  assert.deepEqual(ver, { currentVersion: '1' });
});

function fakes() {
  const made = [];
  const digests = [];
  const warns = [];
  const createPoller = () => {
    const p = { started: 0, stopped: 0, start() { p.started++; }, stop() { p.stopped++; } };
    made.push(p);
    return p;
  };
  const createDigest = (opts) => {
    const d = { opts, started: 0, stopped: 0, start() { d.started++; }, stop() { d.stopped++; } };
    digests.push(d);
    return d;
  };
  const logger = { info() {}, debug() {}, error() {}, warn: (...a) => warns.push(a) };
  return { made, digests, warns, deps: { createPoller, createDigest, logger } };
}
const ON = { ARCANE_URL: 'https://a.test', ARCANE_API_KEY: KEY };

test('startArcane returns a running poller when configured', () => {
  const f = fakes();
  const p = startArcane({ env: ON, demo: false, deps: f.deps });
  assert.equal(p, f.made[0]);
  assert.equal(p.started, 1);
  assert.equal(f.warns.length, 0);
  stopArcane();
});

test('a second startArcane leaves exactly one poller running', () => {
  const f = fakes();
  startArcane({ env: ON, demo: false, deps: f.deps });
  startArcane({ env: ON, demo: false, deps: f.deps });
  assert.equal(f.made[0].stopped, 1);
  assert.equal(f.made[1].stopped, 0);
  stopArcane();
  assert.equal(f.made[1].stopped, 1);
});

test('stopArcane stops the poller and is idempotent', () => {
  const f = fakes();
  startArcane({ env: ON, demo: false, deps: f.deps });
  stopArcane();
  stopArcane();
  assert.equal(f.made[0].stopped, 1);
});

test('http:// URL warns exactly once', () => {
  const f = fakes();
  startArcane({ env: { ...ON, ARCANE_URL: 'http://a.test' }, demo: false, deps: f.deps });
  assert.equal(f.warns.length, 1);
  stopArcane();
});

test('projectFixture keeps the job-run link fields of activities and nothing else', () => {
  const out = projectFixture('activities', {
    success: true,
    data: [
      {
        id: 'j1',
        type: 'job_run',
        status: 'success',
        batchId: 'b1',
        startedAt: 's',
        endedAt: 'e',
        error: '',
        resourceName: 'Auto Update',
        startedBy: { username: 'jag', userId: 'u1' },
        metadata: { trigger: 'scheduled', domainActivityId: 'a1', jobId: 'auto-update', resolution: { by: 'x' } },
      },
      { id: 'a1', type: 'system_prune', status: 'success', metadata: { images: { mode: 'all' } } },
    ],
  });
  // Ids are anonymized; the job run's link still names the activity it points at.
  assert.deepEqual(out.data, [
    {
      id: 'id-01',
      type: 'job_run',
      status: 'success',
      startedAt: 's',
      endedAt: 'e',
      error: '',
      batchId: 'id-02',
      metadata: { trigger: 'scheduled', domainActivityId: 'id-03' },
    },
    { id: 'id-03', type: 'system_prune', status: 'success' },
  ]);
});

test('projectFixture keeps only whether a container check errored', () => {
  const out = projectFixture('containers', {
    data: [
      { names: ['/a'], updateInfo: { hasUpdate: false, error: 'unauthorized for user jag at reg.example' } },
      { names: ['/b'], updateInfo: { hasUpdate: false, error: '' } },
      { names: ['/c'] },
    ],
  });
  assert.deepEqual(out.data.map((c) => c.updateInfo), [
    { hasUpdate: false, error: 'redacted' },
    { hasUpdate: false, error: '' },
    undefined,
  ]);
});

test('startArcane also starts the weekly vulnerability digest, and stopArcane stops it', () => {
  const f = fakes();
  startArcane({
    env: {
      ...ON,
      ARCANE_VULN_DIGEST_DAY: '3',
      ARCANE_VULN_DIGEST_HOUR: '9',
      ARCANE_VULN_DIGEST_ENVS: 'vm-103',
    },
    demo: false,
    deps: f.deps,
  });
  const [d] = f.digests;
  assert.equal(d.started, 1);
  assert.equal(d.opts.day, 3);
  assert.equal(d.opts.hour, 9);
  assert.deepEqual(d.opts.envs, new Set(['vm-103']));
  assert.equal(typeof d.opts.client.vulnSummaries, 'function');
  assert.equal(typeof d.opts.stateStore.getLastRun, 'function');
  assert.equal(typeof d.opts.recordRun, 'function');
  assert.equal(typeof d.opts.dispatch, 'function');
  // A restart leaves exactly one digest running.
  startArcane({ env: ON, demo: false, deps: f.deps });
  assert.equal(d.stopped, 1);
  stopArcane();
  stopArcane();
  assert.equal(f.digests[1].stopped, 1);
});

test('no digest without the integration or in demo mode', () => {
  const f = fakes();
  startArcane({ env: { ARCANE_API_KEY: KEY }, demo: false, deps: f.deps });
  startArcane({ env: ON, demo: true, deps: f.deps });
  assert.equal(f.digests.length, 0);
  stopArcane();
});
