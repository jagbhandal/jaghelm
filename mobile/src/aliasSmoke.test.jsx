import { describe, it, expect } from 'vitest';
import { getApiBase, setApiBase } from '@shared/api/baseUrl.js';
import { cachedIconUrl } from '@shared/hooks/useData.js';

describe('@shared alias → desktop data layer', () => {
  it('default base is /api (desktop-unchanged)', () => {
    setApiBase('/api'); // reset
    expect(getApiBase()).toBe('/api');
  });

  it('setApiBase makes cachedIconUrl base-aware for CDN urls', () => {
    setApiBase('http://vm-101:3099/api');
    // An icon-repository URL: the only kind the server caches (#255).
    const cdn = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/gitea.svg';
    const u = cachedIconUrl(cdn);
    expect(u).toBe('http://vm-101:3099/api/icons/cached?url=' + encodeURIComponent(cdn));
    setApiBase('/api'); // restore
  });
});
