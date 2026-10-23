/**
 * A missing file under /assets answers 404, not the SPA's index.html (#256). An
 * old tab can ask for a hashed chunk that a deploy removed; an index.html answer
 * with a 200 fails to load as code, and the service worker used to cache it
 * under the chunk's URL.
 *
 * res.sendFile is stubbed on this app so the SPA catch-all answers HTML whether
 * or not dist/ has been built: CI runs the tests before the build, and without
 * dist/index.html the catch-all would 404 too and hide a fall-through.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-assets-'));
process.env.JAGHELM_DATA_DIR = dataDir;
delete process.env.DASH_PASS; // auth disabled
process.env.PROMETHEUS_URL = 'http://127.0.0.1:1';
process.env.KUMA_URL = 'http://127.0.0.1:1';

const { app } = await import('./index.js');
const { stopBackgroundRefresh } = await import('./refresh.js');

// The SPA catch-all is the only sendFile caller on these paths.
app.response.sendFile = function sendIndexHtml() {
  this.type('html').send('<!doctype html><title>JagHelm</title>');
};

after(() => {
  stopBackgroundRefresh();
  rmSync(dataDir, { recursive: true, force: true });
});

test('an unknown app path still gets index.html from the SPA catch-all', async () => {
  const r = await request(app).get('/some/view');
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /text\/html/);
});

test("an entity's URL (#309) gets index.html on a reload, on any page; an API path never does", async () => {
  for (const path of [
    '/?entity=services/apps:jellyfin',
    '/alerts?entity=nodes/storage',
    '/services?entity=services/pi-1:Home%20Assistant',
    '/infrastructure?entity=power/ups',
    '/?subsystem=backups&entity=backups/storage:nightly-backup',
    '/?entity=integrations/arcane:vm-103',
    '/?entity=gone/nothing',
  ]) {
    const r = await request(app).get(path);
    assert.equal(r.status, 200, path);
    assert.match(r.headers['content-type'], /text\/html/, path);
  }
  const api = await request(app).get('/api/no-such-thing?entity=services/apps:jellyfin');
  assert.equal(api.status, 404);
  assert.match(api.headers['content-type'], /json/);
});

test('a missing /assets file answers 404, not index.html', async () => {
  for (const path of ['/assets/SettingsView-REMOVED.js', '/assets/index-REMOVED.css']) {
    const r = await request(app).get(path);
    assert.equal(r.status, 404, `${path} should be a 404`);
    assert.doesNotMatch(r.headers['content-type'] || '', /text\/html/, `${path} must not be HTML`);
  }
});
