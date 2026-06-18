import test from 'node:test';
import assert from 'node:assert/strict';

import {
  usageSeverity,
  cardSeverity,
  severityColor,
  severityLabel,
  USAGE_CRITICAL,
  USAGE_WARN,
} from './thresholds.js';

// thresholds.js is pure (no React/DOM), so it runs under node:test alongside
// gridMath.test.js (and is excluded from the vitest client run in vite.config).

test('usageSeverity flags critical above 90, warn above 70, null otherwise', () => {
  assert.equal(usageSeverity(95), 'critical');
  assert.equal(usageSeverity(91), 'critical');
  assert.equal(usageSeverity(80), 'warn');
  assert.equal(usageSeverity(71), 'warn');
  assert.equal(usageSeverity(70), null);
  assert.equal(usageSeverity(10), null);
});

test('usageSeverity boundaries are exclusive (match the existing bar thresholds)', () => {
  assert.equal(usageSeverity(USAGE_CRITICAL), 'warn'); // exactly 90 → still warn (>70, not >90)
  assert.equal(usageSeverity(USAGE_CRITICAL + 0.1), 'critical');
  assert.equal(usageSeverity(USAGE_WARN), null); // exactly 70 → normal
  assert.equal(usageSeverity(USAGE_WARN + 0.1), 'warn');
});

test('usageSeverity returns null for missing / non-numeric input', () => {
  assert.equal(usageSeverity(null), null);
  assert.equal(usageSeverity(undefined), null);
  assert.equal(usageSeverity(NaN), null);
});

test('cardSeverity returns the worst severity across metrics (by real usage)', () => {
  assert.equal(cardSeverity([{ percent: 30 }, { percent: 95 }, { percent: 50 }]), 'critical');
  assert.equal(cardSeverity([{ percent: 30 }, { percent: 80 }]), 'warn');
  assert.equal(cardSeverity([{ percent: 30 }, { percent: 40 }]), null);
});

test('cardSeverity ignores cache-inflated usage for the card halo', () => {
  // 60% real usage but 95% with reclaimable cache → not a critical CARD.
  assert.equal(cardSeverity([{ percent: 60, withCachePercent: 95 }]), null);
});

test('cardSeverity handles empty / missing / percent-less metrics', () => {
  assert.equal(cardSeverity([]), null);
  assert.equal(cardSeverity(undefined), null);
  assert.equal(cardSeverity([{ label: 'count', value: 3 }]), null);
});

test('severityColor maps severities to tokens, falling back for normal', () => {
  assert.equal(severityColor('critical', 'x'), 'var(--red)');
  assert.equal(severityColor('warn', 'x'), 'var(--amber)');
  assert.equal(severityColor(null, 'var(--accent)'), 'var(--accent)');
});

test('severityLabel gives a non-color label for screen readers', () => {
  assert.equal(severityLabel('critical'), 'critical');
  assert.equal(severityLabel('warn'), 'elevated');
  assert.equal(severityLabel(null), null);
});
