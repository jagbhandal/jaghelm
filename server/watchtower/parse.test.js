// server/watchtower/parse.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWatchtowerReport } from './parse.js';

test('parses updated and failed records', () => {
  const msg = 'updated|immich-server|1a2b|9f8e\nupdated|radarr|v5.3.6|v5.4.0\nfailed|sonarr|pull error';
  const r = parseWatchtowerReport(msg);
  assert.deepEqual(r.updated, [
    { name: 'immich-server', from: '1a2b', to: '9f8e' },
    { name: 'radarr', from: 'v5.3.6', to: 'v5.4.0' },
  ]);
  assert.deepEqual(r.failed, [{ name: 'sonarr', error: 'pull error' }]);
});

test('ignores blank and unknown lines; tolerates non-string', () => {
  assert.deepEqual(parseWatchtowerReport(''), { updated: [], failed: [], stale: [] });
  assert.deepEqual(parseWatchtowerReport('\n  \ngibberish\nscanned|5'), { updated: [], failed: [], stale: [] });
  assert.deepEqual(parseWatchtowerReport(null), { updated: [], failed: [], stale: [] });
});

test('parses stale (held-back / monitor-only) records', () => {
  const r = parseWatchtowerReport('stale|vaultwarden|1a2b|9f8e\nstale|adguard|aaaa|bbbb');
  assert.deepEqual(r.stale, [
    { name: 'vaultwarden', current: '1a2b', latest: '9f8e' },
    { name: 'adguard', current: 'aaaa', latest: 'bbbb' },
  ]);
});

test('parses a mixed report of updated, failed, and stale', () => {
  const r = parseWatchtowerReport('updated|radarr|v1|v2\nfailed|sonarr|pull error\nstale|vaultwarden|1a2b|9f8e');
  assert.deepEqual(r.updated, [{ name: 'radarr', from: 'v1', to: 'v2' }]);
  assert.deepEqual(r.failed, [{ name: 'sonarr', error: 'pull error' }]);
  assert.deepEqual(r.stale, [{ name: 'vaultwarden', current: '1a2b', latest: '9f8e' }]);
});

test('a stale record with too few fields is ignored', () => {
  assert.deepEqual(parseWatchtowerReport('stale|onlyname'), { updated: [], failed: [], stale: [] });
});

test('proto-pollution: a __proto__ stale container name stays a value, never a key', () => {
  const r = parseWatchtowerReport('stale|__proto__|a|b');
  assert.equal(r.stale[0].name, '__proto__');
  assert.equal(({}).polluted, undefined);
});

test('failed error may contain pipes; rejoined', () => {
  const r = parseWatchtowerReport('failed|app|exit code 1 | retrying');
  assert.deepEqual(r.failed, [{ name: 'app', error: 'exit code 1 | retrying' }]);
});

test('proto-pollution: a __proto__ container name stays a value, never a key', () => {
  const r = parseWatchtowerReport('updated|__proto__|a|b');
  assert.equal(r.updated[0].name, '__proto__');
  assert.equal(({}).polluted, undefined);
});

test('caps records at 500 so a pathological body cannot blow up downstream work', () => {
  const msg = Array.from({ length: 600 }, (_, i) => `updated|c${i}|1|2`).join('\n');
  const r = parseWatchtowerReport(msg);
  assert.equal(r.updated.length, 500);
});
