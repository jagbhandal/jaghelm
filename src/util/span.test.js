import test from 'node:test';
import assert from 'node:assert/strict';

import { fmtSpan } from './span.js';

// span.js is pure (no React/DOM): runs under node:test, excluded from vitest.
test('fmtSpan formats minutes, hours and days', () => {
  assert.equal(fmtSpan(900), '15m');
  assert.equal(fmtSpan(86400), '24h');
  assert.equal(fmtSpan(111600), '31h');
  assert.equal(fmtSpan(2678400), '31d');
});
