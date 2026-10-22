/**
 * #415, #502: which integration secrets services.yaml still uses, and the
 * sweep at boot that drops the rest.
 *
 * An integration's secrets are the `integration_*` names JagHelm writes. One
 * is in use while an entry's key makes it that entry's keyed secret
 * (integration_<key>_url|username|password|token, which a preset resolves
 * ahead of the entry's own reference) or a `$secret:` reference anywhere in
 * the config names it. A save interrupted between storing its secrets and
 * writing services.yaml, or a delete before #415, left some unused; the sweep
 * drops those once at boot. Every other name is the user's and never touched.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import yaml from 'js-yaml';

process.env.DASH_SECRET = 'test-secret-at-least-16-chars-long'; // pragma: allowlist secret

const { initSecrets, setSecret, deleteSecret, listSecretKeys } = await import('../secrets.js');
const { unusedIntegrationSecrets, sweepUnusedIntegrationSecrets } =
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

test('the sweep at boot drops the unused integration secrets, and logs how many once, never which', () => {
  writeFileSync(CONFIG_PATH, yaml.dump(CONFIG));
  store();

  const { result, lines } = logged(sweepUnusedIntegrationSecrets);
  assert.equal(result, 2);
  assert.deepEqual(listSecretKeys(), [
    'integration_npm_password',
    'integration_hand_named',
    'my_own_token',
  ]);
  assert.ok(!secretsText().includes('integration_gone_password'), 'gone from secrets.json too');
  const swept = lines.filter((line) => JSON.parse(line).module === 'secrets');
  assert.equal(swept.length, 1, lines.join(''));
  assert.equal(JSON.parse(swept[0]).dropped, 2);
  for (const line of lines) assert.doesNotMatch(line, /gone|three|pw-/);

  // Nothing left to drop: nothing is written or logged.
  const before = secretsText();
  const again = logged(sweepUnusedIntegrationSecrets);
  assert.equal(again.result, 0);
  assert.deepEqual(again.lines, []);
  assert.equal(secretsText(), before);
});

test('the sweep drops nothing while services.yaml does not parse, is not there or cannot be read', () => {
  store();
  const before = secretsText();

  // One indentation slip: its entries can't be read, so none can be trusted gone.
  writeFileSync(CONFIG_PATH, 'integrations:\n  npm:\n   url: http://npm.example.test\n    preset: npm\n');
  assert.equal(sweepUnusedIntegrationSecrets(), null);
  assert.equal(secretsText(), before);

  rmSync(CONFIG_PATH);
  assert.equal(sweepUnusedIntegrationSecrets(), null);
  assert.equal(secretsText(), before);

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
    assert.equal(sweepUnusedIntegrationSecrets(), null);
  } finally {
    fs.readFileSync = read;
    syncBuiltinESMExports();
  }
  assert.equal(secretsText(), before);
});
