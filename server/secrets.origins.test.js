/**
 * #556: a stored secret carries the origins it may be sent to.
 *
 * The origins (`scheme://host:port`, written by integrations/lib/origin.js)
 * sit next to the encrypted value in secrets.json. A secret stored without
 * any goes nowhere. A secret from before #556 has no `origins` at all until
 * the boot binds it (integrations/secretBinding.js); it goes nowhere until
 * then too. These drive the real store against a temp data dir.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'jaghelm-secret-origins-'));
process.env.JAGHELM_DATA_DIR = dir;
process.env.DASH_SECRET = 'test-secret-at-least-16-chars-long'; // pragma: allowlist secret

const secrets = await import('./secrets.js');
secrets.initSecrets();

after(() => rmSync(dir, { recursive: true, force: true }));

const PATH = join(dir, 'secrets.json');
const onDisk = () => JSON.parse(readFileSync(PATH, 'utf8'));
const A = 'http://a.example.test:80';
const B = 'https://b.example.test:443';

test('a secret is stored with its origins next to its value, and goes nowhere without any', () => {
  secrets.setSecret('with_origin', 'v1', { origins: [A] });
  secrets.setSecret('without', 'v2');
  assert.deepEqual(onDisk().with_origin.origins, [A]);
  assert.deepEqual(onDisk().without.origins, []);
  assert.deepEqual(secrets.getSecretOrigins('with_origin'), [A]);
  assert.deepEqual(secrets.getSecretOrigins('without'), []);
  assert.equal(secrets.getSecretOrigins('missing'), null);
  // A copy: changing it changes nothing stored.
  secrets.getSecretOrigins('with_origin').push(B);
  assert.deepEqual(secrets.getSecretOrigins('with_origin'), [A]);
  assert.equal(secrets.getSecret('with_origin'), 'v1');
});

test('entering the stored value again adds its origin; a new value has only its own', () => {
  secrets.setSecret('shared', 'same-value', { origins: [A] });
  assert.deepEqual(secrets.originsOnEntry('shared', 'same-value', B), [A, B]);
  assert.deepEqual(secrets.originsOnEntry('shared', 'same-value', A), [A]);
  assert.deepEqual(secrets.originsOnEntry('shared', 'another-value', B), [B]);
  assert.deepEqual(secrets.originsOnEntry('not_stored', 'x', B), [B]);
  // An address with no origin binds to nothing.
  assert.deepEqual(secrets.originsOnEntry('shared', 'another-value', null), []);
  assert.deepEqual(secrets.originsOnEntry('shared', 'same-value', null), [A]);
});

test('a copied secret keeps its origins', () => {
  secrets.setSecret('from_name', 'moved', { origins: [A, B] });
  assert.equal(secrets.copySecret('from_name', 'to_name'), true);
  assert.deepEqual(secrets.getSecretOrigins('to_name'), [A, B]);
  assert.equal(secrets.getSecret('to_name'), 'moved');
});

test('a secret from before #556 is unbound until bound once, in one write', () => {
  secrets.setSecret('legacy_one', 'l1', { origins: [A] });
  secrets.setSecret('legacy_two', 'l2', { origins: [A] });
  secrets.setSecret('bound', 'b', { origins: [B] });
  // As an older version wrote them: no origins.
  const store = onDisk();
  delete store.legacy_one.origins;
  delete store.legacy_two.origins;
  writeFileSync(PATH, JSON.stringify(store));
  secrets.initSecrets();

  assert.deepEqual(secrets.getSecretOrigins('legacy_one'), []);
  assert.deepEqual(secrets.unboundSecretNames().sort(), ['legacy_one', 'legacy_two']);

  const n = secrets.bindSecretOrigins({ legacy_one: [B], legacy_two: [], bound: [A], missing: [A] });
  assert.equal(n, 2, 'only the unbound names that are stored');
  assert.deepEqual(secrets.getSecretOrigins('legacy_one'), [B]);
  assert.deepEqual(secrets.getSecretOrigins('legacy_two'), []);
  assert.deepEqual(secrets.getSecretOrigins('bound'), [B], 'a bound secret is never rebound');
  assert.deepEqual(secrets.unboundSecretNames(), []);
  assert.deepEqual(onDisk().legacy_two.origins, []);
  assert.equal(onDisk().missing, undefined);
  assert.equal(secrets.getSecret('legacy_one'), 'l1');
});

test('the names list never carries an origin', () => {
  secrets.setSecret('listed', 'x', { origins: ['http://only-in-the-store.example.test:8080'] });
  assert.ok(!JSON.stringify(secrets.listSecretKeys()).includes('only-in-the-store'));
});
