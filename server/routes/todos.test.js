/**
 * Todos validation (#352): a save checks every todo's shape and writes nothing
 * on a bad body; todos already on disk still load as they are.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-todos-'));
process.env.JAGHELM_DATA_DIR = dataDir;
const { todosRoutes } = await import('./todos.js');
after(() => rmSync(dataDir, { recursive: true, force: true }));

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use('/api/todos', todosRoutes);
const file = join(dataDir, 'todos.json');

const good = { id: 'a1', text: 'Renew cert', done: false, due: '2026-11-03', created: '2026-10-26T12:00:00.000Z' };

test('valid todos save unchanged, with due and created optional or null', async () => {
  const list = [good, { id: 'b2', text: 'x', done: true, due: null }, { id: 'c3', text: 'y', done: false }];
  await request(app).post('/api/todos').send(list).expect(200);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), list);
  assert.deepEqual((await request(app).get('/api/todos')).body, list);
});

const bad = [
  ['id', { ...good, id: undefined }],
  ['id', { ...good, id: 'x'.repeat(65) }],
  ['id', { ...good, id: 5.5 }],
  ['id', { ...good, id: { a: 1 } }],
  ['id', { ...good, id: -1 }],
  ['due', { ...good, due: '2026-02-30' }],
  ['text', { ...good, text: 42 }],
  ['text', { ...good, text: 'x'.repeat(1001) }],
  ['done', { ...good, done: 'yes' }],
  ['due', { ...good, due: 'tomorrow' }],
  ['due', { ...good, due: { a: 1 } }],
  ['created', { ...good, created: 'yesterday' }],
  ['\\[1\\]', null],
  ['\\[1\\]', 'a string'],
];
for (const [field, todo] of bad) {
  test(`a todo with a bad ${field} (${JSON.stringify(todo)?.slice(0, 40)}) is a 400 naming the field, and nothing is written`, async () => {
    rmSync(file, { force: true });
    const res = await request(app).post('/api/todos').send([good, todo]).expect(400);
    assert.match(res.body.error, new RegExp(field));
    assert.equal(existsSync(file), false);
  });
}

test('a list over 500 todos is rejected', async () => {
  rmSync(file, { force: true });
  const list = Array.from({ length: 501 }, (_, i) => ({ id: `t${i}`, text: 'x', done: false }));
  await request(app).post('/api/todos').send(list).expect(400);
  assert.equal(existsSync(file), false);
  const ok = list.slice(0, 500);
  await request(app).post('/api/todos').send(ok).expect(200);
});

test('unknown keys on a todo are not stored', async () => {
  await request(app).post('/api/todos').send([{ ...good, extra: { deep: [1] } }]).expect(200);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), [good]);
});

test('a non-array body is still a 400', async () => {
  await request(app).post('/api/todos').send({ id: 'a' }).expect(400);
});

test('todos already on disk load untouched, old or odd entries included', async () => {
  const old = [{ id: 7, text: 'legacy', done: false, due: '3/4/2026' }, { text: 'no id' }];
  writeFileSync(file, JSON.stringify(old));
  assert.deepEqual((await request(app).get('/api/todos')).body, old);
});

test('a numeric id from the older client saves, and an impossible date does not pass as real', async () => {
  const list = [{ id: 1774000000000, text: 'old', done: false }, { ...good, due: '2028-02-29' }];
  await request(app).post('/api/todos').send(list).expect(200);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), list);
});
