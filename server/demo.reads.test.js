/**
 * Every /api read the clients send is one the demo answers on purpose (#437).
 * An /api path the demo doesn't know answers 404, as on the live server, so a
 * new endpoint a client starts reading must be given a demo answer, or this
 * test fails, instead of the demo answering it with nothing.
 *
 * The paths are taken from the client's source, tests left out: the web app
 * (src/). Every string or template literal that starts with `/api`,
 * `${getApiBase()}` or `${base}` (the API base URL, which ends in
 * /api), with each `${…}` in it read as one path segment (`:param`). A path
 * built some other way is not seen; the demo render test
 * (src/demo.render.test.jsx) also checks every request the web app sends on
 * load. CLIENT_PATHS says which of them a client reads: a path found in the
 * source and not in it fails, so does one in it that the source no longer has.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { demoResponse } from './demo.js';

const SOURCES = ['../src/'].map((dir) =>
  fileURLToPath(new URL(dir, import.meta.url))
);

// Each /api path in the clients' source: 'read' when a client GETs it (the
// demo must answer it), 'write' when it only sends changes (the demo refuses
// every one, 403). A path a client both reads and writes is a read.
const CLIENT_PATHS = {
  '/api/auth/check': 'read',
  '/api/cron/status': 'read',
  '/api/disk-forecast': 'read', // the nodes' days left (#670)
  '/api/display-config': 'read',
  '/api/embed-check/:param': 'read',
  '/api/events': 'read', // the Alerts pages' History (#314)
  '/api/gitea/activity': 'read',
  '/api/history': 'read',
  '/api/icons': 'read',
  '/api/icons/cached': 'read',
  '/api/integrations': 'read',
  '/api/integrations/presets': 'read',
  '/api/push/alerts': 'read', // Settings → Notifications' alert rules: held, snoozed, acknowledged (#669)
  '/api/push/devices': 'read', // Settings → Notifications' phones (#320)
  '/api/push/web/key': 'read', // Settings → Notifications' Alerts on this device (#653); the demo has no keys
  '/api/push/web/subscriptions': 'read', // and its list (its POST and DELETE are writes)
  '/api/services': 'read',
  '/api/services/config': 'read',
  '/api/services/monitor-mapping': 'read', // Settings → Nodes & Services' suggestions (#319)
  '/api/services/monitors': 'read',
  '/api/setup': 'read', // the guided first run (#322); the demo has none to guide
  '/api/status': 'read', // the web header (#296)
  '/api/thresholds': 'read', // Settings → Notifications' thresholds (#320); its PUT is a write
  '/api/todos': 'read',
  '/api/ups': 'read',
  '/api/weather': 'read',
  '/api/auth/change-password': 'write',
  '/api/push/alerts/clear': 'write', // lift a snooze or an ack (#669); the demo refuses writes
  '/api/auth/login': 'write',
  '/api/auth/logout': 'write', // sign-out (#507); the demo has no sign-in to end
  '/api/cron/jobs/:param/:param': 'write',
  '/api/integrations/:param': 'write',
  '/api/integrations/save': 'write',
  '/api/integrations/test': 'write',
  '/api/services/nodes/find': 'write', // Settings → Nodes & Services' Find nodes (#572); the demo's button asks nothing
  '/api/setup/done': 'write', // Finish and Skip (#322)
  '/api/push/test': 'write', // Settings → Notifications' test push (#320)
  '/api/embed-check': 'write', // Settings → Apps & links' check of an address not saved yet (#362)
  '/api/upload': 'write',
};

const API_LITERAL = /['"`](?:\/api|\$\{getApiBase\(\)\}|\$\{base\})(\/[^'"`?\s]*)?/g;

/** Each /api path in the clients' source, with where it is. */
function clientPaths() {
  const found = new Map();
  for (const dir of SOURCES) {
    const files = readdirSync(dir, { recursive: true }).filter(
      (f) => /\.(jsx?|tsx?)$/.test(f) && !/\.test\./.test(f) && !/(^|\/)testing\//.test(f)
    );
    for (const file of files) {
      readFileSync(join(dir, file), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const text = line.trim();
          if (text.startsWith('*') || text.startsWith('//') || text.startsWith('/*')) return; // a comment
          for (const m of line.matchAll(API_LITERAL)) {
            if (!m[1]) continue; // the base itself ('/api')
            const path = `/api${m[1]}`.replace(/\$\{[^}]*\}/g, ':param');
            found.set(path, [...(found.get(path) ?? []), `${join(dir, file)}:${i + 1}`]);
          }
        });
    }
  }
  return found;
}

// What the demo answers a path it doesn't know: the live server's 404.
const unknownAnswer = () => demoResponse({ path: '/api/no-such-read' });

test('every /api path in the clients is listed as a read or a write, and every listed one is still there (#437)', () => {
  const found = clientPaths();
  const unlisted = [...found].filter(([path]) => !Object.hasOwn(CLIENT_PATHS, path));
  assert.deepEqual(
    unlisted.map(([path, where]) => `${path} (${where.join(', ')})`),
    [],
    'a new /api path in a client: list it in CLIENT_PATHS, and give the demo an answer if it is a read'
  );
  const gone = Object.keys(CLIENT_PATHS).filter((path) => !found.has(path));
  assert.deepEqual(gone, [], 'listed but no longer in a client');
});

test('the demo answers every /api path a client reads on purpose, never with its 404 for an unknown path (#437)', () => {
  const unknown = unknownAnswer();
  assert.equal(unknown.status, 404);
  const reads = Object.keys(CLIENT_PATHS).filter((path) => CLIENT_PATHS[path] === 'read');
  assert.ok(reads.length >= 17, 'the reads the board and Settings send');
  for (const path of reads) {
    const concrete = path.replace(/:param/g, 'demo-id');
    for (const scenario of ['incident', 'healthy']) {
      const out = demoResponse({ path: concrete, scenario });
      assert.notDeepEqual(out, unknown, `${path} (${scenario}) answers as an unknown path`);
    }
  }
});

test('the demo refuses every /api path a client writes (#437)', () => {
  const writes = Object.keys(CLIENT_PATHS).filter((path) => CLIENT_PATHS[path] === 'write');
  for (const path of writes) {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const out = demoResponse({ method, path: path.replace(/:param/g, 'demo-id') });
      assert.equal(out.status, 403, `${method} ${path}`);
    }
  }
});
