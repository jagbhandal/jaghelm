import { describe, it, expect } from 'vitest';
import { cachedIconUrl, getServiceIcon, SERVICE_ICONS } from './useData.js';
import { iconSlugUrl } from '../utils/iconCdn.js';
import { iconImageSrc } from '../utils/icon.jsx';
import { canonicalIconUrl } from '../../server/icon-sources.js';

const CDN = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/gitea.svg';

describe('cachedIconUrl — the /api proxy', () => {
  it('proxies a CDN URL through /api', () => {
    expect(cachedIconUrl(CDN)).toBe(`/api/icons/cached?url=${encodeURIComponent(CDN)}`);
  });

  it('passes through non-CDN URLs and returns null for empty/emoji (unchanged contract)', () => {
    expect(cachedIconUrl('/logo.svg')).toBe('/logo.svg');
    expect(cachedIconUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(cachedIconUrl('')).toBe(null);
    expect(cachedIconUrl('🚀')).toBe('🚀'); // non-CDN string → pass-through
  });
});

// #255: the server caches only icon-repository URLs (server/icon-sources.js).
// The client sends it exactly those; any other image URL loads directly, as it
// would without the cache, so no configured icon breaks.
describe('cachedIconUrl — only what the server caches goes through it', () => {
  const proxied = (u) => `/api/icons/cached?url=${encodeURIComponent(u)}`;

  it('every SERVICE_ICONS entry resolves through the cache, or to its local asset', () => {
    for (const [key, slug] of Object.entries(SERVICE_ICONS)) {
      const src = getServiceIcon(key);
      if (slug.startsWith('/')) expect(src).toBe(slug);
      else expect(src).toBe(proxied(iconSlugUrl(slug)));
      if (!slug.startsWith('/')) expect(canonicalIconUrl(iconSlugUrl(slug))).toBe(iconSlugUrl(slug));
    }
  });

  it('a slug, a filename and the picker\'s URLs of both repositories go through the cache', () => {
    expect(iconImageSrc('gitea')).toBe(proxied(iconSlugUrl('gitea')));
    expect(iconImageSrc('Gitea.svg')).toBe(proxied(iconSlugUrl('gitea')));
    for (const u of [
      'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/plex.svg',
      'https://cdn.jsdelivr.net/gh/selfhst/icons@latest/svg/immich.svg',
      'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/png/plex.png',
      'https://raw.githubusercontent.com/selfhst/icons/main/webp/immich.webp',
      'https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/plex.svg',
    ]) {
      expect(cachedIconUrl(u)).toBe(proxied(u));
      expect(iconImageSrc(u)).toBe(proxied(u));
    }
  });

  it('any other image URL a user pastes loads directly, unchanged', () => {
    for (const u of [
      'https://cdn.jsdelivr.net/gh/someone/else@latest/icon.svg',
      'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@v1.0.0/svg/plex.svg', // a pinned version
      'https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/plex.svg',
      'https://cdn.jsdelivr.net/gh/marella/material-design-icons@latest/svg/folder_special/outline.svg',
      'https://raw.githubusercontent.com/someone/repo/main/icon.png',
      'https://example.com/logo.png',
      'http://192.168.1.5:8080/favicon.ico',
      '/uploads/my-icon.png',
      '/logo.svg',
    ]) {
      expect(cachedIconUrl(u)).toBe(u);
      expect(iconImageSrc(u)).toBe(u);
    }
  });
});
