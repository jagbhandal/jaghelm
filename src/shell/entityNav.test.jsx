import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  SHEETS,
  closeEntity,
  entityHref,
  entityIn,
  entityLink,
  entityOpener,
  openEntity,
  pageHref,
  sheetsAt,
  useEntityLink,
} from './entityNav.js';
import { navigate } from '../router/useRoute.js';

// Entity URLs (#309): the model's id in the query of the page it is opened
// over. App.entity.test.jsx and App.phone.test.jsx drive them through the app.

const url = () => window.location.pathname + window.location.search;

beforeEach(() => window.history.replaceState(null, '', '/'));

describe('entityHref and pageHref', () => {
  it('write the id as it reads, over the page, keeping its other parameters', () => {
    const at = (pathname, search = '') => ({ pathname, search, hash: '' });
    expect(entityHref('services/apps:jellyfin', at('/'))).toBe('/?entity=services/apps:jellyfin');
    expect(entityHref('nodes/storage', at('/alerts'))).toBe('/alerts?entity=nodes/storage');
    expect(entityHref('backups/storage:nightly', at('/', '?subsystem=backups'))).toBe(
      '/?subsystem=backups&entity=backups/storage:nightly'
    );
    // One open at a time: another replaces it.
    expect(entityHref('power/ups', at('/', '?entity=nodes/a&subsystem=power'))).toBe(
      '/?subsystem=power&entity=power/ups'
    );
    // What a URL can't hold as it is, encoded; read back as it was.
    const href = entityHref('services/pi-1:Home Assistant & co', at('/'));
    expect(href).toBe('/?entity=services/pi-1:Home%20Assistant%20%26%20co');
    expect(entityIn(href.slice(1))).toBe('services/pi-1:Home Assistant & co');
    expect(pageHref({ pathname: '/', search: '?subsystem=power&entity=power/ups', hash: '' })).toBe(
      '/?subsystem=power'
    );
    expect(pageHref({ pathname: '/alerts', search: '?entity=power/ups', hash: '#x' })).toBe(
      '/alerts#x'
    );
  });
});

describe('sheetsAt', () => {
  const node = { screen: 'node', params: { nodeKey: 'n' } };
  const svc = { screen: 'serviceDetail', params: { uid: 'n:a' } };
  it('is the stack the entry holds when its top is the URL’s entity', () => {
    expect(sheetsAt({ [SHEETS]: [node, svc] }, '?entity=services/n:a')).toEqual([node, svc]);
  });
  it('else the URL’s entity alone, and nothing without one', () => {
    expect(sheetsAt({ [SHEETS]: [node] }, '?entity=services/n:a')).toEqual([svc]);
    expect(sheetsAt(null, '?entity=power/ups')).toEqual([
      { screen: 'incident', params: { id: 'power/ups' } },
    ]);
    // An id that is no entity's still opens, to say it is no longer monitored.
    expect(sheetsAt(null, '?entity=nonsense')).toEqual([
      { screen: 'incident', params: { id: 'nonsense' } },
    ]);
    expect(sheetsAt({ [SHEETS]: [node] }, '')).toEqual([]);
  });
});

describe('openEntity and closeEntity', () => {
  it('open pushes an entry marked as opened here; close goes back to the page', () => {
    window.history.replaceState(null, '', '/alerts');
    const row = document.createElement('a');
    row.href = '#';
    document.body.append(row);
    row.focus();
    const before = window.history.length;
    act(() => openEntity('backups/storage:nightly'));
    expect(url()).toBe('/alerts?entity=backups/storage:nightly');
    expect(window.history.length).toBe(before + 1);
    expect(window.history.state[SHEETS]).toEqual([
      { screen: 'incident', params: { id: 'backups/storage:nightly' } },
    ]);
    expect(entityOpener()).toBe(row);
    row.remove();
    expect(entityOpener()).toBeNull();
  });

  it('close of an entity opened from its URL leaves the page’s URL, with no entry', () => {
    window.history.replaceState(null, '', '/?subsystem=nodes&entity=nodes/n');
    const before = window.history.length;
    act(() => closeEntity());
    expect(url()).toBe('/?subsystem=nodes');
    expect(window.history.length).toBe(before);
  });

  it('entityLink gives a row the URL for a new tab, and opens it here on a plain click', () => {
    window.history.replaceState(null, '', '/');
    const link = entityLink('nodes/storage');
    expect(link.href).toBe('/?entity=nodes/storage');
    act(() => link.onOpen());
    expect(url()).toBe('/?entity=nodes/storage');
  });
});

describe('useEntityLink', () => {
  it('follows the page under an entity (its filter), not an entity opening or closing', () => {
    window.history.replaceState(null, '', '/');
    const { result } = renderHook(() => useEntityLink());
    const first = result.current;
    expect(first('nodes/n').href).toBe('/?entity=nodes/n');
    act(() => navigate('/?subsystem=nodes', { scroll: false }));
    const filtered = result.current;
    expect(filtered).not.toBe(first);
    expect(filtered('nodes/n').href).toBe('/?subsystem=nodes&entity=nodes/n');
    act(() => filtered('nodes/n').onOpen());
    expect(url()).toBe('/?subsystem=nodes&entity=nodes/n');
    expect(result.current).toBe(filtered);
    act(() => closeEntity());
  });
});
