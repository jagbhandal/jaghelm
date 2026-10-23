/**
 * An integration that fails says why in words on the board (#605): the real
 * integrations refresh against a stubbed fetch that fails as Node's fetch and
 * JagHelm's own guards do, then the status model, served by the status route.
 * A refused connection, a redirect JagHelm doesn't follow and a timeout each
 * give their sentence, never the fetch's text, which names hosts and origins.
 * A refused URL and JagHelm's own refusals keep their words.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

process.env.DASH_SECRET = 'test-secret-at-least-16-chars-long'; // pragma: allowlist secret
for (const v of ['NPM_URL', 'NPM_USER', 'NPM_PASS']) delete process.env[v];

const { saveConfig } = await import('./config.js');
const { initSecrets } = await import('./secrets.js');
const { initRegistry } = await import('./integrations/registry.js');
const { refreshIntegrations } = await import('./refresh.js');
const { getCached, setCache } = await import('./cache.js');
const { buildStatus, DEFAULT_THRESHOLDS } = await import('./status/index.js');
const { statusRoutes } = await import('./routes/status.js');
const { RAW_DETAIL } = await import('./testing/rawDetail.js');

initSecrets();
await initRegistry();

// How each upstream answers, by host.
const upstreams = {
  // Node's fetch on a refused connection: the reason, with its code, as the cause.
  'refused.example.test': () => {
    throw new TypeError('fetch failed', {
      cause: Object.assign(new Error('connect ECONNREFUSED 10.0.0.9:80'), { code: 'ECONNREFUSED' }),
    });
  },
  // A redirect to another origin while the key is in the URL: JagHelm refuses it.
  'keyed.example.test': () =>
    new Response(null, {
      status: 302,
      headers: { location: 'http://sso.elsewhere.test/login?next=/status' },
    }),
  // The integration fetch's own timeout aborts it.
  'slow.example.test': () => {
    throw new DOMException('This operation was aborted', 'AbortError');
  },
};
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const answer = upstreams[u.hostname];
  if (!answer) throw new Error(`no upstream for ${u.hostname}`);
  return answer(u, init);
};
process.on('exit', () => {
  globalThis.fetch = realFetch;
});

const custom = (host, extra = {}) => ({
  url: `http://${host}`,
  endpoint: '/status',
  auth: 'none',
  fields: [{ key: 'up', label: 'Up', path: 'up' }],
  ...extra,
});

const app = express().use('/api/status', statusRoutes);

test('a refused connection, a redirect refusal and a timeout: each its sentence, no host or origin in /api/status', async () => {
  saveConfig({
    integrations: {
      sonarr: custom('refused.example.test'),
      radarr: custom('keyed.example.test', { auth: 'query', token: 'k-123' }),
      plex: custom('slow.example.test'),
    },
  });
  const integrations = await refreshIntegrations();
  assert.deepEqual(integrations.sonarr._failure, { cause: 'refused' });
  assert.deepEqual(integrations.radarr._failure, { cause: 'redirect' });
  assert.deepEqual(integrations.plex._failure, { cause: 'timeout' });

  const { status } = buildStatus({
    inputs: { integrations: getCached('integrations') },
    thresholds: DEFAULT_THRESHOLDS,
    now: Date.now(),
  });
  setCache('status', status);
  const served = await request(app).get('/api/status');
  assert.equal(served.status, 200);
  const reasons = Object.fromEntries(
    served.body.entities
      .filter((e) => e.kind === 'integration')
      .map((e) => [e.name, [e.word, e.reason]])
  );
  assert.deepEqual(reasons, {
    sonarr: ['Failing', 'sonarr refused the connection'],
    radarr: ['Failing', "radarr's redirect wasn't followed (see the log)"],
    plex: ['Failing', "plex didn't answer in time"],
  });
  assert.doesNotMatch(JSON.stringify(served.body), RAW_DETAIL);
  assert.doesNotMatch(JSON.stringify(served.body), /elsewhere|example\.test|k-123/);
});

test("a URL that isn't set and JagHelm's own refusals keep their words", () => {
  const reasonOf = (entry) =>
    buildStatus({ inputs: { integrations: { x: entry } }, thresholds: DEFAULT_THRESHOLDS, now: 0 })
      .status.entities[0].reason;
  assert.equal(
    reasonOf({ _error: 'Integration not configured' }),
    'Fetch failed: Integration not configured'
  );
  const offOrigin =
    'Its endpoint leads away from its URL, onto another host or port, so it is not requested; check the endpoint in its entry in services.yaml';
  // Cut to the 120 characters a reason carries (rules.js errorText).
  assert.ok(reasonOf({ _error: offOrigin }).startsWith(`Fetch failed: ${offOrigin.slice(0, 100)}`));
});

test("JagHelm's own refusal (an endpoint off its URL's origin) gives no cause: its words are said as they are", async () => {
  const { fetchIntegration } = await import('./integrations/handler.js');
  const { OFF_ORIGIN_ERROR } = await import('./integrations/lib/origin.js');
  const r = await fetchIntegration('custom', {
    url: 'http://cred.example.test',
    endpoint: '{token}/status',
    token: '.elsewhere.example.test',
    fields: [{ key: 'up', label: 'Up', path: 'up' }],
    _storageKey: 'custom_own_words',
  });
  assert.equal(r.error, OFF_ORIGIN_ERROR);
  assert.equal('failure' in r, false);
});
