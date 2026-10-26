/**
 * Todo list persistence — a simple JSON array stored in data/todos.json.
 *
 *   GET  /api/todos  → array of todos (empty array on missing file)
 *   POST /api/todos  → replaces the entire array
 */

import { Router } from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';

import { apiError } from '../errors.js';
import { atomicWriteFileSync } from '../util/atomicWrite.js';
import { DATA_DIR } from '../util/dataDir.js';

// Use the shared resolver (honors JAGHELM_DATA_DIR) like every other store —
// otherwise todos split off into an image-layer path that ignores the data volume
// and breaks test isolation.
const TODOS_PATH = join(DATA_DIR, 'todos.json');
const MAX_PAYLOAD_BYTES = 512_000;

export const MAX_TODOS = 500;

/** YYYY-MM-DD that round-trips through a Date, so 2026-02-30 is out. */
function isRealDate(d) {
  const t = Date.parse(`${d}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().startsWith(d);
}

// What the client writes (src/shell/utilities.js). Unknown keys are dropped, so a
// todo stores nothing else. Reading is not validated: files saved before this check
// load as they are.
const todoSchema = z.object({
  // A number too: TodoCard wrote Date.now() ids from 2026-03 to 2026-05, and those are still on disk.
  id: z.union([z.string().max(64), z.number().int().nonnegative()]),
  text: z.string().max(1000),
  done: z.boolean(),
  due: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
    .refine(isRealDate, 'must be a real date')
    .nullish(),
  created: z.iso.datetime().nullish(),
});
const todosSchema = z.array(todoSchema).max(MAX_TODOS, `at most ${MAX_TODOS} todos`);

/** First problem as `todos[2].text: reason`, so the client can see which field. */
function describe(issue) {
  const path = issue.path.map((k) => (typeof k === 'number' ? `[${k}]` : `.${k}`)).join('');
  return `Invalid todos${path ? ` at ${path}` : ''}: ${issue.message}`;
}

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
  const parsed = todosSchema.safeParse(req.body);
  if (!parsed.success) {
    return apiError(res, 400, describe(parsed.error.issues[0]));
  }
  const serialized = JSON.stringify(parsed.data, null, 2);
  if (serialized.length > MAX_PAYLOAD_BYTES) {
    return apiError(res, 413, 'Todos payload too large');
  }
  atomicWriteFileSync(TODOS_PATH, serialized);
  res.json({ ok: true });
});

export { router as todosRoutes };
