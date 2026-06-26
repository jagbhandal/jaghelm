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
    const u = cachedIconUrl('https://cdn.jsdelivr.net/x/icon.svg');
    expect(u).toBe(
      'http://vm-101:3099/api/icons/cached?url=' +
        encodeURIComponent('https://cdn.jsdelivr.net/x/icon.svg')
    );
    setApiBase('/api'); // restore
  });
});
