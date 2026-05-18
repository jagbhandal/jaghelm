/**
 * Todo list persistence — a simple JSON array stored in data/todos.json.
 *
 *   GET  /api/todos  → array of todos (empty array on missing file)
 *   POST /api/todos  → replaces the entire array
 */

import { Router } from 'express';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { apiError } from '../errors.js';
import { atomicWriteFileSync } from '../util/atomicWrite.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TODOS_PATH = join(__dirname, '..', '..', 'data', 'todos.json');
const MAX_PAYLOAD_BYTES = 512_000;

const router = Router();

router.get('/', (req, res) => {
  try {
    res.json(JSON.parse(readFileSync(TODOS_PATH, 'utf8')));
  } catch {
    res.json([]);
  }
});

router.post('/', (req, res) => {
  if (!Array.isArray(req.body)) {
    return apiError(res, 400, 'Todos must be an array');
  }
  const serialized = JSON.stringify(req.body, null, 2);
  if (serialized.length > MAX_PAYLOAD_BYTES) {
    return apiError(res, 413, 'Todos payload too large');
  }
  atomicWriteFileSync(TODOS_PATH, serialized);
  res.json({ ok: true });
});

export { router as todosRoutes };
