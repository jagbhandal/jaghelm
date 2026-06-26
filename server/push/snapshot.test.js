import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeServiceStatus,
  normalizeCronStatus,
  normalizeUpsStatus,
  coerceFraction,
} from './snapshot.js';

test('normalizeServiceStatus: up/down recognized, everything else unknown', () => {
  assert.equal(normalizeServiceStatus('up'), 'up');
  assert.equal(normalizeServiceStatus('down'), 'down');
  assert.equal(normalizeServiceStatus('UP'), 'up'); // case-insensitive
  assert.equal(normalizeServiceStatus('running'), 'unknown');
  assert.equal(normalizeServiceStatus('unknown'), 'unknown');
  assert.equal(normalizeServiceStatus(null), 'unknown');
  assert.equal(normalizeServiceStatus(undefined), 'unknown');
  assert.equal(normalizeServiceStatus(''), 'unknown');
});

test('normalizeCronStatus: success/failure recognized, else unknown', () => {
  assert.equal(normalizeCronStatus('success'), 'success');
  assert.equal(normalizeCronStatus('failure'), 'failure');
  assert.equal(normalizeCronStatus('FAILURE'), 'failure');
  assert.equal(normalizeCronStatus('pending'), 'unknown');
  assert.equal(normalizeCronStatus(null), 'unknown');
  assert.equal(normalizeCronStatus(undefined), 'unknown');
});

test('normalizeUpsStatus: numeric nut_status mapped, else unknown', () => {
  // Canonical NUT decode (matches src/components/Widgets.jsx:22):
  // 0=Unknown, 1=Online (OL), 2=On Battery (OB), 3=Low Battery (LB).
  assert.equal(normalizeUpsStatus(1), 'online'); // OL
  assert.equal(normalizeUpsStatus(2), 'on_battery'); // OB
  assert.equal(normalizeUpsStatus(0), 'unknown'); // Unknown
  assert.equal(normalizeUpsStatus(3), 'on_battery'); // Low Battery folds into on_battery
  assert.equal(normalizeUpsStatus('online'), 'online'); // string passthrough
  assert.equal(normalizeUpsStatus('on_battery'), 'on_battery');
  assert.equal(normalizeUpsStatus(7), 'unknown'); // unrecognized code
  assert.equal(normalizeUpsStatus(null), 'unknown');
  assert.equal(normalizeUpsStatus(undefined), 'unknown');
  assert.equal(normalizeUpsStatus('garbage'), 'unknown');
});

test('coerceFraction: percent-string 0..100 -> 0..1 fraction, clamped, junk -> 0', () => {
  assert.equal(coerceFraction('45.6'), 0.456);
  assert.equal(coerceFraction('100'), 1);
  assert.equal(coerceFraction('0'), 0);
  assert.equal(coerceFraction(90), 0.9); // bare number percent
  assert.equal(coerceFraction(null), 0);
  assert.equal(coerceFraction(undefined), 0);
  assert.equal(coerceFraction('NaN'), 0);
  assert.equal(coerceFraction('150'), 1); // clamp high
  assert.equal(coerceFraction('-5'), 0); // clamp low
});
