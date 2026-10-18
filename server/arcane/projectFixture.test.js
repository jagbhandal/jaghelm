// server/arcane/projectFixture.test.js
// The recorder's projection: only the fields the client reads, anonymized, because
// recorded fixtures are committed to a public repository.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectFixture, createAnonymizer } from './projectFixture.js';

const D1 = 'sha256:' + 'deadbeef'.repeat(8);
const D2 = 'sha256:' + 'cafebabe'.repeat(8);
const D3 = 'sha256:' + 'feedface'.repeat(8);
const wrap = (data) => ({ success: true, data, pagination: { totalItems: data.length } });

const containers = wrap([
  {
    id: 'c1',
    names: ['svc-alpha'],
    image: 'acme/alpha-app:11.2.0',
    labels: { secret: 'x' },
    autoUpdateEnabled: true,
    updateInfo: {
      hasUpdate: true,
      updateType: 'digest',
      currentVersion: '11.2.0',
      latestVersion: '',
      currentDigest: D1,
      latestDigest: D2,
      error: '',
      authRegistry: 'registry.internal.lan',
    },
  },
  {
    names: ['/svc-beta'],
    image: 'acme/beta-app:latest',
    autoUpdateEnabled: false,
    updateInfo: {
      hasUpdate: false,
      currentVersion: 'latest',
      latestVersion: '',
      currentDigest: D1,
      latestDigest: D1,
      error: 'unauthorized: user bob at registry.internal.lan',
    },
  },
  { names: ['nas-sync'], image: D3, autoUpdateEnabled: true },
  {
    names: ['pinned'],
    image: `registry.internal.lan:5000/tools/pinned@${D2}`,
    autoUpdateEnabled: true,
  },
  {
    names: ['plain'],
    image: 'example/untagged',
    autoUpdateEnabled: true,
    updateInfo: { currentVersion: 'v2.0' },
  },
  { names: ['pg'], image: 'acme/gamma-db:14-custom0.1.0', autoUpdateEnabled: false },
]);

test('containers: names, images, tags and digests become stable placeholders', () => {
  const out = projectFixture('containers', containers).data;
  const json = JSON.stringify(out);
  for (const real of [
    'svc-alpha',
    'svc-beta',
    'acme',
    'alpha',
    'beta',
    'nas-sync',
    'pinned',
    'plain',
    'example/untagged',
    'gamma',
    'custom0',
    '11.2.0',
    'registry.internal.lan',
    'bob',
    'secret',
    'deadbeef',
    'cafebabe',
    'feedface',
  ]) {
    assert.equal(json.includes(real), false, `leaked ${real}`);
  }
  assert.deepEqual(
    out.map((c) => c.names[0]),
    ['ctr-01', '/ctr-02', 'ctr-03', 'ctr-04', 'ctr-05', 'ctr-06'],
    'numbered by first appearance; a leading slash is kept as shape'
  );
  assert.deepEqual(
    out.map((c) => c.image),
    [
      'registry.example/img-01:1.0.0',
      'registry.example/img-02:latest',
      out[2].image,
      `registry.example/img-03@${out[0].updateInfo.latestDigest}`,
      'registry.example/img-04',
      'registry.example/img-05:tag-01',
    ]
  );
  assert.match(out[2].image, /^sha256:[0-9a-f]{64}$/, 'a bare image id stays a bare digest');
  const [a, b] = out;
  // Equal stays equal, different stays different, and the 19-character prefix differs too.
  assert.equal(a.updateInfo.currentDigest, b.updateInfo.currentDigest);
  assert.equal(b.updateInfo.currentDigest, b.updateInfo.latestDigest);
  assert.notEqual(a.updateInfo.currentDigest, a.updateInfo.latestDigest);
  assert.notEqual(a.updateInfo.currentDigest.slice(0, 19), a.updateInfo.latestDigest.slice(0, 19));
  assert.match(a.updateInfo.latestDigest, /^sha256:[0-9a-f]{64}$/);
  // Tag classes: semver-shaped -> placeholder (v prefix kept), latest kept, empty kept.
  assert.equal(a.updateInfo.currentVersion, '1.0.0');
  assert.equal(a.updateInfo.latestVersion, '');
  assert.equal(b.updateInfo.currentVersion, 'latest');
  assert.equal(out[4].updateInfo.currentVersion, 'v1.0.1');
  // Shape kept: unread fields dropped, error redacted, missing updateInfo stays missing.
  assert.deepEqual(Object.keys(a).sort(), ['autoUpdateEnabled', 'image', 'names', 'updateInfo']);
  assert.equal(a.updateInfo.error, '');
  assert.equal(b.updateInfo.error, 'redacted');
  assert.equal('updateInfo' in out[2], false);
  assert.equal('authRegistry' in a.updateInfo, false);
});

test('environments: local id "0" and names kept, other ids become fixed fake UUIDs', () => {
  const real = '11111111-2222-4333-8444-555555555555';
  const out = projectFixture(
    'environments',
    wrap([
      { id: '0', name: 'vm-103', status: 'online', enabled: true, apiUrl: 'http://10.0.0.5:3552' },
      { id: real, name: 'pi-1', status: 'standby', enabled: true, edgeSessionId: 'abc' },
    ])
  ).data;
  assert.deepEqual(out, [
    { id: '0', name: 'vm-103', status: 'online', enabled: true },
    { id: '00000000-0000-4000-8000-000000000001', name: 'pi-1', status: 'standby', enabled: true },
  ]);
});

test('activity and history error text is redacted like container errors', () => {
  const acts = projectFixture(
    'activities',
    wrap([
      {
        id: 'a1',
        type: 'auto_update',
        status: 'failed',
        startedAt: 't',
        error: 'pull denied for registry.internal.lan/bob',
      },
      { id: 'a2', type: 'auto_update', status: 'success', startedAt: 't', error: '' },
      { id: 'a3', type: 'auto_update', status: 'success', startedAt: 't' },
    ])
  ).data;
  assert.deepEqual(
    acts.map((a) => a.error),
    ['redacted', '', undefined]
  );
  assert.equal('error' in acts[2], false);
  const hist = projectFixture(
    'history',
    wrap([{ id: 'h1', createdAt: 't', resourceName: 'x', status: 'failed', error: 'auth for bob' }])
  ).data;
  assert.equal(hist[0].error, 'redacted');
});

test('an image check keeps its count summary; any other text is still redacted', () => {
  const sum = 'Image update check completed: 34 checked, 2 errors';
  const acts = projectFixture(
    'activities',
    wrap([
      {
        id: 'a1',
        type: 'image_update_check',
        status: 'failed',
        startedAt: 't',
        latestMessage: sum,
        error: sum,
      },
      {
        id: 'a2',
        type: 'image_update_check',
        status: 'failed',
        startedAt: 't',
        latestMessage: 'Checking registry.internal.lan/bob/app:1',
        error: `${sum}: registry.internal.lan`,
      },
      {
        id: 'a3',
        type: 'image_update_check',
        status: 'success',
        startedAt: 't',
        latestMessage: `${sum}, 1 tag policy errors`,
      },
    ])
  ).data;
  assert.deepEqual(
    acts.map((a) => [a.latestMessage, a.error]),
    [
      [sum, sum],
      [undefined, 'redacted'],
      [`${sum}, 1 tag policy errors`, undefined],
    ]
  );
  assert.equal('latestMessage' in acts[1], false);
});

test('every id is anonymized; a job run still links to its activity across files', () => {
  const U1 = 'aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb'; // a batch (job run) id
  const U2 = 'cccccccc-4444-4555-8666-dddddddddddd'; // an activity id
  const U3 = 'eeeeeeee-7777-4888-9999-ffffffffffff'; // a history row id
  const anon = createAnonymizer();
  const acts = projectFixture(
    'activities',
    wrap([
      {
        id: `image-check-${U1}-1`,
        type: 'image_update_check',
        status: 'success',
        startedAt: 't',
        batchId: U1,
      },
      { id: U2, type: 'auto_update', status: 'success', startedAt: 't', batchId: U1 },
      { id: 'act-local-7', type: 'system_prune', status: 'success', startedAt: 't' },
    ]),
    anon
  ).data;
  const jobs = projectFixture(
    'activities',
    wrap([
      {
        id: 'job-run-xyz',
        type: 'job_run',
        status: 'success',
        startedAt: 't',
        batchId: U1,
        metadata: { trigger: 'scheduled', domainActivityId: U2, environmentId: U3 },
      },
      {
        id: 'job-run-q',
        type: 'job_run',
        status: 'running',
        startedAt: 't',
        metadata: { domainActivityId: '' },
      },
    ]),
    anon
  ).data;
  const hist = projectFixture(
    'history',
    wrap([{ id: U3, createdAt: 't', resourceName: 'x', status: 'updated' }]),
    anon
  ).data;
  const json = JSON.stringify([acts, jobs, hist]);
  for (const real of [U1, U2, U3, 'aaaaaaaa', 'cccccccc', 'eeeeeeee', 'act-local-7', 'job-run-']) {
    assert.equal(json.includes(real), false, `leaked ${real}`);
  }
  const FAKE = /^00000000-0000-4000-8000-\d{12}$/;
  // The shape around a UUID is kept: image-check-<uuid>-<n>, with the same fake as its batch.
  assert.match(acts[0].batchId, FAKE);
  assert.equal(acts[0].id, `image-check-${acts[0].batchId}-1`);
  assert.equal(acts[1].batchId, acts[0].batchId);
  assert.match(acts[1].id, FAKE);
  assert.match(acts[2].id, /^id-\d\d$/, 'an id without a UUID becomes a placeholder');
  // Across files the job run still names its activity and its batch; an empty link stays empty.
  assert.equal(jobs[0].metadata.domainActivityId, acts[1].id);
  assert.equal(jobs[0].batchId, acts[0].batchId);
  assert.deepEqual(Object.keys(jobs[0].metadata).sort(), ['domainActivityId', 'trigger']);
  assert.match(jobs[0].id, /^id-\d\d$/);
  assert.equal(jobs[1].metadata.domainActivityId, '');
  assert.match(hist[0].id, FAKE);
});

test('one anonymizer across files keeps a container the same name and image everywhere', () => {
  const anon = createAnonymizer();
  const c = projectFixture(
    'containers',
    wrap([{ names: ['/svc-delta'], image: 'acme/delta-app:1.22.3', autoUpdateEnabled: true }]),
    anon
  ).data;
  const h = projectFixture(
    'history',
    wrap([
      {
        id: 'h1',
        createdAt: '2026-10-17T03:00:40.123456789Z',
        resourceName: 'svc-delta',
        status: 'updated',
        oldImageVersions: { main: 'acme/delta-app:1.22.3' },
        newImageVersions: { main: 'acme/delta-app:1.22.4' },
      },
    ]),
    anon
  ).data;
  assert.equal(c[0].names[0], '/ctr-01');
  assert.equal(h[0].resourceName, 'ctr-01');
  assert.equal(h[0].oldImageVersions.main, c[0].image);
  assert.equal(h[0].newImageVersions.main, 'registry.example/img-01:1.0.1');
  assert.equal(h[0].createdAt, '2026-10-17T03:00:40.123456789Z');
});

test('app-version is public and passes through (projected to the read fields)', () => {
  const body = {
    currentVersion: 'v2.16.1',
    newestVersion: 'v2.17.0',
    updateAvailable: true,
    releaseUrl: 'u',
    goVersion: 'x',
  };
  assert.deepEqual(projectFixture('app-version', body), {
    currentVersion: 'v2.16.1',
    newestVersion: 'v2.17.0',
    updateAvailable: true,
    releaseUrl: 'u',
  });
});
