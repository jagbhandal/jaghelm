/**
 * A data source's failures are logged once per failure state (#232, #605):
 * when it starts, with the raw detail and the words a client is told; again
 * when it fails for another reason; never for a raw detail that only varies
 * (a port); and once when it answers again.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSourceHealthLog } from './sourceHealthLog.js';

function recorder() {
  const lines = [];
  const at = (level) => (fields, msg) => lines.push({ level, msg, ...fields });
  return {
    lines,
    logger: { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') },
  };
}

test('one warning when it starts, one per change of words, debug in between, one info when back', () => {
  const { lines, logger } = recorder();
  const report = createSourceHealthLog('prometheus', logger);
  const refused = 'Prometheus refused the connection';
  report(
    { ok: false, error: 'fetch failed: connect ECONNREFUSED 10.0.0.9:9090', words: refused },
    0
  );
  report(
    { ok: false, error: 'fetch failed: connect ECONNREFUSED 10.0.0.9:9091', words: refused },
    30_000
  );
  report(
    {
      ok: false,
      error: 'The operation was aborted due to timeout',
      words: "Prometheus didn't answer in time",
    },
    60_000
  );
  report({ ok: true }, 90_000);
  report({ ok: true }, 120_000);
  assert.deepEqual(
    lines.map((l) => [l.level, l.msg, l.error ?? null, l.words ?? null]),
    [
      [
        'warn',
        'data source failed; push alerts keep its last known state until it recovers',
        'fetch failed: connect ECONNREFUSED 10.0.0.9:9090',
        refused,
      ],
      [
        'debug',
        'data source still failing',
        'fetch failed: connect ECONNREFUSED 10.0.0.9:9091',
        null,
      ],
      [
        'warn',
        'data source failing for another reason',
        'The operation was aborted due to timeout',
        "Prometheus didn't answer in time",
      ],
      ['info', 'data source recovered', null, null],
    ]
  );
  assert.equal(lines[3].downSec, 90);
});

test('without words, a failure is one state however its detail varies', () => {
  const { lines, logger } = recorder();
  const report = createSourceHealthLog('kuma', logger);
  report({ ok: false, error: 'a' }, 0);
  report({ ok: false, error: 'b' }, 1);
  assert.deepEqual(
    lines.map((l) => l.level),
    ['warn', 'debug']
  );
  assert.equal('words' in lines[0], false);
});

test('a new outage after a recovery starts again', () => {
  const { lines, logger } = recorder();
  const report = createSourceHealthLog('kuma', logger);
  const words = 'Kuma refused the connection';
  report({ ok: false, error: 'x', words }, 0);
  report({ ok: true }, 1000);
  report({ ok: false, error: 'y', words }, 2000);
  assert.deepEqual(
    lines.map((l) => [l.level, l.msg]),
    [
      ['warn', 'data source failed; push alerts keep its last known state until it recovers'],
      ['info', 'data source recovered'],
      ['warn', 'data source failed; push alerts keep its last known state until it recovers'],
    ]
  );
});
