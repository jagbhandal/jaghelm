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

// #306: the old grid board's keys are read by nothing, so a save that still
// carries one (a tab on an older build) is never refused over it.
test("displayConfig: the old board's gridColumns and gridLayout are not checked", () => {
  for (const config of [{ gridColumns: 999 }, { gridColumns: 'wide' }, { gridLayout: 'x' }]) {
    assert.equal(validateConfig(displayConfigSchema, config).ok, true, JSON.stringify(config));
  }
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

test('displayConfig: the Overview sections are switches, on or off (#307)', () => {
  const ok = validateConfig(displayConfigSchema, {
    overviewSections: { strip: false, rail: true },
  });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.data.overviewSections, { strip: false, rail: true });
  assert.equal(validateConfig(displayConfigSchema, { overviewSections: { rail: 'no' } }).ok, false);
  assert.equal(validateConfig(displayConfigSchema, { overviewSections: { rail: 0 } }).ok, false);
  assert.equal(validateConfig(displayConfigSchema, { overviewSections: 'rail' }).ok, false);
  assert.equal(validateConfig(displayConfigSchema, {}).ok, true);
});

test('displayConfig: the Overview arrangement keeps its ids and uids; another shape reads as unset, never refuses a save (#330)', () => {
  const layout = { order: ['services', 'jobs'], pinned: ['pi-1:adguard-home', 'pi-2:web'] };
  const ok = validateConfig(displayConfigSchema, { overviewLayout: layout, title: 'x' });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.data.overviewLayout, layout);
  for (const bad of ['services', 5, [], { order: 'jobs', pinned: [1] }]) {
    const r = validateConfig(displayConfigSchema, { overviewLayout: bad, title: 'x' });
    assert.equal(r.ok, true);
    if (typeof bad === 'object' && !Array.isArray(bad)) {
      assert.equal(r.data.overviewLayout.order, undefined);
      assert.equal(r.data.overviewLayout.pinned, undefined);
    } else {
      assert.equal(r.data.overviewLayout, undefined);
    }
  }
  // Bounded: a list past its cap reads as unset.
  const many = validateConfig(displayConfigSchema, {
    overviewLayout: { pinned: Array.from({ length: 501 }, (_, i) => `n:${i}`) },
  });
  assert.equal(many.ok, true);
  assert.equal(many.data.overviewLayout.pinned, undefined);
  // The old grid board's keys pass through, as every unknown key does.
  assert.equal(validateConfig(displayConfigSchema, { gridLayout: [{ i: 'a' }] }).ok, true);
});

test('displayConfig: accent and density keep a known id; an unknown one reads as unset, not refused (#321)', () => {
  const ok = validateConfig(displayConfigSchema, { accent: 'cyan', density: 'compact', title: 'x' });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.data, { accent: 'cyan', density: 'compact', title: 'x' });
  const odd = validateConfig(displayConfigSchema, { accent: 'teal', density: 7, title: 'x' });
  assert.equal(odd.ok, true);
  assert.equal(odd.data.accent, undefined);
  assert.equal(odd.data.density, undefined);
  assert.equal(odd.data.title, 'x');
});

test('displayConfig: typeface keeps a registry id, an unknown one reads as unset, and the old fontFamily passes through (#660)', async () => {
  const { TYPEFACES } = await import('../../src/ui/typefaces.js');
  for (const { id } of TYPEFACES) {
    assert.equal(validateConfig(displayConfigSchema, { typeface: id }).data.typeface, id);
  }
  const odd = validateConfig(displayConfigSchema, { typeface: 'comic-sans', title: 'x' });
  assert.equal(odd.ok, true);
  assert.equal(odd.data.typeface, undefined);
  assert.equal(odd.data.title, 'x');
  const old = validateConfig(displayConfigSchema, { fontFamily: 'rounded' });
  assert.equal(old.ok, true);
  assert.equal(old.data.fontFamily, 'rounded');
  // The schema's list is the registry's: a face added to one must join the other.
  const typefaceField = displayConfigSchema.shape.typeface;
  assert.ok(typefaceField, 'typeface is in the schema');
  for (const { id } of TYPEFACES) assert.equal(typefaceField.safeParse(id).data, id);
  assert.equal(typefaceField.safeParse('not-a-face').data, undefined);
});

test('displayConfig: units and locale (#322, #260) keep a known value; anything else reads as unset, not refused', () => {
  const ok = validateConfig(displayConfigSchema, { units: 'imperial', locale: 'en-GB' });
  assert.deepEqual(ok.data, { units: 'imperial', locale: 'en-GB' });
  assert.equal(validateConfig(displayConfigSchema, { locale: '' }).data.locale, '');
  const odd = validateConfig(displayConfigSchema, { units: 'furlongs', locale: 'not a locale!', title: 'x' });
  assert.equal(odd.ok, true);
  assert.equal(odd.data.units, undefined);
  assert.equal(odd.data.locale, undefined);
  assert.equal(odd.data.title, 'x');
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

test('accepts display_name_per_node and icon_per_node, refuses a non-map (#636)', () => {
  const ok = validateConfig(servicesConfigSchema, {
    services: { 'gateway-npm': { display_name_per_node: { pi1: 'A', pi2: null }, icon_per_node: { pi1: 'npm' } } },
  });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.data.services['gateway-npm'].icon_per_node, { pi1: 'npm' });
  for (const bad of [{ display_name_per_node: 'x' }, { icon_per_node: ['x'] }]) {
    const r = validateConfig(servicesConfigSchema, { services: { x: bad } });
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
  }
});

test('a hand-edited non-string per-node name or icon never blocks a save (#636)', () => {
  const r = validateConfig(servicesConfigSchema, {
    services: { x: { display_name_per_node: { pi1: 2024 }, icon_per_node: { pi1: 7, pi2: false } } },
  });
  assert.equal(r.ok, true);
});

// #644: the node a monitor no container carries is shown on.
test('monitor_nodes: a map of monitor name to node key; a value that is no node is saved, a non-map refused', () => {
  const ok = validateConfig(servicesConfigSchema, {
    nodes: { pi1: {} },
    monitor_nodes: { 'cadvisor-pi1': 'pi1', 'No such node': 'pi9', odd: null },
  });
  assert.equal(ok.ok, true, ok.error);
  assert.deepEqual(ok.data.monitor_nodes, { 'cadvisor-pi1': 'pi1', 'No such node': 'pi9', odd: null });
  for (const bad of ['pi1', ['pi1'], 5]) {
    const r = validateConfig(servicesConfigSchema, { monitor_nodes: bad });
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.equal(r.status, 400);
    assert.match(r.error, /monitor_nodes/);
  }
});

test('displayConfig: themes is a bounded list that round-trips as written, bad themes included (#331)', () => {
  const themes = [{ id: 'a', name: 'A', base: 'dark', tokens: { bg: '#000000' } }, { id: 'broken' }];
  const ok = validateConfig(displayConfigSchema, { title: 'x', themes });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.data.themes, themes);
  assert.equal(validateConfig(displayConfigSchema, { themes: 'dark' }).ok, false);
  assert.equal(validateConfig(displayConfigSchema, { themes: new Array(65).fill({}) }).ok, false);
  assert.equal(validateConfig(displayConfigSchema, { title: 'x' }).data.themes, undefined);
});
