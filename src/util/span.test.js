import test from 'node:test';
import assert from 'node:assert/strict';

import { fmtSpan } from './span.js';

// span.js is pure (no React/DOM): runs under node:test, excluded from vitest.
test('fmtSpan formats minutes, hours and days', () => {
  const cases = [[900, '15m'], [3600, '60m'], [4501, '75m'], [7200, '2h'], [86400, '24h'],
    [111600, '31h'], [2678400, '31d'], [-5, '0m']];
  for (const [s, want] of cases) assert.equal(fmtSpan(s), want, String(s));
});
