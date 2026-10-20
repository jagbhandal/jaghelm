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

test('accepts the links object a pre-#265 generated services.yaml carries, still scanning its URLs', () => {
  const generated = { nodes: {}, services: {}, links: { personal: [], management: [], devops: [] } };
  assert.equal(validateConfig(servicesConfigSchema, generated).ok, true);
  const r = validateConfig(servicesConfigSchema, {
    links: { personal: [{ name: 'x', url: "javascript:fetch('/api/secrets')" }] },
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /Unsafe URL/);
});

// #240: the monitor mapping of a container, `monitor` and `monitor_per_node`.
test('services: a monitor mapping is a monitor name, false, or null', () => {
  const ok = validateConfig(servicesConfigSchema, {
    nodes: { pi1: {}, pi2: {}, vm103: {} },
    services: {
      'gateway-npm': { display_name: 'NPM', monitor_per_node: { pi1: 'NPM Pi Primary', pi2: 'NPM Pi Secondary' } },
      vaultwarden: { monitor_per_node: { vm103: 'Vaultwarden' } },
      'gateway-tunnel': { monitor: false },
      dockge: { monitor: 'Dockge', monitor_per_node: { vm101: 'Dockge (Staging)', pi1: false, pi2: null } },
      gitea: { monitor: null, icon: 'gitea', futureKey: 1 },
      empty: null,
    },
  });
  assert.equal(ok.ok, true, ok.error);
  assert.equal(ok.data.services.gitea.futureKey, 1, 'other keys pass through');
  assert.deepEqual(ok.data.services['gateway-npm'].monitor_per_node, { pi1: 'NPM Pi Primary', pi2: 'NPM Pi Secondary' });
});

test('services: a wrong-typed monitor mapping is refused, naming where', () => {
  for (const [entry, where] of [
    [{ monitor: true }, 'services.x.monitor'],
    [{ monitor: 7 }, 'services.x.monitor'],
    [{ monitor_per_node: ['pi1'] }, 'services.x.monitor_per_node'],
    [{ monitor_per_node: 'pi1' }, 'services.x.monitor_per_node'],
    [{ monitor_per_node: { pi1: { name: 'NPM' } } }, 'services.x.monitor_per_node.pi1'],
  ]) {
    const r = validateConfig(servicesConfigSchema, { services: { x: entry } });
    assert.equal(r.ok, false, JSON.stringify(entry));
    assert.equal(r.status, 400);
    assert.match(r.error, new RegExp(`at ${where.replace(/\./g, '\\.')}`), r.error);
  }
});

test('services: an unknown node key in monitor_per_node is saved (the refresh loop warns)', () => {
  const r = validateConfig(servicesConfigSchema, {
    nodes: { pi1: {} },
    services: { 'gateway-npm': { monitor_per_node: { pi3: 'NPM Pi Secondary' } } },
  });
  assert.equal(r.ok, true);
});
