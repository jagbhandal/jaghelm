/** #322: existing installs keep the temperature unit they were drawing. */
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'jh-units-'));
process.env.JAGHELM_DATA_DIR = dir;
const { migrateDisplayUnits } = await import('./displayUnits.js');
const FILE = join(dir, 'display-config.json');
const read = () => JSON.parse(readFileSync(FILE, 'utf8'));
after(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => rmSync(FILE, { force: true }));

test('no file (a fresh install): nothing is written, metric stands', () => {
  assert.equal(migrateDisplayUnits(), 'none');
  assert.equal(existsSync(FILE), false);
});

test('a file with neither units nor tempUnit was drawing Fahrenheit: imperial', () => {
  writeFileSync(FILE, JSON.stringify({ title: 'Lab', refreshInterval: 30 }));
  assert.equal(migrateDisplayUnits(), 'migrated');
  assert.deepEqual(read(), { title: 'Lab', refreshInterval: 30, units: 'imperial' });
});

test('a stored tempUnit keeps its meaning: C is metric, F imperial', () => {
  writeFileSync(FILE, JSON.stringify({ tempUnit: 'C' }));
  migrateDisplayUnits();
  assert.equal(read().units, 'metric');
  writeFileSync(FILE, JSON.stringify({ tempUnit: 'F' }));
  migrateDisplayUnits();
  assert.equal(read().units, 'imperial');
});

test('a file that has units is never touched, and a second run is a no-op', () => {
  const text = JSON.stringify({ units: 'metric', tempUnit: 'F' });
  writeFileSync(FILE, text);
  assert.equal(migrateDisplayUnits(), 'none');
  assert.equal(readFileSync(FILE, 'utf8'), text);
  writeFileSync(FILE, JSON.stringify({ title: 'x' }));
  migrateDisplayUnits();
  const once = readFileSync(FILE, 'utf8');
  assert.equal(migrateDisplayUnits(), 'none');
  assert.equal(readFileSync(FILE, 'utf8'), once);
});

test('a file that does not parse, or is not an object, is left alone', () => {
  writeFileSync(FILE, '{ nope');
  assert.equal(migrateDisplayUnits(), 'none');
  assert.equal(readFileSync(FILE, 'utf8'), '{ nope');
  writeFileSync(FILE, '[1]');
  assert.equal(migrateDisplayUnits(), 'none');
  assert.equal(readFileSync(FILE, 'utf8'), '[1]');
});

test('unitsOfConfig and the web agree on every kind of config (#494)', async () => {
  const { unitsOfConfig } = await import('./displayUnits.js');
  const { unitsFromConfig } = await import('../src/util/format.js');
  const cases = [
    [null, 'metric'],
    [undefined, 'metric'],
    [{}, 'imperial'], // an install from before the setting was drawing Fahrenheit
    [{ tempUnit: 'C' }, 'metric'],
    [{ tempUnit: 'F' }, 'imperial'],
    [{ units: 'metric' }, 'metric'],
    [{ units: 'imperial' }, 'imperial'],
    [{ units: 'metric', tempUnit: 'F' }, 'metric'],
    [{ units: 'kelvin', tempUnit: 'C' }, 'metric'],
  ];
  for (const [config, want] of cases) {
    assert.equal(unitsOfConfig(config), want, JSON.stringify(config));
    assert.equal(unitsFromConfig(config), want, `web: ${JSON.stringify(config)}`);
  }
});
