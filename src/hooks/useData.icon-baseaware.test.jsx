import { describe, it, expect, afterEach } from 'vitest';
import { cachedIconUrl } from './useData.js';
import { setApiBase } from '../api/baseUrl.js';

const CDN = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/gitea.svg';

afterEach(() => setApiBase('/api'));

describe('cachedIconUrl — base-aware (no bare relative /api on a non-server origin)', () => {
  it('DESKTOP: proxies a CDN URL through the relative /api base (byte-for-byte)', () => {
    expect(cachedIconUrl(CDN)).toBe(`/api/icons/cached?url=${encodeURIComponent(CDN)}`);
  });

  it('MOBILE: proxies through the absolute base so the icon reaches Express + gets x-auth-token', () => {
    setApiBase('http://vm-101:3099/api');
    expect(cachedIconUrl(CDN)).toBe(
      `http://vm-101:3099/api/icons/cached?url=${encodeURIComponent(CDN)}`
    );
  });

  it('passes through non-CDN URLs and returns null for empty/emoji (unchanged contract)', () => {
    expect(cachedIconUrl('/logo.svg')).toBe('/logo.svg');
    expect(cachedIconUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(cachedIconUrl('')).toBe(null);
    expect(cachedIconUrl('🚀')).toBe('🚀'); // non-CDN string → pass-through
  });
});
