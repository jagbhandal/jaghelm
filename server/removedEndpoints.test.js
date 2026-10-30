/**
 * The endpoints and fields kept for old Android apps are gone (#328, spec
 * §6.3 / P4-4): `GET /api/ups` and the cumulative `docker.rxMB` / `txMB`. A
 * grep over the code that ships (tests excluded, they may name what must not
 * be asked) fails if a route, a client call or a field comes back, and the
 * real app answers 404 for the route.
 *
 * /api/services and /api/cron/status stay: the web's Settings and job detail
 * still read /api/cron/status, and /api/services is the board's cards.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';

process.env.JAGHELM_DATA_DIR = mkdtempSync(join(tmpdir(), 'jh-removed-'));
process.env.DASH_PASS = 'test-pass-1234';

const { app } = await import('./index.js');
const { stopBackgroundRefresh } = await import('./refresh.js');
const { createSession } = await import('./auth/sessions.js');

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SHIPPED_DIRS = ['src', 'server', 'gallery', 'scripts'];
const TEST_HELPERS = /(^|\/)testing\//;
const CODE = /\.(js|jsx|mjs|cjs)$/;
const TEST = /\.test\.(js|jsx|mjs|cjs)$/;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (CODE.test(name) && !TEST.test(name) && !TEST_HELPERS.test(path)) yield path;
  }
}

const COMMENT = /^\s*(\*|\/\/|\/\*)/;

/** The shipped code lines (comments skipped) that match `pattern`, as `path:line`. */
function hits(pattern) {
  const found = [];
  for (const dir of SHIPPED_DIRS) {
    for (const file of walk(join(root, dir))) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (!COMMENT.test(line) && pattern.test(line)) found.push(`${relative(root, file)}:${i + 1}`);
        });
    }
  }
  return found;
}

test('nothing that ships names /api/ups, or reads it', () => {
  assert.deepEqual(hits(/\/api\/ups\b|getUPSStatus|needsUpsRead/), []);
});

test('no route is mounted at /ups', () => {
  assert.deepEqual(hits(/router\.(get|use|all)\(\s*['"`]\/ups\b/), []);
});

test('the cumulative container counters rxMB and txMB are not served', () => {
  assert.deepEqual(hits(/\b(rxMB|txMB|rxTotal|txTotal)\b/), []);
});

test('the app answers 404 for GET /api/ups', async () => {
  try {
    const r = await request(app)
      .get('/api/ups')
      .set('x-auth-token', createSession('admin'));
    assert.equal(r.status, 404);
  } finally {
    stopBackgroundRefresh();
  }
});
