/**
 * #463: a services.yaml that reads empty, or as something that isn't a
 * mapping, for a moment (an editor's truncate-then-write, a hand edit saved
 * in two steps) is a failed read, not an empty board: the previous config
 * stays until the file changes again. Without it the push snapshot dropped
 * every host and service for one cycle and re-paged every open problem on
 * the next.
 *
 * Its own file because the module's state is the point: the first test runs
 * against a fresh module, as at boot, with no previous config to keep.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'jh-config-empty-'));
process.env.JAGHELM_DATA_DIR = dir;
const { loadConfig, getConfig } = await import('./config.js');
const servicesYaml = join(dir, 'services.yaml');

after(() => rmSync(dir, { recursive: true, force: true }));

const GOOD =
  'nodes:\n  pi1:\n    display_name: Gateway\n  vm103:\n    display_name: Docker\nservices: {}\n';

function captureConfigLogs(t, fn) {
  const lines = [];
  t.mock.method(process.stderr, 'write', (chunk) => {
    for (const line of String(chunk).split('\n')) {
      if (line.includes('"module":"config"') && /"level":"(warn|error)"/.test(line))
        lines.push(line);
    }
    return true;
  });
  try {
    fn();
  } finally {
    t.mock.restoreAll();
  }
  return lines;
}

test('#463: at boot, a services.yaml that cannot be parsed is not "first boot": no discovery, the file is left alone', (t) => {
  const broken = 'nodes:\n  pi1:\n    display_name: [unclosed\n';
  writeFileSync(servicesYaml, broken);
  let loaded;
  const logs = captureConfigLogs(t, () => {
    loaded = loadConfig();
  });
  // null is index.js's "no file, run discovery and save over it" signal.
  assert.notEqual(loaded, null, 'a present but unreadable file must not trigger discovery');
  assert.deepEqual(loaded, {}, 'an empty board until the file is fixed');
  assert.equal(readFileSync(servicesYaml, 'utf8'), broken, 'the file on disk is untouched');
  assert.equal(logs.length, 1, `one error naming the problem, got ${logs.length}`);
  assert.match(logs[0], /not overwrit/i);
});

test('#463: once fixed, the file loads', () => {
  writeFileSync(servicesYaml, GOOD);
  assert.deepEqual(Object.keys(loadConfig().nodes), ['pi1', 'vm103']);
});

for (const [what, content] of [
  ['empty', ''],
  ['whitespace only', '  \n\n'],
  ['comments only', '# being edited\n'],
  ['a bare scalar', 'nodes\n'],
  ['a list', '- pi1\n- vm103\n'],
]) {
  test(`#463: a services.yaml that reads ${what} after a good one keeps the previous config, with one warning`, (t) => {
    writeFileSync(servicesYaml, GOOD);
    loadConfig();
    writeFileSync(servicesYaml, content);
    let loaded;
    const logs = captureConfigLogs(t, () => {
      loaded = loadConfig();
    });
    assert.deepEqual(
      Object.keys(loaded.nodes),
      ['pi1', 'vm103'],
      'the returned config is the previous one'
    );
    assert.deepEqual(
      Object.keys(getConfig().nodes),
      ['pi1', 'vm103'],
      'and so is what the refresh reads'
    );
    assert.equal(logs.length, 1, `one warning, got ${logs.length}`);
    assert.match(logs[0], /keeping the previous/i);
  });
}

test('#463: an unparseable services.yaml after a good one keeps the previous config', (t) => {
  writeFileSync(servicesYaml, GOOD);
  loadConfig();
  writeFileSync(servicesYaml, 'nodes:\n  pi1: [unclosed\n');
  let loaded;
  captureConfigLogs(t, () => {
    loaded = loadConfig();
  });
  assert.deepEqual(Object.keys(loaded.nodes), ['pi1', 'vm103']);
  assert.deepEqual(Object.keys(getConfig().nodes), ['pi1', 'vm103']);
});

test('#463: an empty read between two good ones: the refresh never sees an empty board', (t) => {
  // What the refresh reads each cycle is getConfig(); push input follows it,
  // so a cycle that sees the same nodes sends nothing new.
  writeFileSync(servicesYaml, GOOD);
  loadConfig();
  const seen = [Object.keys(getConfig().nodes)];
  writeFileSync(servicesYaml, '');
  captureConfigLogs(t, () => loadConfig());
  seen.push(Object.keys(getConfig().nodes));
  writeFileSync(servicesYaml, GOOD);
  loadConfig();
  seen.push(Object.keys(getConfig().nodes));
  assert.deepEqual(seen, [
    ['pi1', 'vm103'],
    ['pi1', 'vm103'],
    ['pi1', 'vm103'],
  ]);
});

test('#463: an explicit empty node list is a real config and is honoured', () => {
  writeFileSync(servicesYaml, GOOD);
  loadConfig();
  writeFileSync(servicesYaml, 'nodes: {}\nservices: {}\n');
  assert.deepEqual(loadConfig().nodes, {}, 'the user emptied the board on purpose');
});
