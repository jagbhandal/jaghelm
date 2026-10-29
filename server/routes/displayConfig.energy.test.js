/**
 * Monitoring A1 (#742): the `energy` key through the display-config save and
 * read. A bad entry is dropped, a save is never refused, and a valid sample
 * round-trips unchanged.
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
const onDisk = () => JSON.parse(readFileSync(PATH, 'utf8'));
const SAMPLE = {
  currency: '$',
  rates: [
    { from: '2026-01-01', perKwh: 0.14 },
    { from: '2026-07-01', perKwh: 0.17 },
  ],
};

test('a valid sample round-trips through save and read unchanged', async () => {
  writeFileSync(PATH, JSON.stringify({ refreshInterval: 30 }));
  const r = await save({ refreshInterval: 30, energy: SAMPLE });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(onDisk().energy, SAMPLE);
  const got = await request(app).get('/api/display-config');
  assert.deepEqual(got.body.energy, SAMPLE);
  assert.equal(onDisk().refreshInterval, 30);
});

test('a save with bad entries is not refused: they are dropped, the rest sorted and kept', async () => {
  writeFileSync(PATH, JSON.stringify({}));
  const r = await save({
    energy: {
      currency: 'LONG',
      junk: 1,
      rates: [
        { from: '2026-07-01', perKwh: 0.17 },
        { from: '2026-02-30', perKwh: 0.1 },
        { from: '2026-01-01', perKwh: 0 },
        { from: '2026-01-01', perKwh: 11 },
        { from: '2026-07-01', perKwh: 0.99 },
        { from: '2025-01-01', perKwh: 0.12 },
      ],
    },
  });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(onDisk().energy, {
    currency: '$',
    rates: [
      { from: '2025-01-01', perKwh: 0.12 },
      { from: '2026-07-01', perKwh: 0.17 },
    ],
  });
});

test('more than 24 rows are cut, not refused', async () => {
  writeFileSync(PATH, JSON.stringify({}));
  const rates = Array.from({ length: 30 }, (_, i) => ({
    from: `${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`,
    perKwh: 0.1,
  }));
  const r = await save({ energy: { currency: '$', rates } });
  assert.equal(r.status, 200, r.text);
  assert.equal(onDisk().energy.rates.length, 24);
});

test('no valid rate writes no energy key, and anything of another shape is no refusal', async () => {
  for (const energy of [
    { currency: '$', rates: [] },
    { currency: '$' },
    { currency: '$', rates: [{ from: 'x', perKwh: 1 }] },
    'x',
    5,
    null,
    [],
  ]) {
    writeFileSync(PATH, JSON.stringify({ energy: SAMPLE }));
    const r = await save({ refreshInterval: 30, energy });
    assert.equal(r.status, 200, JSON.stringify(energy) + r.text);
    assert.equal(Object.hasOwn(onDisk(), 'energy'), false, JSON.stringify(energy));
  }
});

test('a save without energy writes none', async () => {
  writeFileSync(PATH, JSON.stringify({}));
  const r = await save({ refreshInterval: 30 });
  assert.equal(r.status, 200, r.text);
  assert.equal(Object.hasOwn(onDisk(), 'energy'), false);
});

test('the read leaves out a hand-edited bad entry, and the whole key when none is valid', async () => {
  writeFileSync(
    PATH,
    JSON.stringify({
      energy: {
        currency: '$',
        rates: [
          { from: '2026-07-01', perKwh: 0.17 },
          { from: '2026-13-01', perKwh: 0.1 },
          { from: '2026-01-01', perKwh: 0.14 },
        ],
      },
    })
  );
  let got = await request(app).get('/api/display-config');
  assert.deepEqual(got.body.energy, {
    currency: '$',
    rates: [
      { from: '2026-01-01', perKwh: 0.14 },
      { from: '2026-07-01', perKwh: 0.17 },
    ],
  });
  writeFileSync(PATH, JSON.stringify({ refreshInterval: 30, energy: { rates: 'x' } }));
  got = await request(app).get('/api/display-config');
  assert.equal(got.status, 200);
  assert.equal(Object.hasOwn(got.body, 'energy'), false);
  assert.equal(got.body.refreshInterval, 30);
});
