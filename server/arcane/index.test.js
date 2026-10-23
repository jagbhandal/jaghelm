import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startArcane, stopArcane } from './index.js';
import { DIGEST, POLLER } from './notices.js';
import { projectFixture } from './projectFixture.js';
import { createPushSnapshot } from '../push/dispatch.js';

const KEY = 'test-key-123'; // pragma: allowlist secret
// The push snapshot and sender boot() hands over (#581): here, ones that keep nothing.
const push = {
  snapshot: { producerState: () => undefined, unreadable: () => false, notify() {} },
  sender: { wake() {} },
};

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
  const createPoller = (opts) => {
    const p = { opts, started: 0, stopped: 0, start() { p.started++; }, stop() { p.stopped++; } };
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
  const p = startArcane({ env: ON, demo: false, push, deps: f.deps });
  assert.equal(p, f.made[0]);
  assert.equal(p.started, 1);
  assert.equal(f.warns.length, 0);
  stopArcane();
});

test('a second startArcane leaves exactly one poller running', () => {
  const f = fakes();
  startArcane({ env: ON, demo: false, push, deps: f.deps });
  startArcane({ env: ON, demo: false, push, deps: f.deps });
  assert.equal(f.made[0].stopped, 1);
  assert.equal(f.made[1].stopped, 0);
  stopArcane();
  assert.equal(f.made[1].stopped, 1);
});

test('stopArcane stops the poller and is idempotent', () => {
  const f = fakes();
  startArcane({ env: ON, demo: false, push, deps: f.deps });
  stopArcane();
  stopArcane();
  assert.equal(f.made[0].stopped, 1);
});

test('http:// URL warns exactly once', () => {
  const f = fakes();
  startArcane({ env: { ...ON, ARCANE_URL: 'http://a.test' }, demo: false, push, deps: f.deps });
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
    push,
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
  assert.equal(typeof d.opts.notices.commit, 'function');
  // A restart leaves exactly one digest running.
  startArcane({ env: ON, demo: false, push, deps: f.deps });
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

test('an ARCANE_URL whose password the parser reads as a port (#419): no poller or digest, no request, the key never sent', async () => {
  const realFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push([String(url), JSON.stringify(init?.headers ?? {})]);
    throw new Error('no network in this test');
  };
  try {
    for (const c of ['/', '#', '?']) {
      const f = fakes();
      const env = { ARCANE_URL: `https://jag:4321${c}hunter2@a.test`, ARCANE_API_KEY: KEY }; // pragma: allowlist secret
      assert.equal(startArcane({ env, demo: false, deps: f.deps }), null, c);
      assert.deepEqual([f.made.length, f.digests.length], [0, 0], 'nothing that would request');
      assert.equal(f.warns.length, 1);
      assert.ok(!JSON.stringify(f.warns).includes('hunter2'));
    }
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(requests, [], 'nothing requested');
  } finally {
    globalThis.fetch = realFetch;
    stopArcane();
  }
});

test('#581: startArcane opens the poller\'s and the digest\'s state from the push snapshot, migrating the old files once, and their commits go to its outbox and history', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'jh-581-index-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'arcane-state.json'), JSON.stringify({ envs: { 'vm-103': { known: true, agent: null, activities: ['a1'] } }, release: { notified: 'v9' } }));
  writeFileSync(join(dir, 'arcane-vuln-state.json'), JSON.stringify({ lastRunMs: 5, envs: {}, order: [] }));
  const snapshot = createPushSnapshot({ path: join(dir, 'push-snapshot.json'), logger: { debug() {}, info() {}, warn() {}, error() {} } });
  let woken = 0;
  const f = fakes();
  startArcane({
    env: { ...ON, ARCANE_VULN_DIGEST_ENVS: 'vm-103' },
    demo: false,
    push: { snapshot, sender: { wake: () => (woken += 1) } },
    isPushEnabled: () => true,
    dir,
    deps: f.deps,
  });
  t.after(stopArcane);
  const [p] = f.made;
  const [d] = f.digests;
  assert.equal(p.opts.stateStore.hasActivity('vm-103', 'a1'), true, 'from the old file');
  assert.equal(p.opts.stateStore.getReleaseNotified(), 'v9');
  assert.equal(d.opts.stateStore.getLastRun(), 5);
  assert.deepEqual(Object.keys(snapshot.producerState(POLLER)), ['state', 'heldBack']);
  assert.equal(snapshot.producerState(DIGEST).vulns.lastRunMs, 5);

  const update = { type: 'arcane_update', id: 'arcane:vm-103:update', node: 'vm-103', title: 'Updates · vm-103', body: '1 updated: gitea', severity: 'info' };
  p.opts.stateStore.addActivity('vm-103', 'a2');
  p.opts.notices.commit([update]);
  assert.deepEqual(snapshot.outbox(), [update]);
  assert.equal(woken, 1);
  assert.deepEqual(snapshot.events().events.map((e) => [e.type, e.push.state]), [['arcane_update', 'queued']]);
  assert.ok(snapshot.producerState(POLLER).state.envs['vm-103'].activities.includes('a2'));
});
