import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, servicesConfigSchema, displayConfigSchema } from './configSchema.js';

test('rejects non-object bodies (400)', () => {
  for (const bad of [null, undefined, 'str', 42, [1, 2], true]) {
    const r = validateConfig(servicesConfigSchema, bad);
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
  }
});

test('accepts a valid services config and passes through forward-compat keys', () => {
  const r = validateConfig(servicesConfigSchema, {
    nodes: { vm103: {} },
    services: {},
    customFutureKey: 'x',
  });
  assert.equal(r.ok, true);
  assert.equal(r.data.customFutureKey, 'x');
});

test('rejects oversized config (413)', () => {
  const r = validateConfig(servicesConfigSchema, { blob: 'x'.repeat(600 * 1024) });
  assert.equal(r.ok, false);
  assert.equal(r.status, 413);
});

test('rejects wrong-typed known structural field', () => {
  // services must be an object map, not an array
  const r = validateConfig(servicesConfigSchema, { services: [1, 2, 3] });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

test('displayConfig: bounds refreshInterval to a sane range', () => {
  assert.equal(validateConfig(displayConfigSchema, { refreshInterval: 0 }).ok, false);
  assert.equal(validateConfig(displayConfigSchema, { refreshInterval: 999999 }).ok, false);
  assert.equal(validateConfig(displayConfigSchema, { refreshInterval: 30 }).ok, true);
});

test('displayConfig: validates known fields but allows unknown ones through', () => {
  assert.equal(validateConfig(displayConfigSchema, { theme: 123 }).ok, false);
  const ok = validateConfig(displayConfigSchema, { theme: 'dark', someNewToggle: true });
  assert.equal(ok.ok, true);
  assert.equal(ok.data.someNewToggle, true);
});
