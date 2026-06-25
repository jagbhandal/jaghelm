import { describe, it, expect, afterEach, vi } from 'vitest';
import { getServices, getCronStatus } from './useData.js';
import { setApiBase } from '../api/baseUrl.js';

// Build a minimal fetch Response stub (200 with an empty JSON body + ETag).
function okJson(body = {}) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null }, // no ETag → no caching interference
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  setApiBase('/api'); // restore the desktop default
});

describe('useData — base-aware URLs via getApiBase()', () => {
  it('DESKTOP: getServices hits the relative /api base byte-for-byte', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(okJson({ nodes: {} })));
    vi.stubGlobal('fetch', fetchSpy);
    await getServices(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/services');
  });

  it('DESKTOP: getCronStatus hits /api/cron/status byte-for-byte', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(okJson({})));
    vi.stubGlobal('fetch', fetchSpy);
    await getCronStatus(true);
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/cron/status');
  });

  it('MOBILE: after setApiBase, the same call targets the absolute base', async () => {
    setApiBase('http://vm-101:3099/api');
    const fetchSpy = vi.fn(() => Promise.resolve(okJson({ nodes: {} })));
    vi.stubGlobal('fetch', fetchSpy);
    await getServices(true);
    expect(fetchSpy.mock.calls[0][0]).toBe('http://vm-101:3099/api/services');
  });
});
