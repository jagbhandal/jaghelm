/**
 * Tests for registry preset validation.
 *
 * Run with:  node --test server/integrations/registry.test.js
 *
 * We test the pure validation function directly (via the __test__ export)
 * rather than driving initRegistry through fixtures on disk — that keeps
 * the test fast, deterministic, and free of fs/import-cache weirdness.
 * The exception is which files initRegistry picks up from the directory:
 * that's driven through a fresh temp dir (unique path, so no import cache)
 * and through the shipped presets/ dir.
 *
 * If you change REQUIRED_KEYS or ALLOWED_KEYS in registry.js, update the
 * "valid preset" fixture below so this file stays representative.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { __test__, initRegistry, getPreset } from './registry.js';
import { createLogger } from '../util/logger.js';
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

test('initRegistry does not import *.test.js files next to the presets', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'jaghelm-presets-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  writeFileSync(join(dir, 'fixturepreset.js'), `export default ${JSON.stringify(makeValidPreset())};\n`);
  // A test file beside the preset it covers, like presets/gitlab.test.js.
  // Importing it would run its node:test suite inside the server process.
  writeFileSync(join(dir, 'fixturepreset.test.js'), 'globalThis.__jaghelmPresetTestImported = true;\n');

  await initRegistry(dir);

  assert.equal(globalThis.__jaghelmPresetTestImported, undefined, 'a .test.js file must not be imported');
  assert.equal(getPreset('fixturepreset.test'), null, 'a .test.js file must not register a preset');
  assert.equal(getPreset('fixturepreset')?.name, 'Test Integration', 'the preset beside it still loads');
});

test('initRegistry loads the shipped presets/ dir without logging errors', async (t) => {
  // The logger writes warn/error lines to stderr as JSON. Before the fix, the
  // test files in presets/ each logged "Skipping invalid preset" at startup.
  const errors = [];
  t.mock.method(process.stderr, 'write', (chunk) => {
    for (const line of String(chunk).split('\n')) {
      if (line.includes('"level":"error"')) errors.push(line);
    }
    return true;
  });

  // Positive control: LOG_LEVEL=silent would hide every error line and let
  // this test pass without checking anything.
  createLogger('registry.test').error('probe');
  await initRegistry();
  t.mock.restoreAll();

  const isProbe = (line) => line.includes('"module":"registry.test"');
  assert.equal(errors.filter(isProbe).length, 1, 'error lines are not reaching stderr (LOG_LEVEL=silent?)');
  assert.deepEqual(errors.filter((line) => !isProbe(line)), [], 'no preset in presets/ should fail to load');
});
