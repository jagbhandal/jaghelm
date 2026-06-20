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

test('rejects a nested __proto__ key, not just top-level (recursive guard)', () => {
  // Built via JSON.parse (as express.json() does) so __proto__ is an OWN key — an
  // object literal's __proto__: would set the prototype instead, which isn't the vector.
  const body = JSON.parse('{"services":{"evil":{"__proto__":{"polluted":true}}}}');
  const r = validateConfig(servicesConfigSchema, body);
  assert.equal(r.ok, false);
  assert.match(r.error, /Reserved key/);
});

test('rejects a javascript: link URL at the persistence boundary (stored XSS)', () => {
  const r = validateConfig(servicesConfigSchema, {
    links: [{ name: 'x', url: "javascript:fetch('/api/secrets')" }],
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /Unsafe URL/);
  // http(s)/relative links still pass
  assert.equal(validateConfig(servicesConfigSchema, { links: [{ name: 'ok', url: 'https://h/x' }] }).ok, true);
  assert.equal(validateConfig(servicesConfigSchema, { links: [{ name: 'rel', url: '/local' }] }).ok, true);
});
