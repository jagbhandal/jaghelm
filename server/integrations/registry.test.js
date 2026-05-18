/**
 * Tests for registry preset validation.
 *
 * Run with:  node --test server/integrations/registry.test.js
 *
 * We test the pure validation function directly (via the __test__ export)
 * rather than driving initRegistry through fixtures on disk — that keeps
 * the test fast, deterministic, and free of fs/import-cache weirdness.
 *
 * If you change REQUIRED_KEYS or ALLOWED_KEYS in registry.js, update the
 * "valid preset" fixture below so this file stays representative.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { __test__ } from './registry.js';
const { validatePreset } = __test__;

// A minimal preset that satisfies REQUIRED_KEYS and uses only allowed keys.
// Mirrors the shape of an Arr preset (the simplest auth-using preset).
function makeValidPreset(overrides = {}) {
  return {
    name: 'Test Integration',
    icon: 'test-icon',
    description: 'Fixture preset for registry tests',
    auth: 'header',
    authHeader: 'X-Api-Key',
    endpoint: '/api/v1/queue',
    testEndpoint: '/api/v1/status',
    fields: [
      { key: 'count', label: 'Count', path: 'total', format: 'number' },
    ],
    envKeys: { url: 'TEST_URL', token: 'TEST_TOKEN' },
    ...overrides,
  };
}

test('valid preset passes validation untouched', () => {
  const preset = makeValidPreset();
  const before = { ...preset };
  const { ok, errors, warnings } = validatePreset('test.js', preset);

  assert.equal(ok, true, 'valid preset should pass');
  assert.deepEqual(errors, [], 'no errors expected');
  assert.deepEqual(warnings, [], 'no warnings expected');
  // No keys should have been stripped from a fully-valid preset.
  assert.deepEqual(preset, before, 'preset shape should be unchanged');
});

test('preset missing required key is rejected (and not mutated)', () => {
  // Drop `endpoint` — handler.js can't fetch without it.
  const preset = makeValidPreset();
  delete preset.endpoint;
  const snapshot = JSON.stringify(preset);

  const { ok, errors } = validatePreset('broken.js', preset);

  assert.equal(ok, false, 'should reject preset missing required key');
  assert.ok(
    errors.some(e => e.includes('endpoint')),
    `error should mention 'endpoint', got: ${JSON.stringify(errors)}`,
  );
  // Caller is going to drop the preset — leaving it untouched is fine, and
  // verifying that means tests can reuse the fixture without surprise mutation.
  assert.equal(JSON.stringify(preset), snapshot, 'rejected preset should not be mutated');
});

test('preset missing multiple required keys reports all of them', () => {
  // Stress test: ensure we don't bail on the first missing key.
  const preset = makeValidPreset();
  delete preset.endpoint;
  delete preset.icon;

  const { ok, errors } = validatePreset('very-broken.js', preset);

  assert.equal(ok, false);
  assert.ok(errors.some(e => e.includes('endpoint')), 'should flag endpoint');
  assert.ok(errors.some(e => e.includes('icon')), 'should flag icon');
});

test('unknown top-level key triggers warning and is stripped from preset', () => {
  // `transform` is the classic typo that motivated this validation —
  // it used to live in npm.js but handler.js reads `structuredTransform`.
  const preset = makeValidPreset({ transform: 'npm', mysteryField: 42 });

  const { ok, warnings } = validatePreset('typo.js', preset);

  assert.equal(ok, true, 'unknown keys are non-fatal');
  assert.ok(
    warnings.some(w => w.includes('transform')),
    `warning should mention 'transform', got: ${JSON.stringify(warnings)}`,
  );
  assert.ok(
    warnings.some(w => w.includes('mysteryField')),
    `warning should mention 'mysteryField', got: ${JSON.stringify(warnings)}`,
  );
  assert.equal('transform' in preset, false, 'unknown key should be stripped');
  assert.equal('mysteryField' in preset, false, 'unknown key should be stripped');
  // Required + allowed keys should still be present.
  assert.equal(preset.endpoint, '/api/v1/queue', 'allowed keys must survive');
});

test('null/non-object default export is rejected gracefully', () => {
  // import(...).default can be undefined if a preset file exports nothing —
  // validation should reject cleanly rather than throwing.
  for (const bad of [null, undefined, 'string', 42, []]) {
    const { ok, errors } = validatePreset('garbage.js', bad);
    assert.equal(ok, false, `expected reject for ${typeof bad} ${JSON.stringify(bad)}`);
    assert.ok(errors.length > 0, 'should produce at least one error');
  }
});
