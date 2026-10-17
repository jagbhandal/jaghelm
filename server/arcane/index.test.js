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
        names: ['/x'],
        image: 'img:1',
        autoUpdateEnabled: false,
        updateInfo: { hasUpdate: true, currentVersion: '1', latestVersion: '2' },
      },
    ],
  });
  assert.equal(JSON.stringify(out).includes('TOKEN'), false);
  const envs = projectFixture('environments', { success: true, data: [{ id: '0', name: 'a', status: 'online', apiUrl: 'http://x', accessToken: 'z' }] });
  assert.deepEqual(envs.data[0], { id: '0', name: 'a', status: 'online' });
  const ver = projectFixture('app-version', { currentVersion: '1', releaseNotes: 'long' });
  assert.deepEqual(ver, { currentVersion: '1' });
});
