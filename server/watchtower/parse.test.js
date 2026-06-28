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
  assert.deepEqual(parseWatchtowerReport(''), { updated: [], failed: [] });
  assert.deepEqual(parseWatchtowerReport('\n  \ngibberish\nscanned|5'), { updated: [], failed: [] });
  assert.deepEqual(parseWatchtowerReport(null), { updated: [], failed: [] });
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
