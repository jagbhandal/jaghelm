import { describe, it, expect } from 'vitest';
import { ROUTES, matchPath, resolveRoute, pathTo, NAV_HIDDEN } from './routes.js';

// The route table (#296): a path is matched against the table, its params
// read, and a path no page answers (unknown, or a page not built yet) lands
// on the Overview.

describe('matchPath', () => {
  it('matches a static path exactly', () => {
    expect(matchPath('/alerts', '/alerts')).toEqual({});
    expect(matchPath('/alerts', '/alert')).toBeNull();
    expect(matchPath('/alerts', '/alerts/x')).toBeNull();
    expect(matchPath('/', '/')).toEqual({});
    expect(matchPath('/', '/alerts')).toBeNull();
  });

  it('reads a param, decoded', () => {
    expect(matchPath('/apps/:id', '/apps/grafana')).toEqual({ id: 'grafana' });
    expect(matchPath('/apps/:id', '/apps/tab%20one')).toEqual({ id: 'tab one' });
    expect(matchPath('/apps/:id', '/apps')).toBeNull();
    expect(matchPath('/apps/:id', '/apps/')).toBeNull();
    expect(matchPath('/apps/:id', '/apps//')).toBeNull();
    expect(matchPath('/apps/:id', '/apps/a/b')).toBeNull();
  });

  it('reads several params, as the entity URLs will (/services/:id)', () => {
    expect(matchPath('/nodes/:node/jobs/:job', '/nodes/pve/jobs/backup')).toEqual({
      node: 'pve',
      job: 'backup',
    });
  });

  it('takes an optional param', () => {
    expect(matchPath('/settings/:section?', '/settings')).toEqual({});
    expect(matchPath('/settings/:section?', '/settings/tabs')).toEqual({ section: 'tabs' });
    expect(matchPath('/settings/:section?', '/settings/tabs/x')).toBeNull();
  });

  it('ignores one trailing slash', () => {
    expect(matchPath('/alerts', '/alerts/')).toEqual({});
    expect(matchPath('/apps/:id', '/apps/grafana/')).toEqual({ id: 'grafana' });
  });

  it("doesn't match a param it can't decode", () => {
    expect(matchPath('/apps/:id', '/apps/%E0%A4%A')).toBeNull();
  });
});

describe('resolveRoute', () => {
  const at = (path) => {
    const { route, params, redirect } = resolveRoute(path);
    return { id: route.id, params, redirect };
  };

  it('finds each page that exists', () => {
    expect(at('/')).toEqual({ id: 'overview', params: {}, redirect: false });
    expect(at('/alerts')).toEqual({ id: 'alerts', params: {}, redirect: false });
    expect(at('/apps/grafana')).toEqual({ id: 'app', params: { id: 'grafana' }, redirect: false });
    expect(at('/settings')).toEqual({ id: 'settings', params: {}, redirect: false });
    expect(at('/settings/tabs')).toEqual({
      id: 'settings',
      params: { section: 'tabs' },
      redirect: false,
    });
  });

  it('lands an unknown path on the Overview, asking for a redirect', () => {
    for (const path of ['/nope', '/apps', '/alerts/old', '', '/index.html']) {
      expect(at(path), path).toEqual({ id: 'overview', params: {}, redirect: true });
    }
  });

  it('lands a route whose page is not built yet on the Overview', () => {
    for (const path of ['/services', '/infrastructure']) {
      expect(at(path), path).toEqual({ id: 'overview', params: {}, redirect: true });
    }
  });

  it('opens the Launch page at /launch, no longer the Overview (#301)', () => {
    expect(at('/launch')).toEqual({ id: 'launch', params: {}, redirect: false });
    expect(at('/launch/')).toEqual({ id: 'launch', params: {}, redirect: false });
    expect(ROUTES.find((r) => r.id === 'launch').title).toBe('Launch');
  });

  it('knows the hidden routes, so a later card only unhides one', () => {
    const hidden = ROUTES.filter((r) => r.hidden).map((r) => r.id);
    expect(hidden).toEqual(['services', 'infrastructure']);
    expect(NAV_HIDDEN).toEqual(new Set(hidden));
    // A hidden route still has its path, ready for its page.
    expect(pathTo('services')).toBe('/services');
  });

  it('a route table passed in is the one used', () => {
    const table = [
      { id: 'overview', path: '/' },
      { id: 'launch', path: '/launch' },
    ];
    expect(resolveRoute('/launch', table).route.id).toBe('launch');
    expect(resolveRoute('/launch', table).redirect).toBe(false);
  });
});

describe('pathTo', () => {
  it("builds a route's path from its params, encoded", () => {
    expect(pathTo('overview')).toBe('/');
    expect(pathTo('alerts')).toBe('/alerts');
    expect(pathTo('app', { id: 'grafana' })).toBe('/apps/grafana');
    expect(pathTo('app', { id: 'tab one/2' })).toBe('/apps/tab%20one%2F2');
    expect(pathTo('settings')).toBe('/settings');
    expect(pathTo('settings', { section: 'tabs' })).toBe('/settings/tabs');
  });

  it('round-trips through resolveRoute', () => {
    for (const id of ['x', 'tab-1712', 'a b', 'ünïcode', '50%']) {
      expect(resolveRoute(pathTo('app', { id })).params).toEqual({ id });
    }
  });

  it('throws on an unknown route or a missing param', () => {
    expect(() => pathTo('nope')).toThrow(/no route/i);
    expect(() => pathTo('app')).toThrow(/id/);
  });
});
