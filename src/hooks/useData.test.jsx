import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getServiceIcon,
  cachedIconUrl,
  getCronStatus,
  getServices,
  saveTodos,
  getTodos,
  deleteCronJob,
  uploadFile,
  forgetLocalChanges,
  saveIntegration,
  testIntegration,
  deleteIntegration,
  SERVICE_ICONS,
} from './useData.js';
import { iconSlugUrl } from '../utils/iconCdn.js';
import { setApiBase } from '../api/baseUrl.js';
import { setReadOnlyServer } from '../api/client.js';

// getServiceIcon resolves a slug to the CDN URL then proxies it via
// cachedIconUrl (jaghelm is a local path). To assert WHICH key matched, mirror
// that same transform on the expected SERVICE_ICONS value.
const icon = (key) => {
  const v = SERVICE_ICONS[key];
  return cachedIconUrl(v.startsWith('/') ? v : iconSlugUrl(v));
};

// .jsx extension keeps these in Vitest's lane (node:test only globs *.test.js).

// ── getServiceIcon: longest-key-first substring matching ──────────────────
//
// Bug: the old loop iterated SERVICE_ICONS in object-literal order and returned
// the FIRST key that was a substring of the name. A short key ("nas") would
// shadow a longer, more-specific one ("synology") even though the name was
// clearly the more-specific service. The fix matches the LONGEST key first, so
// the result is independent of declaration order and picks the most specific
// icon.
describe('getServiceIcon — longest-key-first matching', () => {
  it('prefers the longer, more specific key over a short substring key', () => {
    // "synology" (8) and "nas" (3) are both substrings of "synology-nas".
    // Longest-first must pick "synology", not "nas".
    expect(getServiceIcon('synology-nas')).toBe(icon('synology'));
    expect(getServiceIcon('synology-nas')).not.toBe(icon('nas'));
  });

  it('does not let a short key hijack an unrelated longer name', () => {
    // "vaultwarden" contains "vault" (5) and "vaultwarden" (11). Longest wins.
    expect(getServiceIcon('my vaultwarden')).toBe(icon('vaultwarden'));
  });

  it('still matches a short key when it is the only/most-specific match', () => {
    expect(getServiceIcon('nas-box')).toBe(icon('nas'));
  });

  it('is order-independent: same result regardless of how keys are declared', () => {
    // "nextcloud" (9) and "cloud" (5) both appear in the name; longest wins.
    expect(getServiceIcon('nextcloud')).toBe(icon('nextcloud'));
  });

  it('returns null for an empty / unknown name', () => {
    expect(getServiceIcon('')).toBe(null);
    expect(getServiceIcon(null)).toBe(null);
    expect(getServiceIcon('totally-unknown-service-xyz')).toBe(null);
  });
});

// ── r.ok checking for hand-rolled mutators ────────────────────────────────
//
// Bug: saveTodos awaited the fetch but never checked r.ok (a failed save was
// silently swallowed), and the integration POST/DELETE helpers called r.json()
// on a non-2xx body (an opaque parse error on an HTML error page). The fix
// routes them through requestJson, which checks r.ok like the read path does.
describe('mutator helpers — fail on non-2xx (r.ok check)', () => {
  function response(body, { status = 200 } = {}) {
    const ok = status >= 200 && status < 300;
    const text = body === undefined ? '' : JSON.stringify(body);
    return {
      ok,
      status,
      text: () => Promise.resolve(text),
      json: () => Promise.resolve(body),
    };
  }

  beforeEach(() => {
    // A token-less apiFetch passes straight through to window.fetch, so stubbing
    // fetch is enough — no auth header needed for these tests.
    if (!AbortSignal.timeout) {
      AbortSignal.timeout = () => new AbortController().signal;
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('saveTodos resolves on a 2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response({ ok: true }))));
    await expect(saveTodos([{ text: 'a' }])).resolves.toBeUndefined();
  });

  it('saveTodos REJECTS on a non-2xx (no longer silently swallowed)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response('Internal Error', { status: 500 }))));
    await expect(saveTodos([{ text: 'a' }])).rejects.toThrow(/HTTP 500/);
  });

  it('saveIntegration rejects on a non-2xx instead of parsing the error body', async () => {
    // Body is HTML — the OLD code would throw an opaque JSON parse error; the new
    // code throws a clear HTTP 502 BEFORE attempting to parse.
    const htmlBody = {
      ok: false,
      status: 502,
      text: () => Promise.resolve('<html>502 Bad Gateway</html>'),
      json: () => Promise.reject(new SyntaxError('Unexpected token <')),
    };
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(htmlBody)));
    await expect(saveIntegration({ type: 'x' })).rejects.toThrow(/HTTP 502/);
  });

  it('testIntegration returns the parsed body on success', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response({ result: 'ok' }))));
    await expect(testIntegration({ type: 'x' })).resolves.toEqual({ result: 'ok' });
  });

  it('deleteIntegration rejects on a non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response('nope', { status: 404 }))));
    await expect(deleteIntegration('x')).rejects.toThrow(/HTTP 404/);
  });
});

// ── forced fetches bypass the browser's HTTP cache ────────────────────────
//
// /cron/status sends Cache-Control: max-age, so the browser may hold a copy. A
// forced fetch (first load, retry, the retry after deleting a cron job) must
// reach the server AND replace that copy (`reload`, not `no-store`, which would
// leave the older copy for the next polled fetch to serve); a polled fetch
// leaves caching to the server's headers.
describe('fetchJson — cache mode', () => {
  const ok = () =>
    Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: () => Promise.resolve([]),
    });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a forced fetch with cache: reload, so it refreshes the cached copy', async () => {
    const spy = vi.fn(ok);
    vi.stubGlobal('fetch', spy);
    await getCronStatus(true);
    expect(spy.mock.calls[0][1].cache).toBe('reload');
  });

  it('leaves a polled fetch on the default cache mode', async () => {
    const spy = vi.fn(ok);
    vi.stubGlobal('fetch', spy);
    await getCronStatus();
    expect(spy.mock.calls[0][1].cache).toBeUndefined();
  });
});

// ── the stored ETag always describes the body the client holds ────────────
//
// Bug (#383): fetchJson stored a 200's ETag before parsing its body. A 200 with
// an ETag but an empty or malformed body (a truncated response, a proxy's error
// page, a body read cut off by the timeout) failed to parse with its ETag
// already stored. The next poll sent that ETag, the server answered 304, and the
// client handed back the OLD body (or, holding none, the no-body sentinel): the
// dashboard stuck on old data until the server's ETag changed. The fix stores
// the ETag and the body together, in one step, once the body has parsed.
describe('fetchJson — the stored ETag always describes the body held', () => {
  const A = { nodes: { a: { display_name: 'A' } } };
  const B = { nodes: { b: { display_name: 'B' } } };
  const C = { nodes: { c: { display_name: 'C' } } };
  const brokenBodies = [
    ['an empty body', ''],
    ['malformed JSON', '{"nodes":'],
  ];

  let n = 0;
  let sent; // the If-None-Match of each request, in order (null when absent)
  let server;

  const json200 = (body, etag) =>
    new Response(JSON.stringify(body), { status: 200, headers: etag ? { ETag: etag } : {} });

  // A stand-in for the server: a 304 when If-None-Match names its current ETag,
  // otherwise a 200 with its current body and ETag. A queued `glitch` replaces
  // the next 200 (same status and ETag, broken body).
  function serve(etag, body) {
    server.etag = etag;
    server.body = body;
  }

  beforeEach(() => {
    if (!AbortSignal.timeout) {
      AbortSignal.timeout = () => new AbortController().signal;
    }
    // Each test gets its own URL, so it starts with nothing cached.
    setApiBase(`/etag-${++n}/api`);
    sent = [];
    server = { etag: null, body: null, glitch: null };
    vi.stubGlobal(
      'fetch',
      vi.fn((url, opts) => {
        const inm = opts?.headers?.['If-None-Match'] ?? null;
        sent.push(inm);
        if (inm && inm === server.etag) {
          const notModified = new Response(null, { status: 304, headers: { ETag: server.etag } });
          return Promise.resolve(notModified);
        }
        const glitch = server.glitch;
        server.glitch = null;
        return Promise.resolve(glitch ? glitch(server.etag) : json200(server.body, server.etag));
      })
    );
  });

  afterEach(() => {
    setApiBase('/api');
    vi.unstubAllGlobals();
  });

  it.each(brokenBodies)(
    'a 200 with a new ETag and %s keeps the last good pair, so the next poll gets the new data',
    async (_, text) => {
      serve('"v1"', A);
      const first = await getServices(true);
      expect(first).toEqual(A);

      serve('"v2"', B);
      server.glitch = (etag) => new Response(text, { status: 200, headers: { ETag: etag } });
      await expect(getServices(false)).rejects.toThrow();

      // Still asking about A (v1), so the server sends B instead of a 304 that
      // would hand A back again.
      await expect(getServices(false)).resolves.toEqual(B);
      expect(sent).toEqual([null, '"v1"', '"v1"']);
    }
  );

  it.each(brokenBodies)(
    'with nothing held, a 200 with an ETag and %s leaves the next poll unconditional',
    async (_, text) => {
      serve('"v1"', A);
      server.glitch = (etag) => new Response(text, { status: 200, headers: { ETag: etag } });
      await expect(getServices(false)).rejects.toThrow();

      // No If-None-Match, so the answer is the body, not a 304 with no body held.
      await expect(getServices(false)).resolves.toEqual(A);
      expect(sent).toEqual([null, null]);
    }
  );

  it('a body read cut off by the timeout keeps the last good pair', async () => {
    serve('"v1"', A);
    await getServices(true);

    serve('"v2"', B);
    server.glitch = (etag) => {
      const cutOff = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"nodes":{"b":'));
          controller.error(new DOMException('The operation timed out.', 'TimeoutError'));
        },
      });
      return new Response(cutOff, { status: 200, headers: { ETag: etag } });
    };
    await expect(getServices(false)).rejects.toMatchObject({ name: 'TimeoutError' });

    await expect(getServices(false)).resolves.toEqual(B);
    expect(sent).toEqual([null, '"v1"', '"v1"']);
  });

  it('a forced fetch (skipEtag) whose body fails to parse keeps the last good pair', async () => {
    serve('"v1"', A);
    await getServices(true);

    serve('"v2"', B);
    server.glitch = (etag) => new Response('{"nodes":', { status: 200, headers: { ETag: etag } });
    await expect(getServices(true)).rejects.toThrow();

    await expect(getServices(false)).resolves.toEqual(B);
    expect(sent).toEqual([null, null, '"v1"']);
  });

  it('a 200 without an ETag drops the old one, so the next poll is unconditional', async () => {
    serve('"v1"', A);
    await getServices(true);

    // B arrives with no ETag (say, a proxy stripped it): v1 describes A, not B.
    serve(null, B);
    await expect(getServices(false)).resolves.toEqual(B);

    // The server's data goes back to A, whose ETag is v1 again. Asking with v1
    // would get a 304 and hand back B.
    serve('"v1"', A);
    await expect(getServices(false)).resolves.toEqual(A);
    expect(sent).toEqual([null, '"v1"', null]);
  });

  // A 200 whose body loads slowly: json() waits until `finish` is called.
  const slow200 = (body, etag) => {
    let finish;
    const parsed = new Promise((r) => (finish = () => r(body)));
    const response = { ok: true, status: 200, headers: new Headers({ ETag: etag }), json: () => parsed };
    return { response, finish: () => finish() };
  };

  it('overlapping fetches: the request sent last wins, whichever body finishes last', async () => {
    serve('"v1"', A);
    await getServices(true);

    // Two polls in flight: X is sent first and gets v2 (B), Y is sent second and
    // gets v3 (C), and Y's body finishes before X's.
    const x200 = slow200(B, '"v2"');
    const y200 = slow200(C, '"v3"');
    fetch.mockImplementationOnce(() => Promise.resolve(x200.response));
    fetch.mockImplementationOnce(() => Promise.resolve(y200.response));
    const x = getServices(false);
    const y = getServices(false);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    y200.finish();
    const newer = await y;
    expect(newer).toBe(C);

    // X finishes last but was sent first: it keeps Y's pair and hands its
    // caller Y's body, so the dashboard does not step back to B.
    x200.finish();
    await expect(x).resolves.toBe(newer);

    // Still holding v3 (C): the next poll asks with v3 and gets C back.
    serve('"v3"', C);
    await expect(getServices(false)).resolves.toBe(newer);
    expect(sent.at(-1)).toBe('"v3"');
  });

  it('overlapping fetches: a later request that fails does not stop an earlier one storing', async () => {
    serve('"v1"', A);
    await getServices(true);

    // X is sent first and its body is still loading; Y is sent second and its
    // body is broken, so Y fails before X finishes.
    const x200 = slow200(B, '"v2"');
    fetch.mockImplementationOnce(() => Promise.resolve(x200.response));
    fetch.mockImplementationOnce(() =>
      Promise.resolve(new Response('{"nodes":', { status: 200, headers: { ETag: '"v3"' } }))
    );
    const x = getServices(false);
    const y = getServices(false);
    await expect(y).rejects.toThrow();
    x200.finish();
    await expect(x).resolves.toBe(B);

    // X's pair is held: the next poll asks with v2 and gets B back.
    serve('"v2"', B);
    await expect(getServices(false)).resolves.toBe(B);
    expect(sent.at(-1)).toBe('"v2"');
  });
});

// ── A read-only server (the public demo, #248) ────────────────────────────
//
// It refuses every write, so the helpers send none: the change is kept in this
// tab for the visit and the matching read answers with it.
describe('on a read-only server, a change is kept in this tab and nothing is sent', () => {
  const json = (body) =>
    new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  const STATUSES = [
    { node: 'apps', jobs: [{ job: 'db-dump', runs: [] }] },
    {
      node: 'storage',
      jobs: [
        { job: 'nightly-backup', runs: [] },
        { job: 'scrub-check', runs: [] },
      ],
    },
  ];
  let sent;

  beforeEach(() => {
    if (!AbortSignal.timeout) AbortSignal.timeout = () => new AbortController().signal;
    sent = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, init = {}) => {
        sent.push(`${init.method || 'GET'} ${url}`);
        if (String(url).endsWith('/todos')) return json([{ id: 'a', text: 'From the server' }]);
        if (String(url).endsWith('/cron/status')) return json(STATUSES);
        return json({});
      })
    );
    setReadOnlyServer(true);
  });

  afterEach(() => {
    setReadOnlyServer(false);
    forgetLocalChanges();
    vi.unstubAllGlobals();
  });

  const writes = () => sent.filter((r) => !r.startsWith('GET '));

  it("the checklist: a save is kept, and read back instead of the server's list", async () => {
    expect(await getTodos()).toEqual([{ id: 'a', text: 'From the server' }]);
    const edited = [{ id: 'a', text: 'From the server', done: true }];
    await expect(saveTodos(edited)).resolves.toBeUndefined();
    expect(await getTodos()).toEqual(edited);
    expect(writes()).toEqual([]);
  });

  it('a scheduled job: removing it leaves it out of the statuses, and its node when it was the last', async () => {
    await expect(deleteCronJob('storage', 'nightly-backup')).resolves.toBeNull();
    expect(await getCronStatus(true)).toEqual([
      STATUSES[0],
      { node: 'storage', jobs: [{ job: 'scrub-check', runs: [] }] },
    ]);
    await deleteCronJob('apps', 'db-dump');
    expect((await getCronStatus(true)).map((n) => n.node)).toEqual(['storage']);
    expect(writes()).toEqual([]);
  });

  it('a logo or background: an object URL in this tab, not an upload', async () => {
    const createObjectURL = vi.fn(() => 'blob:local/1');
    vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL }));
    const file = new File(['png'], 'logo.png', { type: 'image/png' });
    await expect(uploadFile(file, 'logo')).resolves.toEqual({ url: 'blob:local/1' });
    expect(createObjectURL).toHaveBeenCalledWith(file);
    expect(sent).toEqual([]);
  });

  it('a writable server still gets the save', async () => {
    setReadOnlyServer(false);
    await saveTodos([{ id: 'b' }]);
    await deleteCronJob('apps', 'db-dump');
    expect(writes()).toEqual(['POST /api/todos', 'DELETE /api/cron/jobs/apps/db-dump']);
    expect(await getTodos()).toEqual([{ id: 'a', text: 'From the server' }]);
  });
});
