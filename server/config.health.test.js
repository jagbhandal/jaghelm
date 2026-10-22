/**
 * #505: what config.js says about services.yaml for the board and
 * /api/health. `configHealth()` is `{ state: 'ok' }`, or `{ state:
 * 'unparseable', line }` while the file is no usable config (the same files
 * #423 refuses to write over, `config_unparseable`); `configProblem()` is the
 * status model's reason for it, or null. Both follow the last read: boot, the
 * watcher's reload, a route's read, a save. Neither quotes the file (#504).
 *
 * Its own file because the module's state is the point: the first test runs
 * against a fresh module, as at boot.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const { configHealth, configProblem, loadConfig, readConfig, saveConfig, writeConfig } =
  await import('./config.js');
const CONFIG_PATH = join(process.env.JAGHELM_DATA_DIR, 'services.yaml');

const SECRET = 'Hunter2Plain'; // pragma: allowlist secret
const GOOD = 'nodes:\n  pi1:\n    display_name: Gateway\nservices: {}\n';
// Line 3 is indented one space too few, with a credential on it.
const BROKEN = `nodes:\n  pi1:\n password: ${SECRET}\n    display_name: Gateway\n`;

test('no services.yaml (first boot): ok', () => {
  assert.equal(loadConfig(), null);
  assert.deepEqual(configHealth(), { state: 'ok' });
  assert.equal(configProblem(), null);
});

test("boot on a file that doesn't parse: unparseable, with its line; the reason names the line and nothing of the file", () => {
  writeFileSync(CONFIG_PATH, BROKEN);
  loadConfig();
  const health = configHealth();
  assert.equal(health.state, 'unparseable');
  assert.equal(typeof health.line, 'number');
  assert.deepEqual(Object.keys(health), ['state', 'line']);
  const problem = configProblem();
  assert.deepEqual(problem, {
    line: health.line,
    reason: `services.yaml doesn't parse (line ${health.line})`,
  });
  assert.doesNotMatch(JSON.stringify([health, problem]), new RegExp(SECRET));
});

test('fixed by hand: the reload makes it ok', () => {
  writeFileSync(CONFIG_PATH, GOOD);
  loadConfig();
  assert.deepEqual(configHealth(), { state: 'ok' });
  assert.equal(configProblem(), null);
});

for (const [what, content, reason] of [
  ['empty', '', 'services.yaml is empty'],
  ['comments only', '# being edited\n', 'services.yaml is empty'],
  ['a list', '- pi1\n', "services.yaml isn't a mapping"],
]) {
  test(`a file that reads ${what}: unparseable, with no line, as #423 refuses it`, () => {
    writeFileSync(CONFIG_PATH, content);
    loadConfig();
    assert.deepEqual(configHealth(), { state: 'unparseable', line: null });
    assert.deepEqual(configProblem(), { line: null, reason });
    assert.ok(readConfig().unusable, 'the file #423 refuses to write over');
    writeFileSync(CONFIG_PATH, GOOD);
    loadConfig();
    assert.deepEqual(configHealth(), { state: 'ok' });
  });
}

test("a route's read sees a hand edit before the watcher does, and says so too", () => {
  writeFileSync(CONFIG_PATH, BROKEN);
  assert.ok(readConfig().unusable);
  assert.equal(configHealth().state, 'unparseable');
  writeFileSync(CONFIG_PATH, GOOD);
  const { version } = readConfig();
  assert.deepEqual(configHealth(), { state: 'ok' });
  // A save leaves it ok.
  assert.equal(writeConfig({ nodes: {} }, version).ok, true);
  assert.deepEqual(configHealth(), { state: 'ok' });
});

test('a write over a file fixed since its last read (no read in between) leaves it ok', () => {
  writeFileSync(CONFIG_PATH, BROKEN);
  loadConfig();
  assert.equal(configHealth().state, 'unparseable');
  writeFileSync(CONFIG_PATH, GOOD); // fixed by hand, not read yet
  assert.equal(saveConfig({ nodes: {} }), true);
  assert.deepEqual(configHealth(), { state: 'ok' });
  assert.equal(configProblem(), null);
});
