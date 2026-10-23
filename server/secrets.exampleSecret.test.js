/**
 * #576: an install that has run on a DASH_SECRET the docs print, and stored
 * credentials under it, before the example was refused.
 *
 * At the first start after the update the key is refused: the log line says
 * how many credentials are stored and what to do (a real secret, a restart,
 * each credential entered again), nothing in secrets.json changes, and each
 * integration that uses one reads it as a stored credential that couldn't be
 * read, so its card says to enter it again (#428). With a real DASH_SECRET the
 * old ones still don't decrypt, and entering one again stores it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';

const EXAMPLE = 'paste-your-random-secret-here'; // docs/GET-STARTED.md // pragma: allowlist secret
const DIR = process.env.JAGHELM_DATA_DIR;
const SECRETS_PATH = join(DIR, 'secrets.json');
const SALT = crypto.randomBytes(16).toString('hex');

/** `plaintext` as secrets.js stores it, under the key `secret` derives with this install's salt. */
function storedUnder(secret, plaintext) {
  const key = crypto.pbkdf2Sync(secret, SALT, 100000, 32, 'sha256');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = cipher.update(plaintext, 'utf8', 'hex') + cipher.final('hex');
  return { iv: iv.toString('hex'), data, tag: cipher.getAuthTag().toString('hex'), origins: ['http://npm.lan:81'] };
}

writeFileSync(join(DIR, '.secrets-salt'), SALT);
writeFileSync(
  SECRETS_PATH,
  JSON.stringify({
    integration_npm_password: storedUnder(EXAMPLE, 'npm-password'),
    integration_npm_username: storedUnder(EXAMPLE, 'admin@npm.lan'),
  })
);
const BEFORE = readFileSync(SECRETS_PATH);

process.env.DASH_SECRET = EXAMPLE;
const secrets = await import('./secrets.js');
const { resolveIntegrationConfig } = await import('./integrations/lib/config.js');
const { integrationRoutes } = await import('./routes/integrations.js');
const { secretsRoutes } = await import('./routes/secrets.js');

const app = express();
app.use(express.json());
app.use('/api/integrations', integrationRoutes);
app.use('/api/secrets', secretsRoutes);

/** Every line the logger writes while `fn` runs; anything else passes through. */
function captureLogs(fn) {
  const lines = [];
  const orig = { out: process.stdout.write, err: process.stderr.write };
  const tap = (write) =>
    function (chunk, ...rest) {
      try {
        const obj = JSON.parse(String(chunk));
        if (obj && obj.module && obj.level) {
          lines.push(obj);
          return true;
        }
      } catch {
        // not one of ours
      }
      return write.call(this, chunk, ...rest);
    };
  process.stdout.write = tap(orig.out);
  process.stderr.write = tap(orig.err);
  try {
    fn();
  } finally {
    process.stdout.write = orig.out;
    process.stderr.write = orig.err;
  }
  return lines;
}

test('at boot the key is refused, and the log line says what to do with the credentials stored under it', () => {
  const lines = captureLogs(() => secrets.initSecrets());
  const refused = lines.filter((l) => l.level === 'error');
  assert.equal(refused.length, 1, JSON.stringify(lines));
  assert.equal(refused[0].module, 'secrets');
  assert.equal(refused[0].stored, 2);
  assert.equal(
    refused[0].msg,
    'DASH_SECRET is an example value from the docs, not a key: the secrets manager is off and stores no ' +
      'credential until it has a real one. Generate one with `openssl rand -hex 32`, set it as DASH_SECRET in ' +
      ".env and restart JagHelm. If JagHelm stored credentials under the example (secrets.json holds 2), they won't " +
      'decrypt under the new key: enter each again in Settings → Integrations.'
  );
  assert.ok(!JSON.stringify(lines).includes(EXAMPLE), 'the example itself is never logged');
});

test('while it is refused, nothing is read, stored or lost, and the refusal is not logged again', () => {
  const lines = captureLogs(() => {
    assert.equal(secrets.getSecret('integration_npm_password'), null);
    assert.equal(secrets.getSecret('integration_npm_username'), null);
    assert.equal(secrets.setSecret('integration_npm_password', 'typed-again'), false);
  });
  assert.deepEqual(lines, [], 'logged once, at boot');
  assert.ok(secrets.hasSecret('integration_npm_password'));
  assert.deepEqual(readFileSync(SECRETS_PATH), BEFORE, 'secrets.json is untouched');
});

test('a credential entered in Settings meanwhile is refused with what to do; nothing is stored', async () => {
  const saved = await request(app)
    .post('/api/integrations/save')
    .send({ type: 'custom', url: 'http://npm.lan:81', password: 'typed-again' }); // pragma: allowlist secret
  const put = await request(app).put('/api/secrets/my_token').send({ value: 'typed-again' });
  for (const r of [saved, put]) {
    assert.equal(r.status, 500);
    assert.equal(r.body.error, secrets.NO_KEY_ERROR);
  }
  assert.equal(
    secrets.NO_KEY_ERROR,
    'DASH_SECRET is missing or an example value, so no credential can be stored: generate one with ' +
      '`openssl rand -hex 32`, set it as DASH_SECRET in .env and restart JagHelm'
  );
  assert.deepEqual(readFileSync(SECRETS_PATH), BEFORE, 'secrets.json is untouched');
});

test("an integration using one reads it as a stored credential that couldn't be read (its card says enter it again)", () => {
  let resolved;
  captureLogs(() => {
    resolved = resolveIntegrationConfig('custom-576', {
      url: 'http://npm.lan:81',
      password: '$secret:integration_npm_password', // pragma: allowlist secret
    });
  });
  assert.equal(resolved._password, null);
  assert.deepEqual(resolved._unreadableCredentials, ['password']);
});

test('with a real DASH_SECRET the old ones still do not decrypt, and one entered again is stored', () => {
  process.env.DASH_SECRET = crypto.randomBytes(32).toString('hex');
  captureLogs(() => assert.equal(secrets.getSecret('integration_npm_password'), null));
  assert.equal(secrets.setSecret('integration_npm_password', 'typed-again', { origins: ['http://npm.lan:81'] }), true);
  assert.equal(secrets.getSecret('integration_npm_password'), 'typed-again');
  const onDisk = JSON.parse(readFileSync(SECRETS_PATH, 'utf8'));
  assert.deepEqual(onDisk.integration_npm_username, JSON.parse(String(BEFORE)).integration_npm_username, 'the other is kept as it was');
});
