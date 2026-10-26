/**
 * #703: a save that names a time zone for the alert rules must name one on the
 * IANA list. The schema alone would drop a bad one and keep the rest; the
 * route refuses the save instead, so nothing is lost without a word. A save
 * without a zone (every earlier install) is untouched.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';

const { displayConfigRoutes } = await import('./displayConfig.js');
const { stopBackgroundRefresh } = await import('../refresh.js');
after(() => stopBackgroundRefresh());

const PATH = join(process.env.JAGHELM_DATA_DIR, 'display-config.json');
const app = express();
app.disable('etag');
app.use(express.json());
app.use('/api/display-config', displayConfigRoutes);

async function save(body) {
  const version = (await request(app).get('/api/display-config')).headers.etag;
  return request(app).post('/api/display-config').set('If-Match', version).send(body);
}

test('a zone off the IANA list is refused with a 400 and nothing is written', async () => {
  writeFileSync(PATH, JSON.stringify({ refreshInterval: 30 }));
  for (const timezone of ['Mars/Olympus', 'toronto', '', 5, 'x'.repeat(100)]) {
    const r = await save({ refreshInterval: 30, alerts: { timezone } });
    assert.equal(r.status, 400, String(timezone));
    assert.match(r.body.error, /time zone/);
  }
  assert.deepEqual(JSON.parse(readFileSync(PATH, 'utf8')), { refreshInterval: 30 });
});

test('a listed zone is kept, and an alerts config without one saves as it was (the legacy default)', async () => {
  writeFileSync(PATH, JSON.stringify({ refreshInterval: 30 }));
  let r = await save({ alerts: { timezone: 'Europe/London', quietHours: { enabled: true } } });
  assert.equal(r.status, 200, r.text);
  assert.equal(JSON.parse(readFileSync(PATH, 'utf8')).alerts.timezone, 'Europe/London');
  r = await save({ alerts: { quietHours: { enabled: true } } });
  assert.equal(r.status, 200, r.text);
  assert.equal(JSON.parse(readFileSync(PATH, 'utf8')).alerts.timezone, undefined);
});
