/**
 * #415, #502: which integration secrets services.yaml still uses, and the
 * check at boot that counts the rest and deletes none.
 *
 * An integration's secrets are the `integration_*` names JagHelm writes. One
 * is in use while an entry's key makes it that entry's keyed secret
 * (integration_<key>_url|username|password|token, which a preset resolves
 * ahead of the entry's own reference) or a `$secret:` reference anywhere in
 * the config names it. A delete before #415, or a save interrupted between
 * storing its secrets and writing services.yaml, left some unused. The check
 * at boot only counts them: a hand edit (an entry commented out, a typo, a
 * rename) makes a secret look unused that is still wanted, so nothing is
 * deleted on what services.yaml says at boot. Every other name is the user's.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import yaml from 'js-yaml';

process.env.DASH_SECRET = 'test-secret-at-least-16-chars-long'; // pragma: allowlist secret

const { initSecrets, setSecret, deleteSecret, listSecretKeys } = await import('../secrets.js');
const { generateDefaultConfig } = await import('../config.js');
const { unusedIntegrationSecrets, reportUnusedIntegrationSecrets } =
  await import('./unusedSecrets.js');

initSecrets();

const CONFIG_PATH = join(process.env.JAGHELM_DATA_DIR, 'services.yaml');
const SECRETS_PATH = join(process.env.JAGHELM_DATA_DIR, 'secrets.json');
const secretsText = () => (existsSync(SECRETS_PATH) ? readFileSync(SECRETS_PATH, 'utf8') : '');

const CONFIG = {
  services: { vault: { password: '$secret:integration_from_services' } }, // pragma: allowlist secret
  integrations: {
    npm: { preset: 'npm', url: 'http://npm.example.test' },
    npm_two: { preset: 'npm', instance: 'two', url: 'http://npm-two.example.test' },
    statuspage: {
      url: 'http://status.example.test',
      extraHeaders: { 'X-Api-Key': '$secret:integration_hand_named' }, // pragma: allowlist secret
      fields: [{ key: 'up', token: '  $SECRET:integration_odd_case ' }], // pragma: allowlist secret
    },
  },
};

test('an entry’s keyed secrets and every $secret: reference are in use; other integration_* names are not', () => {
  const names = [
    'integration_npm_password', // npm's keyed password
    'integration_npm_two_url', // npm_two's keyed URL, though its name starts like npm's
    'integration_statuspage_token', // keyed, though statuspage is a custom integration
    'integration_hand_named', // a reference in a header
    'integration_odd_case', // a reference, spaced and cased oddly
    'integration_from_services', // a reference outside the integrations
    'integration_npm_three_password', // npm_three is not configured
    'integration_npm_password_old', // no entry's keyed name
    'integration_gone_token',
    'my_own_token', // the user's own: never an integration secret
    'integration', // no key in it
  ];
  assert.deepEqual(unusedIntegrationSecrets(CONFIG, names), [
    'integration_npm_three_password',
    'integration_npm_password_old',
    'integration_gone_token',
  ]);
  // Narrowed to one key's names, as a delete does.
  assert.deepEqual(unusedIntegrationSecrets(CONFIG, names, 'npm'), [
    'integration_npm_three_password',
    'integration_npm_password_old',
  ]);
  // With no integrations, every integration_* name is unused, but no other.
  assert.deepEqual(
    unusedIntegrationSecrets({}, ['integration_npm_password', 'my_own_token']),
    ['integration_npm_password']
  );
});

/** Lines the logger writes while `fn` runs. */
function logged(fn) {
  const lines = [];
  const write = { out: process.stdout.write, err: process.stderr.write };
  const tap = (orig) =>
    function (chunk, ...rest) {
      lines.push(String(chunk));
      return orig.call(this, chunk, ...rest);
    };
  process.stdout.write = tap(write.out);
  process.stderr.write = tap(write.err);
  try {
    return { result: fn(), lines };
  } finally {
    process.stdout.write = write.out;
    process.stderr.write = write.err;
  }
}

/** A store with two unused integration secrets and three in use. */
function store() {
  for (const name of listSecretKeys()) deleteSecret(name);
  setSecret('integration_npm_password', 'pw-npm');
  setSecret('integration_gone_password', 'pw-gone');
  setSecret('integration_npm_three_token', 'tok-three');
  setSecret('integration_hand_named', 'key');
  setSecret('my_own_token', 'mine');
}

/** secrets.json and the names in the store, in order. */
const storeNow = () => ({ file: secretsText(), names: listSecretKeys() });

test('the check at boot counts the unused integration secrets and deletes none: one line, how many, never which', () => {
  writeFileSync(CONFIG_PATH, yaml.dump(CONFIG));
  store();
  const before = storeNow();

  const { result, lines } = logged(reportUnusedIntegrationSecrets);
  assert.equal(result, 2);
  assert.deepEqual(storeNow(), before, 'nothing deleted, secrets.json byte-for-byte');
  const counted = lines.filter((line) => JSON.parse(line).module === 'secrets');
  assert.equal(counted.length, 1, lines.join(''));
  assert.equal(JSON.parse(counted[0]).unused, 2);
  for (const line of lines) assert.doesNotMatch(line, /gone|three|pw-/);

  // None unused: nothing is logged.
  deleteSecret('integration_gone_password');
  deleteSecret('integration_npm_three_token');
  const none = logged(reportUnusedIntegrationSecrets);
  assert.equal(none.result, 0);
  assert.deepEqual(none.lines, []);
});

// A hand edit can make a secret look unused that is still wanted. Before the
// check was count-only, each of these deleted credentials at the next start.
const HAND_EDITS = {
  'every entry commented out': `# integrations:\n#   npm:\n#     preset: npm\n${yaml.dump({ services: {} })}`,
  'one entry commented out': yaml
    .dump({ integrations: { statuspage: CONFIG.integrations.statuspage } })
    .concat('#  npm:\n#    preset: npm\n'),
  'a typo in `integrations:`': yaml.dump({ integration: CONFIG.integrations }),
  'the config a missing services.yaml is replaced by at first boot': yaml.dump(
    generateDefaultConfig(['pi1'])
  ),
  'an entry renamed by hand (its keyed URL now names the old key)': yaml.dump({
    integrations: { npm_renamed: CONFIG.integrations.npm, statuspage: CONFIG.integrations.statuspage },
  }),
};

for (const [what, text] of Object.entries(HAND_EDITS)) {
  test(`${what}: the check at boot deletes nothing`, () => {
    store();
    setSecret('integration_npm_url', 'http://keyed-npm.example.test');
    writeFileSync(CONFIG_PATH, text);
    const before = storeNow();
    const counted = reportUnusedIntegrationSecrets();
    assert.ok(counted > 0, 'some look unused');
    assert.deepEqual(storeNow(), before);
  });
}

test('the check looks at nothing while services.yaml does not parse, is not there or cannot be read', () => {
  store();
  const before = storeNow();

  writeFileSync(CONFIG_PATH, 'integrations:\n  npm:\n   url: http://npm.example.test\n    preset: npm\n');
  assert.equal(reportUnusedIntegrationSecrets(), null);

  rmSync(CONFIG_PATH);
  assert.equal(reportUnusedIntegrationSecrets(), null);

  // One that can't be read (its permissions) doesn't stop the boot either.
  writeFileSync(CONFIG_PATH, yaml.dump(CONFIG));
  const read = fs.readFileSync;
  fs.readFileSync = (path, ...rest) => {
    if (path === CONFIG_PATH) {
      throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    }
    return read(path, ...rest);
  };
  syncBuiltinESMExports();
  try {
    assert.equal(reportUnusedIntegrationSecrets(), null);
  } finally {
    fs.readFileSync = read;
    syncBuiltinESMExports();
  }
  assert.deepEqual(storeNow(), before);
});
