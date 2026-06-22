import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getServiceIcon,
  cachedIconUrl,
  saveTodos,
  saveIntegration,
  testIntegration,
  deleteIntegration,
  SERVICE_ICONS,
} from './useData.js';
import { iconSlugUrl } from '../utils/iconCdn.js';

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
