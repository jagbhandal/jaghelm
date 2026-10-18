import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCronReport } from './cronBridge.js';

test('buildCronReport builds a valid report', () => {
  assert.deepEqual(
    buildCronReport({ job: 'arcane-update', env: { name: 'pi-1' }, cronStatus: 'success', error: '' }),
    { job: 'arcane-update', node: 'pi-1', status: 'success', expected_every_seconds: 86400 },
  );
  const f = buildCronReport({ job: 'arcane-prune', env: { name: 'vm-103' }, cronStatus: 'failure', error: 'x' });
  assert.equal(f.error, 'x');
});

test('buildCronReport rejects bad input', () => {
  assert.equal(buildCronReport({ job: 'other', env: { name: 'pi-1' }, cronStatus: 'success' }), null);
  assert.equal(buildCronReport({ job: 'arcane-update', env: { name: 'a:b' }, cronStatus: 'success' }), null);
  assert.equal(buildCronReport({ job: 'arcane-update', env: { name: 'pi-1' }, cronStatus: 'partial' }), null);
  assert.equal(buildCronReport({ job: 'arcane-update', env: { name: '__proto__' }, cronStatus: 'success' }), null);
});

test('buildCronReport caps error at 2048', () => {
  const r = buildCronReport({ job: 'arcane-update', env: { name: 'pi-1' }, cronStatus: 'failure', error: 'e'.repeat(5000) });
  assert.equal(r.error.length, 2048);
});

test('buildCronReport: arcane-check expects the image watcher interval', () => {
  const r = (expectedEverySeconds) =>
    buildCronReport({ job: 'arcane-check', env: { name: 'pi-1' }, cronStatus: 'success', expectedEverySeconds });
  assert.deepEqual(r(undefined), { job: 'arcane-check', node: 'pi-1', status: 'success', expected_every_seconds: 21600 });
  assert.equal(r(3600).expected_every_seconds, 3600);
  // Outside what the cron store accepts (60 s to 31 days), or not an integer: the default.
  for (const bad of [59, 2678401, 1.5, '3600', NaN]) assert.equal(r(bad).expected_every_seconds, 21600, String(bad));
  // The update and prune jobs keep their daily interval unless told otherwise.
  assert.equal(
    buildCronReport({ job: 'arcane-prune', env: { name: 'pi-1' }, cronStatus: 'success' }).expected_every_seconds,
    86400,
  );
  assert.equal(buildCronReport({ job: 'toString', env: { name: 'pi-1' }, cronStatus: 'success' }), null);
});
