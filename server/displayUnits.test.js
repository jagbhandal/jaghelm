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

test('unitsOfConfig: the status model\'s unit is metric unless the config says imperial (#494)', async () => {
  const { unitsOfConfig } = await import('./displayUnits.js');
  assert.equal(unitsOfConfig(null), 'metric');
  assert.equal(unitsOfConfig({}), 'metric');
  assert.equal(unitsOfConfig({ units: 'imperial' }), 'imperial');
  assert.equal(unitsOfConfig({ units: 'metric', tempUnit: 'F' }), 'metric');
  assert.equal(unitsOfConfig({ tempUnit: 'F' }), 'imperial', 'a config from before the setting');
  assert.equal(unitsOfConfig({ units: 'kelvin' }), 'metric');
});
