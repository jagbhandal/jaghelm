/**
 * #254: a poll keeps what the preset computes from the upstream response, never
 * the response itself. fetchIntegration used to return and cache
 * { fields, ...structured, raw: <the whole upstream body>, error }; the only
 * reader of `raw` was GET /api/integrations/:type, which had no caller and is gone.
 *
 * Every preset in the gallery is polled once against a stubbed fetch that answers
 * with a body shaped for it, then read back from the integration cache. Both
 * copies must equal what the preset's fields and structuredTransform compute from
 * that body, with nothing of the body beyond it. Presets that compute in
 * structuredTransform get a hand-made body below; any other preset gets one built
 * from its field paths, so a preset added later is covered without editing this.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Point the secrets store at a scratch dir before anything imports it.
const dataDir = mkdtempSync(join(tmpdir(), 'jh-int-cache-'));
process.env.JAGHELM_DATA_DIR = dataDir;
after(() => rmSync(dataDir, { recursive: true, force: true }));
const { initRegistry, listPresets, getPresetFull } = await import('./registry.js');
const { fetchIntegration } = await import('./handler.js');
const { extractValue } = await import('./lib/extract.js');
const { formatValue, computeField } = await import('./lib/format.js');

// The gallery's list leaves out unsupported presets, which are never fetched.
await initRegistry();
const presets = listPresets().map((p) => getPresetFull(p.type));
// A preset's .env credentials and URL win over the ones passed here; make sure none are set.
for (const p of presets) for (const v of Object.values(p.envKeys || {})) delete process.env[v];

const hex = () => randomBytes(6).toString('hex');
// Only ever in an upstream body: finding it in a result means the body was kept.
const MARK = `upstream-only-${hex()}`;
const NOW_S = Math.floor(Date.now() / 1000);
const GiB = 1073741824;

// Bodies for the presets that compute in structuredTransform. Proxmox fetches
// three endpoints, told apart by the URL.
const STRUCTURED = {
  cloudflare: () => ({
    result: [
      { status: 'healthy', connections: [{ colo_name: 'sea01' }, { colo_name: 'lax02' }] },
      { status: 'down', connections: [] },
    ],
  }),
  gitea: () => ({ data: [{ stars_count: 3, open_issues_count: 2 }, { stars_count: 1, open_issues_count: 0 }] }),
  grafana: () => ({ data: { groups: [{ rules: [{ state: 'firing' }, { state: 'pending' }, { state: 'inactive' }] }] } }),
  npm: () => [
    { enabled: true, meta: { nginx_online: true }, certificate_id: 4 },
    { enabled: false, meta: {}, certificate_id: 0 },
  ],
  proxmox: (url) => {
    if (url.includes('type=storage')) {
      return {
        data: [
          { storage: 'local-lvm', content: 'images,rootdir', plugintype: 'lvmthin', disk: 40 * GiB, maxdisk: 100 * GiB, status: 'available' },
          { storage: 'local', content: 'iso,backup', plugintype: 'dir', disk: 1, maxdisk: 2, status: 'available' },
        ],
      };
    }
    if (url.includes('/tasks')) {
      return {
        data: [
          { type: 'vzdump', starttime: NOW_S - 7200, status: 'OK', id: 'UPID:pve:vzdump:101:' },
          { type: 'vzdump', starttime: NOW_S - 7200, status: 'OK', id: 'UPID:pve:vzdump:103:' },
        ],
      };
    }
    return {
      data: [
        { vmid: 103, name: 'docker-brain', node: 'pve', status: 'running', maxcpu: 8, mem: 6 * GiB, maxmem: 16 * GiB, uptime: 86400 },
        { vmid: 101, name: 'staging', node: 'pve', status: 'stopped', maxcpu: 2 },
      ],
    };
  },
  tailscale: () => ({ devices: [{ connectedToControl: true, updateAvailable: true }, { connectedToControl: false }] }),
  vaultwarden: () => ({}),
};

/** Set `value` at a dot path, making objects on the way. */
function setPath(obj, path, value) {
  const parts = path.split('.');
  let node = obj;
  for (const part of parts.slice(0, -1)) {
    if (node[part] === null || typeof node[part] !== 'object') node[part] = {};
    node = node[part];
  }
  node[parts[parts.length - 1]] = value;
  return obj;
}

/** Any other preset: a body with a distinct number at each path its fields read. */
function bodyFromFields(preset) {
  const paths = (preset.fields || []).flatMap((f) =>
    [f.path, f.numerator, f.denominator, f.a, f.b, ...(f.paths || [])].filter(Boolean));
  // '_length' and '_filter:…' read the body itself as an array.
  if (paths.some((p) => p === '_length' || p.startsWith('_filter:'))) return [{ id: 1 }, { id: 2 }, { id: 3 }];
  const body = {};
  paths.forEach((path, i) => {
    // 'apps._length' counts the keys of apps.
    if (path.endsWith('._length')) setPath(body, path.slice(0, -'._length'.length), { a: {}, b: {}, c: {} });
    else setPath(body, path, 1000 + i * 4099);
  });
  return body;
}

/** The upstream body for one request, carrying MARK. */
function upstream(preset, url) {
  const body = STRUCTURED[preset.type] ? STRUCTURED[preset.type](url) : bodyFromFields(preset);
  if (Array.isArray(body)) for (const item of body) item.note = MARK;
  else body.note = MARK;
  return body;
}

/** What the preset computes from the body its endpoints return. */
function expected(preset) {
  const body = upstream(preset, preset.endpoint);
  const eps = typeof preset.extraEndpoints === 'function' ? preset.extraEndpoints(body) : preset.extraEndpoints;
  if (eps?.length) body._extra = Object.fromEntries(eps.map((ep) => [ep.key, upstream(preset, ep.endpoint)]));
  const fields = {};
  for (const f of preset.fields || []) {
    fields[f.label] = f.compute ? computeField(body, f) : formatValue(extractValue(body, f.path), f.format || 'string');
  }
  return { fields, ...(preset.structuredTransform ? preset.structuredTransform(body) : {}), error: null };
}

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

/** Swap in a fake global fetch for the duration of fn. */
async function withFetch(fake, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = fake;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

test('every gallery preset is polled', () => {
  assert.ok(presets.length >= 30, `only ${presets.length} presets loaded`);
  for (const t of Object.keys(STRUCTURED)) assert.ok(presets.some((p) => p.type === t), `${t} not in the gallery`);
});

for (const preset of presets) {
  test(`${preset.type}: the poll and its cached copy hold the computed result, not the upstream body`, async () => {
    const cfg = { url: 'http://svc.example.test', username: 'u', password: 'p', token: 't', _storageKey: `${preset.type}_${hex()}` };
    const polled = await withFetch(async (url, init = {}) =>
      // A session preset logs in first; answer with a token where it looks.
      json(init.method === 'POST' ? setPath({}, preset.session.tokenPath, 'session-token') : upstream(preset, String(url))),
    () => fetchIntegration(preset.type, cfg, true));

    // Read it back: an upstream that is now down proves this one is the cached copy.
    const cached = await withFetch(async () => { throw new Error('upstream down'); },
      () => fetchIntegration(preset.type, cfg, false));

    const want = expected(preset);
    assert.equal(polled.error, null, `poll failed: ${polled.error}`);
    assert.deepEqual(polled, want, 'the poll returns exactly what the preset computes');
    assert.deepEqual(cached, want, 'the cache holds exactly what the preset computes');
    assert.ok(!('raw' in polled) && !('raw' in cached), 'no raw payload');
    assert.ok(!JSON.stringify(cached).includes(MARK), 'nothing of the upstream body beyond the computed values');
    // The fixture reached the preset's computation: some field is not a placeholder.
    assert.ok(Object.values(want.fields).some((v) => v !== '—' && v !== '0%'),
      `fixture produced only placeholders: ${JSON.stringify(want.fields)}`);
  });
}
